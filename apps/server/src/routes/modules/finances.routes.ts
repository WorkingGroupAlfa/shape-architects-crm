import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { getFinanceSummary } from '../../services/finance.service.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../../lib/env.js';
import { logActivity } from '../../lib/activity.js';
import { z } from 'zod';

export const financesRouter = Router();
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
const OPERATING_EXPENSE_TYPES = ['subscription', 'salary', 'monthly_expense'] as const;
const OPERATING_RECEIPT_TYPE = 'operating_receipt';
const routeParam = (value: string | string[]) => (Array.isArray(value) ? value[0] : value);

type OperatingReceiptMeta = {
  expenseId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
};
type OperatingReceiptView = OperatingReceiptMeta & {
  id: string;
  createdAt: Date;
};

function parseReceiptMeta(description?: string | null): OperatingReceiptMeta | null {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description) as Partial<OperatingReceiptMeta>;
    if (!parsed.expenseId || !parsed.originalName || !parsed.storedName || !parsed.mimeType || !parsed.fileSize) return null;
    return {
      expenseId: parsed.expenseId,
      originalName: parsed.originalName,
      storedName: parsed.storedName,
      mimeType: parsed.mimeType,
      fileSize: parsed.fileSize
    };
  } catch {
    return null;
  }
}

financesRouter.get('/summary', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json(await getFinanceSummary(year));
});

financesRouter.get('/payments', async (_req, res) => {
  const payments = await prisma.payment.findMany({
    include: { project: { include: { client: true } } },
    orderBy: { dueDate: 'asc' }
  });
  res.json(payments);
});

