import type { EmailCampaignSubscription } from '@prisma/client';

type SubscriptionScheduleInput = Pick<EmailCampaignSubscription, 'frequency' | 'sendDayOfWeek' | 'sendDayOfMonth' | 'sendTime' | 'timezone'>;

const DEFAULT_TIME = '09:00';
const DEFAULT_TZ = 'UTC';

export function calculateNextRunAt(input: SubscriptionScheduleInput, fromDate: Date = new Date()) {
  const timezone = normalizeTimeZone(input.timezone);
  const time = parseTime(input.sendTime || DEFAULT_TIME);
  if (!time) return null;

  const baseLocal = getLocalDateParts(fromDate, timezone);

  for (let offsetDays = 0; offsetDays <= 400; offsetDays += 1) {
    const dateParts = addDays(baseLocal.year, baseLocal.month, baseLocal.day, offsetDays);

    if (input.frequency === 'weekly') {
      const targetDow = typeof input.sendDayOfWeek === 'number' ? input.sendDayOfWeek : weekday(dateParts.year, dateParts.month, dateParts.day);
      if (weekday(dateParts.year, dateParts.month, dateParts.day) !== targetDow) continue;
    } else if (input.frequency === 'monthly') {
      const configuredDay = Math.max(1, Math.min(31, input.sendDayOfMonth ?? dateParts.day));
      const monthLastDay = daysInMonth(dateParts.year, dateParts.month);
      const scheduledDay = Math.min(configuredDay, monthLastDay);
      if (dateParts.day !== scheduledDay) continue;
    }

    const candidate = zonedTimeToUtc(
      timezone,
      dateParts.year,
      dateParts.month,
      dateParts.day,
      time.hour,
      time.minute
    );

    if (candidate.getTime() > fromDate.getTime()) {
      return candidate;
    }
  }

  return null;
}

export function failureCooldownDate(fromDate: Date = new Date(), minutes = 15) {
  return new Date(fromDate.getTime() + minutes * 60_000);
}

function parseTime(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeTimeZone(value?: string | null) {
  const tz = (value || '').trim();
  if (!tz) return DEFAULT_TZ;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function getLocalDateParts(date: Date, timeZone: string) {
  const parts = getParts(date, timeZone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function getParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function zonedTimeToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number) {
  let utcMillis = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getOffsetMinutes(new Date(utcMillis), timeZone);
    const adjusted = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000;
    if (adjusted === utcMillis) break;
    utcMillis = adjusted;
  }

  return new Date(utcMillis);
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const parts = getParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60_000;
}

function addDays(year: number, month: number, day: number, deltaDays: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function weekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
