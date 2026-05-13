import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { createEmailThread, getEmailThread } from './mail-thread.service.js';
import { createAndProcessSendJob } from './send-job.service.js';
import { findClientContactEmailByAddress, listActiveClientEmails, normalizeClientEmail } from './client-email.service.js';

export type OneTimeMode = 'new_thread' | 'reply_thread';

export type AttachmentInput = {
  clientFileId?: string;
  invoiceId?: string;
  projectFileId?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  providerAttachmentId?: string;
  contentBase64?: string;
};

export type OneTimeComposeInput = {
  clientId: string;
  subject: string;
  bodyHtml: string;
  templateId?: string;
  toEmail?: string;
  cc?: string[];
  bcc?: string[];
  mode: OneTimeMode;
  threadId?: string;
  projectId?: string;
  invoiceId?: string;
  attachments?: AttachmentInput[];
  messageType?: string;
};

export type ReplyComposeInput = {
  threadId: string;
  subject?: string;
  bodyHtml: string;
  cc?: string[];
  bcc?: string[];
  templateId?: string;
  projectId?: string;
  invoiceId?: string;
  attachments?: AttachmentInput[];
};

export async function composeOneTime(input: OneTimeComposeInput) {
  const provider = resolveProviderName();
  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, email: true, name: true }
  });

  if (!client) throw new Error('Client not found');

  const subject = input.subject.trim();
  if (!subject) throw new Error('Subject is required');
  if (!input.bodyHtml.trim()) throw new Error('Body is required');

  let thread;
  if (input.mode === 'reply_thread') {
    if (!input.threadId) throw new Error('threadId is required for reply mode');
    thread = await getEmailThread(input.threadId);
    if (!thread) throw new Error('Thread not found');
    if (thread.clientId !== client.id) throw new Error('Thread does not belong to client');
  } else {
    thread = await createEmailThread({
      clientId: client.id,
      subject,
      provider,
      threadType: inferThreadType(input.messageType)
    });
  }

  const activeEmails = await listActiveClientEmails(client.id);
  const fallbackPrimaryEmail =
    thread.contactEmail?.trim().toLowerCase() ||
    activeEmails.find(item => item.isPrimary)?.emailNormalized ||
    activeEmails[0]?.emailNormalized ||
    normalizeClientEmail(client.email);
  const targetEmail = normalizeClientEmail(input.toEmail) ?? fallbackPrimaryEmail;
  if (!targetEmail) throw new Error('Recipient email is required');

  if (input.mode === 'new_thread') {
    const matchedEmail = await findClientContactEmailByAddress(client.id, targetEmail);
    thread = await prisma.emailThread.update({
      where: { id: thread.id },
      data: {
        contactEmailId: matchedEmail?.id ?? null,
        contactEmail: targetEmail
      }
    });
  } else if (targetEmail && targetEmail !== (thread.contactEmail || '').toLowerCase()) {
    const matchedEmail = await findClientContactEmailByAddress(client.id, targetEmail);
    thread = await prisma.emailThread.update({
      where: { id: thread.id },
      data: {
        contactEmailId: matchedEmail?.id ?? thread.contactEmailId ?? null,
        contactEmail: targetEmail
      }
    });
  }

  const result = await createAndProcessSendJob({
    provider,
    mode: input.mode,
    clientId: client.id,
    threadId: thread.id,
    toEmail: targetEmail,
    subject,
    bodyHtml: input.bodyHtml,
    cc: normalizeEmails(input.cc),
    bcc: normalizeEmails(input.bcc),
    messageType: input.messageType ?? 'manual',
    projectId: input.projectId,
    invoiceId: input.invoiceId,
    attachments: input.attachments
  });

  if (!result.message) throw new Error('Message was not persisted');

  return {
    thread,
    message: result.message,
    providerMessageId: result.message.providerMessageId,
    providerThreadId: result.message.providerThreadId
  };
}

export async function composeReply(input: ReplyComposeInput) {
  const thread = await getEmailThread(input.threadId);
  if (!thread) throw new Error('Thread not found');

  const subject = input.subject?.trim() || thread.subject;
  return composeOneTime({
    clientId: thread.clientId,
    mode: 'reply_thread',
    threadId: thread.id,
    subject,
    bodyHtml: input.bodyHtml,
    cc: input.cc,
    bcc: input.bcc,
    templateId: input.templateId,
    projectId: input.projectId,
    invoiceId: input.invoiceId,
    attachments: input.attachments,
    messageType: 'reply'
  });
}

function resolveProviderName() {
  const configured = (env.MAIL_PROVIDER || '').trim().toLowerCase();
  if (!configured) return 'gmail';
  return configured;
}

function normalizeEmails(values?: string[]) {
  if (!values?.length) return undefined;
  const normalized = values.map(item => normalizeClientEmail(item)).filter((item): item is string => Boolean(item));
  return normalized.length ? [...new Set(normalized)] : undefined;
}

function inferThreadType(messageType?: string) {
  if (messageType === 'campaign') return 'campaign';
  if (messageType === 'invoice') return 'invoice';
  return 'manual';
}
