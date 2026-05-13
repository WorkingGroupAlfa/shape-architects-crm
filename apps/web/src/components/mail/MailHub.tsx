import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { ThreadListPane } from './ThreadListPane';
import { ThreadTimeline } from './ThreadTimeline';
import { ReplyComposer } from './ReplyComposer';
import { OneTimeComposer } from './OneTimeComposer';
import { CampaignsPanel } from './CampaignsPanel';
import type { FileOption, MailAttachContext, MailMessage, MailMode, MailThread, TemplateOption } from './types';

type MailboxOption = {
  id: string;
  email: string;
  emailNormalized: string;
  label?: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

type Props = {
  clientId: string;
  clientEmails: MailboxOption[];
  files: FileOption[];
};

type MailHubLocationState = {
  mailPrefill?: MailAttachContext;
};

export function MailHub(props: Props) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const locationState = location.state as MailHubLocationState | null;
  const initialPrefill = locationState?.mailPrefill;

  const [mode, setMode] = useState<MailMode>('threads');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'campaign' | 'manual'>('all');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedMailbox, setSelectedMailbox] = useState<string>('all');
  const activeClientEmails = useMemo(
    () => props.clientEmails.filter(item => item.isActive).map(item => item.emailNormalized || item.email.toLowerCase()),
    [props.clientEmails]
  );
  const primaryMailbox =
    props.clientEmails.find(item => item.isPrimary && item.isActive)?.emailNormalized ||
    activeClientEmails[0] ||
    '';

  useEffect(() => {
    if (selectedMailbox === 'all') return;
    if (!activeClientEmails.includes(selectedMailbox)) {
      setSelectedMailbox('all');
    }
  }, [selectedMailbox, activeClientEmails]);

  useEffect(() => {
    if (initialPrefill) {
      setMode('one-time');
    }
  }, [initialPrefill]);

  const templatesQuery = useQuery({
    queryKey: ['templates-options'],
    queryFn: () => api.get<TemplateOption[]>('/templates')
  });

  const threadsQuery = useQuery({
    queryKey: ['mail-client-threads', props.clientId, search, filter, selectedMailbox],
    queryFn: () =>
      api.get<MailThread[]>(
        `/mail/clients/${props.clientId}/threads?search=${encodeURIComponent(search)}&filter=${filter}${
          selectedMailbox !== 'all' ? `&contactEmail=${encodeURIComponent(selectedMailbox)}` : ''
        }`
      ),
    refetchInterval: 12000
  });

  const selectedThread = useMemo(
    () => threadsQuery.data?.find(thread => thread.id === selectedThreadId) ?? null,
    [threadsQuery.data, selectedThreadId]
  );

  useEffect(() => {
    if (!selectedThreadId && threadsQuery.data?.length) {
      setSelectedThreadId(threadsQuery.data[0].id);
    }
  }, [threadsQuery.data, selectedThreadId]);

  const messagesQuery = useQuery({
    queryKey: ['mail-thread-messages', selectedThreadId],
    queryFn: () => api.get<MailMessage[]>(`/mail/threads/${selectedThreadId}/messages`),
    enabled: Boolean(selectedThreadId),
    refetchInterval: selectedThreadId ? 10000 : false
  });

  const manualSyncMutation = useMutation({
    mutationFn: () => api.post(`/mail/clients/${props.clientId}/sync`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads', props.clientId] });
      if (selectedThreadId) {
        queryClient.invalidateQueries({ queryKey: ['mail-thread-messages', selectedThreadId] });
      }
      queryClient.invalidateQueries({ queryKey: ['mail-unassigned'] });
    }
  });

  const markReadMutation = useMutation({
    mutationFn: (threadId: string) => api.post(`/mail/threads/${threadId}/mark-read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads', props.clientId] });
      if (selectedThreadId) {
        queryClient.invalidateQueries({ queryKey: ['mail-thread-messages', selectedThreadId] });
      }
    }
  });

  useEffect(() => {
    if (!selectedThread) return;
    if (selectedThread.unreadCount <= 0) return;
    if (markReadMutation.isPending) return;
    markReadMutation.mutate(selectedThread.id);
  }, [selectedThread?.id, selectedThread?.unreadCount]);

  useEffect(() => {
    if (mode !== 'threads') return;
    if (manualSyncMutation.isPending) return;
    manualSyncMutation.mutate();

    const timer = setInterval(() => {
      if (!manualSyncMutation.isPending) {
        manualSyncMutation.mutate();
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [mode, props.clientId]);

  return (
    <div className="mail-hub-root">
      <div className="mail-hub-topline">
        <div className="mail-mode-row" aria-label="Mail hub modes">
          <button className={mode === 'threads' ? 'mail-mode-btn active' : 'mail-mode-btn'} type="button" onClick={() => setMode('threads')}>Threads</button>
          <button className={mode === 'one-time' ? 'mail-mode-btn active' : 'mail-mode-btn'} type="button" onClick={() => setMode('one-time')}>One-time</button>
          <button className={mode === 'campaigns' ? 'mail-mode-btn active' : 'mail-mode-btn'} type="button" onClick={() => setMode('campaigns')}>Campaigns</button>
        </div>
        <div className="inline-actions mail-refresh-row">
          <button
            className="ghost-btn mail-refresh-btn"
            type="button"
            onClick={() => manualSyncMutation.mutate()}
            disabled={manualSyncMutation.isPending}
            aria-label="Refresh messages"
            title="Refresh messages"
          >
            <RefreshCw size={16} className={manualSyncMutation.isPending ? 'mail-spin' : undefined} />
            <span>{manualSyncMutation.isPending ? 'Refreshing' : 'Refresh'}</span>
          </button>
          {manualSyncMutation.isError ? <span className="muted small">Sync failed.</span> : null}
        </div>
      </div>

      <div className="mail-mailbox-switcher">
        <button
          className={selectedMailbox === 'all' ? 'mail-filter-chip active' : 'mail-filter-chip'}
          type="button"
          onClick={() => setSelectedMailbox('all')}
        >
          All emails
        </button>
        {activeClientEmails.map(email => (
          <button
            key={email}
            className={selectedMailbox === email ? 'mail-filter-chip active' : 'mail-filter-chip'}
            type="button"
            onClick={() => setSelectedMailbox(email)}
          >
            {email}
          </button>
        ))}
      </div>

      {mode === 'threads' ? (
        <div className="mail-threads-layout">
          <ThreadListPane
            threads={threadsQuery.data ?? []}
            selectedThreadId={selectedThreadId}
            search={search}
            filter={filter}
            onSearchChange={setSearch}
            onFilterChange={setFilter}
            onSelect={setSelectedThreadId}
            isLoading={threadsQuery.isLoading}
            errorText={threadsQuery.isError ? 'Failed to load threads.' : undefined}
          />

          <div className="mail-thread-details-pane">
            {!selectedThread ? <div className="mail-placeholder mail-chat-empty">Select a thread to view messages.</div> : null}
            {selectedThread ? (
              <>
                <div className="mail-chat-header">
                  <div className="mail-chat-avatar" aria-hidden="true">
                    {getThreadInitial(selectedThread)}
                  </div>
                  <div className="mail-chat-header-main">
                    <div className="mail-thread-title">{selectedThread.contactEmail || selectedThread.subject}</div>
                    <div className="mail-chat-subtitle">
                      <span>{selectedThread.subject}</span>
                      <span>{selectedThread.threadType}</span>
                    </div>
                  </div>
                  {selectedThread.unreadCount > 0 ? <span className="mail-unread-badge">{selectedThread.unreadCount}</span> : null}
                </div>
                <ThreadTimeline
                  messages={messagesQuery.data ?? []}
                  isLoading={messagesQuery.isLoading}
                  errorText={messagesQuery.isError ? 'Failed to load messages.' : undefined}
                />
                <ReplyComposer
                  thread={selectedThread}
                  recipient={selectedThread.contactEmail || (selectedMailbox !== 'all' ? selectedMailbox : primaryMailbox) || '-'}
                  fileOptions={props.files}
                  templates={templatesQuery.data ?? []}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === 'one-time' ? (
        <OneTimeComposer
          clientId={props.clientId}
          clientEmails={props.clientEmails}
          defaultEmail={initialPrefill?.recipientEmail || (selectedMailbox !== 'all' ? selectedMailbox : primaryMailbox)}
          threads={threadsQuery.data ?? []}
          templates={templatesQuery.data ?? []}
          fileOptions={props.files}
          prefill={
            initialPrefill
              ? {
                  mode: initialPrefill.suggestedMode,
                  subject: initialPrefill.suggestedSubject,
                  templateId: initialPrefill.suggestedTemplateId,
                  projectId: initialPrefill.projectId,
                  invoiceId: initialPrefill.invoiceId,
                  attachment: initialPrefill.attachment
                }
              : null
          }
          onOpenThread={(threadId: string) => {
            setSelectedThreadId(threadId);
            setMode('threads');
          }}
        />
      ) : null}

      {mode === 'campaigns' ? (
        <CampaignsPanel clientId={props.clientId} templates={templatesQuery.data ?? []} />
      ) : null}
    </div>
  );
}

function getThreadInitial(thread: MailThread) {
  const source = thread.contactEmail || thread.subject || 'M';
  return source.trim().charAt(0).toUpperCase();
}
