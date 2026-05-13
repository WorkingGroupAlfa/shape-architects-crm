import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Download, Eraser, Eye, EyeOff, Hand, Lock, MapPin, MessageSquare, Minus, MoreHorizontal, Pencil,
  Play, Plus, Printer, Square, X
} from 'lucide-react';
import { api } from '../lib/api';

type Tool = 'pan' | 'note' | 'pencil' | 'eraser';
type ReviewStatus = 'DRAFT' | 'SHARED' | 'CLOSED';
type AnnotationType = 'note' | 'pencil' | 'arrow';
type SidebarTab = 'comments' | 'approved' | 'deleted';

type ReviewImage = {
  id: string;
  originalName: string;
  storedName: string;
  sortOrder: number;
};

type ReviewGuest = { id: string; name: string };

type ReviewAnnotation = {
  id: string;
  imageId: string;
  guestId?: string | null;
  guest?: ReviewGuest | null;
  parentId?: string | null;
  type: AnnotationType;
  number?: number | null;
  text?: string | null;
  geometry: {
    x?: number;
    y?: number;
    points?: Array<{ x: number; y: number }>;
    start?: { x: number; y: number };
    end?: { x: number; y: number };
  };
  color: string;
  strokeWidth: number;
  resolved: boolean;
  deletedAt?: string | null;
  deletedByGuestId?: string | null;
  createdAt: string;
  replies?: ReviewAnnotation[];
};

type CanvasImage = {
  id: string;
  imageId: string;
  guestId?: string | null;
  guest?: ReviewGuest | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  x: number;
  y: number;
  width: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReviewPayload = {
  id: string;
  title: string;
  token: string;
  status: ReviewStatus;
  images: ReviewImage[];
  guests: ReviewGuest[];
  annotations: ReviewAnnotation[];
  canvasImages: CanvasImage[];
};

const LOGO_URL = '/shape-logo.webp';
const API_BASE = api.baseUrl;
const storageBase = API_BASE.replace(/\/api$/, '');
const COLORS = ['#FF3B30', '#111111', '#ffffff', '#FF6B35', '#FF9500'];

// Guest initial color by index
const GUEST_PALETTE = ['#C8956A', '#9DBE8E', '#7AA1C9', '#D67878', '#E8DAB2'];

function guestColor(idx: number) {
  return GUEST_PALETTE[idx % GUEST_PALETTE.length];
}

function pointFromEvent(event: PointerEvent<SVGSVGElement>) {
  const target = event.currentTarget;
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: Number(((event.clientX - rect.left) / rect.width).toFixed(5)),
    y: Number(((event.clientY - rect.top) / rect.height).toFixed(5)),
  };
}

function toSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x * 100} ${points[0].y * 100}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = ((points[i].x + points[i + 1].x) / 2) * 100;
    const my = ((points[i].y + points[i + 1].y) / 2) * 100;
    d += ` Q ${points[i].x * 100} ${points[i].y * 100} ${mx} ${my}`;
  }
  d += ` L ${points[points.length - 1].x * 100} ${points[points.length - 1].y * 100}`;
  return d;
}

