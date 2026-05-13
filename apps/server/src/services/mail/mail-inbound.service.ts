import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { createEmailThread } from './mail-thread.service.js';
import { matchIncomingMessage } from './mail-matching.service.js';
import type { MailInboundMessage } from './providers/mail-provider.js';
import { listActiveClientEmails, normalizeClientEmail } from './client-email.service.js';

type IngestResult = {
  imported: number;
  duplicates: number;
  assigned: number;
  unassigned: number;
};

export async function ingestInboundMessages(messages: MailInboundMessage[]) {
  const mailboxEmail = normalizeEmail(env.MAIL_FROM);
  const summary: IngestResult = {
    imported: 0,
    duplicates: 0,
    assigned: 0,
    unassigned: 0
  };

  for (const message of messages) {
    if (!message.providerMessageId) continue;

    const existing = await prisma.emailMessage.findUnique({
      where: {
        provider_providerMessageId: {
          provider: message.provider,
          providerMessageId: message.providerMessageId
        }
      },
      select: { id: true }
    });

    if (existing) {
      summary.duplicates += 1;
      continue;
    }

    const match = await matchIncomingMessage({
      provider: message.provider,
      providerThreadId: message.providerThreadId,
      inReplyTo: message.inReplyTo,
      referencesHeader: message.referencesHeader,
      fromEmail: message.fromEmail,
      toEmail: message.toEmail,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject
    });

    if (match.kind === 'unassigned') {
      await persistUnassigned(message, match.reason);
      summary.unassigned += 1;
      continue;
    }

    const thread = match.kind === 'thread'
      ? await prisma.emailThread.findUnique({ where: { id: match.threadId } })
      : await resolveThreadByClient(match.clientId, message);

    if (!thread) {
      await persistUnassigned(message, 'Thread resolution failed');
      summary.unassigned += 1;
      continue;
    }

    const direction = resolveDirection(message, mailboxEmail);
    await persistMessageForThread({
      threadId: thread.id,
      clientId: thread.clientId,
      message,
      direction
    });

    summary.imported += 1;
    summary.assigned += 1;
  }

  return summary;
}

export async function linkUnassignedEmail(input: {
  unassignedId: string;
  clientId: string;
  threadId?: string;
}) {
  const record = await prisma.unassignedEmail.findUnique({ where: { id: input.unassignedId } });
  if (!record) throw new Error('Unassigned email not found');

  if (record.status === 'RESOLVED') {
    return {
      status: 'already_resolved',
      threadId: record.linkedThreadId,
      clientId: record.linkedClientId
    };
  }

  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new Error('Client not found');

  let threadId = input.threadId;
  if (threadId) {
    const thread = await prisma.emailThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new Error('Thread not found');
    if (thread.clientId !== client.id) throw new Error('Thread does not belong to selected client');
  } else {
    const activeEmails = await listActiveClientEmails(client.id);
    const contactEmail = resolveContactEmailForClient(
      {
        fromEmail: record.fromEmail,
        toEmail: record.toEmail,
        cc: parseStoredAddressList(record.cc)
      },
      activeEmails.map(item => item.emailNormalized)
    );
    const matchedContact = contactEmail
      ? activeEmails.find(item => item.emailNormalized === contactEmail) ?? null
      : null;
    const newThread = await createEmailThread({
      clientId: client.id,
      subject: record.subject,
      provider: record.provider,
      providerThreadId: record.providerThreadId,
      threadType: 'manual',
      contactEmailId: matchedContact?.id ?? null,
      contactEmail
    });
    threadId = newThread.id;
  }

  const existing = record.providerMessageId
    ? await prisma.emailMessage.findUnique({
        where: {
          provider_providerMessageId: {
            provider: record.provider,
            providerMessageId: record.providerMessageId
          }
        }
      })
    : null;

  const createdNewMessage = !existing;
  const message = existing
    ? existing
    : await prisma.emailMessage.create({
        data: {
          threadId,
          clientId: client.id,
          provider: record.provider,
          providerMessageId: record.providerMessageId,
          providerThreadId: record.providerThreadId,
          direction: 'incoming',
          messageType: 'manual',
          fromEmail: record.fromEmail,
          toEmail: record.toEmail,
          cc: record.cc,
          bcc: record.bcc,
          subject: record.subject,
          bodyHtml: record.bodyHtml,
          bodyText: record.bodyText,
          bodySnippet: record.bodySnippet,
          inReplyTo: record.inReplyTo,
          referencesHeader: record.referencesHeader,
          isRead: false,
          sentAt: null,
          receivedAt: record.receivedAt ?? new Date()
        }
      });

  const parsedAttachments = parseAttachments(record.attachmentsJson);
  if (parsedAttachments.length) {
    await prisma.emailAttachment.createMany({
      data: parsedAttachments.map(item => ({
        messageId: message.id,
        invoiceId: null,
        projectFileId: null,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        storagePath: item.storagePath,
        providerAttachmentId: item.providerAttachmentId ?? null
      }))
    });
  }

  await prisma.$transaction([
    prisma.emailThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: message.receivedAt ?? message.createdAt,
        ...(createdNewMessage ? { unreadCount: { increment: 1 } } : {})
      }
    }),
    prisma.unassignedEmail.update({
      where: { id: record.id },
      data: {
        status: 'RESOLVED',
        linkedClientId: client.id,
        linkedThreadId: threadId,
        resolvedAt: new Date(),
        reason: null
      }
    })
  ]);

  return {
    status: 'linked',
    threadId,
    clientId: client.id
  };
}

