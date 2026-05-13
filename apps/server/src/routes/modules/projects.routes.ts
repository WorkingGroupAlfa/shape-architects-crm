import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { nextInvoiceNumberForClient, nextProjectNumber } from '../../lib/numbering.js';
import { logActivity } from '../../lib/activity.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../../lib/env.js';
import { z } from 'zod';
import { hasProjectAccess, requireRole } from '../../middleware/auth.middleware.js';

export const projectsRouter = Router();
const PROJECT_STATUSES = ['DEVELOPMENT', 'APPROVAL', 'COMPLETED'] as const;
const PROJECT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
const ANNOTATABLE_IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const CHAT_IMAGE_PREFIX = '[[image-file:';

const uploadDir = path.resolve(process.cwd(), env.STORAGE_DIR);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, safe);
  }
});

const upload = multer({ storage });
const idParam = (value: string | string[]) => (Array.isArray(value) ? value[0] : value);
const SQLITE_CORRUPTION_MARKERS = ['database disk image is malformed', 'SQLITE_CORRUPT'] as const;

const errorToText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isSqliteCorruptionError = (error: unknown): boolean => {
  const message = errorToText(error).toLowerCase();
  return SQLITE_CORRUPTION_MARKERS.some(marker => message.includes(marker.toLowerCase()));
};

function sanitizeProjectForEmployee<T extends {
  income?: number;
  expense?: number;
  taxAmount?: number;
  profit?: number;
  finances?: unknown[];
  files?: Array<{ isInvoice?: boolean }>;
  client?: { name?: string | null };
}>(project: T): T {
  const masked = {
    ...project,
    income: 0,
    expense: 0,
    taxAmount: 0,
    profit: 0,
    finances: [],
    files: project.files ? project.files.filter(f => !f.isInvoice) : project.files,
    client: project.client
      ? {
          ...project.client,
          name: 'Hidden'
        }
      : project.client
  } as T;

  return masked;
}

function normalizeChatSnippet(content: string) {
  if (content.startsWith(CHAT_IMAGE_PREFIX) && content.endsWith(']]')) {
    return '[Image]';
  }
  return content;
}

async function repairProjectIndex() {
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "Project_invoiceNumber_key"');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Project_invoiceNumber_key" ON "Project"("invoiceNumber")');
  await prisma.$executeRawUnsafe('REINDEX');
}

const parseOr400 = <T>(schema: z.ZodType<T>, body: unknown, res: { status: (code: number) => { json: (payload: unknown) => void } }): T | null => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
};

async function syncProjectAccess(projectId: string, userIds: string[]) {
  await prisma.$transaction(async tx => {
    await tx.projectAccess.deleteMany({ where: { projectId } });
    for (const userId of userIds) {
      await tx.projectAccess.create({
        data: { projectId, userId }
      });
    }
  });
}

async function resolveProjectAccessUserIds(input: { executorId?: string | null; accessUserIds?: string[] }) {
  const requestedUserIds = [...new Set(input.accessUserIds ?? [])];
  const employees = requestedUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: requestedUserIds }, role: 'EMPLOYEE' },
        select: { id: true }
      })
    : [];

  const resolved = new Set(employees.map(item => item.id));

  if (input.executorId) {
    const executor = await prisma.executor.findUnique({
      where: { id: input.executorId },
      select: { userId: true }
    });
    if (executor?.userId) {
      resolved.add(executor.userId);
    }
  }

  return [...resolved];
}

