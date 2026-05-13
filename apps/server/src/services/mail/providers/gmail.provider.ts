import { env } from '../../../lib/env.js';
import { getGoogleAccessToken, sendMail } from '../../mail.service.js';
import type {
  MailFetchInboundInput,
  MailFetchInboundResult,
  MailInboundAttachment,
  MailInboundMessage,
  MailProvider,
  MailSendInput,
  MailSendResult
} from './mail-provider.js';

export class GmailProvider implements MailProvider {
  provider = 'gmail';

  async send(input: MailSendInput): Promise<MailSendResult> {
    const result = await sendMail({
      to: input.to,
      subject: input.subject,
      body: input.bodyHtml,
      attachments: input.attachments,
      cc: input.cc,
      bcc: input.bcc,
      inReplyTo: input.inReplyTo,
      referencesHeader: input.referencesHeader,
      threadId: input.providerThreadId
    });

    return {
      provider: this.provider,
      providerMessageId: result.id,
      providerThreadId: result.threadId,
      sentAt: new Date()
    };
  }

  async fetchInbound(input: MailFetchInboundInput): Promise<MailFetchInboundResult> {
    const accessToken = await getGoogleAccessToken();
    const fetchedAt = new Date();
    const maxResults = Math.max(1, Math.min(100, input.maxResults ?? 50));
    const maxPages = Math.max(1, Math.min(5, input.maxPages ?? 1));

    const sinceTs = input.since
      ? Math.floor((input.since.getTime() - 120_000) / 1000)
      : Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

    const mailboxFrom = sanitizeAddress(env.MAIL_FROM);
    const query = input.query?.trim()
      ? input.query.trim()
      : buildDefaultInboundQuery({ sinceTs, mailboxFrom });

    const ids = await listMessageIds({
      accessToken,
      query,
      maxResults,
      maxPages
    });
    if (!ids.length) {
      return {
        messages: [],
        fetchedAt
      };
    }

    const messages: MailInboundMessage[] = [];
    let lastHistoryId: string | null = null;
    for (const id of ids) {
      const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!messageResponse.ok) continue;
      const data = (await messageResponse.json()) as GmailMessage;
      if (data.historyId) lastHistoryId = data.historyId;

      const headers = collectHeaders(data.payload);
      const fromEmail = parseEmailAddress(headerValue(headers, 'from'));
      const toList = splitEmails(headerValue(headers, 'to'));
      const toEmail = pickPrimaryRecipient(toList, mailboxFrom);
      const cc = [...splitEmails(headerValue(headers, 'cc')), ...toList.filter(item => item !== toEmail)];
      const bcc = splitEmails(headerValue(headers, 'bcc'));
      const subject = headerValue(headers, 'subject') || '(no subject)';
      const inReplyTo = normalizeHeaderMessageId(headerValue(headers, 'in-reply-to'));
      const referencesHeader = normalizeReferences(headerValue(headers, 'references'));

      const body = extractBody(data.payload);
      const attachments = extractAttachmentMeta(data.payload);

      messages.push({
        provider: this.provider,
        providerMessageId: data.id,
        providerThreadId: data.threadId ?? null,
        fromEmail,
        toEmail,
        cc,
        bcc,
        subject,
        bodyHtml: body.bodyHtml,
        bodyText: body.bodyText,
        bodySnippet: data.snippet || body.bodyText?.slice(0, 220),
        inReplyTo,
        referencesHeader,
        receivedAt: data.internalDate ? new Date(Number(data.internalDate)) : fetchedAt,
        attachments,
        rawPayload: { id: data.id, threadId: data.threadId, historyId: data.historyId }
      });
    }

    return {
      messages,
      lastHistoryId,
      fetchedAt
    };
  }
}

