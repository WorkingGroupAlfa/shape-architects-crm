import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { nextClientNumber } from '../../lib/numbering.js';
import { logActivity } from '../../lib/activity.js';
import {
  askPerplexityFollowupForClient,
  generatePerplexitySummaryForClient,
  listPerplexityResearchMessages
} from '../../services/perplexity.service.js';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../../lib/env.js';
import { composeOneTime } from '../../services/mail/mail-compose.service.js';
import multer from 'multer';

export const clientsRouter = Router();
const idParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const uploadDir = path.resolve(process.cwd(), env.STORAGE_DIR);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, safe);
  }
});
const upload = multer({ storage });
const defaultClientStatuses = [
  { key: 'target', label: 'Target', isSystem: true },
  { key: 'not_target', label: 'Not Target', isSystem: true },
  { key: 'negotiations', label: 'Negotiations', isSystem: true }
] as const;

async function ensureClientStatuses() {
  const count = await prisma.clientStatus.count();
  if (count > 0) return prisma.clientStatus.findMany({ orderBy: { createdAt: 'asc' } });

  for (const status of defaultClientStatuses) {
    await prisma.clientStatus.upsert({
      where: { key: status.key },
      update: {},
      create: status
    });
  }

  return prisma.clientStatus.findMany({ orderBy: { createdAt: 'asc' } });
}

async function syncClientPrimaryEmail(clientId: string) {
  const primary = await prisma.clientContactEmail.findFirst({
    where: { clientId, isActive: true, isPrimary: true },
    orderBy: { createdAt: 'asc' },
    select: { email: true }
  });
  await prisma.client.update({
    where: { id: clientId },
    data: { email: primary?.email ?? null }
  });
}

clientsRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '');
  const status = String(req.query.status ?? '');

  const clients = await prisma.client.findMany({
    where: {
      AND: [
        q ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { company: { contains: q } },
            { clientNumber: { contains: q } }
          ]
        } : {},
        status ? { status: { key: status } } : {}
      ]
    },
    include: {
      status: true,
      projects: true,
      contactEmails: {
        where: { isActive: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(clients);
});

clientsRouter.get('/statuses', async (_req, res) => {
  res.json(await ensureClientStatuses());
});

clientsRouter.post('/statuses', async (req, res) => {
  const schema = z.object({
    key: z.string().min(2),
    label: z.string().min(2)
  });
  const input = schema.parse(req.body);
  res.status(201).json(await prisma.clientStatus.create({ data: input }));
});

clientsRouter.get('/:id', async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    include: {
      status: true,
      contactEmails: {
        where: { isActive: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
      },
      comments: { orderBy: { createdAt: 'desc' } },
      projects: true,
      subscriptions: { include: { template: true } },
      files: { orderBy: { createdAt: 'desc' } },
      invoiceFiles: {
        include: {
          project: {
            select: {
              id: true,
              title: true,
              invoiceNumber: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      },
      sentEmails: {
        include: { template: true },
        orderBy: { createdAt: 'desc' },
        take: 100
      },
      activities: { orderBy: { createdAt: 'desc' }, take: 20 }
    }
  });

  if (!client) return res.status(404).json({ message: 'Client not found' });
  res.json(client);
});

clientsRouter.post('/', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    company: z.string().optional(),
    abn: z.string().optional(),
    address: z.string().optional(),
    leadSource: z.string().optional(),
    statusId: z.string().optional(),
    notes: z.string().optional()
  });

  const input = schema.parse(req.body);
  const statuses = await ensureClientStatuses();
  const targetStatus = statuses.find(status => status.key === 'target');
  const fallbackStatusId = targetStatus?.id ?? statuses[0]?.id;

  if (!input.statusId && !fallbackStatusId) {
    return res.status(400).json({ message: 'No client status available' });
  }

  const client = await prisma.client.create({
    data: {
      ...input,
      email: input.email || undefined,
      statusId: input.statusId ?? fallbackStatusId!,
      clientNumber: await nextClientNumber()
    }
  });

  if (client.email?.trim()) {
    const normalized = client.email.trim().toLowerCase();
    await prisma.clientContactEmail.upsert({
      where: {
        clientId_emailNormalized: {
          clientId: client.id,
          emailNormalized: normalized
        }
      },
      update: {
        email: client.email.trim(),
        isPrimary: true,
        isActive: true
      },
      create: {
        clientId: client.id,
        email: client.email.trim(),
        emailNormalized: normalized,
        label: 'Primary',
        isPrimary: true,
        isActive: true
      }
    });
  }

  await logActivity({
    entityType: 'client',
    entityId: client.id,
    action: 'create',
    message: `Client ${client.clientNumber} created`,
    clientId: client.id
  });

  res.status(201).json(client);
});

