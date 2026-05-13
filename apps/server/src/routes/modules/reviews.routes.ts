import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { logActivity } from '../../lib/activity.js';

export const reviewsRouter = Router();
export const publicReviewsRouter = Router();
const db = prisma as unknown as {
  renderReview: any;
  renderReviewImage: any;
  renderReviewGuest: any;
  renderReviewAnnotation: any;
  renderReviewCanvasImage: any;
};

const uploadDir = path.resolve(process.cwd(), env.STORAGE_DIR);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${randomBytes(4).toString('hex')}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

const REVIEW_STATUSES = ['DRAFT', 'SHARED', 'CLOSED'] as const;
const ANNOTATION_TYPES = ['note', 'pencil', 'arrow'] as const;
const routeParam = (value: string | string[]) => (Array.isArray(value) ? value[0] : value);
const makeToken = () => randomBytes(12).toString('base64url');
const makePassword = () => randomBytes(5).toString('base64url');

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const input = scryptSync(password, salt, 32);
  const target = Buffer.from(hash, 'hex');
  return input.length === target.length && timingSafeEqual(input, target);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const replyInclude = {
  guest: { select: { id: true, name: true } }
};

const reviewInclude = {
  project: { select: { id: true, title: true, invoiceNumber: true } },
  client: { select: { id: true, name: true, clientNumber: true } },
  images: { orderBy: { sortOrder: 'asc' as const } },
  guests: { orderBy: { createdAt: 'desc' as const } },
  canvasImages: {
    include: { guest: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const }
  },
  annotations: {
    where: { parentId: null },
    include: {
      guest: { select: { id: true, name: true } },
      replies: { include: replyInclude, orderBy: { createdAt: 'asc' as const } }
    },
    orderBy: { createdAt: 'asc' as const }
  },
  _count: { select: { images: true, annotations: true, guests: true } }
};

function serializeAnnotation(a: Record<string, unknown>) {
  const replies = (a.replies as Array<Record<string, unknown>> | undefined ?? []).map(r => ({
    ...r,
    geometry: parseJson(String(r.geometryJson ?? '{}')),
    geometryJson: undefined
  }));
  return {
    ...a,
    geometry: parseJson(String(a.geometryJson ?? '{}')),
    geometryJson: undefined,
    replies
  };
}

function serializeCanvasImage(image: Record<string, unknown>) {
  return image;
}

function serializeReview(review: Record<string, unknown>) {
  const annotations = (review.annotations as Array<Record<string, unknown>> | undefined ?? []).map(serializeAnnotation);
  const canvasImages = (review.canvasImages as Array<Record<string, unknown>> | undefined ?? []).map(serializeCanvasImage);
  return {
    ...review,
    passwordHash: undefined,
    annotations,
    canvasImages
  };
}

async function findPublicReview(token: string) {
  return db.renderReview.findUnique({
    where: { token },
    include: reviewInclude
  });
}

