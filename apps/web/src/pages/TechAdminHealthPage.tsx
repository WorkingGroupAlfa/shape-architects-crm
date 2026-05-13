import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api } from '../lib/api';

type HealthResponse = {
  ok: boolean;
  checkedAt: string;
  uptimeSeconds: number;
  database: {
    ok: boolean;
    latencyMs: number;
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    pid: number;
  };
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
    externalMb: number;
  };
};

const toUptime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
};

export function TechAdminHealthPage() {
  const { data } = useQuery({
    queryKey: ['tech-admin-health'],
    queryFn: () => api.get<HealthResponse>('/tech-admin/health'),
    refetchInterval: 5000
  });

  if (!data) return <div className="skeleton-page" />;

  return (
    <div className="page-grid tech-admin-page">
      <Card>
        <h2>Service Health</h2>
        <div className="metric-list">
          <div>
            <span>Overall status</span>
            <strong className={data.ok ? 'tech-admin-health-ok' : 'tech-admin-health-fail'}>
              {data.ok ? 'HEALTHY' : 'DEGRADED'}
            </strong>
          </div>
          <div><span>Database</span><strong>{data.database.ok ? 'Connected' : 'Disconnected'}</strong></div>
          <div><span>DB latency</span><strong>{data.database.latencyMs} ms</strong></div>
          <div><span>Server uptime</span><strong>{toUptime(data.uptimeSeconds)}</strong></div>
          <div><span>Checked at</span><strong>{new Date(data.checkedAt).toLocaleString()}</strong></div>
        </div>
      </Card>

      <Card>
        <h2>Runtime</h2>
        <div className="metric-list">
          <div><span>Node version</span><strong>{data.runtime.nodeVersion}</strong></div>
          <div><span>Platform</span><strong>{data.runtime.platform}</strong></div>
          <div><span>PID</span><strong>{data.runtime.pid}</strong></div>
          <div><span>RSS memory</span><strong>{data.memory.rssMb} MB</strong></div>
          <div><span>Heap total</span><strong>{data.memory.heapTotalMb} MB</strong></div>
          <div><span>Heap used</span><strong>{data.memory.heapUsedMb} MB</strong></div>
          <div><span>External memory</span><strong>{data.memory.externalMb} MB</strong></div>
        </div>
      </Card>
    </div>
  );
}

