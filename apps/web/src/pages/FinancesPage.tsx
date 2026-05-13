import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { LucideIcon } from 'lucide-react';
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, ExternalLink,
  FileText, Paperclip, Plus, Receipt, RefreshCw, Trash2, Upload, UserCheck, X,
} from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────
type Summary = {
  projects: Array<{ id: string; title: string; income: number; expense: number; profit: number; client: { name: string } }>;
  totals: { income: number; expense: number; tax: number; profit: number; expectedPayments: number; overduePayments: number };
};
type ProjectOption = { id: string; title: string; invoiceNumber?: string | null; client: { name: string } };
type InvoiceFile = {
  id: string; projectId: string; clientId: string; invoiceNumber?: string | null;
  originalName: string; storedName: string; mimeType: string; fileSize: number; createdAt: string;
  project: { id: string; title: string; invoiceNumber?: string | null; projectNumber: string };
  client: { id: string; name: string; clientNumber: string };
};
type OperatingExpenseType = 'subscription' | 'salary' | 'monthly_expense';
type OperatingReceipt = { id: string; expenseId: string; originalName: string; storedName: string; mimeType: string; fileSize: number; createdAt: string };
type OperatingExpense = {
  id: string; type: OperatingExpenseType; amount: number; taxAmount: number;
  description?: string | null; dueDate?: string | null; createdAt: string; receipts?: OperatingReceipt[];
};
type PaymentStatus = 'EXPECTED' | 'OVERDUE' | 'PAID';
type Payment = {
  id: string; projectId: string; clientId?: string | null;
  amount: number; dueDate: string; paidAt?: string | null;
  status: PaymentStatus; description?: string | null; createdAt: string;
  project: { id: string; title: string; invoiceNumber?: string | null; client: { id: string; name: string } };
};

// ── Constants ─────────────────────────────────────────────────────
const API_BASE  = api.baseUrl;
const FILE_BASE = API_BASE.replace(/\/api$/, '');

const EXPENSE_META: Record<OperatingExpenseType, { icon: LucideIcon; label: string; color: string }> = {
  subscription:    { icon: RefreshCw, label: 'Subscription', color: '#5b8dd9' },
  salary:          { icon: UserCheck, label: 'Salary',       color: '#7dab6e' },
  monthly_expense: { icon: Receipt,   label: 'Monthly',      color: '#9d88c8' },
};

const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; color: string }> = {
  EXPECTED: { label: 'Expected', color: '#c8b264' },
  OVERDUE:  { label: 'Overdue',  color: '#c86464' },
  PAID:     { label: 'Paid',     color: '#7dab6e' },
};

