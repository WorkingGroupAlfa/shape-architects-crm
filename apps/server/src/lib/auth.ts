import { createHmac } from 'node:crypto';

export type AppRole = 'ADMIN' | 'EMPLOYEE' | 'TECH_ADMIN';

export type AuthTokenPayload = {
  userId: string;
  role: AppRole;
  exp: number;
};

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const toBase64Url = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64url');

const fromBase64Url = (value: string) =>
  Buffer.from(value, 'base64url').toString('utf8');

function sign(data: string, secret: string) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createAuthToken(input: { userId: string; role: AppRole; secret: string }) {
  const payload: AuthTokenPayload = {
    userId: input.userId,
    role: input.role,
    exp: Date.now() + TOKEN_TTL_MS
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, input.secret)}`;
}

export function parseAuthToken(token: string, secret: string): AuthTokenPayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  if (sign(encoded, secret) !== signature) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as Partial<AuthTokenPayload>;
    if (!payload.userId || !payload.role || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    if (payload.role !== 'ADMIN' && payload.role !== 'EMPLOYEE' && payload.role !== 'TECH_ADMIN') return null;
    return payload as AuthTokenPayload;
  } catch {
    return null;
  }
}
