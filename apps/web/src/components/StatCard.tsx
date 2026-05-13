import { ReactNode } from 'react';
import { Card } from './Card';

export function StatCard({ label, value, hint, icon }: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="stat-card">
      <div className="stat-top">
        <span className="muted">{label}</span>
        <span>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="muted small">{hint}</div> : null}
    </Card>
  );
}
