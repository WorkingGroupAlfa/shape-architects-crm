import { useQuery } from '@tanstack/react-query';
import { StatCard } from '../components/StatCard';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { Wallet, FolderKanban, Users, BellRing } from 'lucide-react';
import { api } from '../lib/api';

type DashboardData = {
  clients: number;
  activeProjects: number;
  expectedPayments: number;
  income: number;
  expense: number;
  tasks: Array<{ id: string; title: string; date: string; client?: { name: string | null } }>;
  notifications: Array<{ id: string; title: string; message: string }>;
  leads: Array<{ id: string; name: string; source: string; createdAt: string; status: string }>;
};

export function DashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard')
  });

  if (!data) return <div className="skeleton-page" />;

  return (
    <div className="page-grid dashboard-page">
      <div className="stats-grid desktop-only">
        <StatCard label="Clients" value={data.clients} icon={<Users size={18} />} />
        <StatCard label="Active Projects" value={data.activeProjects} icon={<FolderKanban size={18} />} />
        <StatCard label="Expected Payments" value={`$${data.expectedPayments}`} icon={<Wallet size={18} />} />
        <StatCard label="Notifications" value={data.notifications.length} icon={<BellRing size={18} />} />
      </div>

      <div className="mobile-only dashboard-mobile-layout">
        <Card className="dashboard-mobile-hero">
          <div className="dashboard-mobile-hero-head">
            <h3>Overview</h3>
            <span className="muted small">Today</span>
          </div>
          <div className="dashboard-mobile-metrics">
            <div className="dashboard-mobile-metric">
              <span className="muted small">Clients</span>
              <strong>{data.clients}</strong>
            </div>
            <div className="dashboard-mobile-metric">
              <span className="muted small">Projects</span>
              <strong>{data.activeProjects}</strong>
            </div>
            <div className="dashboard-mobile-metric">
              <span className="muted small">Payments</span>
              <strong>${data.expectedPayments}</strong>
            </div>
            <div className="dashboard-mobile-metric">
              <span className="muted small">Alerts</span>
              <strong>{data.notifications.length}</strong>
            </div>
          </div>
        </Card>

        <Card className="dashboard-mobile-section">
          <div className="dashboard-mobile-section-head">
            <h3>Upcoming Tasks</h3>
          </div>
          <div className="dashboard-mobile-list">
            {data.tasks.length ? data.tasks.map(task => (
              <div key={task.id} className="dashboard-mobile-row">
                <div className="dashboard-mobile-row-title">{task.title}</div>
                <div className="dashboard-mobile-row-meta">
                  <span>{new Date(task.date).toLocaleString()}</span>
                  <span>{task.client?.name ?? '-'}</span>
                </div>
              </div>
            )) : <div className="muted">No tasks</div>}
          </div>
        </Card>

        <Card className="dashboard-mobile-section">
          <div className="dashboard-mobile-section-head">
            <h3>Latest Website Leads</h3>
          </div>
          <div className="dashboard-mobile-list">
            {data.leads.length ? data.leads.map(lead => (
              <div key={lead.id} className="dashboard-mobile-row">
                <div className="dashboard-mobile-row-title">{lead.name}</div>
                <div className="dashboard-mobile-row-meta">
                  <span>{lead.source}</span>
                  <span>{lead.status}</span>
                </div>
              </div>
            )) : <div className="muted">No leads</div>}
          </div>
        </Card>

        <Card className="dashboard-mobile-section">
          <div className="dashboard-mobile-section-head">
            <h3>Financial Overview</h3>
          </div>
          <div className="metric-list">
            <div><span>Income</span><strong>${data.income}</strong></div>
            <div><span>Expense</span><strong>${data.expense}</strong></div>
            <div><span>Net</span><strong>${data.income - data.expense}</strong></div>
          </div>
        </Card>

      </div>

      <div className="two-col desktop-only">
        <Card>
          <h3>Upcoming Tasks</h3>
          <Table>
            <thead>
              <tr><th>Task</th><th>Date</th><th>Client</th></tr>
            </thead>
            <tbody>
              {data.tasks.map(task => (
                <tr key={task.id}>
                  <td>{task.title}</td>
                  <td>{new Date(task.date).toLocaleString()}</td>
                  <td>{task.client?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <h3>Latest Website Leads</h3>
          <Table>
            <thead>
              <tr><th>Name</th><th>Source</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.leads.map(lead => (
                <tr key={lead.id}>
                  <td>{lead.name}</td>
                  <td>{lead.source}</td>
                  <td>{lead.status}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="two-col desktop-only">
        <Card>
          <h3>Financial Overview</h3>
          <div className="metric-list">
            <div><span>Income</span><strong>${data.income}</strong></div>
            <div><span>Expense</span><strong>${data.expense}</strong></div>
            <div><span>Net</span><strong>${data.income - data.expense}</strong></div>
          </div>
        </Card>

        <Card>
          <h3>Notifications</h3>
          <div className="list-stack">
            {data.notifications.map(n => (
              <div key={n.id} className="inline-item">
                <strong>{n.title}</strong>
                <span className="muted">{n.message}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
