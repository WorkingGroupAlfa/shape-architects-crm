import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api } from '../lib/api';
import { generatePdfBase64FromHtml, prepareHtmlForWebExport } from '../lib/document-export';
import { MailHub } from '../components/mail/MailHub';

type ClientFile = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  kind: string;
  createdAt: string;
};

type ClientInvoiceFile = {
  id: string;
  invoiceNumber?: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  project?: {
    id: string;
    title: string;
    invoiceNumber?: string | null;
  } | null;
};

type ClientDetails = {
  id: string;
  clientNumber: string;
  statusId: string;
  name: string;
  email?: string;
  contactEmails?: Array<{
    id: string;
    email: string;
    emailNormalized: string;
    label?: string | null;
    isPrimary: boolean;
    isActive: boolean;
  }>;
  phone?: string;
  company?: string;
  abn?: string;
  address?: string;
  leadSource?: string;
  perplexitySummary?: string;
  perplexityStatus?: string;
  perplexityUpdatedAt?: string;
  status?: { label: string; key: string };
  projects: Array<{
    id: string;
    invoiceNumber?: string | null;
    title: string;
    status: string;
    income: number;
    expense: number;
    profit: number;
    createdAt: string;
  }>;
  files: ClientFile[];
  invoiceFiles?: ClientInvoiceFile[];
  subscriptions: Array<{
    id: string;
    frequency: string;
    isActive: boolean;
    createdAt: string;
    template: { id: string; name: string; subject: string };
  }>;
  sentEmails: Array<{
    id: string;
    toEmail: string;
    subject: string;
    status: string;
    provider: string;
    errorMessage?: string | null;
    createdAt: string;
    template?: { id: string; name: string } | null;
  }>;
};

type ClientUpdateInput = {
  clientNumber: string;
  name: string;
  company: string;
  abn: string;
  address: string;
  phone: string;
  leadSource: string;
};

type ResearchChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type OfferLineItem = {
  id: string;
  description: string;
  price: number;
};

const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const fallbackApiUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4311/api'
  : 'https://shape-architects-crm-api.onrender.com/api';
const apiUrl = (configuredApiUrl || fallbackApiUrl).replace(/\/+$/, '');
const storageBaseUrl = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;

