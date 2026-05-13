import { prisma } from '../../lib/prisma.js';
import { composeOneTime } from './mail-compose.service.js';
import { calculateNextRunAt, failureCooldownDate } from './campaign-schedule.util.js';
import { renderCampaignTemplate } from './campaign-render.service.js';

const MAX_SEND_ATTEMPTS = 2;

export async function runDueCampaignSubscriptions(options?: { limit?: number }) {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 20));
  const now = new Date();

  await initializeMissingNextRuns(now, limit * 2);

  const dueSubscriptions = await prisma.emailCampaignSubscription.findMany({
    where: {
      isActive: true,
      isProcessing: false,
      nextRunAt: { lte: now }
    },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
    select: { id: true }
  });

  const results: Array<{ subscriptionId: string; status: string; runId?: string; error?: string }> = [];

  for (const item of dueSubscriptions) {
    const result = await runCampaignSubscription(item.id, { dueOnly: true, now });
    results.push(result);
  }

  return {
    processed: results.length,
    results
  };
}

export async function runCampaignSubscription(subscriptionId: string, options?: { dueOnly?: boolean; now?: Date }) {
  const now = options?.now ?? new Date();

  const claimed = await prisma.emailCampaignSubscription.updateMany({
    where: {
      id: subscriptionId,
      isActive: true,
      isProcessing: false,
      ...(options?.dueOnly ? { nextRunAt: { lte: now } } : {})
    },
    data: {
      isProcessing: true,
      processingStartedAt: now
    }
  });

  if (claimed.count === 0) {
    return { subscriptionId, status: 'skipped', error: options?.dueOnly ? 'Not due or already processing' : 'Inactive or already processing' };
  }

  const subscription = await prisma.emailCampaignSubscription.findUnique({
    where: { id: subscriptionId },
    include: {
      client: true,
      template: true
    }
  });

  if (!subscription) {
    return { subscriptionId, status: 'failed', error: 'Subscription not found after claim' };
  }

  const run = await prisma.emailCampaignRun.create({
    data: {
      subscriptionId: subscription.id,
      clientId: subscription.clientId,
      status: 'queued',
      triggeredAt: now
    }
  });

  try {
    const validationError = validateSubscription(subscription);
    if (validationError) {
      const nextRun = calculateNextRunAt(subscription, now) ?? failureCooldownDate(now, 60);

      await prisma.$transaction([
        prisma.emailCampaignRun.update({
          where: { id: run.id },
          data: {
            status: 'skipped',
            errorText: validationError,
            completedAt: new Date()
          }
        }),
        prisma.emailCampaignSubscription.update({
          where: { id: subscription.id },
          data: {
            isProcessing: false,
            processingStartedAt: null,
            lastErrorAt: new Date(),
            lastErrorText: validationError,
            nextRunAt: nextRun
          }
        })
      ]);

      return { subscriptionId: subscription.id, status: 'skipped', runId: run.id, error: validationError };
    }

    const rendered = renderCampaignTemplate(subscription.template, subscription.client);
    const targetThreadId = await resolveCampaignThreadId(subscription.id, subscription.clientId, subscription.threadStrategy);

    let sentResult: Awaited<ReturnType<typeof composeOneTime>> | null = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      try {
        sentResult = await composeOneTime({
          clientId: subscription.clientId,
          mode: targetThreadId ? 'reply_thread' : 'new_thread',
          threadId: targetThreadId ?? undefined,
          toEmail: subscription.client.email ?? undefined,
          subject: rendered.subject,
          bodyHtml: rendered.bodyHtml,
          templateId: subscription.templateId,
          messageType: 'campaign'
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!sentResult) {
      const failedAt = new Date();
      const cooldown = failureCooldownDate(failedAt, 15);

      await prisma.$transaction([
        prisma.emailCampaignRun.update({
          where: { id: run.id },
          data: {
            status: 'failed',
            errorText: lastError || 'Campaign send failed',
            completedAt: failedAt
          }
        }),
        prisma.emailCampaignSubscription.update({
          where: { id: subscription.id },
          data: {
            isProcessing: false,
            processingStartedAt: null,
            lastErrorAt: failedAt,
            lastErrorText: lastError || 'Campaign send failed',
            nextRunAt: cooldown
          }
        })
      ]);

      return { subscriptionId: subscription.id, status: 'failed', runId: run.id, error: lastError || 'Campaign send failed' };
    }

    const successAt = new Date();
    const nextRun = calculateNextRunAt(subscription, successAt);

    await prisma.$transaction([
      prisma.emailCampaignRun.update({
        where: { id: run.id },
        data: {
          status: 'sent',
          threadId: sentResult.thread.id,
          messageId: sentResult.message.id,
          completedAt: successAt,
          errorText: null
        }
      }),
      prisma.emailCampaignSubscription.update({
        where: { id: subscription.id },
        data: {
          isProcessing: false,
          processingStartedAt: null,
          lastRunAt: successAt,
          nextRunAt: nextRun,
          lastErrorAt: null,
          lastErrorText: null
        }
      })
    ]);

    return { subscriptionId: subscription.id, status: 'sent', runId: run.id };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const fallbackAt = new Date();

    await prisma.$transaction([
      prisma.emailCampaignRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          errorText,
          completedAt: fallbackAt
        }
      }),
      prisma.emailCampaignSubscription.update({
        where: { id: subscription.id },
        data: {
          isProcessing: false,
          processingStartedAt: null,
          lastErrorAt: fallbackAt,
          lastErrorText: errorText,
          nextRunAt: failureCooldownDate(fallbackAt, 15)
        }
      })
    ]);

    return { subscriptionId: subscription.id, status: 'failed', runId: run.id, error: errorText };
  }
}

