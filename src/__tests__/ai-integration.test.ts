/**
 * src/__tests__/ai-integration.test.ts
 * Live integration tests for the Doubao (ByteDance Ark) AI provider.
 *
 * Credentials are loaded automatically from the project-root .env file via
 * vitest.config.ts (uses Vite's loadEnv — no dotenv package required).
 *
 * To run:
 *   npx vitest src/__tests__/ai-integration.test.ts
 *
 * The tests are automatically skipped when DOUBAO_API_KEY or
 * DOUBAO_ENDPOINT_ID are absent from the environment.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from '@/lib/aiClient';
import { ParseWorkflowResponse } from '@/lib/aiSchemas';
import { jsonrepair } from 'jsonrepair';

// ── Credentials (populated from .env via vitest.config.ts) ──────────────────

const API_KEY     = process.env.DOUBAO_API_KEY?.trim();
const ENDPOINT_ID = process.env.DOUBAO_ENDPOINT_ID?.trim();
const BASE_URL    = process.env.DOUBAO_BASE_URL?.trim()
                    || 'https://ark.cn-beijing.volces.com/api/v3';

/** True when required credentials are missing — tests are skipped automatically */
const missingCreds = !API_KEY || !ENDPOINT_ID;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const JACK_ROUTINE = `For Jack's daily routine, he usually starts around 9:00 AM by logging \
into the Bloomberg Terminal to extract the raw end-of-day pricing data. Once that CSV file is \
downloaded, he immediately feeds it into his local Python reconciliation script. This script \
automatically compares the Bloomberg data against our internal PostgreSQL database to check for \
any price breaks.
If the script outputs a clean Match Report, Jack just uploads that report directly to the \
Ternary Client Dashboard and his morning is done. However, if there are discrepancies, the \
script generates an Exception File. Jack takes that Exception File and Slacks it over to Sarah, \
the Portfolio Manager. Jack is blocked at this point—he can't proceed until Sarah manually \
reviews the Exception File and gives him the thumbs up. Once Sarah approves the overrides, Jack \
updates the database and finally pushes the corrected numbers to the Client Dashboard. Mary is \
Jack's HR, Every week Mary and Jack will have a meeting to evaluate Jack's mental well being. \
Jason is Mary's supervisor, and Jason will talk the joint Mary and Jacks talk once every month \
Mary also talks with Sarah on Jack's performance`;

const PARSE_SYSTEM_PROMPT = `You are a workflow graph parser. Convert natural language workflow descriptions into structured JSON graphs.

Output ONLY valid JSON with this exact structure:
{
  "nodes": [
    {
      "id": "unique_lowercase_id",
      "name": "Full Display Name",
      "initials": "AB",
      "role": "person|tool|external|output",
      "summary": "Brief description of this entity's role in the workflow",
      "constraints": "Optional: known operational, compliance, or technical constraints. Omit if none.",
      "tasks": [
        {
          "id": "t_unique_suffix",
          "title": "Concrete actionable task this entity owns",
          "status": "todo",
          "priority": "high",
          "note": "Optional one-line detail"
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "e_sourceid_targetid",
      "source": "source_node_id",
      "target": "target_node_id",
      "name": "Connection or flow name"
    }
  ],
  "groups": [
    {
      "id": "grp_phase1",
      "name": "Phase Name",
      "color": "#6366F1",
      "nodeIds": ["node_id1", "node_id2"],
      "parentGroupId": null
    }
  ]
}

Node rules:
- Node IDs: lowercase alphanumeric and underscores only, must be unique
- Initials: 2-3 uppercase characters
- Role types: "person" | "tool" | "external" | "output"
- Edges represent data/work flow direction
- constraints: optional
- tasks: 1-3 concrete tasks per node

Output ONLY the JSON object — no markdown fences, no explanation text`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strips markdown code fences and extracts the outermost JSON object from
 * an AI response string.  Works even when the model wraps the answer in
 * ```json … ``` or adds trailing prose.
 */