const formatMoney = (amount: number, currency: string) =>
  `${Number.isFinite(amount) ? Math.round(amount) : 0} ${currency}`;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function buildOfferHtml(params: {
  clientName: string;
  email: string;
  website: string;
  phone: string;
  currency: string;
  items: OfferLineItem[];
  subtotal: number;
}) {
  const gstAmount = Math.round(params.subtotal * 0.1);
  const grandTotal = Math.round(params.subtotal + gstAmount);
  const rows = params.items
    .filter(item => item.description.trim().length > 0 || item.price > 0)
    .map(item => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td style="text-align:right;">${formatMoney(item.price, params.currency)}</td>
      </tr>
    `)
    .join('');

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
      background: #f2f2f2;
      color: #2f2f2f;
    }
    .sheet {
      width: 210mm;
      height: 297mm;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 79mm 1fr;
      background: #ececec;
      overflow: hidden;
    }
    .left {
      background: #201F1F;
      color: #c2c2c2;
      padding: 7mm 0 18mm;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      letter-spacing: 0.08em;
    }
    .brand-logo {
      width: 100%;
      height: auto;
      display: block;
      max-width: 79mm;
    }
    .left-footer {
      margin-top: 102mm;
      padding: 0 8mm;
      max-width: 100%;
    }
    .left-contact-title {
      color: #f1f1f1;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-size: 5.2mm;
      letter-spacing: 0.01em;
      margin-bottom: 4mm;
    }
    .left-contact-meta {
      color: #8e8e8e;
      font-size: 3.45mm;
      line-height: 1.45;
      letter-spacing: 0.07em;
      white-space: pre-line;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .right {
      padding: 16mm 12mm;
      position: relative;
      height: 297mm;
    }
    h1 {
      margin: 0 0 18mm;
      text-align: center;
      font-size: 11mm;
      color: #9f8a63;
      letter-spacing: 0.12em;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
    }
    .client-name {
      font-size: 6mm;
      margin-bottom: 4mm;
      font-family: 'Now Bold', 'Now', 'Roboto', Arial, Helvetica, sans-serif;
      font-weight: 700;
    }
    .contacts {
      font-size: 3.7mm;
      letter-spacing: 0.08em;
      color: #9c9c9c;
      line-height: 1.7;
    }
    .line {
      margin: 10mm 0 5mm;
      border-top: 0.6mm solid #7e7e7e;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 4mm;
    }
    th {
      text-align: left;
      color: #9f8a63;
      font-size: 3.7mm;
      padding: 0 0 2.4mm;
      border-bottom: 0.4mm solid #8a8a8a;
    }
    td {
      padding: 2.4mm 0;
    }
    .summary {
      margin-top: 8mm;
      font-size: 4mm;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding-top: 0;
      margin-top: 0;
    }
    .summary-row.total {
      border-top: 0.4mm solid #8a8a8a;
      padding-top: 2.6mm;
      margin-top: 2.6mm;
    }
    .total {
      margin-top: 4mm;
      font-weight: 700;
    }
    .bottom-sign {
      position: absolute;
      left: 12mm;
      right: 12mm;
      bottom: 14mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      font-weight: 700;
      font-size: 5mm;
      color: #343434;
      letter-spacing: 0.06em;
    }
    .bottom-sign::before {
      content: "";
      width: 10.5ch;
      border-top: 0.3mm solid #343434;
      margin-bottom: 2mm;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <aside class="left">
      <img class="brand-logo" src="__LOCAL_TEMPLATE_LOGO__" alt="Shape Architects logo" />
      <div class="left-footer">
        <div class="left-contact-title">SHAPE ARCHITECTS</div>
        <div class="left-contact-meta">Company details to be added
https://shapearchitects.com.au
studio@shapearchitects.com.au</div>
      </div>
    </aside>
    <section class="right">
      <h1>QUOTE</h1>
      <div class="client-name">${escapeHtml(params.clientName)}</div>
      <div class="contacts">
        Email: ${escapeHtml(params.email || '-')}<br />
        Website: ${escapeHtml(params.website || '-')}<br />
        Phone: ${escapeHtml(params.phone || '-')}
      </div>
      <div class="line"></div>
      <table>
        <thead>
          <tr>
            <th>DESCRIPTION</th>
            <th style="text-align:right;">PRICE</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td>-</td><td style="text-align:right;">0.00</td></tr>'}
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-row">
          <span>GST 10%</span>
          <span>${formatMoney(gstAmount, params.currency)}</span>
        </div>
        <div class="summary-row total">
          <span>TOTAL</span>
          <span>${formatMoney(grandTotal, params.currency)}</span>
        </div>
      </div>

      <div class="bottom-sign">SHAPE ARCHITECTS</div>
    </section>
  </div>
</body>
</html>`;
}

// ─── General Information Tab ────────────────────────────────────────────────

function OverviewTab({ client }: { client: ClientDetails }) {
  const [form, setForm] = useState<ClientUpdateInput>({
    clientNumber: client.clientNumber ?? '',
    name: client.name ?? '',
    company: client.company ?? '',
    abn: client.abn ?? '',
    address: client.address ?? '',
    phone: client.phone ?? '',
    leadSource: client.leadSource ?? ''
  });

  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactLabel, setNewContactLabel] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: ClientUpdateInput) => {
      return api.patch<ClientDetails>(`/clients/${client.id}`, {
        clientNumber: payload.clientNumber,
        name: payload.name,
        company: payload.company,
        abn: payload.abn,
        address: payload.address || undefined,
        phone: payload.phone,
        statusId: client.statusId,
        leadSource: payload.leadSource
      });
    },
    onSuccess: updated => {
      queryClient.setQueryData(['client-details', client.id], updated);
      queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    }
  });

  const researchChatQuery = useQuery({
    queryKey: ['client-perplexity-chat', client.id],
    queryFn: () => api.get<{ messages: ResearchChatMessage[] }>(`/clients/${client.id}/perplexity-chat`)
  });

  const askMutation = useMutation({
    mutationFn: async () =>
      api.post<{
        question: ResearchChatMessage;
        answer: ResearchChatMessage;
      }>(`/clients/${client.id}/perplexity-chat`, { question }),
    onSuccess: () => {
      setQuestion('');
      queryClient.invalidateQueries({ queryKey: ['client-perplexity-chat', client.id] });
      queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
    }
  });

  const saveContactEmailsMutation = useMutation({
    mutationFn: async (action: { type: 'create' | 'set-primary' | 'remove'; emailId?: string }) => {
      if (action.type === 'create') {
        return api.post(`/clients/${client.id}/contact-emails`, {
          email: newContactEmail.trim(),
          label: newContactLabel.trim() || undefined,
          isPrimary: (client.contactEmails ?? []).length === 0
        });
      }
      if (action.type === 'set-primary' && action.emailId) {
        return api.patch(`/clients/${client.id}/contact-emails/${action.emailId}`, { isPrimary: true });
      }
      if (action.type === 'remove' && action.emailId) {
        return api.delete(`/clients/${client.id}/contact-emails/${action.emailId}`);
      }
      return null;
    },
    onSuccess: async () => {
      setNewContactEmail('');
      setNewContactLabel('');
      try {
        await api.post(`/mail/clients/${client.id}/sync`, {});
      } catch {
        // keep UI responsive even if sync endpoint is temporarily unavailable
      }
      queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads'] });
    }
  });

  useEffect(() => {
    setForm({
      clientNumber: client.clientNumber ?? '',
      name: client.name ?? '',
      company: client.company ?? '',
      abn: client.abn ?? '',
      address: client.address ?? '',
      phone: client.phone ?? '',
      leadSource: client.leadSource ?? ''
    });
  }, [client]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [researchChatQuery.data, askMutation.isPending]);

  const sendQuestion = () => {
    if (askMutation.isPending) return;
    if (question.trim().length < 2) return;
    askMutation.mutate();
  };

  return (
    <div className="cli-gen-layout">
      {/* Left: Contact form */}
      <Card className="cli-gen-form-card">
        <h3 className="cli-section-title">Contact Details</h3>

        <div className="cli-gen-form-grid">
          <label className="cli-field">
            <span className="cli-field-label">Client Number</span>
            <input className="input" value={form.clientNumber} onChange={e => setForm(prev => ({ ...prev, clientNumber: e.target.value }))} />
          </label>

          <label className="cli-field cli-field-span2">
            <span className="cli-field-label">Name</span>
            <input className="input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
          </label>

          <label className="cli-field">
            <span className="cli-field-label">Company</span>
            <input className="input" value={form.company} onChange={e => setForm(prev => ({ ...prev, company: e.target.value }))} />
          </label>

          <label className="cli-field">
            <span className="cli-field-label">ABN</span>
            <input className="input" value={form.abn} onChange={e => setForm(prev => ({ ...prev, abn: e.target.value }))} />
          </label>

          <label className="cli-field cli-field-span2">
            <span className="cli-field-label">Address</span>
            <input className="input" value={form.address} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} placeholder="Street, City, State, Postcode" />
          </label>

          <label className="cli-field">
            <span className="cli-field-label">Phone</span>
            <input className="input" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} />
          </label>

          <label className="cli-field">
            <span className="cli-field-label">Lead Source</span>
            <input className="input" value={form.leadSource} onChange={e => setForm(prev => ({ ...prev, leadSource: e.target.value }))} />
          </label>
        </div>

        <div className="cli-gen-form-footer">
          <div className="cli-projects-stat">
            <span className="cli-projects-stat-num">{client.projects.length}</span>
            <span className="cli-field-label">Projects</span>
          </div>
          <button
            className="primary-btn"
            type="button"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          {saveMutation.isSuccess && <span className="cli-save-note">Saved</span>}
        </div>

        {/* Mailboxes */}
        <div className="cli-mailboxes-section">
          <span className="cli-section-title">Mailboxes</span>
          <div className="cli-mailboxes-list">
            {(client.contactEmails ?? []).length === 0 && (
              <p className="cli-field-label cli-mailboxes-empty">No mailboxes added</p>
            )}
            {(client.contactEmails ?? []).map(item => (
              <div key={item.id} className={`cli-mailbox-chip${item.isPrimary ? ' primary' : ''}`}>
                <div className="cli-mailbox-chip-left">
                  <span className="cli-mailbox-email">{item.email}</span>
                  {item.label && <span className="cli-mailbox-label">{item.label}</span>}
                  {item.isPrimary && <span className="cli-mailbox-primary-badge">Primary</span>}
                </div>
                <div className="cli-mailbox-chip-actions">
                  {!item.isPrimary && (
                    <button
                      className="ghost-btn cli-mailbox-action-btn"
                      type="button"
                      onClick={() => saveContactEmailsMutation.mutate({ type: 'set-primary', emailId: item.id })}
                      disabled={saveContactEmailsMutation.isPending}
                      title="Set as primary"
                    >
                      Set primary
                    </button>
                  )}
                  {(client.contactEmails ?? []).length > 1 && (
                    <button
                      className="ghost-btn cli-mailbox-action-btn danger"
                      type="button"
                      onClick={() => saveContactEmailsMutation.mutate({ type: 'remove', emailId: item.id })}
                      disabled={saveContactEmailsMutation.isPending}
                      title="Remove"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" /></svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="cli-mailboxes-add">
            <input
              className="input"
              placeholder="Email (name@domain.com)"
              value={newContactEmail}
              onChange={e => setNewContactEmail(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newContactEmail.trim()) saveContactEmailsMutation.mutate({ type: 'create' });
              }}
            />
            <input
              className="input cli-mailboxes-label-input"
              placeholder="Label (optional)"
              value={newContactLabel}
              onChange={e => setNewContactLabel(e.target.value)}
            />
            <button
              className="ghost-btn"
              type="button"
              onClick={() => saveContactEmailsMutation.mutate({ type: 'create' })}
              disabled={saveContactEmailsMutation.isPending || !newContactEmail.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </Card>

      {/* Right: Research Chat */}
      <Card className="cli-gen-research-card">
        <div className="cli-research-header">
          <h3 className="cli-section-title">Research Chat</h3>
          {client.perplexityUpdatedAt && (
            <span className="cli-field-label cli-research-updated">
              Updated {new Date(client.perplexityUpdatedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="cli-research-chat">
          <div className="cli-research-msg system">
            <div className="cli-research-bubble system">
              <span className="cli-research-role">system</span>
              <p>Research context is active for this client.</p>
            </div>
          </div>

          {client.perplexitySummary?.trim() && (
            <div className="cli-research-msg assistant">
              <div className="cli-research-bubble assistant">
                <span className="cli-research-role">ai</span>
                <p>{client.perplexitySummary}</p>
              </div>
            </div>
          )}

          {researchChatQuery.data?.messages.map(message => (
            <div key={message.id} className={`cli-research-msg ${message.role}`}>
              <div className={`cli-research-bubble ${message.role}`}>
                <span className="cli-research-role">{message.role === 'assistant' ? 'ai' : 'you'}</span>
                <p>{message.content}</p>
                <span className="cli-research-time">{new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}

          {askMutation.isPending && (
            <div className="cli-research-msg assistant">
              <div className="cli-research-bubble assistant">
                <span className="cli-research-role">ai</span>
                <div className="cli-research-typing"><span /><span /><span /></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="cli-research-compose">
          <input
            className="input cli-research-input"
            type="text"
            placeholder="Ask about this client…"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); sendQuestion(); }
            }}
          />
          <button
            className="cli-research-send-btn"
            type="button"
            onClick={sendQuestion}
            disabled={askMutation.isPending || question.trim().length < 2}
          >
            {askMutation.isPending ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: 0.5 }}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="28 56" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.6 11.2L20.2 3.3a1 1 0 011.38 1.24L15 20.7a1 1 0 01-1.88-.06l-2.4-7-7-2.4a1 1 0 01-.12-1.9zm4.5.7l5.18 1.77 1.77 5.18 4.6-11.25L7.1 11.9z" fill="currentColor" /></svg>
            )}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Projects Tab ────────────────────────────────────────────────────────────

const PROJECT_STATUS_LABELS: Record<string, string> = {
  DEVELOPMENT: 'Development',
  APPROVAL: 'Approval',
  COMPLETED: 'Completed'
};

function DealsTab({ client }: { client: ClientDetails }) {
  const navigate = useNavigate();

  if (client.projects.length === 0) {
    return (
      <Card>
        <h3 className="cli-section-title">Projects</h3>
        <p className="cli-field-label" style={{ marginTop: 16 }}>No projects yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="cli-deals-header">
        <h3 className="cli-section-title">Projects</h3>
        <span className="cli-deals-count">{client.projects.length}</span>
      </div>

      <div className="cli-deals-list">
        {client.projects.map(project => (
          <div
            key={project.id}
            className="cli-deal-row"
            onClick={() => navigate(`/projects/${project.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && navigate(`/projects/${project.id}`)}
          >
            <div className="cli-deal-row-left">
              <span className={`cli-deal-status cli-deal-status-${project.status.toLowerCase()}`}>
                {PROJECT_STATUS_LABELS[project.status] ?? project.status}
              </span>
              <div className="cli-deal-info">
                <span className="cli-deal-title">{project.title}</span>
                {project.invoiceNumber && (
                  <span className="cli-deal-invoice">#{project.invoiceNumber}</span>
                )}
              </div>
            </div>
            <div className="cli-deal-row-right">
              <div className="cli-deal-finance">
                <span className="cli-deal-finance-item income" title="Income">${Math.round(project.income).toLocaleString()}</span>
                <span className="cli-deal-finance-sep">/</span>
                <span className="cli-deal-finance-item expense" title="Expense">${Math.round(project.expense).toLocaleString()}</span>
              </div>
              <span className={`cli-deal-profit${project.profit >= 0 ? ' positive' : ' negative'}`}>
                {project.profit >= 0 ? '+' : ''}{Math.round(project.profit).toLocaleString()} AUD
              </span>
              <span className="cli-deal-date">{new Date(project.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              <svg className="cli-deal-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Offer Builder Tab ───────────────────────────────────────────────────────

function OfferBuilderTab({ client }: { client: ClientDetails }) {
  const queryClient = useQueryClient();
  const cacheKey = `wz_offer_${client.id}`;

  const loadCache = () => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) return JSON.parse(raw) as { email: string; website: string; phone: string; currency: string; items: OfferLineItem[] };
    } catch { /* ignore */ }
    return null;
  };

  const cached = loadCache();
  const [email, setEmail] = useState(cached?.email ?? client.email ?? '');
  const [website, setWebsite] = useState(cached?.website ?? (client.company ? `www.${client.company.replace(/\s+/g, '').toLowerCase()}.com` : ''));
  const [phone, setPhone] = useState(cached?.phone ?? client.phone ?? '');
  const [currency, setCurrency] = useState(cached?.currency ?? 'AUD');
  const [items, setItems] = useState<OfferLineItem[]>(cached?.items ?? [
    { id: 'line-1', description: '10 internal renders', price: 6000 },
    { id: 'line-2', description: '6 textures', price: 1200 }
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ email, website, phone, currency, items }));
    } catch { /* ignore */ }
  }, [cacheKey, email, website, phone, currency, items]);

  const subtotal = useMemo(() => items.reduce((acc, item) => acc + (Number.isFinite(item.price) ? item.price : 0), 0), [items]);
  const gstAmount = useMemo(() => Math.round(subtotal * 0.1), [subtotal]);
  const totalWithGst = useMemo(() => Math.round(subtotal + gstAmount), [subtotal, gstAmount]);

  const saveOfferMutation = useMutation({
    mutationFn: async () => {
      const html = buildOfferHtml({ clientName: client.name, email, website, phone, currency, items, subtotal });
      const dateSuffix = new Date().toISOString().slice(0, 10);
      const htmlForExport = prepareHtmlForWebExport(html);
      const pdfBase64 = await generatePdfBase64FromHtml(html, `${client.name}-offer-${dateSuffix}.pdf`);
      return api.post(`/clients/${client.id}/offers`, {
        fileName: `${client.name}-offer-${dateSuffix}`,
        html: htmlForExport,
        pdfBase64,
        total: totalWithGst,
        currency,
        items
      });
    },
    onSuccess: () => {
      localStorage.removeItem(cacheKey);
      queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
      window.alert('Offer PDF created and saved to client files.');
    },
    onError: () => {
      window.alert('Failed to create offer file.');
    }
  });

  return (
    <Card>
      {/* Section 1: Client Info */}
      <p className="proj-inv-section-label">CLIENT INFO</p>
      <div className="cli-offer-info-grid">
        <label className="cli-field">
          <span className="cli-field-label">Client</span>
          <input className="input" value={client.name} readOnly />
        </label>
        <label className="cli-field">
          <span className="cli-field-label">Currency</span>
          <input className="input" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().slice(0, 8))} />
        </label>
        <label className="cli-field">
          <span className="cli-field-label">Email</span>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="cli-field">
          <span className="cli-field-label">Website</span>
          <input className="input" value={website} onChange={e => setWebsite(e.target.value)} />
        </label>
        <label className="cli-field">
          <span className="cli-field-label">Phone</span>
          <input className="input" value={phone} onChange={e => setPhone(e.target.value)} />
        </label>
      </div>

      <div className="proj-inv-divider" />

      {/* Section 2: Line Items */}
      <p className="proj-inv-section-label">SERVICE LINES</p>

      <div className="cli-offer-lines-head">
        <span>Description</span>
        <span>Price ({currency})</span>
        <span />
      </div>

      <div className="cli-offer-lines-body">
        {items.map(item => (
          <div key={item.id} className="cli-offer-line-row">
            <input
              className="input cli-offer-line-desc"
              placeholder="Service description"
              value={item.description}
              onChange={e => setItems(prev => prev.map(line => line.id === item.id ? { ...line, description: e.target.value } : line))}
            />
            <input
              className="input cli-offer-line-price"
              type="number"
              min={0}
              placeholder="0"
              value={item.price === 0 ? '' : item.price}
              onChange={e => {
                const next = Number(e.target.value);
                setItems(prev => prev.map(line => line.id === item.id ? { ...line, price: Number.isFinite(next) ? next : 0 } : line));
              }}
            />
            <button
              className="ghost-btn cli-offer-line-remove"
              type="button"
              onClick={() => setItems(prev => prev.filter(line => line.id !== item.id))}
              disabled={items.length === 1}
              title="Remove line"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" /></svg>
            </button>
          </div>
        ))}
      </div>

      <button
        className="ghost-btn cli-offer-add-line"
        type="button"
        onClick={() => setItems(prev => [...prev, { id: `line-${Date.now()}`, description: '', price: 0 }])}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
        Add Line
      </button>

      <div className="proj-inv-divider" />

      {/* Section 3: Totals */}
      <p className="proj-inv-section-label">TOTALS</p>

      <div className="cli-offer-totals">
        <div className="cli-offer-totals-row">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="cli-offer-totals-row">
          <span>GST 10%</span>
          <span>{formatMoney(gstAmount, currency)}</span>
        </div>
        <div className="cli-offer-totals-row total">
          <span>Total</span>
          <span>{formatMoney(totalWithGst, currency)}</span>
        </div>
        <button
          className="primary-btn cli-offer-generate-btn"
          type="button"
          onClick={() => saveOfferMutation.mutate()}
          disabled={saveOfferMutation.isPending}
        >
          {saveOfferMutation.isPending ? 'Generating PDF…' : 'Generate Offer PDF'}
        </button>
      </div>
    </Card>
  );
}

// ─── Files Tab ───────────────────────────────────────────────────────────────

function FilesTab({ client }: { client: ClientDetails }) {
  const queryClient = useQueryClient();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (uploadFile: File) => {
      const form = new FormData();
      form.append('file', uploadFile);
      const response = await fetch(`${apiUrl}/clients/${client.id}/files`, {
        method: 'POST',
        body: form,
        headers: api.authHeaders()
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      return response.json() as Promise<ClientFile>;
    },
    onSuccess: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
    }
  });

  const handleFileSelect = (f: File | null | undefined) => {
    if (f && !uploadMutation.isPending) uploadMutation.mutate(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => api.delete(`/clients/${client.id}/files/${fileId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-details', client.id] })
  });

  const allFiles: Array<ClientFile & { isOffer?: boolean; invoiceProject?: string }> = [
    ...client.files.map(f => ({ ...f, isOffer: f.kind === 'OFFER' })),
    ...(client.invoiceFiles ?? []).map(f => ({
      id: `invoice:${f.id}`,
      originalName: f.originalName,
      storedName: f.storedName,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      kind: 'INVOICE',
      createdAt: f.createdAt,
      invoiceProject: f.project?.title
    }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <Card>
      <h3 className="cli-section-title">Files</h3>

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
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

      {allFiles.length === 0 ? (
        <p className="proj-files-empty">No files yet</p>
      ) : (
        <div className="proj-files-list">
          {allFiles.map(item => {
            const fileUrl = `${storageBaseUrl}/storage/uploads/${item.storedName}`;
            const isInvoice = item.kind === 'INVOICE';
            const isOffer = item.isOffer;
            const canDelete = !isInvoice;
            return (
              <div key={item.id} className="proj-files-item">
                <div className="proj-files-item-icon">
                  {item.mimeType === 'application/pdf' ? (
                    <svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.4"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.4"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  )}
                </div>
                <div className="proj-files-item-info">
                  <span className="proj-files-item-name">
                    {item.originalName}
                    {isOffer && <span className="project-file-tag cli-files-tag-offer">Offer</span>}
                    {isInvoice && <span className="project-file-tag proj-files-tag-invoice">Invoice</span>}
                  </span>
                  <span className="proj-files-item-meta">
                    {new Date(item.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                    {' · '}{formatFileSize(item.fileSize)}
                    {item.invoiceProject && ` · ${item.invoiceProject}`}
                  </span>
                </div>
                <div className="proj-files-item-actions">
                  <a className="ghost-btn project-file-icon-btn" href={fileUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                  </a>
                  {canDelete && (
                    <button
                      className="ghost-btn project-file-icon-btn project-file-icon-danger"
                      type="button"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                      title="Delete"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" /></svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── Mail Hub Tab ────────────────────────────────────────────────────────────

function MailingTab({ client }: { client: ClientDetails }) {
  const mailFiles = useMemo(
    () => [
      ...client.files.map(file => ({ ...file, clientFileId: file.id })),
      ...(client.invoiceFiles ?? []).map(file => ({
        id: `invoice:${file.id}`,
        invoiceId: file.id,
        originalName: file.originalName,
        storedName: file.storedName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        kind: 'INVOICE',
        createdAt: file.createdAt
      }))
    ],
    [client.files, client.invoiceFiles]
  );

  return (
    <MailHub clientId={client.id} clientEmails={client.contactEmails ?? []} files={mailFiles} />
  );
}

// ─── Page Shell ──────────────────────────────────────────────────────────────

export function ClientDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const clientQuery = useQuery({
    queryKey: ['client-details', id],
    queryFn: () => api.get<ClientDetails>(`/clients/${id}`),
    enabled: Boolean(id)
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>(`/clients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
      navigate('/clients');
    }
  });

  if (!clientQuery.data) return <div className="skeleton-page" />;

  const client = clientQuery.data;
  const primaryEmail = client.contactEmails?.find(e => e.isPrimary)?.email ?? client.email;
  const totalFiles = client.files.length + (client.invoiceFiles?.length ?? 0);

  return (
    <div className="page-grid">
      <div className="proj-detail-header">
        <div className="proj-detail-top">
          <NavLink
            to="/clients"
            className="proj-detail-back"
            aria-label="Back to Clients"
            title="Back to Clients"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </NavLink>

          <div className="proj-detail-title-block">
            <h2 className="proj-detail-title">{client.name}</h2>
            <div className="proj-detail-meta-row">
              <span className="proj-detail-meta-text">{client.clientNumber}</span>
              {client.company && <><span className="proj-detail-meta-text">·</span><span className="proj-detail-meta-text">{client.company}</span></>}
              {primaryEmail && <><span className="proj-detail-meta-text">·</span><span className="proj-detail-meta-text">{primaryEmail}</span></>}
              {client.status && (
                <span className="proj-detail-badge cli-status-badge">{client.status.label}</span>
              )}
            </div>
          </div>

          <button
            className="proj-detail-delete"
            type="button"
            onClick={() => {
              if (window.confirm('Delete this client and all related projects?')) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            aria-label="Delete client"
            title="Delete client"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" />
            </svg>
          </button>
        </div>

        <nav className="proj-detail-nav">
          <NavLink to="overview" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>General</NavLink>
          <NavLink to="deals" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>
            Projects{client.projects.length > 0 ? ` · ${client.projects.length}` : ''}
          </NavLink>
          <NavLink to="offers" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Offer Builder</NavLink>
          <NavLink to="files" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>
            Files{totalFiles > 0 ? ` · ${totalFiles}` : ''}
          </NavLink>
          <NavLink to="mailing" className={({ isActive }) => `proj-detail-navlink${isActive ? ' active' : ''}`}>Mail Hub</NavLink>
        </nav>
      </div>

      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewTab client={client} />} />
        <Route path="deals" element={<DealsTab client={client} />} />
        <Route path="offers" element={<OfferBuilderTab client={client} />} />
        <Route path="files" element={<FilesTab client={client} />} />
        <Route path="mailing" element={<MailingTab client={client} />} />
      </Routes>
    </div>
  );
}
