import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { GmailProvider } from './providers/gmail.provider.js';
import type { MailProvider } from './providers/mail-provider.js';
import { touchThreadAfterSend } from './mail-thread.service.js';
import fs from 'node:fs';
import path from 'node:path';

export type SendJobMode = 'new_thread' | 'reply_thread';

type SendJobPayload = {
  provider: string;
  mode: SendJobMode;
  clientId: string;
  threadId: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  cc?: string[];
  bcc?: string[];
  messageType: string;
  projectId?: string;
  invoiceId?: string;
  attachments?: Array<{
    clientFileId?: string;
    invoiceId?: string;
    projectFileId?: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    storagePath: string;
    providerAttachmentId?: string;
    contentBase64?: string;
  }>;
};

export async function createAndProcessSendJob(payload: SendJobPayload) {
  const job = await prisma.emailSendJob.create({
    data: {
      clientId: payload.clientId,
      threadId: payload.threadId,
      mode: payload.mode,
      payloadJson: JSON.stringify(payload),
      status: 'PENDING',
      attempts: 0
    }
  });

  return processSendJob(job.id);
}

export async function processSendJob(jobId: string) {
  const job = await prisma.emailSendJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Send job not found');
  if (job.status === 'SENT') return { job, message: null };

  const payload = JSON.parse(job.payloadJson) as SendJobPayload;

  await prisma.emailSendJob.update({
    where: { id: job.id },
    data: {
      status: 'PROCESSING',
      attempts: { increment: 1 }
    }
  });

  try {
    const thread = await prisma.emailThread.findUnique({
      where: { id: payload.threadId }
    });
    if (!thread) throw new Error('Thread not found for send job');

    const previousMessage = await prisma.emailMessage.findFirst({
      where: {
        threadId: payload.threadId,
        provider: payload.provider,
        providerMessageId: { not: null }
      },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }]
    });

    const provider = resolveProvider(payload.provider);
    const normalizedBodyHtml = normalizeOutgoingBodyHtml(payload.bodyHtml);
    const resolvedAttachments = await resolveOutgoingAttachments(payload.clientId, payload.attachments);
    const sent = await provider.send({
      to: payload.toEmail,
      subject: payload.subject,
      bodyHtml: normalizedBodyHtml,
      attachments: resolvedAttachments,
      cc: payload.cc,
      bcc: payload.bcc,
      inReplyTo: previousMessage?.providerMessageId ?? undefined,
      referencesHeader: previousMessage?.providerMessageId ?? undefined,
      providerThreadId: thread.providerThreadId ?? undefined
    });

    const message = await persistOutgoingMessage({
      threadId: payload.threadId,
      clientId: payload.clientId,
      projectId: payload.projectId,
      invoiceId: payload.invoiceId,
      provider: sent.provider,
      providerMessageId: sent.providerMessageId,
      providerThreadId: sent.providerThreadId ?? thread.providerThreadId ?? undefined,
      fromEmail: env.MAIL_FROM,
      toEmail: payload.toEmail,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyHtml: normalizedBodyHtml,
      messageType: payload.messageType,
      sentAt: sent.sentAt,
      inReplyTo: previousMessage?.providerMessageId ?? undefined,
      referencesHeader: previousMessage?.providerMessageId ?? undefined
    });

    if (payload.attachments?.length) {
      await prisma.emailAttachment.createMany({
        data: payload.attachments.map(item => ({
          messageId: message.id,
          invoiceId: item.invoiceId ?? null,
          projectFileId: item.projectFileId ?? null,
          fileName: item.fileName,
          mimeType: item.mimeType,
          fileSize: item.fileSize,
          storagePath: item.storagePath,
          providerAttachmentId: item.providerAttachmentId ?? null
        }))
      });
    }

    await touchThreadAfterSend(payload.threadId, sent.sentAt, sent.providerThreadId ?? null);

    const updatedJob = await prisma.emailSendJob.update({
      where: { id: job.id },
      data: {
        status: 'SENT',
        processedAt: new Date(),
        errorText: null
      }
    });

    return { job: updatedJob, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedJob = await prisma.emailSendJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorText: message,
        processedAt: new Date()
      }
    });

    throw new Error(failedJob.errorText || 'Send job failed');
  }
}

type PersistOutgoingParams = {
  threadId: string;
  clientId: string;
  projectId?: string;
  invoiceId?: string;
  provider: string;
  providerMessageId?: string;
  providerThreadId?: string;
  fromEmail: string;
  toEmail: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  messageType: string;
  sentAt: Date;
  inReplyTo?: string;
  referencesHeader?: string;
};

