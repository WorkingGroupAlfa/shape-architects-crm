import { env } from '../../lib/env.js';
import { runDueCampaignSubscriptions } from './campaign-execution.service.js';

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerTickRunning = false;

export function startCampaignScheduler() {
  if (!env.MAIL_CAMPAIGN_SCHEDULER_ENABLED) {
    console.log('[mail-campaign] scheduler disabled');
    return;
  }

  if (schedulerTimer) return;

  const intervalMs = Math.max(15_000, env.MAIL_CAMPAIGN_INTERVAL_MS);
  console.log(`[mail-campaign] scheduler started (interval=${intervalMs}ms)`);

  schedulerTimer = setInterval(async () => {
    if (schedulerTickRunning) return;
    schedulerTickRunning = true;

    try {
      const result = await runDueCampaignSubscriptions();
      if (result.processed > 0) {
        console.log(`[mail-campaign] processed=${result.processed}`);
      }
    } catch (error) {
      console.error('[mail-campaign] scheduler tick failed', error);
    } finally {
      schedulerTickRunning = false;
    }
  }, intervalMs);
}

export function stopCampaignScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}