projectsRouter.get('/', async (req, res) => {
  const isAdmin = req.auth?.role === 'ADMIN';
  const projects = await prisma.project.findMany({
    where: isAdmin
      ? undefined
      : {
          accesses: {
            some: { userId: req.auth!.userId }
          }
        },
    include: {
      client: true,
      executor: { include: { user: true } },
      files: true,
      notesItems: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!isAdmin) {
    return res.json(projects.map(project => sanitizeProjectForEmployee(project)));
  }

  res.json(projects);
});

projectsRouter.get('/chats', async (req, res) => {
  if (!req.auth) return res.status(401).json({ message: 'Unauthorized' });

  const isAdmin = req.auth.role === 'ADMIN';
  const projects = await prisma.project.findMany({
    where: isAdmin
      ? undefined
      : {
          accesses: {
            some: { userId: req.auth.userId }
          }
        },
    select: {
      id: true,
      title: true,
      invoiceNumber: true,
      createdAt: true,
      updatedAt: true,
      notesItems: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          createdAt: true,
          userId: true,
          user: {
            select: { id: true, name: true, email: true }
          }
        }
      }
    }
  });

  const projectIds = projects.map(project => project.id);
  const readStates = projectIds.length
    ? await prisma.projectChatRead.findMany({
        where: {
          userId: req.auth.userId,
          projectId: { in: projectIds }
        },
        select: {
          projectId: true,
          lastSeenAt: true
        }
      })
    : [];
  const seenByProject = new Map(readStates.map(item => [item.projectId, item.lastSeenAt]));

  const unreadByProject = new Map<string, number>();
  await Promise.all(
    projects.map(async project => {
      const seenAt = seenByProject.get(project.id) ?? new Date(0);
      const unreadCount = await prisma.projectNote.count({
        where: {
          projectId: project.id,
          createdAt: { gt: seenAt },
          userId: { not: req.auth!.userId }
        }
      });
      unreadByProject.set(project.id, unreadCount);
    })
  );

  const chats = projects
    .map(project => {
      const lastMessage = project.notesItems[0] ?? null;
      return {
        id: project.id,
        title: project.title,
        invoiceNumber: project.invoiceNumber,
        unreadCount: unreadByProject.get(project.id) ?? 0,
        lastActivityAt: (lastMessage?.createdAt ?? project.updatedAt ?? project.createdAt).toISOString(),
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              content: normalizeChatSnippet(lastMessage.content),
              createdAt: lastMessage.createdAt.toISOString(),
              userId: lastMessage.userId ?? null,
              user: lastMessage.user
            }
          : null
      };
    })
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

  res.json(chats);
});

projectsRouter.get('/:id', async (req, res) => {
  const projectId = idParam(req.params.id);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      executor: { include: { user: true } },
      accesses: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      notesItems: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      files: { orderBy: { createdAt: 'desc' } },
      tasks: { orderBy: { date: 'asc' } },
      finances: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!project) return res.status(404).json({ message: 'Project not found' });
  if (req.auth?.role !== 'ADMIN') {
    return res.json(sanitizeProjectForEmployee(project));
  }
  res.json(project);
});

projectsRouter.post('/', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });

  const schema = z.object({
    title: z.string().min(2),
    clientId: z.string(),
    executorId: z.string().optional(),
    accessUserIds: z.array(z.string()).optional(),
    description: z.string().optional(),
    status: z.enum(PROJECT_STATUSES).default('DEVELOPMENT'),
    priority: z.enum(PROJECT_PRIORITIES).default('MEDIUM'),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    deadline: z.string().optional(),
    notes: z.string().optional()
  });

  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  let project;
  try {
    project = await prisma.project.create({
      data: {
        title: input.title,
        clientId: input.clientId,
        invoiceNumber: await nextInvoiceNumberForClient(input.clientId),
        executorId: input.executorId,
        description: input.description,
        status: input.status ?? 'DEVELOPMENT',
        priority: input.priority ?? 'MEDIUM',
        notes: input.notes,
        projectNumber: await nextProjectNumber(),
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        deadline: input.deadline ? new Date(input.deadline) : undefined
      }
    });
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return res.status(409).json({ message: 'Invoice number is already used in another project.' });
    }
    console.error('Project create failed', error);
    return res.status(500).json({ message: 'Project create failed' });
  }

  await logActivity({
    entityType: 'project',
    entityId: project.id,
    action: 'create',
    message: `Project ${project.invoiceNumber ?? project.id} created`
  });

  const accessUserIds = await resolveProjectAccessUserIds({
    executorId: project.executorId,
    accessUserIds: input.accessUserIds
  });
  await syncProjectAccess(project.id, accessUserIds);

  res.status(201).json(project);
});

