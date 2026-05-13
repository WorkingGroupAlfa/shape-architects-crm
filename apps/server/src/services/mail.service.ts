import { env } from '../lib/env.js';

type SendMailInput = {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
  cc?: string[];
  bcc?: string[];
  inReplyTo?: string;
  referencesHeader?: string;
  threadId?: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function chunkBase64(value: string, max = 76) {
  const normalized = value.replace(/\s+/g, '');
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += max) {
    chunks.push(normalized.slice(index, index + max));
  }
  return chunks.join('\r\n');
}

function toBodyBase64(value: string) {
  return chunkBase64(Buffer.from(value, 'utf8').toString('base64'));
}

function normalizeFileName(value: string) {
  return value.replace(/[\r\n"]/g, ' ').trim() || 'attachment.bin';
}

function asciiFileNameFallback(value: string) {
  const normalized = normalizeFileName(value);
  const ascii = normalized.replace(/[^\x20-\x7E]/g, '_');
  return ascii || 'attachment.bin';
}

function encodeRfc5987(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

function normalizeBase64Payload(value: string) {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) return '';
  try {
    const decoded = Buffer.from(normalized, 'base64');
    if (!decoded.length) return '';
    return decoded.toString('base64');
  } catch {
    return '';
  }
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

function buildMimeMessage(input: SendMailInput) {
  const from = sanitizeHeader(env.MAIL_FROM);
  const to = sanitizeHeader(input.to);
  const subject = sanitizeHeader(input.subject);
  const body = input.body;
  const cc = (input.cc ?? []).map(item => sanitizeHeader(item)).filter(Boolean);
  const bcc = (input.bcc ?? []).map(item => sanitizeHeader(item)).filter(Boolean);
  const inReplyTo = input.inReplyTo ? sanitizeHeader(input.inReplyTo) : '';
  const referencesHeader = input.referencesHeader ? sanitizeHeader(input.referencesHeader) : '';
  const attachmentInputs = input.attachments ?? [];
  const attachments = attachmentInputs.map(attachment => {
    if (!attachment.fileName || !attachment.mimeType || !attachment.contentBase64) {
      throw new Error(`Attachment "${attachment.fileName || 'unnamed'}" is missing file data`);
    }

    const normalizedBase64 = normalizeBase64Payload(attachment.contentBase64);
    if (!normalizedBase64) {
      throw new Error(`Attachment "${attachment.fileName}" has invalid file data`);
    }

    return {
      ...attachment,
      contentBase64: normalizedBase64
    };
  });

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(', ')}`] : []),
    `Subject: ${subject}`,
    ...(inReplyTo ? [`In-Reply-To: <${inReplyTo}>`] : []),
    ...(referencesHeader ? [`References: <${referencesHeader}>`] : []),
    'MIME-Version: 1.0'
  ];

  if (!attachments.length) {
    const mime = [
      ...headers,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      toBodyBase64(body)
    ].join('\r\n');
    return toBase64Url(mime);
  }

  const boundary = `mix-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const altBoundary = `alt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const plainTextBody = stripHtml(body) || body;
  const parts: string[] = [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    toBodyBase64(plainTextBody),
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    toBodyBase64(body),
    `--${altBoundary}--`
  ];

  for (const attachment of attachments) {
    const originalFileName = normalizeFileName(attachment.fileName);
    const fileName = asciiFileNameFallback(originalFileName);
    const fileNameUtf8 = encodeRfc5987(originalFileName);
    const contentType = sanitizeHeader(attachment.mimeType);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${contentType}; name="${fileName}"`,
      `Content-Disposition: attachment; filename="${fileName}"; filename*=UTF-8''${fileNameUtf8}`,
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(attachment.contentBase64)
    );
  }
  parts.push(`--${boundary}--`, '');

  return toBase64Url([...headers, ...parts].join('\r\n'));
}

export async function getGoogleAccessToken() {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN
    })
  });

  if (!tokenResponse.ok) {
    const payload = await tokenResponse.text();
    throw new Error(`Google token request failed: ${tokenResponse.status} ${payload}`);
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error('Google access token not received');
  return tokenData.access_token;
}

export function assertMailConfig() {
  if (env.MAIL_PROVIDER !== 'gmail') {
    throw new Error('MAIL_PROVIDER must be set to "gmail"');
  }

  const required = [
    ['MAIL_FROM', env.MAIL_FROM],
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
    ['GOOGLE_REFRESH_TOKEN', env.GOOGLE_REFRESH_TOKEN]
  ];

  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing mail env vars: ${missing.join(', ')}`);
  }
}

export async function sendMail(input: SendMailInput) {
  assertMailConfig();
  const accessToken = await getGoogleAccessToken();
  const raw = buildMimeMessage(input);

  const payload: { raw: string; threadId?: string } = { raw };
  if (input.threadId?.trim()) payload.threadId = input.threadId.trim();

  const sendResponse = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!sendResponse.ok) {
    const payload = await sendResponse.text();
    throw new Error(`Gmail send failed: ${sendResponse.status} ${payload}`);
  }

  return (await sendResponse.json()) as { id: string; threadId: string };
}
