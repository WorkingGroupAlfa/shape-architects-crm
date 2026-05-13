import { prisma } from '../../lib/prisma.js';

type ThreadFilter = 'all' | 'unread' | 'campaign' | 'manual';

export type ThreadListParams = {
  clientId: string;
  search?: string;
  filter?: ThreadFilter;
  contactEmail?: string;
};

export type CreateThreadParams = {
  clientId: string;
  subject: string;
  provider: string;
  providerThreadId?: string | null;
  threadType?: string;
  status?: string;
  contactEmailId?: string | null;
  contactEmail?: string | null;
};

function normalizeSubject(subject: string) {
  return subject
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/gi, '')
    .trim();
}

export async function createEmailThread(params: CreateThreadParams) {
  return prisma.emailThread.create({
    data: {
      clientId: params.clientId,
      subject: params.subject.trim(),
      subjectNormalized: normalizeSubject(params.subject),
      provider: params.provider,
      providerThreadId: params.providerThreadId ?? null,
      threadType: params.threadType ?? 'manual',
      status: params.status ?? 'open',
      contactEmailId: params.contactEmailId ?? null,
      contactEmail: params.contactEmail?.trim().toLowerCase() || null
    }
  });
}

export async function getEmailThread(threadId: string) {
  return prisma.emailThread.findUnique({ where: { id: threadId } });
}

export async function listClientThreads(params: ThreadListParams) {
  const search = params.search?.trim();
  const filter = params.filter ?? 'all';
  const contactEmail = params.contactEmail?.trim().toLowerCase();
  const andFilters: Record<string, unknown>[] = [{ clientId: params.clientId }];

  if (filter === 'unread') andFilters.push({ unreadCount: { gt: 0 } });
  if (filter === 'campaign') andFilters.push({ threadType: 'campaign' });
  if (filter === 'manual') andFilters.push({ threadType: 'manual' });
  if (search) {
    andFilters.push({
      OR: [
        { subject: { contains: search } },
        { subjectNormalized: { contains: search.toLowerCase() } }
      ]
    });
  }
  if (contactEmail) {
    andFilters.push({
      OR: [
        { contactEmail },
        {
          messages: {
            some: {
              OR: [
                { fromEmail: contactEmail },
                { toEmail: contactEmail },
                { cc: { contains: contactEmail } },
                { bcc: { contains: contactEmail } }
              ]
            }
          }
        }
      ]
    });
  }

  const threads = await prisma.emailThread.findMany({
    where: {
      AND: andFilters
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          bodySnippet: true,
          bodyText: true,
          bodyHtml: true,
          createdAt: true,
          direction: true
        }
      }
    },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }]
  });

  return threads.map(thread => ({
    ...thread,
    lastMessageSnippet:
      thread.messages[0]?.bodySnippet ||
      thread.messages[0]?.bodyText ||
      stripHtml(thread.messages[0]?.bodyHtml || '')
  }));
}

export async function listThreadMessages(threadId: string) {
  return prisma.emailMessage.findMany({
    where: { threadId },
    include: {
      attachments: true
    },
    orderBy: [{ sentAt: 'asc' }, { receivedAt: 'asc' }, { createdAt: 'asc' }]
  });
}

export async function touchThreadAfterSend(threadId: string, at: Date, providerThreadId?: string | null) {
  return prisma.emailThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: at,
      ...(providerThreadId ? { providerThreadId } : {})
    }
  });
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