const fmt    = (n: number) => `$${Number.isFinite(n) ? Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
const fmtKpi = (n: number) => `$${Number.isFinite(n) ? Math.round(Math.abs(n)).toLocaleString('en-US') : '0'}`;

function getMonthOptions() {
  return Array.from({ length: 14 }, (_, i) => {
    const m = dayjs().add(i - 2, 'month');
    return { value: m.format('YYYY-MM'), label: m.format('MMMM YYYY') };
  });
}

// ── Period Navigator ───────────────────────────────────────────────
function PeriodNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="fin-period-nav">
      <button type="button" className="fin-period-btn" onClick={onPrev} aria-label="Previous">
        <ChevronLeft size={14} />
      </button>
      <span className="fin-period-label">{label}</span>
      <button type="button" className="fin-period-btn" onClick={onNext} aria-label="Next">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ── Add Expense Panel ─────────────────────────────────────────────
function AddExpensePanel({ onClose, onSave, isPending }: {
  onClose: () => void;
  onSave: (d: { month: string; type: OperatingExpenseType; description: string; amount: number; hasGst: boolean; nextMonth: boolean }) => void;
  isPending: boolean;
}) {
  const [type, setType]               = useState<OperatingExpenseType>('subscription');
  const [description, setDescription] = useState('');
  const [month, setMonth]             = useState(dayjs().format('YYYY-MM'));
  const [amount, setAmount]           = useState('');
  const [hasGst, setHasGst]           = useState(true);
  const [nextMonth, setNextMonth]     = useState(true);
  const monthOptions = useMemo(() => getMonthOptions(), []);
  useEffect(() => { setNextMonth(type === 'subscription'); }, [type]);
  const canSave = description.trim().length > 0 && (Number(amount) || 0) > 0;
  const meta = EXPENSE_META[type];
  const PanelIcon = meta.icon;

  return (
    <div className="cal-panel">
      <div className="cal-panel-head">
        <div className="cal-panel-headings">
          <PanelIcon size={14} style={{ color: meta.color, flexShrink: 0 }} />
          <span className="cal-panel-title">New expense</span>
        </div>
        <button type="button" className="cal-panel-close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="cal-panel-body">
        <div className="cal-field">
          <label className="cal-label">Type</label>
          <div className="cal-type-btns" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {(Object.entries(EXPENSE_META) as Array<[OperatingExpenseType, typeof EXPENSE_META[OperatingExpenseType]]>).map(([key, m]) => {
              const Icon = m.icon;
              return (
                <button key={key} type="button"
                  className={`cal-type-btn type-${key}${type === key ? ' active' : ''}`}
                  onClick={() => setType(key)}>
                  <Icon size={11} />{m.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="cal-field">
          <label className="cal-label">Description</label>
          <input className="input" value={description} autoFocus
            onChange={e => setDescription(e.target.value)}
            placeholder="Google Workspace, salary, office rent…" />
        </div>
        <div className="cal-field">
          <label className="cal-label">Month</label>
          <select className="input" value={month} onChange={e => setMonth(e.target.value)}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="cal-field">
          <label className="cal-label">Amount ($)</label>
          <input className="input" type="number" min="0" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="cal-field">
          <label className="cal-label">Options</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`fin-toggle-btn${hasGst ? ' active' : ''}`}
              onClick={() => setHasGst(v => !v)}>
              {hasGst && <Check size={11} />} Includes GST
            </button>
            <button type="button" className={`fin-toggle-btn${nextMonth ? ' active' : ''}`}
              onClick={() => setNextMonth(v => !v)}>
              {nextMonth && <Check size={11} />} Also next month
            </button>
          </div>
        </div>
        <button type="button" className="primary-btn" style={{ width: '100%' }}
          disabled={!canSave || isPending}
          onClick={() => onSave({ month, type, description: description.trim(), amount: Number(amount), hasGst, nextMonth })}>
          {isPending ? 'Adding…' : 'Add expense'}
        </button>
      </div>
    </div>
  );
}

// ── Upload Invoice Panel ──────────────────────────────────────────
function UploadInvoicePanel({ projects, onClose, onUpload, isPending }: {
  projects: ProjectOption[];
  onClose: () => void;
  onUpload: (projectId: string, file: File) => void;
  isPending: boolean;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [file, setFile]           = useState<File | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  return (
    <div className="cal-panel">
      <div className="cal-panel-head">
        <div className="cal-panel-headings">
          <FileText size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <span className="cal-panel-title">Upload invoice</span>
        </div>
        <button type="button" className="cal-panel-close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="cal-panel-body">
        <div className="cal-field">
          <label className="cal-label">Project</label>
          {projects.length === 0
            ? <p className="muted small">No projects available.</p>
            : <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.invoiceNumber ? `#${p.invoiceNumber} — ` : ''}{p.title} · {p.client.name}
                  </option>
                ))}
              </select>
          }
        </div>
        <div className="cal-field">
          <label className="cal-label">PDF File</label>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div className="fin-upload-zone" onClick={() => fileRef.current?.click()}>
            {file ? (
              <>
                <FileText size={20} style={{ color: '#5b8dd9' }} />
                <span className="fin-upload-filename">{file.name}</span>
                <span className="fin-upload-size">{(file.size / 1024).toFixed(1)} KB</span>
              </>
            ) : (
              <>
                <Upload size={20} style={{ color: 'var(--text-faint)' }} />
                <span>Click to choose PDF</span>
              </>
            )}
          </div>
        </div>
        <button type="button" className="primary-btn" style={{ width: '100%' }}
          disabled={!file || !projectId || isPending}
          onClick={() => file && onUpload(projectId, file)}>
          {isPending ? 'Uploading…' : 'Upload invoice'}
        </button>
      </div>
    </div>
  );
}