projectsRouter.patch('/:id', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const projectId = idParam(req.params.id);

  const schema = z.object({
    invoiceNumber: z.string().nullable().optional(),
    title: z.string().min(2).optional(),
    clientId: z.string().optional(),
    executorId: z.string().nullable().optional(),
    accessUserIds: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
  });

  const input = parseOr400(schema, req.body, res);
  if (!input) return;
  const { accessUserIds, ...projectPatch } = input;

  let project;
  try {
    project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...projectPatch,
        invoiceNumber: projectPatch.invoiceNumber === '' ? null : projectPatch.invoiceNumber,
        executorId: projectPatch.executorId === '' ? null : projectPatch.executorId,
        startDate: projectPatch.startDate ? new Date(projectPatch.startDate) : projectPatch.startDate === null ? null : undefined,
        endDate: projectPatch.endDate ? new Date(projectPatch.endDate) : projectPatch.endDate === null ? null : undefined,
        deadline: projectPatch.deadline ? new Date(projectPatch.deadline) : projectPatch.deadline === null ? null : undefined
      },
      include: {
        client: true,
        executor: { include: { user: true } },
        accesses: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        notesItems: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        files: { orderBy: { createdAt: 'desc' } },
        tasks: { orderBy: { date: 'asc' } },
        finances: { orderBy: { createdAt: 'desc' } }
      }
    });
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return res.status(409).json({ message: 'Invoice number is already used in another project.' });
    }
    console.error('Project update failed', error);
    return res.status(500).json({ message: 'Project update failed' });
  }

  await logActivity({
    entityType: 'project',
    entityId: project.id,
    action: 'update',
    message: `Project ${project.invoiceNumber ?? project.id} updated`
  });

  if (accessUserIds !== undefined || projectPatch.executorId !== undefined) {
    const executorIdForAccess = projectPatch.executorId !== undefined ? project.executorId : undefined;
    const resolvedAccessUserIds = await resolveProjectAccessUserIds({
      executorId: executorIdForAccess,
      accessUserIds
    });
    await syncProjectAccess(project.id, resolvedAccessUserIds);
    project = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        client: true,
        executor: { include: { user: true } },
        accesses: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        notesItems: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        files: { orderBy: { createdAt: 'desc' } },
        tasks: { orderBy: { date: 'asc' } },
        finances: { orderBy: { createdAt: 'desc' } }
      }
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
  }

  res.json(project);
});

projectsRouter.patch('/:id/financials', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const projectId = idParam(req.params.id);
  const schema = z.object({
    income: z.number().min(0),
    expense: z.number().min(0)
  });

  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  const current = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      invoiceNumber: true,
      income: true,
      expense: true
    }
  });

  if (!current) return res.status(404).json({ message: 'Project not found' });

  const incomeDelta = Number((input.income - current.income).toFixed(2));
  const expenseDelta = Number((input.expense - current.expense).toFixed(2));
  const taxAmount = Number((input.income * 0.1).toFixed(2));
  const profit = Number((input.income - input.expense).toFixed(2));
  const now = new Date();

  await prisma.$transaction(async tx => {
    if (incomeDelta !== 0) {
      await tx.financeEntry.create({
        data: {
          projectId,
          type: 'income',
          amount: incomeDelta,
          taxAmount: Number((Math.max(incomeDelta, 0) * 0.1).toFixed(2)),
          description: `Manual finance update for ${current.invoiceNumber ?? current.id}`,
          dueDate: now
        }
      });
    }

    if (expenseDelta !== 0) {
      await tx.financeEntry.create({
        data: {
          projectId,
          type: 'expense',
          amount: expenseDelta,
          taxAmount: 0,
          description: `Manual finance update for ${current.invoiceNumber ?? current.id}`,
          dueDate: now
        }
      });
    }

    await tx.project.update({
      where: { id: projectId },
      data: {
        income: input.income,
        expense: input.expense,
        taxAmount,
        profit
      }
    });
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      executor: { include: { user: true } },
      accesses: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      notesItems: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      files: { orderBy: { createdAt: 'desc' } },
      tasks: { orderBy: { date: 'asc' } },
      finances: { orderBy: { createdAt: 'desc' } }
    }
  });

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'update',
    message: `Financials updated for project ${current.invoiceNumber ?? current.id}`
  });

  res.json(project);
});

