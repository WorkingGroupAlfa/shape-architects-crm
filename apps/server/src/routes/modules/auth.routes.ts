import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { verifyPassword } from '../../lib/password.js';
import { createAuthToken, parseAuthToken } from '../../lib/auth.js';
import { env } from '../../lib/env.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { getRequestMeta, recordLoginAttempt, registerSession } from '../../services/tech-admin-monitoring.service.js';

export const authRouter = Router();
const TECH_ADMIN_USER_ID = 'tech-admin-observer';
const TECH_ADMIN_USER_NAME = 'Technical Admin';
const TECH_ADMIN_EMAIL = 'tech-admin@shape.local';

type AuthUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string;
  isActive: boolean;
};

const loadAuthUser = async (login: string): Promise<AuthUserRow | null> => {
  const normalizedLogin = login.trim().toLowerCase();
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      isActive: true
    }
  });

  const match = users.find(
    (user) =>
      user.email.trim().toLowerCase() === normalizedLogin ||
      user.name.trim().toLowerCase() === normalizedLogin
  );

  if (!match) return null;

  return {
    id: match.id,
    name: match.name,
    email: match.email,
    role: match.role,
    passwordHash: match.passwordHash ?? '',
    isActive: match.isActive
  };
};

authRouter.post('/login', async (req, res) => {
  const parsed = z.object({
    login: z.string().min(1),
    password: z.string().min(1)
  }).safeParse(req.body);
  const requestMeta = getRequestMeta(req);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }

  const login = parsed.data.login.trim();
  if (login === env.TECH_ADMIN_LOGIN && parsed.data.password === env.TECH_ADMIN_PASSWORD) {
    const token = createAuthToken({
      userId: TECH_ADMIN_USER_ID,
      role: 'TECH_ADMIN',
      secret: env.AUTH_SECRET
    });
    const parsedToken = parseAuthToken(token, env.AUTH_SECRET);
    if (parsedToken) {
      registerSession({
        token,
        userId: TECH_ADMIN_USER_ID,
        userName: TECH_ADMIN_USER_NAME,
        role: 'TECH_ADMIN',
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
        device: requestMeta.device,
        expiresAt: parsedToken.exp
      });
    }
    recordLoginAttempt({
      loginInput: login,
      success: true,
      userId: TECH_ADMIN_USER_ID,
      userName: TECH_ADMIN_USER_NAME,
      role: 'TECH_ADMIN',
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      device: requestMeta.device
    });
    return res.json({
      token,
      user: {
        id: TECH_ADMIN_USER_ID,
        name: TECH_ADMIN_USER_NAME,
        email: TECH_ADMIN_EMAIL,
        role: 'TECH_ADMIN'
      }
    });
  }

  const userByName = await loadAuthUser(login);

  if (!userByName || !userByName.passwordHash || !verifyPassword(parsed.data.password, userByName.passwordHash)) {
    recordLoginAttempt({
      loginInput: login,
      success: false,
      userId: null,
      userName: null,
      role: null,
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      device: requestMeta.device
    });
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (!userByName.isActive) {
    recordLoginAttempt({
      loginInput: login,
      success: false,
      userId: userByName.id,
      userName: userByName.name,
      role: userByName.role as 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN',
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      device: requestMeta.device
    });
    return res.status(403).json({ message: 'Account deactivated' });
  }

  const token = createAuthToken({
    userId: userByName.id,
    role: userByName.role as 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN',
    secret: env.AUTH_SECRET
  });
  const parsedToken = parseAuthToken(token, env.AUTH_SECRET);
  if (parsedToken) {
    registerSession({
      token,
      userId: userByName.id,
      userName: userByName.name,
      role: userByName.role as 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN',
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      device: requestMeta.device,
      expiresAt: parsedToken.exp
    });
  }
  recordLoginAttempt({
    loginInput: login,
    success: true,
    userId: userByName.id,
    userName: userByName.name,
    role: userByName.role as 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN',
    ip: requestMeta.ip,
    userAgent: requestMeta.userAgent,
    device: requestMeta.device
  });

  res.json({
    token,
    user: {
      id: userByName.id,
      name: userByName.name,
      email: userByName.email,
      role: userByName.role
    }
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  if (req.auth?.role === 'TECH_ADMIN') {
    return res.json({
      id: TECH_ADMIN_USER_ID,
      name: TECH_ADMIN_USER_NAME,
      email: TECH_ADMIN_EMAIL,
      role: 'TECH_ADMIN'
    });
  }
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, name: true, email: true, role: true }
  });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});