reviewsRouter.get('/', async (_req, res) => {
  const reviews = await db.renderReview.findMany({
    include: {
      project: { select: { id: true, title: true, invoiceNumber: true } },
      client: { select: { id: true, name: true, clientNumber: true } },
      _count: { select: { images: true, annotations: true, guests: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(reviews.map((item: Record<string, unknown>) => ({ ...item, passwordHash: undefined })));
});

reviewsRouter.get('/:id', async (req, res) => {
  const review = await db.renderReview.findUnique({
    where: { id: routeParam(req.params.id) },
    include: reviewInclude
  });
  if (!review) return res.status(404).json({ message: 'Review not found' });
  res.json(serializeReview(review));
});

reviewsRouter.post('/', async (req, res) => {
  const schema = z.object({
    title: z.string().min(2),
    projectId: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    password: z.string().min(4).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const password = parsed.data.password?.trim() || makePassword();
  const created = await db.renderReview.create({
    data: {
      title: parsed.data.title.trim(),
      token: makeToken(),
      passwordHash: hashPassword(password),
      projectId: parsed.data.projectId || undefined,
      clientId: parsed.data.clientId || undefined,
      createdById: req.auth?.userId
    },
    include: {
      project: { select: { id: true, title: true, invoiceNumber: true } },
      client: { select: { id: true, name: true, clientNumber: true } },
      _count: { select: { images: true, annotations: true, guests: true } }
    }
  });

  await logActivity({
    entityType: 'render_review',
    entityId: created.id,
    action: 'create',
    message: `Render review created: ${created.title}`,
    userId: req.auth?.userId,
    clientId: created.clientId ?? undefined
  });

  res.status(201).json({ ...created, passwordHash: undefined, clientPassword: password });
});

reviewsRouter.patch('/:id', async (req, res) => {
  const schema = z.object({
    title: z.string().min(2).optional(),
    status: z.enum(REVIEW_STATUSES).optional(),
    password: z.string().min(4).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const status = parsed.data.status;
  const updated = await db.renderReview.update({
    where: { id: routeParam(req.params.id) },
    data: {
      title: parsed.data.title?.trim(),
      status,
      closedAt: status === 'CLOSED' ? new Date() : status === 'SHARED' || status === 'DRAFT' ? null : undefined,
      passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : undefined
    },
    include: reviewInclude
  });
  res.json(serializeReview(updated));
});

reviewsRouter.post('/:id/images', upload.array('files', 30), async (req, res) => {
  const reviewId = routeParam(req.params.id);
  const review = await db.renderReview.findUnique({ where: { id: reviewId }, include: { _count: { select: { images: true } } } });
  if (!review) return res.status(404).json({ message: 'Review not found' });
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) return res.status(400).json({ message: 'Files are required' });

  const created = await Promise.all(files.map((file, index) =>
    db.renderReviewImage.create({
      data: {
        reviewId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        fileSize: file.size,
        sortOrder: review._count.images + index
      }
    })
  ));

  res.status(201).json(created);
});

reviewsRouter.delete('/:id/images/:imageId', async (req, res) => {
  const image = await db.renderReviewImage.findUnique({ where: { id: routeParam(req.params.imageId) } });
  if (!image || image.reviewId !== routeParam(req.params.id)) return res.status(404).json({ message: 'Image not found' });
  const filePath = path.resolve(uploadDir, image.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const canvasImages = await db.renderReviewCanvasImage.findMany({ where: { imageId: image.id } });
  for (const canvasImage of canvasImages) {
    const canvasFilePath = path.resolve(uploadDir, canvasImage.storedName);
    if (fs.existsSync(canvasFilePath)) fs.unlinkSync(canvasFilePath);
  }
  await db.renderReviewImage.delete({ where: { id: image.id } });
  res.status(204).send();
});

reviewsRouter.patch('/:id/annotations/:annotationId', async (req, res) => {
  const schema = z.object({ resolved: z.boolean().optional(), text: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  const updated = await db.renderReviewAnnotation.update({
    where: { id: routeParam(req.params.annotationId) },
    data: parsed.data,
    include: { guest: { select: { id: true, name: true } } }
  });
  res.json({ ...updated, geometry: parseJson(updated.geometryJson), geometryJson: undefined });
});

reviewsRouter.delete('/:id', async (req, res) => {
  const review = await db.renderReview.findUnique({
    where: { id: routeParam(req.params.id) },
    include: { images: true, canvasImages: true }
  });
  if (!review) return res.status(404).json({ message: 'Review not found' });
  for (const image of review.images) {
    const filePath = path.resolve(uploadDir, image.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  for (const image of review.canvasImages) {
    const filePath = path.resolve(uploadDir, image.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await db.renderReview.delete({ where: { id: review.id } });
  res.status(204).send();
});

publicReviewsRouter.post('/:token/session', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    name: z.string().min(1).max(80),
    guestId: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await findPublicReview(routeParam(req.params.token));
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  // Return existing guest by id (session restore) or by name (dedup), else create new
  let guest = parsed.data.guestId
    ? (review.guests as Array<{ id: string; name: string }>).find(g => g.id === parsed.data.guestId) ?? null
    : null;
  if (!guest) {
    const nameLower = parsed.data.name.trim().toLowerCase();
    guest = (review.guests as Array<{ id: string; name: string }>).find(g => g.name.toLowerCase() === nameLower) ?? null;
  }
  if (!guest) {
    guest = await db.renderReviewGuest.create({
      data: { reviewId: review.id, name: parsed.data.name.trim() }
    });
  }

  const fresh = await findPublicReview(review.token);
  res.json({ guest, review: serializeReview(fresh!) });
});

publicReviewsRouter.get('/:token', async (req, res) => {
  const review = await findPublicReview(routeParam(req.params.token));
  if (!review) return res.status(404).json({ message: 'Review not found' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });
  res.json({
    id: review.id,
    title: review.title,
    status: review.status,
    imageCount: review.images.length
  });
});

publicReviewsRouter.post('/:token/annotations', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string(),
    imageId: z.string(),
    type: z.enum(ANNOTATION_TYPES),
    text: z.string().optional(),
    geometry: z.unknown(),
    color: z.string().default('#20a8ff'),
    strokeWidth: z.number().min(1).max(24).default(3)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await findPublicReview(routeParam(req.params.token));
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const image = review.images.find((item: { id: string }) => item.id === parsed.data.imageId);
  if (!image) return res.status(404).json({ message: 'Image not found' });
  const guest = review.guests.find((item: { id: string }) => item.id === parsed.data.guestId);
  if (!guest) return res.status(404).json({ message: 'Guest not found' });

  const number = parsed.data.type === 'note'
    ? await db.renderReviewAnnotation.count({ where: { reviewId: review.id, type: 'note' } }) + 1
    : null;
  const created = await db.renderReviewAnnotation.create({
    data: {
      reviewId: review.id,
      imageId: image.id,
      guestId: guest.id,
      type: parsed.data.type,
      number,
      text: parsed.data.text?.trim() || null,
      geometryJson: JSON.stringify(parsed.data.geometry),
      color: parsed.data.color,
      strokeWidth: parsed.data.strokeWidth
    },
    include: { guest: { select: { id: true, name: true } } }
  });
  await db.renderReviewGuest.update({ where: { id: guest.id }, data: { lastSeenAt: new Date() } });
  res.status(201).json({ ...created, geometry: parseJson(created.geometryJson), geometryJson: undefined });
});

publicReviewsRouter.patch('/:token/annotations/:annotationId', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string(),
    text: z.string().optional(),
    resolved: z.boolean().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await findPublicReview(routeParam(req.params.token));
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  const annotation = review.annotations.find((item: { id: string }) => item.id === routeParam(req.params.annotationId));
  if (!annotation) return res.status(404).json({ message: 'Annotation not found' });

  const updated = await db.renderReviewAnnotation.update({
    where: { id: annotation.id },
    data: { text: parsed.data.text, resolved: parsed.data.resolved },
    include: { guest: { select: { id: true, name: true } } }
  });
  res.json({ ...updated, geometry: parseJson(updated.geometryJson), geometryJson: undefined });
});

publicReviewsRouter.delete('/:token/annotations/:annotationId', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await db.renderReview.findUnique({ where: { token: routeParam(req.params.token) }, select: { id: true, passwordHash: true, status: true } });
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });

  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const guest = await db.renderReviewGuest.findFirst({
    where: { id: parsed.data.guestId, reviewId: review.id }
  });
  if (!guest) return res.status(404).json({ message: 'Guest not found' });

  const annotation = await db.renderReviewAnnotation.findFirst({
    where: { id: routeParam(req.params.annotationId), reviewId: review.id, parentId: null }
  });
  if (!annotation) return res.status(404).json({ message: 'Annotation not found' });

  const deleted = await db.renderReviewAnnotation.update({
    where: { id: annotation.id },
    data: { deletedAt: new Date(), deletedByGuestId: guest.id },
    include: {
      guest: { select: { id: true, name: true } },
      replies: { include: replyInclude, orderBy: { createdAt: 'asc' as const } }
    }
  });
  res.json(serializeAnnotation(deleted));
});

publicReviewsRouter.post('/:token/canvas-images', upload.single('file'), async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string(),
    imageId: z.string(),
    x: z.coerce.number().min(-2).max(3),
    y: z.coerce.number().min(-2).max(3),
    width: z.coerce.number().min(0.04).max(1.5)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ message: 'Image file is required' });

  const review = await findPublicReview(routeParam(req.params.token));
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const image = review.images.find((item: { id: string }) => item.id === parsed.data.imageId);
  if (!image) return res.status(404).json({ message: 'Image not found' });
  const guest = review.guests.find((item: { id: string }) => item.id === parsed.data.guestId);
  if (!guest) return res.status(404).json({ message: 'Guest not found' });

  const created = await db.renderReviewCanvasImage.create({
    data: {
      reviewId: review.id,
      imageId: image.id,
      guestId: guest.id,
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      fileSize: file.size,
      x: parsed.data.x,
      y: parsed.data.y,
      width: parsed.data.width
    },
    include: { guest: { select: { id: true, name: true } } }
  });
  await db.renderReviewGuest.update({ where: { id: guest.id }, data: { lastSeenAt: new Date() } });
  res.status(201).json(serializeCanvasImage(created));
});

publicReviewsRouter.patch('/:token/canvas-images/:canvasImageId', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string(),
    x: z.number().min(-2).max(3).optional(),
    y: z.number().min(-2).max(3).optional(),
    width: z.number().min(0.04).max(1.5).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await db.renderReview.findUnique({ where: { token: routeParam(req.params.token) }, select: { id: true, passwordHash: true, status: true } });
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const guest = await db.renderReviewGuest.findFirst({ where: { id: parsed.data.guestId, reviewId: review.id } });
  if (!guest) return res.status(404).json({ message: 'Guest not found' });

  const canvasImage = await db.renderReviewCanvasImage.findFirst({
    where: { id: routeParam(req.params.canvasImageId), reviewId: review.id }
  });
  if (!canvasImage) return res.status(404).json({ message: 'Canvas image not found' });

  const updated = await db.renderReviewCanvasImage.update({
    where: { id: canvasImage.id },
    data: { x: parsed.data.x, y: parsed.data.y, width: parsed.data.width },
    include: { guest: { select: { id: true, name: true } } }
  });
  res.json(serializeCanvasImage(updated));
});

publicReviewsRouter.delete('/:token/canvas-images/:canvasImageId', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await db.renderReview.findUnique({ where: { token: routeParam(req.params.token) }, select: { id: true, passwordHash: true, status: true } });
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const guest = await db.renderReviewGuest.findFirst({ where: { id: parsed.data.guestId, reviewId: review.id } });
  if (!guest) return res.status(404).json({ message: 'Guest not found' });

  const canvasImage = await db.renderReviewCanvasImage.findFirst({
    where: { id: routeParam(req.params.canvasImageId), reviewId: review.id }
  });
  if (!canvasImage) return res.status(404).json({ message: 'Canvas image not found' });

  const deleted = await db.renderReviewCanvasImage.update({
    where: { id: canvasImage.id },
    data: { deletedAt: new Date() },
    include: { guest: { select: { id: true, name: true } } }
  });
  res.json(serializeCanvasImage(deleted));
});

// ---- Reply to an annotation ----------------------------------------
publicReviewsRouter.post('/:token/annotations/:annotationId/replies', async (req, res) => {
  const schema = z.object({
    password: z.string().min(1),
    guestId: z.string(),
    text: z.string().min(1).max(2000)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const review = await findPublicReview(routeParam(req.params.token));
  if (!review || !verifyPassword(parsed.data.password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const parent = review.annotations.find((a: { id: string }) => a.id === routeParam(req.params.annotationId));
  if (!parent) return res.status(404).json({ message: 'Annotation not found' });
  const guest = review.guests.find((g: { id: string }) => g.id === parsed.data.guestId);
  if (!guest) return res.status(404).json({ message: 'Guest not found' });

  const reply = await db.renderReviewAnnotation.create({
    data: {
      reviewId: review.id,
      imageId: parent.imageId,
      guestId: guest.id,
      parentId: parent.id,
      type: 'note',
      text: parsed.data.text.trim(),
      geometryJson: '{}',
      color: '#C8956A',
      strokeWidth: 3
    },
    include: replyInclude
  });
  await db.renderReviewGuest.update({ where: { id: guest.id }, data: { lastSeenAt: new Date() } });
  res.status(201).json({ ...reply, geometry: {}, geometryJson: undefined });
});

// ---- Long-poll for live updates -----------------------------------
publicReviewsRouter.get('/:token/poll', async (req, res) => {
  const { password, guestId, since } = req.query as Record<string, string>;
  if (!password || !guestId) return res.status(400).json({ message: 'Missing params' });

  const review = await db.renderReview.findUnique({
    where: { token: routeParam(req.params.token) },
    select: { id: true, passwordHash: true, status: true }
  });
  if (!review || !verifyPassword(password, review.passwordHash)) return res.status(401).json({ message: 'Invalid password' });
  if (review.status === 'CLOSED') return res.status(403).json({ message: 'Review is closed' });

  const sinceDate = since ? new Date(since) : new Date(0);

  const changedAnnotations = await db.renderReviewAnnotation.findMany({
    where: {
      reviewId: review.id,
      parentId: null,
      OR: [{ createdAt: { gt: sinceDate } }, { updatedAt: { gt: sinceDate } }]
    },
    include: {
      guest: { select: { id: true, name: true } },
      replies: { include: replyInclude, orderBy: { createdAt: 'asc' as const } }
    },
    orderBy: { createdAt: 'asc' as const }
  });

  const newReplies = await db.renderReviewAnnotation.findMany({
    where: { reviewId: review.id, parentId: { not: null }, createdAt: { gt: sinceDate } },
    include: replyInclude,
    orderBy: { createdAt: 'asc' as const }
  });

  const changedCanvasImages = await db.renderReviewCanvasImage.findMany({
    where: {
      reviewId: review.id,
      OR: [{ createdAt: { gt: sinceDate } }, { updatedAt: { gt: sinceDate } }]
    },
    include: { guest: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const }
  });

  res.json({
    annotations: changedAnnotations.map((a: Record<string, unknown>) => serializeAnnotation(a)),
    canvasImages: changedCanvasImages.map((image: Record<string, unknown>) => serializeCanvasImage(image)),
    replies: newReplies.map((r: Record<string, unknown>) => ({
      ...r,
      geometry: {},
      geometryJson: undefined
    }))
  });
});