clientsRouter.patch('/:id', async (req, res) => {
  const schema = z.object({
    clientNumber: z.string().min(3).optional(),
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    company: z.string().optional(),
    abn: z.string().optional(),
    address: z.string().optional(),
    leadSource: z.string().optional(),
    statusId: z.string().optional()
  });

  const input = schema.parse(req.body);
  let updated;
  try {
    updated = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        ...input,
        clientNumber: input.clientNumber?.trim() || undefined,
        email: input.email === '' ? null : input.email
      },
      include: {
        status: true,
        contactEmails: {
          where: { isActive: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
        },
        comments: { orderBy: { createdAt: 'desc' } },
        projects: true,
        subscriptions: { include: { template: true } },
        files: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 }
      }
    });
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return res.status(409).json({ message: 'Client number is already used.' });
    }
    console.error('Client update failed', error);
    return res.status(500).json({ message: 'Client update failed' });
  }

  if (updated.email?.trim()) {
    const normalized = updated.email.trim().toLowerCase();
    await prisma.clientContactEmail.upsert({
      where: {
        clientId_emailNormalized: {
          clientId: updated.id,
          emailNormalized: normalized
        }
      },
      update: {
        email: updated.email.trim(),
        isActive: true
      },
      create: {
        clientId: updated.id,
        email: updated.email.trim(),
        emailNormalized: normalized,
        label: 'Primary',
        isPrimary: true,
        isActive: true
      }
    });
  }

  await logActivity({
    entityType: 'client',
    entityId: updated.id,
    action: 'update',
    message: `Client ${updated.clientNumber} updated`,
    clientId: updated.id
  });

  res.json(updated);
});

clientsRouter.get('/:id/contact-emails', async (req, res) => {
  const items = await prisma.clientContactEmail.findMany({
    where: { clientId: req.params.id, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  });
  res.json(items);
});

clientsRouter.post('/:id/contact-emails', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    label: z.string().trim().min(1).max(80).optional(),
    isPrimary: z.boolean().optional().default(false)
  });
  const input = schema.parse(req.body);
  const normalized = input.email.trim().toLowerCase();

  const existing = await prisma.client.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ message: 'Client not found' });

  await prisma.$transaction(async tx => {
    if (input.isPrimary) {
      await tx.clientContactEmail.updateMany({
        where: { clientId: req.params.id, isPrimary: true },
        data: { isPrimary: false }
      });
    }
    await tx.clientContactEmail.upsert({
      where: {
        clientId_emailNormalized: {
          clientId: req.params.id,
          emailNormalized: normalized
        }
      },
      update: {
        email: input.email.trim(),
        label: input.label || undefined,
        isActive: true,
        ...(input.isPrimary ? { isPrimary: true } : {})
      },
      create: {
        clientId: req.params.id,
        email: input.email.trim(),
        emailNormalized: normalized,
        label: input.label || null,
        isPrimary: input.isPrimary,
        isActive: true
      }
    });
  });

  const items = await prisma.clientContactEmail.findMany({
    where: { clientId: req.params.id, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  });
  await syncClientPrimaryEmail(req.params.id);
  res.status(201).json(items);
});

