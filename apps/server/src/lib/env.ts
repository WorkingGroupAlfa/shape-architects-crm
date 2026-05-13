const numberOr = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  PORT: numberOr(process.env.PORT, 4310),
  DATABASE_URL: process.env.DATABASE_URL ?? 'file:./dev.db',
  CORS_ORIGINS:
    process.env.CORS_ORIGINS ??
    'http://localhost:5173,http://localhost:4173',
  STORAGE_DIR: process.env.STORAGE_DIR ?? './storage/uploads',
  XAI_API_KEY: process.env.XAI_API_KEY ?? '',
  XAI_MODEL: process.env.XAI_MODEL ?? 'grok-3-latest',
  XAI_API_URL: process.env.XAI_API_URL ?? 'https://api.x.ai/v1/chat/completions',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  OPENAI_API_URL: process.env.OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions',
  PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY ?? '',
  PERPLEXITY_MODEL: process.env.PERPLEXITY_MODEL ?? 'sonar',
  PERPLEXITY_API_URL: process.env.PERPLEXITY_API_URL ?? 'https://api.perplexity.ai/chat/completions',
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'dev-auth-secret-change-me',
  TECH_ADMIN_LOGIN: process.env.TECH_ADMIN_LOGIN ?? 'shape-tech',
  TECH_ADMIN_PASSWORD: process.env.TECH_ADMIN_PASSWORD ?? 'change-me',
  MAIL_PROVIDER: process.env.MAIL_PROVIDER ?? '',
  MAIL_FROM: process.env.MAIL_FROM ?? '',
  MAIL_SYNC_ENABLED: (process.env.MAIL_SYNC_ENABLED ?? 'false').toLowerCase() === 'true',
  MAIL_SYNC_INTERVAL_MS: numberOr(process.env.MAIL_SYNC_INTERVAL_MS, 45000),
  MAIL_CAMPAIGN_SCHEDULER_ENABLED: (process.env.MAIL_CAMPAIGN_SCHEDULER_ENABLED ?? 'false').toLowerCase() === 'true',
  MAIL_CAMPAIGN_INTERVAL_MS: numberOr(process.env.MAIL_CAMPAIGN_INTERVAL_MS, 60000),
  AUTOMATION_SYNC_ENABLED: (process.env.AUTOMATION_SYNC_ENABLED ?? 'false').toLowerCase() === 'true',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN ?? ''
};
