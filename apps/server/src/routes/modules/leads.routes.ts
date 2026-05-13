import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { intakeLead } from '../../services/leads.service.js';
import { generatePerplexitySummaryForClient } from '../../services/perplexity.service.js';
import { z } from 'zod';

export const leadsRouter = Router();
export const leadsPublicRouter = Router();

leadsRouter.get('/', async (_req, res) => {
  res.json(await prisma.lead.findMany({
    include: { client: true },
    orderBy: { createdAt: 'desc' }
  }));
});

leadsRouter.post('/intake', async (req, res) => {
  const requestId = createWebhookRequestId();
  console.info('[leads:intake] request received', {
    requestId,
    contentType: req.headers['content-type'] || null,
    userAgent: req.headers['user-agent'] || null,
    keys: Object.keys((req.body || {}) as Record<string, unknown>)
  });

  const schema = z.object({
    source: z.string().default('website'),
    name: z.string().min(2),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    company: z.string().optional(),
    message: z.string().optional(),
    createClient: z.boolean().default(true)
  });

  const parsed = schema.safeParse(req.body);
  if (parsed.success) {
    const input = parsed.data;
    const intake = await intakeLead({
      ...input,
      email: input.email || undefined
    });
    console.info('[leads:intake] created', {
      requestId,
      leadId: intake.lead.id,
      clientId: intake.client?.id ?? null,
      createdClient: intake.createdClient
    });
    return res.status(201).json(intake);
  }

  try {
    const payload = extractLeadPayload(req.body as Record<string, unknown>);
    const intake = await createLeadFromWebhookPayload(payload, 'Website Intake');
    console.info('[leads:intake] fallback webhook created', {
      requestId,
      leadId: intake.lead.id,
      clientId: intake.client?.id ?? null,
      createdClient: intake.createdClient,
      payloadKeys: Object.keys(payload)
    });
    return res.status(200).json({
      ok: true,
      source: 'webhook-fallback',
      leadId: intake.lead.id,
      clientId: intake.client?.id ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed';
    console.error('[leads:intake] failed', {
      requestId,
      message,
      bodyPreview: summarizeBody(req.body as Record<string, unknown>)
    });
    return res.status(400).json({ message });
  }
});

leadsPublicRouter.get('/tilda', (req, res) => {
  if (typeof req.query.test === 'string') {
    return res.status(200).send(req.query.test);
  }
  res.status(200).json({ ok: true });
});

leadsPublicRouter.post('/tilda', async (req, res) => {
  const requestId = createWebhookRequestId();
  try {
    const rawBody = (req.body || {}) as Record<string, unknown>;
    const body = extractLeadPayload(rawBody);
    console.info('[leads:tilda] request received', {
      requestId,
      contentType: req.headers['content-type'] || null,
      userAgent: req.headers['user-agent'] || null,
      rawKeys: Object.keys(rawBody),
      payloadKeys: Object.keys(body),
      bodyPreview: summarizeBody(body)
    });

    if (typeof body.test === 'string' && body.test.trim()) {
      console.info('[leads:tilda] test handshake', { requestId, test: body.test.trim() });
      return res.status(200).send(body.test.trim());
    }
    const intake = await createLeadFromWebhookPayload(body, 'Tilda Site');
    console.info('[leads:tilda] created', {
      requestId,
      leadId: intake.lead.id,
      clientId: intake.client?.id ?? null,
      createdClient: intake.createdClient
    });

    res.status(200).json({
      ok: true,
      leadId: intake.lead.id,
      clientId: intake.client?.id ?? null
    });

    if (intake.client?.id && intake.createdClient) {
      void generatePerplexitySummaryForClient(intake.client.id).catch(error => {
        console.error('Perplexity auto-summary failed', error);
      });
    }
  } catch (error) {
    console.error('[leads:tilda] processing failed', {
      requestId,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : null,
      bodyPreview: summarizeBody((req.body || {}) as Record<string, unknown>)
    });
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

function normalizeFormKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findFormValue(body: Record<string, unknown>, keys: string[]) {
  const normalizedKeys = new Set(keys.map(normalizeFormKey));
  for (const [rawKey, rawValue] of Object.entries(body)) {
    if (!normalizedKeys.has(normalizeFormKey(rawKey))) continue;
    if (typeof rawValue === 'string' && rawValue.trim()) return rawValue.trim();
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') return String(rawValue);
  }
  return undefined;
}

function normalizeEmail(value?: string) {
  if (!value) return undefined;
  const email = value.trim().toLowerCase();
  if (!email) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function resolveLeadName(input: {
  explicitName?: string;
  company?: string;
  email?: string;
  phone?: string;
}) {
  if (input.explicitName && input.explicitName.trim().length >= 2) return input.explicitName.trim();
  if (input.company && input.company.trim().length >= 2) return input.company.trim();
  if (input.email) return input.email.split('@')[0].slice(0, 80);
  if (input.phone) return `Lead ${input.phone.replace(/\s+/g, '')}`;
  return 'Website lead';
}

function extractLeadPayload(body: Record<string, unknown>) {
  const payloadKeys = ['payload', 'data', 'formData', 'submission'];
  for (const key of payloadKeys) {
    const value = body[key];
    if (!value) continue;

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // keep original body when the field is not JSON
      }
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return body;
}

async function createLeadFromWebhookPayload(body: Record<string, unknown>, source: string) {
  const from = (keys: string[]) => findFormValue(body, keys);

  const emailRaw = from(['Email', 'email', 'E-mail', 'mail', 'email_address']);
  const phone = from(['Phone', 'phone', 'tel', 'telephone', 'mobile', 'phone_number']);
  const company = from(['Company', 'company', 'business', 'organisation', 'organization']);
  const explicitName = from(['Name', 'name', 'Full Name', 'full_name', 'fullname', 'contact_name']);
  const safeEmail = normalizeEmail(emailRaw);
  const name = resolveLeadName({
    explicitName,
    company,
    email: safeEmail,
    phone
  });

  const details = Object.entries(body)
    .map(([key, value]) => {
      if (typeof value === 'string' && value.trim()) return `${key}: ${value.trim()}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${String(value)}`;
      return null;
    })
    .filter(Boolean);

  return intakeLead({
    source,
    name,
    email: safeEmail,
    phone,
    company,
    message: details.join('\n'),
    additionalNotes: details.join('\n'),
    createClient: true,
    dedupeByContact: true
  });
}

function createWebhookRequestId() {
  return `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeBody(body: Record<string, unknown>) {
  const pairs = Object.entries(body)
    .slice(0, 30)
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}=${truncate(value, 140)}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `${key}=${String(value)}`;
      if (value && typeof value === 'object') return `${key}=[object]`;
      return `${key}=${String(value)}`;
    });
  return pairs.join('; ');
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
