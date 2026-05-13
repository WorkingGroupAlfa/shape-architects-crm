import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { Request } from 'express';
import { env } from '../lib/env.js';

const TECH_ADMIN_LOG_DIR = path.resolve(process.cwd(), env.STORAGE_DIR, '..', 'tech-admin');
const TECH_ADMIN_EVENT_LOG_PATH = path.join(TECH_ADMIN_LOG_DIR, 'events.log');
const ACTIVE_SESSION_IDLE_TTL_MS = 1000 * 60 * 45;
const MAX_LOGIN_AUDIT_ENTRIES = 4000;
const MAX_ERROR_ENTRIES = 3000;

export type SessionRole = 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN';

export type LoginAuditEntry = {
  id: string;
  createdAt: string;
  loginInput: string;
  success: boolean;
  userId: string | null;
  userName: string | null;
  role: SessionRole | null;
  ip: string;
  userAgent: string;
  device: string;
};

export type ActiveSessionEntry = {
  sessionId: string;
  tokenFingerprint: string;
  userId: string;
  userName: string;
  role: SessionRole;
  ip: string;
  userAgent: string;
  device: string;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

export type ErrorLogEntry = {
  id: string;
  createdAt: string;
  source: 'client' | 'server';
  level: 'error' | 'warn';
  message: string;
  stack: string | null;
  route: string | null;
  userId: string | null;
  userName: string | null;
  role: SessionRole | null;
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  details: string | null;
};

const loginAudit: LoginAuditEntry[] = [];
const errorLogs: ErrorLogEntry[] = [];
const activeSessions = new Map<string, ActiveSessionEntry>();

function shortId() {
  return crypto.randomBytes(10).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function pushBounded<T>(target: T[], value: T, max: number) {
  target.unshift(value);
  if (target.length > max) target.length = max;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function normalizeUserAgent(userAgent: string) {
  return userAgent.trim() || 'Unknown user-agent';
}

function detectDevice(userAgent: string) {
  const ua = userAgent.toLowerCase();
  const isMobile = /android|iphone|ipad|mobile/.test(ua);
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome/')
      ? 'Chrome'
      : ua.includes('firefox/')
        ? 'Firefox'
        : ua.includes('safari/')
          ? 'Safari'
          : ua.includes('electron/')
            ? 'Electron'
            : 'Unknown browser';
  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('mac os')
      ? 'macOS'
      : ua.includes('linux')
        ? 'Linux'
        : ua.includes('android')
          ? 'Android'
          : ua.includes('iphone') || ua.includes('ipad')
            ? 'iOS'
            : 'Unknown OS';
  return `${isMobile ? 'Mobile' : 'Desktop'} / ${browser} / ${os}`;
}

export function getRequestMeta(req: Request) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ipFromForwarded = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0] : '';
  const ip = (ipFromForwarded || req.ip || req.socket.remoteAddress || '').trim() || 'Unknown IP';
  const userAgent = normalizeUserAgent(String(req.headers['user-agent'] ?? ''));
  return {
    ip,
    userAgent,
    device: detectDevice(userAgent)
  };
}

function ensureLogDir() {
  if (!fs.existsSync(TECH_ADMIN_LOG_DIR)) {
    fs.mkdirSync(TECH_ADMIN_LOG_DIR, { recursive: true });
  }
}

async function appendEventLog(eventType: string, payload: unknown) {
  try {
    ensureLogDir();
    const line = `${nowIso()} ${eventType} ${safeStringify(payload)}\n`;
    await fsp.appendFile(TECH_ADMIN_EVENT_LOG_PATH, line, 'utf8');
  } catch {
    // Intentionally silent: monitoring must never break core app flow.
  }
}

function tokenFingerprint(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
}

function purgeStaleSessions() {
  const now = Date.now();
  for (const [key, session] of activeSessions) {
    const expired = Date.parse(session.expiresAt) <= now;
    const stale = Date.parse(session.lastSeenAt) + ACTIVE_SESSION_IDLE_TTL_MS <= now;
    if (expired || stale) {
      activeSessions.delete(key);
    }
  }
}

export function recordLoginAttempt(input: {
  loginInput: string;
  success: boolean;
  userId: string | null;
  userName: string | null;
  role: SessionRole | null;
  ip: string;
  userAgent: string;
  device: string;
}) {
  const entry: LoginAuditEntry = {
    id: shortId(),
    createdAt: nowIso(),
    loginInput: input.loginInput,
    success: input.success,
    userId: input.userId,
    userName: input.userName,
    role: input.role,
    ip: input.ip,
    userAgent: input.userAgent,
    device: input.device
  };
  pushBounded(loginAudit, entry, MAX_LOGIN_AUDIT_ENTRIES);
  void appendEventLog('LOGIN_AUDIT', entry);
}

export function registerSession(input: {
  token: string;
  userId: string;
  userName: string;
  role: SessionRole;
  ip: string;
  userAgent: string;
  device: string;
  expiresAt: number;
}) {
  purgeStaleSessions();
  const now = nowIso();
  const fingerprint = tokenFingerprint(input.token);
  const existing = activeSessions.get(fingerprint);
  const next: ActiveSessionEntry = existing
    ? {
        ...existing,
        ip: input.ip,
        userAgent: input.userAgent,
        device: input.device,
        lastSeenAt: now,
        expiresAt: new Date(input.expiresAt).toISOString()
      }
    : {
        sessionId: shortId(),
        tokenFingerprint: fingerprint,
        userId: input.userId,
        userName: input.userName,
        role: input.role,
        ip: input.ip,
        userAgent: input.userAgent,
        device: input.device,
        issuedAt: now,
        expiresAt: new Date(input.expiresAt).toISOString(),
        lastSeenAt: now
      };
  activeSessions.set(fingerprint, next);
}

export function touchSession(input: {
  token: string;
  userId: string;
  userName: string;
  role: SessionRole;
  ip: string;
  userAgent: string;
  device: string;
  expiresAt: number;
}) {
  registerSession(input);
}

export function getActiveSessions() {
  purgeStaleSessions();
  return Array.from(activeSessions.values()).sort((a, b) =>
    Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)
  );
}