projectsRouter.post('/:id/deposits', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const projectId = idParam(req.params.id);
  const schema = z.object({
    fraction: z.enum(['1/4', '1/3', '1/2']),
    amount: z.number().min(0.01),
    note: z.string().max(500).optional()
  });

  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  const current = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      invoiceNumber: true,
      title: true
    }
  });

  if (!current) return res.status(404).json({ message: 'Project not found' });

  const amount = Number(input.amount.toFixed(2));
  const note = input.note?.trim();
  await prisma.financeEntry.create({
    data: {
      projectId,
      type: 'deposit',
      amount,
      taxAmount: 0,
      description: `Deposit paid ${input.fraction} for ${current.invoiceNumber ?? current.title}${note ? ` | ${note}` : ''}`
    }
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      executor: { include: { user: true } },
      accesses: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      notesItems: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      files: { orderBy: { createdAt: 'desc' } },
      tasks: { orderBy: { date: 'asc' } },
      finances: { orderBy: { createdAt: 'desc' } }
    }
  });

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'update',
    message: `Deposit ${input.fraction} recorded for project ${current.invoiceNumber ?? current.id}`
  });

  res.json(project);
});

projectsRouter.post('/:id/reminders', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const projectId = idParam(req.params.id);
  const schema = z.object({
    title: z.string().min(2),
    description: z.string().optional(),
    date: z.string(),
    reminderAt: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).default('medium')
  });

  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  const reminder = await prisma.calendarTask.create({
    data: {
      title: input.title,
      description: input.description,
      date: new Date(input.date),
      reminderAt: input.reminderAt ? new Date(input.reminderAt) : undefined,
      priority: input.priority ?? 'medium',
      projectId,
      status: 'TODO'
    }
  });

  res.status(201).json(reminder);
});

