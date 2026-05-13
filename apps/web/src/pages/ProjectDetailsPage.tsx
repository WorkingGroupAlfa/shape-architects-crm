import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { api } from '../lib/api';
import { generatePdfBase64FromHtml, pdfBase64ToBlob } from '../lib/document-export';
import type { MailAttachContext } from '../components/mail/types';

const API_BASE = api.baseUrl;

type ProjectDetails = {
  id: string;
  invoiceNumber?: string | null;
  title: string;
  description?: string | null;
  status: 'DEVELOPMENT' | 'APPROVAL' | 'COMPLETED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  startDate?: string | null;
  endDate?: string | null;
  deadline?: string | null;
  notes?: string | null;
  income: number;
  expense: number;
  taxAmount: number;
  profit: number;
  clientId: string;
  client: { id: string; name: string; clientNumber: string; company?: string | null; notes?: string | null; address?: string | null; abn?: string | null };
  tasks: Array<{ id: string; title: string; date: string; reminderAt?: string | null; priority: string; status: string }>;
  finances: Array<{ id: string; type: string; amount: number; taxAmount: number; description?: string | null; createdAt: string }>;
  files: Array<{
    id: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    createdAt: string;
    fileSize: number;
    isAnnotated?: boolean;
    isInvoice?: boolean;
    annotationSourceId?: string | null;
    annotatedById?: string | null;
  }>;
  notesItems: Array<{ id: string; content: string; createdAt: string; userId?: string | null; user?: { id: string; name: string; email: string } | null }>;
  accesses: Array<{ id: string; userId: string; user: { id: string; name: string; email: string } }>;
};
type ProjectChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  userId?: string | null;
  user?: { id: string; name: string; email: string } | null;
};
type SessionUser = { id: string; name: string; email: string; role: 'ADMIN' | 'EMPLOYEE' };

type InvoiceFile = {
  id: string;
  projectId: string;
  clientId: string;
  invoiceNumber?: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
};

type ClientOption = { id: string; name: string; clientNumber: string };
type EmployeeOption = { id: string; name: string; email: string };
type DepositFraction = '1/4' | '1/3' | '1/2';

const ANNOTATABLE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const CHAT_IMAGE_PREFIX = '[[image-file:';
const DEPOSIT_RATIOS: Record<DepositFraction, number> = {
  '1/4': 0.25,
  '1/3': 1 / 3,
  '1/2': 0.5
};
const DEPOSIT_FRACTIONS: DepositFraction[] = ['1/4', '1/3', '1/2'];

const STATUS_LABELS: Record<ProjectDetails['status'], string> = {
  DEVELOPMENT: 'Development',
  APPROVAL: 'Approval',
  COMPLETED: 'Completed'
};

const PRIORITY_LABELS: Record<ProjectDetails['priority'], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  VERY_HIGH: 'Very High'
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const formatAud = (amount: number) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);

function parseChatImageFileId(content: string) {
  if (!content.startsWith(CHAT_IMAGE_PREFIX) || !content.endsWith(']]')) return null;
  const fileId = content.slice(CHAT_IMAGE_PREFIX.length, -2).trim();
  return fileId || null;
}

type GeneralForm = {
  invoiceNumber: string;
  clientId: string;
  title: string;
  status: 'DEVELOPMENT' | 'APPROVAL' | 'COMPLETED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  accessUserIds: string[];
  deadline: string;
  startDate: string;
  description: string;
  notes: string;
};

function toInputDate(date?: string | null) {
  if (!date) return '';
  const d = new Date(date);
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 16);
}

