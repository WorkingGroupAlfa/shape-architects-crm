import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react';
import type { MailMessage } from './types';

type Props = {
  messages: MailMessage[];
  isLoading: boolean;
  errorText?: string;
};

function parseJsonList(value?: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function ThreadTimeline(props: Props) {
  const orderedMessages = useMemo(
    () =>
      [...props.messages].sort((a, b) => {
        const aDate = new Date(a.sentAt || a.receivedAt || a.createdAt).getTime();
        const bDate = new Date(b.sentAt || b.receivedAt || b.createdAt).getTime();
        return aDate - bDate;
      }),
    [props.messages]
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orderedMessages.length) return;
    setExpandedIds(new Set([orderedMessages[orderedMessages.length - 1].id]));
  }, [orderedMessages]);

  if (props.isLoading) return <div className="mail-placeholder">Loading messages...</div>;
  if (props.errorText) return <div className="mail-placeholder error">{props.errorText}</div>;
  if (!orderedMessages.length) return <div className="mail-placeholder">No messages in this thread yet.</div>;

  return (
    <div className="mail-timeline">
      {orderedMessages.map(message => {
        const directionClass = message.direction === 'incoming' ? 'incoming' : 'outgoing';
        const cc = parseJsonList(message.cc);
        const bcc = parseJsonList(message.bcc);
        const messageDate = message.sentAt || message.receivedAt || message.createdAt;
        const isExpanded = expandedIds.has(message.id);
        const preview = buildPreview(message);
        const actor = message.direction === 'incoming' ? message.fromEmail : message.toEmail;
        const showSubject = isExpanded && message.subject.trim().length > 0;

        return (
          <article key={message.id} className={`mail-message-card ${directionClass}`}>
            <div
              className="mail-message-head mail-message-head-clickable"
              role="button"
              tabIndex={0}
              onClick={() => toggleMessageExpanded(message.id, setExpandedIds)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleMessageExpanded(message.id, setExpandedIds);
              }}
            >
              <div className="mail-message-head-main">
                <span className="mail-message-avatar" aria-hidden="true">{actor.trim().charAt(0).toUpperCase()}</span>
                <span className="mail-thread-actor">{actor}</span>
              </div>
              <div className="mail-message-head-meta">
                {message.attachments?.length ? <Paperclip size={14} aria-hidden="true" /> : null}
                <span className="mail-message-date">{formatMessageTime(messageDate)}</span>
                <span className="mail-expand-indicator">
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </span>
              </div>
            </div>

            {showSubject ? <div className="mail-message-subject">{message.subject}</div> : null}
            {!isExpanded ? <div className="mail-message-preview">{preview}</div> : null}

            {isExpanded ? (
              <>
                <div className="mail-message-body-frame">
                  <div
                    className="mail-message-html"
                    dangerouslySetInnerHTML={{ __html: buildMessageHtml(message) }}
                  />
                </div>

                <div className="mail-message-meta">
                  <span><strong>From:</strong> {message.fromEmail}</span>
                  <span><strong>To:</strong> {message.toEmail}</span>
                  {cc.length ? <span><strong>CC:</strong> {cc.join(', ')}</span> : null}
                  {bcc.length ? <span><strong>BCC:</strong> {bcc.join(', ')}</span> : null}
                </div>

                {message.attachments?.length ? (
                  <div className="mail-attachment-list">
                    {message.attachments.map(attachment => (
                      <span key={attachment.id || `${message.id}-${attachment.fileName}`} className="mail-attachment-chip">{attachment.fileName}</span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toggleMessageExpanded(
  messageId: string,
  setExpandedIds: (updater: (prev: Set<string>) => Set<string>) => void
) {
  setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(messageId)) {
      next.delete(messageId);
    } else {
      next.add(messageId);
    }
    return next;
  });
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildMessageHtml(message: MailMessage) {
  const rawHtml = selectMessageHtml(message);
  return sanitizeMessageHtml(rawHtml);
}

function selectMessageHtml(message: MailMessage) {
  const html = (message.bodyHtml || '').trim();
  if (html) return html;
  const text = (message.bodyText || message.bodySnippet || '').trim();
  return escapeHtml(text).replace(/\n/g, '<br />');
}

function sanitizeMessageHtml(input: string) {
  let output = input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<link[\s\S]*?>/gi, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<base[\s\S]*?>/gi, '')
    .replace(/<title[\s\S]*?>[\s\S]*?<\/title>/gi, '')
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, '')
    .replace(/\sstyle\s*=\s*'[^']*'/gi, '');

  output = output
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1=$2#$2')
    .replace(/(href|src)\s*=\s*(['"])\s*data:text\/html[^'"]*\2/gi, '$1=$2#$2');

  return output;
}

function buildPreview(message: MailMessage) {
  const text = (message.bodyText || message.bodySnippet || stripHtml(message.bodyHtml || '')).trim();
  if (!text) return 'No preview';
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
