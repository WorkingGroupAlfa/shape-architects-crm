import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

export const templatesRouter = Router();

templatesRouter.get('/', async (_req, res) => {
  res.json(
    await prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'desc' }
    })
  );
});

templatesRouter.post('/', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    subject: z.string().min(2),
    body: z.string().min(2)
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  res.status(201).json(await prisma.emailTemplate.create({ data: input.data }));
});

templatesRouter.patch('/:id', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    subject: z.string().min(2).optional(),
    body: z.string().min(2).optional()
  });

  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Validation failed', issues: input.error.issues });

  const updated = await prisma.emailTemplate.update({
    where: { id: req.params.id },
    data: input.data
  });

  res.json(updated);
});

templatesRouter.delete('/:id', async (req, res) => {
  const result = await prisma.emailTemplate.deleteMany({ where: { id: req.params.id } });
  if (result.count === 0) {
    return res.status(404).json({ message: 'Template not found' });
  }
  return res.json({ ok: true });
});
