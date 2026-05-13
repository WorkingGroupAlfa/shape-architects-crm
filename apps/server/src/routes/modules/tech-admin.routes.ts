import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import {
  getActiveSessions,
  getDirectorySizeBytes,
  getErrorLogs,
  getLoginAudit
} from '../../services/tech-admin-monitoring.service.js';

export const techAdminRouter = Router();

const toMb = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(2));

const resolveDatabasePath = () => {
  if (!env.DATABASE_URL.startsWith('file:')) return null;
  const raw = env.DATABASE_URL.slice('file:'.length).trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
};

techAdminRouter.get('/sessions', (_req, res) => {
  res.json({
    activeSessions: getActiveSessions(),
    loginJournal: getLoginAudit(700)
  });
});

techAdminRouter.get('/errors', (_req, res) => {
  res.json({
    errors: getErrorLogs(700)
  });
});

techAdminRouter.get('/storage', async (_req, res) => {
  const [clientsCount, projectsCount, usersCount] = await Promise.all([
    prisma.client.count(),
    prisma.project.count(),
    prisma.user.count()
  ]);

  const [clientFiles, projectFiles, invoiceFiles, emailAttachments] = await Promise.all([
    prisma.clientFile.aggregate({ _sum: { fileSize: true }, _count: { _all: true } }),
    prisma.projectFile.aggregate({ _sum: { fileSize: true }, _count: { _all: true } }),
    prisma.invoiceFile.aggregate({ _sum: { fileSize: true }, _count: { _all: true } }),
    prisma.emailAttachment.aggregate({ _sum: { fileSize: true }, _count: { _all: true } })
  ]);

  const uploadsDirectory = path.resolve(process.cwd(), env.STORAGE_DIR);
  const [uploadsDirectoryBytes, dbStat] = await Promise.all([
    getDirectorySizeBytes(uploadsDirectory),
    (async () => {
      const dbPath = resolveDatabasePath();
      if (!dbPath) return { path: null, bytes: 0 };
      try {
        const stat = await fs.stat(dbPath);
        return { path: dbPath, bytes: stat.size };
      } catch {
        return { path: dbPath, bytes: 0 };
      }
    })()
  ]);

  const clientFileBytes = clientFiles._sum.fileSize ?? 0;
  const projectFileBytes = projectFiles._sum.fileSize ?? 0;
  const invoiceFileBytes = invoiceFiles._sum.fileSize ?? 0;
  const emailAttachmentBytes = emailAttachments._sum.fileSize ?? 0;

  res.json({
    entities: {
      clients: clientsCount,
      projects: projectsCount,
      users: usersCount
    },
    storage: {
      uploadsDirectory: {
        path: uploadsDirectory,
        bytes: uploadsDirectoryBytes,
        mb: toMb(uploadsDirectoryBytes)
      },
      database: {
        path: dbStat.path,
        bytes: dbStat.bytes,
        mb: toMb(dbStat.bytes)
      },
      logicalBuckets: {
        clientFiles: {
          count: clientFiles._count._all,
          bytes: clientFileBytes,
          mb: toMb(clientFileBytes)
        },
        projectFiles: {
          count: projectFiles._count._all,
          bytes: projectFileBytes,
          mb: toMb(projectFileBytes)
        },
        invoiceFiles: {
          count: invoiceFiles._count._all,
          bytes: invoiceFileBytes,
          mb: toMb(invoiceFileBytes)
        },
        emailAttachments: {
          count: emailAttachments._count._all,
          bytes: emailAttachmentBytes,
          mb: toMb(emailAttachmentBytes)
        }
      },
      totalLogicalFiles: {
        bytes: clientFileBytes + projectFileBytes + invoiceFileBytes + emailAttachmentBytes,
        mb: toMb(clientFileBytes + projectFileBytes + invoiceFileBytes + emailAttachmentBytes)
      }
    }
  });
});

techAdminRouter.get('/health', async (_req, res) => {
  let dbOk = true;
  let dbLatencyMs = 0;
  try {
    const start = Date.now();
    await prisma.$queryRawUnsafe('SELECT 1;');
    dbLatencyMs = Date.now() - start;
  } catch {
    dbOk = false;
  }

  const memory = process.memoryUsage();
  res.json({
    ok: dbOk,
    service: 'shape-architects-crm-server',
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      ok: dbOk,
      latencyMs: dbLatencyMs
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid
    },
    memory: {
      rssMb: toMb(memory.rss),
      heapTotalMb: toMb(memory.heapTotal),
      heapUsedMb: toMb(memory.heapUsed),
      externalMb: toMb(memory.external)
    }
  });
});
