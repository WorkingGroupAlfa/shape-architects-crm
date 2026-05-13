import { Search } from 'lucide-react';
import type { MailThread } from './types';

type Props = {
  threads: MailThread[];
  selectedThreadId: string | null;
  search: string;
  filter: 'all' | 'unread' | 'campaign' | 'manual';
  onSearchChange: (value: string) => void;
  onFilterChange: (value: 'all' | 'unread' | 'campaign' | 'manual') => void;
  onSelect: (threadId: string) => void;
  isLoading: boolean;
  errorText?: string;
};

const FILTERS: Array<{ key: 'all' | 'unread' | 'campaign' | 'manual'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'manual', label: 'Manual' }
];

export function ThreadListPane(props: Props) {
  return (
    <div className="mail-thread-list-pane">
      <div className="mail-thread-list-head">
        <div>
          <h4>Messages</h4>
          <span>{props.threads.length} conversations</span>
        </div>
      </div>
      <div className="mail-thread-toolbar">
        <label className="mail-search-box">
          <Search size={16} aria-hidden="true" />
          <input
            className="input"
            placeholder="Search chats..."
            value={props.search}
            onChange={event => props.onSearchChange(event.target.value)}
          />
        </label>
        <div className="mail-filter-row">
          {FILTERS.map(filter => (
            <button
              key={filter.key}
              className={props.filter === filter.key ? 'mail-filter-chip active' : 'mail-filter-chip'}
              type="button"
              onClick={() => props.onFilterChange(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {props.isLoading ? <div className="mail-placeholder">Loading threads...</div> : null}
      {props.errorText ? <div className="mail-placeholder error">{props.errorText}</div> : null}
      {!props.isLoading && !props.errorText && props.threads.length === 0 ? (
        <div className="mail-placeholder">No threads found for this filter.</div>
      ) : null}

      <div className="mail-thread-list">
        {props.threads.map(thread => {
          const isActive = props.selectedThreadId === thread.id;
          const date = thread.lastMessageAt || thread.createdAt;
          const displayName = thread.contactEmail || thread.subject;
          const displayDate = formatCompactDate(date);
          return (
            <button
              key={thread.id}
              type="button"
              className={isActive ? 'mail-thread-item active' : 'mail-thread-item'}
              onClick={() => props.onSelect(thread.id)}
            >
              <span className="mail-thread-avatar" aria-hidden="true">
                {displayName.trim().charAt(0).toUpperCase()}
              </span>
              <div className="mail-thread-head">
                <div className="mail-thread-subject">{displayName}</div>
                <span className="mail-thread-time">{displayDate}</span>
              </div>
              <div className="mail-thread-topic">{thread.subject}</div>
              <div className="mail-thread-snippet">{thread.lastMessageSnippet || 'No messages yet.'}</div>
              <div className="mail-thread-meta">
                <span className="mail-thread-type">{thread.threadType}</span>
                {thread.unreadCount > 0 ? <span className="mail-unread-badge">{thread.unreadCount}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
