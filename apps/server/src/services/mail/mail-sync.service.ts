import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { GmailProvider } from './providers/gmail.provider.js';
import type { MailProvider } from './providers/mail-provider.js';
import { ingestInboundMessages } from './mail-inbound.service.js';
import { listActiveClientEmails, normalizeClientEmail } from './client-email.service.js';

let syncTimer: NodeJS.Timeout | null = null;
let syncInProgress = false;

export function startMailSyncWorker() {
  if (!env.MAIL_SYNC_ENABLED) {
    console.log('[mail-sync] disabled');
    return;
  }

  if (syncTimer) return;

  const intervalMs = Math.max(20_000, env.MAIL_SYNC_INTERVAL_MS);
  console.log(`[mail-sync] worker started (interval=${intervalMs}ms)`);

  syncTimer = setInterval(async () => {
    await runSyncSafely('interval');
  }, intervalMs);
}

export function stopMailSyncWorker() {
  if (!syncTimer) return;
  clearInterval(syncTimer);
  syncTimer = null;
}

export async function triggerManualMailSync() {
  return runSyncSafely('manual');
}

export async function triggerClientMailSync(clientId: string) {
  const providerName = resolveProviderName();
  const mailboxEmail = normalizeMailboxAddress(env.MAIL_FROM);
  if (!mailboxEmail) {
    throw new Error('MAIL_FROM is required for client sync');
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, name: true }
  });
  if (!client) throw new Error('Client not found');

  const activeEmails = await listActiveClientEmails(client.id);
  const syncEmails = [
    ...new Set(
      [
        ...activeEmails.map(item => item.emailNormalized),
        normalizeClientEmail(client.email)
      ].filter((item): item is string => Boolean(item))
    )
  ];

  if (!syncEmails.length) {
    throw new Error('Client email is required to sync full conversation history');
  }

  const provider = resolveProvider(providerName);
  const state = await prisma.emailSyncState.upsert({
    where: {
      provider_mailboxEmail: {
        provider: providerName,
        mailboxEmail: clientSyncStateKey(mailboxEmail, client.id)
      }
    },
    update: {},
    create: {
      provider: providerName,
      mailboxEmail: clientSyncStateKey(mailboxEmail, client.id)
    }
  });

  const syncEmailsSignature = syncEmails.slice().sort().join('|');
  const hasEmailSetChanged = (state.lastDeltaToken || '') !== syncEmailsSignature;
  const sinceForClientSync = hasEmailSetChanged ? null : state.lastSyncAt;
  const query = buildClientConversationQuery(syncEmails, sinceForClientSync);
  const fetched = await provider.fetchInbound({
    query,
    since: sinceForClientSync,
    lastHistoryId: state.lastHistoryId,
    maxResults: sinceForClientSync ? 60 : 100,
    maxPages: sinceForClientSync ? 1 : 4
  });

  const summary = await ingestInboundMessages(fetched.messages);
  const maxHistoryId = fetched.lastHistoryId ?? state.lastHistoryId;
  const syncedAt = fetched.fetchedAt ?? new Date();

  await prisma.emailSyncState.update({
    where: { id: state.id },
    data: {
      lastSyncAt: syncedAt,
      lastHistoryId: maxHistoryId,
      lastDeltaToken: syncEmailsSignature
    }
  });

  return {
    provider: providerName,
    mailboxEmail,
    clientId: client.id,
    clientEmail: syncEmails.join(', '),
    fetched: fetched.messages.length,
    ...summary,
    syncedAt,
    lastHistoryId: maxHistoryId
  };
}

export async function getMailSyncStatus() {
  const provider = resolveProviderName();
  const mailboxEmail = env.MAIL_FROM.trim().toLowerCase();
  const state = mailboxEmail
    ? await prisma.emailSyncState.findUnique({
        where: {
          provider_mailboxEmail: {
            provider,
            mailboxEmail
          }
        }
      })
    : null;

  return {
    enabled: env.MAIL_SYNC_ENABLED,
    intervalMs: env.MAIL_SYNC_INTERVAL_MS,
    inProgress: syncInProgress,
    provider,
    mailboxEmail,
    state
  };
}

async function runSyncSafely(source: 'manual' | 'interval' | 'webhook') {
  if (syncInProgress) {
    return {
      source,
      skipped: true,
      reason: 'sync already in progress'
    };
  }

  syncInProgress = true;
  try {
    return await syncMailbox(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[mail-sync] failed', message);
    return {
      source,
      skipped: false,
      error: message
    };
  } finally {
    syncInProgress = false;
  }
}

async function syncMailbox(source: 'manual' | 'interval' | 'webhook') {
  const providerName = resolveProviderName();
  const mailboxEmail = env.MAIL_FROM.trim().toLowerCase();
  if (!mailboxEmail) {
    throw new Error('MAIL_FROM is required for inbound sync');
  }

  const provider = resolveProvider(providerName);

  const currentState = await prisma.emailSyncState.upsert({
    where: {
      provider_mailboxEmail: {
        provider: providerName,
        mailboxEmail
      }
    },
    update: {},
    create: {
      provider: providerName,
      mailboxEmail
    }
  });

  const fetched = await provider.fetchInbound({
    since: currentState.lastSyncAt,
    lastHistoryId: currentState.lastHistoryId,
    maxResults: 50
  });

  const summary = await ingestInboundMessages(fetched.messages);

  const maxHistoryId = fetched.lastHistoryId ?? currentState.lastHistoryId;
  const now = fetched.fetchedAt ?? new Date();
  await prisma.emailSyncState.update({
    where: { id: currentState.id },
    data: {
      lastSyncAt: now,
      lastHistoryId: maxHistoryId
    }
  });

  return {
    source,
    skipped: false,
    provider: providerName,
    mailboxEmail,
    fetched: fetched.messages.length,
    ...summary,
    lastHistoryId: maxHistoryId,
    syncedAt: now
  };
}

function resolveProviderName() {
  const configured = (env.MAIL_PROVIDER || 'gmail').trim().toLowerCase();
  return configured || 'gmail';
}

function resolveProvider(providerName: string): MailProvider {
  if (providerName === 'gmail') return new GmailProvider();
  throw new Error(`Unsupported provider for sync: ${providerName}`);
}

function clientSyncStateKey(mailboxEmail: string, clientId: string) {
  return `${mailboxEmail}::client:${clientId}`;
}

function normalizeMailboxAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  const email = (match?.[1] || value).trim().toLowerCase().replace(/["']/g, '');
  return email || '';
}

function buildClientConversationQuery(clientEmails: string[], since: Date | null) {
  const perEmail = clientEmails.map(email => {
    const addr = quoteForGmailQuery(email);
    return `(from:${addr} OR to:${addr} OR cc:${addr} OR bcc:${addr})`;
  });
  const parts = [`(${perEmail.join(' OR ')})`];
  if (since) {
    const sinceTs = Math.floor((since.getTime() - 120_000) / 1000);
    parts.push(`after:${sinceTs}`);
  }
  return parts.join(' ');
}

function quoteForGmailQuery(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