// ── Expense Card ──────────────────────────────────────────────────
function ExpenseCard({ expense, onDelete, onUploadReceipt, onDeleteReceipt, isDeleting }: {
  expense: OperatingExpense;
  onDelete: () => void;
  onUploadReceipt: (expenseId: string, file: File) => void;
  onDeleteReceipt: (expenseId: string, receiptId: string) => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded]       = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);
  const meta                          = EXPENSE_META[expense.type];
  const Icon                          = meta.icon;
  const receipts                      = expense.receipts ?? [];

  return (
    <div className="fin-expense-card">
      <div className="fin-expense-main">
        <div className="fin-expense-type-bar" style={{ background: meta.color }} />
        <div className="fin-expense-icon" style={{ background: `${meta.color}1a`, color: meta.color }}>
          <Icon size={13} />
        </div>
        <div className="fin-expense-desc">
          <div className="fin-expense-name">{expense.description || meta.label}</div>
          <div className="fin-expense-sub">
            <span className="fin-chip">{meta.label}</span>
            {expense.dueDate && <span>{dayjs(expense.dueDate).format('MMM YYYY')}</span>}
            {expense.taxAmount > 0 && <span className="fin-chip gst">GST {fmt(expense.taxAmount)}</span>}
            {receipts.length > 0 && (
              <span className="fin-chip receipts"><Paperclip size={9} />{receipts.length}</span>
            )}
          </div>
        </div>
        <div className="fin-expense-amount">{fmt(expense.amount)}</div>
        <div className="fin-expense-actions">
          <button type="button" className="fin-icon-btn" title="Receipts"
            onClick={() => setExpanded(v => !v)}>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button type="button" className="fin-icon-btn danger"
            onClick={onDelete} disabled={isDeleting} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="fin-expense-receipts">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
            onChange={e => setReceiptFile(e.target.files?.[0] ?? null)} />
          {receipts.length === 0 && (
            <p className="muted small" style={{ margin: '0 0 6px' }}>No receipts attached.</p>
          )}
          {receipts.map(r => {
            const url = `${FILE_BASE}/storage/uploads/${r.storedName}`;
            return (
              <div key={r.id} className="fin-receipt-item">
                <FileText size={11} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                <span>{r.originalName}</span>
                <div className="fin-receipt-actions">
                  <a href={url} target="_blank" rel="noreferrer" className="fin-icon-btn" title="Open"><ExternalLink size={10} /></a>
                  <a href={url} download={r.originalName} className="fin-icon-btn" title="Download"><Download size={10} /></a>
                  <button type="button" className="fin-icon-btn danger" title="Delete"
                    onClick={() => onDeleteReceipt(expense.id, r.id)}><Trash2 size={10} /></button>
                </div>
              </div>
            );
          })}
          <div className="fin-receipt-upload">
            <button type="button" className="ghost-btn" style={{ fontSize: 12 }}
              onClick={() => fileRef.current?.click()}>
              <Paperclip size={11} />{receiptFile ? receiptFile.name : 'Attach receipt…'}
            </button>
            {receiptFile && (
              <button type="button" className="primary-btn" style={{ fontSize: 12 }}
                onClick={() => {
                  onUploadReceipt(expense.id, receiptFile);
                  setReceiptFile(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}>
                Upload
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invoice File Card ─────────────────────────────────────────────
function InvoiceFileCard({ file, onDelete, isDeleting }: {
  file: InvoiceFile; onDelete: () => void; isDeleting: boolean;
}) {
  const url        = `${FILE_BASE}/storage/uploads/${file.storedName}`;
  const invoiceNum = file.invoiceNumber || file.project.invoiceNumber;
  return (
    <div className="fin-invoice-card">
      <div className="fin-invoice-icon"><FileText size={16} /></div>
      <div className="fin-invoice-desc">
        <div className="fin-invoice-name">{file.originalName}</div>
        <div className="fin-invoice-sub">
          {invoiceNum && <span className="fin-chip">#{invoiceNum}</span>}
          <span>{file.project.title}</span>
          <span className="fin-dot" />
          <span>{file.client.name}</span>
          <span className="fin-dot" />
          <span>{(file.fileSize / 1024).toFixed(1)} KB</span>
          <span className="fin-dot" />
          <span>{dayjs(file.createdAt).format('DD MMM YYYY')}</span>
        </div>
      </div>
      <div className="fin-invoice-actions">
        <a href={url} target="_blank" rel="noreferrer" className="fin-icon-btn" title="Open"><ExternalLink size={13} /></a>
        <a href={url} download={file.originalName} className="fin-icon-btn" title="Download"><Download size={13} /></a>
        <button type="button" className="fin-icon-btn danger" onClick={onDelete} disabled={isDeleting} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Payment Row ───────────────────────────────────────────────────
function PaymentRow({ payment, onMarkPaid, onMarkExpected, isUpdating }: {
  payment: Payment;
  onMarkPaid: () => void;
  onMarkExpected: () => void;
  isUpdating: boolean;
}) {
  const sm = PAYMENT_STATUS_META[payment.status];
  const isPaid = payment.status === 'PAID';
  return (
    <div className={`fin-pmt-row${isPaid ? ' paid' : ''}`}>
      <div className="fin-pmt-status-bar" style={{ background: sm.color }} />
      <div className="fin-pmt-body">
        <div className="fin-pmt-top">
          <span className="fin-pmt-project">{payment.project.title}</span>
          <span className="fin-pmt-amount">{fmt(payment.amount)}</span>
        </div>
        <div className="fin-pmt-meta">
          <span className="fin-pmt-client">{payment.project.client.name}</span>
          {payment.project.invoiceNumber && (
            <><span className="fin-dot" /><span className="fin-chip">#{payment.project.invoiceNumber}</span></>
          )}
          {payment.description && (
            <><span className="fin-dot" /><span>{payment.description}</span></>
          )}
          <span className="fin-dot" />
          <span>Due {dayjs(payment.dueDate).format('D MMM YYYY')}</span>
          {isPaid && payment.paidAt && (
            <><span className="fin-dot" /><span style={{ color: '#7dab6e' }}>Paid {dayjs(payment.paidAt).format('D MMM')}</span></>
          )}
        </div>
      </div>
      <div className="fin-pmt-actions">
        <span className="fin-pmt-badge" style={{ background: `${sm.color}20`, color: sm.color }}>
          {sm.label}
        </span>
        {isPaid ? (
          <button type="button" className="fin-pmt-undo-btn" disabled={isUpdating} onClick={onMarkExpected}>
            Undo
          </button>
        ) : (
          <button type="button" className="fin-pmt-mark-btn" disabled={isUpdating} onClick={onMarkPaid}>
            <Check size={11} /> Mark paid
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export function FinancesPage() {
  const queryClient = useQueryClient();
  const today = dayjs();

  const [activePage,        setActivePage]        = useState<'overview' | 'payments'>('overview');
  const [selectedYear,      setSelectedYear]      = useState(today.year());
  const [selectedMonth,     setSelectedMonth]     = useState(today);
  const [activeTab,         setActiveTab]         = useState<'expenses' | 'invoices'>('expenses');
  const [addExpenseOpen,    setAddExpenseOpen]    = useState(false);
  const [uploadInvoiceOpen, setUploadInvoiceOpen] = useState(false);
  const [contentLeft,       setContentLeft]       = useState(0);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('main.content');
      if (el) setContentLeft(el.getBoundingClientRect().left);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const summaryQuery           = useQuery({ queryKey: ['finance-summary', selectedYear],        queryFn: () => api.get<Summary>(`/finances/summary?year=${selectedYear}`) });
  const projectsQuery          = useQuery({ queryKey: ['finance-project-options'],              queryFn: () => api.get<ProjectOption[]>('/projects') });
  const invoiceFilesQuery      = useQuery({ queryKey: ['invoice-files'],                        queryFn: () => api.get<InvoiceFile[]>('/finances/invoice-files') });
  const operatingExpensesQuery = useQuery({ queryKey: ['operating-expenses', selectedYear],     queryFn: () => api.get<OperatingExpense[]>(`/finances/operating-expenses?year=${selectedYear}`) });
  const paymentsQuery          = useQuery({ queryKey: ['payments'],                             queryFn: () => api.get<Payment[]>('/finances/payments'), enabled: activePage === 'payments' });

  const addExpenseMutation = useMutation({
    mutationFn: (d: { month: string; type: OperatingExpenseType; description: string; amount: number; hasGst: boolean; nextMonth: boolean }) =>
      api.post('/finances/operating-expenses', d),
    onSuccess: () => {
      setAddExpenseOpen(false);
      queryClient.invalidateQueries({ queryKey: ['operating-expenses', selectedYear] });
      queryClient.invalidateQueries({ queryKey: ['finance-summary', selectedYear] });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/finances/operating-expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operating-expenses', selectedYear] });
      queryClient.invalidateQueries({ queryKey: ['finance-summary', selectedYear] });
    },
  });

  const uploadInvoiceMutation = useMutation({
    mutationFn: async ({ projectId, file }: { projectId: string; file: File }) => {
      const fd = new FormData(); fd.append('file', file); fd.append('projectId', projectId);
      const res = await fetch(`${API_BASE}/finances/invoice-files`, { method: 'POST', headers: api.authHeaders(), body: fd });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    },
    onSuccess: () => { setUploadInvoiceOpen(false); queryClient.invalidateQueries({ queryKey: ['invoice-files'] }); },
    onError: err => window.alert(err instanceof Error ? err.message : 'Upload failed'),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/finances/invoice-files/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoice-files'] }),
  });

  const uploadReceiptMutation = useMutation({
    mutationFn: async ({ expenseId, file }: { expenseId: string; file: File }) => {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${API_BASE}/finances/operating-expenses/${expenseId}/receipts`, { method: 'POST', headers: api.authHeaders(), body: fd });
      if (!res.ok) throw new Error(`Receipt upload failed: ${res.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operating-expenses', selectedYear] }),
    onError: err => window.alert(err instanceof Error ? err.message : 'Receipt upload failed'),
  });

  const deleteReceiptMutation = useMutation({
    mutationFn: ({ expenseId, receiptId }: { expenseId: string; receiptId: string }) =>
      api.delete(`/finances/operating-expenses/${expenseId}/receipts/${receiptId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operating-expenses', selectedYear] }),
  });

  const markPaymentMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/finances/payments/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });

  if (summaryQuery.isLoading) return <div className="skeleton-page" />;
  if (summaryQuery.isError || !summaryQuery.data) return <div className="fin-page"><p className="muted">Failed to load finances.</p></div>;

  const data              = summaryQuery.data;
  const operatingExpenses = operatingExpensesQuery.data ?? [];
  const invoiceFiles      = invoiceFilesQuery.data ?? [];
  const projects          = projectsQuery.data ?? [];
  const allPayments       = paymentsQuery.data ?? [];

  const operatingTotal = operatingExpenses.reduce((s, i) => s + i.amount, 0);
  const operatingGst   = operatingExpenses.reduce((s, i) => s + i.taxAmount, 0);
  const profitAfterOps = data.totals.profit - operatingTotal;
  const gstOwed        = data.totals.tax;
  const panelOpen      = addExpenseOpen || uploadInvoiceOpen;

  const chartData = data.projects.map(p => ({
    name:   p.title.length > 14 ? p.title.slice(0, 13) + '…' : p.title,
    profit: p.profit,
  }));

  // Payments page data
  const monthKey = selectedMonth.format('YYYY-MM');
  const monthPayments = allPayments.filter(p => dayjs(p.dueDate).format('YYYY-MM') === monthKey);
  const pmtExpected = monthPayments.filter(p => p.status === 'EXPECTED').reduce((s, p) => s + p.amount, 0);
  const pmtOverdue  = monthPayments.filter(p => p.status === 'OVERDUE').reduce((s, p) => s + p.amount, 0);
  const pmtPaid     = monthPayments.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const invoiceFilesForYear = invoiceFiles.filter(f => dayjs(f.createdAt).year() === selectedYear);

  return (
    <div className="fin-page">

      {/* Header with integrated switcher */}
      <div className="fin-header">
        <h2>Finances</h2>
        <div className="projects-switcher fin-page-switcher" role="tablist">
          <button type="button" role="tab"
            className={`projects-switch-btn${activePage === 'overview' ? ' active' : ''}`}
            onClick={() => setActivePage('overview')}>
            Overview
          </button>
          <button type="button" role="tab"
            className={`projects-switch-btn${activePage === 'payments' ? ' active' : ''}`}
            onClick={() => setActivePage('payments')}>
            Payments
          </button>
        </div>
        <div className="fin-header-actions" />
      </div>

      {/* ── OVERVIEW ── */}
      {activePage === 'overview' && (
        <>
          {/* Year nav */}
          <PeriodNav
            label={String(selectedYear)}
            onPrev={() => setSelectedYear(y => y - 1)}
            onNext={() => setSelectedYear(y => y + 1)}
          />

          {/* KPI row */}
          <div className="fin-kpi-row">
            <div className="fin-kpi-card">
              <div className="fin-kpi-label">Income</div>
              <div className="fin-kpi-value">{fmtKpi(data.totals.income)}</div>
              <div className="fin-kpi-sub">Project payments {selectedYear}</div>
            </div>
            <div className="fin-kpi-card">
              <div className="fin-kpi-label">Profit</div>
              <div className={`fin-kpi-value${profitAfterOps < 0 ? ' negative' : ''}`}>{fmtKpi(profitAfterOps)}</div>
              <div className="fin-kpi-sub">After all expenses</div>
            </div>
            <div className="fin-kpi-card">
              <div className="fin-kpi-label">GST</div>
              <div className="fin-kpi-value warning">{fmtKpi(gstOwed)}</div>
              <div className="fin-kpi-sub">10% of income — set aside</div>
            </div>
            <div className="fin-kpi-card">
              <div className="fin-kpi-label">Overdue</div>
              <div className={`fin-kpi-value${data.totals.overduePayments > 0 ? ' negative' : ''}`}>
                {fmtKpi(data.totals.overduePayments)}
              </div>
              <div className="fin-kpi-sub">{data.totals.overduePayments > 0 ? 'Requires attention' : 'All clear'}</div>
            </div>
          </div>

          {/* Chart + Payments */}
          <div className="fin-mid-row">
            <div className="fin-chart-card">
              <div className="fin-chart-label">Profit by project · {selectedYear}</div>
              {chartData.length === 0 ? (
                <p className="muted small" style={{ padding: '60px 0', textAlign: 'center' }}>No data for {selectedYear}</p>
              ) : (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={chartData} barSize={18}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 11 }} axisLine={false} tickLine={false} width={52} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{ background: '#111113', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-dim)', fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: '#7B8269' }}
                      formatter={(v: number) => [`$${v.toFixed(0)}`, 'Profit']}
                    />
                    <Bar dataKey="profit" fill="#7B8269" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="fin-payment-card">
              <div className="fin-payment-label">Summary · {selectedYear}</div>
              {[
                { label: 'Expected',        value: data.totals.expectedPayments, warn: false },
                { label: 'Overdue',         value: data.totals.overduePayments,  warn: data.totals.overduePayments > 0 },
                { label: 'Operating costs', value: operatingTotal,               warn: false },
                { label: 'GST in costs',    value: operatingGst,                 warn: false },
                { label: 'Net profit',      value: profitAfterOps,               warn: profitAfterOps < 0 },
              ].map(row => (
                <div key={row.label} className="fin-payment-row">
                  <span className="fin-payment-row-label">{row.label}</span>
                  <span className={`fin-payment-row-value${row.warn ? ' overdue' : ''}`}>{fmt(row.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabbed section */}
          <div className="fin-section">
            <div className="fin-section-header">
              <div className="fin-tabs">
                <button type="button" className={`fin-tab${activeTab === 'expenses' ? ' active' : ''}`}
                  onClick={() => setActiveTab('expenses')}>
                  Expenses <span className="fin-tab-count">{operatingExpenses.length}</span>
                </button>
                <button type="button" className={`fin-tab${activeTab === 'invoices' ? ' active' : ''}`}
                  onClick={() => setActiveTab('invoices')}>
                  Invoice Files <span className="fin-tab-count">{invoiceFilesForYear.length}</span>
                </button>
              </div>
              {activeTab === 'expenses' && operatingExpenses.length > 0 && (
                <div className="fin-section-meta">
                  <span className="muted small">Total: <strong>{fmt(operatingTotal)}</strong></span>
                  {operatingGst > 0 && <span className="muted small">GST: <strong>{fmt(operatingGst)}</strong></span>}
                </div>
              )}
            </div>

            {activeTab === 'expenses' && (
              <div className="fin-section-body">
                {operatingExpensesQuery.isLoading
                  ? <div className="fin-section-empty"><p className="muted small">Loading…</p></div>
                  : operatingExpenses.length === 0
                  ? <div className="fin-section-empty">
                      <p className="muted small">No expenses in {selectedYear}.</p>
                      <button type="button" className="ghost-btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setAddExpenseOpen(true)}>
                        <Plus size={12} /> Add first expense
                      </button>
                    </div>
                  : operatingExpenses.map(exp => (
                      <ExpenseCard key={exp.id} expense={exp}
                        onDelete={() => deleteExpenseMutation.mutate(exp.id)}
                        onUploadReceipt={(eid, f) => uploadReceiptMutation.mutate({ expenseId: eid, file: f })}
                        onDeleteReceipt={(eid, rid) => deleteReceiptMutation.mutate({ expenseId: eid, receiptId: rid })}
                        isDeleting={deleteExpenseMutation.isPending}
                      />
                    ))
                }
              </div>
            )}

            {activeTab === 'invoices' && (
              <div className="fin-section-body">
                {invoiceFilesQuery.isLoading
                  ? <div className="fin-section-empty"><p className="muted small">Loading…</p></div>
                  : invoiceFilesForYear.length === 0
                  ? <div className="fin-section-empty">
                      <p className="muted small">No invoice files in {selectedYear}.</p>
                      <button type="button" className="ghost-btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setUploadInvoiceOpen(true)}>
                        <Plus size={12} /> Upload first invoice
                      </button>
                    </div>
                  : invoiceFilesForYear.map(f => (
                      <InvoiceFileCard key={f.id} file={f}
                        onDelete={() => deleteInvoiceMutation.mutate(f.id)}
                        isDeleting={deleteInvoiceMutation.isPending}
                      />
                    ))
                }
              </div>
            )}
          </div>
        </>
      )}

      {/* ── PAYMENTS ── */}
      {activePage === 'payments' && (
        <>
          {/* Month nav */}
          <PeriodNav
            label={selectedMonth.format('MMMM YYYY')}
            onPrev={() => setSelectedMonth(m => m.subtract(1, 'month'))}
            onNext={() => setSelectedMonth(m => m.add(1, 'month'))}
          />

          {/* Stats */}
          <div className="fin-pmt-stats">
            <div className="fin-pmt-stat">
              <div className="fin-pmt-stat-label">Expected</div>
              <div className="fin-pmt-stat-value warning">{fmt(pmtExpected)}</div>
            </div>
            <div className="fin-pmt-stat">
              <div className="fin-pmt-stat-label">Overdue</div>
              <div className={`fin-pmt-stat-value${pmtOverdue > 0 ? ' negative' : ''}`}>{fmt(pmtOverdue)}</div>
            </div>
            <div className="fin-pmt-stat">
              <div className="fin-pmt-stat-label">Received</div>
              <div className="fin-pmt-stat-value positive">{fmt(pmtPaid)}</div>
            </div>
          </div>

          {/* Payment list */}
          <div className="fin-section">
            <div className="fin-section-header" style={{ padding: '12px 16px' }}>
              <span className="muted small">
                {monthPayments.length} payment{monthPayments.length !== 1 ? 's' : ''} in {selectedMonth.format('MMMM YYYY')}
              </span>
            </div>
            <div className="fin-section-body">
              {paymentsQuery.isLoading ? (
                <div className="fin-section-empty"><p className="muted small">Loading…</p></div>
              ) : monthPayments.length === 0 ? (
                <div className="fin-section-empty">
                  <p className="muted small">No payments scheduled for {selectedMonth.format('MMMM YYYY')}.</p>
                </div>
              ) : (
                monthPayments.map(p => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    onMarkPaid={() => markPaymentMutation.mutate({ id: p.id, status: 'PAID' })}
                    onMarkExpected={() => markPaymentMutation.mutate({ id: p.id, status: 'EXPECTED' })}
                    isUpdating={markPaymentMutation.isPending}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {panelOpen && createPortal(
        <>
          <div className="edit-panel-backdrop" style={{ left: contentLeft }}
            onClick={() => { setAddExpenseOpen(false); setUploadInvoiceOpen(false); }} />
          {addExpenseOpen && (
            <AddExpensePanel onClose={() => setAddExpenseOpen(false)}
              onSave={d => addExpenseMutation.mutate(d)} isPending={addExpenseMutation.isPending} />
          )}
          {uploadInvoiceOpen && (
            <UploadInvoicePanel projects={projects} onClose={() => setUploadInvoiceOpen(false)}
              onUpload={(pid, f) => uploadInvoiceMutation.mutate({ projectId: pid, file: f })}
              isPending={uploadInvoiceMutation.isPending} />
          )}
        </>,
        document.body,
      )}
    </div>
  );
}