function extractJSON(text: string): string {
  // Strip optional markdown fences
  const stripped = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  const start = stripped.indexOf('{');
  if (start === -1) return stripped;

  let depth = 0;
  let end   = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  return end !== -1 ? stripped.slice(start, end + 1) : stripped.slice(start);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Doubao AI Integration: Jack's Routine", () => {

  it.skipIf(missingCreds)(
    'correctly parses the routine into a valid JSON graph',
    async () => {
      // TypeScript narrowing: both values are non-empty strings at this point
      // because missingCreds would have been true otherwise.
      const apiKey     = API_KEY as string;
      const endpointId = ENDPOINT_ID as string;

      const result = await generateText({
        provider:     'doubao',
        model:        endpointId,
        apiKey,
        systemPrompt: PARSE_SYSTEM_PROMPT,
        userMessage:  JACK_ROUTINE,
        baseUrl:      BASE_URL,
      });

      // Raw response must exist
      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(10);

      // Extract and repair JSON
      const cleanJson = extractJSON(result.text);
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(jsonrepair(cleanJson));
      } catch (err) {
        console.error('AI response was not parseable JSON:\n', result.text);
        throw err;
      }

      // Validate against Zod schema
      const zodResult = ParseWorkflowResponse.safeParse(parsedData);
      if (!zodResult.success) {
        console.error(
          'Zod validation failure:\n',
          JSON.stringify(zodResult.error.format(), null, 2),
        );
      }
      expect(zodResult.success).toBe(true);

      // Narrow to the success branch for subsequent assertions
      if (!zodResult.success) return;

      const { nodes, edges } = zodResult.data;
      const nodeNames = nodes.map(n => n.name.toLowerCase());

      // Workflow-specific checks: key entities must be present
      expect(nodeNames.some(n => n.includes('jack'))).toBe(true);
      expect(nodeNames.some(n => n.includes('bloomberg'))).toBe(true);
      expect(nodeNames.some(n => n.includes('sarah'))).toBe(true);

      // Structural sanity: a meaningful graph should have multiple edges
      expect(nodes.length).toBeGreaterThan(3);
      expect(edges.length).toBeGreaterThan(2);

      console.info(
        `✅ Integration passed: ${nodes.length} nodes · ${edges.length} edges` +
        (zodResult.data.groups.length
          ? ` · ${zodResult.data.groups.length} groups`
          : ''),
      );
    },
    30_000, // 30 s timeout for the real AI call
  );

  it.skipIf(missingCreds)(
    'returns token usage metadata',
    async () => {
      const result = await generateText({
        provider:     'doubao',
        model:        ENDPOINT_ID as string,
        apiKey:       API_KEY as string,
        systemPrompt: 'Reply with only valid JSON: {"ok": true}',
        userMessage:  'ping',
        baseUrl:      BASE_URL,
      });

      // Usage may be null for some providers but should be an object when present
      if (result.usage !== null && result.usage !== undefined) {
        expect(typeof result.usage.inputTokens).toBe('number');
        expect(typeof result.usage.outputTokens).toBe('number');
        expect(result.usage.inputTokens).toBeGreaterThan(0);
      }

      // The minimal response should still be valid JSON
      const parsed = JSON.parse(jsonrepair(extractJSON(result.text)));
      expect(parsed).toMatchObject({ ok: true });
    },
    15_000,
  );

  it('skips gracefully when credentials are missing', () => {
    if (!missingCreds) {
      // Creds are present — this is just a no-op confirmation
      expect(API_KEY).toBeTruthy();
      expect(ENDPOINT_ID).toBeTruthy();
      return;
    }
    // If we reach here without credentials the test itself passes — the two
    // integration tests above are skipped via it.skipIf, so no false failures.
    expect(missingCreds).toBe(true);
  });
});
