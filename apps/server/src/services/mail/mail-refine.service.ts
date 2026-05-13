import { env } from '../../lib/env.js';

export type RefineDraftTone = 'professional' | 'friendly' | 'concise';
export type RefineDraftMode = 'keep_meaning' | 'fix_grammar_only';

export type RefineDraftInput = {
  draft: string;
  tone: RefineDraftTone;
  mode: RefineDraftMode;
  threadContext?: {
    subject?: string;
    lastMessageSnippet?: string;
  };
  clientContext?: {
    name?: string;
    email?: string;
    company?: string;
  };
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

export async function refineMailDraft(input: RefineDraftInput) {
  const apiKey = env.OPENAI_API_KEY.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const apiUrl = env.OPENAI_API_URL.trim() || 'https://api.openai.com/v1/chat/completions';
  const model = env.OPENAI_MODEL.trim() || 'gpt-4.1-mini';
  const draft = input.draft.trim();
  if (!draft) throw new Error('Draft is required');

  const prompt = buildRefinePrompt(input, draft);
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: input.mode === 'fix_grammar_only' ? 0.05 : 0.25,
      messages: [
        {
          role: 'system',
          content:
            'You refine email drafts. Keep output concise, readable, and business-appropriate. Return plain text only.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI refine failed: ${response.status} ${truncate(text, 300)}`);
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const refinedDraft = data.choices?.[0]?.message?.content?.trim();
  if (!refinedDraft) {
    throw new Error('OpenAI refine returned empty output');
  }

  return {
    refinedDraft,
    notes:
      input.mode === 'fix_grammar_only'
        ? 'Grammar and clarity corrected, meaning preserved.'
        : `Draft refined with ${input.tone} tone.`
  };
}

function buildRefinePrompt(input: RefineDraftInput, draft: string) {
  const toneInstruction =
    input.tone === 'friendly'
      ? 'Friendly and warm, still professional.'
      : input.tone === 'concise'
        ? 'Very concise and direct.'
        : 'Professional and clear.';

  const modeInstruction =
    input.mode === 'fix_grammar_only'
      ? 'Fix grammar, punctuation, and clarity only. Do not change intent, facts, or structure significantly.'
      : 'Preserve intent but improve clarity, flow, and readability.';

  const contextLines = [
    input.threadContext?.subject ? `Thread subject: ${input.threadContext.subject}` : null,
    input.threadContext?.lastMessageSnippet ? `Thread context: ${input.threadContext.lastMessageSnippet}` : null,
    input.clientContext?.name ? `Client name: ${input.clientContext.name}` : null,
    input.clientContext?.email ? `Client email: ${input.clientContext.email}` : null,
    input.clientContext?.company ? `Client company: ${input.clientContext.company}` : null
  ].filter(Boolean);

  return [
    'Refine this email draft.',
    `Tone: ${toneInstruction}`,
    `Mode: ${modeInstruction}`,
    contextLines.length ? `Context:\n${contextLines.join('\n')}` : null,
    '',
    'Return only the refined message body text. Do not add explanations.',
    '',
    'Draft:',
    draft
  ]
    .filter(Boolean)
    .join('\n');
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
