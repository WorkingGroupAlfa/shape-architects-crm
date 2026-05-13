import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, FolderPlus, Plus, X } from 'lucide-react';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { api } from '../lib/api';

type ClientOption = { id: string; name: string; clientNumber: string };
type EmployeeOption = { id: string; name: string; email: string };
type ProjectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type ProjectStatus = 'DEVELOPMENT' | 'APPROVAL' | 'COMPLETED';

const PRIORITY_ORDER: Record<ProjectPriority, number> = {
  VERY_HIGH: 0, HIGH: 1, MEDIUM: 2, LOW: 3
};
const STATUS_ORDER: Record<ProjectStatus, number> = {
  DEVELOPMENT: 0, APPROVAL: 1, COMPLETED: 2
};
const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', VERY_HIGH: 'Very High'
};
const STATUS_LABELS: Record<ProjectStatus, string> = {
  DEVELOPMENT: 'Development', APPROVAL: 'Approval', COMPLETED: 'Completed'
};

type Project = {
  id: string;
  invoiceNumber?: string;
  createdAt: string;
  title: string;
  status: ProjectStatus | string;
  priority: ProjectPriority | string;
  client: { id: string; name: string; clientNumber: string };
  executor?: { id: string; name: string } | null;
  income: number;
  expense: number;
  taxAmount: number;
  profit: number;
};

type CreateProjectForm = {
  title: string;
  clientId: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  description: string;
  accessUserIds: string[];
};

function parseFilterDate(value: string, isEndOfDay = false): number | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const ts = new Date(`${y}-${m}-${d}T${isEndOfDay ? '23:59:59.999' : '00:00:00'}`).getTime();
    return Number.isNaN(ts) ? null : ts;
  }
  const dotMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    const [, d, m, y] = dotMatch;
    const ts = new Date(`${y}-${m}-${d}T${isEndOfDay ? '23:59:59.999' : '00:00:00'}`).getTime();
    return Number.isNaN(ts) ? null : ts;
  }
  const shortDotMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (shortDotMatch) {
    const [, d, m, y2] = shortDotMatch;
    const ts = new Date(`20${y2}-${m}-${d}T${isEndOfDay ? '23:59:59.999' : '00:00:00'}`).getTime();
    return Number.isNaN(ts) ? null : ts;
  }
  return null;
}

