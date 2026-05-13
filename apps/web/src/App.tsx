import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, FolderKanban, Wallet, CalendarDays, Mail, UserCog, LogOut, Menu, X, MessageCircle, Activity, AlertTriangle, HardDrive, ShieldCheck, Images } from 'lucide-react';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailsPage } from './pages/ClientDetailsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailsPage } from './pages/ProjectDetailsPage';
import { FinancesPage } from './pages/FinancesPage';
import { CalendarPage } from './pages/CalendarPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { ExecutorsPage } from './pages/ExecutorsPage';
import { ChatsPage } from './pages/ChatsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { PublicReviewPage } from './pages/PublicReviewPage';
import { TechAdminLoginsPage } from './pages/TechAdminLoginsPage';
import { TechAdminErrorsPage } from './pages/TechAdminErrorsPage';
import { TechAdminStoragePage } from './pages/TechAdminStoragePage';
import { TechAdminHealthPage } from './pages/TechAdminHealthPage';
import { NotificationCenter } from './components/NotificationCenter';
import { api } from './lib/api';

type Role = 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN';
type SessionUser = { id: string; name: string; email: string; role: Role };
type ProjectChatSidebarItem = { id: string; unreadCount: number };

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };

const ADMIN_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/finances', label: 'Finances', icon: Wallet },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/executors', label: 'Executors', icon: UserCog },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/reviews', label: 'Reviews', icon: Images },
  { to: '/templates', label: 'Templates', icon: Mail }
];

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/chats', label: 'Chats', icon: MessageCircle }
];

const TECH_ADMIN_NAV: NavItem[] = [
  { to: '/tech-admin/logins', label: 'Active Logins', icon: Activity },
  { to: '/tech-admin/errors', label: 'Errors Console', icon: AlertTriangle },
  { to: '/tech-admin/storage', label: 'Storage MB', icon: HardDrive },
  { to: '/tech-admin/health', label: 'Health Status', icon: ShieldCheck }
];

