import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { CampaignRun, CampaignSubscription, TemplateOption } from './types';
import type { ReactNode } from 'react';

type CampaignFormState = {
  templateId: string;
  isActive: boolean;
  sendDayOfWeek: number | null;
  sendDayOfMonth: number | null;
  sendTime: string;
  timezone: string;
  threadStrategy: 'new_each_run' | 'continue_last_thread';
  nextRunAt: string;
};

type Props = {
  clientId: string;
  templates: TemplateOption[];
};

function emptyForm(): CampaignFormState {
  return {
    templateId: '',
    isActive: false,
    sendDayOfWeek: null,
    sendDayOfMonth: null,
    sendTime: '09:00',
    timezone: 'Australia/Adelaide',
    threadStrategy: 'new_each_run',
    nextRunAt: ''
  };
}

function mapSubscriptionToForm(subscription?: CampaignSubscription): CampaignFormState {
  if (!subscription) return emptyForm();
  return {
    templateId: subscription.templateId,
    isActive: subscription.isActive,
    sendDayOfWeek: subscription.sendDayOfWeek ?? null,
    sendDayOfMonth: subscription.sendDayOfMonth ?? null,
    sendTime: subscription.sendTime ?? '09:00',
    timezone: subscription.timezone ?? 'Australia/Adelaide',
    threadStrategy:
      subscription.threadStrategy === 'continue_last_thread' ? 'continue_last_thread' : 'new_each_run',
    nextRunAt: subscription.nextRunAt ? subscription.nextRunAt.slice(0, 16) : ''
  };
}

