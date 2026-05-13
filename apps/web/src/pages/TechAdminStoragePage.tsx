import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api } from '../lib/api';

type Bucket = {
  count: number;
  bytes: number;
  mb: number;
};

type StorageResponse = {
  entities: {
    clients: number;
    projects: number;
    users: number;
  };
  storage: {
    uploadsDirectory: { path: string; bytes: number; mb: number };
    database: { path: string | null; bytes: number; mb: number };
    logicalBuckets: {
      clientFiles: Bucket;
      projectFiles: Bucket;
      invoiceFiles: Bucket;
      emailAttachments: Bucket;
    };
    totalLogicalFiles: {
      bytes: number;
      mb: number;
    };
  };
};

export function TechAdminStoragePage() {
  const { data } = useQuery({
    queryKey: ['tech-admin-storage'],
    queryFn: () => api.get<StorageResponse>('/tech-admin/storage'),
    refetchInterval: 15000
  });

  if (!data) return <div className="skeleton-page" />;

  const buckets = data.storage.logicalBuckets;

  return (
    <div className="page-grid tech-admin-page">
      <Card>
        <h2>Storage Usage (MB)</h2>
        <div className="metric-list">
          <div><span>Uploads directory</span><strong>{data.storage.uploadsDirectory.mb} MB</strong></div>
          <div><span>Database file</span><strong>{data.storage.database.mb} MB</strong></div>
          <div><span>Client files</span><strong>{buckets.clientFiles.mb} MB</strong></div>
          <div><span>Project files</span><strong>{buckets.projectFiles.mb} MB</strong></div>
          <div><span>Invoice files</span><strong>{buckets.invoiceFiles.mb} MB</strong></div>
          <div><span>Email attachments</span><strong>{buckets.emailAttachments.mb} MB</strong></div>
          <div><span>Total logical files</span><strong>{data.storage.totalLogicalFiles.mb} MB</strong></div>
        </div>
      </Card>

      <Card>
        <h2>Entity Counters</h2>
        <div className="metric-list">
          <div><span>Clients</span><strong>{data.entities.clients}</strong></div>
          <div><span>Projects</span><strong>{data.entities.projects}</strong></div>
          <div><span>Users</span><strong>{data.entities.users}</strong></div>
          <div><span>Client file records</span><strong>{buckets.clientFiles.count}</strong></div>
          <div><span>Project file records</span><strong>{buckets.projectFiles.count}</strong></div>
          <div><span>Invoice file records</span><strong>{buckets.invoiceFiles.count}</strong></div>
        </div>
      </Card>
    </div>
  );
}

