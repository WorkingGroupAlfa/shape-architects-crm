import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { intakeLead } from '../../services/leads.service.js';

export const websiteRouter = Router();
export const publicWebsiteRouter = Router();

const CONTENT_ID = 'shape-site';
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
const uploadDir = path.resolve(process.cwd(), env.STORAGE_DIR);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname);
    const basename = path.basename(file.originalname, extension).replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').toLowerCase();
    cb(null, `website-${Date.now()}-${basename || 'image'}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image uploads are allowed'));
  }
});

type WebsiteContent = {
  meta: {
    title: string;
    email: string;
    address: string;
    footerCopy: string;
    copyright: string;
    socials: {
      facebook: string;
      instagram: string;
      linkedin: string;
    };
  };
  home: {
    heroTitle: string;
    heroSubtitle: string;
    aboutKicker: string;
    aboutStatement: string;
    teamTitle: string;
    teamCopy: string;
    workStatement: string;
    servicesTitle: string;
    servicesCopy: string;
    contactTitle: string;
    contactCopy: string;
  };
  pillars: Array<{ title: string; text: string; icon: string }>;
  team: Array<{ name: string; role: string; image: string; bio: string }>;
  portfolio: Array<Record<string, unknown> & {
    title: string;
    slug: string;
    year: string;
    image: string;
    description: string;
    gallery: string[];
    published?: boolean;
  }>;
  services: Array<{ title: string; content: string; open?: boolean }>;
};

const contentSchema = z.object({
  meta: z.object({
    title: z.string().default('Shape Architects'),
    email: z.string().default('hello@shapearchitects.com.au'),
    address: z.string().default('254 Angas Street\nAdelaide SA 5000'),
    footerCopy: z.string().default('Shape Architects are proudly South Australian. We create homes built for you. Designed for your life.'),
    copyright: z.string().default('Shape Architects © 2026'),
    socials: z.object({
      facebook: z.string().default(''),
      instagram: z.string().default(''),
      linkedin: z.string().default('')
    }).default({ facebook: '', instagram: '', linkedin: '' })
  }),
  home: z.object({
    heroTitle: z.string().default('Shape Architects.'),
    heroSubtitle: z.string().default(''),
    aboutKicker: z.string().default('WHO ARE WE'),
    aboutStatement: z.string().default(''),
    teamTitle: z.string().default('Team'),
    teamCopy: z.string().default(''),
    workStatement: z.string().default(''),
    servicesTitle: z.string().default('Services'),
    servicesCopy: z.string().default(''),
    contactTitle: z.string().default('Contact'),
    contactCopy: z.string().default('')
  }),
  pillars: z.array(z.object({
    title: z.string(),
    text: z.string(),
    icon: z.string()
  })).default([]),
  team: z.array(z.object({
    name: z.string(),
    role: z.string(),
    image: z.string(),
    bio: z.string()
  })).default([]),
  portfolio: z.array(z.record(z.unknown()).and(z.object({
    title: z.string(),
    slug: z.string(),
    year: z.string().default(''),
    image: z.string().default(''),
    description: z.string().default(''),
    gallery: z.array(z.string()).default([]),
    published: z.boolean().default(true)
  }))).default([]),
  services: z.array(z.object({
    title: z.string(),
    content: z.string(),
    open: z.boolean().optional()
  })).default([])
});

function defaultContent(): WebsiteContent {
  const archiveData = readArchiveSiteData();
  return {
    meta: {
      title: 'Shape Architects',
      email: 'hello@shapearchitects.com.au',
      address: '254 Angas Street\nAdelaide SA 5000',
      footerCopy: 'Shape Architects are proudly South Australian. We create homes built for you. Designed for your life.',
      copyright: 'Shape Architects © 2026',
      socials: {
        facebook: 'https://www.facebook.com/shapearchitects',
        instagram: 'https://www.instagram.com/shape_architects_au/',
        linkedin: 'https://www.linkedin.com/company/shape-architects-au'
      }
    },
    home: {
      heroTitle: 'Shape Architects.',
      heroSubtitle: 'Shape Architects is a South Australian firm which provides end to end architectural services to the residential design and development sector',
      aboutKicker: 'WHO ARE WE',
      aboutStatement: 'With an increase in the complexity and intricacy of approaches taken by architecture firms, we have kept things simple and distilled what we do into five key pillars through which we live our values and structure our engagements.',
      teamTitle: 'Team',
      teamCopy: 'Here at Shape Architects we value both innovation and uniqueness in our designs, and our people.',
      workStatement: 'The best reflection of our approach and the values we live are the 573 projects we have completed, and the environments we have been a part of shaping.',
      servicesTitle: 'Services',
      servicesCopy: 'We align our offering to how your project is structured. We can either play a specific role as part of the project, or be involved throughout its lifecycle from conceptualisation through to construction.',
      contactTitle: 'Contact',
      contactCopy: 'Thank you for your interest in Shape Architects and we look forward to hearing from you.'
    },
    pillars: archiveData.pillars ?? [],
    team: archiveData.team ?? [],
    portfolio: (archiveData.portfolio ?? []).map(project => ({ ...project, published: true })),
    services: archiveData.services ?? []
  };
}

function readArchiveSiteData() {
  const candidates = [
    path.resolve(process.cwd(), '../landing/src/data/site-data.js'),
    path.resolve(process.cwd(), 'apps/landing/src/data/site-data.js')
  ];
  const filePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!filePath) return { pillars: [], team: [], portfolio: [], services: [] };

  const source = fs.readFileSync(filePath, 'utf8');
  const windowLike: { SHAPE_SITE_DATA?: unknown } = {};
  try {
    new Function('window', source)(windowLike);
    if (windowLike.SHAPE_SITE_DATA && typeof windowLike.SHAPE_SITE_DATA === 'object') {
      return windowLike.SHAPE_SITE_DATA as Pick<WebsiteContent, 'pillars' | 'team' | 'portfolio' | 'services'>;
    }
  } catch (error) {
    console.warn('Website default data could not be parsed', error);
  }
  return { pillars: [], team: [], portfolio: [], services: [] };
}

function parseStoredContent(data: string): WebsiteContent {
  try {
    return contentSchema.parse(JSON.parse(data));
  } catch {
    return defaultContent();
  }
}

async function getWebsiteContent() {
  const record = await findWebsiteContentRecord();
  return record ? parseStoredContent(record.data) : defaultContent();
}

async function saveWebsiteContent(content: WebsiteContent) {
  await upsertWebsiteContentRecord(JSON.stringify(content));
}

function isSqlite() {
  return env.DATABASE_URL.startsWith('file:') || env.DATABASE_URL.includes('sqlite');
}

async function findWebsiteContentRecord(): Promise<{ data: string } | null> {
  const rows = isSqlite()
    ? await prisma.$queryRawUnsafe<Array<{ data: string }>>('SELECT data FROM WebsiteContent WHERE id = ?', CONTENT_ID)
    : await prisma.$queryRawUnsafe<Array<{ data: string }>>('SELECT data FROM "WebsiteContent" WHERE id = $1', CONTENT_ID);
  return rows[0] ?? null;
}

async function upsertWebsiteContentRecord(data: string) {
  if (isSqlite()) {
    await prisma.$executeRawUnsafe(
      'INSERT INTO WebsiteContent (id, data, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = CURRENT_TIMESTAMP',
      CONTENT_ID,
      data
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    'INSERT INTO "WebsiteContent" ("id", "data", "createdAt", "updatedAt") VALUES ($1, $2, NOW(), NOW()) ON CONFLICT ("id") DO UPDATE SET "data" = EXCLUDED."data", "updatedAt" = NOW()',
    CONTENT_ID,
    data
  );
}

publicWebsiteRouter.get('/website', async (_req, res) => {
  const content = await getWebsiteContent();
  res.json({
    ...content,
    portfolio: content.portfolio.filter(project => project.published !== false)
  });
});

publicWebsiteRouter.post('/leads', async (req, res) => {
  const schema = z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    name: z.string().optional(),
    email: z.string().email(),
    phone: z.string().optional(),
    subject: z.string().optional(),
    message: z.string().min(2),
    company: z.string().optional(),
    website: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }
  if (parsed.data.website?.trim()) {
    return res.status(200).json({ ok: true });
  }

  const fullName = parsed.data.name?.trim()
    || [parsed.data.firstName, parsed.data.lastName].map(value => value?.trim()).filter(Boolean).join(' ')
    || parsed.data.email;
  const notes = [
    parsed.data.subject ? `Subject: ${parsed.data.subject}` : null,
    parsed.data.message ? `Message: ${parsed.data.message}` : null
  ].filter(Boolean).join('\n');

  const intake = await intakeLead({
    source: 'Shape Website',
    name: fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    company: parsed.data.company,
    message: notes,
    additionalNotes: notes,
    createClient: true,
    dedupeByContact: true
  });

  res.status(201).json({
    ok: true,
    leadId: intake.lead.id,
    clientId: intake.client?.id ?? null,
    createdClient: intake.createdClient
  });
});

websiteRouter.get('/', async (_req, res) => {
  res.json(await getWebsiteContent());
});

websiteRouter.put('/', async (req, res) => {
  const parsed = contentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }
  await saveWebsiteContent(parsed.data);
  res.json(parsed.data);
});

websiteRouter.post('/uploads', upload.array('files', 30), async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  res.status(201).json(files.map(file => ({
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/storage/uploads/${file.filename}`
  })));
});

