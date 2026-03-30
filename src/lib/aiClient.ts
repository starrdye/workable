/**
 * aiClient.ts — provider-agnostic AI text generation.
 * Supports: Anthropic (Claude), Google (Gemini), ByteDance (Doubao).
 *
 * Track 4b: Retry + exponential backoff (1s/2s/4s, up to 3 retries).
 *           Non-retryable: 400, 401, 422.
 * Track 4e: Returns token usage alongside text when provider exposes it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AIProvider = 'anthropic' | 'gemini' | 'doubao';

export interface AIProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// ── Provider / model catalogue ─────────────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

export interface ProviderMeta {
  id: AIProvider;
  name: string;
  label: string;           // short branding label
  keyPlaceholder: string;
  keyHint: string;
  color: string;           // Tailwind color class stem (e.g. "indigo")
  models: ModelOption[];
  defaultModel: string;
  /** When true, the model field is a free-text endpoint/deployment ID, not a list choice */
  usesEndpointId?: boolean;
  endpointPlaceholder?: string;
  endpointHint?: string;
  /** Default base URL for API calls; user can override in AI Settings */
  defaultBaseUrl?: string;
  baseUrlPlaceholder?: string;
  baseUrlHint?: string;
  /**
   * Coding-plan variant (Doubao only):
   * When the user selects "Coding Plan" billing, the base URL switches to
   * codingPlanBaseUrl and model is picked from codingPlanModels instead of
   * a free-text endpoint ID.
   */
  codingPlanBaseUrl?: string;
  codingPlanModels?: ModelOption[];
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    label: 'Claude',
    keyPlaceholder: 'sk-ant-api03-…',
    keyHint: 'Get a key at console.anthropic.com',
    color: 'indigo',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-6',          label: 'Claude Opus 4.6',    description: 'Most capable — best for complex workflows'  },
      { id: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6',  description: 'Balanced speed & quality (recommended)'     },
      { id: 'claude-haiku-4-5-20251001',label: 'Claude Haiku 4.5',   description: 'Fastest & most cost-efficient'              },
    ],
  },
  {
    id: 'gemini',
    name: 'Google',
    label: 'Gemini',
    keyPlaceholder: 'AIzaSy…',
    keyHint: 'Get a key at aistudio.google.com',
    color: 'blue',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash',   description: 'Latest model — fast & multimodal'           },
      { id: 'gemini-1.5-pro',     label: 'Gemini 1.5 Pro',     description: 'Long context, deep reasoning'               },
      { id: 'gemini-1.5-flash',   label: 'Gemini 1.5 Flash',   description: 'Quick responses, cost-efficient'            },
    ],
  },
  {
    id: 'doubao',
    name: 'ByteDance',
    label: 'Doubao',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    keyHint: 'Get a key at console.volcengine.com/ark → API Keys',
    color: 'violet',
    // Standard (pay-per-use): requires an ep-xxx endpoint ID
    usesEndpointId: true,
    endpointPlaceholder: 'ep-xxxxxxxxxxxxxxxx-xxxxx',
    endpointHint: 'Create an endpoint at console.volcengine.com/ark → Online Inference, then copy its ID.',
    defaultModel: '',
    models: [],
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    baseUrlPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
    baseUrlHint: 'Standard pay-per-use base URL. Switch to Coding Plan above to use /api/coding/v3.',
    // Coding plan: uses /api/coding/v3 and a direct model name (no endpoint ID needed)
    codingPlanBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    codingPlanModels: [
      { id: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite', description: 'Fast & cost-efficient — recommended for coding plan' },
      { id: 'doubao-seed-2.0',      label: 'Doubao Seed 2.0',      description: 'Full reasoning model — higher quality'              },
      { id: 'doubao-pro-32k',       label: 'Doubao Pro 32K',       description: '32K context window — long documents'               },
      { id: 'doubao-lite-32k',      label: 'Doubao Lite 32K',      description: '32K context — lighter & faster'                    },
    ],
  },
];

export function getProviderMeta(provider: AIProvider): ProviderMeta {
  return PROVIDERS.find((p) => p.id === provider)!;
}

