import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FileText, Mail, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';

type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
};

type TemplateForm = { name: string; subject: string; body: string };

const VARIABLES = ['{{name}}', '{{company}}', '{{project}}', '{{date}}', '{{amount}}'];

function TemplateCard({
  template,
  selected,
  onClick,
}: {
  template: Template;
  selected: boolean;
  onClick: () => void;
}) {
  const date = new Date(template.createdAt).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className={`tmpl-card${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="tmpl-card-icon">
        <Mail size={14} />
      </div>
      <div className="tmpl-card-body">
        <div className="tmpl-card-top">
          <span className="tmpl-card-name">{template.name}</span>
          <span className="tmpl-card-date">{date}</span>
        </div>
        <p className="tmpl-card-subject">{template.subject}</p>
        <p className="tmpl-card-preview">{template.body}</p>
      </div>
    </div>
  );
}

function TemplatePanel({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isNew = template === null;

  useEffect(() => {
    setName(template?.name ?? '');
    setSubject(template?.subject ?? '');
    setBody(template?.body ?? '');
    setConfirmDelete(false);
  }, [template?.id]);

  const createMutation = useMutation({
    mutationFn: () => api.post('/templates', { name: name.trim(), subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates-options'] });
      onSaved();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/templates/${template!.id}`, { name: name.trim(), subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates-options'] });
      onSaved();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/templates/${template!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates-options'] });
      onClose();
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canSave = name.trim().length > 0 && subject.trim().length > 0 && body.trim().length > 0;

  const insertVariable = (v: string) => {
    const el = bodyRef.current;
    if (!el) { setBody(b => b + v); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + v + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + v.length, start + v.length);
    });
  };

  const copyBody = () => {
    navigator.clipboard.writeText(body);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 1800);
  };

  return (
    <div className="tmpl-panel">
      <div className="tmpl-panel-head">
        <div className="tmpl-panel-headings">
          <FileText size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <span className="tmpl-panel-title">{isNew ? 'New template' : name || 'Edit template'}</span>
        </div>
        <button type="button" className="tmpl-panel-close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="tmpl-panel-body">
        <div className="tmpl-field">
          <label className="tmpl-label">Template name</label>
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Initial Contact"
            autoFocus={isNew}
          />
        </div>

        <div className="tmpl-field">
          <label className="tmpl-label">Subject line</label>
          <input
            className="input"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Thank you for contacting Shape Architects"
          />
        </div>

        <div className="tmpl-field">
          <div className="tmpl-label-row">
            <label className="tmpl-label">Body</label>
            <button type="button" className="tmpl-copy-body" onClick={copyBody} title="Copy body">
              {copiedBody ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <textarea
            ref={bodyRef}
            className="input textarea tmpl-body-textarea"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Dear {{name}}, thank you for your inquiry…"
          />
        </div>

        <div className="tmpl-vars">
          <span className="tmpl-vars-label">Insert variable</span>
          <div className="tmpl-vars-list">
            {VARIABLES.map(v => (
              <button key={v} type="button" className="tmpl-var-chip" onClick={() => insertVariable(v)}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="primary-btn"
          style={{ width: '100%' }}
          disabled={!canSave || isPending}
          onClick={() => isNew ? createMutation.mutate() : updateMutation.mutate()}
        >
          {isPending ? 'Saving…' : isNew ? 'Create template' : 'Save changes'}
        </button>

        {!isNew && (
          <div className="tmpl-danger-zone">
            {confirmDelete ? (
              <div className="tmpl-confirm-delete">
                <p className="muted small">Delete this template permanently?</p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="button" className="danger-btn" style={{ flex: 1 }} onClick={() => deleteMutation.mutate()}>
                    Delete
                  </button>
                  <button type="button" className="ghost-btn" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="danger-btn-outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> Delete template
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function TemplatesPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [contentLeft, setContentLeft] = useState(0);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('main.content');
      if (el) setContentLeft(el.getBoundingClientRect().left);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<Template[]>('/templates'),
  });

  const templates = templatesQuery.data ?? [];

  const filtered = templates;

  const selectedTemplate = selectedId ? templates.find(t => t.id === selectedId) ?? null : null;

  const panelOpen = showCreate || Boolean(selectedId);

  const closePanel = () => {
    setSelectedId(null);
    setShowCreate(false);
  };

  return (
    <div className="tmpl-page">
      <div className="reviews-header">
        <div>
          <h2>Email Templates</h2>
          <p className="muted small">Reusable email templates with dynamic variables for client communication.</p>
        </div>
        <button
          type="button"
          className="primary-btn"
          onClick={() => { setSelectedId(null); setShowCreate(true); }}
        >
          <Plus size={14} /> New template
        </button>
      </div>

      {templatesQuery.isLoading ? (
        <p className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="reviews-empty">
          <p className="muted">No templates yet.</p>
          <button type="button" className="ghost-btn" style={{ marginTop: '12px' }}
            onClick={() => { setSelectedId(null); setShowCreate(true); }}>
            Create first template
          </button>
        </div>
      ) : (
        <div className="tmpl-list">
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={t.id === selectedId}
              onClick={() => {
                setShowCreate(false);
                setSelectedId(prev => (prev === t.id ? null : t.id));
              }}
            />
          ))}
        </div>
      )}

      {panelOpen && createPortal(
        <>
          <div
            className="edit-panel-backdrop"
            style={{ left: contentLeft }}
            onClick={closePanel}
          />
          <TemplatePanel
            template={showCreate ? null : selectedTemplate}
            onClose={closePanel}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['templates'] });
              closePanel();
            }}
          />
        </>,
        document.body,
      )}
    </div>
  );
}