export function getLoginAudit(limit = 500) {
  return loginAudit.slice(0, Math.max(0, Math.min(limit, MAX_LOGIN_AUDIT_ENTRIES)));
}

export function recordClientError(input: {
  message: string;
  stack?: string | null;
  route?: string | null;
  userId: string | null;
  userName: string | null;
  role: SessionRole | null;
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  details?: unknown;
  level?: 'error' | 'warn';
}) {
  const entry: ErrorLogEntry = {
    id: shortId(),
    createdAt: nowIso(),
    source: 'client',
    level: input.level ?? 'error',
    message: input.message.trim().slice(0, 1600),
    stack: input.stack?.trim().slice(0, 6000) || null,
    route: input.route?.trim().slice(0, 300) || null,
    userId: input.userId,
    userName: input.userName,
    role: input.role,
    ip: input.ip,
    userAgent: input.userAgent,
    device: input.device,
    details: input.details == null ? null : safeStringify(input.details).slice(0, 5000)
  };
  pushBounded(errorLogs, entry, MAX_ERROR_ENTRIES);
  void appendEventLog('CLIENT_ERROR', entry);
}

export function recordServerError(input: {
  message: string;
  stack?: string | null;
  details?: unknown;
  level?: 'error' | 'warn';
}) {
  const entry: ErrorLogEntry = {
    id: shortId(),
    createdAt: nowIso(),
    source: 'server',
    level: input.level ?? 'error',
    message: input.message.trim().slice(0, 1600),
    stack: input.stack?.trim().slice(0, 6000) || null,
    route: null,
    userId: null,
    userName: null,
    role: null,
    ip: null,
    userAgent: null,
    device: null,
    details: input.details == null ? null : safeStringify(input.details).slice(0, 5000)
  };
  pushBounded(errorLogs, entry, MAX_ERROR_ENTRIES);
  void appendEventLog('SERVER_ERROR', entry);
}

export function getErrorLogs(limit = 500) {
  return errorLogs.slice(0, Math.max(0, Math.min(limit, MAX_ERROR_ENTRIES)));
}

export async function getDirectorySizeBytes(targetPath: string): Promise<number> {
  try {
    const stats = await fsp.stat(targetPath);
    if (!stats.isDirectory()) return stats.size;

    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySizeBytes(entryPath);
      } else if (entry.isFile()) {
        const fileStats = await fsp.stat(entryPath);
        total += fileStats.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

