import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Eye, EyeOff, Image, Link2, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { api } from '../lib/api';

type ReviewStatus = 'DRAFT' | 'SHARED' | 'CLOSED';

type ReviewListItem = {
  id: string;
  title: string;
  token: string;
  status: ReviewStatus;
  createdAt: string;
  project?: { id: string; title: string; invoiceNumber?: string | null } | null;
  client?: { id: string; name: string; clientNumber: string } | null;
  _count: { images: number; annotations: number; guests: number };
  clientPassword?: string;
};

type ReviewDetails = ReviewListItem & {
  images: Array<{ id: string; originalName: string; storedName: string; fileSize: number; sortOrder: number }>;
};

type ProjectOption = { id: string; title: string; invoiceNumber?: string | null; client: { id: string; name: string } };
type ClientOption = { id: string; name: string; clientNumber: string };

const API_BASE = api.baseUrl;
const STORAGE_BASE = API_BASE.replace(/\/api$/, '');
const imageUrl = (storedName: string) => `${STORAGE_BASE}/storage/uploads/${storedName}`;
const publicLinkFor = (token: string) => `${window.location.origin}/review/${token}`;

const WORDS = ['coral', 'stone', 'ember', 'ridge', 'arch', 'delta', 'grove', 'haven', 'lumen', 'slate', 'prism', 'vault', 'forge', 'crest', 'swift'];
function generatePassword(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${word}${num}`;
}

function accumulateFiles(prev: File[], incoming: FileList | null): File[] {
  if (!incoming?.length) return prev;
  const existing = new Set(prev.map(f => f.name + f.size));
  return [...prev, ...Array.from(incoming).filter(f => !existing.has(f.name + f.size))];
}

function ImageDropZone({
  files,
  onAdd,
  onRemove,
  existingImages = [],
  onDeleteExisting,
}: {
  files: File[];
  onAdd: (f: FileList | null) => void;
  onRemove: (i: number) => void;
  existingImages?: ReviewDetails['images'];
  onDeleteExisting?: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      onAdd(e.dataTransfer.files);
    },
    [onAdd],
  );

  return (
    <div className="review-dropzone-wrapper">
      <div
        className={`review-dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => { onAdd(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
        />
        <Upload size={22} className="review-dropzone-icon" />
        <p className="review-dropzone-label">
          Drop images here or <span className="review-dropzone-link">click to browse</span>
        </p>
        <p className="review-dropzone-hint">JPG, PNG, WEBP — multiple files supported</p>
      </div>

      {(existingImages.length > 0 || files.length > 0) && (
        <div className="review-thumb-grid">
          {existingImages.map(img => (
            <div key={img.id} className="review-thumb-item">
              <img
                src={imageUrl(img.storedName)}
                alt={img.originalName}
                onError={e => { (e.currentTarget as HTMLImageElement).src = ''; (e.currentTarget as HTMLImageElement).classList.add('broken'); }}
              />
              {onDeleteExisting && (
                <button
                  className="review-thumb-remove"
                  type="button"
                  onClick={e => { e.stopPropagation(); onDeleteExisting(img.id); }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
          {previews.map((url, i) => (
            <div key={url} className="review-thumb-item review-thumb-new">
              <img src={url} alt={files[i].name} />
              <button
                className="review-thumb-remove"
                type="button"
                onClick={e => { e.stopPropagation(); onRemove(i); }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WizardSteps({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <div className="wizard-steps">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`wizard-step${i + 1 === current ? ' active' : i + 1 < current ? ' done' : ''}`}>
          <div className="wizard-step-dot">
            {i + 1 < current ? <Check size={10} /> : <span>{i + 1}</span>}
          </div>
          {i < total - 1 && <div className="wizard-step-line" />}
        </div>
      ))}
    </div>
  );
}

function CreateWizard({
  onClose,
  projects,
  clients,
}: {
  onClose: () => void;
  projects: ProjectOption[];
  clients: ClientOption[];
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState(() => generatePassword());
  const [showPass, setShowPass] = useState(false);
  const [created, setCreated] = useState<ReviewListItem | null>(null);
  const [copied, setCopied] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 1) setTimeout(() => titleRef.current?.focus(), 80);
  }, [step]);

  useEffect(() => {
    if (!projectId) return;
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    const match = clients.find(c => c.name === proj.client.name);
    if (match) setClientId(match.id);
  }, [projectId, projects, clients]);

  const uploadImages = async (reviewId: string, uploadFiles: File[]) => {
    const form = new FormData();
    uploadFiles.forEach(f => form.append('files', f));
    await fetch(`${API_BASE}/reviews/${reviewId}/images`, {
      method: 'POST',
      headers: api.authHeaders(),
      body: form,
    });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<ReviewListItem>('/reviews', {
        title: title.trim(),
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        password: password.trim() || undefined,
      }),
    onSuccess: async result => {
      if (files.length) await uploadImages(result.id, files);
      const plainPwd = result.clientPassword ?? password.trim();
      if (plainPwd) {
        try { localStorage.setItem(`review_pwd_${result.id}`, plainPwd); } catch { /* storage unavailable */ }
      }
      setCreated(result);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ['render-reviews'] });
    },
  });

  const copyLink = () => {
    if (!created) return;
    navigator.clipboard.writeText(
      `${publicLinkFor(created.token)}\nPassword: ${created.clientPassword ?? password}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canStep1 = title.trim().length >= 2;

  return (
    <div className="wizard-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="wizard-modal">
        <button className="wizard-close" type="button" onClick={onClose}>
          <X size={16} />
        </button>

        {step < 4 && (
          <div className="wizard-header">
            <WizardSteps current={step} />
            <h2 className="wizard-title">
              {step === 1 && 'New review link'}
              {step === 2 && 'Add images'}
              {step === 3 && 'Client access'}
            </h2>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body">
            <div className="wizard-field">
              <label className="wizard-label">Review title</label>
              <input
                ref={titleRef}
                className="input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="470 Collins Street — Final Renders"
                onKeyDown={e => e.key === 'Enter' && canStep1 && setStep(2)}
              />
            </div>
            <div className="wizard-field">
              <label className="wizard-label">
                Project <span className="wizard-label-opt">optional</span>
              </label>
              <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.invoiceNumber ? ` (${p.invoiceNumber})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="wizard-field">
              <label className="wizard-label">
                Client <span className="wizard-label-opt">optional</span>
              </label>
              <select className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">No client</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="wizard-actions">
              <button
                className="primary-btn"
                type="button"
                disabled={!canStep1}
                onClick={() => setStep(2)}
              >
                Continue <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body">
            <ImageDropZone
              files={files}
              onAdd={f => setFiles(prev => accumulateFiles(prev, f))}
              onRemove={i => setFiles(prev => prev.filter((_, j) => j !== i))}
            />
            <div className="wizard-actions wizard-actions-split">
              <button className="ghost-btn" type="button" onClick={() => setStep(3)}>
                Skip for now
              </button>
              <button className="primary-btn" type="button" onClick={() => setStep(3)}>
                {files.length > 0
                  ? `Continue with ${files.length} image${files.length !== 1 ? 's' : ''}`
                  : 'Continue'}{' '}
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-body">
            <div className="wizard-field">
              <label className="wizard-label">Access password</label>
              <div className="wizard-password-row">
                <div className="wizard-pass-input-wrap">
                  <input
                    className="input"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="client-password"
                  />
                  <button
                    type="button"
                    className="wizard-pass-eye"
                    onClick={() => setShowPass(v => !v)}
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <button
                  type="button"
                  className="ghost-btn wizard-regen-btn"
                  onClick={() => setPassword(generatePassword())}
                  title="Generate new password"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <p className="wizard-hint">Clients will need this to access the review link.</p>
            </div>
            <div className="wizard-actions">
              <button
                className="primary-btn"
                type="button"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Creating…' : 'Create review'}
              </button>
            </div>
          </div>
        )}

        {step === 4 && created && (
          <div className="wizard-success">
            <div className="wizard-success-icon">
              <Check size={22} />
            </div>
            <h2 className="wizard-success-title">Review created</h2>
            <p className="wizard-success-sub">{created.title}</p>
            <div className="wizard-link-box">
              <div className="wizard-link-row">
                <Link2 size={13} className="wizard-link-icon" />
                <span className="wizard-link-url">{publicLinkFor(created.token)}</span>
              </div>
              <div className="wizard-link-row wizard-link-pass-row">
                <span className="wizard-link-label">Password</span>
                <span className="wizard-link-pass">{created.clientPassword ?? password}</span>
              </div>
              <button type="button" className="wizard-copy-btn" onClick={copyLink}>
                {copied ? (
                  <>
                    <Check size={13} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} /> Copy for client
                  </>
                )}
              </button>
            </div>
            <button
              type="button"
              className="ghost-btn"
              style={{ marginTop: '16px', width: '100%' }}
              onClick={onClose}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const labels: Record<ReviewStatus, string> = { DRAFT: 'Draft', SHARED: 'Shared', CLOSED: 'Closed' };
  return (
    <span className={`review-status-badge review-status-${status.toLowerCase()}`}>
      {labels[status]}
    </span>
  );
}

function ReviewCard({
  review,
  selected,
  onClick,
}: {
  review: ReviewListItem;
  selected: boolean;
  onClick: () => void;
}) {
  const copyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(publicLinkFor(review.token));
  };

  return (
    <div className={`review-card${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className={`review-card-accent review-accent-${review.status.toLowerCase()}`} />
      <div className="review-card-body">
        <div className="review-card-top">
          <h4 className="review-card-title">{review.title}</h4>
          <StatusBadge status={review.status} />
        </div>
        {(review.project || review.client) && (
          <p className="review-card-project">
            {review.project?.title ?? review.client?.name}
          </p>
        )}
        <div className="review-card-stats">
          <span className="review-card-stat">
            <Image size={12} />
            {review._count.images}
          </span>
          <span className="review-card-stat">{review._count.annotations} comments</span>
          <span className="review-card-stat">{review._count.guests} guests</span>
          <button type="button" className="review-card-copy" onClick={copyLink} title="Copy link">
            <Copy size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

type PanelTab = 'overview' | 'details' | 'images';

function EditPanel({
  review,
  details,
  onClose,
  onStatusChange,
  onUpload,
  onDeleteImage,
  onDelete,
  projects,
  clients,
}: {
  review: ReviewListItem;
  details: ReviewDetails | undefined;
  onClose: () => void;
  onStatusChange: (s: ReviewStatus) => void;
  onUpload: (files: File[]) => void;
  onDeleteImage: (imageId: string) => void;
  onDelete: () => void;
  projects: ProjectOption[];
  clients: ClientOption[];
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PanelTab>('overview');
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [showPass, setShowPass] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editTitle, setEditTitle] = useState(review.title);
  const [editProjectId, setEditProjectId] = useState(review.project?.id ?? '');
  const [editClientId, setEditClientId] = useState(review.client?.id ?? '');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    setEditTitle(review.title);
    setEditProjectId(review.project?.id ?? '');
    setEditClientId(review.client?.id ?? '');
    setConfirmDelete(false);
    setTab('overview');
  }, [review.id]);

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch(`/reviews/${review.id}`, {
        title: editTitle.trim() || undefined,
        projectId: editProjectId || undefined,
        clientId: editClientId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['render-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['render-review-details', review.id] });
    },
  });

  const copyLink = () => {
    navigator.clipboard.writeText(publicLinkFor(review.token));
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Backend only returns clientPassword once (on POST). Fallback to localStorage cache.
  const password = details?.clientPassword ?? review.clientPassword
    ?? (() => { try { return localStorage.getItem(`review_pwd_${review.id}`) ?? ''; } catch { return ''; } })();

  const copyAll = () => {
    navigator.clipboard.writeText(
      `${publicLinkFor(review.token)}\nPassword: ${password}`,
    );
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const images = details?.images ?? [];

  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'details', label: 'Details' },
    { id: 'images', label: `Images${images.length ? ` · ${images.length}` : ''}` },
  ];

  return (
    <div className="edit-panel">
      {/* Header */}
      <div className="edit-panel-head">
        <div className="edit-panel-meta">
          <StatusBadge status={review.status} />
          <span className="edit-panel-name">{review.title}</span>
        </div>
        <button type="button" className="edit-panel-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="edit-panel-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            className={`edit-panel-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div className="edit-tab-content">
          {/* Status */}
          <div className="ep-block">
            <p className="ep-block-label">Status</p>
            <div className="status-switcher">
              {(['DRAFT', 'SHARED', 'CLOSED'] as ReviewStatus[]).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`status-pill status-pill-${s.toLowerCase()}${review.status === s ? ' active' : ''}`}
                  onClick={() => onStatusChange(s)}
                >
                  {s === 'DRAFT' ? 'Draft' : s === 'SHARED' ? 'Shared' : 'Closed'}
                </button>
              ))}
            </div>
          </div>

          {/* Client access */}
          <div className="ep-block">
            <p className="ep-block-label">Client access</p>
            <div className="access-link-box">
              <div className="access-link-row">
                <Link2 size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                <span className="access-link-value">{publicLinkFor(review.token)}</span>
                <button type="button" className="access-copy-btn" onClick={copyLink} title="Copy link">
                  {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              <div className="access-link-row access-pass-row">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)', flexShrink: 0 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span
                  className="access-link-value"
                  style={{ filter: showPass ? 'none' : 'blur(5px)', userSelect: showPass ? 'text' : 'none', transition: 'filter 0.2s' }}
                >
                  {password || '—'}
                </span>
                <button
                  type="button"
                  className="access-copy-btn"
                  onClick={() => setShowPass(v => !v)}
                  title={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            <button type="button" className="ep-copy-all-btn" onClick={copyAll}>
              {copiedAll ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy link + password for client</>}
            </button>
          </div>

          {/* Stats */}
          <div className="ep-block">
            <p className="ep-block-label">Activity</p>
            <div className="edit-stats-row">
              <div className="edit-stat">
                <span className="edit-stat-val">{review._count.images}</span>
                <span className="edit-stat-label">Images</span>
              </div>
              <div className="edit-stat">
                <span className="edit-stat-val">{review._count.annotations}</span>
                <span className="edit-stat-label">Comments</span>
              </div>
              <div className="edit-stat">
                <span className="edit-stat-val">{review._count.guests}</span>
                <span className="edit-stat-label">Guests</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Details */}
      {tab === 'details' && (
        <div className="edit-tab-content">
          <div className="ep-block ep-block-form">
            <div className="edit-field">
              <label className="wizard-label">Title</label>
              <input
                className="input"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
              />
            </div>
            <div className="edit-field">
              <label className="wizard-label">Project</label>
              <select
                className="input"
                value={editProjectId}
                onChange={e => setEditProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="edit-field">
              <label className="wizard-label">Client</label>
              <select
                className="input"
                value={editClientId}
                onChange={e => setEditClientId(e.target.value)}
              >
                <option value="">No client</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="primary-btn"
              style={{ width: '100%' }}
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>

          <div className="ep-block ep-block-danger">
            {confirmDelete ? (
              <div className="danger-confirm">
                <p className="danger-confirm-text">
                  Delete this review and all its images? This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="danger-btn" style={{ flex: 1 }} onClick={onDelete}>
                    Delete
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ flex: 1 }}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="danger-btn-outline"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} /> Delete review
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab: Images */}
      {tab === 'images' && (
        <div className="edit-tab-content edit-tab-images">
          <ImageDropZone
            files={addFiles}
            onAdd={f => setAddFiles(prev => accumulateFiles(prev, f))}
            onRemove={i => setAddFiles(prev => prev.filter((_, j) => j !== i))}
            existingImages={images}
            onDeleteExisting={onDeleteImage}
          />
          {addFiles.length > 0 && (
            <button
              type="button"
              className="primary-btn"
              style={{ width: '100%', marginTop: '12px', flexShrink: 0 }}
              onClick={() => { onUpload(addFiles); setAddFiles([]); }}
            >
              <Upload size={14} /> Upload {addFiles.length} image{addFiles.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | ReviewStatus>('ALL');
  const [search, setSearch] = useState('');

  // Measure content area so overlays are clipped exactly to it
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

  const reviewsQuery = useQuery({
    queryKey: ['render-reviews'],
    queryFn: () => api.get<ReviewListItem[]>('/reviews'),
  });
  const projectsQuery = useQuery({
    queryKey: ['review-project-options'],
    queryFn: () => api.get<ProjectOption[]>('/projects'),
  });
  const clientsQuery = useQuery({
    queryKey: ['review-client-options'],
    queryFn: () => api.get<ClientOption[]>('/clients'),
  });
  const detailsQuery = useQuery({
    queryKey: ['render-review-details', selectedId],
    queryFn: () => api.get<ReviewDetails>(`/reviews/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const reviews = reviewsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const clients = clientsQuery.data ?? [];

  const filtered = useMemo(() => {
    let list = reviews;
    if (filter !== 'ALL') list = list.filter(r => r.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        r =>
          r.title.toLowerCase().includes(q) ||
          r.project?.title.toLowerCase().includes(q) ||
          r.client?.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [reviews, filter, search]);

  const counts = useMemo(
    () => ({
      ALL: reviews.length,
      DRAFT: reviews.filter(r => r.status === 'DRAFT').length,
      SHARED: reviews.filter(r => r.status === 'SHARED').length,
      CLOSED: reviews.filter(r => r.status === 'CLOSED').length,
    }),
    [reviews],
  );

  const selectedReview = useMemo(
    () => (selectedId ? reviews.find(r => r.id === selectedId) ?? null : null),
    [reviews, selectedId],
  );

  const uploadImages = async (reviewId: string, files: File[]) => {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    await fetch(`${API_BASE}/reviews/${reviewId}/images`, {
      method: 'POST',
      headers: api.authHeaders(),
      body: form,
    });
    queryClient.invalidateQueries({ queryKey: ['render-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['render-review-details', reviewId] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReviewStatus }) =>
      api.patch(`/reviews/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['render-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['render-review-details', selectedId] });
    },
  });

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: string) => api.delete(`/reviews/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['render-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['render-review-details', selectedId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/reviews/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['render-reviews'] });
      const prev = queryClient.getQueryData<ReviewListItem[]>(['render-reviews']);
      queryClient.setQueryData<ReviewListItem[]>(['render-reviews'], old =>
        old ? old.filter(r => r.id !== id) : []
      );
      setSelectedId(null);
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(['render-reviews'], context.prev);
    },
    onSettled: (_data, _err, id) => {
      try { localStorage.removeItem(`review_pwd_${id}`); } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ['render-reviews'] });
    },
  });

  return (
    <div className="reviews-page">
      <div className="reviews-header">
        <div>
          <h2>Render Reviews</h2>
          <p className="muted small">Share protected render galleries with clients for feedback.</p>
        </div>
        <button type="button" className="primary-btn" onClick={() => setShowWizard(true)}>
          + New review
        </button>
      </div>

      <div className="reviews-filter-bar">
        <div className="reviews-tabs">
          {(['ALL', 'SHARED', 'DRAFT', 'CLOSED'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              className={`reviews-tab${filter === tab ? ' active' : ''}`}
              onClick={() => setFilter(tab)}
            >
              {tab === 'ALL' ? 'All' : tab === 'SHARED' ? 'Shared' : tab === 'DRAFT' ? 'Draft' : 'Closed'}
              <span className="reviews-tab-count">{counts[tab]}</span>
            </button>
          ))}
        </div>
        <input
          className="input reviews-search"
          placeholder="Search reviews…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {reviewsQuery.isLoading ? (
        <p className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>
          Loading…
        </p>
      ) : filtered.length === 0 ? (
        <div className="reviews-empty">
          <p className="muted">No reviews found.</p>
          {filter === 'ALL' && !search && (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginTop: '12px' }}
              onClick={() => setShowWizard(true)}
            >
              Create first review
            </button>
          )}
        </div>
      ) : (
        <div className="reviews-grid">
          {filtered.map(review => (
            <ReviewCard
              key={review.id}
              review={review}
              selected={review.id === selectedId}
              onClick={() => setSelectedId(prev => (prev === review.id ? null : review.id))}
            />
          ))}
        </div>
      )}

      {selectedId && selectedReview && createPortal(
        <>
          <div
            className="edit-panel-backdrop"
            style={{ left: contentLeft }}
            onClick={() => setSelectedId(null)}
          />
          <EditPanel
            review={selectedReview}
            details={detailsQuery.data}
            onClose={() => setSelectedId(null)}
            onStatusChange={status => statusMutation.mutate({ id: selectedId, status })}
            onUpload={files => uploadImages(selectedId, files)}
            onDeleteImage={imageId => deleteImageMutation.mutate(imageId)}
            onDelete={() => deleteMutation.mutate(selectedId)}
            projects={projects}
            clients={clients}
          />
        </>,
        document.body,
      )}

      {showWizard && createPortal(
        <CreateWizard
          onClose={() => setShowWizard(false)}
          projects={projects}
          clients={clients}
        />,
        document.body,
      )}
    </div>
  );
}