projectsRouter.get('/:id/comments', async (req, res) => {
  const projectId = idParam(req.params.id);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const comments = await prisma.projectNote.findMany({
    where: { projectId },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  res.json(comments);
});

projectsRouter.post('/:id/comments', async (req, res) => {
  const projectId = idParam(req.params.id);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const schema = z.object({ content: z.string().min(1) });
  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  const note = await prisma.projectNote.create({
    data: {
      projectId,
      content: input.content,
      userId: req.auth.userId
    },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'comment_create',
    message: `Comment added: ${input.content.slice(0, 120)}`,
    userId: req.auth.userId
  });

  res.status(201).json(note);
});

projectsRouter.post('/:id/comments/read', async (req, res) => {
  const projectId = idParam(req.params.id);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const schema = z.object({ lastSeenAt: z.string().datetime().optional() });
  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  const targetSeenAt = input.lastSeenAt ? new Date(input.lastSeenAt) : new Date();
  await prisma.projectChatRead.upsert({
    where: {
      projectId_userId: {
        projectId,
        userId: req.auth.userId
      }
    },
    update: {
      lastSeenAt: targetSeenAt
    },
    create: {
      projectId,
      userId: req.auth.userId,
      lastSeenAt: targetSeenAt
    }
  });

  res.json({ ok: true, lastSeenAt: targetSeenAt.toISOString() });
});

projectsRouter.patch('/:id/comments/:commentId', async (req, res) => {
  const projectId = idParam(req.params.id);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const schema = z.object({ content: z.string().min(1) });
  const input = parseOr400(schema, req.body, res);
  if (!input) return;

  const existing = await prisma.projectNote.findUnique({
    where: { id: req.params.commentId },
    select: { id: true, projectId: true }
  });
  if (!existing || existing.projectId !== projectId) {
    return res.status(404).json({ message: 'Comment not found' });
  }

  const note = await prisma.projectNote.update({
    where: { id: req.params.commentId },
    data: { content: input.content },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'comment_update',
    message: `Comment updated: ${input.content.slice(0, 120)}`,
    userId: req.auth.userId
  });

  res.json(note);
});

projectsRouter.post('/:id/files', upload.single('file'), async (req, res) => {
  const projectId = idParam(req.params.id);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  if (!req.file) return res.status(400).json({ message: 'File is required' });

  const annotationSourceFileId =
    typeof req.body?.annotationSourceFileId === 'string' && req.body.annotationSourceFileId.trim().length
      ? req.body.annotationSourceFileId.trim()
      : null;

  const isInvoiceFile = req.body?.isInvoice === 'true' || req.body?.isInvoice === true;
  if (isInvoiceFile && req.auth.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Only admin can upload invoice files' });
  }

  let sourceFile: null | {
    id: string;
    projectId: string;
    mimeType: string;
    originalName: string;
  } = null;

  if (annotationSourceFileId) {
    if (req.auth.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only admin can save annotations' });
    }

    sourceFile = await prisma.projectFile.findUnique({
      where: { id: annotationSourceFileId },
      select: {
        id: true,
        projectId: true,
        mimeType: true,
        originalName: true
      }
    });

    if (!sourceFile || sourceFile.projectId !== projectId) {
      return res.status(404).json({ message: 'Source file not found' });
    }

    if (!ANNOTATABLE_IMAGE_MIMES.has(sourceFile.mimeType.toLowerCase())) {
      return res.status(400).json({ message: 'Only JPG/JPEG/PNG can be annotated' });
    }
  }

  const record = await prisma.projectFile.create({
    data: {
      projectId,
      originalName: annotationSourceFileId
        ? `${sourceFile!.originalName.replace(/\.[^.]+$/, '')}-annotated.png`
        : req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      isAnnotated: Boolean(annotationSourceFileId),
      isInvoice: isInvoiceFile,
      annotationSourceId: annotationSourceFileId,
      annotatedById: annotationSourceFileId ? req.auth.userId : null
    }
  });

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: annotationSourceFileId ? 'file_annotate' : 'file_upload',
    message: annotationSourceFileId
      ? `Annotated file saved: ${record.originalName}`
      : `File uploaded: ${record.originalName}`,
    userId: req.auth.userId
  });

  res.status(201).json(record);
});

projectsRouter.get('/:id/files/:fileId/mail-attach-context', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const projectId = idParam(req.params.id);
  const fileId = idParam(req.params.fileId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!project) return res.status(404).json({ message: 'Project not found' });

  const file = await prisma.projectFile.findUnique({
    where: { id: fileId }
  });

  if (!file || file.projectId !== projectId) {
    return res.status(404).json({ message: 'Project file not found' });
  }

  const existingThreadCount = await prisma.emailThread.count({
    where: { clientId: project.clientId }
  });

  const subjectBase = project.invoiceNumber
    ? `Invoice ${project.invoiceNumber}`
    : `Project ${project.title}`;

  res.json({
    clientId: project.clientId,
    projectId: project.id,
    projectFileId: file.id,
    invoiceId: project.invoiceNumber ?? null,
    recipientEmail: project.client.email ?? null,
    attachment: {
      projectFileId: file.id,
      fileName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      storagePath: `/storage/uploads/${file.storedName}`
    },
    suggestedSubject: `${subjectBase} - ${project.title}`,
    suggestedTemplateId: null,
    suggestedMode: existingThreadCount > 0 ? 'reply_thread' : 'new_thread'
  });
});

projectsRouter.get('/:id/files/:fileId/content', async (req, res) => {
  const projectId = idParam(req.params.id);
  const fileId = idParam(req.params.fileId);
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const file = await prisma.projectFile.findUnique({
    where: { id: fileId }
  });
  if (!file || file.projectId !== projectId) {
    return res.status(404).json({ message: 'Project file not found' });
  }

  const filePath = path.resolve(uploadDir, file.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found on storage' });
  }

  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
  res.sendFile(filePath);
});

