import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { MailThread, UnassignedEmail } from './types';

type ClientOption = { id: string; name: string; clientNumber: string; email?: string | null };

type Props = {
  currentClientId: string;
  onLinkedToCurrentClientThread?: (threadId: string) => void;
};

const REFINE_DRAFT_URL = 'https://chatgpt.com/c/68d2359d-fae8-832f-8fc8-8b959e2e04cf';

export function UnassignedInboxPanel(props: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(props.currentClientId);
  const [selectedThreadId, setSelectedThreadId] = useState('');

  const unassignedQuery = useQuery({
    queryKey: ['mail-unassigned', search],
    queryFn: () => api.get<UnassignedEmail[]>(`/mail/unassigned?status=OPEN&q=${encodeURIComponent(search)}`),
    refetchInterval: 20000
  });

  const clientsQuery = useQuery({
    queryKey: ['mail-link-clients', clientSearch],
    queryFn: () => api.get<ClientOption[]>(`/clients?q=${encodeURIComponent(clientSearch)}`)
  });

  const threadsQuery = useQuery({
    queryKey: ['mail-link-threads', selectedClientId],
    queryFn: () => api.get<MailThread[]>(`/mail/clients/${selectedClientId}/threads`),
    enabled: Boolean(selectedClientId)
  });

  const selectedItem = useMemo(
    () => (unassignedQuery.data ?? []).find(item => item.id === selectedId) ?? null,
    [unassignedQuery.data, selectedId]
  );

  const linkMutation = useMutation({
    mutationFn: () => {
      if (!selectedItem) throw new Error('Select unassigned email');
      return api.post<{ status: string; threadId?: string }>(`/mail/unassigned/${selectedItem.id}/link-client`, {
        clientId: selectedClientId,
        threadId: selectedThreadId || undefined
      });
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ['mail-unassigned'] });
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads'] });
      if (selectedClientId === props.currentClientId) {
        queryClient.invalidateQueries({ queryKey: ['mail-client-threads', props.currentClientId] });
        if (result.threadId) {
          props.onLinkedToCurrentClientThread?.(result.threadId);
        }
      }
      setSelectedId(null);
      setSelectedThreadId('');
    }
  });

  return (
    <div className="mail-unassigned-panel card">
      <div className="section-head">
        <h4>Unassigned Inbox</h4>
      </div>

      <input
        className="input"
        placeholder="Search unassigned emails"
        value={search}
        onChange={event => setSearch(event.target.value)}
      />

      {unassignedQuery.isLoading ? <div className="mail-placeholder">Loading unassigned emails...</div> : null}
      {unassignedQuery.isError ? <div className="mail-placeholder error">Failed to load unassigned emails.</div> : null}

      <div className="mail-unassigned-list">
        {(unassignedQuery.data ?? []).map(item => (
          <button
            key={item.id}
            type="button"
            className={selectedId === item.id ? 'mail-thread-item active' : 'mail-thread-item'}
            onClick={() => setSelectedId(item.id)}
          >
            <div className="mail-thread-head">
              <div className="mail-thread-subject">{item.subject}</div>
              <span className="mail-thread-type">{item.provider}</span>
            </div>
            <div className="mail-thread-snippet">{item.bodySnippet || item.bodyText || 'No preview'}</div>
            <div className="mail-thread-meta">
              <span>{item.fromEmail}</span>
              <span>{new Date(item.receivedAt || item.createdAt).toLocaleString()}</span>
            </div>
            {item.reason ? <div className="muted small">Reason: {item.reason}</div> : null}
          </button>
        ))}
      </div>

      <button
        className="ghost-btn"
        type="button"
        onClick={() => {
          window.open(REFINE_DRAFT_URL, '_blank', 'noopener,noreferrer');
        }}
      >
        Refine Message Draft
      </button>

      {selectedItem ? (
        <div className="mail-link-box">
          <h5>Manual link</h5>
          <input
            className="input"
            placeholder="Search client"
            value={clientSearch}
            onChange={event => setClientSearch(event.target.value)}
          />
          <select className="input" value={selectedClientId} onChange={event => setSelectedClientId(event.target.value)}>
            {(clientsQuery.data ?? []).map(client => (
              <option key={client.id} value={client.id}>{client.clientNumber} - {client.name}</option>
            ))}
          </select>
          <select className="input" value={selectedThreadId} onChange={event => setSelectedThreadId(event.target.value)}>
            <option value="">Create/select thread automatically</option>
            {(threadsQuery.data ?? []).map(thread => (
              <option key={thread.id} value={thread.id}>{thread.subject}</option>
            ))}
          </select>
          <button
            className="primary-btn"
            type="button"
            onClick={() => linkMutation.mutate()}
            disabled={linkMutation.isPending || !selectedClientId}
          >
            {linkMutation.isPending ? 'Linking...' : 'Link to client'}
          </button>
          {linkMutation.isError ? <div className="mail-placeholder error">Link failed.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
