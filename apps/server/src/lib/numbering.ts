import { prisma } from './prisma.js';

function yyNow() {
  return String(new Date().getFullYear()).slice(-2);
}

function parseClientSeq(clientNumber: string): number | null {
  const modern = clientNumber.match(/^0(\d+)\d{2}001$/);
  if (modern) return Number(modern[1]);

  const legacy = clientNumber.match(/^CL-(\d+)$/);
  if (legacy) return Number(legacy[1]);

  return null;
}

function parseClientYear(clientNumber: string): string | null {
  const modern = clientNumber.match(/^0\d+(\d{2})001$/);
  if (modern) return modern[1];
  return null;
}

export async function nextClientNumber() {
  const all = await prisma.client.findMany({ select: { clientNumber: true } });
  const maxSeq = all.reduce((max, item) => {
    const seq = parseClientSeq(item.clientNumber);
    if (seq === null || Number.isNaN(seq)) return max;
    return Math.max(max, seq);
  }, 0);

  const nextSeq = maxSeq + 1;
  return `0${nextSeq}${yyNow()}001`;
}

export async function nextProjectNumber() {
  const count = await prisma.project.count();
  return `INT-${String(count + 1).padStart(5, '0')}`;
}

export async function nextInvoiceNumberForClient(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { clientNumber: true }
  });
  if (!client) throw new Error('Client not found for invoice numbering');

  const seq = parseClientSeq(client.clientNumber);
  if (seq === null || Number.isNaN(seq)) {
    // Manual/custom client number: use it directly as invoice number.
    return client.clientNumber;
  }

  const yy = parseClientYear(client.clientNumber) ?? yyNow();
  const prefix = `0${seq}${yy}`;

  const projects = await prisma.project.findMany({
    where: { clientId, invoiceNumber: { not: null } },
    select: { invoiceNumber: true }
  });

  const maxSuffix = projects.reduce((max, item) => {
    if (!item.invoiceNumber) return max;
    const m = item.invoiceNumber.match(new RegExp(`^${prefix}(\\d{3})$`));
    if (!m) return max;
    return Math.max(max, Number(m[1]));
  }, 0);

  const nextSuffix = String(maxSuffix + 1).padStart(3, '0');
  return `${prefix}${nextSuffix}`;
}