projectsRouter.delete('/:id/files/:fileId', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const file = await prisma.projectFile.findUnique({ where: { id: req.params.fileId } });
  if (!file) return res.status(404).json({ message: 'File not found' });

  const filePath = path.resolve(uploadDir, file.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await prisma.projectFile.delete({ where: { id: file.id } });
  res.status(204).send();
});

projectsRouter.delete('/:id', async (req, res) => {
  if (req.auth?.role !== 'ADMIN') return res.status(403).json({ message: 'Forbidden' });
  const projectId = idParam(req.params.id);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      files: true
    }
  });

  if (!project) return res.status(404).json({ message: 'Project not found' });

  const filePaths = project.files.map(file => path.resolve(uploadDir, file.storedName));

  try {
    await prisma.project.delete({ where: { id: projectId } });
  } catch (error) {
    if (!isSqliteCorruptionError(error)) {
      console.error('Project delete failed', error);
      return res.status(500).json({ message: 'Project delete failed' });
    }

    try {
      await repairProjectIndex();
      await prisma.project.delete({ where: { id: projectId } });
    } catch (repairError) {
      console.error('Project delete failed due to sqlite corruption and repair attempt did not recover', repairError);
      return res.status(500).json({
        message: 'Database index is corrupted. Run prisma/repair.sql and retry project deletion.'
      });
    }
  }

  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (unlinkError) {
      console.warn('Project deleted but failed to remove local file', { filePath, unlinkError });
    }
  }

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'delete',
    message: `Project ${project.invoiceNumber ?? project.id} deleted`
  });

  res.json({ ok: true });
});

projectsRouter.get('/:id/accesses', requireRole('ADMIN'), async (req, res) => {
  const projectId = idParam(req.params.id);
  const accesses = await prisma.projectAccess.findMany({
    where: { projectId },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  res.json(accesses);
});

projectsRouter.put('/:id/accesses', requireRole('ADMIN'), async (req, res) => {
  const projectId = idParam(req.params.id);
  const parsed = z.object({ userIds: z.array(z.string()).default([]) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }

  const userIds = [...new Set(parsed.data.userIds)];
  const employees = await prisma.user.findMany({
    where: { id: { in: userIds }, role: 'EMPLOYEE' },
    select: { id: true }
  });
  const allowedIds = employees.map(item => item.id);

  await syncProjectAccess(projectId, allowedIds);

  const accesses = await prisma.projectAccess.findMany({
    where: { projectId },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  res.json(accesses);
});

projectsRouter.patch('/:id/tasks/:taskId/status', async (req, res) => {
  const projectId = idParam(req.params.id);
  const taskId = idParam(req.params.taskId);
  const parsed = z.object({ status: z.enum(['TODO', 'DONE']) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }
  if (!req.auth || !(await hasProjectAccess(req.auth.userId, req.auth.role, projectId))) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const task = await prisma.calendarTask.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true }
  });

  if (!task || task.projectId !== projectId) {
    return res.status(404).json({ message: 'Task not found' });
  }

  const updated = await prisma.calendarTask.update({
    where: { id: taskId },
    data: { status: parsed.data.status }
  });

  if (parsed.data.status === 'DONE') {
    await prisma.notification.updateMany({
      where: { taskId, isActive: true },
      data: { isActive: false, isRead: true }
    });
  }

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'task_status',
    message: `Task "${updated.title}" marked ${parsed.data.status}`,
    userId: req.auth.userId
  });

  res.json(updated);
});

projectsRouter.delete('/:id/tasks/:taskId', requireRole('ADMIN'), async (req, res) => {
  const projectId = idParam(req.params.id);
  const taskId = idParam(req.params.taskId);

  const task = await prisma.calendarTask.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, projectId: true }
  });

  if (!task || task.projectId !== projectId) {
    return res.status(404).json({ message: 'Task not found' });
  }

  await prisma.notification.deleteMany({ where: { taskId } });
  await prisma.calendarTask.delete({ where: { id: taskId } });

  await logActivity({
    entityType: 'project',
    entityId: projectId,
    action: 'task_delete',
    message: `Task deleted: ${task.title}`,
    userId: req.auth?.userId
  });

  res.json({ ok: true });
});
