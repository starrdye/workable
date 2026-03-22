/**
 * aiClient.ts — provider-agnostic AI text generation.
 * Supports: Anthropic (Claude), Google (Gemini), ByteDance (Doubao).
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
    // Ark API keys are UUIDs, e.g. d31cc9d6-7c3d-4f76-8a59-cac41c7eac4f
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    keyHint: 'Get a key at console.volcengine.com/ark → API Keys',
    color: 'violet',
    // Doubao uses per-user endpoint IDs (ep-xxxxxxxx-xxxx) as the model identifier.
    // There are no shared model names — each user deploys their own endpoint in the Ark console.
    usesEndpointId: true,
    endpointPlaceholder: 'ep-xxxxxxxxxxxxxxxx-xxxxx',
    endpointHint: 'Create an endpoint at console.volcengine.com/ark → Online Inference, then copy its ID here.',
    defaultModel: '',  // empty until the user enters their endpoint ID
    models: [],        // not used — endpoint ID is free-text
    // Default uses the standard v3 URL. Switch to /api/coding/v3 for Coding Plan billing.
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    baseUrlPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
    baseUrlHint: 'Use /api/coding/v3 for Coding Plan billing · /api/v3 for standard billing',
  },
];

export function getProviderMeta(provider: AIProvider): ProviderMeta {
  return PROVIDERS.find((p) => p.id === provider)!;
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
}): Promise<string> {
  const { provider, model, apiKey, systemPrompt, userMessage, maxTokens = 2048, baseUrl } = options;

  // ── Anthropic ─────────────────────────────────────────────────────────────
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type from Anthropic.');
    return content.text;
  }

  // ── Google Gemini ─────────────────────────────────────────────────────────
  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
    });
    const result = await geminiModel.generateContent(userMessage);
    return result.response.text();
  }

  // ── Doubao (ByteDance Ark — OpenAI-compatible) ────────────────────────────
  if (provider === 'doubao') {
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
      throw new Error(`Doubao API error: ${err}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Doubao.');
    return text as string;
  }

  throw new Error(`Unsupported AI provider: "${provider}"`);

}
