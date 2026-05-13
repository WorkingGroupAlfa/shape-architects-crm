import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { api } from '../lib/api';

type SessionRole = 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN';

type ActiveSessionEntry = {
  sessionId: string;
  userId: string;
  userName: string;
  role: SessionRole;
  ip: string;
  device: string;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

type LoginAuditEntry = {
  id: string;
  createdAt: string;
  loginInput: string;
  success: boolean;
  userName: string | null;
  role: SessionRole | null;
  ip: string;
  device: string;
};

type TechAdminSessionsResponse = {
  activeSessions: ActiveSessionEntry[];
  loginJournal: LoginAuditEntry[];
};

const formatDateTime = (value: string) => new Date(value).toLocaleString();

export function TechAdminLoginsPage() {
  const { data } = useQuery({
    queryKey: ['tech-admin-sessions'],
    queryFn: () => api.get<TechAdminSessionsResponse>('/tech-admin/sessions'),
    refetchInterval: 5000
  });

  if (!data) return <div className="skeleton-page" />;

  return (
    <div className="page-grid tech-admin-page">
      <Card>
        <div className="section-head">
          <h2>Active Logins</h2>
          <span className="muted small">{data.activeSessions.length} active</span>
        </div>
        <Table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>IP</th>
              <th>Device</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {data.activeSessions.map(session => (
              <tr key={session.sessionId}>
                <td>{session.userName}</td>
                <td><span className="tech-admin-badge">{session.role}</span></td>
                <td>{session.ip}</td>
                <td>{session.device}</td>
                <td>{formatDateTime(session.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <div className="section-head">
          <h2>Login Journal</h2>
          <span className="muted small">Latest entries</span>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Input</th>
              <th>Account</th>
              <th>IP</th>
              <th>Device</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.loginJournal.map(entry => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.createdAt)}</td>
                <td>{entry.loginInput}</td>
                <td>{entry.userName ?? '-'}</td>
                <td>{entry.ip}</td>
                <td>{entry.device}</td>
                <td>
                  <span className={entry.success ? 'tech-admin-badge success' : 'tech-admin-badge danger'}>
                    {entry.success ? 'Success' : 'Failed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

