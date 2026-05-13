import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getRequestMeta, recordClientError } from '../../services/tech-admin-monitoring.service.js';

export const monitoringRouter = Router();

monitoringRouter.post('/client-errors', async (req, res) => {
  const parsed = z.object({
    message: z.string().min(1),
    stack: z.string().optional().nullable(),
    route: z.string().optional().nullable(),
    details: z.unknown().optional(),
    level: z.enum(['error', 'warn']).optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }

  const requestMeta = getRequestMeta(req);
  let userName: string | null = null;
  if (req.auth?.role === 'TECH_ADMIN') {
    userName = 'Technical Admin';
  } else if (req.auth?.userId) {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { name: true }
    });
    userName = user?.name ?? null;
  }
  recordClientError({
    message: parsed.data.message,
    stack: parsed.data.stack ?? null,
    route: parsed.data.route ?? null,
    userId: req.auth?.userId ?? null,
    userName,
    role: req.auth?.role ?? null,
    ip: requestMeta.ip,
    userAgent: requestMeta.userAgent,
    device: requestMeta.device,
    details: parsed.data.details,
    level: parsed.data.level
  });

  res.status(202).json({ ok: true });
});