publicWebsiteRouter.post('/website/admin/login', async (req, res) => {
  const schema = z.object({ password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Password is required' });
  if (parsed.data.password !== websiteAdminPassword()) return res.status(401).json({ message: 'Invalid password' });
  res.json({ token: createWebsiteAdminToken() });
});

publicWebsiteRouter.get('/website/admin/content', requireWebsiteAdmin, async (_req, res) => {
  res.json(await getWebsiteContent());
});

publicWebsiteRouter.put('/website/admin/content', requireWebsiteAdmin, async (req, res) => {
  const parsed = contentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }
  await saveWebsiteContent(parsed.data);
  res.json(parsed.data);
});

publicWebsiteRouter.post('/website/admin/uploads', requireWebsiteAdmin, upload.array('files', 30), async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  res.status(201).json(files.map(file => ({
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/storage/uploads/${file.filename}`
  })));
});

function websiteAdminPassword() {
  return process.env.WEBSITE_ADMIN_PASSWORD || 'shape-admin-2026';
}

function websiteTokenSecret() {
  return `${env.AUTH_SECRET}:shape-website-admin`;
}

function sign(value: string) {
  return createHmac('sha256', websiteTokenSecret()).update(value).digest('base64url');
}

function createWebsiteAdminToken() {
  const encoded = Buffer.from(JSON.stringify({
    scope: 'website-admin',
    exp: Date.now() + ADMIN_TOKEN_TTL_MS
  }), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

function parseWebsiteAdminToken(token: string) {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || sign(encoded) !== signature) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { scope?: string; exp?: number };
    return payload.scope === 'website-admin' && typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function requireWebsiteAdmin(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  if (!parseWebsiteAdminToken(authHeader.slice('Bearer '.length).trim())) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}