async function resolveThreadByClient(clientId: string, message: MailInboundMessage) {
  const activeEmails = await listActiveClientEmails(clientId);
  const contactEmail = resolveContactEmailForClient(
    {
      fromEmail: message.fromEmail,
      toEmail: message.toEmail,
      cc: message.cc
    },
    activeEmails.map(item => item.emailNormalized)
  );
  const matchedContact = contactEmail
    ? activeEmails.find(item => item.emailNormalized === contactEmail) ?? null
    : null;
  const normalizedSubject = normalizeSubject(message.subject);
  const existingBySubject = await prisma.emailThread.findFirst({
    where: {
      clientId,
      subjectNormalized: normalizedSubject,
      ...(contactEmail ? { contactEmail } : {})
    },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }]
  });

  if (existingBySubject) return existingBySubject;

  return createEmailThread({
    clientId,
    subject: message.subject,
    provider: message.provider,
    providerThreadId: message.providerThreadId,
    threadType: 'manual',
    contactEmailId: matchedContact?.id ?? null,
    contactEmail
  });
}

function resolveContactEmailForClient(
  message: { fromEmail?: string | null; toEmail?: string | null; cc?: string[] | null },
  clientEmails: string[]
) {
  const normalizedClientEmails = new Set(clientEmails.map(item => item.trim().toLowerCase()));
  const toEmail = normalizeClientEmail(message.toEmail);
  const fromEmail = normalizeClientEmail(message.fromEmail);
  if (toEmail && normalizedClientEmails.has(toEmail)) return toEmail;
  if (fromEmail && normalizedClientEmails.has(fromEmail)) return fromEmail;
  for (const cc of message.cc ?? []) {
    const normalized = normalizeClientEmail(cc);
    if (normalized && normalizedClientEmails.has(normalized)) return normalized;
  }
  return null;
}

async function persistMessageForThread(input: {
  threadId: string;
  clientId: string;
  message: MailInboundMessage;
  direction: 'incoming' | 'outgoing';
}) {
  const receivedAt = input.message.receivedAt || new Date();
  const isIncoming = input.direction === 'incoming';

  const message = await prisma.emailMessage.create({
    data: {
      threadId: input.threadId,
      clientId: input.clientId,
      provider: input.message.provider,
      providerMessageId: input.message.providerMessageId,
      providerThreadId: input.message.providerThreadId ?? null,
      direction: input.direction,
      messageType: 'manual',
      fromEmail: input.message.fromEmail,
      toEmail: input.message.toEmail,
      cc: input.message.cc?.length ? JSON.stringify(input.message.cc) : null,
      bcc: input.message.bcc?.length ? JSON.stringify(input.message.bcc) : null,
      subject: input.message.subject,
      bodyHtml: input.message.bodyHtml,
      bodyText: input.message.bodyText ?? null,
      bodySnippet: input.message.bodySnippet ?? null,
      inReplyTo: input.message.inReplyTo ?? null,
      referencesHeader: input.message.referencesHeader ?? null,
      isRead: isIncoming ? false : true,
      sentAt: isIncoming ? null : receivedAt,
      receivedAt: isIncoming ? receivedAt : null
    }
  });

  if (input.message.attachments?.length) {
    await prisma.emailAttachment.createMany({
      data: input.message.attachments.map(item => ({
        messageId: message.id,
        invoiceId: null,
        projectFileId: null,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        storagePath: item.providerAttachmentId ? `gmail://attachment/${item.providerAttachmentId}` : 'gmail://attachment/metadata-only',
        providerAttachmentId: item.providerAttachmentId ?? null
      }))
    });
  }

  await prisma.emailThread.update({
    where: { id: input.threadId },
    data: {
      providerThreadId: input.message.providerThreadId ?? undefined,
      lastMessageAt: receivedAt,
      ...(isIncoming ? { unreadCount: { increment: 1 } } : {})
    }
  });
}