async function listMessageIds(input: {
  accessToken: string;
  query: string;
  maxResults: number;
  maxPages: number;
}) {
  const ids: string[] = [];
  let pageToken: string | null = null;
  let page = 0;

  while (page < input.maxPages) {
    const listParams = new URLSearchParams({
      q: input.query,
      maxResults: String(input.maxResults)
    });
    if (pageToken) listParams.set('pageToken', pageToken);

    const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` }
    });

    if (!listResponse.ok) {
      const payload = await listResponse.text();
      throw new Error(`Gmail inbound list failed: ${listResponse.status} ${payload}`);
    }

    const listed = (await listResponse.json()) as { messages?: Array<{ id: string }>; nextPageToken?: string };
    const pageIds = listed.messages?.map(item => item.id).filter(Boolean) ?? [];
    ids.push(...pageIds);

    page += 1;
    pageToken = listed.nextPageToken ?? null;
    if (!pageToken || pageIds.length === 0) break;
  }

  return [...new Set(ids)];
}

function buildDefaultInboundQuery(input: { sinceTs: number; mailboxFrom: string }) {
  const queryParts = [`after:${input.sinceTs}`];
  if (input.mailboxFrom) queryParts.push(`-from:${input.mailboxFrom}`);
  return queryParts.join(' ');
}

type GmailHeader = { name?: string; value?: string };
type GmailPayloadPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  headers?: GmailHeader[];
  parts?: GmailPayloadPart[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPayloadPart;
};

function headerValue(headers: GmailHeader[], name: string) {
  const target = headers.find(header => header.name?.toLowerCase() === name.toLowerCase());
  return target?.value?.trim() || '';
}

function collectHeaders(payload?: GmailPayloadPart): GmailHeader[] {
  if (!payload) return [];
  const result = [...(payload.headers ?? [])];
  for (const part of payload.parts ?? []) {
    result.push(...collectHeaders(part));
  }
  return result;
}

function extractBody(payload?: GmailPayloadPart): { bodyHtml: string; bodyText: string } {
  if (!payload) return { bodyHtml: '', bodyText: '' };
  const htmlPart = findPart(payload, 'text/html');
  const textPart = findPart(payload, 'text/plain');
  const html = decodeBody(htmlPart?.body?.data);
  const text = decodeBody(textPart?.body?.data);

  if (html) {
    return {
      bodyHtml: html,
      bodyText: stripHtml(html)
    };
  }

  if (text) {
    return {
      bodyHtml: escapeHtml(text).replace(/\n/g, '<br />'),
      bodyText: text
    };
  }

  return { bodyHtml: '', bodyText: '' };
}

function extractAttachmentMeta(payload?: GmailPayloadPart): MailInboundAttachment[] {
  if (!payload) return [];
  const entries: MailInboundAttachment[] = [];
  const walk = (part: GmailPayloadPart) => {
    if (part.filename && part.filename.trim()) {
      entries.push({
        fileName: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        fileSize: part.body?.size ?? 0,
        providerAttachmentId: part.body?.attachmentId
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return entries;
}

function findPart(payload: GmailPayloadPart, mimeType: string): GmailPayloadPart | null {
  if (payload.mimeType?.toLowerCase() === mimeType.toLowerCase() && payload.body?.data) {
    return payload;
  }
  for (const child of payload.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodeBody(value?: string) {
  if (!value) return '';
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function parseEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  const email = (match?.[1] || value).trim().toLowerCase();
  return sanitizeAddress(email);
}

function splitEmails(value: string) {
  if (!value) return [];
  return value
    .split(',')
    .map(parseEmailAddress)
    .filter(Boolean);
}

function pickPrimaryRecipient(addresses: string[], mailboxFrom: string) {
  if (!addresses.length) return '';
  const nonMailbox = addresses.find(address => address !== mailboxFrom);
  return nonMailbox || addresses[0];
}

function normalizeHeaderMessageId(value: string) {
  if (!value) return null;
  return value.replace(/[<>]/g, '').trim() || null;
}

function normalizeReferences(value: string) {
  if (!value) return null;
  const refs = value
    .split(/\s+/g)
    .map(item => item.replace(/[<>]/g, '').trim())
    .filter(Boolean);
  return refs.length ? refs.join(' ') : null;
}

function sanitizeAddress(value: string) {
  return value.replace(/["']/g, '').trim().toLowerCase();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
