import { prisma } from '../lib/prisma.js';
import { nextClientNumber } from '../lib/numbering.js';
import { logActivity } from '../lib/activity.js';

export async function intakeLead(input: {
  source: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  createClient?: boolean;
  dedupeByContact?: boolean;
  additionalNotes?: string;
}) {
  const normalizedEmail = input.email?.trim().toLowerCase() || undefined;
  const normalizedPhone = normalizePhone(input.phone);

  const lead = await prisma.lead.create({
    data: {
      source: input.source,
      name: input.name,
      email: normalizedEmail,
      phone: normalizedPhone,
      company: input.company,
      message: input.message
    }
  });

  let client = null;
  let createdClient = false;

  if (input.createClient) {
    if (input.dedupeByContact && (normalizedEmail || normalizedPhone)) {
      client = await prisma.client.findFirst({
        where: {
          OR: [
            ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
            ...(normalizedPhone ? [{ phone: normalizedPhone }, { phone: input.phone }] : [])
          ]
        }
      });
    }

    const defaultStatus = await prisma.clientStatus.upsert({
      where: { key: 'target' },
      update: {},
      create: {
        key: 'target',
        label: 'Target',
        isSystem: true
      }
    });

    if (client) {
      const existingNotes = client.notes?.trim();
      const incomingNotes = input.additionalNotes?.trim();
      await prisma.client.update({
        where: { id: client.id },
        data: {
          name: client.name || input.name,
          email: client.email ?? normalizedEmail,
          phone: client.phone ?? normalizedPhone,
          company: client.company ?? input.company,
          leadSource: client.leadSource || input.source,
          notes: incomingNotes
            ? [existingNotes, incomingNotes].filter(Boolean).join('\n\n')
            : client.notes
        }
      });
    } else {
      client = await prisma.client.create({
        data: {
          clientNumber: await nextClientNumber(),
          name: input.name,
          email: normalizedEmail,
          phone: normalizedPhone,
          company: input.company,
          leadSource: input.source,
          statusId: defaultStatus.id,
          notes: input.additionalNotes
        }
      });
      createdClient = true;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: 'CONVERTED',
        clientId: client.id
      }
    });

    await logActivity({
      entityType: 'lead',
      entityId: lead.id,
      action: 'converted',
      message: `Lead converted to client ${client.clientNumber}`,
      clientId: client.id
    });
  }

  return { lead, client, createdClient };
}

function normalizePhone(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return undefined;
  return hasPlus ? `+${digits}` : digits;
}
