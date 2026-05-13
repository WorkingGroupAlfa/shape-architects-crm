import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { api } from '../lib/api';

type ErrorLogEntry = {
  id: string;
  createdAt: string;
  source: 'client' | 'server';
  level: 'error' | 'warn';
  message: string;
  stack: string | null;
  route: string | null;
  userName: string | null;
  role: string | null;
  ip: string | null;
};

type TechAdminErrorsResponse = {
  errors: ErrorLogEntry[];
};

const formatDateTime = (value: string) => new Date(value).toLocaleString();

export function TechAdminErrorsPage() {
  const { data } = useQuery({
    queryKey: ['tech-admin-errors'],
    queryFn: () => api.get<TechAdminErrorsResponse>('/tech-admin/errors'),
    refetchInterval: 6000
  });

  if (!data) return <div className="skeleton-page" />;

  return (
    <div className="page-grid tech-admin-page">
      <Card>
        <div className="section-head">
          <h2>Runtime Errors</h2>
          <span className="muted small">{data.errors.length} records</span>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>User</th>
              <th>IP</th>
              <th>Route</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {data.errors.map(error => (
              <tr key={error.id}>
                <td>{formatDateTime(error.createdAt)}</td>
                <td><span className={`tech-admin-badge ${error.source === 'server' ? 'warn' : ''}`}>{error.source}</span></td>
                <td>{error.userName ?? '-'} {error.role ? `(${error.role})` : ''}</td>
                <td>{error.ip ?? '-'}</td>
                <td>{error.route ?? '-'}</td>
                <td>
                  <div className="tech-admin-error-text">{error.message}</div>
                  {error.stack ? <pre className="tech-admin-error-stack">{error.stack}</pre> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