function LoginScreen({ onLogin }: { onLogin: (payload: { token: string; user: SessionUser }) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
      setError('');
      try {
      const payload = await api.post<{ token: string; user: SessionUser }>('/auth/login', { login, password });
      onLogin(payload);
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <img className="auth-logo" src="/shape-logo.webp" alt="Shape Architects" />
        <p className="muted">Login required</p>
        <input className="input" type="text" placeholder="Login or email" value={login} onChange={e => setLogin(e.target.value)} required />
        <input className="input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error ? <div className="muted small">{error}</div> : null}
        <button className="primary-btn" type="submit" disabled={pending}>{pending ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth > 1080);
  const location = useLocation();

  useEffect(() => {
    if (!user) return;

    const token = api.getAuthToken();
    if (!token) return;

    const sendClientError = (payload: { message: string; stack?: string; details?: unknown; route?: string; level?: 'error' | 'warn' }) => {
      const authToken = api.getAuthToken();
      if (!authToken) return;
      void fetch(`${api.baseUrl}/monitoring/client-errors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          message: payload.message,
          stack: payload.stack ?? null,
          route: payload.route ?? window.location.pathname,
          details: payload.details ?? null,
          level: payload.level ?? 'error'
        }),
        keepalive: true
      }).catch(() => {
        // Ignore telemetry transport errors.
      });
    };

    const onWindowError = (event: ErrorEvent) => {
      sendClientError({
        message: event.message || 'Unknown window error',
        stack: event.error instanceof Error ? event.error.stack : undefined,
        details: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason instanceof Error) {
        sendClientError({
          message: `Unhandled rejection: ${reason.message}`,
          stack: reason.stack
        });
        return;
      }
      sendClientError({
        message: 'Unhandled rejection (non-error payload)',
        details: reason
      });
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [user]);

  useEffect(() => {
    const token = api.getAuthToken();
    if (!token) {
      setChecking(false);
      return;
    }

    api.get<SessionUser>('/auth/me')
      .then(setUser)
      .catch(() => {
        api.setAuthToken('');
        setUser(null);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth > 1080);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nav = useMemo(() => {
    if (!user) return [];
    if (user.role === 'ADMIN') return ADMIN_NAV;
    if (user.role === 'TECH_ADMIN') return TECH_ADMIN_NAV;
    return EMPLOYEE_NAV;
  }, [user]);
  const chatsUnreadQuery = useQuery({
    queryKey: ['project-chats-unread-nav', user?.role],
    queryFn: () => api.get<ProjectChatSidebarItem[]>('/projects/chats'),
    enabled: Boolean(user && user.role !== 'TECH_ADMIN'),
    refetchInterval: 2500
  });
  const hasUnreadChats = (chatsUnreadQuery.data ?? []).some(item => item.unreadCount > 0);
  const showDashboardLogo = user?.role === 'ADMIN' && location.pathname === '/';
  const mobileNav = useMemo(() => {
    if (!user) return [];
    if (user.role === 'ADMIN') {
      return ADMIN_NAV.filter(item =>
        item.to === '/' || item.to === '/clients' || item.to === '/projects' || item.to === '/calendar'
      );
    }
    if (user.role === 'TECH_ADMIN') return TECH_ADMIN_NAV;
    return EMPLOYEE_NAV;
  }, [user]);

  if (checking) return <div className="skeleton-page" />;
  if (location.pathname.startsWith('/review/')) {
    return <PublicReviewPage />;
  }
  if (!user) {
    return (
      <LoginScreen
        onLogin={({ token, user: loggedUser }) => {
          api.setAuthToken(token);
          setUser(loggedUser);
        }}
      />
    );
  }

  const logout = () => {
    api.setAuthToken('');
    setUser(null);
  };

  const asideClasses = [
    'sidebar',
    mobileMenuOpen ? 'mobile-open' : '',
    !desktopSidebarOpen ? 'desktop-collapsed' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={desktopSidebarOpen ? 'app-shell' : 'app-shell sidebar-collapsed'}>
      <aside className={asideClasses}>
        <div className="brand">
          <div>
            <div className="brand-title">Shape CRM</div>
            <div className="brand-subtitle">Architects</div>
          </div>
          {isDesktop ? (
            <button
              className="icon-btn desktop-close-btn"
              type="button"
              onClick={() => setDesktopSidebarOpen(false)}
              aria-label="Close navigation menu"
            >
              <X size={18} />
            </button>
          ) : null}
          {!isDesktop ? (
            <button
              className="icon-btn mobile-close-btn"
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>

        <nav className="sidebar-nav">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Chats' && hasUnreadChats ? <span className="nav-unread-dot" aria-hidden="true" /> : null}
            </NavLink>
          ))}
          <button className="nav-item nav-signout-btn" type="button" onClick={logout}>
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </nav>
      </aside>
      {mobileMenuOpen ? <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} /> : null}

      <main className="content">
        <header className={showDashboardLogo ? 'topbar' : 'topbar topbar-empty'}>
          {isDesktop ? (
            !desktopSidebarOpen ? (
              <button className="icon-btn desktop-menu-btn" type="button" onClick={() => setDesktopSidebarOpen(true)} aria-label="Open navigation menu">
                <Menu size={18} />
              </button>
            ) : (
              <span />
            )
          ) : (
            <button className="icon-btn mobile-menu-btn" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation menu">
              <Menu size={18} />
            </button>
          )}
          {showDashboardLogo ? (
            <img
              className="dashboard-logo"
              src="/shape-logo.webp"
              alt="Shape Architects"
            />
          ) : (
            <span aria-hidden="true" />
          )}
        </header>

        <div key={location.pathname} className="route-fade-shell">
          <Routes>
            {user.role === 'ADMIN' ? (
              <>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id/*" element={<ClientDetailsPage />} />
                <Route path="/projects" element={<ProjectsPage role={user.role} />} />
                <Route path="/projects/:id/*" element={<ProjectDetailsPage role={user.role} />} />
                <Route path="/finances" element={<FinancesPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/executors" element={<ExecutorsPage currentUserId={user.id} />} />
                <Route path="/chats" element={<ChatsPage role={user.role} />} />
                <Route path="/reviews" element={<ReviewsPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : user.role === 'TECH_ADMIN' ? (
              <>
                <Route path="/" element={<Navigate to="/tech-admin/logins" replace />} />
                <Route path="/tech-admin/logins" element={<TechAdminLoginsPage />} />
                <Route path="/tech-admin/errors" element={<TechAdminErrorsPage />} />
                <Route path="/tech-admin/storage" element={<TechAdminStoragePage />} />
                <Route path="/tech-admin/health" element={<TechAdminHealthPage />} />
                <Route path="*" element={<Navigate to="/tech-admin/logins" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Navigate to="/projects" replace />} />
                <Route path="/projects" element={<ProjectsPage role={user.role} />} />
                <Route path="/projects/:id/*" element={<ProjectDetailsPage role={user.role} />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/chats" element={<ChatsPage role={user.role} />} />
                <Route path="*" element={<Navigate to="/projects" replace />} />
              </>
            )}
          </Routes>
        </div>
      </main>

      <nav className={mobileMenuOpen ? 'mobile-bottom-nav is-hidden' : 'mobile-bottom-nav'} aria-label="Primary mobile navigation">
        {mobileNav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'mobile-bottom-item active' : 'mobile-bottom-item'}>
            <Icon size={20} />
            <span>{label}</span>
            {label === 'Chats' && hasUnreadChats ? <span className="mobile-nav-unread-dot" aria-hidden="true" /> : null}
          </NavLink>
        ))}
      </nav>

      {user.role === 'ADMIN' ? <NotificationCenter /> : null}
    </div>
  );
}
