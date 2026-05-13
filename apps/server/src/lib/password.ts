import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEY_LEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEY_LEN);
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(stored, derived);
}
