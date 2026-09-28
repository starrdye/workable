/**
 * edit/soul.ts — build a new worker's SOUL.md from the team's existing
 * workers, and add the worker to the orchestrator's team table.
 *
 * The "Rules that always apply" block is copied verbatim from an existing
 * worker. The canvas never lets anyone edit it.
 */

export const RULES_HEADING = '## Rules that always apply';

/** Used only when no existing worker has a rules block to copy. */
export const FALLBACK_RULES = `${RULES_HEADING}
- You work only from the card you were given. You cannot see the vault, other cards, or private notes — and you must not ask for them.
- Never request, accept, or repeat credentials, API keys, or other people's private information. If a card contains any, stop and \`kanban_block\` it with the reason.
- You never trade, pay, book, post, publish, or push anything. You produce drafts and data; the orchestrator reviews; the human acts.
- Finish with \`kanban_complete\`: a summary plus the full output. State what you are unsure of.
- Be direct and brief. No filler.`;

/** The rules section of a SOUL.md (heading through the end of that section), or null. */
export function extractRules(soul: string): string | null {
  const start = soul.indexOf(RULES_HEADING);
  if (start === -1) return null;
  const rest = soul.slice(start + RULES_HEADING.length);
  const next = rest.search(/\n## /);
  return (RULES_HEADING + (next === -1 ? rest : rest.slice(0, next))).trim();
}

export interface WorkerTemplate {
  /** Profile id of the worker the template came from. */
  id: string;
  soul: string;
}

export interface NewWorkerSpec {
  id: string;
  /** Short role title, e.g. "Editor". */
  role: string;
  responsibilities: string;
  delivery?: string;
}

function bullets(text: string): string {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => (l.startsWith('- ') ? l : `- ${l.replace(/^[-*•]\s*/, '')}`)).join('\n');
}

/** First line of the template, re-pointed at the new worker: "You are **x**, the Role on … team…". */
function introLine(spec: NewWorkerSpec, template: WorkerTemplate | null): string {
  const first = template?.soul.split('\n').find(l => l.trim()) ?? '';
  const escaped = template?.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (template && first.includes(`**${template.id}**`)) {
    return first
      .replace(new RegExp(`\\*\\*${escaped}\\*\\*`), `**${spec.id}**`)
      .replace(/, the [^,]+? on /, `, the ${spec.role} on `);
  }
  return `You are **${spec.id}**, the ${spec.role} on this team. You report to the orchestrator, never to the human directly.`;
}

export function buildWorkerSoul(spec: NewWorkerSpec, template: WorkerTemplate | null): string {
  const rules = (template && extractRules(template.soul)) ?? FALLBACK_RULES;
  const parts = [introLine(spec, template), '', '## What you do', bullets(spec.responsibilities)];
  if (spec.delivery?.trim()) parts.push('', '## How you deliver', bullets(spec.delivery));
  parts.push('', rules, '');
  return parts.join('\n');
}

/**
 * Add a row to the orchestrator's "| Profile | Role | Give it |" table.
 * Returns null when there's no such table (the caller warns instead).
 */
export function addTeamRow(orchestratorSoul: string, row: { id: string; role: string; giveIt: string }): string | null {
  const lines = orchestratorSoul.split('\n');
  const header = lines.findIndex(l => /^\|\s*Profile\s*\|/i.test(l));
  if (header === -1 || !/^\|[\s|:-]+\|?\s*$/.test(lines[header + 1] ?? '')) return null;
  let end = header + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  if (lines.slice(header + 2, end).some(l => l.includes(`\`${row.id}\``))) return orchestratorSoul;
  const clean = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ').trim();
  lines.splice(end, 0, `| \`${row.id}\` | ${clean(row.role)} | ${clean(row.giveIt)} |`);
  return lines.join('\n');
}
