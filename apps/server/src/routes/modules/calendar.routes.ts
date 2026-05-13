import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

export const calendarRouter = Router();

calendarRouter.get('/tasks', async (_req, res) => {
  res.json(
    await prisma.calendarTask.findMany({
      include: { client: true, project: true },
      orderBy: { date: 'asc' }
    })
  );
});

calendarRouter.post('/tasks', async (req, res) => {
  const schema = z.object({
    title: z.string().min(2),
    description: z.string().optional(),
    date: z.string(),
    priority: z.string().default('medium'),
    projectId: z.string().optional(),
    clientId: z.string().optional(),
    reminderAt: z.string().optional()
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const task = await prisma.calendarTask.create({
    data: {
      title: input.data.title,
      description: input.data.description,
      date: new Date(input.data.date),
      priority: input.data.priority,
      projectId: input.data.projectId,
      clientId: input.data.clientId,
      reminderAt: input.data.reminderAt ? new Date(input.data.reminderAt) : undefined
    }
  });

  res.status(201).json(task);
});

calendarRouter.patch('/tasks/:id', async (req, res) => {
  const schema = z.object({
    title: z.string().min(2).optional(),
    description: z.string().optional(),
    date: z.string().optional(),
    priority: z.string().optional(),
    status: z.enum(['TODO', 'DONE', 'POSTPONED']).optional(),
    projectId: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    reminderAt: z.string().nullable().optional()
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const task = await prisma.calendarTask.update({
    where: { id: req.params.id },
    data: {
      title: input.data.title,
      description: input.data.description,
      date: input.data.date ? new Date(input.data.date) : undefined,
      priority: input.data.priority,
      status: input.data.status,
      projectId: input.data.projectId === '' ? null : input.data.projectId,
      clientId: input.data.clientId === '' ? null : input.data.clientId,
      reminderAt: input.data.reminderAt ? new Date(input.data.reminderAt) : input.data.reminderAt === null ? null : undefined
    }
  });

  if (input.data.status === 'DONE') {
    await prisma.notification.updateMany({
      where: { taskId: req.params.id, isActive: true },
      data: { isActive: false, isRead: true }
    });
  }

  res.json(task);
});

calendarRouter.delete('/tasks/:id', async (req, res) => {
  await prisma.notification.deleteMany({ where: { taskId: req.params.id } });
  await prisma.calendarTask.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
