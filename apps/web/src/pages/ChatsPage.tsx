import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, MessageCircle } from 'lucide-react';
import { api } from '../lib/api';

type Role = 'ADMIN' | 'EMPLOYEE';
type SessionUser = { id: string; name: string; email: string; role: Role };
type ChatSummary = {
  id: string;
  title: string;
  invoiceNumber?: string | null;
  unreadCount: number;
  lastActivityAt: string;
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    userId?: string | null;
    user?: { id: string; name: string; email: string } | null;
  } | null;
};
type ProjectChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  userId?: string | null;
  user?: { id: string; name: string; email: string } | null;
};
type ProjectChatDetails = {
  id: string;
  title: string;
  invoiceNumber?: string | null;
  files: Array<{ id: string; originalName: string; storedName: string; mimeType: string }>;
};

const API_BASE = api.baseUrl;
const CHAT_IMAGE_PREFIX = '[[image-file:';
const ANNOTATABLE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

function parseChatImageFileId(content: string) {
  if (!content.startsWith(CHAT_IMAGE_PREFIX) || !content.endsWith(']]')) return null;
  return content.slice(CHAT_IMAGE_PREFIX.length, -2).trim() || null;
}

function getInitials(title: string) {
  return title.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export function ChatsPage({ role = 'ADMIN' }: { role?: Role }) {
  const queryClient = useQueryClient();
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<string>('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [openedImageFileId, setOpenedImageFileId] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<SessionUser>('/auth/me'),
  });
  const chatsQuery = useQuery({
    queryKey: ['project-chats', role],
    queryFn: () => api.get<ChatSummary[]>('/projects/chats'),
    refetchInterval: 2500,
  });
  const activeProjectQuery = useQuery({
    queryKey: ['project-chat-details', activeChatId],
    queryFn: () => api.get<ProjectChatDetails>(`/projects/${activeChatId}`),
    enabled: Boolean(activeChatId),
  });
  const commentsQuery = useQuery({
    queryKey: ['project-comments', activeChatId],
    queryFn: () => api.get<ProjectChatMessage[]>(`/projects/${activeChatId}/comments`),
    enabled: Boolean(activeChatId),
    refetchInterval: 2000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: () => api.post(`/projects/${activeChatId}/comments`, { content: newMessage.trim() }),
    onSuccess: () => {
      setNewMessage('');
      if (!activeChatId) return;
      queryClient.invalidateQueries({ queryKey: ['project-comments', activeChatId] });
      queryClient.invalidateQueries({ queryKey: ['project-chats', role] });
    },
  });
  const markReadMutation = useMutation({
    mutationFn: ({ projectId, lastSeenAt }: { projectId: string; lastSeenAt: string }) =>
      api.post(`/projects/${projectId}/comments/read`, { lastSeenAt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-chats', role] }),
  });

  const chats = chatsQuery.data ?? [];
  const activeSummary = activeChatId ? chats.find(c => c.id === activeChatId) : null;
  const messages = commentsQuery.data ?? [];

  const filesById = useMemo(() => {
    const map = new Map<string, ProjectChatDetails['files'][number]>();
    for (const f of activeProjectQuery.data?.files ?? []) map.set(f.id, f);
    return map;
  }, [activeProjectQuery.data?.files]);

  const fileBaseUrl = API_BASE.replace(/\/api$/, '');
  const openedImageFile = openedImageFileId ? filesById.get(openedImageFileId) ?? null : null;
  const openedImageUrl = openedImageFile
    ? `${fileBaseUrl}/storage/uploads/${openedImageFile.storedName}`
    : '';

  const isMobileDialogOpen = Boolean(activeChatId);
  const activeTitle = activeProjectQuery.data?.title ?? activeSummary?.title ?? '';
  const activeInvoice = activeProjectQuery.data?.invoiceNumber ?? activeSummary?.invoiceNumber;

  // Auto-select first chat
  useEffect(() => {
    if (!chats.length) { setActiveChatId(null); return; }
    if (activeChatId && chats.some(c => c.id === activeChatId)) return;
    setActiveChatId(chats.find(c => c.unreadCount > 0)?.id ?? chats[0].id);
  }, [activeChatId, chats]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (timelineRef.current)
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [messages.length, activeChatId]);

  // Mark messages read
  useEffect(() => {
    if (!activeChatId || !messages.length) return;
    const lastAt = messages[messages.length - 1]?.createdAt;
    if (!lastAt) return;
    const marker = `${activeChatId}:${lastAt}`;
    if (lastMarkedRef.current === marker) return;
    lastMarkedRef.current = marker;
    markReadMutation.mutate({ projectId: activeChatId, lastSeenAt: lastAt });
  }, [activeChatId, markReadMutation, messages]);

  const fmtDate = (v: string) =>
    new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtTime = (v: string) =>
    new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className="chats-page">

      {/* ── Left: conversation list ── */}
      <aside className={`chats-list${isMobileDialogOpen ? ' mobile-hidden' : ''}`}>
        <div className="chats-list-header">
          <span className="chats-list-title">Chats</span>
          {chats.length > 0 && <span className="chats-list-count">{chats.length}</span>}
        </div>

        <div className="chats-list-body">
          {chats.length === 0 && !chatsQuery.isLoading && (
            <p className="muted small" style={{ padding: '16px' }}>No project chats yet.</p>
          )}
          {chats.map(chat => {
            const isActive = chat.id === activeChatId;
            const preview = chat.lastMessage?.user?.name
              ? `${chat.lastMessage.user.name}: ${chat.lastMessage.content}`
              : (chat.lastMessage?.content ?? 'No messages yet');
            return (
              <button
                key={chat.id}
                type="button"
                className={`chats-item${isActive ? ' active' : ''}`}
                onClick={() => setActiveChatId(chat.id)}
              >
                <div className="chats-item-avatar">{getInitials(chat.title)}</div>
                <div className="chats-item-content">
                  <div className="chats-item-row">
                    <span className="chats-item-name">{chat.title}</span>
                    <span className="chats-item-time">{fmtTime(chat.lastActivityAt)}</span>
                  </div>
                  <div className="chats-item-row">
                    <span className="chats-item-preview">{preview}</span>
                    {chat.unreadCount > 0 && (
                      <span className="chats-item-badge">{chat.unreadCount}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Right: dialog area ── */}
      <section className={`chats-dialog${isMobileDialogOpen ? ' mobile-open' : ''}`}>
        {activeChatId && activeProjectQuery.data ? (
          <>
            {/* Dialog header */}
            <div className="chats-dialog-header">
              <button
                type="button"
                className="ghost-btn chats-back-btn"
                onClick={() => setActiveChatId(null)}
                aria-label="Back"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="chats-dialog-info">
                <span className="chats-dialog-name">{activeTitle}</span>
                {activeInvoice && (
                  <span className="chats-dialog-invoice">#{activeInvoice}</span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              className="project-chat-timeline chats-timeline"
              ref={timelineRef}
            >
              {messages.map(item => {
                const isMine = meQuery.data?.id
                  ? item.user?.id === meQuery.data.id || item.userId === meQuery.data.id
                  : false;
                const author = item.user?.name || 'System';
                const imageFileId = parseChatImageFileId(item.content);
                const imageFile = imageFileId ? filesById.get(imageFileId) : undefined;
                const isImg = Boolean(
                  imageFile && ANNOTATABLE_MIMES.has((imageFile.mimeType || '').toLowerCase())
                );
                const imgUrl = imageFile
                  ? `${fileBaseUrl}/storage/uploads/${imageFile.storedName}`
                  : '';

                return (
                  <div key={item.id} className={`project-chat-row${isMine ? ' mine' : ''}`}>
                    <div className={
                      `project-chat-bubble${isMine ? ' mine' : ''}${isImg ? ' image-message' : ''}`
                    }>
                      <div className="project-chat-head">
                        <span className={`project-chat-author${isMine ? ' mine' : ''}`}>
                          {author}
                        </span>
                        <span className="project-chat-date">{fmtDate(item.createdAt)}</span>
                      </div>
                      {isImg && imageFile ? (
                        <div className="project-chat-image-wrap">
                          <button
                            type="button"
                            className="project-chat-image-btn"
                            onClick={() => setOpenedImageFileId(imageFile.id)}
                            aria-label={`Open ${imageFile.originalName}`}
                          >
                            <img
                              className="project-chat-image"
                              src={imgUrl}
                              alt={imageFile.originalName}
                              loading="lazy"
                            />
                          </button>
                          <div className="project-chat-time image-time">{fmtTime(item.createdAt)}</div>
                        </div>
                      ) : (
                        <div className="project-chat-text">{item.content}</div>
                      )}
                      {!isImg && <div className="project-chat-time">{fmtTime(item.createdAt)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div className="project-chat-composer chats-composer">
              <textarea
                className="input project-chat-input"
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && newMessage.trim()) {
                    e.preventDefault();
                    sendMessageMutation.mutate();
                  }
                }}
                placeholder="Type a message…"
              />
              <button
                className="project-chat-send-btn"
                type="button"
                onClick={() => sendMessageMutation.mutate()}
                disabled={!newMessage.trim() || sendMessageMutation.isPending}
                aria-label="Send"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3.4 11.2L19.9 3.6c.9-.4 1.8.5 1.4 1.4l-7.6 16.5c-.4.9-1.7.8-2-.1l-1.5-5-5-1.5c-.9-.3-1-.6-.8-1.7z" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className="chats-empty">
            <MessageCircle size={28} strokeWidth={1.5} />
            <h3>Select a chat</h3>
            <p className="muted">Open a project chat from the list.</p>
          </div>
        )}
      </section>

      {/* Image lightbox */}
      {openedImageFile && (
        <div className="overlay project-chat-image-overlay" onClick={() => setOpenedImageFileId(null)}>
          <div
            className="overlay-card project-chat-image-modal"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="project-chat-image-close"
              aria-label="Close"
              onClick={() => setOpenedImageFileId(null)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <img
              className="project-chat-image-full"
              src={openedImageUrl}
              alt={openedImageFile.originalName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