function FrequencyCard(props: {
  title: string;
  frequency: 'weekly' | 'monthly';
  form: CampaignFormState;
  templates: TemplateOption[];
  onChange: (next: CampaignFormState) => void;
  onSave: () => void;
  onRunNow: () => void;
  isRunningNow: boolean;
  isSaving: boolean;
  subscription?: CampaignSubscription;
}) {
  return (
    <CardSection title={props.title}>
      <div className="mail-inline-grid">
        <label className="info-field">
          <span className="muted small">Template</span>
          <select
            className="input"
            value={props.form.templateId}
            onChange={event => props.onChange({ ...props.form, templateId: event.target.value })}
          >
            <option value="">Select template</option>
            {props.templates.map(template => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>
        <label className="info-field">
          <span className="muted small">Thread strategy</span>
          <select
            className="input"
            value={props.form.threadStrategy}
            onChange={event => props.onChange({ ...props.form, threadStrategy: event.target.value as CampaignFormState['threadStrategy'] })}
          >
            <option value="new_each_run">new_each_run</option>
            <option value="continue_last_thread">continue_last_thread</option>
          </select>
        </label>
      </div>

      <div className="mail-inline-grid">
        {props.frequency === 'weekly' ? (
          <label className="info-field">
            <span className="muted small">Day of week (0-6)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={6}
              value={props.form.sendDayOfWeek ?? ''}
              onChange={event => props.onChange({ ...props.form, sendDayOfWeek: event.target.value ? Number(event.target.value) : null })}
            />
          </label>
        ) : (
          <label className="info-field">
            <span className="muted small">Day of month (1-31)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={31}
              value={props.form.sendDayOfMonth ?? ''}
              onChange={event => props.onChange({ ...props.form, sendDayOfMonth: event.target.value ? Number(event.target.value) : null })}
            />
          </label>
        )}

        <label className="info-field">
          <span className="muted small">Time</span>
          <input className="input" type="time" value={props.form.sendTime} onChange={event => props.onChange({ ...props.form, sendTime: event.target.value })} />
        </label>
      </div>

      <div className="mail-inline-grid">
        <label className="info-field">
          <span className="muted small">Timezone</span>
          <input className="input" value={props.form.timezone} onChange={event => props.onChange({ ...props.form, timezone: event.target.value })} />
        </label>

        <label className="info-field">
          <span className="muted small">Next run (optional)</span>
          <input
            className="input"
            type="datetime-local"
            value={props.form.nextRunAt}
            onChange={event => props.onChange({ ...props.form, nextRunAt: event.target.value })}
          />
        </label>
      </div>

      <label className="mail-checkbox-row">
        <input type="checkbox" checked={props.form.isActive} onChange={event => props.onChange({ ...props.form, isActive: event.target.checked })} />
        <span>Enabled</span>
      </label>

      <div className="mail-campaign-meta">
        <span>Last run: {props.subscription?.lastRunAt ? new Date(props.subscription.lastRunAt).toLocaleString() : '-'}</span>
        <span>Next run: {props.subscription?.nextRunAt ? new Date(props.subscription.nextRunAt).toLocaleString() : '-'}</span>
        <span>Status: {props.subscription?.isProcessing ? 'Processing' : 'Idle'}</span>
        {props.subscription?.lastErrorText ? <span>Last error: {props.subscription.lastErrorText}</span> : null}
      </div>

      <div className="inline-actions">
        <button
          className="primary-btn"
          type="button"
          onClick={props.onSave}
          disabled={props.isSaving || !props.form.templateId}
        >
          {props.isSaving ? 'Saving...' : 'Save subscription'}
        </button>
        <button
          className="ghost-btn"
          type="button"
          onClick={props.onRunNow}
          disabled={props.isRunningNow || !props.subscription?.id}
        >
          {props.isRunningNow ? 'Running...' : 'Run now'}
        </button>
      </div>
    </CardSection>
  );
}

function CardSection(props: { title: string; children: ReactNode }) {
  return (
    <div className="mail-campaign-card">
      <h4>{props.title}</h4>
      <div className="form-stack">{props.children}</div>
    </div>
  );
}

export function CampaignsPanel(props: Props) {
  const queryClient = useQueryClient();
  const campaignsQuery = useQuery({
    queryKey: ['mail-campaigns', props.clientId],
    queryFn: () => api.get<CampaignSubscription[]>(`/mail/clients/${props.clientId}/campaigns`)
  });

  const runsQuery = useQuery({
    queryKey: ['mail-campaign-runs', props.clientId],
    queryFn: () => api.get<CampaignRun[]>(`/mail/clients/${props.clientId}/campaign-runs`)
  });

  const weeklySubscription = useMemo(
    () => campaignsQuery.data?.find(item => item.frequency === 'weekly'),
    [campaignsQuery.data]
  );
  const monthlySubscription = useMemo(
    () => campaignsQuery.data?.find(item => item.frequency === 'monthly'),
    [campaignsQuery.data]
  );

  const [weeklyForm, setWeeklyForm] = useState<CampaignFormState>(emptyForm());
  const [monthlyForm, setMonthlyForm] = useState<CampaignFormState>(emptyForm());

  useEffect(() => {
    setWeeklyForm(mapSubscriptionToForm(weeklySubscription));
    setMonthlyForm(mapSubscriptionToForm(monthlySubscription));
  }, [weeklySubscription, monthlySubscription]);

  const saveMutation = useMutation({
    mutationFn: ({ frequency, form }: { frequency: 'weekly' | 'monthly'; form: CampaignFormState }) =>
      api.put<CampaignSubscription>(`/mail/clients/${props.clientId}/campaigns/${frequency}`, {
        templateId: form.templateId,
        isActive: form.isActive,
        sendDayOfWeek: form.sendDayOfWeek,
        sendDayOfMonth: form.sendDayOfMonth,
        sendTime: form.sendTime,
        timezone: form.timezone,
        threadStrategy: form.threadStrategy,
        nextRunAt: form.nextRunAt ? new Date(form.nextRunAt).toISOString() : null
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-campaigns', props.clientId] });
      queryClient.invalidateQueries({ queryKey: ['mail-campaign-runs', props.clientId] });
    }
  });

  const runNowMutation = useMutation({
    mutationFn: (subscriptionId: string) => api.post(`/mail/campaigns/${subscriptionId}/run-now`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-campaigns', props.clientId] });
      queryClient.invalidateQueries({ queryKey: ['mail-campaign-runs', props.clientId] });
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads', props.clientId] });
    }
  });

  return (
    <div className="mail-campaigns-layout">
      <FrequencyCard
        title="Weekly Campaign"
        frequency="weekly"
        form={weeklyForm}
        templates={props.templates}
        onChange={setWeeklyForm}
        onSave={() => saveMutation.mutate({ frequency: 'weekly', form: weeklyForm })}
        onRunNow={() => {
          if (!weeklySubscription?.id) return;
          runNowMutation.mutate(weeklySubscription.id);
        }}
        isRunningNow={runNowMutation.isPending}
        isSaving={saveMutation.isPending}
        subscription={weeklySubscription}
      />

      <FrequencyCard
        title="Monthly Campaign"
        frequency="monthly"
        form={monthlyForm}
        templates={props.templates}
        onChange={setMonthlyForm}
        onSave={() => saveMutation.mutate({ frequency: 'monthly', form: monthlyForm })}
        onRunNow={() => {
          if (!monthlySubscription?.id) return;
          runNowMutation.mutate(monthlySubscription.id);
        }}
        isRunningNow={runNowMutation.isPending}
        isSaving={saveMutation.isPending}
        subscription={monthlySubscription}
      />

      <div className="mail-campaign-runs card">
        <h4>Campaign Run History</h4>
        {runsQuery.isLoading ? <div className="mail-placeholder">Loading run history...</div> : null}
        {runsQuery.isError ? <div className="mail-placeholder error">Failed to load run history.</div> : null}
        {!runsQuery.isLoading && !runsQuery.isError && (runsQuery.data?.length ?? 0) === 0 ? (
          <div className="mail-placeholder">No campaign runs yet.</div>
        ) : null}
        <div className="list-stack">
          {runsQuery.data?.map(run => (
            <div key={run.id} className="inline-item">
              <strong>{run.subscription?.frequency || 'campaign'} | {run.status}</strong>
              <span className="muted small">{new Date(run.triggeredAt).toLocaleString()} {run.thread?.subject ? `| ${run.thread.subject}` : ''}</span>
              {run.errorText ? <span className="muted small">{run.errorText}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
