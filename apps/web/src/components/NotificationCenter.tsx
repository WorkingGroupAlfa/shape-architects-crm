import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  taskId?: string | null;
  task?: {
    id: string;
    title: string;
    date: string;
    status: 'TODO' | 'DONE' | 'POSTPONED';
    client?: { name?: string | null } | null;
    project?: { title?: string | null } | null;
  } | null;
};

type ExecutorActivityItem = {
  id: string;
  entityType: string;
  entityId: string;
  projectDisplayNumber?: string | null;
  action: string;
  message: string;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
};

const ACTIVITY_DISMISSED_STORAGE_KEY = 'shape_executor_activity_dismissed_ids';

export function NotificationCenter() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dismissedSnapshot, setDismissedSnapshot] = useState<string | null>(null);
  const [checkedActivityIds, setCheckedActivityIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(ACTIVITY_DISMISSED_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  });

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationItem[]>('/notifications'),
    refetchInterval: 10000
  });

  const activityQuery = useQuery({
    queryKey: ['executor-activity'],
    queryFn: () => api.get<ExecutorActivityItem[]>('/notifications/executor-activity'),
    refetchInterval: 10000
  });

  const doneMutation = useMutation({
    mutationFn: (taskId: string) => api.patch(`/calendar/tasks/${taskId}`, { status: 'DONE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] });
    }
  });

  const items = data ?? [];
  const snapshotKey = useMemo(
    () => items.map(item => `${item.id}:${item.task?.status ?? 'UNKNOWN'}`).join('|'),
    [items]
  );
  const nowTs = Date.now();
  const sortedItems = [...items].sort((a, b) => {
    const aTs = a.task?.date ? new Date(a.task.date).getTime() : new Date(a.createdAt).getTime();
    const bTs = b.task?.date ? new Date(b.task.date).getTime() : new Date(b.createdAt).getTime();

    const aStarted = aTs <= nowTs;
    const bStarted = bTs <= nowTs;

    if (aStarted !== bStarted) {
      return aStarted ? -1 : 1;
    }

    return aTs - bTs;
  });

  const activityItems = activityQuery.data ?? [];
  const visibleActivityItems = activityItems.filter(item => !checkedActivityIds.includes(item.id));
  const activitySnapshot = activityItems.map(item => `${item.id}:${item.createdAt}`).join('|');
  const fullSnapshot = `${snapshotKey}::${activitySnapshot}`;
  if (dismissedSnapshot && dismissedSnapshot === fullSnapshot) return null;
  if (!items.length && !visibleActivityItems.length) return null;

  const markActivityIdsDone = (ids: string[]) => {
    if (!ids.length) return;
    setCheckedActivityIds(prev => {
      const merged = [...new Set([...prev, ...ids])].slice(-400);
      try {
        window.localStorage.setItem(ACTIVITY_DISMISSED_STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }
      return merged;
    });
  };

  const resolveProjectTarget = (item: ExecutorActivityItem) => {
    if (item.action.includes('file')) return `/projects/${item.entityId}/files`;
    if (item.action.includes('task')) return `/projects/${item.entityId}/tasks`;
    return `/projects/${item.entityId}/comments`;
  };

  return (
    <div className="task-alert-overlay" role="dialog" aria-modal="true" aria-label="Task alerts">
      <div className="task-alert-modal card">
        <div className="section-head">
          <h3>Upcoming and Active Tasks</h3>
          <div className="inline-actions">
            <button
              className="icon-btn"
              type="button"
              aria-label="Close notifications window"
              title="Close notifications window"
              onClick={() => setDismissedSnapshot(fullSnapshot)}
            >
              x
            </button>
          </div>
        </div>

        {sortedItems.length ? (
          <div className="list-stack">
            {sortedItems.map(item => (
              <div key={item.id} className="task-alert-item">
                <div>
                  <div className="notification-title">{item.task?.title ?? item.title}</div>
                  <div className="notification-message">{item.message.replace(/[•�]/g, ' | ')}</div>
                  <div className="muted small">
                    {item.task?.date ? new Date(item.task.date).toLocaleString() : new Date(item.createdAt).toLocaleString()}
                    {(item.task?.client?.name || item.task?.project?.title) ? ` | ${[item.task?.client?.name, item.task?.project?.title].filter(Boolean).join(' | ')}` : ''}
                  </div>
                </div>

                <div className="inline-actions">
                  {item.taskId ? (
                    <button className="primary-btn" type="button" onClick={() => doneMutation.mutate(item.taskId!)}>
                      Mark Done
                    </button>
                  ) : null}
                  <button className="ghost-btn" type="button" onClick={() => navigate('/calendar')}>
                    Open Calendar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {visibleActivityItems.length ? (
          <div className="list-stack section-gap-sm">
            <div className="section-head activity-journal-head">
              <h3>Executor Activity Journal</h3>
              <button
                className="ghost-btn activity-icon-btn"
                type="button"
                onClick={() => markActivityIdsDone(visibleActivityItems.map(item => item.id))}
                aria-label="Mark all activity items done"
                title="Mark all done"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h12v2H3V5zm0 6h12v2H3v-2zm0 6h12v2H3v-2zm14.5 1.5l-2.8-2.8 1.4-1.4 1.4 1.4 3.1-3.1 1.4 1.4-4.5 4.5z" />
                </svg>
              </button>
            </div>
            {visibleActivityItems.map(item => (
              <div key={item.id} className="task-alert-item">
                <div>
                  <div className="notification-title">{item.user?.name ?? 'Executor'}: {item.message}</div>
                  <div className="muted small">
                    {new Date(item.createdAt).toLocaleString()} | Project #{item.projectDisplayNumber ?? item.entityId}
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    className="ghost-btn activity-icon-btn activity-open-project-btn"
                    type="button"
                    onClick={() => navigate(resolveProjectTarget(item))}
                    aria-label="Open project"
                    title="Open project"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 3h7v7" />
                      <path d="M10 14L21 3" />
                      <path d="M19 14v5H5V5h5" />
                    </svg>
                  </button>
                  <button
                    className="ghost-btn activity-icon-btn activity-done-btn"
                    type="button"
                    onClick={() => markActivityIdsDone([item.id])}
                    aria-label="Mark activity done"
                    title="Done"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

