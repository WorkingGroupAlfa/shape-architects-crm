import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { requireRole } from '../../middleware/auth.middleware.js';

export const usersRouter = Router();
const idParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true
} as const;

usersRouter.get('/employees', requireRole('ADMIN'), async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'EMPLOYEE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  res.json(users);
});

usersRouter.get('/', requireRole('ADMIN'), async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: userSelect
  });
  res.json(users);
});

usersRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(['ADMIN', 'EMPLOYEE']),
    password: z.string().min(6)
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const existing = await prisma.user.findUnique({ where: { email: input.data.email } });
  if (existing) return res.status(409).json({ message: 'Email already in use' });

  const passwordHash = hashPassword(input.data.password);
  const user = await prisma.user.create({
    data: {
      name: input.data.name,
      email: input.data.email,
      role: input.data.role,
      passwordHash,
      isActive: true
    },
    select: userSelect
  });
  res.status(201).json(user);
});

usersRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    role: z.enum(['ADMIN', 'EMPLOYEE']).optional(),
    password: z.string().min(6).optional()
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const userId = idParam(req.params.id);
  const exists = await prisma.user.findUnique({ where: { id: userId } });
  if (!exists) return res.status(404).json({ message: 'User not found' });

  const data: Record<string, unknown> = {};
  if (input.data.name) data.name = input.data.name;
  if (input.data.email) data.email = input.data.email;
  if (input.data.role) data.role = input.data.role;
  if (input.data.password) data.passwordHash = hashPassword(input.data.password);

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: userSelect
  });
  res.json(user);
});

usersRouter.patch('/:id/toggle-active', requireRole('ADMIN'), async (req, res) => {
  const userId = idParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive: !user.isActive },
    select: userSelect
  });
  res.json(updated);
});

usersRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const userId = idParam(req.params.id);
  const exists = await prisma.user.findUnique({ where: { id: userId } });
  if (!exists) return res.status(404).json({ message: 'User not found' });

  await prisma.user.delete({ where: { id: userId } });
  res.json({ ok: true });
});