function withOpacity(hex: string, opacity: number) {
  if (!hex.startsWith('#') || hex.length !== 7 || opacity >= 100) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number((opacity / 100).toFixed(2))})`;
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ---- Teardrop pin marker ----------------------------------------
function PinMarker({
  n, color, active, resolved, left, top, zoom, onClick, onMouseEnter, onMouseLeave,
}: {
  n: number; color: string; active: boolean; resolved: boolean;
  left: number; top: number; zoom: number;
  onClick: () => void; onMouseEnter: () => void; onMouseLeave: () => void;
}) {
  const pinScale = Math.min(1 / zoom, 6);
  return (
    <button
      className={`wz-pin${active ? ' wz-pin-active' : ''}${resolved ? ' wz-pin-resolved' : ''}`}
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, '--pin-color': color, '--pin-scale': pinScale } as React.CSSProperties}
      type="button"
      onClick={e => { e.stopPropagation(); onClick(); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <svg viewBox="0 0 32 40" width="26" height="32">
        <path
          d="M16 1c8 0 14 5.6 14 13.3 0 9.5-12.5 23.7-13.3 24.6a1 1 0 0 1-1.4 0C14.5 38 2 23.8 2 14.3 2 6.6 8 1 16 1z"
          fill="var(--pin-color)"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="1"
        />
      </svg>
      <span className="wz-pin-num">{n}</span>
    </button>
  );
}

// ---- Comment card -----------------------------------------------
function CommentCard({
  annotation, isActive, isHovered, isOwn, menuOpen,
  onOpenMenu, onCloseMenu, onClick, onHover, onResolve, onDelete, deleteDisabled,
  onReply, replyPending,
}: {
  annotation: ReviewAnnotation;
  isActive: boolean; isHovered: boolean; isOwn: boolean; menuOpen: boolean;
  onOpenMenu: () => void; onCloseMenu: () => void;
  onClick: () => void; onHover: (id: string) => void;
  onResolve: () => void; onDelete: () => void; deleteDisabled: boolean;
  onReply: (text: string) => void; replyPending: boolean;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const submitReply = () => {
    if (!replyText.trim() || replyPending) return;
    onReply(replyText.trim());
    setReplyText('');
    setReplyOpen(false);
  };

  return (
    <div
      className={[
        'wz-c',
        isActive ? 'wz-c-active' : '',
        isHovered ? 'wz-c-hover' : '',
        annotation.resolved ? 'wz-c-resolved' : '',
        annotation.deletedAt ? 'wz-c-deleted' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      onMouseEnter={() => onHover(annotation.id)}
      onMouseLeave={() => onHover('')}
    >
      <div className="wz-c-head">
        <span
          className="wz-c-num"
          style={{ background: annotation.type === 'note' ? annotation.color : '#3a3a3a' }}
        >
          {annotation.type === 'note' ? annotation.number : annotation.type === 'pencil' ? '✏' : '→'}
        </span>
        <span className="wz-c-author">{(annotation.guest?.name ?? 'Unknown').toUpperCase()}</span>
        {annotation.resolved && <span className="wz-c-tag">Resolved</span>}
        {annotation.deletedAt && <span className="wz-c-tag wz-c-tag-deleted">Deleted</span>}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            className="wz-c-more"
            type="button"
            onClick={e => { e.stopPropagation(); onOpenMenu(); }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="wz-c-menu" onClick={e => e.stopPropagation()}>
              {!annotation.deletedAt && (
                <button type="button" onClick={() => { onResolve(); onCloseMenu(); }}>
                  <Check size={12} /> {annotation.resolved ? 'Reopen' : 'Mark resolved'}
                </button>
              )}
              {!annotation.deletedAt && (
                <button
                  className="wz-c-menu-danger"
                  type="button"
                  disabled={deleteDisabled}
                  onClick={() => { onDelete(); onCloseMenu(); }}
                >
                  <X size={12} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="wz-c-text">
        {annotation.text || (annotation.type === 'note' ? 'No text' : 'Drawing mark')}
      </div>
      <div className="wz-c-meta">
        {annotation.deletedAt
          ? `Deleted ${dayjs(annotation.deletedAt).format('DD.MM.YYYY, HH:mm:ss')}`
          : dayjs(annotation.createdAt).format('DD.MM.YYYY, HH:mm:ss')}
      </div>

      {/* Replies thread */}
      {(annotation.replies ?? []).length > 0 && (
        <div className="wz-replies">
          {(annotation.replies ?? []).map(r => (
            <div key={r.id} className="wz-reply">
              <span className="wz-reply-author">{(r.guest?.name ?? 'Unknown').toUpperCase()}</span>
              <span className="wz-reply-text">{r.text}</span>
              <span className="wz-reply-time">{dayjs(r.createdAt).format('DD.MM, HH:mm')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reply form */}
      {replyOpen ? (
        <div className="wz-reply-form" onClick={e => e.stopPropagation()}>
          <textarea
            className="wz-reply-input"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Reply…"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(); }
              if (e.key === 'Escape') { setReplyOpen(false); setReplyText(''); }
            }}
          />
          <div className="wz-reply-actions">
            <button type="button" onClick={e => { e.stopPropagation(); setReplyOpen(false); setReplyText(''); }}>
              Cancel
            </button>
            <button type="button" className="wz-btn-send"
              disabled={!replyText.trim() || replyPending}
              onClick={e => { e.stopPropagation(); submitReply(); }}>
              {replyPending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        <div className="wz-c-actions">
          <button type="button" onClick={e => { e.stopPropagation(); onResolve(); }}>
            <Check size={11} /> {annotation.resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button type="button" onClick={e => { e.stopPropagation(); setReplyOpen(true); }}>
            <MessageSquare size={11} /> Reply
          </button>
          {isOwn && (
            <button type="button" disabled={deleteDisabled}
              onClick={e => { e.stopPropagation(); onDelete(); }}>
              <X size={11} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Collaborators modal ----------------------------------------
function CollabModal({ guests, onClose }: { guests: ReviewGuest[]; onClose: () => void }) {
  return (
    <div className="wz-modal-backdrop" onClick={onClose}>
      <div className="wz-modal wz-modal-wide" onClick={e => e.stopPropagation()}>
        <button className="wz-modal-close" type="button" onClick={onClose}><X size={14} /></button>
        <div className="wz-modal-title" style={{ textAlign: 'left', fontSize: '16px' }}>Collaborators</div>
        <div className="wz-modal-sub" style={{ textAlign: 'left' }}>
          People currently in this review session
        </div>
        <div className="wz-collab-list">
          {guests.length === 0 ? (
            <div className="wz-empty-sub" style={{ padding: '20px 0' }}>No other guests yet.</div>
          ) : (
            guests.map((g, i) => (
              <div key={g.id} className="wz-collab-row">
                <span className="wz-user-dot" style={{ background: guestColor(i) }}>
                  {g.name[0]?.toUpperCase()}
                </span>
                <div className="wz-collab-name">{g.name}</div>
                <span className="wz-collab-status">Active</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Share modal ------------------------------------------------
function ShareModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = window.location.href;
  const copy = () => {
    copyToClipboard(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="wz-modal-backdrop" onClick={onClose}>
      <div className="wz-modal wz-modal-wide" onClick={e => e.stopPropagation()}>
        <button className="wz-modal-close" type="button" onClick={onClose}><X size={14} /></button>
        <div className="wz-modal-title" style={{ textAlign: 'left', fontSize: '16px' }}>Share review</div>
        <div className="wz-modal-sub" style={{ textAlign: 'left' }}>
          Anyone with the link and password can join this review.
        </div>
        <div className="wz-share-link">
          <input value={link} readOnly />
          <button className="wz-btn-primary" type="button" onClick={copy} style={{ width: 'auto', padding: '0 18px' }}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <div className="wz-modal-foot" style={{ marginTop: '12px' }}>
          <Lock size={11} /> Password-protected · Share this link with your client
        </div>
      </div>
    </div>
  );
}

// ================================================================
// Main page
// ================================================================
export function PublicReviewPage() {
  const token = window.location.pathname.split('/review/')[1]?.split('/')[0] ?? '';

  // Auth
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [guest, setGuest] = useState<ReviewGuest | null>(null);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('comments');

  // Image / annotation navigation
  const [activeImageId, setActiveImageId] = useState('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState('');
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState('');
  const [openMenuId, setOpenMenuId] = useState('');

  // Tools
  const [tool, setTool] = useState<Tool>('pan');
  const [color, setColor] = useState('#FF3B30');
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [colorPopOpen, setColorPopOpen] = useState(false);
  const strokeOpacity = 100;

  // Drawing drafts
  const [draftPoints, setDraftPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [pendingNote, setPendingNote] = useState<{ imageId: string; geometry: { x: number; y: number } } | null>(null);
  const [noteText, setNoteText] = useState('');

  // UI state
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [stripOpen, setStripOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'canvas' | 'comments'>('canvas');
  const [viewMode, setViewMode] = useState<1 | 2 | 4>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCollab, setShowCollab] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);
  const [resizingCanvasImageId, setResizingCanvasImageId] = useState('');

  // Zoom / pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [zoomAnimating, setZoomAnimating] = useState(false);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPollRef = useRef(new Date());
  const canvasRef = useRef<HTMLDivElement>(null);
  const activeImageRef = useRef<HTMLImageElement>(null);

  // Compare mode — layout / zoom
  const [compareMode, setCompareMode] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareImageId, setCompareImageId] = useState('');
  const [compareZoom, setCompareZoom] = useState(1);
  const [comparePan, setComparePan] = useState({ x: 0, y: 0 });
  const [compareDragStart, setCompareDragStart] = useState<{ x: number; y: number } | null>(null);
  const [compareZoomAnimating, setCompareZoomAnimating] = useState(false);
  const compareZoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compareCanvasRef = useRef<HTMLDivElement>(null);
  const compareImageRef = useRef<HTMLImageElement>(null);
  // Annotation visibility toggles
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [compareAnnotationsVisible, setCompareAnnotationsVisible] = useState(true);

  // Compare mode — interaction
  const [compareTool, setCompareTool] = useState<Tool>('pan');
  const [compareSidebarOpen, setCompareSidebarOpen] = useState(true);
  const [compareSidebarTab, setCompareSidebarTab] = useState<SidebarTab>('comments');
  const [compareSelectedId, setCompareSelectedId] = useState('');
  const [compareHoveredId, setCompareHoveredId] = useState('');
  const [compareOpenMenuId, setCompareOpenMenuId] = useState('');
  const [compareFilter, setCompareFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [compareDraftPoints, setCompareDraftPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [comparePendingNote, setComparePendingNote] = useState<{ imageId: string; geometry: { x: number; y: number } } | null>(null);
  const [compareNoteText, setCompareNoteText] = useState('');

  // Non-passive wheel listener for zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = -e.deltaY * 0.002;
      setZoom(prevZ => {
        const newZ = Math.min(4, Math.max(0.1, prevZ + delta));
        const ratio = newZ / prevZ;
        setPan(prevPan => ({
          x: mouseX - (mouseX - prevPan.x) * ratio,
          y: mouseY - (mouseY - prevPan.y) * ratio,
        }));
        return newZ;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!review]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!review) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const idx = review.images.findIndex(i => i.id === activeImageId);
        const next = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
        if (next >= 0 && next < review.images.length) {
          setActiveImageId(review.images[next].id);
          setZoom(1); setPan({ x: 0, y: 0 });
        }
      }
      if (e.key === 'p') setTool('note');
      if (e.key === 'h') setTool('pan');
      if (e.key === 'd') setTool('pencil');
      if (e.key === 'e') setTool('eraser');
      if (e.key === 'Escape') { setSelectedAnnotationId(''); setOpenMenuId(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, activeImageId]);

  // Slideshow
  useEffect(() => {
    if (!isPlaying || !review) return;
    const t = setTimeout(() => {
      const idx = review.images.findIndex(i => i.id === activeImageId);
      const next = idx + 1;
      if (next >= review.images.length) { setIsPlaying(false); return; }
      setActiveImageId(review.images[next].id);
      setZoom(1); setPan({ x: 0, y: 0 });
    }, 2800);
    return () => clearTimeout(t);
  }, [isPlaying, activeImageId, review]);

  // Close menus on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId('');
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [openMenuId]);

  // ---- Mutations --------------------------------------------------
  const SESSION_KEY = `wz_session_${token}`;

  const sessionMutation = useMutation({
    mutationFn: (vars?: { name?: string; password?: string; guestId?: string }) => {
      const n = vars?.name ?? name;
      const p = vars?.password ?? password;
      return fetch(`${API_BASE}/public/reviews/${token}/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: p, name: n, ...(vars?.guestId ? { guestId: vars.guestId } : {}) }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to open review');
        return res.json() as Promise<{ guest: ReviewGuest; review: ReviewPayload }>;
      });
    },
    onSuccess: (payload, vars) => {
      setGuest(payload.guest);
      setReview(payload.review);
      setActiveImageId(payload.review.images[0]?.id ?? '');
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          guestId: payload.guest.id,
          name: payload.guest.name,
          password: vars?.password ?? password,
        }));
      } catch { /* storage unavailable */ }
    },
  });

  // Auto-restore session on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (!saved) return;
        const sess = JSON.parse(saved) as { guestId?: string; name?: string; password?: string };
        if (!sess?.guestId || !sess?.name || !sess?.password) return;
        setName(sess.name);
        setPassword(sess.password);
        await sessionMutation.mutateAsync({ name: sess.name, password: sess.password, guestId: sess.guestId });
      } catch {
        try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createAnnotationMutation = useMutation({
    mutationFn: (payload: {
      imageId: string; type: AnnotationType; text?: string;
      geometry: unknown; color: string; strokeWidth: number;
    }) =>
      fetch(`${API_BASE}/public/reviews/${token}/annotations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, password, guestId: guest?.id }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to save annotation');
        return res.json() as Promise<ReviewAnnotation>;
      }),
    onSuccess: annotation => {
      setReview(prev => prev ? { ...prev, annotations: [...prev.annotations, annotation] } : prev);
      if (compareMode && annotation.imageId === compareImageId) {
        setCompareSelectedId(annotation.id);
        setCompareSidebarOpen(true);
      } else {
        setSelectedAnnotationId(annotation.id);
        if (annotation.type === 'note') {
          setSidebarOpen(true);
          if (window.innerWidth < 760) setMobileTab('comments');
        }
      }
    },
  });

  const updateAnnotationMutation = useMutation({
    mutationFn: ({ id, text, resolved }: { id: string; text?: string; resolved?: boolean }) =>
      fetch(`${API_BASE}/public/reviews/${token}/annotations/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, guestId: guest?.id, text, resolved }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to update annotation');
        return res.json() as Promise<ReviewAnnotation>;
      }),
    onSuccess: annotation =>
      setReview(prev =>
        prev ? { ...prev, annotations: prev.annotations.map(a => a.id === annotation.id ? annotation : a) } : prev
      ),
  });

  const deleteAnnotationMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`${API_BASE}/public/reviews/${token}/annotations/${id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, guestId: guest?.id }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to delete annotation');
        return res.json() as Promise<ReviewAnnotation>;
      }),
    onSuccess: (annotation, id) => {
      setReview(prev =>
        prev ? { ...prev, annotations: prev.annotations.map(a => a.id === annotation.id ? annotation : a) } : prev
      );
      if (selectedAnnotationId === id) setSelectedAnnotationId('');
      if (compareSelectedId === id) setCompareSelectedId('');
    },
  });

  const createReplyMutation = useMutation({
    mutationFn: ({ annotationId, text }: { annotationId: string; text: string }) =>
      fetch(`${API_BASE}/public/reviews/${token}/annotations/${annotationId}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, guestId: guest?.id, text }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to save reply');
        return res.json() as Promise<ReviewAnnotation>;
      }),
    onSuccess: (reply, { annotationId }) => {
      setReview(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          annotations: prev.annotations.map(a =>
            a.id === annotationId ? { ...a, replies: [...(a.replies ?? []), reply] } : a
          ),
        };
      });
    },
  });

  const uploadCanvasImageMutation = useMutation({
    mutationFn: async ({ file, imageId, x, y, width }: { file: File; imageId: string; x: number; y: number; width: number }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);
      formData.append('guestId', guest?.id ?? '');
      formData.append('imageId', imageId);
      formData.append('x', String(x));
      formData.append('y', String(y));
      formData.append('width', String(width));
      const res = await fetch(`${API_BASE}/public/reviews/${token}/canvas-images`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to upload image');
      return res.json() as Promise<CanvasImage>;
    },
    onSuccess: image => {
      setReview(prev => prev ? { ...prev, canvasImages: [...(prev.canvasImages ?? []), image] } : prev);
    },
  });

  const updateCanvasImageMutation = useMutation({
    mutationFn: ({ id, x, y, width }: { id: string; x?: number; y?: number; width?: number }) =>
      fetch(`${API_BASE}/public/reviews/${token}/canvas-images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, guestId: guest?.id, x, y, width }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to update image');
        return res.json() as Promise<CanvasImage>;
      }),
    onSuccess: image => {
      setReview(prev => prev ? {
        ...prev,
        canvasImages: (prev.canvasImages ?? []).map(item => item.id === image.id ? image : item),
      } : prev);
    },
  });

  const deleteCanvasImageMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`${API_BASE}/public/reviews/${token}/canvas-images/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, guestId: guest?.id }),
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Unable to delete image');
        return res.json() as Promise<CanvasImage>;
      }),
    onSuccess: image => {
      setReview(prev => prev ? {
        ...prev,
        canvasImages: (prev.canvasImages ?? []).map(item => item.id === image.id ? image : item),
      } : prev);
    },
  });

  // ---- Derived state ----------------------------------------------
  const activeImage = review?.images.find(i => i.id === activeImageId) ?? review?.images[0] ?? null;
  const activeImageIndex = review?.images.findIndex(i => i.id === activeImageId) ?? 0;
  const totalImages = review?.images.length ?? 0;

  const activeAnnotations = useMemo(
    () => (review?.annotations ?? []).filter(a => a.imageId === activeImage?.id),
    [activeImage?.id, review?.annotations]
  );
  const activeCanvasImages = useMemo(
    () => (review?.canvasImages ?? []).filter(image => image.imageId === activeImage?.id && !image.deletedAt),
    [activeImage?.id, review?.canvasImages]
  );
  const visibleActiveAnnotations = useMemo(
    () => activeAnnotations.filter(a => !a.deletedAt),
    [activeAnnotations]
  );
  const deletedActiveAnnotations = useMemo(
    () => activeAnnotations.filter(a => a.deletedAt),
    [activeAnnotations]
  );

  const filteredAnnotations = useMemo(
    () => visibleActiveAnnotations.filter(a => {
      if (filter === 'open' && a.resolved) return false;
      if (filter === 'resolved' && !a.resolved) return false;
      return true;
    }),
    [visibleActiveAnnotations, filter]
  );

  const openCount = visibleActiveAnnotations.filter(a => !a.resolved).length;
  const approvedAnnotations = useMemo(() => visibleActiveAnnotations.filter(a => a.resolved), [visibleActiveAnnotations]);
  const approvedCount = approvedAnnotations.length;
  const deletedCount = deletedActiveAnnotations.length;
  const displayAnnotations = sidebarTab === 'deleted' ? deletedActiveAnnotations : sidebarTab === 'approved' ? approvedAnnotations : filteredAnnotations;
  const drawingColor = withOpacity(color, strokeOpacity);

  // Compare derived state
  const compareImage = compareMode ? (review?.images.find(i => i.id === compareImageId) ?? null) : null;
  const compareImageIndex = review?.images.findIndex(i => i.id === compareImageId) ?? -1;
  const compareAnnotations = useMemo(
    () => compareMode ? (review?.annotations ?? []).filter(a => a.imageId === compareImageId) : [],
    [compareMode, compareImageId, review?.annotations]
  );
  const visibleCompareAnnotations = useMemo(
    () => compareAnnotations.filter(a => !a.deletedAt),
    [compareAnnotations]
  );
  const deletedCompareAnnotations = useMemo(
    () => compareAnnotations.filter(a => a.deletedAt),
    [compareAnnotations]
  );
  const compareFilteredAnnotations = useMemo(
    () => visibleCompareAnnotations.filter(a => {
      if (compareFilter === 'open' && a.resolved) return false;
      if (compareFilter === 'resolved' && !a.resolved) return false;
      return true;
    }),
    [visibleCompareAnnotations, compareFilter]
  );
  const compareOpenCount = visibleCompareAnnotations.filter(a => !a.resolved).length;
  const compareApprovedAnnotations = useMemo(() => visibleCompareAnnotations.filter(a => a.resolved), [visibleCompareAnnotations]);
  const compareApprovedCount = compareApprovedAnnotations.length;
  const compareDeletedCount = deletedCompareAnnotations.length;
  const compareDisplayAnnotations = compareSidebarTab === 'deleted' ? deletedCompareAnnotations : compareSidebarTab === 'approved' ? compareApprovedAnnotations : compareFilteredAnnotations;

  // ---- Zoom helper (animated for button clicks) -------------------
  function zoomBy(delta: number) {
    setZoomAnimating(true);
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => setZoomAnimating(false), 250);
    const canvas = canvasRef.current;
    const cx = (canvas?.clientWidth ?? 0) / 2;
    const cy = (canvas?.clientHeight ?? 0) / 2;
    setZoom(prevZ => {
      const newZ = Math.min(4, Math.max(0.1, prevZ + delta));
      const ratio = newZ / prevZ;
      setPan(prevPan => ({
        x: cx - (cx - prevPan.x) * ratio,
        y: cy - (cy - prevPan.y) * ratio,
      }));
      return newZ;
    });
  }

  // ---- Fit image to canvas (called on load + image change) --------
  const fitToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = activeImageRef.current;
    if (!canvas || !img || img.naturalWidth === 0) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const raw = Math.min(cw / iw, ch / ih);
    const fitZ = raw >= 1 ? 1 : raw * 0.95;
    setZoom(fitZ);
    setPan({ x: (cw - iw * fitZ) / 2, y: (ch - ih * fitZ) / 2 });
  }, []);

  useEffect(() => {
    const img = activeImageRef.current;
    if (img?.complete && img.naturalWidth > 0) fitToCanvas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageId]);

  // ---- Compare canvas helpers -------------------------------------
  const fitCompareCanvas = useCallback(() => {
    const canvas = compareCanvasRef.current;
    const img = compareImageRef.current;
    if (!canvas || !img || img.naturalWidth === 0) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const raw = Math.min(cw / iw, ch / ih);
    const fitZ = raw >= 1 ? 1 : raw * 0.95;
    setCompareZoom(fitZ);
    setComparePan({ x: (cw - iw * fitZ) / 2, y: (ch - ih * fitZ) / 2 });
  }, []);

  useEffect(() => {
    const img = compareImageRef.current;
    if (img?.complete && img.naturalWidth > 0) fitCompareCanvas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareImageId]);

  useEffect(() => {
    const el = compareCanvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = -e.deltaY * 0.002;
      setCompareZoom(prevZ => {
        const newZ = Math.min(4, Math.max(0.1, prevZ + delta));
        const ratio = newZ / prevZ;
        setComparePan(prevPan => ({
          x: mouseX - (mouseX - prevPan.x) * ratio,
          y: mouseY - (mouseY - prevPan.y) * ratio,
        }));
        return newZ;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  function zoomCompareBy(delta: number) {
    setCompareZoomAnimating(true);
    if (compareZoomTimerRef.current) clearTimeout(compareZoomTimerRef.current);
    compareZoomTimerRef.current = setTimeout(() => setCompareZoomAnimating(false), 250);
    const canvas = compareCanvasRef.current;
    const cx = (canvas?.clientWidth ?? 0) / 2;
    const cy = (canvas?.clientHeight ?? 0) / 2;
    setCompareZoom(prevZ => {
      const newZ = Math.min(4, Math.max(0.1, prevZ + delta));
      const ratio = newZ / prevZ;
      setComparePan(prevPan => ({
        x: cx - (cx - prevPan.x) * ratio,
        y: cy - (cy - prevPan.y) * ratio,
      }));
      return newZ;
    });
  }

  function enterCompare() {
    if (!review) return;
    const nextIdx = (activeImageIndex + 1) % totalImages;
    setCompareImageId(review.images[nextIdx]?.id ?? review.images[0]?.id ?? '');
    setCompareZoom(1);
    setComparePan({ x: 0, y: 0 });
    setCompareMode(true);
    setSidebarOpen(false);
    setCompareSidebarOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setCompareOpen(true)));
    setTimeout(() => {
      fitToCanvas();
      fitCompareCanvas();
    }, 420);
    setTimeout(() => fitCompareCanvas(), 800);
  }

  function exitCompare() {
    setCompareOpen(false);
    setTimeout(() => {
      setCompareMode(false);
      setCompareImageId('');
      setCompareTool('pan');
      setCompareSidebarOpen(true);
      setCompareSelectedId('');
      setCompareHoveredId('');
      setCompareOpenMenuId('');
      setCompareDraftPoints([]);
      setComparePendingNote(null);
      setCompareAnnotationsVisible(true);
      setTimeout(() => fitToCanvas(), 50);
    }, 400);
  }

  // ---- Live polling for real-time updates -------------------------
  useEffect(() => {
    if (!review || !guest) return;
    lastPollRef.current = new Date();
    const poll = async () => {
      try {
        const pollTime = new Date();
        const params = new URLSearchParams({
          password,
          guestId: guest.id,
          since: lastPollRef.current.toISOString(),
        });
        const res = await fetch(`${API_BASE}/public/reviews/${token}/poll?${params}`);
        if (!res.ok) return;
        const data: { annotations: ReviewAnnotation[]; replies: ReviewAnnotation[]; canvasImages?: CanvasImage[] } = await res.json();
        lastPollRef.current = pollTime;
        if (!data.annotations.length && !data.replies.length && !(data.canvasImages ?? []).length) return;
        setReview(prev => {
          if (!prev) return prev;
          let annotations = [...prev.annotations];
          let canvasImages = [...(prev.canvasImages ?? [])];
          for (const a of data.annotations) {
            const idx = annotations.findIndex(x => x.id === a.id);
            if (idx >= 0) { annotations = [...annotations.slice(0, idx), a, ...annotations.slice(idx + 1)]; }
            else { annotations = [...annotations, a]; }
          }
          for (const r of data.replies) {
            const pi = annotations.findIndex(x => x.id === r.parentId);
            if (pi >= 0) {
              const parent = annotations[pi];
              if (!(parent.replies ?? []).some(x => x.id === r.id)) {
                annotations = [
                  ...annotations.slice(0, pi),
                  { ...parent, replies: [...(parent.replies ?? []), r] },
                  ...annotations.slice(pi + 1),
                ];
              }
            }
          }
          for (const image of data.canvasImages ?? []) {
            const idx = canvasImages.findIndex(x => x.id === image.id);
            if (idx >= 0) { canvasImages = [...canvasImages.slice(0, idx), image, ...canvasImages.slice(idx + 1)]; }
            else { canvasImages = [...canvasImages, image]; }
          }
          return { ...prev, annotations, canvasImages };
        });
      } catch { /* network errors are silent */ }
    };
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.id, guest?.id]);

  // ---- Helpers ----------------------------------------------------
  const navigateImage = useCallback((delta: number) => {
    if (!review) return;
    const idx = review.images.findIndex(i => i.id === activeImageId);
    const next = idx + delta;
    if (next >= 0 && next < review.images.length) {
      setActiveImageId(review.images[next].id);
      setZoom(1); setPan({ x: 0, y: 0 });
    }
  }, [review, activeImageId]);

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (tool === 'pan' || e.button === 1 || e.altKey) {
      e.preventDefault();
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }
  function handleCanvasMouseMove(e: React.MouseEvent) {
    if (!dragStart) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }
  function handleCanvasMouseUp() { setDragStart(null); }

  const hasImageFiles = (files: FileList | null | undefined, items?: DataTransferItemList | null) =>
    Boolean(
      (files && Array.from(files).some(file => file.type.startsWith('image/'))) ||
      (items && Array.from(items).some(item => item.kind === 'file' && item.type.startsWith('image/')))
    );

  function addCanvasImagesFromDrop(files: FileList, clientX: number, clientY: number) {
    if (!activeImage || !activeImageRef.current) return;
    const imageRect = activeImageRef.current.getBoundingClientRect();
    if (!imageRect.width || !imageRect.height) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    imageFiles.forEach((file, index) => {
      const width = Math.min(0.22, Math.max(0.08, 96 / imageRect.width));
      uploadCanvasImageMutation.mutate({
        file,
        imageId: activeImage.id,
        x: Number(((clientX - imageRect.left) / imageRect.width + index * (width + 0.02)).toFixed(5)),
        y: Number(((clientY - imageRect.top) / imageRect.height).toFixed(5)),
        width,
      });
    });
  }

  function updateCanvasImageWidth(id: string, width: number) {
    setReview(prev => prev ? {
      ...prev,
      canvasImages: (prev.canvasImages ?? []).map(image => image.id === id ? { ...image, width } : image),
    } : prev);
  }

  function addNote(imageId: string, event: PointerEvent<SVGSVGElement>) {
    const point = pointFromEvent(event);
    if (!point) return;
    setPendingNote({ imageId, geometry: point });
    setNoteText('');
  }

  function submitNote() {
    if (!pendingNote || !noteText.trim()) return;
    createAnnotationMutation.mutate({
      imageId: pendingNote.imageId, type: 'note',
      text: noteText.trim(), geometry: pendingNote.geometry,
      color: drawingColor, strokeWidth,
    });
    setPendingNote(null); setNoteText('');
  }

  function addCompareNote(imageId: string, event: PointerEvent<SVGSVGElement>) {
    const point = pointFromEvent(event);
    if (!point) return;
    setComparePendingNote({ imageId, geometry: point });
    setCompareNoteText('');
  }

  function submitCompareNote() {
    if (!comparePendingNote || !compareNoteText.trim()) return;
    createAnnotationMutation.mutate({
      imageId: comparePendingNote.imageId, type: 'note',
      text: compareNoteText.trim(), geometry: comparePendingNote.geometry,
      color: drawingColor, strokeWidth,
    });
    setComparePendingNote(null); setCompareNoteText('');
  }

  function jumpToAnnotation(annotation: ReviewAnnotation) {
    if (annotation.imageId !== activeImageId) {
      setActiveImageId(annotation.imageId); setZoom(1); setPan({ x: 0, y: 0 });
    }
    setSelectedAnnotationId(annotation.id);
  }

  function downloadImage() {
    if (!activeImage) return;
    const url = `${storageBase}/storage/uploads/${activeImage.storedName}`;
    const a = document.createElement('a');
    a.href = url; a.download = activeImage.originalName;
    a.click();
  }

  function printImage() {
    if (!activeImage) return;
    const url = `${storageBase}/storage/uploads/${activeImage.storedName}`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><body style="margin:0"><img src="${url}" style="max-width:100%;display:block" onload="window.print();window.close()"></body></html>`);
    w.document.close();
  }

  const cursorStyle = dragStart ? 'grabbing' : tool === 'pan' ? 'grab' : 'crosshair';
  const emptyTitleForTab = (tab: SidebarTab) =>
    tab === 'deleted' ? 'No deleted comments' : tab === 'approved' ? 'No approved comments' : 'No comments yet';
  const emptySubForTab = (tab: SidebarTab, isFiltered: boolean) =>
    tab === 'deleted'
      ? 'Erased comments and drawings will appear here.'
      : tab === 'approved'
      ? 'Resolved comments will appear here.'
      : isFiltered
      ? 'No comments match this filter.'
      : 'Click anywhere on the render to drop your first pin.';

  // ================================================================
  // LOGIN PAGE
  // ================================================================
  if (!review || !guest) {
    return (
      <div className="wz-modal-backdrop wz-login-page">
        <form className="wz-modal" onSubmit={e => { e.preventDefault(); sessionMutation.mutate({ name, password }); }}>
          <div className="wz-modal-logo">
            <img src={LOGO_URL} alt="Shape Architects" />
          </div>
          <div className="wz-modal-title">Render Review Access</div>
          <div className="wz-modal-sub">Enter your details to continue</div>
          <label className="wz-field">
            <span>Your Name</span>
            <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="So others see who commented" />
          </label>
          <label className="wz-field">
            <span>Access Password</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Provided by Shape Architects" />
          </label>
          {sessionMutation.error ? (
            <div className="wz-modal-err">{sessionMutation.error.message}</div>
          ) : null}
          <button className="wz-btn-primary" type="submit"
            disabled={!password || !name || sessionMutation.isPending}>
            {sessionMutation.isPending ? 'Opening…' : 'Enter review →'}
          </button>
          <div className="wz-modal-foot">
            <Lock size={11} /> Encrypted link · Password protected
          </div>
        </form>
      </div>
    );
  }

  // ================================================================
  // MAIN VIEWER
  // ================================================================
  return (
    <div className="wz-app">

      {/* ---- TOP BAR ---- */}
      <header className="wz-topbar">
        <div className="wz-topbar-l">
          <img src={LOGO_URL} alt="Shape Architects" className="wz-logo" />
          <div className="wz-divider" />
          <div className="wz-project">
            <span className="wz-project-name">{review.title}</span>
            {activeImage && (
              <>
                <span className="wz-project-sep">—</span>
                <span className="wz-file-name">{activeImage.originalName}</span>
              </>
            )}
          </div>
        </div>
        <div className="wz-topbar-r">
          {compareMode
            ? <button className="wz-link wz-link-accent" type="button" onClick={exitCompare}>Exit Compare</button>
            : <button className="wz-link" type="button" onClick={enterCompare}>Compare</button>
          }
          <div className="wz-divider" />
          <button className="wz-link" type="button" onClick={() => setShowShare(true)}>Share</button>
          <div className="wz-divider" />
          <div className="wz-user">
            <span className="wz-user-dot" style={{ background: color }}>
              {guest.name[0]?.toUpperCase()}
            </span>
            <span className="wz-user-name">{guest.name}</span>
          </div>
        </div>
      </header>

      {/* ---- SUB BAR ---- */}
      <div className="wz-subbar">
        <div className="wz-subbar-l">
          <button className="wz-pill" type="button" onClick={() => setShowCollab(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.5 2-4 4-4"/>
            </svg>
            <span>Collaborators</span>
          </button>

          <div className="wz-seg">
            {([1, 2, 4] as const).map(v => (
              <button key={v} type="button"
                className={viewMode === v ? 'active' : ''}
                onClick={() => setViewMode(v)}
                title={`${v} column${v > 1 ? 's' : ''}`}
              >
                {v === 1
                  ? <Square size={13} />
                  : v === 2
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="13" width="7" height="7" rx="1"/><rect x="14" y="13" width="7" height="7" rx="1"/></svg>
                }
              </button>
            ))}
          </div>

          <div className="wz-file-nav">
            <button className="wz-icon-btn" type="button"
              onClick={() => navigateImage(-1)} disabled={activeImageIndex === 0}>
              <ChevronLeft size={14} />
            </button>
            <span className="wz-file-counter">File {activeImageIndex + 1} of {totalImages}</span>
            <button className="wz-icon-btn" type="button"
              onClick={() => navigateImage(1)} disabled={activeImageIndex === totalImages - 1}>
              <ChevronRight size={14} />
            </button>
            <button
              className={`wz-icon-btn${isPlaying ? ' wz-active' : ''}`}
              type="button" title="Slideshow"
              onClick={() => setIsPlaying(p => !p)}
            >
              <Play size={11} fill={isPlaying ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
        <div className="wz-subbar-r">
          <button className="wz-icon-btn" type="button" title="Toggle comments"
            onClick={() => setSidebarOpen(o => !o)}>
            {sidebarOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>

      {/* ---- BODY ---- */}
      <div className="wz-body">

        {/* LEFT RAIL */}
        <aside className="wz-leftrail">
          {(['note', 'pencil', 'eraser', 'pan'] as Tool[]).map(t => {
            const icons: Record<Tool, React.ReactNode> = {
              note: <MapPin size={16} strokeWidth={1.8} />,
              pencil: <Pencil size={16} strokeWidth={1.8} />,
              eraser: <Eraser size={16} strokeWidth={1.8} />,
              pan: <Hand size={16} strokeWidth={1.8} />,
            };
            const labels: Record<Tool, string> = {
              note: 'Pin comment (P)', pencil: 'Freehand draw (D)',
              eraser: 'Eraser (E)', pan: 'Pan / navigate (H)',
            };
            return (
              <button key={t}
                className={`wz-tool${tool === t ? ' wz-tool-active' : ''}`}
                type="button" title={labels[t]} onClick={() => setTool(t)}>
                {icons[t]}
              </button>
            );
          })}

          <button
            className={`wz-tool${!annotationsVisible ? ' wz-tool-active' : ''}`}
            type="button"
            title={annotationsVisible ? 'Hide annotations' : 'Show annotations'}
            onClick={() => setAnnotationsVisible(v => !v)}>
            {annotationsVisible
              ? <Eye size={16} strokeWidth={1.8} />
              : <EyeOff size={16} strokeWidth={1.8} />}
          </button>

          <div className="wz-rail-sep" />

          {/* Color picker */}
          <div className="wz-color-pop">
            <button className="wz-tool" type="button" title="Annotation color"
              style={{ padding: 0 }} onClick={() => setColorPopOpen(o => !o)}>
              <span className="wz-color-chip" style={{ background: color }} />
            </button>
            {colorPopOpen && (
              <div className="wz-color-list" style={{ display: 'flex' }}>
                {COLORS.map(c => (
                  <button key={c}
                    className={`wz-color-dot${color === c ? ' wz-color-dot-on' : ''}`}
                    style={{ background: c }} type="button"
                    onClick={() => { setColor(c); setColorPopOpen(false); }} />
                ))}
              </div>
            )}
          </div>

          {/* Stroke size */}
          <button className="wz-tool" type="button"
            title={`Stroke: ${strokeWidth}px · Click to cycle`}
            onClick={() => setStrokeWidth(w => w >= 24 ? 4 : w + 4)}>
            <span style={{
              display: 'block',
              width: `${Math.min(14, strokeWidth + 2)}px`,
              height: `${Math.min(14, strokeWidth + 2)}px`,
              borderRadius: '50%', background: 'currentColor',
            }} />
          </button>

          <div className="wz-rail-sep" />

          <button className="wz-tool" type="button" title="Print" onClick={printImage}>
            <Printer size={15} strokeWidth={1.6} />
          </button>
          <button className="wz-tool" type="button" title="Download image" onClick={downloadImage}>
            <Download size={15} strokeWidth={1.6} />
          </button>
        </aside>

        {/* MAIN CANVAS AREA */}
        <main className={`wz-main${compareMode ? ' wz-main-compare' : ''}${mobileTab === 'comments' ? ' wz-main-hide-mobile' : ''}`}>
          {/* PRIMARY PANE */}
          <div className="wz-pane">
          {compareMode && (
            <div className="wz-compare-topbar wz-compare-topbar-a">
              <span className="wz-compare-pane-label wz-compare-pane-label-a">A</span>
              <span className="wz-compare-filename">{activeImage?.originalName ?? ''}</span>
              <button
                className={`wz-icon-btn${sidebarOpen ? ' wz-active' : ''}`}
                type="button"
                title="Toggle comments"
                onClick={() => setSidebarOpen(o => !o)}
              >
                <MessageSquare size={13} />
              </button>
            </div>
          )}
          <div
            ref={canvasRef}
            className={`wz-canvas${imageDragOver ? ' wz-canvas-drag-over' : ''}`}
            style={{ cursor: cursorStyle }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onDragOver={e => {
              if (!hasImageFiles(e.dataTransfer.files, e.dataTransfer.items)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setImageDragOver(true);
            }}
            onDragLeave={e => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setImageDragOver(false);
            }}
            onDrop={e => {
              if (!hasImageFiles(e.dataTransfer.files, e.dataTransfer.items)) return;
              e.preventDefault();
              setImageDragOver(false);
              addCanvasImagesFromDrop(e.dataTransfer.files, e.clientX, e.clientY);
            }}>
            <div className="wz-canvas-stage"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: (zoomAnimating && !dragStart) ? 'transform 200ms cubic-bezier(0.16,1,0.3,1)' : 'none',
              }}>
              {activeImage ? (
                <div className="wz-canvas-image-wrap">
                  <img ref={activeImageRef}
                    src={`${storageBase}/storage/uploads/${activeImage.storedName}`}
                    alt={activeImage.originalName}
                    className="wz-canvas-image"
                    draggable={false}
                    onLoad={fitToCanvas}
                  />

                  {/* SVG layer — pencil */}
                  <svg className="wz-annotation-svg" viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    onPointerDown={e => {
                      if (!activeImage || tool === 'pan' || tool === 'eraser') return;
                      if (tool === 'note') addNote(activeImage.id, e);
                      if (tool === 'pencil') {
                        const point = pointFromEvent(e);
                        if (!point) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDraftPoints([point]);
                      }
                    }}
                    onPointerMove={e => {
                      if (tool === 'pencil' && draftPoints.length) {
                        const point = pointFromEvent(e);
                        if (!point) return;
                        setDraftPoints(prev => [...prev, point]);
                      }
                    }}
                    onPointerUp={e => {
                      if (!activeImage) return;
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                      if (tool === 'pencil' && draftPoints.length > 1) {
                        createAnnotationMutation.mutate({
                          imageId: activeImage.id, type: 'pencil',
                          geometry: { points: draftPoints }, color: drawingColor, strokeWidth,
                        });
                        setDraftPoints([]);
                      }
                    }}
                  >
                    {annotationsVisible && visibleActiveAnnotations.filter(a => a.type === 'pencil').map(a => (
                      <path key={a.id} d={toSmoothPath(a.geometry.points ?? [])}
                        stroke={a.color} strokeWidth={a.strokeWidth}
                        fill="none" strokeLinecap="round" strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: tool === 'eraser' ? 'stroke' : 'none', cursor: tool === 'eraser' ? 'pointer' : undefined }}
                        onClick={tool === 'eraser' ? e => { e.stopPropagation(); deleteAnnotationMutation.mutate(a.id); } : undefined}
                      />
                    ))}
                    {draftPoints.length > 1 && (
                      <path d={toSmoothPath(draftPoints)} stroke={drawingColor}
                        strokeWidth={strokeWidth} fill="none"
                        strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    )}
                  </svg>

                  {/* Note pins */}
                  {annotationsVisible && visibleActiveAnnotations.map(a => {
                    if (a.type !== 'note') return null;
                    return (
                      <PinMarker key={a.id} n={a.number ?? 0} color={a.color}
                        active={selectedAnnotationId === a.id}
                        resolved={a.resolved}
                        left={a.geometry.x ?? 0} top={a.geometry.y ?? 0} zoom={zoom}
                        onClick={() => {
                          if (tool === 'eraser') { deleteAnnotationMutation.mutate(a.id); return; }
                          setSelectedAnnotationId(a.id);
                          if (window.innerWidth < 760) setMobileTab('comments');
                          else setSidebarOpen(true);
                        }}
                        onMouseEnter={() => setHoveredAnnotationId(a.id)}
                        onMouseLeave={() => setHoveredAnnotationId('')}
                      />
                    );
                  })}

                  {activeCanvasImages.map(image => {
                    const url = `${storageBase}/storage/uploads/${image.storedName}`;
                    return (
                      <div
                        key={image.id}
                        className="wz-local-image"
                        style={{
                          left: `${image.x * 100}%`,
                          top: `${image.y * 100}%`,
                          width: `${image.width * 100}%`,
                        }}
                        title={image.originalName}
                        onClick={e => {
                          if (tool !== 'eraser') return;
                          e.stopPropagation();
                          deleteCanvasImageMutation.mutate(image.id);
                        }}
                      >
                        <a href={url} target="_blank" rel="noreferrer" title="Open full image" onClick={e => e.stopPropagation()}>
                          <img src={url} alt={image.originalName} draggable={false} />
                        </a>
                        <input
                          type="range"
                          min="4"
                          max="90"
                          value={Math.round(image.width * 100)}
                          title="Resize image"
                          onPointerDown={e => { e.stopPropagation(); setResizingCanvasImageId(image.id); }}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateCanvasImageWidth(image.id, Number(e.currentTarget.value) / 100)}
                          onPointerUp={e => {
                            e.stopPropagation();
                            setResizingCanvasImageId('');
                            updateCanvasImageMutation.mutate({ id: image.id, width: Number(e.currentTarget.value) / 100 });
                          }}
                          onBlur={e => {
                            if (resizingCanvasImageId === image.id) {
                              setResizingCanvasImageId('');
                              updateCanvasImageMutation.mutate({ id: image.id, width: Number(e.currentTarget.value) / 100 });
                            }
                          }}
                        />
                        <button type="button" title="Remove shared image" onClick={e => { e.stopPropagation(); deleteCanvasImageMutation.mutate(image.id); }}>
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="wz-empty">
                  <div className="wz-empty-title">No images uploaded yet.</div>
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM BAR */}
          <div className="wz-bottombar">
            <div className="wz-bottom-l wz-help">
              {tool === 'note' && 'Click image to drop a pin · Alt+drag to pan'}
              {tool === 'pencil' && 'Draw freehand · Alt+drag to pan'}
              {tool === 'eraser' && 'Click a pencil stroke, pin, or dropped image to delete it'}
              {tool === 'pan' && 'Drag to pan · Ctrl+scroll to zoom'}
            </div>
            <div className="wz-bottom-r">
              <button className="wz-icon-btn" type="button" title="Zoom in"
                onClick={() => zoomBy(0.15)}>
                <Plus size={13} />
              </button>
              <button className="wz-icon-btn" type="button" title="Zoom out"
                onClick={() => zoomBy(-0.15)}>
                <Minus size={13} />
              </button>
              <button className="wz-zoom-pct" type="button" title="Reset view"
                onClick={() => { setZoomAnimating(true); setTimeout(() => setZoomAnimating(false), 250); fitToCanvas(); }}>
                {Math.round(zoom * 100)}%
              </button>
            </div>
          </div>

          {/* File strip toggle */}
          {totalImages > 1 && (
            <button className="wz-strip-toggle" type="button" onClick={() => setStripOpen(o => !o)}>
              {stripOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              {stripOpen ? 'Hide' : 'All files'} ({totalImages})
            </button>
          )}

          {/* File strip */}
          {stripOpen && (
            <div className="wz-strip">
              {review.images.map(image => {
                const count = review.annotations.filter(a => a.imageId === image.id && !a.deletedAt).length;
                return (
                  <button key={image.id}
                    className={`wz-strip-item${image.id === activeImageId ? ' wz-strip-active' : ''}`}
                    type="button"
                    onClick={() => { setActiveImageId(image.id); setZoom(1); setPan({ x: 0, y: 0 }); setStripOpen(false); }}>
                    <img src={`${storageBase}/storage/uploads/${image.storedName}`} alt={image.originalName} />
                    <div className="wz-strip-meta">
                      <span className="wz-strip-name">{image.originalName}</span>
                      {count > 0 && <span className="wz-strip-pill">{count}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          </div>{/* end .wz-pane primary */}

          {/* COMPARE PANE */}
          {compareMode && (
            <div className={`wz-pane wz-pane-compare${compareOpen ? ' wz-pane-compare-open' : ''}`}>

              {/* Compare center: topbar + canvas + bottombar */}
              <div className="wz-compare-center">
                <div className="wz-compare-topbar">
                  <span className="wz-compare-pane-label">B</span>
                  <button className="wz-icon-btn" type="button" title="Previous"
                    disabled={totalImages <= 1}
                    onClick={() => {
                      if (!review) return;
                      const prev = compareImageIndex <= 0 ? totalImages - 1 : compareImageIndex - 1;
                      setCompareImageId(review.images[prev].id);
                    }}>
                    <ChevronLeft size={13} />
                  </button>
                  <span className="wz-compare-filename">{compareImage?.originalName ?? ''}</span>
                  <button className="wz-icon-btn" type="button" title="Next"
                    disabled={totalImages <= 1}
                    onClick={() => {
                      if (!review) return;
                      const next = compareImageIndex >= totalImages - 1 ? 0 : compareImageIndex + 1;
                      setCompareImageId(review.images[next].id);
                    }}>
                    <ChevronRight size={13} />
                  </button>
                  <button
                    className={`wz-icon-btn${compareSidebarOpen ? ' wz-active' : ''}`}
                    type="button"
                    title="Toggle comments"
                    onClick={() => setCompareSidebarOpen(o => !o)}
                  >
                    <MessageSquare size={13} />
                  </button>
                </div>

                <div ref={compareCanvasRef} className="wz-canvas"
                  style={{ cursor: compareDragStart ? 'grabbing' : compareTool === 'pan' ? 'grab' : 'crosshair' }}
                  onMouseDown={e => {
                    if (compareTool === 'pan' || e.button === 1 || e.altKey) {
                      e.preventDefault();
                      setCompareDragStart({ x: e.clientX - comparePan.x, y: e.clientY - comparePan.y });
                    }
                  }}
                  onMouseMove={e => { if (!compareDragStart) return; setComparePan({ x: e.clientX - compareDragStart.x, y: e.clientY - compareDragStart.y }); }}
                  onMouseUp={() => setCompareDragStart(null)}
                  onMouseLeave={() => setCompareDragStart(null)}
                >
                  <div className="wz-canvas-stage" style={{
                    transform: `translate(${comparePan.x}px, ${comparePan.y}px) scale(${compareZoom})`,
                    transition: (compareZoomAnimating && !compareDragStart) ? 'transform 200ms cubic-bezier(0.16,1,0.3,1)' : 'none',
                  }}>
                    {compareImage ? (
                      <div className="wz-canvas-image-wrap">
                        <img ref={compareImageRef}
                          src={`${storageBase}/storage/uploads/${compareImage.storedName}`}
                          alt={compareImage.originalName}
                          className="wz-canvas-image"
                          draggable={false}
                          onLoad={fitCompareCanvas}
                        />
                        <svg className="wz-annotation-svg" viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          onPointerDown={e => {
                            if (!compareImage || compareTool === 'pan' || compareTool === 'eraser') return;
                            if (compareTool === 'note') addCompareNote(compareImage.id, e);
                            if (compareTool === 'pencil') {
                              const point = pointFromEvent(e);
                              if (!point) return;
                              e.currentTarget.setPointerCapture(e.pointerId);
                              setCompareDraftPoints([point]);
                            }
                          }}
                          onPointerMove={e => {
                            if (compareTool === 'pencil' && compareDraftPoints.length) {
                              const point = pointFromEvent(e);
                              if (!point) return;
                              setCompareDraftPoints(prev => [...prev, point]);
                            }
                          }}
                          onPointerUp={e => {
                            if (!compareImage) return;
                            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                            if (compareTool === 'pencil' && compareDraftPoints.length > 1) {
                              createAnnotationMutation.mutate({
                                imageId: compareImage.id, type: 'pencil',
                                geometry: { points: compareDraftPoints }, color: drawingColor, strokeWidth,
                              });
                              setCompareDraftPoints([]);
                            }
                          }}
                        >
                          {compareAnnotationsVisible && visibleCompareAnnotations.filter(a => a.type === 'pencil').map(a => (
                            <path key={a.id} d={toSmoothPath(a.geometry.points ?? [])}
                              stroke={a.color} strokeWidth={a.strokeWidth}
                              fill="none" strokeLinecap="round" strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                              style={{ pointerEvents: compareTool === 'eraser' ? 'stroke' : 'none', cursor: compareTool === 'eraser' ? 'pointer' : undefined }}
                              onClick={compareTool === 'eraser' ? e => { e.stopPropagation(); deleteAnnotationMutation.mutate(a.id); } : undefined}
                            />
                          ))}
                          {compareDraftPoints.length > 1 && (
                            <path d={toSmoothPath(compareDraftPoints)} stroke={drawingColor}
                              strokeWidth={strokeWidth} fill="none"
                              strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          )}
                        </svg>
                        {compareAnnotationsVisible && visibleCompareAnnotations.map(a => {
                          if (a.type !== 'note') return null;
                          return (
                            <PinMarker key={a.id} n={a.number ?? 0} color={a.color}
                              active={compareSelectedId === a.id}
                              resolved={a.resolved}
                              left={a.geometry.x ?? 0} top={a.geometry.y ?? 0} zoom={compareZoom}
                              onClick={() => {
                                if (compareTool === 'eraser') { deleteAnnotationMutation.mutate(a.id); return; }
                                setCompareSelectedId(a.id);
                                setCompareSidebarOpen(true);
                              }}
                              onMouseEnter={() => setCompareHoveredId(a.id)}
                              onMouseLeave={() => setCompareHoveredId('')}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="wz-empty"><div className="wz-empty-title">No image.</div></div>
                    )}
                  </div>
                </div>

                <div className="wz-bottombar">
                  <div className="wz-bottom-l wz-help">
                    {compareTool === 'note' && 'Click image to drop a pin'}
                    {compareTool === 'pencil' && 'Draw freehand · Alt+drag to pan'}
                    {compareTool === 'eraser' && 'Click a stroke or pin to delete it'}
                    {compareTool === 'pan' && `File ${compareImageIndex + 1} of ${totalImages}`}
                  </div>
                  <div className="wz-bottom-r">
                    <button className="wz-icon-btn" type="button" title="Zoom in" onClick={() => zoomCompareBy(0.15)}><Plus size={13} /></button>
                    <button className="wz-icon-btn" type="button" title="Zoom out" onClick={() => zoomCompareBy(-0.15)}><Minus size={13} /></button>
                    <button className="wz-zoom-pct" type="button" title="Reset view"
                      onClick={() => { setCompareZoomAnimating(true); setTimeout(() => setCompareZoomAnimating(false), 250); fitCompareCanvas(); }}>
                      {Math.round(compareZoom * 100)}%
                    </button>
                  </div>
                </div>
              </div>{/* end wz-compare-center */}

              {/* Compare sidebar */}
              <aside className={`wz-sidebar wz-sidebar-compare${compareSidebarOpen ? ' wz-sidebar-open' : ''}`}>
                <div className="wz-sidebar-pane-header">
                  <span className="wz-compare-pane-label">B</span>
                  <span className="wz-sidebar-pane-title">{compareImage?.originalName ?? 'Canvas B'}</span>
                </div>
                <div className="wz-tabs">
                  <button
                    className={`wz-tab${compareSidebarTab === 'comments' ? ' wz-tab-active' : ''}`}
                    type="button"
                    onClick={() => setCompareSidebarTab('comments')}
                  >
                    Comments <span className="wz-badge">{compareOpenCount}</span>
                  </button>
                  <button
                    className={`wz-tab${compareSidebarTab === 'approved' ? ' wz-tab-active' : ''}`}
                    type="button"
                    onClick={() => setCompareSidebarTab('approved')}
                  >
                    Approved <span className="wz-badge">{compareApprovedCount}</span>
                  </button>
                  <button
                    className={`wz-tab${compareSidebarTab === 'deleted' ? ' wz-tab-active' : ''}`}
                    type="button"
                    onClick={() => setCompareSidebarTab('deleted')}
                  >
                    Deleted <span className="wz-badge">{compareDeletedCount}</span>
                  </button>
                  <button className="wz-tab-close" type="button" title="Close" onClick={() => setCompareSidebarOpen(false)}>
                    <X size={14} />
                  </button>
                </div>

                <div className="wz-comments">
                  {compareDisplayAnnotations.length === 0 ? (
                    <div className="wz-empty">
                      <div className="wz-empty-ico"><MapPin size={22} strokeWidth={1.3} /></div>
                      <div className="wz-empty-title">
                        {emptyTitleForTab(compareSidebarTab)}
                      </div>
                      <div className="wz-empty-sub">
                        {emptySubForTab(compareSidebarTab, false)}
                      </div>
                    </div>
                  ) : (
                    compareDisplayAnnotations.map(a => (
                      <CommentCard key={a.id} annotation={a}
                        isActive={compareSelectedId === a.id}
                        isHovered={compareHoveredId === a.id}
                        isOwn={a.guestId === guest.id}
                        menuOpen={compareOpenMenuId === a.id}
                        onOpenMenu={() => setCompareOpenMenuId(id => (id === a.id ? '' : a.id))}
                        onCloseMenu={() => setCompareOpenMenuId('')}
                        onClick={() => setCompareSelectedId(a.id)}
                        onHover={id => setCompareHoveredId(id)}
                        onResolve={() => updateAnnotationMutation.mutate({ id: a.id, resolved: !a.resolved })}
                        onDelete={() => deleteAnnotationMutation.mutate(a.id)}
                        deleteDisabled={deleteAnnotationMutation.isPending}
                        onReply={text => createReplyMutation.mutate({ annotationId: a.id, text })}
                        replyPending={createReplyMutation.isPending}
                      />
                    ))
                  )}
                </div>

                <div className="wz-composer">
                  <button className="wz-add-comment" type="button"
                    onClick={() => setCompareTool('note')}>
                    + Add Comment
                  </button>
                  <div className="wz-composer-hint">Or click on the render</div>
                </div>
              </aside>
            </div>
          )}
        </main>

        {/* SIDEBAR — primary comments, always at far right */}
        <aside className={`wz-sidebar${compareMode ? ' wz-sidebar-compare' : ''}${sidebarOpen ? ' wz-sidebar-open' : ''}`}>
          {compareMode && (
            <div className="wz-sidebar-pane-header">
              <span className="wz-compare-pane-label wz-compare-pane-label-a">A</span>
              <span className="wz-sidebar-pane-title">{activeImage?.originalName ?? 'Canvas A'}</span>
            </div>
          )}
          <div className="wz-tabs">
            <button
              className={`wz-tab${sidebarTab === 'comments' ? ' wz-tab-active' : ''}`}
              type="button"
              onClick={() => setSidebarTab('comments')}
            >
              Comments <span className="wz-badge">{openCount}</span>
            </button>
            <button
              className={`wz-tab${sidebarTab === 'approved' ? ' wz-tab-active' : ''}`}
              type="button"
              onClick={() => setSidebarTab('approved')}
            >
              Approved <span className="wz-badge">{approvedCount}</span>
            </button>
            <button
              className={`wz-tab${sidebarTab === 'deleted' ? ' wz-tab-active' : ''}`}
              type="button"
              onClick={() => setSidebarTab('deleted')}
            >
              Deleted <span className="wz-badge">{deletedCount}</span>
            </button>
            <button className="wz-tab-close" type="button" title="Close" onClick={() => setSidebarOpen(false)}>
              <X size={14} />
            </button>
          </div>

          {sidebarTab === 'comments' && (
            <div className="wz-side-tools">
              <button className="wz-side-filter" type="button" onClick={() => setFilterOpen(o => !o)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 6h16M7 12h10M10 18h4" />
                </svg>
                Filter
              </button>
              <div className="wz-side-nav">
                <button className="wz-icon-btn" type="button" title="Previous" onClick={() => {
                  const idx = displayAnnotations.findIndex(a => a.id === selectedAnnotationId);
                  const prev = displayAnnotations[idx <= 0 ? displayAnnotations.length - 1 : idx - 1];
                  if (prev) jumpToAnnotation(prev);
                }}><ChevronLeft size={12} /></button>
                <button className="wz-icon-btn" type="button" title="Next" onClick={() => {
                  const idx = displayAnnotations.findIndex(a => a.id === selectedAnnotationId);
                  const next = displayAnnotations[idx >= displayAnnotations.length - 1 ? 0 : idx + 1];
                  if (next) jumpToAnnotation(next);
                }}><ChevronRight size={12} /></button>
                <button className="wz-icon-btn" type="button" title="Deselect"
                  onClick={() => setSelectedAnnotationId('')}><ChevronUp size={12} /></button>
              </div>
            </div>
          )}

          {sidebarTab === 'comments' && filterOpen && (
            <div className="wz-filter-panel">
              <div className="wz-filter-row">
                <span>Show</span>
                <div className="wz-seg-sm">
                  {(['all', 'open', 'resolved'] as const).map(v => (
                    <button key={v} className={filter === v ? 'active' : ''} type="button"
                      onClick={() => setFilter(v)}>
                      {v === 'open' ? 'Open' : v === 'resolved' ? 'Resolved' : 'All'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="wz-comments">
            {displayAnnotations.length === 0 ? (
              <div className="wz-empty">
                <div className="wz-empty-ico"><MapPin size={22} strokeWidth={1.3} /></div>
                <div className="wz-empty-title">
                  {emptyTitleForTab(sidebarTab)}
                </div>
                <div className="wz-empty-sub">
                  {emptySubForTab(sidebarTab, filter !== 'all')}
                </div>
              </div>
            ) : (
              displayAnnotations.map(a => (
                <CommentCard key={a.id} annotation={a}
                  isActive={selectedAnnotationId === a.id}
                  isHovered={hoveredAnnotationId === a.id}
                  isOwn={a.guestId === guest.id}
                  menuOpen={openMenuId === a.id}
                  onOpenMenu={() => setOpenMenuId(id => (id === a.id ? '' : a.id))}
                  onCloseMenu={() => setOpenMenuId('')}
                  onClick={() => jumpToAnnotation(a)}
                  onHover={id => setHoveredAnnotationId(id)}
                  onResolve={() => updateAnnotationMutation.mutate({ id: a.id, resolved: !a.resolved })}
                  onDelete={() => deleteAnnotationMutation.mutate(a.id)}
                  deleteDisabled={deleteAnnotationMutation.isPending}
                  onReply={text => createReplyMutation.mutate({ annotationId: a.id, text })}
                  replyPending={createReplyMutation.isPending}
                />
              ))
            )}
          </div>

          <div className="wz-composer">
            <button className="wz-add-comment" type="button"
              onClick={() => { setTool('note'); setSidebarOpen(false); }}>
              + Add Comment
            </button>
            <div className="wz-composer-hint">Or click on the render</div>
          </div>
        </aside>
      </div>

      {/* MOBILE BOTTOM BAR */}
      <div className="wz-mobilebar">
        <button className={mobileTab === 'canvas' ? 'active' : ''} type="button"
          onClick={() => setMobileTab('canvas')}>Render</button>
        <button className={mobileTab === 'comments' ? 'active' : ''} type="button"
          onClick={() => { setMobileTab('comments'); setSidebarOpen(true); }}>
          Comments {openCount > 0 && <span className="wz-badge">{openCount}</span>}
        </button>
      </div>

      {/* NOTE INPUT MODAL */}
      {pendingNote && (
        <div className="wz-modal-backdrop" role="presentation" onMouseDown={() => setPendingNote(null)}>
          <form className="wz-modal" onSubmit={e => { e.preventDefault(); submitNote(); }}
            onMouseDown={e => e.stopPropagation()}>
            <div className="wz-modal-title" style={{ textAlign: 'left', fontSize: '15px' }}>Add Comment</div>
            <div className="wz-modal-sub" style={{ textAlign: 'left', marginBottom: '16px' }}>
              Pin will be placed on this render.
            </div>
            <textarea className="wz-note-textarea" value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Describe the change…" autoFocus />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="wz-btn-primary" style={{ flex: 1 }} type="submit"
                disabled={!noteText.trim() || createAnnotationMutation.isPending}>
                {createAnnotationMutation.isPending ? 'Saving…' : 'Add Comment'}
              </button>
              <button className="wz-btn-secondary" type="button" onClick={() => setPendingNote(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* COMPARE NOTE INPUT MODAL */}
      {comparePendingNote && (
        <div className="wz-modal-backdrop" role="presentation" onMouseDown={() => setComparePendingNote(null)}>
          <form className="wz-modal" onSubmit={e => { e.preventDefault(); submitCompareNote(); }}
            onMouseDown={e => e.stopPropagation()}>
            <div className="wz-modal-title" style={{ textAlign: 'left', fontSize: '15px' }}>Add Comment</div>
            <div className="wz-modal-sub" style={{ textAlign: 'left', marginBottom: '16px' }}>
              Pin will be placed on this render.
            </div>
            <textarea className="wz-note-textarea" value={compareNoteText}
              onChange={e => setCompareNoteText(e.target.value)}
              placeholder="Describe the change…" autoFocus />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="wz-btn-primary" style={{ flex: 1 }} type="submit"
                disabled={!compareNoteText.trim() || createAnnotationMutation.isPending}>
                {createAnnotationMutation.isPending ? 'Saving…' : 'Add Comment'}
              </button>
              <button className="wz-btn-secondary" type="button" onClick={() => setComparePendingNote(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODALS */}
      {showCollab && <CollabModal guests={review.guests} onClose={() => setShowCollab(false)} />}
      {showShare && <ShareModal token={token} onClose={() => setShowShare(false)} />}
    </div>
  );
}
