import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Calendar, Check, ChevronLeft, ChevronRight, Clock,
  Flag, Layers, Phone, Plus, Trash2, Users, X,
} from 'lucide-react';
import { api } from '../lib/api';

type Task = {
  id: string;
  title: string;
  description?: string;
  date: string;
  priority: string;
  status: 'TODO' | 'DONE' | 'POSTPONED';
  type?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  executorId?: string | null;
  client?: { name?: string };
  project?: { title?: string };
  executor?: { id: string; name: string } | null;
};

type TaskForm = {
  title: string;
  description: string;
  date: string;
  priority: string;
  type: string;
  clientId: string;
  projectId: string;
  executorId: string;
};

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TYPE_META: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  meeting:  { icon: Users,   label: 'Meeting',  color: '#5b8dd9' },
  deadline: { icon: Flag,    label: 'Deadline', color: '#c86464' },
  call:     { icon: Phone,   label: 'Call',     color: '#7dab6e' },
  internal: { icon: Layers,  label: 'Internal', color: '#9d88c8' },
};

function getTypeMeta(type?: string | null) {
  return type ? (TYPE_META[type] ?? null) : null;
}

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const days: Array<{ date: string; dayNum: number; isCurrentMonth: boolean }> = [];
  const prevLastDay = new Date(year, month, 0);
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevLastDay.getDate() - i);
    days.push({ date: toLocalDateStr(d), dayNum: d.getDate(), isCurrentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: toLocalDateStr(new Date(year, month, d)), dayNum: d, isCurrentMonth: true });
  }
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({ date: toLocalDateStr(new Date(year, month + 1, d)), dayNum: d, isCurrentMonth: false });
  }
  return days;
}