async function initializeMissingNextRuns(now: Date, limit: number) {
  const subs = await prisma.emailCampaignSubscription.findMany({
    where: {
      isActive: true,
      nextRunAt: null
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, limit)
  });

  for (const sub of subs) {
    const nextRunAt = calculateNextRunAt(sub, now);
    await prisma.emailCampaignSubscription.update({
      where: { id: sub.id },
      data: {
        nextRunAt,
        lastErrorAt: nextRunAt ? null : now,
        lastErrorText: nextRunAt ? null : 'Unable to calculate next run time'
      }
    });
  }
}

async function resolveCampaignThreadId(subscriptionId: string, clientId: string, threadStrategy: string) {
  if (threadStrategy !== 'continue_last_thread') return null;

  const lastRun = await prisma.emailCampaignRun.findFirst({
    where: {
      subscriptionId,
      clientId,
      status: 'sent',
      threadId: { not: null }
    },
    orderBy: { triggeredAt: 'desc' }
  });

  if (!lastRun?.threadId) return null;

  const thread = await prisma.emailThread.findUnique({ where: { id: lastRun.threadId } });
  return thread?.id ?? null;
}

function validateSubscription(subscription: {
  client: { email: string | null };
  template: { subject: string; body: string };
  frequency: string;
  sendTime: string | null;
  sendDayOfWeek: number | null;
  sendDayOfMonth: number | null;
}) {
  if (!subscription.client.email) return 'Client email is missing';
  if (!subscription.template.subject?.trim()) return 'Template subject is empty';
  if (!subscription.template.body?.trim()) return 'Template body is empty';
  if (!subscription.sendTime) return 'sendTime is required';

  if (subscription.frequency === 'weekly' && (subscription.sendDayOfWeek === null || subscription.sendDayOfWeek < 0 || subscription.sendDayOfWeek > 6)) {
    return 'sendDayOfWeek must be 0-6 for weekly campaigns';
  }

  if (subscription.frequency === 'monthly' && (subscription.sendDayOfMonth === null || subscription.sendDayOfMonth < 1 || subscription.sendDayOfMonth > 31)) {
    return 'sendDayOfMonth must be 1-31 for monthly campaigns';
  }

  return null;
}