function formatDateDDMMYYYY(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type InvoiceLineItem = {
  id: string;
  description: string;
  qty: number;
  price: number;
};

function buildInvoiceHtml(params: {
  invoiceNumber: string;
  projectName: string;
  issueDate: string;
  dueDate: string;
  billToName: string;
  billToCompany: string;
  billToAddress: string;
  billToAbn: string;
  items: InvoiceLineItem[];
  subtotal: number;
}) {
  const gstAmount = Math.round(params.subtotal * 0.1);
  const exGst = params.subtotal - gstAmount;
  const itemRows = params.items
    .filter(item => item.description.trim().length > 0 || item.qty > 0 || item.price > 0)
    .map((item, index) => {
      const lineTotal = Math.round(item.qty * item.price);
      return `
        <tr>
          <td>${index + 1}.</td>
          <td>${escapeHtml(item.description)}</td>
          <td>${Math.round(item.qty)}</td>
          <td>${Math.round(item.price)} AUD</td>
          <td>${lineTotal} AUD</td>
        </tr>
      `;
    });

  while (itemRows.length < 5) {
    itemRows.push(`
      <tr>
        <td>&nbsp;</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    `);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    /*__LOCAL_NOW_FONTS__*/
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      background: #efefef;
      color: #101727;
    }
    .page {
      width: 210mm;
      height: 297mm;
      margin: 0 auto;
      background: #efefef;
      padding: 10mm 12mm 10mm;
      position: relative;
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 8mm;
      margin-bottom: 4mm;
    }
    .logo {
      width: 66mm;
      max-height: 18mm;
      height: auto;
      object-fit: contain;
      object-position: right center;
      display: block;
    }
    .title {
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      letter-spacing: 0.16em;
      font-size: 13mm;
      margin: 0;
    }
    .top-line {
      border-top: 0.35mm solid #222;
      margin-bottom: 6mm;
    }
    .meta-grid {
      display: grid;
      gap: 2.4mm;
      margin-bottom: 14mm;
      font-size: 3.5mm;
    }
    .meta-row {
      display: flex;
      align-items: baseline;
      gap: 8mm;
    }
    .meta-label {
      width: 34mm;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      letter-spacing: 0.1em;
      flex: 0 0 34mm;
    }
    .meta-value {
      color: #666;
      letter-spacing: 0.06em;
    }
    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16mm;
      margin-bottom: 0;
      font-size: 3.5mm;
    }
    .parties-title {
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      letter-spacing: 0.13em;
      margin-bottom: 2mm;
    }
    .party-text {
      white-space: pre-line;
      line-height: 1.35;
      color: #666;
    }
    .table {
      width: 100%;
      margin-left: 0;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 7mm;
      font-size: 3.6mm;
    }
    .table th {
      text-align: left;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      letter-spacing: 0.11em;
      padding: 1.6mm 1.2mm;
    }
    .table th.n,
    .table th.qty,
    .table th.price,
    .table th.total {
      text-align: center;
    }
    .table td {
      padding: 2.2mm 1.2mm;
      border-bottom: 0.25mm solid #4c4c4c;
      vertical-align: middle;
    }
    .table tbody td {
      color: #666;
    }
    .table tbody td:nth-child(-n+4) {
      border-right: 0.25mm solid #4c4c4c;
    }
    .table tbody td:nth-child(1),
    .table tbody td:nth-child(3),
    .table tbody td:nth-child(4),
    .table tbody td:nth-child(5) {
      text-align: center;
    }
    .table tbody tr:last-child td {
      border-bottom: none;
      padding-bottom: 8.5mm;
    }
    .table .n { width: 12mm; }
    .table .qty { width: 15mm; }
    .table .price { width: 32mm; }
    .table .total { width: 35mm; }
    .services-block {
      margin-top: 0;
      position: relative;
      top: 30mm;
    }
    .summary {
      margin-top: 6mm;
      margin-left: auto;
      width: 50%;
      font-size: 3.7mm;
    }
    .summary-note {
      margin-bottom: 4mm;
      text-align: right;
      color: #666;
      letter-spacing: 0.05em;
    }
    .summary-total {
      border-top: 0.35mm solid #222;
      border-bottom: 0.35mm solid #222;
      padding: 2.4mm 0;
      display: flex;
      justify-content: space-between;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .bank {
      margin-top: 0;
      font-size: 3.7mm;
      line-height: 1.5;
      letter-spacing: 0.06em;
      color: #666;
    }
    .bank div { white-space: nowrap; }
    .bank strong {
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      display: inline-block;
      width: 30mm;
      color: #101727;
    }
    .bottom-row {
      margin-top: 0;
      position: absolute;
      left: 12mm;
      right: 12mm;
      bottom: 10mm;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16mm;
      align-items: start;
    }
    .signoff {
      margin-top: 0;
      width: 100%;
    }
    .signature-line {
      border-top: 0.35mm solid #222;
      margin-bottom: 2.2mm;
    }
    .thanks {
      text-align: center;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="title">INVOICE</div>
      <img class="logo" src="__LOCAL_TEMPLATE_LOGO__" alt="Shape Architects logo" />
    </div>
    <div class="top-line"></div>

    <div class="meta-grid">
      <div class="meta-row"><div class="meta-label">INVOICE NR:</div><div class="meta-value">${escapeHtml(params.invoiceNumber)}</div></div>
      <div class="meta-row"><div class="meta-label">PROJECT NAME:</div><div class="meta-value">${escapeHtml(params.projectName)}</div></div>
      <div class="meta-row"><div class="meta-label">DATE:</div><div class="meta-value">${formatDateDDMMYYYY(params.issueDate)}</div></div>
      <div class="meta-row"><div class="meta-label">DUE DATE:</div><div class="meta-value">${formatDateDDMMYYYY(params.dueDate)}</div></div>
    </div>

    <div class="parties">
      <div>
        <div class="parties-title">BILL TO:</div>
        <div class="party-text">${escapeHtml(params.billToName || '-')}
${escapeHtml(params.billToCompany || '-')}
${escapeHtml(params.billToAddress)}
ABN: ${escapeHtml(params.billToAbn || '-')}
Project: ${escapeHtml(params.projectName || '-')}</div>
      </div>
      <div>
        <div class="parties-title">PAYABLE TO:</div>
        <div class="party-text">Shape Architects
Company details to be added
https://shapearchitects.com.au</div>
      </div>
    </div>

    <div class="services-block">
      <table class="table">
        <thead>
          <tr>
            <th class="n">NO.</th>
            <th>DESCRIPTION</th>
            <th class="qty">QTY</th>
            <th class="price">PRICE</th>
            <th class="total">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows.join('')}
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-total"><span>TOTAL AMOUNT:</span><span>${params.subtotal} AUD</span></div>
        <div class="summary-note">Incl. GST (10%) — ${gstAmount} AUD &nbsp;|&nbsp; Ex-GST — ${exGst} AUD</div>
      </div>
    </div>

    <div class="bottom-row">
      <div class="bank">
        <div><strong>BANK NAME:</strong> Commonwealth Bank</div>
        <div><strong>ACCOUNT:</strong> 1086 4248</div>
        <div><strong>BSB:</strong> 065-005</div>
      </div>
      <div class="signoff">
        <div class="signature-line"></div>
        <div class="thanks">THANK YOU</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function GeneralTab({
  project,
  clients,
  employees
}: {
  project: ProjectDetails;
  clients: ClientOption[];
  employees: EmployeeOption[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GeneralForm>({
    invoiceNumber: project.invoiceNumber ?? '',
    clientId: project.clientId,
    title: project.title,
    status: project.status,
    priority: project.priority,
    accessUserIds: project.accesses.map(item => item.userId),
    deadline: toInputDate(project.deadline),
    startDate: toInputDate(project.startDate),
    description: project.description ?? '',
    notes: project.notes ?? ''
  });

  useEffect(() => {
    setForm({
      invoiceNumber: project.invoiceNumber ?? '',
      clientId: project.clientId,
      title: project.title,
      status: project.status,
      priority: project.priority,
      accessUserIds: project.accesses.map(item => item.userId),
      deadline: toInputDate(project.deadline),
      startDate: toInputDate(project.startDate),
      description: project.description ?? '',
      notes: project.notes ?? ''
    });
  }, [project]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<ProjectDetails>(`/projects/${project.id}`, {
        invoiceNumber: form.invoiceNumber.trim() || null,
        clientId: form.clientId,
        title: form.title,
        status: form.status,
        priority: form.priority,
        accessUserIds: form.accessUserIds,
        deadline: form.deadline || null,
        startDate: form.startDate || null,
        description: form.description || null,
        notes: form.notes || null
      }),
    onSuccess: updated => {
      queryClient.setQueryData(['project-details', project.id], updated);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  });

  const canSaveGeneral = form.title.trim().length >= 2;
  const toggleAccessUser = (userId: string) => {
    setForm(prev => ({
      ...prev,
      accessUserIds: prev.accessUserIds.includes(userId)
        ? prev.accessUserIds.filter(id => id !== userId)
        : [...prev.accessUserIds, userId]
    }));
  };

  return (
    <Card>
      <h3>General</h3>
      <div className="info-grid">
        <label className="info-field">
          <span className="muted small">Invoice Number</span>
          <input className="input" value={form.invoiceNumber} onChange={e => setForm(prev => ({ ...prev, invoiceNumber: e.target.value }))} />
        </label>
        <label className="info-field">
          <span className="muted small">Client</span>
          <select className="input" value={form.clientId} onChange={e => setForm(prev => ({ ...prev, clientId: e.target.value }))}>
            {clients.map(c => <option key={c.id} value={c.id}>{c.clientNumber} — {c.name}</option>)}
          </select>
        </label>
        <label className="info-field info-field-span2">
          <span className="muted small">Work Title</span>
          <input className="input" value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
        </label>
      </div>

      <div className="proj-detail-attr-block">
        <div className="proj-detail-attr-row">
          <span className="proj-detail-attr-label">Status</span>
          <div className="proj-detail-attr-btns">
            {(['DEVELOPMENT', 'APPROVAL', 'COMPLETED'] as const).map(s => (
              <button
                key={s}
                type="button"
                className={`cal-type-btn proj-status-${s.toLowerCase()}${form.status === s ? ' active' : ''}`}
                onClick={() => setForm(prev => ({ ...prev, status: s }))}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="proj-detail-attr-row">
          <span className="proj-detail-attr-label">Priority</span>
          <div className="proj-detail-attr-btns">
            {(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const).map(p => (
              <button
                key={p}
                type="button"
                className={`cal-type-btn proj-priority-${p.toLowerCase()}${form.priority === p ? ' active' : ''}`}
                onClick={() => setForm(prev => ({ ...prev, priority: p }))}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        {employees.length > 0 && (
          <div className="proj-detail-attr-row">
            <span className="proj-detail-attr-label">Team</span>
            <div className="proj-detail-attr-btns">
              {employees.map(emp => (
                <button
                  key={emp.id}
                  type="button"
                  className={`proj-access-chip${form.accessUserIds.includes(emp.id) ? ' active' : ''}`}
                  onClick={() => toggleAccessUser(emp.id)}
                >
                  {emp.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="info-grid" style={{ marginTop: 12 }}>
        <label className="info-field">
          <span className="muted small">Start Date</span>
          <div className="proj-detail-date-wrap">
            <input
              className="input"
              type="date"
              value={form.startDate ? form.startDate.slice(0, 10) : ''}
              onChange={e => setForm(prev => ({ ...prev, startDate: e.target.value }))}
            />
            <svg className="proj-detail-date-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
        </label>
        <label className="info-field">
          <span className="muted small">Deadline</span>
          <div className="proj-detail-date-wrap">
            <input
              className="input"
              type="date"
              value={form.deadline ? form.deadline.slice(0, 10) : ''}
              onChange={e => setForm(prev => ({ ...prev, deadline: e.target.value }))}
            />
            <svg className="proj-detail-date-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
        </label>
        <label className="info-field info-field-span2">
          <span className="muted small">Description <span className="cal-label-opt">(optional)</span></span>
          <textarea className="input textarea" value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
        </label>
        <label className="info-field info-field-span2">
          <span className="muted small">Terms <span className="cal-label-opt">(optional)</span></span>
          <textarea className="input textarea" value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
        </label>
      </div>

      <div className="save-row">
        <button className="primary-btn" type="button" onClick={() => saveMutation.mutate()} disabled={!canSaveGeneral || saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </Card>
  );
}

function FinanceTab({ project }: { project: ProjectDetails }) {
  const queryClient = useQueryClient();
  const [income, setIncome] = useState(String(project.income));
  const [expense, setExpense] = useState(String(project.expense));
  const [depositFraction, setDepositFraction] = useState<DepositFraction>('1/3');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');

  useEffect(() => {
    setIncome(String(project.income));
    setExpense(String(project.expense));
  }, [project]);

  const calc = useMemo(() => {
    const incomeN = Number(income) || 0;
    const expenseN = Number(expense) || 0;
    const tax = Number((incomeN * 0.1).toFixed(2));
    const profit = Number((incomeN - expenseN).toFixed(2));
    return { incomeN, expenseN, tax, profit };
  }, [income, expense]);

  useEffect(() => {
    setDepositAmount(String(Number((calc.incomeN * DEPOSIT_RATIOS[depositFraction]).toFixed(2))));
  }, [calc.incomeN, depositFraction]);

  const depositEntries = useMemo(
    () => project.finances.filter(item => item.type === 'deposit'),
    [project.finances]
  );
  const paidDeposit = useMemo(
    () => Number(depositEntries.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
    [depositEntries]
  );
  const depositAmountN = Number(depositAmount) || 0;
  const depositRemaining = Number(Math.max(calc.incomeN - paidDeposit, 0).toFixed(2));

  const saveMutation = useMutation({
    mutationFn: () => api.patch<ProjectDetails>(`/projects/${project.id}/financials`, { income: calc.incomeN, expense: calc.expenseN }),
    onSuccess: updated => {
      queryClient.setQueryData(['project-details', project.id], updated);
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    }
  });

  const depositMutation = useMutation({
    mutationFn: () =>
      api.post<ProjectDetails>(`/projects/${project.id}/deposits`, {
        fraction: depositFraction,
        amount: depositAmountN,
        note: depositNote.trim() || undefined
      }),
    onSuccess: updated => {
      setDepositNote('');
      queryClient.setQueryData(['project-details', project.id], updated);
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    }
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <>
      {/* Finance — KPI + inline edit in one card */}
      <Card>
        <h3>Finance</h3>

        <div className="proj-detail-kpi-row">
          <div className="proj-detail-kpi">
            <div className="proj-detail-kpi-label">Income</div>
            <div className="proj-detail-kpi-value">{formatAud(calc.incomeN)}</div>
          </div>
          <div className="proj-detail-kpi">
            <div className="proj-detail-kpi-label">Expense</div>
            <div className="proj-detail-kpi-value">{formatAud(calc.expenseN)}</div>
          </div>
          <div className="proj-detail-kpi">
            <div className="proj-detail-kpi-label">Tax (10%)</div>
            <div className="proj-detail-kpi-value">{formatAud(calc.tax)}</div>
          </div>
          <div className="proj-detail-kpi">
            <div className="proj-detail-kpi-label">Profit</div>
            <div className={`proj-detail-kpi-value${calc.profit >= 0 ? ' positive' : ' negative'}`}>{formatAud(calc.profit)}</div>
          </div>
        </div>

        <div className="proj-detail-fin-edit-row">
          <label className="info-field">
            <span className="muted small">Income</span>
            <input className="input" type="number" value={income} onChange={e => setIncome(e.target.value)} />
          </label>
          <label className="info-field">
            <span className="muted small">Expense</span>
            <input className="input" type="number" value={expense} onChange={e => setExpense(e.target.value)} />
          </label>
          <button className="primary-btn" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Card>

      {/* Deposit + History — side by side */}
      <div className="proj-detail-fin-cols">
        <Card>
          <div className="section-head">
            <h3>Deposit</h3>
            <span className="muted small">
              {depositEntries.length ? `${depositEntries.length} payment${depositEntries.length === 1 ? '' : 's'}` : 'No deposits yet'}
            </span>
          </div>

          <div className="proj-detail-fin-metrics">
            <div className="proj-detail-fin-metric">
              <span className="proj-detail-fin-metric-label">Contract</span>
              <span className="proj-detail-fin-metric-value">{formatAud(calc.incomeN)}</span>
            </div>
            <div className="proj-detail-fin-metric">
              <span className="proj-detail-fin-metric-label">Paid</span>
              <span className="proj-detail-fin-metric-value">{formatAud(paidDeposit)}</span>
            </div>
            <div className="proj-detail-fin-metric">
              <span className="proj-detail-fin-metric-label">Remaining</span>
              <span className="proj-detail-fin-metric-value">{formatAud(depositRemaining)}</span>
            </div>
          </div>

          <div className="info-grid">
            <label className="info-field">
              <span className="muted small">Deposit part</span>
              <select className="input" value={depositFraction} onChange={e => setDepositFraction(e.target.value as DepositFraction)}>
                {DEPOSIT_FRACTIONS.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="info-field">
              <span className="muted small">Paid amount</span>
              <input className="input" type="number" min="0" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
            </label>
            <label className="info-field info-field-span2">
              <span className="muted small">Note <span className="cal-label-opt">(optional)</span></span>
              <input className="input" value={depositNote} onChange={e => setDepositNote(e.target.value)} placeholder="Payment note" />
            </label>
          </div>

          <div className="inline-actions" style={{ marginTop: 10 }}>
            <button className="primary-btn" type="button" onClick={() => depositMutation.mutate()} disabled={depositMutation.isPending || depositAmountN <= 0}>
              {depositMutation.isPending ? 'Saving...' : 'Mark Deposit Paid'}
            </button>
            <span className="muted small">{depositFraction} = {formatAud(calc.incomeN * DEPOSIT_RATIOS[depositFraction])}</span>
          </div>

          {depositEntries.length > 0 && (
            <div className="proj-detail-fin-hist-list" style={{ marginTop: 12 }}>
              {depositEntries.slice(0, 4).map(item => (
                <div key={item.id} className="proj-detail-fin-hist-item">
                  <span className="proj-detail-fin-hist-type">deposit</span>
                  <span className="proj-detail-fin-hist-desc">{item.description || 'Deposit paid'}</span>
                  <span className="proj-detail-fin-hist-date">{fmtDate(item.createdAt)}</span>
                  <span className="proj-detail-fin-hist-amount">{formatAud(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3>Finance History</h3>
          {project.finances.length === 0 ? (
            <p className="muted small" style={{ paddingTop: 10 }}>No finance entries yet.</p>
          ) : (
            <div className="proj-detail-fin-hist-list">
              {project.finances.map(item => (
                <div key={item.id} className="proj-detail-fin-hist-item">
                  <span className="proj-detail-fin-hist-type">{item.type}</span>
                  <span className="proj-detail-fin-hist-desc">{item.description || '—'}</span>
                  <span className="proj-detail-fin-hist-date">{fmtDate(item.createdAt)}</span>
                  <span className="proj-detail-fin-hist-amount">{formatAud(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function TasksTab({ project, role }: { project: ProjectDetails; role: 'ADMIN' | 'EMPLOYEE' }) {
  const queryClient = useQueryClient();
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    date: '',
    reminderAt: '',
    priority: 'medium'
  });

  const statusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: 'TODO' | 'DONE' }) =>
      api.patch(`/projects/${project.id}/tasks/${taskId}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-details', project.id] })
  });

  const createTaskMutation = useMutation({
    mutationFn: () =>
      api.post(`/projects/${project.id}/reminders`, {
        title: taskForm.title,
        description: taskForm.description || undefined,
        date: taskForm.date,
        reminderAt: taskForm.reminderAt || undefined,
        priority: taskForm.priority
      }),
    onSuccess: () => {
      setTaskForm({ title: '', description: '', date: '', reminderAt: '', priority: 'medium' });
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => api.delete(`/projects/${project.id}/tasks/${taskId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-details', project.id] })
  });

  const canCreate = taskForm.title.trim().length >= 2 && Boolean(taskForm.date);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

  const taskCalIcon = (
    <svg className="proj-detail-date-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );

  return (
    <Card>
      <h3>Tasks</h3>

      {role === 'ADMIN' ? (
        <div className="proj-task-form">
          <input
            className="input"
            placeholder="Task title *"
            value={taskForm.title}
            onChange={e => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
          />
          <div className="info-grid">
            <label className="info-field">
              <span className="muted small">Date *</span>
              <div className="proj-detail-date-wrap">
                <input
                  className="input"
                  type="date"
                  value={taskForm.date ? taskForm.date.slice(0, 10) : ''}
                  onChange={e => setTaskForm(prev => ({ ...prev, date: e.target.value }))}
                />
                {taskCalIcon}
              </div>
            </label>
            <label className="info-field">
              <span className="muted small">Reminder <span className="cal-label-opt">(optional)</span></span>
              <div className="proj-detail-date-wrap">
                <input
                  className="input"
                  type="date"
                  value={taskForm.reminderAt ? taskForm.reminderAt.slice(0, 10) : ''}
                  onChange={e => setTaskForm(prev => ({ ...prev, reminderAt: e.target.value }))}
                />
                {taskCalIcon}
              </div>
            </label>
          </div>
          <input
            className="input"
            placeholder="Description (optional)"
            value={taskForm.description}
            onChange={e => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
          />
          <div className="proj-detail-attr-row" style={{ padding: '4px 0 0', border: 'none' }}>
            <span className="proj-detail-attr-label">Priority</span>
            <div className="proj-detail-attr-btns">
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  className={`cal-type-btn proj-priority-${p}${taskForm.priority === p ? ' active' : ''}`}
                  onClick={() => setTaskForm(prev => ({ ...prev, priority: p }))}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="proj-task-form-footer">
            <button
              className="primary-btn"
              type="button"
              onClick={() => createTaskMutation.mutate()}
              disabled={!canCreate || createTaskMutation.isPending}
            >
              {createTaskMutation.isPending ? 'Adding…' : '+ Add Task'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="proj-detail-task-list">
        {project.tasks.length === 0 && (
          <p className="proj-files-empty">No tasks yet.</p>
        )}
        {project.tasks.map(task => (
          <div key={task.id} className={`proj-detail-task-item${task.status === 'DONE' ? ' done' : ''}`}>
            <input
              type="checkbox"
              className="proj-detail-task-check"
              checked={task.status === 'DONE'}
              onChange={e => statusMutation.mutate({ taskId: task.id, status: e.target.checked ? 'DONE' : 'TODO' })}
            />
            <div className="proj-detail-task-body">
              <div className="proj-detail-task-title">{task.title}</div>
              <div className="proj-detail-task-meta">{fmtDate(task.date)}</div>
            </div>
            <span className={`proj-detail-task-priority proj-detail-task-p-${task.priority.toLowerCase()}`}>
              {task.priority.charAt(0).toUpperCase() + task.priority.slice(1).toLowerCase()}
            </span>
            {role === 'ADMIN' ? (
              <button
                className="proj-detail-task-del"
                type="button"
                onClick={() => deleteTaskMutation.mutate(task.id)}
                disabled={deleteTaskMutation.isPending}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function FilesTab({ project, role }: { project: ProjectDetails; role: 'ADMIN' | 'EMPLOYEE' }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachingFileId, setAttachingFileId] = useState<string | null>(null);
  const [sendingToChatFileId, setSendingToChatFileId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isAnnotateMode, setIsAnnotateMode] = useState(false);
  const [annotationDirty, setAnnotationDirty] = useState(false);
  const [brushColor, setBrushColor] = useState('#f4f7fb');
  const [brushSize, setBrushSize] = useState(4);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const fileBaseUrl = API_BASE.replace(/\/api$/, '');

  const uploadMutation = useMutation({
    mutationFn: async (uploadFile: File) => {
      const form = new FormData();
      form.append('file', uploadFile);
      const response = await fetch(`${API_BASE}/projects/${project.id}/files`, {
        method: 'POST',
        body: form,
        headers: api.authHeaders()
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    },
    onSuccess: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
    }
  });

  const handleFileSelect = (f: File | null | undefined) => {
    if (f && !uploadMutation.isPending) uploadMutation.mutate(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const response = await fetch(`${API_BASE}/projects/${project.id}/files/${fileId}`, { method: 'DELETE', headers: api.authHeaders() });
      if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-details', project.id] })
  });

  const attachContextMutation = useMutation({
    mutationFn: (fileId: string) => api.get<MailAttachContext>(`/projects/${project.id}/files/${fileId}/mail-attach-context`),
    onSuccess: context => {
      navigate(`/clients/${context.clientId}/mailing`, {
        state: { mailPrefill: context }
      });
    },
    onSettled: () => setAttachingFileId(null)
  });

  const sendToChatMutation = useMutation({
    mutationFn: (fileId: string) => api.post(`/projects/${project.id}/comments`, { content: `${CHAT_IMAGE_PREFIX}${fileId}]]` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] });
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
      navigate(`/projects/${project.id}/chat`);
    },
    onSettled: () => setSendingToChatFileId(null)
  });

  const previewFile = useMemo(
    () => (previewFileId ? project.files.find(item => item.id === previewFileId) ?? null : null),
    [project.files, previewFileId]
  );
  const previewUrl = previewFile ? `${fileBaseUrl}/storage/uploads/${previewFile.storedName}` : '';
  const previewContentApiUrl = previewFile ? `${API_BASE}/projects/${project.id}/files/${previewFile.id}/content` : '';
  const isPreviewImage = previewFile ? ANNOTATABLE_MIMES.has((previewFile.mimeType || '').toLowerCase()) : false;

  const syncAnnotationCanvasSize = () => {
    if (!isAnnotateMode) return;
    const img = previewImageRef.current;
    const canvas = annotationCanvasRef.current;
    if (!img || !canvas) return;

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      const prev = document.createElement('canvas');
      prev.width = canvas.width;
      prev.height = canvas.height;
      const prevCtx = prev.getContext('2d');
      if (prevCtx && canvas.width && canvas.height) {
        prevCtx.drawImage(canvas, 0, 0);
      }
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${Math.round(rect.width)}px`;
      canvas.style.height = `${Math.round(rect.height)}px`;
      const ctx = canvas.getContext('2d');
      if (ctx && prev.width && prev.height) {
        ctx.drawImage(prev, 0, 0, canvas.width, canvas.height);
      }
    } else {
      canvas.style.width = `${Math.round(rect.width)}px`;
      canvas.style.height = `${Math.round(rect.height)}px`;
    }
  };

  useEffect(() => {
    if (!isAnnotateMode) return;
    const onResize = () => syncAnnotationCanvasSize();
    window.addEventListener('resize', onResize);
    const timer = window.setTimeout(() => syncAnnotationCanvasSize(), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [isAnnotateMode, previewFileId]);

  const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  const drawStrokeStart = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = annotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = getCanvasPoint(event);
    if (!canvas || !ctx || !point) return;
    canvas.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize * (window.devicePixelRatio || 1);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const drawStrokeMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (!isDrawingRef.current) return;
    const canvas = annotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = getCanvasPoint(event);
    if (!ctx || !point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setAnnotationDirty(true);
  };

  const drawStrokeEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = annotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas) canvas.releasePointerCapture(event.pointerId);
    if (!ctx) return;
    isDrawingRef.current = false;
    ctx.closePath();
  };

  const clearAnnotation = () => {
    const canvas = annotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setAnnotationDirty(false);
  };

  const saveAnnotationMutation = useMutation({
    mutationFn: async () => {
      if (!previewFile || !isPreviewImage) throw new Error('Only JPG/JPEG/PNG can be annotated');
      const canvas = annotationCanvasRef.current;
      if (!canvas) throw new Error('Preview is not ready');

      const sourceResponse = await fetch(previewContentApiUrl, {
        headers: api.authHeaders()
      });
      if (!sourceResponse.ok) {
        throw new Error(`Failed to load image: ${sourceResponse.status}`);
      }
      const sourceBlob = await sourceResponse.blob();

      const exportCanvas = document.createElement('canvas');
      let imageWidth = 0;
      let imageHeight = 0;
      const exportCtx = exportCanvas.getContext('2d');
      if (!exportCtx) throw new Error('Unable to init export canvas');

      if ('createImageBitmap' in window) {
        const bitmap = await createImageBitmap(sourceBlob);
        imageWidth = bitmap.width;
        imageHeight = bitmap.height;
        exportCanvas.width = imageWidth;
        exportCanvas.height = imageHeight;
        exportCtx.drawImage(bitmap, 0, 0, imageWidth, imageHeight);
        bitmap.close();
      } else {
        const tempUrl = URL.createObjectURL(sourceBlob);
        try {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to decode image'));
            img.src = tempUrl;
          });
          imageWidth = image.naturalWidth || image.width;
          imageHeight = image.naturalHeight || image.height;
          exportCanvas.width = imageWidth;
          exportCanvas.height = imageHeight;
          exportCtx.drawImage(image, 0, 0, imageWidth, imageHeight);
        } finally {
          URL.revokeObjectURL(tempUrl);
        }
      }

      if (!imageWidth || !imageHeight) throw new Error('Invalid image size');
      exportCtx.drawImage(canvas, 0, 0, imageWidth, imageHeight);

      const blob = await new Promise<Blob | null>(resolve => exportCanvas.toBlob(resolve, 'image/png', 0.96));
      if (!blob) throw new Error('Unable to export annotation');

      const sourceBaseName = previewFile.originalName.replace(/\.[^.]+$/, '');
      const form = new FormData();
      form.append('annotationSourceFileId', previewFile.id);
      form.append('file', blob, `${sourceBaseName}-annotated.png`);

      const response = await fetch(`${API_BASE}/projects/${project.id}/files`, {
        method: 'POST',
        body: form,
        headers: api.authHeaders()
      });
      if (!response.ok) throw new Error(`Failed to save annotation: ${response.status}`);
      return response.json() as Promise<{ id: string }>;
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
      setIsAnnotateMode(false);
      setAnnotationDirty(false);
      setPreviewFileId(result.id);
    },
    onError: error => {
      window.alert(error instanceof Error ? error.message : 'Failed to save annotation');
    }
  });

  const closePreview = () => {
    setPreviewFileId(null);
    setIsAnnotateMode(false);
    setAnnotationDirty(false);
  };

  const openPreview = (fileId: string) => {
    setPreviewFileId(fileId);
    setIsAnnotateMode(false);
    setAnnotationDirty(false);
  };

  return (
    <>
      <Card className="project-files-card">
        <h3>Files</h3>

        <input
          ref={fileInputRef}
          className="files-upload-native-input"
          type="file"
          onChange={e => handleFileSelect(e.target.files?.[0])}
        />

        <div
          className={`proj-files-dropzone${isDragOver ? ' drag-over' : ''}${uploadMutation.isPending ? ' uploading' : ''}`}
          onDragOver={e => { e.preventDefault(); if (!uploadMutation.isPending) setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragOver(false);
            handleFileSelect(e.dataTransfer.files?.[0]);
          }}
          onClick={() => !uploadMutation.isPending && fileInputRef.current?.click()}
        >
          {uploadMutation.isPending ? (
            <div className="proj-files-dropzone-content">
              <span className="proj-files-spinner" />
              <span>Uploading…</span>
            </div>
          ) : (
            <div className="proj-files-dropzone-content">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 4v12m0-12L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              <span>Drop file here or <span className="proj-files-upload-link">click to browse</span></span>
            </div>
          )}
        </div>

        {project.files.length === 0 ? (
          <p className="proj-files-empty">No files uploaded yet</p>
        ) : (
          <div className="proj-files-list">
            {project.files.filter(item => role === 'ADMIN' || !item.isInvoice).map(item => {
              const fileUrl = `${fileBaseUrl}/storage/uploads/${item.storedName}`;
              const isImage = ANNOTATABLE_MIMES.has((item.mimeType || '').toLowerCase());
              const canSendToChat = isImage;
              return (
                <div key={item.id} className="proj-files-item">
                  <div className="proj-files-item-icon">
                    {isImage ? (
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.4"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    ) : item.mimeType === 'application/pdf' ? (
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.4"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.4"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    )}
                  </div>
                  <div className="proj-files-item-info">
                    <span className="proj-files-item-name">
                      {item.originalName}
                      {item.isAnnotated ? <span className="project-file-tag">Annotated</span> : null}
                      {item.isInvoice ? <span className="project-file-tag proj-files-tag-invoice">Invoice</span> : null}
                    </span>
                    <span className="proj-files-item-meta">
                      {new Date(item.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} · {formatFileSize(item.fileSize)}
                    </span>
                  </div>
                  <div className="proj-files-item-actions">
                    <button className="ghost-btn project-file-icon-btn" type="button" onClick={() => openPreview(item.id)} title="Preview">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.5 0 9.6 4.3 11 6.1a1.5 1.5 0 010 1.8C21.6 14.7 17.5 19 12 19S2.4 14.7 1 12.9a1.5 1.5 0 010-1.8C2.4 9.3 6.5 5 12 5zm0 2C7.8 7 4.5 10.2 3 12c1.5 1.8 4.8 5 9 5s7.5-3.2 9-5c-1.5-1.8-4.8-5-9-5zm0 2.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z" /></svg>
                    </button>
                    <a className="ghost-btn project-file-icon-btn" href={fileUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v8.17l2.59-2.58L17 11l-5 5-5-5 1.41-1.41L11 12.17V4zM5 18h14v2H5v-2z" /></svg>
                    </a>
                    {canSendToChat ? (
                      <button
                        className="ghost-btn project-file-icon-btn"
                        type="button"
                        onClick={() => { setSendingToChatFileId(item.id); sendToChatMutation.mutate(item.id); }}
                        disabled={sendToChatMutation.isPending}
                        title={sendingToChatFileId === item.id && sendToChatMutation.isPending ? 'Sending…' : 'Send to chat'}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.6 11.2L20.2 3.3a1 1 0 011.38 1.24L15 20.7a1 1 0 01-1.88-.06l-2.4-7-7-2.4a1 1 0 01-.12-1.9zm4.5.7l5.18 1.77 1.77 5.18 4.6-11.25L7.1 11.9z" /></svg>
                      </button>
                    ) : null}
                    {role === 'ADMIN' ? (
                      <button
                        className="ghost-btn project-file-icon-btn"
                        type="button"
                        onClick={() => { setAttachingFileId(item.id); attachContextMutation.mutate(item.id); }}
                        disabled={attachContextMutation.isPending}
                        title={attachingFileId === item.id && attachContextMutation.isPending ? 'Preparing…' : 'Attach to email'}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5l7.2-3.3a3 3 0 013.98 1.47 3 3 0 01-1.47 3.98l-7.04 3.23a1.75 1.75 0 01-2.33-.86 1.75 1.75 0 01.86-2.33l6.05-2.77.83 1.82-6.05 2.77a.25.25 0 00-.12.33.25.25 0 00.33.12l7.04-3.23a1.5 1.5 0 10-1.25-2.73L7.83 9.32A3.5 3.5 0 0011 15.7l6.5-2.98.83 1.81-6.5 2.98A5.5 5.5 0 016.7 7.68L7 7.5z" /></svg>
                      </button>
                    ) : null}
                    {role === 'ADMIN' ? (
                      <button className="ghost-btn project-file-icon-btn project-file-icon-danger" type="button" onClick={() => removeMutation.mutate(item.id)} title="Delete">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" /></svg>
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {previewFile ? (
        <div className="overlay file-preview-overlay" onClick={closePreview}>
          <div className="overlay-card file-preview-card-wrap" onClick={event => event.stopPropagation()}>
            <Card className="file-preview-card">
              <div className="file-preview-header">
              <div className="file-preview-title">
                <h3>{previewFile.originalName}</h3>
                <p className="muted small">
                  {new Date(previewFile.createdAt).toLocaleString()} · {(previewFile.fileSize / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="file-preview-top-actions">
                {role === 'ADMIN' && isPreviewImage ? (
                  <button
                    className={isAnnotateMode ? 'file-preview-icon-btn active' : 'file-preview-icon-btn'}
                    type="button"
                    onClick={() => {
                      setIsAnnotateMode(prev => {
                        const next = !prev;
                        if (!next) setAnnotationDirty(false);
                        return next;
                      });
                    }}
                    aria-label={isAnnotateMode ? 'Close annotate' : 'Annotate'}
                    title={isAnnotateMode ? 'Close annotate' : 'Annotate'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 000-1.41l-2.5-2.5a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.99-1.67z" />
                    </svg>
                  </button>
                ) : null}
                <button
                  className="file-preview-icon-btn"
                  type="button"
                  onClick={closePreview}
                  aria-label="Close preview"
                  title="Close preview"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.3 5.71a1 1 0 00-1.41 0L12 10.59 7.11 5.7A1 1 0 105.7 7.11L10.59 12l-4.9 4.89a1 1 0 101.42 1.41L12 13.41l4.89 4.9a1 1 0 001.41-1.42L13.41 12l4.9-4.89a1 1 0 00-.01-1.4z" />
                  </svg>
                </button>
              </div>
              </div>

              {isPreviewImage ? (
                <div className="file-preview-stage">
                  <img
                    ref={previewImageRef}
                    src={previewUrl}
                    alt={previewFile.originalName}
                    className="file-preview-image"
                    onLoad={() => syncAnnotationCanvasSize()}
                  />
                  {isAnnotateMode ? (
                    <canvas
                      ref={annotationCanvasRef}
                      className="file-preview-canvas"
                      onPointerDown={drawStrokeStart}
                      onPointerMove={drawStrokeMove}
                      onPointerUp={drawStrokeEnd}
                      onPointerCancel={drawStrokeEnd}
                      onPointerLeave={drawStrokeEnd}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="file-preview-fallback">
                  <p className="muted">Preview for this file type is limited in-app.</p>
                  <p className="muted small">Use Open or Download to view the file.</p>
                </div>
              )}

              {isAnnotateMode && role === 'ADMIN' && isPreviewImage ? (
                <div className="file-annotate-toolbar">
                  <div className="file-annotate-colors">
                    {['#f4f7fb', '#ffd27b', '#7ee2ff', '#ff9ab4', '#8ef1ad'].map(color => (
                      <button
                        key={color}
                        type="button"
                        className="file-annotate-color"
                        style={{ background: color }}
                        onClick={() => setBrushColor(color)}
                        aria-label={`Set brush color ${color}`}
                        data-active={brushColor === color}
                      />
                    ))}
                  </div>
                  <label className="file-annotate-size">
                    <span className="muted small">Brush</span>
                    <input
                      type="range"
                      min={2}
                      max={18}
                      value={brushSize}
                      onChange={event => setBrushSize(Number(event.target.value))}
                    />
                  </label>
                  <button className="ghost-btn" type="button" onClick={clearAnnotation}>Clear</button>
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => saveAnnotationMutation.mutate()}
                    disabled={!annotationDirty || saveAnnotationMutation.isPending}
                  >
                    {saveAnnotationMutation.isPending ? 'Saving...' : 'Save annotation'}
                  </button>
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CommentsTab({ project, currentUserId }: { project: ProjectDetails; currentUserId?: string }) {
  const queryClient = useQueryClient();
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatPreviewImageRef = useRef<HTMLImageElement | null>(null);
  const chatAnnotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chatIsDrawingRef = useRef(false);
  const [newComment, setNewComment] = useState('');
  const [openedImageFileId, setOpenedImageFileId] = useState<string | null>(null);
  const [chatImageFile, setChatImageFile] = useState<File | null>(null);
  const [chatImagePreviewUrl, setChatImagePreviewUrl] = useState('');
  const [chatDragOver, setChatDragOver] = useState(false);
  const [chatAnnotateMode, setChatAnnotateMode] = useState(false);
  const [chatAnnotationDirty, setChatAnnotationDirty] = useState(false);
  const [chatBrushColor, setChatBrushColor] = useState('#f4f7fb');
  const [chatBrushSize, setChatBrushSize] = useState(4);
  const [chatPreparingSend, setChatPreparingSend] = useState(false);
  const fileBaseUrl = API_BASE.replace(/\/api$/, '');
  const commentsQuery = useQuery({
    queryKey: ['project-comments', project.id],
    queryFn: () => api.get<ProjectChatMessage[]>(`/projects/${project.id}/comments`),
    refetchInterval: 2000
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/comments`, { content: newComment }),
    onSuccess: () => {
      setNewComment('');
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] });
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
    }
  });
  const sendChatImageMutation = useMutation({
    mutationFn: async (payload: { file: File; annotatedBlob?: Blob | null }) => {
      const uploadFile = payload.annotatedBlob
        ? new File(
            [payload.annotatedBlob],
            `${payload.file.name.replace(/\.[^.]+$/, '')}-annotated.png`,
            { type: 'image/png' }
          )
        : payload.file;
      const form = new FormData();
      form.append('file', uploadFile);
      const uploadResponse = await fetch(`${API_BASE}/projects/${project.id}/files`, {
        method: 'POST',
        body: form,
        headers: api.authHeaders()
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);
      const uploaded = await uploadResponse.json() as { id?: string };
      if (!uploaded.id) throw new Error('Uploaded file id was not returned');

      await api.post(`/projects/${project.id}/comments`, { content: `${CHAT_IMAGE_PREFIX}${uploaded.id}]]` });
      return uploaded.id;
    },
    onSuccess: () => {
      setChatImageFile(null);
      setChatImagePreviewUrl('');
      setChatAnnotateMode(false);
      setChatAnnotationDirty(false);
      queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] });
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
    },
    onError: error => {
      window.alert(error instanceof Error ? error.message : 'Failed to send image');
    },
    onSettled: () => setChatPreparingSend(false)
  });
  const messages = commentsQuery.data ?? project.notesItems;
  const filesById = useMemo(() => {
    const map = new Map<string, ProjectDetails['files'][number]>();
    for (const file of project.files) {
      map.set(file.id, file);
    }
    return map;
  }, [project.files]);
  const openedImageFile = openedImageFileId ? filesById.get(openedImageFileId) ?? null : null;
  const openedImageUrl = openedImageFile ? `${fileBaseUrl}/storage/uploads/${openedImageFile.storedName}` : '';

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (chatImagePreviewUrl) URL.revokeObjectURL(chatImagePreviewUrl);
    };
  }, [chatImagePreviewUrl]);

  const syncChatAnnotationCanvasSize = () => {
    if (!chatAnnotateMode) return;
    const img = chatPreviewImageRef.current;
    const canvas = chatAnnotationCanvasRef.current;
    if (!img || !canvas) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      const prev = document.createElement('canvas');
      prev.width = canvas.width;
      prev.height = canvas.height;
      const prevCtx = prev.getContext('2d');
      if (prevCtx && canvas.width && canvas.height) prevCtx.drawImage(canvas, 0, 0);
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${Math.round(rect.width)}px`;
      canvas.style.height = `${Math.round(rect.height)}px`;
      const ctx = canvas.getContext('2d');
      if (ctx && prev.width && prev.height) ctx.drawImage(prev, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.style.width = `${Math.round(rect.width)}px`;
      canvas.style.height = `${Math.round(rect.height)}px`;
    }
  };

  useEffect(() => {
    if (!chatAnnotateMode) return;
    const onResize = () => syncChatAnnotationCanvasSize();
    window.addEventListener('resize', onResize);
    const timer = window.setTimeout(() => syncChatAnnotationCanvasSize(), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [chatAnnotateMode, chatImagePreviewUrl]);

  const getChatCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = chatAnnotationCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  const drawChatStrokeStart = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = chatAnnotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = getChatCanvasPoint(event);
    if (!canvas || !ctx || !point) return;
    canvas.setPointerCapture(event.pointerId);
    chatIsDrawingRef.current = true;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = chatBrushColor;
    ctx.lineWidth = chatBrushSize * (window.devicePixelRatio || 1);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const drawChatStrokeMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (!chatIsDrawingRef.current) return;
    const ctx = chatAnnotationCanvasRef.current?.getContext('2d');
    const point = getChatCanvasPoint(event);
    if (!ctx || !point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setChatAnnotationDirty(true);
  };

  const drawChatStrokeEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = chatAnnotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas) canvas.releasePointerCapture(event.pointerId);
    if (!ctx) return;
    chatIsDrawingRef.current = false;
    ctx.closePath();
  };

  const clearChatAnnotation = () => {
    const canvas = chatAnnotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setChatAnnotationDirty(false);
  };

  const exportChatAnnotatedBlob = async (sourceFile: File) => {
    const canvas = chatAnnotationCanvasRef.current;
    if (!canvas) throw new Error('Preview canvas is not ready');
    const sourceBlob = sourceFile;
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) throw new Error('Unable to init export canvas');
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(sourceBlob);
      exportCanvas.width = bitmap.width;
      exportCanvas.height = bitmap.height;
      exportCtx.drawImage(bitmap, 0, 0);
      bitmap.close();
    } else {
      const tempUrl = URL.createObjectURL(sourceBlob);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Failed to decode image'));
          img.src = tempUrl;
        });
        exportCanvas.width = image.naturalWidth || image.width;
        exportCanvas.height = image.naturalHeight || image.height;
        exportCtx.drawImage(image, 0, 0);
      } finally {
        URL.revokeObjectURL(tempUrl);
      }
    }
    exportCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
    const blob = await new Promise<Blob | null>(resolve => exportCanvas.toBlob(resolve, 'image/png', 0.96));
    if (!blob) throw new Error('Unable to export annotation');
    return blob;
  };

  const sendSelectedChatImage = async () => {
    if (!chatImageFile || sendChatImageMutation.isPending || chatPreparingSend) return;
    setChatPreparingSend(true);
    try {
      let annotatedBlob: Blob | null = null;
      if (chatAnnotateMode && chatAnnotationDirty) {
        annotatedBlob = await exportChatAnnotatedBlob(chatImageFile);
      }
      sendChatImageMutation.mutate({ file: chatImageFile, annotatedBlob });
    } catch (error) {
      setChatPreparingSend(false);
      window.alert(error instanceof Error ? error.message : 'Failed to prepare image');
    }
  };

  const setSelectedChatImage = (file: File | null) => {
    if (!file) return;
    const mime = (file.type || '').toLowerCase();
    if (!ANNOTATABLE_MIMES.has(mime)) {
      window.alert('Only JPG, JPEG and PNG are allowed for chat images.');
      return;
    }
    if (chatImagePreviewUrl) URL.revokeObjectURL(chatImagePreviewUrl);
    const objectUrl = URL.createObjectURL(file);
    setChatImageFile(file);
    setChatImagePreviewUrl(objectUrl);
    setChatAnnotateMode(false);
    setChatAnnotationDirty(false);
  };

  const onChatFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setSelectedChatImage(selected);
    event.target.value = '';
  };

  const onChatDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setChatDragOver(true);
  };

  const onChatDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setChatDragOver(false);
    }
  };

  const onChatDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setChatDragOver(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    setSelectedChatImage(dropped);
  };

  const closeSendImageModal = () => {
    if (chatImagePreviewUrl) URL.revokeObjectURL(chatImagePreviewUrl);
    setChatImagePreviewUrl('');
    setChatImageFile(null);
    setChatAnnotateMode(false);
    setChatAnnotationDirty(false);
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <Card className="project-chat-card">
      <div className="section-head">
        <h3>Team Chat</h3>
      </div>

      <div
        className={chatDragOver ? 'project-chat-timeline chat-drag-over' : 'project-chat-timeline'}
        ref={timelineRef}
        onDragOver={onChatDragOver}
        onDragEnter={onChatDragOver}
        onDragLeave={onChatDragLeave}
        onDrop={onChatDrop}
      >
        {messages.map(item => {
          const isMine = currentUserId ? item.user?.id === currentUserId || item.userId === currentUserId : false;
          const author = item.user?.name || 'System';
          const imageFileId = parseChatImageFileId(item.content);
          const imageFile = imageFileId ? filesById.get(imageFileId) : undefined;
          const isImageMessage = Boolean(imageFile && ANNOTATABLE_MIMES.has((imageFile.mimeType || '').toLowerCase()));
          const imagePreviewUrl = imageFile ? `${fileBaseUrl}/storage/uploads/${imageFile.storedName}` : '';
          return (
            <div key={item.id} className={isMine ? 'project-chat-row mine' : 'project-chat-row'}>
              <div className={isImageMessage ? (isMine ? 'project-chat-bubble mine image-message' : 'project-chat-bubble image-message') : (isMine ? 'project-chat-bubble mine' : 'project-chat-bubble')}>
                <div className="project-chat-head">
                  <span className={isMine ? 'project-chat-author mine' : 'project-chat-author'}>{author}</span>
                  <span className="project-chat-date">{formatDate(item.createdAt)}</span>
                </div>
                {isImageMessage && imageFile ? (
                  <div className="project-chat-image-wrap">
                    <button
                      type="button"
                      className="project-chat-image-btn"
                      onClick={() => setOpenedImageFileId(imageFile.id)}
                      aria-label={`Open image ${imageFile.originalName}`}
                      title="Open image"
                    >
                      <img className="project-chat-image" src={imagePreviewUrl} alt={imageFile.originalName} loading="lazy" />
                    </button>
                    <div className="project-chat-time image-time">{formatTime(item.createdAt)}</div>
                  </div>
                ) : (
                  <div className="project-chat-text">{item.content}</div>
                )}
                {!isImageMessage ? <div className="project-chat-time">{formatTime(item.createdAt)}</div> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="project-chat-composer">
        <input
          ref={chatFileInputRef}
          className="chat-attach-native-input"
          type="file"
          accept="image/jpeg,image/jpg,image/png"
          onChange={onChatFilePick}
        />
        <button
          className="project-chat-attach-btn"
          type="button"
          onClick={() => chatFileInputRef.current?.click()}
          aria-label="Attach image"
          title="Attach image"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7.5l7.2-3.3a3 3 0 013.98 1.47 3 3 0 01-1.47 3.98l-7.04 3.23a1.75 1.75 0 01-2.33-.86 1.75 1.75 0 01.86-2.33l6.05-2.77.83 1.82-6.05 2.77a.25.25 0 00-.12.33.25.25 0 00.33.12l7.04-3.23a1.5 1.5 0 10-1.25-2.73L7.83 9.32A3.5 3.5 0 0011 15.7l6.5-2.98.83 1.81-6.5 2.98A5.5 5.5 0 016.7 7.68L7 7.5z" />
          </svg>
        </button>
        <textarea
          className="input project-chat-input"
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          placeholder="Type your message..."
        />
        <button
          className="project-chat-send-btn"
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!newComment.trim() || createMutation.isPending}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.4 11.2L19.9 3.6c.9-.4 1.8.5 1.4 1.4l-7.6 16.5c-.4.9-1.7.8-2-.1l-1.5-5-5-1.5c-.9-.3-1-.6-.8-1.7z" />
          </svg>
        </button>
      </div>

      {chatImageFile && chatImagePreviewUrl ? (
        <div className="overlay project-chat-upload-overlay" onClick={closeSendImageModal}>
          <div className="overlay-card project-chat-upload-modal" onClick={event => event.stopPropagation()}>
            <div className="project-chat-upload-head-row">
              <div className="project-chat-upload-head">
              <h4>Send Image</h4>
              <p className="muted small">{chatImageFile.name}</p>
              </div>
              <button
                type="button"
                className={chatAnnotateMode ? 'file-preview-icon-btn active' : 'file-preview-icon-btn'}
                onClick={() => {
                  setChatAnnotateMode(prev => {
                    const next = !prev;
                    if (!next) setChatAnnotationDirty(false);
                    return next;
                  });
                }}
                aria-label={chatAnnotateMode ? 'Close annotate' : 'Annotate'}
                title={chatAnnotateMode ? 'Close annotate' : 'Annotate'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 000-1.41l-2.5-2.5a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.99-1.67z" />
                </svg>
              </button>
            </div>
            <div className="project-chat-upload-stage">
              <img
                ref={chatPreviewImageRef}
                className="project-chat-upload-preview"
                src={chatImagePreviewUrl}
                alt={chatImageFile.name}
                onLoad={() => syncChatAnnotationCanvasSize()}
              />
              {chatAnnotateMode ? (
                <canvas
                  ref={chatAnnotationCanvasRef}
                  className="project-chat-upload-canvas"
                  onPointerDown={drawChatStrokeStart}
                  onPointerMove={drawChatStrokeMove}
                  onPointerUp={drawChatStrokeEnd}
                  onPointerCancel={drawChatStrokeEnd}
                  onPointerLeave={drawChatStrokeEnd}
                />
              ) : null}
            </div>
            {chatAnnotateMode ? (
              <div className="project-chat-upload-tools">
                <div className="file-annotate-colors">
                  {['#f4f7fb', '#ffd27b', '#7ee2ff', '#ff9ab4', '#8ef1ad'].map(color => (
                    <button
                      key={color}
                      type="button"
                      className="file-annotate-color"
                      style={{ background: color }}
                      onClick={() => setChatBrushColor(color)}
                      aria-label={`Set brush color ${color}`}
                      data-active={chatBrushColor === color}
                    />
                  ))}
                </div>
                <label className="file-annotate-size">
                  <span className="muted small">Brush</span>
                  <input type="range" min={2} max={18} value={chatBrushSize} onChange={event => setChatBrushSize(Number(event.target.value))} />
                </label>
                <button className="ghost-btn" type="button" onClick={clearChatAnnotation}>Clear</button>
              </div>
            ) : null}
            <div className="project-chat-upload-actions">
              <button className="ghost-btn" type="button" onClick={closeSendImageModal} disabled={sendChatImageMutation.isPending || chatPreparingSend}>Cancel</button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => {
                  void sendSelectedChatImage();
                }}
                disabled={sendChatImageMutation.isPending || chatPreparingSend}
              >
                {sendChatImageMutation.isPending || chatPreparingSend ? 'Sending...' : 'Send to Chat'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openedImageFile ? (
        <div className="overlay project-chat-image-overlay" onClick={() => setOpenedImageFileId(null)}>
          <div className="overlay-card project-chat-image-modal" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className="project-chat-image-close"
              aria-label="Close image preview"
              title="Close"
              onClick={() => setOpenedImageFileId(null)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <img className="project-chat-image-full" src={openedImageUrl} alt={openedImageFile.originalName} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function InvoiceBuilderTab({ project }: { project: ProjectDetails }) {
  const queryClient = useQueryClient();
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [projectName, setProjectName] = useState(project.title ?? '');
  const [billToAddress, setBillToAddress] = useState(project.client.address ?? '');
  const [billToAbn, setBillToAbn] = useState(project.client.abn ?? '');
  const [items, setItems] = useState<InvoiceLineItem[]>([
    { id: 'invoice-line-1', description: 'Exterior', qty: 1, price: 3000 }
  ]);

  useEffect(() => {
    setProjectName(project.title ?? '');
    setBillToAddress(project.client.address ?? '');
    setBillToAbn(project.client.abn ?? '');
  }, [project.title, project.client.address, project.client.abn]);

  const subtotal = useMemo(
    () => items.reduce((acc, item) => acc + Math.round(item.qty) * Math.round(item.price), 0),
    [items]
  );
  const gstAmount = useMemo(() => Math.round(subtotal * 0.1), [subtotal]);

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const html = buildInvoiceHtml({
        invoiceNumber: project.invoiceNumber || '-',
        projectName,
        issueDate,
        dueDate,
        billToName: project.client.name,
        billToCompany: project.client.company ?? '',
        billToAddress,
        billToAbn,
        items,
        subtotal
      });

      const formData = new FormData();
      const pdfBase64 = await generatePdfBase64FromHtml(html, `${project.invoiceNumber || 'invoice'}-invoice-${issueDate}.pdf`);
      const blob = pdfBase64ToBlob(pdfBase64);
      const fileName = `${project.invoiceNumber || 'invoice'}-invoice-${issueDate}.pdf`;
      formData.append('file', new File([blob], fileName, { type: 'application/pdf' }));
      formData.append('isInvoice', 'true');

      const response = await fetch(`${API_BASE}/projects/${project.id}/files`, {
        method: 'POST',
        body: formData,
        headers: api.authHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to save invoice: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
      window.alert('Invoice PDF saved to project Files.');
    },
    onError: error => {
      window.alert(error instanceof Error ? error.message : 'Failed to create invoice PDF.');
    }
  });

  const calIcon = (
    <svg className="proj-detail-date-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );

  return (
    <Card>
      <div className="proj-inv-header">
        <h3>Invoice Builder</h3>
        <span className="proj-inv-hint">Auto-filled from project · edit as needed</span>
      </div>

      <div className="proj-inv-section-label">Invoice Details</div>
      <div className="info-grid">
        <label className="info-field">
          <span className="muted small">Invoice Number</span>
          <input className="input" value={project.invoiceNumber || '-'} readOnly />
        </label>
        <label className="info-field">
          <span className="muted small">Issue Date</span>
          <div className="proj-detail-date-wrap">
            <input className="input" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            {calIcon}
          </div>
        </label>
        <label className="info-field">
          <span className="muted small">Project Name</span>
          <input className="input" value={projectName} onChange={e => setProjectName(e.target.value)} />
        </label>
        <label className="info-field">
          <span className="muted small">Due Date</span>
          <div className="proj-detail-date-wrap">
            <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            {calIcon}
          </div>
        </label>
      </div>

      <div className="proj-inv-section-label">Bill To</div>
      <div className="info-grid">
        <label className="info-field">
          <span className="muted small">Company</span>
          <input className="input" value={project.client.company ?? ''} readOnly />
        </label>
        <label className="info-field">
          <span className="muted small">ABN</span>
          <input className="input" value={billToAbn} onChange={e => setBillToAbn(e.target.value)} />
        </label>
        <label className="info-field info-field-span2">
          <span className="muted small">Address</span>
          <textarea className="input textarea" value={billToAddress} onChange={e => setBillToAddress(e.target.value)} />
        </label>
      </div>

      <div className="proj-inv-section-label">Service Lines</div>
      <div className="proj-inv-lines">
        <div className="proj-inv-lines-head">
          <span>Description</span>
          <span>Qty</span>
          <span>Price (AUD)</span>
          <span>Total</span>
          <span />
        </div>
        {items.map(item => (
          <div key={item.id} className="proj-inv-line-row">
            <input
              className="input"
              placeholder="Service description"
              value={item.description}
              onChange={e => setItems(prev => prev.map(line => line.id === item.id ? { ...line, description: e.target.value } : line))}
            />
            <input
              className="input"
              type="number"
              min={0}
              value={item.qty}
              onChange={e => {
                const next = Number(e.target.value);
                setItems(prev => prev.map(line => line.id === item.id ? { ...line, qty: Number.isFinite(next) ? next : 0 } : line));
              }}
            />
            <input
              className="input"
              type="number"
              min={0}
              value={item.price}
              onChange={e => {
                const next = Number(e.target.value);
                setItems(prev => prev.map(line => line.id === item.id ? { ...line, price: Number.isFinite(next) ? next : 0 } : line));
              }}
            />
            <span className="proj-inv-line-total">{formatAud(Math.round(item.qty) * Math.round(item.price))}</span>
            <button
              className="proj-inv-remove-btn"
              type="button"
              onClick={() => setItems(prev => prev.filter(line => line.id !== item.id))}
              disabled={items.length === 1}
              title="Remove line"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="proj-inv-footer">
        <button
          className="ghost-btn"
          type="button"
          onClick={() => setItems(prev => [...prev, { id: `invoice-line-${Date.now()}`, description: '', qty: 1, price: 0 }])}
        >
          + Add Line
        </button>
        <div className="proj-inv-totals">
          <div className="proj-inv-total-row proj-inv-total-final">
            <span>Total</span>
            <span>{formatAud(subtotal)}</span>
          </div>
          <div className="proj-inv-total-row proj-inv-total-gst">
            <span>Incl. GST (10%)</span>
            <span>{formatAud(gstAmount)}</span>
          </div>
          <div className="proj-inv-total-row proj-inv-total-gst">
            <span>Ex-GST</span>
            <span>{formatAud(subtotal - gstAmount)}</span>
          </div>
        </div>
      </div>

      <div className="save-row">
        <button className="primary-btn" type="button" onClick={() => createInvoiceMutation.mutate()} disabled={createInvoiceMutation.isPending}>
          {createInvoiceMutation.isPending ? 'Generating PDF...' : 'Generate Invoice PDF'}
        </button>
      </div>
    </Card>
  );
}

export function ProjectDetailsPage({ role = 'ADMIN' }: { role?: 'ADMIN' | 'EMPLOYEE' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = role === 'ADMIN';

  const projectQuery = useQuery({
    queryKey: ['project-details', id],
    queryFn: () => api.get<ProjectDetails>(`/projects/${id}`),
    enabled: Boolean(id)
  });

  const clientsQuery = useQuery({
    queryKey: ['clients-options'],
    queryFn: () => api.get<ClientOption[]>('/clients'),
    enabled: isAdmin
  });

  const employeesQuery = useQuery({
    queryKey: ['users-employees-options'],
    queryFn: () => api.get<EmployeeOption[]>('/users/employees'),
    enabled: isAdmin
  });
  const meQuery = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<SessionUser>('/auth/me')
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>(`/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      navigate('/projects');
    }
  });

  if (!projectQuery.data) return <div className="skeleton-page" />;

  const project = projectQuery.data;

  return (
    <div className="page-grid">
      <div className="proj-detail-header">
        <div className="proj-detail-top">
          <NavLink
            to="/projects"
            className="proj-detail-back"
            aria-label="Back to Projects"
            title="Back to Projects"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </NavLink>

          <div className="proj-detail-title-block">
            <h2 className="proj-detail-title">{project.title}</h2>
            <div className="proj-detail-meta-row">
              {project.invoiceNumber ? <span className="proj-detail-meta-text">{project.invoiceNumber}</span> : null}
              {project.invoiceNumber && isAdmin ? <span className="proj-detail-meta-text">·</span> : null}
              {isAdmin ? <span className="proj-detail-meta-text">{project.client.name}</span> : null}
              <span className={`proj-detail-badge proj-detail-status-${project.status.toLowerCase()}`}>
                {STATUS_LABELS[project.status]}
              </span>
              <span className={`proj-detail-badge proj-detail-priority-${project.priority.toLowerCase()}`}>
                {PRIORITY_LABELS[project.priority]}
              </span>
            </div>
          </div>

          {isAdmin ? (
            <button
              className="proj-detail-delete"
              type="button"
              onClick={() => {
                if (window.confirm('Delete this project? This cannot be undone.')) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              aria-label="Delete project"
              title="Delete project"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" />
              </svg>
            </button>
          ) : <span />}
        </div>

        <nav className="proj-detail-nav">
          {isAdmin ? <NavLink to="general" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>General</NavLink> : null}
          {isAdmin ? <NavLink to="finance" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Finance</NavLink> : null}
          {isAdmin ? <NavLink to="invoice" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Invoice Builder</NavLink> : null}
          <NavLink to="files" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Files</NavLink>
          <NavLink to="tasks" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Tasks</NavLink>
          <NavLink to="chat" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Chat</NavLink>
        </nav>
      </div>

      <Routes>
        <Route index element={<Navigate to={isAdmin ? 'general' : 'tasks'} replace />} />
        {isAdmin ? <Route path="general" element={<GeneralTab project={project} clients={clientsQuery.data ?? []} employees={employeesQuery.data ?? []} />} /> : null}
        {isAdmin ? <Route path="finance" element={<FinanceTab project={project} />} /> : null}
        {isAdmin ? <Route path="invoice" element={<InvoiceBuilderTab project={project} />} /> : null}
        <Route path="files" element={<FilesTab project={project} role={role} />} />
        <Route path="tasks" element={<TasksTab project={project} role={role} />} />
        <Route path="chat" element={<CommentsTab project={project} currentUserId={meQuery.data?.id} />} />
        <Route path="comments" element={<Navigate to="../chat" replace />} />
        <Route path="*" element={<Navigate to={isAdmin ? 'general' : 'tasks'} replace />} />
      </Routes>
    </div>
  );
}
