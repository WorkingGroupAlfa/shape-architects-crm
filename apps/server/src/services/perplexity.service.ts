import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';

type PerplexityChatResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

type ResearchRole = 'user' | 'assistant';

type ResearchMessageItem = {
  id: string;
  role: ResearchRole;
  content: string;
  createdAt: Date;
};

const prismaAny = prisma as any;

export async function generatePerplexitySummaryForClient(clientId: string, options?: { force?: boolean }) {
  const force = options?.force === true;
  const apiKey = resolveAiApiKey();
  const apiUrl = resolveAiApiUrl();
  const model = resolveAiModel();

  if (!apiKey) {
    await prisma.client.update({
      where: { id: clientId },
      data: { perplexityStatus: 'DISABLED' }
    });
    return { ok: false, reason: 'PERPLEXITY_API_KEY is not configured' as const };
  }

  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId }
    });

    if (!client) return { ok: false, reason: 'Client not found' as const };
    if (!force && client.perplexitySummary?.trim()) {
      return { ok: true as const, summary: client.perplexitySummary, skipped: true as const };
    }

    await prisma.client.update({
      where: { id: clientId },
      data: { perplexityStatus: 'PENDING' }
    });

    const userPrompt = buildUserPrompt(
      client.name ?? '-',
      client.email ?? '-',
      client.phone ?? '-',
      extractWebsite(client.notes) ?? '-'
    );
    const systemPrompt =
      'You are an OSINT research assistant. Produce factual, source-backed findings only. If evidence is weak, explicitly say Not found.';

    const summary = await requestPerplexityCompletion({
      apiKey,
      apiUrl,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    if (!summary) {
      throw new Error('Perplexity API returned empty summary');
    }

    await prisma.client.update({
      where: { id: client.id },
      data: {
        perplexitySummary: summary,
        perplexityStatus: 'READY',
        perplexityUpdatedAt: new Date()
      }
    });

    return { ok: true as const, summary, skipped: false as const };
  } catch (error) {
    await prisma.client.update({
      where: { id: clientId },
      data: { perplexityStatus: 'FAILED' }
    });
    throw error;
  }
}

export async function listPerplexityResearchMessages(clientId: string) {
  const items = await prismaAny.clientResearchMessage.findMany({
    where: { clientId },
    orderBy: { createdAt: 'asc' },
    take: 200
  });

  return items.map((item: any) => ({
    id: item.id,
    role: item.role as ResearchRole,
    content: item.content,
    createdAt: item.createdAt
  })) as ResearchMessageItem[];
}

