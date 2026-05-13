export type MailSendInput = {
  to: string;
  subject: string;
  bodyHtml: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }>;
  cc?: string[];
  bcc?: string[];
  inReplyTo?: string;
  referencesHeader?: string;
  providerThreadId?: string;
};

export type MailSendResult = {
  provider: string;
  providerMessageId: string;
  providerThreadId?: string;
  sentAt: Date;
};

export type MailInboundAttachment = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  providerAttachmentId?: string;
};

export type MailInboundMessage = {
  provider: string;
  providerMessageId: string;
  providerThreadId?: string | null;
  fromEmail: string;
  toEmail: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  bodySnippet?: string;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  receivedAt: Date;
  attachments?: MailInboundAttachment[];
  rawPayload?: unknown;
  historyId?: string | null;
};

export type MailFetchInboundInput = {
  since?: Date | null;
  maxResults?: number;
  lastHistoryId?: string | null;
  query?: string;
  maxPages?: number;
};

export type MailFetchInboundResult = {
  messages: MailInboundMessage[];
  lastHistoryId?: string | null;
  fetchedAt: Date;
};

export interface MailProvider {
  provider: string;
  send(input: MailSendInput): Promise<MailSendResult>;
  fetchInbound(input: MailFetchInboundInput): Promise<MailFetchInboundResult>;
}
