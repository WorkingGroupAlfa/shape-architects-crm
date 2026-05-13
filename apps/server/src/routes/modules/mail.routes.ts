import { Router } from 'express';
import { z } from 'zod';
import { listClientThreads, listThreadMessages } from '../../services/mail/mail-thread.service.js';
import { composeOneTime, composeReply } from '../../services/mail/mail-compose.service.js';
import { prisma } from '../../lib/prisma.js';
import { calculateNextRunAt } from '../../services/mail/campaign-schedule.util.js';
import { runCampaignSubscription, runDueCampaignSubscriptions } from '../../services/mail/campaign-execution.service.js';
import { getMailSyncStatus, triggerClientMailSync, triggerManualMailSync } from '../../services/mail/mail-sync.service.js';
import { linkUnassignedEmail } from '../../services/mail/mail-inbound.service.js';
import { refineMailDraft } from '../../services/mail/mail-refine.service.js';

export const mailRouter = Router();
const campaignFrequencySchema = z.enum(['weekly', 'monthly']);
const draftRefineRateLimit = new Map<string, { count: number; resetAt: number }>();

mailRouter.get('/clients/:clientId/threads', async (req, res) => {
  const schema = z.object({
    search: z.string().optional(),
    filter: z.enum(['all', 'unread', 'campaign', 'manual']).optional(),
    contactEmail: z.string().email().optional()
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const threads = await listClientThreads({
    clientId: req.params.clientId,
    search: parsed.data.search,
    filter: parsed.data.filter,
    contactEmail: parsed.data.contactEmail
  });

  res.json(threads);
});

mailRouter.get('/threads/:threadId/messages', async (req, res) => {
  const messages = await listThreadMessages(req.params.threadId);
  res.json(messages);
});

mailRouter.post('/threads/:threadId/mark-read', async (req, res) => {
  const thread = await prisma.emailThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread) return res.status(404).json({ message: 'Thread not found' });

  await prisma.$transaction([
    prisma.emailMessage.updateMany({
      where: { threadId: thread.id, isRead: false },
      data: { isRead: true }
    }),
    prisma.emailThread.update({
      where: { id: thread.id },
      data: { unreadCount: 0 }
    })
  ]);

  res.json({ ok: true });
});

mailRouter.post('/compose/one-time', async (req, res) => {
  const schema = z.object({
    clientId: z.string(),
    mode: z.enum(['new_thread', 'reply_thread']),
    threadId: z.string().optional(),
    toEmail: z.string().email().optional(),
    subject: z.string().min(1),
    bodyHtml: z.string().min(1),
    templateId: z.string().optional(),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    projectId: z.string().optional(),
    invoiceId: z.string().optional(),
    messageType: z.string().optional(),
    attachments: z
      .array(
        z.object({
          clientFileId: z.string().optional(),
          invoiceId: z.string().optional(),
          projectFileId: z.string().optional(),
          fileName: z.string().min(1),
          mimeType: z.string().min(1),
          fileSize: z.number().int().nonnegative(),
          storagePath: z.string().min(1),
          providerAttachmentId: z.string().optional(),
          contentBase64: z.string().min(1).optional()
        })
      )
      .optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  try {
    const result = await composeOneTime(parsed.data);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compose failed';
    res.status(400).json({ message });
  }
});

mailRouter.post('/threads/:threadId/reply', async (req, res) => {
  const schema = z.object({
    subject: z.string().optional(),
    bodyHtml: z.string().min(1),
    templateId: z.string().optional(),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    projectId: z.string().optional(),
    invoiceId: z.string().optional(),
    attachments: z
      .array(
        z.object({
          clientFileId: z.string().optional(),
          invoiceId: z.string().optional(),
          projectFileId: z.string().optional(),
          fileName: z.string().min(1),
          mimeType: z.string().min(1),
          fileSize: z.number().int().nonnegative(),
          storagePath: z.string().min(1),
          providerAttachmentId: z.string().optional(),
          contentBase64: z.string().min(1).optional()
        })
      )
      .optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  try {
    const result = await composeReply({
      threadId: req.params.threadId,
      ...parsed.data
    });
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reply failed';
    res.status(400).json({ message });
  }
});

mailRouter.post('/refine-draft', async (req, res) => {
  const schema = z.object({
    draft: z.string().trim().min(2).max(12000),
    tone: z.enum(['professional', 'friendly', 'concise']).default('professional'),
    mode: z.enum(['keep_meaning', 'fix_grammar_only']).default('keep_meaning'),
    threadContext: z
      .object({
        subject: z.string().max(300).optional(),
        lastMessageSnippet: z.string().max(2000).optional()
      })
      .optional(),
    clientContext: z
      .object({
        name: z.string().max(200).optional(),
        email: z.string().email().optional(),
        company: z.string().max(200).optional()
      })
      .optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const limiterKey = req.ip || 'unknown';
  if (!consumeDraftRefineQuota(limiterKey)) {
    return res.status(429).json({ message: 'Too many refine requests. Please wait a minute and try again.' });
  }

  try {
    const result = await refineMailDraft(parsed.data);
    res.json(result);
  } catch (error) {
    console.error('[mail-refine] refine failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
      draftLength: parsed.data.draft.length
    });
    const message = error instanceof Error && /not configured/i.test(error.message) ? error.message : 'Failed to refine draft';
    const status = /not configured/i.test(message) ? 503 : 400;
    res.status(status).json({ message });
  }
});

mailRouter.get('/clients/:clientId/campaigns', async (req, res) => {
  const campaigns = await prisma.emailCampaignSubscription.findMany({
    where: { clientId: req.params.clientId },
    include: { template: true },
    orderBy: { createdAt: 'asc' }
  });

  res.json(campaigns);
});

mailRouter.put('/clients/:clientId/campaigns/:frequency', async (req, res) => {
  const frequencyParsed = campaignFrequencySchema.safeParse(req.params.frequency);
  if (!frequencyParsed.success) {
    return res.status(400).json({ message: 'Invalid frequency. Use weekly or monthly.' });
  }

  const schema = z.object({
    templateId: z.string(),
    isActive: z.boolean(),
    sendDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    sendDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    sendTime: z.string().min(1).nullable().optional(),
    timezone: z.string().min(1).nullable().optional(),
    threadStrategy: z.enum(['new_each_run', 'continue_last_thread']).default('new_each_run'),
    nextRunAt: z.string().datetime().nullable().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const clientId = req.params.clientId;
  const frequency = frequencyParsed.data;
  const payload = parsed.data;

  const existing = await prisma.emailCampaignSubscription.findFirst({
    where: { clientId, frequency }
  });

  const nextRunAt = payload.nextRunAt ? new Date(payload.nextRunAt) : null;
  const computedNextRunAt = nextRunAt ?? calculateNextRunAt({
    frequency,
    sendDayOfWeek: payload.sendDayOfWeek ?? null,
    sendDayOfMonth: payload.sendDayOfMonth ?? null,
    sendTime: payload.sendTime ?? null,
    timezone: payload.timezone ?? null
  });

  const subscription = existing
    ? await prisma.emailCampaignSubscription.update({
        where: { id: existing.id },
        data: {
          templateId: payload.templateId,
          isActive: payload.isActive,
          sendDayOfWeek: payload.sendDayOfWeek ?? null,
          sendDayOfMonth: payload.sendDayOfMonth ?? null,
          sendTime: payload.sendTime ?? null,
          timezone: payload.timezone ?? null,
          threadStrategy: payload.threadStrategy,
          nextRunAt: computedNextRunAt,
          lastErrorAt: null,
          lastErrorText: null
        },
        include: { template: true }
      })
    : await prisma.emailCampaignSubscription.create({
        data: {
          clientId,
          frequency,
          templateId: payload.templateId,
          isActive: payload.isActive,
          sendDayOfWeek: payload.sendDayOfWeek ?? null,
          sendDayOfMonth: payload.sendDayOfMonth ?? null,
          sendTime: payload.sendTime ?? null,
          timezone: payload.timezone ?? null,
          threadStrategy: payload.threadStrategy,
          nextRunAt: computedNextRunAt
        },
        include: { template: true }
      });

  res.json(subscription);
});

mailRouter.get('/clients/:clientId/campaign-runs', async (req, res) => {
  const runs = await prisma.emailCampaignRun.findMany({
    where: { clientId: req.params.clientId },
    include: {
      subscription: {
        select: {
          id: true,
          frequency: true
        }
      },
      thread: {
        select: {
          id: true,
          subject: true
        }
      }
    },
    orderBy: { triggeredAt: 'desc' },
    take: 100
  });

  res.json(runs);
});

mailRouter.get('/clients/:clientId/unread-count', async (req, res) => {
  const aggregate = await prisma.emailThread.aggregate({
    where: { clientId: req.params.clientId },
    _sum: { unreadCount: true }
  });

  res.json({ unreadCount: aggregate._sum.unreadCount ?? 0 });
});

mailRouter.post('/sync/manual', async (_req, res) => {
  const result = await triggerManualMailSync();
  res.json(result);
});

mailRouter.post('/clients/:clientId/sync', async (req, res) => {
  try {
    const result = await triggerClientMailSync(req.params.clientId);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Client sync failed';
    res.status(400).json({ message });
  }
});

mailRouter.get('/sync/status', async (_req, res) => {
  const result = await getMailSyncStatus();
  res.json(result);
});

mailRouter.get('/unassigned', async (req, res) => {
  const schema = z.object({
    status: z.enum(['OPEN', 'RESOLVED']).optional().default('OPEN'),
    q: z.string().optional()
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const q = parsed.data.q?.trim();
  const items = await prisma.unassignedEmail.findMany({
    where: {
      status: parsed.data.status,
      ...(q
        ? {
            OR: [
              { subject: { contains: q } },
              { fromEmail: { contains: q } },
              { toEmail: { contains: q } },
              { bodySnippet: { contains: q } }
            ]
          }
        : {})
    },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  res.json(items);
});

mailRouter.post('/unassigned/:id/link-client', async (req, res) => {
  const schema = z.object({
    clientId: z.string(),
    threadId: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  try {
    const result = await linkUnassignedEmail({
      unassignedId: req.params.id,
      clientId: parsed.data.clientId,
      threadId: parsed.data.threadId
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unassigned link failed';
    res.status(400).json({ message });
  }
});

function consumeDraftRefineQuota(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const current = draftRefineRateLimit.get(key);
  if (!current || current.resetAt <= now) {
    draftRefineRateLimit.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

mailRouter.post('/campaigns/run-due', async (_req, res) => {
  const result = await runDueCampaignSubscriptions();
  res.json(result);
});

mailRouter.post('/campaigns/:subscriptionId/run-now', async (req, res) => {
  const result = await runCampaignSubscription(req.params.subscriptionId, { dueOnly: false });
  res.json(result);
});

mailRouter.post('/webhooks/gmail', async (_req, res) => {
  const result = await triggerManualMailSync();
  res.status(202).json({ ok: true, mode: 'polling-fallback', result });
});

mailRouter.post('/webhooks/graph', async (_req, res) => {
  res.status(202).json({ ok: true, mode: 'not-implemented-yet' });
});
