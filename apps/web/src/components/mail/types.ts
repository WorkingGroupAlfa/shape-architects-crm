export type MailAttachment = {
  id?: string;
  messageId?: string | null;
  clientFileId?: string | null;
  invoiceId?: string | null;
  projectFileId?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  providerAttachmentId?: string | null;
  contentBase64?: string;
};

export type MailThread = {
  id: string;
  clientId: string;
  contactEmailId?: string | null;
  contactEmail?: string | null;
  subject: string;
  subjectNormalized: string;
  provider: string;
  providerThreadId?: string | null;
  threadType: string;
  status: string;
  lastMessageAt?: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessageSnippet?: string;
};

export type ClientContactEmail = {
  id: string;
  clientId: string;
  email: string;
  emailNormalized: string;
  label?: string | null;
  isPrimary: boolean;
  isActive: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailMessage = {
  id: string;
  threadId: string;
  clientId: string;
  projectId?: string | null;
  invoiceId?: string | null;
  provider: string;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  direction: 'incoming' | 'outgoing' | string;
  messageType: string;
  fromEmail: string;
  toEmail: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  bodySnippet?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  isRead: boolean;
  sentAt?: string | null;
  receivedAt?: string | null;
  createdAt: string;
  attachments?: MailAttachment[];
};

export type MailMode = 'threads' | 'one-time' | 'campaigns';

export type OneTimeSendMode = 'new_thread' | 'reply_thread';

export type TemplateOption = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export type FileOption = {
  id: string;
  clientFileId?: string | null;
  invoiceId?: string | null;
  projectFileId?: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  kind?: string;
  createdAt: string;
};

export type CampaignSubscription = {
  id: string;
  clientId: string;
  frequency: 'weekly' | 'monthly' | string;
  templateId: string;
  isActive: boolean;
  isProcessing?: boolean;
  processingStartedAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorText?: string | null;
  sendDayOfWeek?: number | null;
  sendDayOfMonth?: number | null;
  sendTime?: string | null;
  timezone?: string | null;
  threadStrategy: 'new_each_run' | 'continue_last_thread' | string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  template?: { id: string; name: string; subject: string };
};

export type CampaignRun = {
  id: string;
  subscriptionId: string;
  clientId: string;
  threadId?: string | null;
  messageId?: string | null;
  status: string;
  errorText?: string | null;
  triggeredAt: string;
  completedAt?: string | null;
  subscription?: { id: string; frequency: string };
  thread?: { id: string; subject: string } | null;
};

export type MailAttachContext = {
  clientId: string;
  projectId: string;
  projectFileId: string;
  invoiceId?: string | null;
  recipientEmail?: string | null;
  attachment: MailAttachment;
  suggestedSubject: string;
  suggestedTemplateId?: string | null;
  suggestedMode: OneTimeSendMode;
};

export type UnassignedEmail = {
  id: string;
  provider: string;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  fromEmail: string;
  toEmail: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  bodySnippet?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  receivedAt?: string | null;
  status: 'OPEN' | 'RESOLVED' | string;
  reason?: string | null;
  linkedClientId?: string | null;
  linkedThreadId?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