async function persistUnassigned(message: MailInboundMessage, reason: string) {
  const attachmentJson = message.attachments?.length
    ? JSON.stringify(
        message.attachments.map(item => ({
          fileName: item.fileName,
          mimeType: item.mimeType,
          fileSize: item.fileSize,
          providerAttachmentId: item.providerAttachmentId,
          storagePath: item.providerAttachmentId ? `gmail://attachment/${item.providerAttachmentId}` : 'gmail://attachment/metadata-only'
        }))
      )
    : null;

  if (message.providerMessageId) {
    await prisma.unassignedEmail.upsert({
      where: {
        provider_providerMessageId: {
          provider: message.provider,
          providerMessageId: message.providerMessageId
        }
      },
      update: {
        providerThreadId: message.providerThreadId ?? null,
        fromEmail: message.fromEmail,
        toEmail: message.toEmail,
        cc: message.cc?.length ? JSON.stringify(message.cc) : null,
        bcc: message.bcc?.length ? JSON.stringify(message.bcc) : null,
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText ?? null,
        bodySnippet: message.bodySnippet ?? null,
        inReplyTo: message.inReplyTo ?? null,
        referencesHeader: message.referencesHeader ?? null,
        receivedAt: message.receivedAt,
        payloadJson: message.rawPayload ? JSON.stringify(message.rawPayload) : null,
        attachmentsJson: attachmentJson,
        status: 'OPEN',
        reason,
        linkedClientId: null,
        linkedThreadId: null,
        resolvedAt: null
      },
      create: {
        provider: message.provider,
        providerMessageId: message.providerMessageId,
        providerThreadId: message.providerThreadId ?? null,
        fromEmail: message.fromEmail,
        toEmail: message.toEmail,
        cc: message.cc?.length ? JSON.stringify(message.cc) : null,
        bcc: message.bcc?.length ? JSON.stringify(message.bcc) : null,
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText ?? null,
        bodySnippet: message.bodySnippet ?? null,
        inReplyTo: message.inReplyTo ?? null,
        referencesHeader: message.referencesHeader ?? null,
        receivedAt: message.receivedAt,
        payloadJson: message.rawPayload ? JSON.stringify(message.rawPayload) : null,
        attachmentsJson: attachmentJson,
        status: 'OPEN',
        reason
      }
    });
    return;
  }

  await prisma.unassignedEmail.create({
    data: {
      provider: message.provider,
      providerMessageId: null,
      providerThreadId: message.providerThreadId ?? null,
      fromEmail: message.fromEmail,
      toEmail: message.toEmail,
      cc: message.cc?.length ? JSON.stringify(message.cc) : null,
      bcc: message.bcc?.length ? JSON.stringify(message.bcc) : null,
      subject: message.subject,
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText ?? null,
      bodySnippet: message.bodySnippet ?? null,
      inReplyTo: message.inReplyTo ?? null,
      referencesHeader: message.referencesHeader ?? null,
      receivedAt: message.receivedAt,
      payloadJson: message.rawPayload ? JSON.stringify(message.rawPayload) : null,
      attachmentsJson: attachmentJson,
      status: 'OPEN',
      reason
    }
  });
}

function normalizeSubject(subject: string) {
  return subject.toLowerCase().replace(/^(re|fw|fwd)\s*:\s*/gi, '').trim();
}

function normalizeEmail(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function resolveDirection(message: MailInboundMessage, mailboxEmail: string | null): 'incoming' | 'outgoing' {
  if (!mailboxEmail) return 'incoming';
  const from = normalizeEmail(message.fromEmail);
  return from === mailboxEmail ? 'outgoing' : 'incoming';
}

function parseAttachments(value?: string | null) {
  if (!value) return [] as Array<{ fileName: string; mimeType: string; fileSize: number; storagePath: string; providerAttachmentId?: string }>;
  try {
    const parsed = JSON.parse(value) as Array<{ fileName?: string; mimeType?: string; fileSize?: number; storagePath?: string; providerAttachmentId?: string }>;
    return parsed
      .filter(item => typeof item.fileName === 'string' && typeof item.mimeType === 'string' && typeof item.storagePath === 'string')
      .map(item => ({
        fileName: item.fileName!,
        mimeType: item.mimeType!,
        fileSize: Number.isFinite(item.fileSize) ? Number(item.fileSize) : 0,
        storagePath: item.storagePath!,
        providerAttachmentId: item.providerAttachmentId
      }));
  } catch {
    return [];
  }
}

function parseStoredAddressList(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(item => String(item || ''));
    return [];
  } catch {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
}
