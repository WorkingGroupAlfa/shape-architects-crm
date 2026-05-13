import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from './lib/prisma.js';
import { env } from './lib/env.js';
import { router } from './routes/index.js';
import { syncOverduePayments, syncTaskNotifications } from './services/automation.service.js';
import { startCampaignScheduler, stopCampaignScheduler } from './services/mail/campaign-scheduler.service.js';
import { startMailSyncWorker, stopMailSyncWorker } from './services/mail/mail-sync.service.js';
import { getRequestMeta, recordServerError } from './services/tech-admin-monitoring.service.js';

const app = express();
const storagePath = path.resolve(process.cwd(), env.STORAGE_DIR);
const allowedOrigins = env.CORS_ORIGINS.split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/storage/uploads', express.static(storagePath));
app.use('/api', router);
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestMeta = getRequestMeta(req);
  const err = error instanceof Error ? error : new Error(String(error));
  recordServerError({
    message: `HTTP ${req.method} ${req.originalUrl}: ${err.message}`,
    stack: err.stack,
    details: { ip: requestMeta.ip, userAgent: requestMeta.userAgent }
  });
  res.status(500).json({ message: 'Internal server error' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'shape-architects-crm-server' });
});

const server = app.listen(env.PORT, async () => {
  await prisma.$connect();
  const isSqlite = env.DATABASE_URL.startsWith('file:') || env.DATABASE_URL.includes('sqlite');
  if (isSqlite) {
    try {
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000;');
    } catch (error) {
      console.warn('SQLite PRAGMA setup skipped', error);
    }
  }
  console.log(`Shape Architects CRM server running on http://localhost:${env.PORT}`);
  startCampaignScheduler();
  startMailSyncWorker();
});

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const message = args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(' ').slice(0, 1400);
  const stack = args.find(arg => arg instanceof Error);
  recordServerError({
    message: message || 'Unknown server error',
    stack: stack instanceof Error ? stack.stack : null,
    details: args
  });
  originalConsoleError(...args);
};

setInterval(async () => {
  if (!env.AUTOMATION_SYNC_ENABLED) return;
  try {
    await syncOverduePayments();
    await syncTaskNotifications();
  } catch (error) {
    console.error('Automation sync failed', error);
  }
}, 30_000);

process.on('SIGINT', async () => {
  stopCampaignScheduler();
  stopMailSyncWorker();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  recordServerError({ message: `uncaughtException: ${error.message}`, stack: error.stack, details: error });
  originalConsoleError(error);
});

process.on('unhandledRejection', (reason) => {
  const maybeError = reason instanceof Error ? reason : new Error(String(reason));
  recordServerError({ message: `unhandledRejection: ${maybeError.message}`, stack: maybeError.stack, details: reason });
  originalConsoleError(reason);
});
