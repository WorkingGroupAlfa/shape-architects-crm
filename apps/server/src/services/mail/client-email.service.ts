import { prisma } from '../../lib/prisma.js';

export function normalizeClientEmail(value?: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export async function listActiveClientEmails(clientId: string) {
  return prisma.clientContactEmail.findMany({
    where: { clientId, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      isPrimary: true,
      isActive: true
    }
  });
}

export async function findClientContactEmailByAddress(clientId: string, email: string) {
  const normalized = normalizeClientEmail(email);
  if (!normalized) return null;
  return prisma.clientContactEmail.findFirst({
    where: {
      clientId,
      isActive: true,
      emailNormalized: normalized
    },
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      isPrimary: true
    }
  });
}