// ── Create Project Panel ───────────────────────────────────────────
function CreateProjectPanel({
  clients,
  employees,
  onClose,
  onCreate,
  isPending,
  error,
}: {
  clients: ClientOption[];
  employees: EmployeeOption[];
  onClose: () => void;
  onCreate: (form: CreateProjectForm) => void;
  isPending: boolean;
  error: string;
}) {
  const [form, setForm] = useState<CreateProjectForm>({
    title: '', clientId: '', status: 'DEVELOPMENT', priority: 'MEDIUM',
    description: '', accessUserIds: [],
  });

  const canCreate = form.title.trim().length >= 2 && form.clientId.length > 0;

  const toggleAccess = (userId: string) =>
    setForm(prev => ({
      ...prev,
      accessUserIds: prev.accessUserIds.includes(userId)
        ? prev.accessUserIds.filter(id => id !== userId)
        : [...prev.accessUserIds, userId],
    }));

  const statuses: { value: ProjectStatus; label: string }[] = [
    { value: 'DEVELOPMENT', label: 'Development' },
    { value: 'APPROVAL',    label: 'Approval' },
    { value: 'COMPLETED',   label: 'Completed' },
  ];

  const priorities: { value: ProjectPriority; label: string }[] = [
    { value: 'LOW',       label: 'Low' },
    { value: 'MEDIUM',    label: 'Medium' },
    { value: 'HIGH',      label: 'High' },
    { value: 'VERY_HIGH', label: 'Very High' },
  ];

  return (
    <div className="cal-panel">
      <div className="cal-panel-head">
        <div className="cal-panel-headings">
          <FolderPlus size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <span className="cal-panel-title">New project</span>
        </div>
        <button type="button" className="cal-panel-close" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>

      <div className="cal-panel-body">
        <div className="cal-field">
          <label className="cal-label">Project title</label>
          <input
            className="input"
            value={form.title}
            autoFocus
            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. Villa Renovation — Smith"
          />
        </div>

        <div className="cal-field">
          <label className="cal-label">Client</label>
          <select
            className="input"
            value={form.clientId}
            onChange={e => setForm(prev => ({ ...prev, clientId: e.target.value }))}
          >
            <option value="" disabled>Select client…</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.clientNumber} — {c.name}</option>
            ))}
          </select>
        </div>

        <div className="cal-field">
          <label className="cal-label">Status</label>
          <div className="cal-type-btns" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {statuses.map(s => (
              <button key={s.value} type="button"
                className={`cal-type-btn proj-status-${s.value.toLowerCase()}${form.status === s.value ? ' active' : ''}`}
                onClick={() => setForm(prev => ({ ...prev, status: s.value }))}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cal-field">
          <label className="cal-label">Priority</label>
          <div className="cal-type-btns" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {priorities.map(p => (
              <button key={p.value} type="button"
                className={`cal-type-btn proj-priority-${p.value.toLowerCase()}${form.priority === p.value ? ' active' : ''}`}
                onClick={() => setForm(prev => ({ ...prev, priority: p.value }))}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {employees.length > 0 && (
          <div className="cal-field">
            <label className="cal-label">Team access</label>
            <div className="proj-access-chips">
              {employees.map(e => (
                <button key={e.id} type="button"
                  className={`proj-access-chip${form.accessUserIds.includes(e.id) ? ' active' : ''}`}
                  onClick={() => toggleAccess(e.id)}>
                  {e.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="cal-field">
          <label className="cal-label">Description <span className="cal-label-opt">(optional)</span></label>
          <textarea
            className="input textarea"
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Project brief, scope of work…"
            rows={3}
          />
        </div>

        {error && <p className="proj-panel-error">{error}</p>}

        <button
          type="button"
          className="primary-btn"
          style={{ width: '100%' }}
          disabled={!canCreate || isPending}
          onClick={() => onCreate(form)}
        >
          {isPending ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export function ProjectsPage({ role = 'ADMIN' }: { role?: 'ADMIN' | 'EMPLOYEE' }) {
  const isAdmin = role === 'ADMIN';
  const [q, setQ] = useState('');
  const [showSortPanel, setShowSortPanel] = useState(false);
  const [sortByPriority, setSortByPriority] = useState(false);
  const [sortByStatus, setSortByStatus] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listView, setListView] = useState<'active' | 'completed'>('active');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createError, setCreateError] = useState('');
  const [contentLeft, setContentLeft] = useState(0);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('main.content');
      if (el) setContentLeft(el.getBoundingClientRect().left);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/projects'),
  });
  const clientsQuery = useQuery({
    queryKey: ['clients-options'],
    queryFn: () => api.get<ClientOption[]>('/clients'),
    enabled: isAdmin,
  });
  const employeesQuery = useQuery({
    queryKey: ['users-employees-options'],
    queryFn: () => api.get<EmployeeOption[]>('/users/employees'),
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateProjectForm) =>
      api.post<Project>('/projects', {
        title: payload.title,
        clientId: payload.clientId,
        status: payload.status,
        priority: payload.priority,
        description: payload.description || undefined,
        accessUserIds: payload.accessUserIds,
      }),
    onSuccess: project => {
      setCreateError('');
      setShowCreatePanel(false);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}`);
    },
    onError: (error: unknown) => {
      setCreateError(error instanceof Error ? error.message : 'Failed to create project');
    },
  });

  const filteredProjects = (projectsQuery.data ?? [])
    .filter(project => {
      const value = q.toLowerCase();
      const matchesSearch =
        (project.invoiceNumber ?? '').toLowerCase().includes(value) ||
        project.title.toLowerCase().includes(value) ||
        (isAdmin && project.client.name.toLowerCase().includes(value));
      if (!matchesSearch) return false;
      const createdAt = new Date(project.createdAt).getTime();
      if (Number.isNaN(createdAt)) return true;
      const fromTs = parseFilterDate(dateFrom, false);
      if (fromTs !== null && createdAt < fromTs) return false;
      const toTs = parseFilterDate(dateTo, true);
      if (toTs !== null && createdAt > toTs) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortByPriority) {
        const diff = (PRIORITY_ORDER[a.priority as ProjectPriority] ?? 999) - (PRIORITY_ORDER[b.priority as ProjectPriority] ?? 999);
        if (diff !== 0) return diff;
      }
      if (sortByStatus) {
        const diff = (STATUS_ORDER[a.status as ProjectStatus] ?? 999) - (STATUS_ORDER[b.status as ProjectStatus] ?? 999);
        if (diff !== 0) return diff;
      }
      return 0;
    });

  const activeProjects    = filteredProjects.filter(p => (p.status as ProjectStatus) !== 'COMPLETED');
  const completedProjects = filteredProjects.filter(p => (p.status as ProjectStatus) === 'COMPLETED');
  const visibleProjects   = listView === 'active' ? activeProjects : completedProjects;

  const closePanel = () => { setShowCreatePanel(false); setCreateError(''); };

  return (
    <div className="page-grid">
      <Card>
        <div className="section-head">
          <h3>Projects</h3>
          <div className="section-head-controls projects-mobile-toolbar">
            <div className="sort-filter-wrap projects-filter-wrap">
              <button className="icon-btn" type="button" onClick={() => setShowSortPanel(prev => !prev)} aria-label="Sort projects">
                <Filter size={18} />
              </button>
              <div className={showSortPanel ? 'sort-filter-panel sort-filter-panel-inline open' : 'sort-filter-panel sort-filter-panel-inline'}>
                <div className="sort-inline-item">
                  <span className="small muted">From:</span>
                  <input className="sort-filter-date-input" type="text" inputMode="numeric" placeholder="DD.MM.YY" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div className="sort-inline-item">
                  <span className="small muted">Till:</span>
                  <input className="sort-filter-date-input" type="text" inputMode="numeric" placeholder="DD.MM.YY" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                <label className="sort-filter-option">
                  <input type="checkbox" checked={sortByPriority} onChange={e => setSortByPriority(e.target.checked)} />
                  <span>Sort by priority</span>
                </label>
                <label className="sort-filter-option">
                  <input type="checkbox" checked={sortByStatus} onChange={e => setSortByStatus(e.target.checked)} />
                  <span>Sort by status</span>
                </label>
                <button className="ghost-btn" type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}>Reset</button>
              </div>
            </div>

            <input
              className="input projects-search-input"
              placeholder="Search by invoice #, title, client..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            {isAdmin && (
              <button className="icon-btn projects-add-btn" type="button" onClick={() => setShowCreatePanel(true)} aria-label="Add project">
                <Plus size={18} />
              </button>
            )}
          </div>
        </div>

        <div className={showSortPanel ? 'projects-inline-filters mobile-only open' : 'projects-inline-filters mobile-only'}>
          <div className="sort-inline-item">
            <span className="small muted">From:</span>
            <input className="sort-filter-date-input" type="text" inputMode="numeric" placeholder="DD.MM.YY" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="sort-inline-item">
            <span className="small muted">Till:</span>
            <input className="sort-filter-date-input" type="text" inputMode="numeric" placeholder="DD.MM.YY" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <label className="sort-filter-option">
            <input type="checkbox" checked={sortByPriority} onChange={e => setSortByPriority(e.target.checked)} />
            <span>Sort by priority</span>
          </label>
          <label className="sort-filter-option">
            <input type="checkbox" checked={sortByStatus} onChange={e => setSortByStatus(e.target.checked)} />
            <span>Sort by status</span>
          </label>
          <button className="ghost-btn" type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}>Reset</button>
        </div>

        <div className="muted small">
          IN PROGRESS: {activeProjects.length} | READY: {completedProjects.length}
        </div>
        <div className="projects-switcher" role="tablist" aria-label="Project lists">
          <button type="button" className={listView === 'active' ? 'projects-switch-btn active' : 'projects-switch-btn'} onClick={() => setListView('active')}>
            In Progress
          </button>
          <button type="button" className={listView === 'completed' ? 'projects-switch-btn active' : 'projects-switch-btn'} onClick={() => setListView('completed')}>
            Ready
          </button>
        </div>

        <div className="section-head" />

        <div className="desktop-only">
          <Table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Title</th>
                {isAdmin && <th>Client</th>}
                <th>Status</th>
                {isAdmin && <th>Income</th>}
                {isAdmin && <th>Expense</th>}
                {isAdmin && <th>Tax</th>}
                {isAdmin && <th>Profit</th>}
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map(project => (
                <tr key={project.id} className="clickable-row" onClick={() => navigate(`/projects/${project.id}`)}>
                  <td><span className={`priority-dot priority-${project.priority.toLowerCase()}`} />{project.invoiceNumber || '-'}</td>
                  <td>{project.title}</td>
                  {isAdmin && <td>{project.client.name}</td>}
                  <td>{STATUS_LABELS[project.status as ProjectStatus] ?? project.status}</td>
                  {isAdmin && <td>${project.income}</td>}
                  {isAdmin && <td>${project.expense}</td>}
                  {isAdmin && <td>${project.taxAmount}</td>}
                  {isAdmin && <td>${project.profit}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="mobile-record-list mobile-only">
          {visibleProjects.map(project => (
            <button key={project.id} type="button" className="mobile-record-card mobile-project-strip" onClick={() => navigate(`/projects/${project.id}`)}>
              <div className="mobile-project-strip-title"><strong>{project.title}</strong></div>
              <div className="mobile-project-strip-meta">
                {isAdmin && (
                  <span className="mobile-project-meta-item">
                    <span className="muted small">Client</span>
                    <span>{project.client.name}</span>
                  </span>
                )}
                <span className="mobile-project-meta-item">
                  <span className="muted small">Priority</span>
                  <span>{PRIORITY_LABELS[project.priority as ProjectPriority] ?? project.priority}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {showCreatePanel && isAdmin && createPortal(
        <>
          <div
            className="edit-panel-backdrop"
            style={{ left: contentLeft }}
            onClick={closePanel}
          />
          <CreateProjectPanel
            clients={clientsQuery.data ?? []}
            employees={employeesQuery.data ?? []}
            onClose={closePanel}
            onCreate={form => createMutation.mutate(form)}
            isPending={createMutation.isPending}
            error={createError}
          />
        </>,
        document.body,
      )}
    </div>
  );
}
