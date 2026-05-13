import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { parseAuthToken, type AppRole } from '../lib/auth.js';
import { getRequestMeta, touchSession } from '../services/tech-admin-monitoring.service.js';

type AuthContext = {
  userId: string;
  role: AppRole;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const parsed = parseAuthToken(token, env.AUTH_SECRET);
  if (!parsed) return res.status(401).json({ message: 'Unauthorized' });
  const requestMeta = getRequestMeta(req);

  if (parsed.role === 'TECH_ADMIN') {
    req.auth = { userId: parsed.userId, role: parsed.role };
    touchSession({
      token,
      userId: parsed.userId,
      userName: 'Technical Admin',
      role: parsed.role,
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      device: requestMeta.device,
      expiresAt: parsed.exp
    });
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, name: true, role: true, isActive: true }
  });

  if (!user || !user.isActive) return res.status(401).json({ message: 'Unauthorized' });

  req.auth = { userId: user.id, role: user.role as AppRole };
  touchSession({
    token,
    userId: user.id,
    userName: user.name,
    role: user.role as AppRole,
    ip: requestMeta.ip,
    userAgent: requestMeta.userAgent,
    device: requestMeta.device,
    expiresAt: parsed.exp
  });
  next();
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

export async function hasProjectAccess(userId: string, role: AppRole, projectId: string) {
  if (role === 'ADMIN') return true;
  if (role === 'TECH_ADMIN') return false;
  const access = await prisma.projectAccess.findFirst({
    where: { userId, projectId },
    select: { id: true }
  });
  return Boolean(access);
}
