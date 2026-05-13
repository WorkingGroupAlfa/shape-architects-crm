import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { requireRole } from '../../middleware/auth.middleware.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (_req, res) => {
  const notifications = await prisma.notification.findMany({
    where: {
      isActive: true,
      task: {
        is: {
          status: { in: ['TODO', 'POSTPONED'] }
        }
      }
    },
    include: {
      task: {
        include: {
          client: true,
          project: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(notifications);
});

notificationsRouter.patch('/:id/read', async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id },
    data: { isRead: true, isActive: false }
  });

  if (result.count === 0) {
    return res.status(404).json({ message: 'Notification not found' });
  }

  res.json({ ok: true });
});

notificationsRouter.get('/executor-activity', requireRole('ADMIN'), async (_req, res) => {
  const logs = await prisma.activityLog.findMany({
    where: {
      user: {
        is: {
          role: 'EMPLOYEE'
        }
      }
    },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  const projectIds = [...new Set(logs.map(item => item.entityId))];
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, invoiceNumber: true, projectNumber: true }
      })
    : [];
  const projectById = new Map(
    projects.map(project => [project.id, project.invoiceNumber ?? project.projectNumber])
  );

  res.json(
    logs.map(item => ({
      ...item,
      projectDisplayNumber: projectById.get(item.entityId) ?? null
    }))
  );
});