export async function askPerplexityFollowupForClient(clientId: string, question: string) {
  const prompt = question.trim();
  if (prompt.length < 2) throw new Error('Question is too short');

  const apiKey = resolveAiApiKey();
  const apiUrl = resolveAiApiUrl();
  const model = resolveAiModel();

  if (!apiKey) throw new Error('PERPLEXITY_API_KEY is not configured');

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      company: true,
      notes: true,
      perplexitySummary: true
    }
  });

  if (!client) throw new Error('Client not found');

  await prisma.client.update({
    where: { id: client.id },
    data: { perplexityStatus: 'PENDING' }
  });

  const recentHistory = await prismaAny.clientResearchMessage.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    take: 12
  });

  const orderedHistoryRaw = [...recentHistory].reverse().map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content
  })) as Array<{ role: 'user' | 'assistant'; content: string }>;
  const orderedHistory = normalizeAlternatingMessages(orderedHistoryRaw);

  const contextBlock = [
    `Client name: ${client.name ?? '-'}`,
    `Company: ${client.company ?? '-'}`,
    `Email: ${client.email ?? '-'}`,
    `Phone: ${client.phone ?? '-'}`,
    `Website: ${extractWebsite(client.notes) ?? '-'}`,
    '',
    client.perplexitySummary?.trim()
      ? `Existing research summary:\n${client.perplexitySummary.trim()}`
      : 'Existing research summary: Not found'
  ].join('\n');

  const systemPrompt =
    'You are an OSINT research assistant. Answer with factual, source-backed findings only. If evidence is weak, explicitly say Not found.';

  const followUpPrompt = `Follow-up question:\n${prompt}`;
  const completionMessages = buildFollowupConversation(orderedHistory, followUpPrompt);

  const answer = await requestPerplexityCompletion({
    apiKey,
    apiUrl,
    model,
    systemPrompt,
    messages: completionMessages,
    contextBlock
  });

  if (!answer) {
    await prisma.client.update({
      where: { id: client.id },
      data: { perplexityStatus: 'FAILED' }
    });
    throw new Error('Perplexity API returned empty answer');
  }

  const now = new Date();
  const [questionMessage, answerMessage] = await prisma.$transaction([
    prismaAny.clientResearchMessage.create({
      data: {
        clientId: client.id,
        role: 'user',
        content: prompt
      }
    }),
    prismaAny.clientResearchMessage.create({
      data: {
        clientId: client.id,
        role: 'assistant',
        content: answer
      }
    })
  ]);

  await prisma.client.update({
    where: { id: client.id },
    data: {
      perplexityStatus: 'READY',
      perplexityUpdatedAt: now
    }
  });

  return {
    question: {
      id: questionMessage.id,
      role: 'user' as const,
      content: questionMessage.content,
      createdAt: questionMessage.createdAt
    },
    answer: {
      id: answerMessage.id,
      role: 'assistant' as const,
      content: answerMessage.content,
      createdAt: answerMessage.createdAt
    }
  };
}

function resolveAiApiKey() {
  return env.PERPLEXITY_API_KEY.trim();
}

function resolveAiApiUrl() {
  return env.PERPLEXITY_API_URL.trim();
}

function resolveAiModel() {
  return env.PERPLEXITY_MODEL.trim();
}

async function requestPerplexityCompletion(input: {
  apiKey: string;
  apiUrl: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contextBlock?: string;
}) {
  const systemContent = input.contextBlock?.trim()
    ? `${input.systemPrompt}\n\nClient context:\n${input.contextBlock.trim()}`
    : input.systemPrompt;

  const response = await fetch(input.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.1,
      messages: [{ role: 'system', content: systemContent }, ...input.messages]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Perplexity API failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as PerplexityChatResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

function extractWebsite(notes?: string | null) {
  if (!notes) return null;
  const match = notes.match(/Website:\s*(.+)/i);
  return match?.[1]?.trim() ?? null;
}

function buildUserPrompt(name: string, email: string, phone: string, website: string) {
  return [
    'Perform reasonably deep open-source research (OSINT-style) on this person and produce a factual report.',
    '',
    'Return in English with the exact sections below:',
    '1) Person bio',
    '2) Company profile',
    '3) Notable projects',
    '4) Evidence table',
    '5) Links / sources',
    '6) What could not be found',
    '',
    'Strict output rules:',
    '- Use web search and cite sources.',
    '- No generic advice, no sales recommendations, no speculation.',
    '- Every non-trivial claim must include at least one source URL.',
    '- If a claim has no reliable source, write: Not found.',
    '- Evidence table format: Claim | Source URL | Confidence (High/Medium/Low).',
    '',
    `Client name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Website: ${website}`
  ].join('\n');
}

function normalizeAlternatingMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
) {
  const normalized: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;

    if (!normalized.length) {
      if (message.role !== 'user') continue;
      normalized.push({ role: message.role, content });
      continue;
    }

    const last = normalized[normalized.length - 1];
    if (last.role === message.role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      normalized.push({ role: message.role, content });
    }
  }

  return normalized;
}

function buildFollowupConversation(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  followUpPrompt: string
) {
  const messages = [...history];
  if (!messages.length) {
    return [{ role: 'user' as const, content: followUpPrompt }];
  }

  const last = messages[messages.length - 1];
  if (last.role === 'user') {
    last.content = `${last.content}\n\n${followUpPrompt}`;
    return messages;
  }

  messages.push({ role: 'user' as const, content: followUpPrompt });
  return messages;
}