function TaskPanel({
  task, defaultDate, clients, projects, executors,
  onClose, onSave, onDelete, isPending,
}: {
  task: Task | null;
  defaultDate: string;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; title: string }>;
  executors: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (form: TaskForm) => void;
  onDelete?: () => void;
  isPending?: boolean;
}) {
  const [form, setForm] = useState<TaskForm>({
    title:       task?.title ?? '',
    description: task?.description ?? '',
    date:        task ? (task.date ? new Date(task.date).toISOString().slice(0, 16) : '') : `${defaultDate}T09:00`,
    priority:    task?.priority ?? 'medium',
    type:        task?.type ?? 'meeting',
    clientId:    task?.clientId ?? '',
    projectId:   task?.projectId ?? '',
    executorId:  task?.executorId ?? '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = task === null;
  const canSave = form.title.trim().length > 0 && form.date.length > 0;
  const set = <K extends keyof TaskForm>(k: K, v: TaskForm[K]) => setForm(p => ({ ...p, [k]: v }));

  const activeMeta = getTypeMeta(form.type);
  const ActiveIcon = activeMeta?.icon ?? Calendar;

  return (
    <div className="cal-panel">
      <div className="cal-panel-head">
        <div className="cal-panel-headings">
          <ActiveIcon size={14} style={{ color: activeMeta?.color ?? 'var(--text-dim)', flexShrink: 0 }} />
          <span className="cal-panel-title">{isNew ? 'New task' : form.title || 'Edit task'}</span>
        </div>
        <button type="button" className="cal-panel-close" onClick={onClose}><X size={15} /></button>
      </div>

      <div className="cal-panel-body">

        {/* Type */}
        <div className="cal-field">
          <label className="cal-label">Type</label>
          <div className="cal-type-btns">
            {Object.entries(TYPE_META).map(([key, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={key}
                  type="button"
                  className={`cal-type-btn type-${key}${form.type === key ? ' active' : ''}`}
                  onClick={() => set('type', key)}
                >
                  <Icon size={11} />{meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div className="cal-field">
          <label className="cal-label">Title</label>
          <input
            className="input" value={form.title} autoFocus={isNew}
            onChange={e => set('title', e.target.value)} placeholder="Task title"
          />
        </div>

        {/* Date */}
        <div className="cal-field">
          <label className="cal-label">Date &amp; Time</label>
          <input className="input" type="datetime-local" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>

        {/* Priority */}
        <div className="cal-field">
          <label className="cal-label">Priority</label>
          <div className="cal-priority-btns">
            {(['low', 'medium', 'high'] as const).map(p => (
              <button key={p} type="button"
                className={`cal-priority-btn priority-${p}${form.priority === p ? ' active' : ''}`}
                onClick={() => set('priority', p)}>{p}
              </button>
            ))}
          </div>
        </div>

        {/* Executor */}
        <div className="cal-field">
          <label className="cal-label">Executor</label>
          <select className="input" value={form.executorId} onChange={e => set('executorId', e.target.value)}>
            <option value="">No executor</option>
            {executors.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
          </select>
        </div>

        {/* Description */}
        <div className="cal-field">
          <label className="cal-label">Description</label>
          <textarea className="input textarea" value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Optional notes…" style={{ minHeight: 72, resize: 'vertical' }}
          />
        </div>

        {/* Client */}
        <div className="cal-field">
          <label className="cal-label">Client</label>
          <select className="input" value={form.clientId} onChange={e => set('clientId', e.target.value)}>
            <option value="">No client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Project */}
        <div className="cal-field">
          <label className="cal-label">Project</label>
          <select className="input" value={form.projectId} onChange={e => set('projectId', e.target.value)}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>

        <button type="button" className="primary-btn" style={{ width: '100%' }}
          disabled={!canSave || isPending} onClick={() => onSave(form)}>
          {isPending ? 'Saving…' : isNew ? 'Create task' : 'Save changes'}
        </button>

        {!isNew && onDelete && (
          <div className="cal-danger-zone">
            {confirmDelete ? (
              <div className="tmpl-confirm-delete">
                <p className="muted small">Delete this task permanently?</p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="button" className="danger-btn" style={{ flex: 1 }} onClick={onDelete}>Delete</button>
                  <button type="button" className="ghost-btn" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" className="danger-btn-outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> Delete task
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendarPage() {
  const queryClient = useQueryClient();
  const today = toLocalDateStr(new Date());

  const [selectedDate, setSelectedDate] = useState(today);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contentLeft, setContentLeft] = useState(0);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('main.content');
      if (el) setContentLeft(el.getBoundingClientRect().left);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const tasksQuery = useQuery({
    queryKey: ['calendar-tasks'],
    queryFn: () => api.get<Task[]>('/calendar/tasks'),
  });
  const clientsQuery = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/clients'),
  });
  const projectsQuery = useQuery({
    queryKey: ['project-options'],
    queryFn: () => api.get<Array<{ id: string; title: string }>>('/projects'),
  });
  const executorsQuery = useQuery({
    queryKey: ['executor-options'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/executors'),
  });

  const createMutation = useMutation({
    mutationFn: (form: TaskForm) => api.post('/calendar/tasks', {
      title: form.title, description: form.description || undefined,
      date: form.date, priority: form.priority,
      type: form.type || undefined,
      clientId: form.clientId || undefined, projectId: form.projectId || undefined,
      executorId: form.executorId || undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] }); closePanel(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: TaskForm }) =>
      api.patch(`/calendar/tasks/${id}`, {
        title: form.title, description: form.description || undefined,
        date: form.date, priority: form.priority,
        type: form.type || null,
        clientId: form.clientId || null, projectId: form.projectId || null,
        executorId: form.executorId || null,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] }); closePanel(); },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/calendar/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] }),
  });

  const dragMutation = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      api.patch(`/calendar/tasks/${id}`, { date }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/calendar/tasks/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['calendar-tasks'] });
      const prev = queryClient.getQueryData<Task[]>(['calendar-tasks']);
      queryClient.setQueryData<Task[]>(['calendar-tasks'], old => old ? old.filter(t => t.id !== id) : []);
      closePanel();
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(['calendar-tasks'], context.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['calendar-tasks'] }),
  });

  const tasks     = tasksQuery.data     ?? [];
  const clients   = clientsQuery.data   ?? [];
  const projects  = projectsQuery.data  ?? [];
  const executors = executorsQuery.data ?? [];

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = toLocalDateStr(new Date(task.date));
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const calendarDays = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const selectedDayTasks = tasksByDate.get(selectedDate) ?? [];

  // Upcoming 7 days (non-done tasks)
  const upcomingDays = useMemo(() => {
    const result: Array<{ date: string; label: string; isToday: boolean; tasks: Task[] }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = toLocalDateStr(d);
      const dayTasks = (tasksByDate.get(dateStr) ?? [])
        .filter(t => t.status !== 'DONE')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      if (dayTasks.length === 0) continue;
      const label = i === 0 ? 'Today'
        : i === 1 ? 'Tomorrow'
        : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      result.push({ date: dateStr, label, isToday: i === 0, tasks: dayTasks });
    }
    return result;
  }, [tasksByDate]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };
  const goToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); setSelectedDate(today);
  };

  const openNew  = () => { setEditingTask(null); setPanelOpen(true); };
  const openEdit = (task: Task) => { setEditingTask(task); setPanelOpen(true); };
  const closePanel = () => { setPanelOpen(false); setEditingTask(null); };

  const handleSave = (form: TaskForm) => {
    if (editingTask) updateMutation.mutate({ id: editingTask.id, form });
    else createMutation.mutate(form);
  };

  const handleDrop = (targetDate: string) => {
    if (!draggedTask) return;
    const orig  = new Date(draggedTask.date);
    const hh    = String(orig.getHours()).padStart(2, '0');
    const mm    = String(orig.getMinutes()).padStart(2, '0');
    dragMutation.mutate({ id: draggedTask.id, date: `${targetDate}T${hh}:${mm}` });
    const d = new Date(`${targetDate}T00:00:00`);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDate(targetDate);
  };

  const fmtSelectedDate = () => {
    const d = new Date(`${selectedDate}T00:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const fmtTime = (s: string) =>
    new Date(s).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="cal-page">
      <div className="reviews-header">
        <div>
          <h2>Calendar</h2>
          <p className="muted small">Schedule and track tasks across your projects.</p>
        </div>
        <button type="button" className="primary-btn" onClick={openNew}>
          <Plus size={14} /> New task
        </button>
      </div>

      <div className="cal-layout">

        {/* ── Month grid ── */}
        <div className="cal-month-panel">
          <div className="cal-month-nav">
            <button type="button" className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <div className="cal-month-center">
              <span className="cal-month-label">{MONTHS[viewMonth]} {viewYear}</span>
              {(viewYear !== new Date().getFullYear() || viewMonth !== new Date().getMonth()) && (
                <button type="button" className="cal-today-btn" onClick={goToday}>Today</button>
              )}
            </div>
            <button type="button" className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="cal-weekdays">
            {WEEKDAYS.map(d => <span key={d} className="cal-weekday">{d}</span>)}
          </div>

          <div className="cal-grid">
            {calendarDays.map(day => {
              const dayTasks   = tasksByDate.get(day.date) ?? [];
              const isToday    = day.date === today;
              const isSelected = day.date === selectedDate;
              const isDragOver = day.date === dragOverDate;
              // Collect unique type colors for dots
              const typeColors: string[] = [];
              const seen = new Set<string>();
              for (const t of dayTasks) {
                if (t.status === 'DONE') continue;
                const color = t.type && TYPE_META[t.type] ? TYPE_META[t.type].color : '#7B8269';
                if (!seen.has(color)) { seen.add(color); typeColors.push(color); }
                if (typeColors.length >= 3) break;
              }

              return (
                <button
                  key={day.date}
                  type="button"
                  className={[
                    'cal-day',
                    !day.isCurrentMonth ? 'other-month' : '',
                    isToday    ? 'today'     : '',
                    isSelected ? 'selected'  : '',
                    isDragOver ? 'drag-over' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setSelectedDate(day.date);
                    if (!day.isCurrentMonth) {
                      const d = new Date(`${day.date}T00:00:00`);
                      setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
                    }
                  }}
                  onDragOver={e => { e.preventDefault(); setDragOverDate(day.date); }}
                  onDragLeave={() => setDragOverDate(null)}
                  onDrop={e => { e.preventDefault(); handleDrop(day.date); setDragOverDate(null); }}
                >
                  <span className="cal-day-num">{day.dayNum}</span>
                  {typeColors.length > 0 && (
                    <div className="cal-day-dots">
                      {typeColors.map((color, i) => (
                        <span key={i} className="cal-dot" style={{ background: color }} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="cal-legend">
            {Object.entries(TYPE_META).map(([key, meta]) => (
              <span key={key} className="cal-legend-item">
                <span className="cal-dot" style={{ background: meta.color }} />
                {meta.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Day tasks ── */}
        <div className="cal-tasks-panel">
          <div className="cal-tasks-header">
            <span className="cal-tasks-date">{fmtSelectedDate()}</span>
          </div>

          {tasksQuery.isLoading ? (
            <div className="cal-tasks-empty"><p className="muted small">Loading…</p></div>
          ) : selectedDayTasks.length === 0 ? (
            <div className="cal-tasks-empty">
              <p className="muted small">No tasks for this day.</p>
              <button type="button" className="ghost-btn" style={{ marginTop: 10, fontSize: 12 }} onClick={openNew}>
                <Plus size={12} /> Add task
              </button>
            </div>
          ) : (
            <div className="cal-tasks-list">
              {selectedDayTasks.map(task => {
                const meta    = getTypeMeta(task.type);
                const TypeIcon = meta?.icon;
                const barColor = meta ? meta.color
                  : task.priority === 'high' ? '#c86464'
                  : task.priority === 'low'  ? '#6aaa7a' : '#e0a44a';
                return (
                  <div
                    key={task.id}
                    className={`cal-task-item${task.status === 'DONE' ? ' status-done' : ''}`}
                    draggable
                    onDragStart={() => setDraggedTask(task)}
                    onDragEnd={() => setDraggedTask(null)}
                  >
                    <div className="cal-task-priority-bar" style={{ background: barColor }} />
                    <div className="cal-task-body" onClick={() => openEdit(task)}>
                      <div className="cal-task-title">
                        {TypeIcon && (
                          <span className="cal-task-type-icon" style={{ color: meta!.color }}>
                            <TypeIcon size={10} />
                          </span>
                        )}
                        {task.title}
                      </div>
                      <div className="cal-task-meta">
                        <span className={`cal-status-chip status-${task.status.toLowerCase()}`}>
                          {task.status === 'TODO' ? 'To do' : task.status === 'DONE' ? 'Done' : 'Postponed'}
                        </span>
                        <span className="cal-task-time"><Clock size={10} />{fmtTime(task.date)}</span>
                        {task.executor?.name && <span className="cal-task-client">{task.executor.name}</span>}
                        {task.client?.name   && <span className="cal-task-client">{task.client.name}</span>}
                      </div>
                    </div>
                    <div className="cal-task-actions">
                      {task.status !== 'DONE' && (
                        <button type="button" className="cal-task-action-btn done" title="Mark done"
                          onClick={e => { e.stopPropagation(); statusMutation.mutate({ id: task.id, status: 'DONE' }); }}>
                          <Check size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="cal-task-action-btn delete"
                        title="Delete task"
                        disabled={deleteMutation.isPending}
                        onClick={e => { e.stopPropagation(); deleteMutation.mutate(task.id); }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Upcoming 7 days ── */}
      {upcomingDays.length > 0 && (
        <div className="cal-agenda">
          <div className="cal-agenda-header">
            <span className="cal-agenda-title">Upcoming 7 days</span>
            <span className="cal-agenda-subtitle">
              {upcomingDays.reduce((s, g) => s + g.tasks.length, 0)} open tasks
            </span>
          </div>
          <div className="cal-agenda-body">
            {upcomingDays.map(({ date, label, isToday, tasks: dayTasks }) => (
              <div key={date} className="cal-agenda-group">
                <div className={`cal-agenda-day-label${isToday ? ' today' : ''}`}>
                  <span>{label}</span>
                  <span className="cal-agenda-count">{dayTasks.length}</span>
                </div>
                <div className="cal-agenda-tasks">
                  {dayTasks.map(task => {
                    const meta     = getTypeMeta(task.type);
                    const TypeIcon = meta?.icon ?? Calendar;
                    return (
                      <div
                        key={task.id}
                        className={`cal-agenda-task${task.status === 'POSTPONED' ? ' postponed' : ''}`}
                        onClick={() => {
                          setSelectedDate(date);
                          const d = new Date(`${date}T00:00:00`);
                          setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
                          openEdit(task);
                        }}
                      >
                        <span
                          className="cal-agenda-type-icon"
                          style={{
                            background: meta ? `${meta.color}20` : 'rgba(255,255,255,0.06)',
                            color: meta?.color ?? 'var(--text-faint)',
                          }}
                        >
                          <TypeIcon size={11} />
                        </span>
                        <span className="cal-agenda-task-title">{task.title}</span>
                        <span className="cal-agenda-task-time"><Clock size={10} />{fmtTime(task.date)}</span>
                        {(task.executor?.name || task.client?.name) && (
                          <span className="cal-agenda-task-person">
                            {task.executor?.name ?? task.client?.name}
                          </span>
                        )}
                        <span className={`cal-status-chip status-${task.status.toLowerCase()} cal-agenda-chip`}>
                          {task.status === 'TODO' ? 'To do' : 'Postponed'}
                        </span>
                        <button
                          type="button"
                          className="cal-task-action-btn delete cal-agenda-delete"
                          title="Delete task"
                          disabled={deleteMutation.isPending}
                          onClick={e => { e.stopPropagation(); deleteMutation.mutate(task.id); }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {panelOpen && createPortal(
        <>
          <div className="edit-panel-backdrop" style={{ left: contentLeft }} onClick={closePanel} />
          <TaskPanel
            task={editingTask} defaultDate={selectedDate}
            clients={clients} projects={projects} executors={executors}
            onClose={closePanel} onSave={handleSave}
            onDelete={editingTask ? () => deleteMutation.mutate(editingTask.id) : undefined}
            isPending={isPending}
          />
        </>,
        document.body,
      )}
    </div>
  );
}