async function persistOutgoingMessage(params: PersistOutgoingParams) {
  const bodySnippet = stripHtml(params.bodyHtml).slice(0, 220);

  const baseData = {
    threadId: params.threadId,
    clientId: params.clientId,
    projectId: params.projectId ?? null,
    invoiceId: params.invoiceId ?? null,
    provider: params.provider,
    providerThreadId: params.providerThreadId ?? null,
    direction: 'outgoing',
    messageType: params.messageType,
    fromEmail: params.fromEmail,
    toEmail: params.toEmail,
    cc: params.cc?.length ? JSON.stringify(params.cc) : null,
    bcc: params.bcc?.length ? JSON.stringify(params.bcc) : null,
    subject: params.subject,
    bodyHtml: params.bodyHtml,
    bodyText: stripHtml(params.bodyHtml),
    bodySnippet,
    inReplyTo: params.inReplyTo ?? null,
    referencesHeader: params.referencesHeader ?? null,
    isRead: true,
    sentAt: params.sentAt,
    receivedAt: null
  };

  if (params.providerMessageId) {
    return prisma.emailMessage.upsert({
      where: {
        provider_providerMessageId: {
          provider: params.provider,
          providerMessageId: params.providerMessageId
        }
      },
      update: baseData,
      create: {
        ...baseData,
        providerMessageId: params.providerMessageId
      }
    });
  }

  return prisma.emailMessage.create({
    data: {
      ...baseData,
      providerMessageId: null
    }
  });
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveProvider(provider: string): MailProvider {
  if (provider === 'gmail') return new GmailProvider();
  throw new Error(`Unsupported mail provider: ${provider}`);
}

function normalizeOutgoingBodyHtml(value: string) {
  const raw = value.replace(/\r\n/g, '\n').trim();
  if (!raw) return '';
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return escapeHtml(raw).replace(/\n/g, '<br />');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function resolveOutgoingAttachments(
  clientId: string,
  attachments?: Array<{
    clientFileId?: string;
    invoiceId?: string;
    projectFileId?: string;
    fileName: string;
    mimeType: string;
    storagePath: string;
    contentBase64?: string;
  }>
) {
  if (!attachments?.length) return undefined;

  const resolved = await Promise.all(attachments.map(async item => {
    if (item.contentBase64?.trim()) {
      const normalized = normalizeBase64(item.contentBase64);
      if (!isValidBase64(normalized)) {
        throw new Error(`Attachment "${item.fileName}" has invalid base64 content`);
      }
      return {
        fileName: item.fileName,
        mimeType: item.mimeType,
        contentBase64: normalized
      };
    }

    if (!item.storagePath?.trim()) {
      throw new Error(`Attachment "${item.fileName}" has no storage source`);
    }

    const source = await resolveStoredAttachment(clientId, item);
    const sourcePath = resolveStoragePath(source.storedName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Attachment file not found: ${item.fileName}`);
    }

    const contentBase64 = fs.readFileSync(sourcePath).toString('base64');
    if (!isValidBase64(contentBase64)) {
      throw new Error(`Attachment "${item.fileName}" failed to encode`);
    }
    return {
      fileName: item.fileName,
      mimeType: item.mimeType,
      contentBase64
    };
  }));

  return resolved.length ? resolved : undefined;
}

async function resolveStoredAttachment(
  clientId: string,
  item: {
    clientFileId?: string;
    invoiceId?: string;
    projectFileId?: string;
    storagePath: string;
    fileName: string;
  }
) {
  if (item.clientFileId) {
    const file = await prisma.clientFile.findUnique({ where: { id: item.clientFileId } });
    if (!file || file.clientId !== clientId) {
      throw new Error(`Client file not found: ${item.fileName}`);
    }
    return { storedName: file.storedName };
  }

  if (item.invoiceId) {
    const file = await prisma.invoiceFile.findUnique({ where: { id: item.invoiceId } });
    if (!file || file.clientId !== clientId) {
      throw new Error(`Invoice file not found: ${item.fileName}`);
    }
    return { storedName: file.storedName };
  }

  if (item.projectFileId) {
    const file = await prisma.projectFile.findUnique({
      where: { id: item.projectFileId },
      include: { project: { select: { clientId: true } } }
    });
    if (!file || file.project.clientId !== clientId) {
      throw new Error(`Project file not found: ${item.fileName}`);
    }
    return { storedName: file.storedName };
  }

  return { storedName: item.storagePath };
}

function resolveStoragePath(storagePath: string) {
  const clean = storagePath.split('?')[0].trim();
  const marker = '/storage/uploads/';
  const markerIndex = clean.indexOf(marker);
  const fileName = markerIndex >= 0 ? clean.slice(markerIndex + marker.length) : path.basename(clean);
  const safeName = path.basename(fileName);
  return path.resolve(process.cwd(), env.STORAGE_DIR, safeName);
}

function normalizeBase64(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    return commaIndex >= 0 ? trimmed.slice(commaIndex + 1).replace(/\s+/g, '') : '';
  }
  return trimmed.replace(/\s+/g, '');
}

function isValidBase64(value: string) {
  if (!value) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (!decoded.length) return false;
    return decoded.toString('base64').replace(/=+$/g, '') === value.replace(/=+$/g, '');
  } catch {
    return false;
  }
}
