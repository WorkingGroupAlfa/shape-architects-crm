import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, UserPlus, X } from 'lucide-react';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { api } from '../lib/api';

type ClientStatus = { id: string; key: string; label: string };
type Client = {
  id: string;
  clientNumber: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  abn?: string;
  status: ClientStatus;
  projects: Array<{ id: string; title: string }>;
};

export function ClientsPage() {
  const [q, setQ] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    abn: '',
    address: '',
    leadSource: ''
  });
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

  const clientsQuery = useQuery({
    queryKey: ['clients', q],
    queryFn: () => api.get<Client[]>(`/clients?q=${encodeURIComponent(q)}`)
  });

  const statusesQuery = useQuery({
    queryKey: ['client-statuses'],
    queryFn: () => api.get<ClientStatus[]>('/clients/statuses')
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const defaultStatusId = statusesQuery.data?.find(status => status.key === 'target')?.id ?? statusesQuery.data?.[0]?.id;
      if (!defaultStatusId) {
        throw new Error('Client statuses are not available. Please refresh page.');
      }

      return api.post<Client>('/clients', {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        abn: form.abn || undefined,
        address: form.address || undefined,
        leadSource: form.leadSource || undefined,
        statusId: defaultStatusId
      });
    },
    onSuccess: client => {
      setShowCreatePanel(false);
      setForm({ name: '', email: '', phone: '', company: '', abn: '', address: '', leadSource: '' });
      setCreateError('');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      navigate(`/clients/${client.id}`);
    },
    onError: error => {
      setCreateError(error instanceof Error ? error.message : 'Create failed');
    }
  });

  const targetStatusId = statusesQuery.data?.find(status => status.key === 'target')?.id ?? null;
  const negotiationsStatusId = statusesQuery.data?.find(status => status.key === 'negotiations')?.id ?? null;
  const notTargetStatusId = statusesQuery.data?.find(status => status.key === 'not_target')?.id ?? null;
  const closePanel = () => { setShowCreatePanel(false); setCreateError(''); };

  const statusToggleMutation = useMutation({
    mutationFn: ({ clientId, statusId }: { clientId: string; statusId: string }) =>
      api.patch<Client>(`/clients/${clientId}`, { statusId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    }
  });

  return (
    <div className="page-grid">
      <Card>
        <div className="section-head">
          <h3>Clients</h3>
          <div className="section-head-controls desktop-only">
            <input
              className="input"
              placeholder="Search by name, email, company..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <button className="icon-btn" type="button" onClick={() => setShowCreatePanel(true)} aria-label="Add client">
              <Plus size={18} />
            </button>
          </div>
        </div>

        <div className="mobile-only clients-mobile-toolbar">
          <input
            className="input"
            placeholder="Search by name, email, company..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button className="icon-btn clients-mobile-add-btn" type="button" onClick={() => setShowCreatePanel(true)} aria-label="Add client">
            <Plus size={18} />
          </button>
        </div>

        <div className="desktop-only">
          <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Contacts</th>
              <th>Company</th>
              <th>Status</th>
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {clientsQuery.data?.map(client => (
              <tr key={client.id} className="clickable-row" onClick={() => navigate(`/clients/${client.id}`)}>
                <td>{client.status.key === 'target' ? client.clientNumber : '-'}</td>
                <td>{client.name}</td>
                <td>
                  <div>{client.email ?? '-'}</div>
                  <div className="muted small">{client.phone ?? ''}</div>
                </td>
                <td>{client.company ?? '-'}</td>
                <td>
                  <div className="clients-status-lights" onClick={event => event.stopPropagation()}>
                    <button
                      type="button"
                      className={client.status.key === 'target' ? 'clients-status-light is-target active' : 'clients-status-light is-target'}
                      aria-label="Target client"
                      title="Target"
                      disabled={!targetStatusId || statusToggleMutation.isPending}
                      onClick={() => {
                        if (!targetStatusId || client.status.key === 'target') return;
                        statusToggleMutation.mutate({ clientId: client.id, statusId: targetStatusId });
                      }}
                    />
                    <button
                      type="button"
                      className={client.status.key === 'negotiations' ? 'clients-status-light is-in-progress active' : 'clients-status-light is-in-progress'}
                      aria-label="Negotiation in progress"
                      title="Negotiations"
                      disabled={!negotiationsStatusId || statusToggleMutation.isPending}
                      onClick={() => {
                        if (!negotiationsStatusId || client.status.key === 'negotiations') return;
                        statusToggleMutation.mutate({ clientId: client.id, statusId: negotiationsStatusId });
                      }}
                    />
                    <button
                      type="button"
                      className={client.status.key === 'not_target' ? 'clients-status-light is-not-target active' : 'clients-status-light is-not-target'}
                      aria-label="Not target client"
                      title="Not target"
                      disabled={!notTargetStatusId || statusToggleMutation.isPending}
                      onClick={() => {
                        if (!notTargetStatusId || client.status.key === 'not_target') return;
                        statusToggleMutation.mutate({ clientId: client.id, statusId: notTargetStatusId });
                      }}
                    />
                  </div>
                </td>
                <td>{client.projects.length}</td>
              </tr>
            ))}
          </tbody>
          </Table>
        </div>

        <div className="mobile-record-list mobile-only">
          {clientsQuery.data?.map(client => (
            <div
              key={client.id}
              className="mobile-record-card mobile-client-strip"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/clients/${client.id}`)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/clients/${client.id}`);
                }
              }}
            >
              <div className="mobile-client-strip-head">
                <div className="mobile-client-strip-main">
                  <strong>{client.name}</strong>
                  <span className="muted small">{client.status.key === 'target' ? client.clientNumber : '-'}</span>
                </div>
                <ChevronRight size={16} />
              </div>
              <div className="clients-status-lights mobile" onClick={event => event.stopPropagation()}>
                <button
                  type="button"
                  className={client.status.key === 'target' ? 'clients-status-light is-target active' : 'clients-status-light is-target'}
                  aria-label="Target client"
                  title="Target"
                  disabled={!targetStatusId || statusToggleMutation.isPending}
                  onClick={() => {
                    if (!targetStatusId || client.status.key === 'target') return;
                    statusToggleMutation.mutate({ clientId: client.id, statusId: targetStatusId });
                  }}
                />
                <button
                  type="button"
                  className={client.status.key === 'negotiations' ? 'clients-status-light is-in-progress active' : 'clients-status-light is-in-progress'}
                  aria-label="Negotiation in progress"
                  title="Negotiations"
                  disabled={!negotiationsStatusId || statusToggleMutation.isPending}
                  onClick={() => {
                    if (!negotiationsStatusId || client.status.key === 'negotiations') return;
                    statusToggleMutation.mutate({ clientId: client.id, statusId: negotiationsStatusId });
                  }}
                />
                <button
                  type="button"
                  className={client.status.key === 'not_target' ? 'clients-status-light is-not-target active' : 'clients-status-light is-not-target'}
                  aria-label="Not target client"
                  title="Not target"
                  disabled={!notTargetStatusId || statusToggleMutation.isPending}
                  onClick={() => {
                    if (!notTargetStatusId || client.status.key === 'not_target') return;
                    statusToggleMutation.mutate({ clientId: client.id, statusId: notTargetStatusId });
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {showCreatePanel && createPortal(
        <>
          <div
            className="edit-panel-backdrop"
            style={{ left: contentLeft }}
            onClick={closePanel}
          />
          <div className="cal-panel">
            <div className="cal-panel-head">
              <div className="cal-panel-headings">
                <UserPlus size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <span className="cal-panel-title">New client</span>
              </div>
              <button type="button" className="cal-panel-close" onClick={closePanel} aria-label="Close">
                <X size={15} />
              </button>
            </div>

            <div className="cal-panel-body">
              <div className="cal-field">
                <label className="cal-label">Name</label>
                <input
                  className="input"
                  placeholder="Client name"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  autoFocus
                />
              </div>

              <div className="cal-field">
                <label className="cal-label">Email</label>
                <input
                  className="input"
                  type="email"
                  placeholder="email@example.com"
                  value={form.email}
                  onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>

              <div className="cal-field">
                <label className="cal-label">Phone</label>
                <input
                  className="input"
                  type="tel"
                  placeholder="+61 400 000 000"
                  value={form.phone}
                  onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>

              <div className="cal-field">
                <label className="cal-label">Company</label>
                <input
                  className="input"
                  placeholder="Company name"
                  value={form.company}
                  onChange={e => setForm(prev => ({ ...prev, company: e.target.value }))}
                />
              </div>

              <div className="cal-field">
                <label className="cal-label">ABN</label>
                <input
                  className="input"
                  placeholder="12 345 678 901"
                  value={form.abn}
                  onChange={e => setForm(prev => ({ ...prev, abn: e.target.value }))}
                />
              </div>

              <div className="cal-field">
                <label className="cal-label">Address</label>
                <input
                  className="input"
                  placeholder="Street, City, State"
                  value={form.address}
                  onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>

              <div className="cal-field">
                <label className="cal-label">Lead source</label>
                <input
                  className="input"
                  placeholder="Referral, Instagram, etc."
                  value={form.leadSource}
                  onChange={e => setForm(prev => ({ ...prev, leadSource: e.target.value }))}
                />
              </div>

              {statusesQuery.isError ? (
                <div className="muted small">Failed to load statuses. Refresh page.</div>
              ) : null}

              {createError ? <div className="muted small" style={{ color: 'var(--danger)' }}>{createError}</div> : null}

              <button
                className="primary-btn"
                type="button"
                style={{ width: '100%', marginTop: 4 }}
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || form.name.trim().length < 2 || !statusesQuery.data?.length}
              >
                {createMutation.isPending ? 'Creating...' : 'Create client'}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
