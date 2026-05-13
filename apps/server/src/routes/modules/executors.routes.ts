import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

export const executorsRouter = Router();

executorsRouter.get('/', async (_req, res) => {
  const executors = await prisma.executor.findMany({
    include: {
      projects: { select: { id: true } },
      user: { select: { id: true, name: true, email: true, role: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(executors);
});

executorsRouter.post('/', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    role: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    notes: z.string().optional(),
    userId: z.string().optional().nullable()
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const executor = await prisma.executor.create({
    data: {
      name: input.data.name,
      role: input.data.role,
      email: input.data.email || undefined,
      phone: input.data.phone,
      notes: input.data.notes,
      userId: input.data.userId || null
    }
  });

  res.status(201).json(executor);
});

executorsRouter.patch('/:id', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    role: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    notes: z.string().optional(),
    userId: z.string().optional().nullable()
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const before = await prisma.executor.findUnique({
    where: { id: req.params.id },
    include: { projects: { select: { id: true } } }
  });
  if (!before) return res.status(404).json({ message: 'Executor not found' });

  const executor = await prisma.executor.update({
    where: { id: req.params.id },
    data: {
      ...input.data,
      email: input.data.email === '' ? null : input.data.email,
      userId: input.data.userId === '' ? null : input.data.userId
    },
    include: {
      projects: { select: { id: true } },
      user: { select: { id: true, name: true, email: true, role: true } }
    }
  });

  if (before.userId !== executor.userId) {
    const projectIds = before.projects.map(project => project.id);
    await prisma.$transaction(async tx => {
      for (const projectId of projectIds) {
        await tx.projectAccess.deleteMany({ where: { projectId } });
        if (executor.userId) {
          await tx.projectAccess.create({
            data: {
              projectId,
              userId: executor.userId
            }
          });
        }
      }
    });
  }

  res.json(executor);
});

executorsRouter.delete('/:id', async (req, res) => {
  await prisma.executor.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