financesRouter.patch('/payments/:id', async (req, res) => {
  const { status } = req.body as { status: string };
  if (!['PAID', 'EXPECTED', 'OVERDUE'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const payment = await prisma.payment.update({
    where: { id: req.params.id },
    data: { status, paidAt: status === 'PAID' ? new Date() : null },
    include: { project: { include: { client: true } } },
  });
  await logActivity({
    entityType: 'payment',
    entityId: payment.id,
    action: 'update',
    message: `Payment marked as ${status}: ${payment.project.title}`,
    userId: req.auth?.userId,
  });
  res.json(payment);
});

financesRouter.get('/operating-expenses', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const expenses = await prisma.financeEntry.findMany({
    where: {
      projectId: null,
      type: { in: [...OPERATING_EXPENSE_TYPES] },
      dueDate: {
        gte: start,
        lt: end
      }
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }]
  });

  const receipts = await prisma.financeEntry.findMany({
    where: {
      projectId: null,
      type: OPERATING_RECEIPT_TYPE,
      dueDate: {
        gte: start,
        lt: end
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  const receiptsByExpense = new Map<string, OperatingReceiptView[]>();
  for (const receipt of receipts) {
    const meta = parseReceiptMeta(receipt.description);
    if (!meta) continue;
    const list = receiptsByExpense.get(meta.expenseId) ?? [];
    list.push({ ...meta, id: receipt.id, createdAt: receipt.createdAt });
    receiptsByExpense.set(meta.expenseId, list);
  }

  res.json(expenses.map(expense => ({
    ...expense,
    receipts: receiptsByExpense.get(expense.id) ?? []
  })));
});

financesRouter.post('/operating-expenses', async (req, res) => {
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    type: z.enum(OPERATING_EXPENSE_TYPES),
    description: z.string().min(1).max(500),
    amount: z.number().min(0.01),
    hasGst: z.boolean().default(true),
    nextMonth: z.boolean().default(false)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });

  const [year, month] = parsed.data.month.split('-').map(Number);
  const dueDate = new Date(Date.UTC(year, month - 1, 1));
  const amount = Number(parsed.data.amount.toFixed(2));
  const taxAmount = parsed.data.hasGst ? Number((amount * 0.1).toFixed(2)) : 0;
  const baseData = { type: parsed.data.type, amount, taxAmount, description: parsed.data.description.trim() };

  const created = await prisma.financeEntry.create({ data: { ...baseData, dueDate } });

  if (parsed.data.nextMonth) {
    const nextDate = new Date(Date.UTC(year, month, 1)); // month (0-indexed next month)
    await prisma.financeEntry.create({ data: { ...baseData, dueDate: nextDate } });
  }

  await logActivity({
    entityType: 'finance_entry',
    entityId: created.id,
    action: 'create',
    message: `Operating expense added: ${created.description}`,
    userId: req.auth?.userId
  });

  res.status(201).json(created);
});

financesRouter.post('/operating-expenses/:id/receipts', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File is required' });
  const expenseId = routeParam(req.params.id);

  const expense = await prisma.financeEntry.findUnique({
    where: { id: expenseId }
  });
  if (!expense || expense.projectId || !OPERATING_EXPENSE_TYPES.includes(expense.type as (typeof OPERATING_EXPENSE_TYPES)[number])) {
    return res.status(404).json({ message: 'Operating expense not found' });
  }

  const created = await prisma.financeEntry.create({
    data: {
      type: OPERATING_RECEIPT_TYPE,
      amount: 0,
      taxAmount: 0,
      dueDate: expense.dueDate,
      description: JSON.stringify({
        expenseId: expense.id,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        fileSize: req.file.size
      } satisfies OperatingReceiptMeta)
    }
  });

  await logActivity({
    entityType: 'finance_entry',
    entityId: created.id,
    action: 'create',
    message: `Operating receipt uploaded: ${req.file.originalname}`,
    userId: req.auth?.userId
  });

  res.status(201).json(created);
});

financesRouter.delete('/operating-expenses/:expenseId/receipts/:receiptId', async (req, res) => {
  const expenseId = routeParam(req.params.expenseId);
  const receiptId = routeParam(req.params.receiptId);
  const receipt = await prisma.financeEntry.findUnique({
    where: { id: receiptId }
  });
  const meta = parseReceiptMeta(receipt?.description);
  if (!receipt || receipt.type !== OPERATING_RECEIPT_TYPE || !meta || meta.expenseId !== expenseId) {
    return res.status(404).json({ message: 'Operating receipt not found' });
  }

  const filePath = path.resolve(uploadDir, meta.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await prisma.financeEntry.delete({ where: { id: receipt.id } });

  await logActivity({
    entityType: 'finance_entry',
    entityId: receipt.id,
    action: 'delete',
    message: `Operating receipt deleted: ${meta.originalName}`,
    userId: req.auth?.userId
  });

  res.status(204).send();
});

financesRouter.delete('/operating-expenses/:id', async (req, res) => {
  const entry = await prisma.financeEntry.findUnique({
    where: { id: req.params.id }
  });
  if (!entry || entry.projectId || !OPERATING_EXPENSE_TYPES.includes(entry.type as (typeof OPERATING_EXPENSE_TYPES)[number])) {
    return res.status(404).json({ message: 'Operating expense not found' });
  }

  const receipts = await prisma.financeEntry.findMany({
    where: {
      projectId: null,
      type: OPERATING_RECEIPT_TYPE
    }
  });
  const relatedReceipts = receipts
    .map(receipt => ({ receipt, meta: parseReceiptMeta(receipt.description) }))
    .filter(item => item.meta?.expenseId === entry.id);

  for (const { meta } of relatedReceipts) {
    if (!meta) continue;
    const filePath = path.resolve(uploadDir, meta.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await prisma.financeEntry.deleteMany({
    where: { id: { in: relatedReceipts.map(item => item.receipt.id) } }
  });
  await prisma.financeEntry.delete({ where: { id: entry.id } });

  await logActivity({
    entityType: 'finance_entry',
    entityId: entry.id,
    action: 'delete',
    message: `Operating expense deleted: ${entry.description ?? entry.id}`,
    userId: req.auth?.userId
  });

  res.status(204).send();
});

financesRouter.get('/invoice-files', async (_req, res) => {
  const files = await prisma.invoiceFile.findMany({
    include: {
      project: {
        select: {
          id: true,
          title: true,
          invoiceNumber: true,
          projectNumber: true
        }
      },
      client: {
        select: {
          id: true,
          name: true,
          clientNumber: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(files);
});

financesRouter.post('/invoice-files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File is required' });
  const projectId = typeof req.body.projectId === 'string' ? req.body.projectId.trim() : '';
  if (!projectId) return res.status(400).json({ message: 'projectId is required' });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, clientId: true, invoiceNumber: true }
  });
  if (!project) return res.status(404).json({ message: 'Project not found' });

  const created = await prisma.invoiceFile.create({
    data: {
      projectId: project.id,
      clientId: project.clientId,
      invoiceNumber: project.invoiceNumber ?? null,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      fileSize: req.file.size
    },
    include: {
      project: {
        select: {
          id: true,
          title: true,
          invoiceNumber: true,
          projectNumber: true
        }
      },
      client: {
        select: {
          id: true,
          name: true,
          clientNumber: true
        }
      }
    }
  });

  await logActivity({
    entityType: 'invoice_file',
    entityId: created.id,
    action: 'create',
    message: `Invoice file uploaded: ${created.originalName}`,
    userId: req.auth?.userId,
    clientId: created.clientId
  });

  res.status(201).json(created);
});

financesRouter.delete('/invoice-files/:id', async (req, res) => {
  const file = await prisma.invoiceFile.findUnique({
    where: { id: req.params.id }
  });
  if (!file) return res.status(404).json({ message: 'Invoice file not found' });

  const filePath = path.resolve(uploadDir, file.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await prisma.invoiceFile.delete({ where: { id: file.id } });

  await logActivity({
    entityType: 'invoice_file',
    entityId: file.id,
    action: 'delete',
    message: `Invoice file deleted: ${file.originalName}`,
    userId: req.auth?.userId,
    clientId: file.clientId
  });

  res.status(204).send();
});
