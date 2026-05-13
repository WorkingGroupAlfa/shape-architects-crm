import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

export const dashboardRouter = Router();

const isRecoverablePrismaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('P2021') ||
    message.includes('P2022') ||
    message.includes('does not exist') ||
    message.includes('does not exist in the current database')
  );
};

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (isRecoverablePrismaError(error)) return fallback;
    throw error;
  }
};

dashboardRouter.get('/', async (_req, res) => {
  const [clients, activeProjects, expected, tasks, notifications, leads, statuses] = await Promise.all([
    safe(() => prisma.client.count(), 0),
    safe(() => prisma.project.count({ where: { status: { not: 'completed' } } }), 0),
    safe(
      () =>
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: 'EXPECTED' }
        }),
      { _sum: { amount: 0 } }
    ),
    safe(
      () =>
        prisma.calendarTask.findMany({
          where: { status: { in: ['TODO', 'POSTPONED'] } },
          orderBy: { date: 'asc' },
          take: 5,
          include: { client: true, project: true }
        }),
      []
    ),
    safe(
      () =>
        prisma.notification.findMany({
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
      []
    ),
    safe(
      () =>
        prisma.lead.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
      []
    ),
    safe(
      () =>
        prisma.client.groupBy({
          by: ['statusId'],
          _count: true
        }),
      []
    )
  ]);

  const projects = await safe(() => prisma.project.findMany(), []);
  const income = projects.reduce((sum, p) => sum + p.income, 0);
  const expense = projects.reduce((sum, p) => sum + p.expense, 0);

  res.json({
    clients,
    activeProjects,
    expectedPayments: expected._sum.amount ?? 0,
    income,
    expense,
    tasks,
    notifications,
    statuses,
    leads
  });
});