clientsRouter.patch('/:id/contact-emails/:emailId', async (req, res) => {
  const schema = z.object({
    label: z.string().trim().min(1).max(80).optional(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional()
  });
  const input = schema.parse(req.body);

  const target = await prisma.clientContactEmail.findUnique({ where: { id: req.params.emailId } });
  if (!target || target.clientId !== req.params.id) return res.status(404).json({ message: 'Email contact not found' });

  await prisma.$transaction(async tx => {
    if (input.isPrimary) {
      await tx.clientContactEmail.updateMany({
        where: { clientId: req.params.id, isPrimary: true },
        data: { isPrimary: false }
      });
    }
    await tx.clientContactEmail.update({
      where: { id: req.params.emailId },
      data: {
        label: input.label ?? undefined,
        isPrimary: input.isPrimary ?? undefined,
        isActive: input.isActive ?? undefined
      }
    });
  });

  const items = await prisma.clientContactEmail.findMany({
    where: { clientId: req.params.id, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  });
  await syncClientPrimaryEmail(req.params.id);
  res.json(items);
});

clientsRouter.delete('/:id/contact-emails/:emailId', async (req, res) => {
  const target = await prisma.clientContactEmail.findUnique({ where: { id: req.params.emailId } });
  if (!target || target.clientId !== req.params.id) return res.status(404).json({ message: 'Email contact not found' });

  await prisma.clientContactEmail.update({
    where: { id: req.params.emailId },
    data: { isActive: false, isPrimary: false }
  });

  const remaining = await prisma.clientContactEmail.findMany({
    where: { clientId: req.params.id, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  });
  if (remaining.length && !remaining.some(item => item.isPrimary)) {
    await prisma.clientContactEmail.update({
      where: { id: remaining[0].id },
      data: { isPrimary: true }
    });
  }

  const items = await prisma.clientContactEmail.findMany({
    where: { clientId: req.params.id, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  });
  await syncClientPrimaryEmail(req.params.id);
  res.json(items);
});

clientsRouter.post('/:id/comments', async (req, res) => {
  const schema = z.object({ content: z.string().min(1) });
  const input = schema.parse(req.body);

  const comment = await prisma.clientComment.create({
    data: {
      clientId: req.params.id,
      content: input.content
    }
  });

  await prisma.client.update({
    where: { id: req.params.id },
    data: { lastContactAt: new Date() }
  });

  await logActivity({
    entityType: 'client_comment',
    entityId: comment.id,
    action: 'create',
    message: 'Client comment added',
    clientId: req.params.id
  });

  res.status(201).json(comment);
});

clientsRouter.post('/:id/subscriptions', async (req, res) => {
  const schema = z.object({
    frequency: z.enum(['weekly', 'monthly']),
    templateId: z.string(),
    isActive: z.boolean().default(true)
  });

  const input = schema.parse(req.body);

  const subscription = await prisma.emailCampaignSubscription.create({
    data: {
      clientId: req.params.id,
      frequency: input.frequency,
      templateId: input.templateId,
      isActive: input.isActive
    },
    include: {
      template: true
    }
  });

  await prisma.client.update({
    where: { id: req.params.id },
    data: input.frequency === 'weekly'
      ? { isWeeklySubscribed: input.isActive, weeklyTemplateId: input.templateId }
      : { isMonthlySubscribed: input.isActive, monthlyTemplateId: input.templateId }
  });

  res.status(201).json(subscription);
});

clientsRouter.post('/:id/perplexity-summary', async (req, res) => {
  try {
    const result = await generatePerplexitySummaryForClient(req.params.id);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Perplexity summary failed';
    res.status(500).json({ message });
  }
});

clientsRouter.get('/:id/perplexity-chat', async (req, res) => {
  try {
    const clientExists = await prisma.client.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    });

    if (!clientExists) return res.status(404).json({ message: 'Client not found' });
    const messages = await listPerplexityResearchMessages(req.params.id);
    res.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Perplexity chat list failed';
    res.status(500).json({ message });
  }
});

clientsRouter.post('/:id/perplexity-chat', async (req, res) => {
  const schema = z.object({
    question: z.string().min(2)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  try {
    const result = await askPerplexityFollowupForClient(req.params.id, parsed.data.question);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Perplexity follow-up failed';
    res.status(500).json({ message });
  }
});

clientsRouter.post('/:id/send-email', async (req, res) => {
  const schema = z.object({
    templateId: z.string().optional(),
    subject: z.string().min(2),
    body: z.string().min(2)
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, name: true, clientNumber: true }
  });

  if (!client) return res.status(404).json({ message: 'Client not found' });
  if (!client.email) return res.status(400).json({ message: 'Client has no email' });

  try {
    const delivery = await composeOneTime({
      clientId: client.id,
      mode: 'new_thread',
      toEmail: client.email,
      subject: input.data.subject,
      bodyHtml: input.data.body,
      templateId: input.data.templateId,
      messageType: 'manual'
    });

    await prisma.emailSendLog.create({
      data: {
        clientId: client.id,
        templateId: input.data.templateId || null,
        toEmail: client.email,
        subject: input.data.subject,
        body: input.data.body,
        status: 'SENT',
        provider: delivery.message.provider,
        providerMessageId: delivery.providerMessageId
      }
    });

    await logActivity({
      entityType: 'email',
      entityId: delivery.message.id,
      action: 'send',
      message: `Email sent to ${client.email}: ${input.data.subject}`,
      clientId: client.id
    });

    return res.json({
      ok: true,
      id: delivery.providerMessageId,
      threadId: delivery.providerThreadId ?? delivery.thread.providerThreadId ?? delivery.thread.id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mail send failed';
    await prisma.emailSendLog.create({
      data: {
        clientId: client.id,
        templateId: input.data.templateId || null,
        toEmail: client.email,
        subject: input.data.subject,
        body: input.data.body,
        status: 'FAILED',
        provider: 'gmail',
        errorMessage: message
      }
    });
    return res.status(500).json({ message });
  }
});

clientsRouter.post('/:id/offers', async (req, res) => {
  const schema = z.object({
    fileName: z.string().min(2).optional(),
    html: z.string().min(10),
    pdfBase64: z.string().min(10).optional(),
    total: z.number().min(0),
    timeline: z.string().optional(),
    currency: z.string().min(1).max(8).default('AUD'),
    items: z.array(
      z.object({
        description: z.string().min(1),
        price: z.number().min(0)
      })
    ).default([])
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    select: { id: true, clientNumber: true, name: true }
  });

  if (!client) return res.status(404).json({ message: 'Client not found' });

  const safeLabel = (input.data.fileName ?? `${client.clientNumber}-offer`).replace(/[^a-zA-Z0-9-_]+/g, '-');
  const hasPdf = Boolean(input.data.pdfBase64);
  let fileBuffer: Buffer;
  let originalName: string;
  let mimeType: string;

  if (hasPdf) {
    const rawPdf = input.data.pdfBase64!.trim();
    const cleanBase64 = rawPdf.startsWith('data:')
      ? rawPdf.slice(rawPdf.indexOf(',') + 1)
      : rawPdf;
    fileBuffer = Buffer.from(cleanBase64, 'base64');
    if (!fileBuffer.byteLength) return res.status(400).json({ message: 'Invalid PDF payload' });
    originalName = safeLabel.endsWith('.pdf') ? safeLabel : `${safeLabel}.pdf`;
    mimeType = 'application/pdf';
  } else {
    fileBuffer = Buffer.from(input.data.html, 'utf-8');
    originalName = safeLabel.endsWith('.html') ? safeLabel : `${safeLabel}.html`;
    mimeType = 'text/html';
  }

  const storedName = `${Date.now()}-${client.id}-${originalName}`;
  const filePath = path.resolve(uploadDir, storedName);
  fs.writeFileSync(filePath, fileBuffer);

  const file = await prisma.clientFile.create({
    data: {
      clientId: client.id,
      originalName,
      storedName,
      mimeType,
      fileSize: fileBuffer.byteLength,
      kind: 'OFFER',
      sourceHtml: input.data.html
    }
  });

  await logActivity({
    entityType: 'client_file',
    entityId: file.id,
    action: 'create',
    message: `Offer ${file.originalName} created (${input.data.total} ${input.data.currency})`,
    clientId: client.id
  });

  res.status(201).json(file);
});

clientsRouter.post('/:id/files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File is required' });
  const client = await prisma.client.findUnique({ where: { id: idParam(req.params.id) } });
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const created = await prisma.clientFile.create({
    data: {
      clientId: client.id,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      kind: 'UPLOAD'
    }
  });

  await logActivity({
    entityType: 'client_file',
    entityId: created.id,
    action: 'create',
    message: `File uploaded: ${created.originalName}`,
    clientId: client.id
  });

  res.status(201).json(created);
});

clientsRouter.delete('/:id/files/:fileId', async (req, res) => {
  const file = await prisma.clientFile.findUnique({ where: { id: req.params.fileId } });
  if (!file || file.clientId !== req.params.id) return res.status(404).json({ message: 'File not found' });

  const filePath = path.resolve(uploadDir, file.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await prisma.clientFile.delete({ where: { id: file.id } });

  await logActivity({
    entityType: 'client_file',
    entityId: file.id,
    action: 'delete',
    message: `Client file ${file.originalName} deleted`,
    clientId: req.params.id
  });

  res.status(204).send();
});

clientsRouter.delete('/:id', async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    include: {
      projects: {
        include: {
          files: true
        }
      },
      files: true
    }
  });

  if (!client) return res.status(404).json({ message: 'Client not found' });

  for (const project of client.projects) {
    for (const file of project.files) {
      const filePath = path.resolve(uploadDir, file.storedName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  for (const file of client.files) {
    const filePath = path.resolve(uploadDir, file.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await logActivity({
    entityType: 'client',
    entityId: client.id,
    action: 'delete',
    message: `Client ${client.clientNumber} deleted`,
    clientId: client.id
  });

  await prisma.client.delete({ where: { id: client.id } });
  res.json({ ok: true });
});
