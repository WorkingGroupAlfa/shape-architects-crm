import { prisma } from '../../lib/prisma.js';

type IncomingMatchInput = {
  provider: string;
  providerThreadId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  subject?: string | null;
};

export type IncomingMatchResult =
  | { kind: 'thread'; threadId: string; clientId: string; reason: string }
  | { kind: 'client'; clientId: string; reason: string }
  | { kind: 'unassigned'; reason: string };

export async function matchIncomingMessage(input: IncomingMatchInput): Promise<IncomingMatchResult> {
  const byProviderThread = await matchByProviderThread(input);
  if (byProviderThread) return byProviderThread;

  const byReferences = await matchByReferences(input);
  if (byReferences) return byReferences;

  const byEmail = await matchByClientEmail(input);
  if (byEmail) return byEmail;

  return { kind: 'unassigned', reason: 'No deterministic match' };
}

async function matchByProviderThread(input: IncomingMatchInput) {
  if (!input.providerThreadId) return null;

  const threads = await prisma.emailThread.findMany({
    where: {
      provider: input.provider,
      providerThreadId: input.providerThreadId
    },
    select: { id: true, clientId: true }
  });

  if (threads.length === 1) {
    return {
      kind: 'thread' as const,
      threadId: threads[0].id,
      clientId: threads[0].clientId,
      reason: 'providerThreadId'
    };
  }

  if (threads.length > 1) {
    return { kind: 'unassigned' as const, reason: 'Ambiguous providerThreadId match' };
  }

  return null;
}

async function matchByReferences(input: IncomingMatchInput) {
  const refs = parseReferences(input.referencesHeader, input.inReplyTo);
  if (!refs.length) return null;

  const messages = await prisma.emailMessage.findMany({
    where: {
      provider: input.provider,
      providerMessageId: { in: refs }
    },
    select: { threadId: true, clientId: true }
  });

  if (!messages.length) return null;

  const uniqueThreadIds = [...new Set(messages.map(item => item.threadId))];
  if (uniqueThreadIds.length > 1) {
    return { kind: 'unassigned' as const, reason: 'Ambiguous references match' };
  }

  return {
    kind: 'thread' as const,
    threadId: uniqueThreadIds[0],
    clientId: messages[0].clientId,
    reason: 'references/inReplyTo'
  };
}

async function matchByClientEmail(input: IncomingMatchInput) {
  const addresses = new Set<string>();
  const from = normalizeEmail(input.fromEmail);
  const to = normalizeEmail(input.toEmail);
  if (from) addresses.add(from);
  if (to) addresses.add(to);
  for (const ccEmail of input.cc ?? []) {
    const normalized = normalizeEmail(ccEmail);
    if (normalized) addresses.add(normalized);
  }
  for (const bccEmail of input.bcc ?? []) {
    const normalized = normalizeEmail(bccEmail);
    if (normalized) addresses.add(normalized);
  }

  if (!addresses.size) return null;

  const contactEmails = await prisma.clientContactEmail.findMany({
    where: {
      isActive: true,
      emailNormalized: { in: [...addresses] }
    },
    select: { clientId: true }
  });

  let uniqueClientIds: string[] = [...new Set(contactEmails.map(item => item.clientId as string))];
  if (!uniqueClientIds.length) {
    const clients = await prisma.client.findMany({
      where: { email: { in: [...addresses] } },
      select: { id: true }
    });
    uniqueClientIds = [...new Set(clients.map(item => item.id as string))];
  }
  if (!uniqueClientIds.length) return null;
  if (uniqueClientIds.length > 1) {
    return { kind: 'unassigned' as const, reason: 'Ambiguous client email match' };
  }

  return {
    kind: 'client' as const,
    clientId: uniqueClientIds[0],
    reason: 'contact email'
  };
}

function parseReferences(referencesHeader?: string | null, inReplyTo?: string | null) {
  const values = [referencesHeader, inReplyTo]
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap(value => value.split(/\s+/g));

  const cleaned = values
    .map(value => value.replace(/[<>]/g, '').trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

function normalizeEmail(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}