// ── Token usage ─────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens:  number;
  outputTokens: number;
}

export interface GenerateResult {
  text:  string;
  usage: TokenUsage | null;
}

// ── Retry helper (Track 4b) ────────────────────────────────────────────────

const NON_RETRYABLE_PATTERNS = ['401', '400', '422', 'invalid_api_key', 'authentication', 'AuthenticationError', 'Unauthorized'];

function isNonRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return NON_RETRYABLE_PATTERNS.some(p => msg.includes(p.toLowerCase()));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isNonRetryable(err)) throw err; // don't retry auth/validation errors
      if (attempt < maxAttempts - 1) {
        await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt))); // 1s, 2s, 4s
      }
    }
  }
  throw lastError;
}

// ── Unified generation ─────────────────────────────────────────────────────

export async function generateText(options: {
  provider: AIProvider;
  model: string;
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  baseUrl?: string;
}): Promise<GenerateResult> {
  const { provider, model, apiKey, systemPrompt, userMessage, maxTokens = 2048, baseUrl } = options;

  // ── Anthropic ─────────────────────────────────────────────────────────────
  if (provider === 'anthropic') {
    return withRetry(async () => {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const content = response.content[0];
      if (content.type !== 'text') throw new Error('Unexpected response type from Anthropic.');
      const usage: TokenUsage = {
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      return { text: content.text, usage };
    });
  }

  // ── Google Gemini ─────────────────────────────────────────────────────────
  if (provider === 'gemini') {
    return withRetry(async () => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
      });
      const result = await geminiModel.generateContent(userMessage);
      const meta = result.response.usageMetadata;
      const usage: TokenUsage | null = meta
        ? { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
        : null;
      return { text: result.response.text(), usage };
    });
  }

  // ── Doubao (ByteDance Ark — OpenAI-compatible) ────────────────────────────
  if (provider === 'doubao') {
    return withRetry(async () => {
      const doubaoBase = (baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
      const res = await fetch(`${doubaoBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage  },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw new Error(`Doubao API error ${res.status}: ${err}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from Doubao.');
      const u = data?.usage;
      const usage: TokenUsage | null = u
        ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 }
        : null;
      return { text: text as string, usage };
    });
  }

  throw new Error(`Unsupported AI provider: "${provider}"`);
}

// ── Streaming generation (Track 14d) ─────────────────────────────────────────
//
// Streams raw AI text chunks to an SSE-style WritableStream controller.
// Used by the /api/ai/optimize streaming path.
//
// Only Anthropic supports native token-by-token streaming.
// Gemini and Doubao fall back to a single "pseudo-chunk" (generates fully
// then sends the whole text as one chunk) so the SSE protocol is identical.

export interface StreamOptions {
  provider:     AIProvider;
  model:        string;
  apiKey:       string;
  systemPrompt: string;
  userMessage:  string;
  maxTokens?:   number;
  baseUrl?:     string;
}

export interface StreamWriter {
  /** Called for each text chunk as it arrives */
  onChunk: (chunk: string) => void;
}

/**
 * Stream AI text to `writer.onChunk`, then return the accumulated full text
 * and token usage once the stream is complete.
 *
 * For providers that do not support native streaming (Gemini, Doubao),
 * `onChunk` is called once with the complete text.
 */
export async function streamText(
  options: StreamOptions,
  writer: StreamWriter,
): Promise<GenerateResult> {
  const { provider, model, apiKey, systemPrompt, userMessage, maxTokens = 5000, baseUrl } = options;

  // ── Anthropic (native streaming) ──────────────────────────────────────────
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    });

    let fullText = '';
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const chunk = event.delta.text;
        fullText   += chunk;
        writer.onChunk(chunk);
      }
    }

    const finalMessage = await stream.finalMessage();
    const usage: TokenUsage = {
      inputTokens:  finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };
    return { text: fullText, usage };
  }

  // ── Gemini / Doubao — pseudo-streaming (single chunk) ────────────────────
  const result = await generateText({
    provider, model, apiKey, systemPrompt, userMessage, maxTokens, baseUrl,
  });
  writer.onChunk(result.text);
  return result;
}
