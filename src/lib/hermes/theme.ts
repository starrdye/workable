/**
 * hermes/theme.ts — colours for the Hermes view.
 *
 * The desktop plugin passes Hermes's live theme in the frame URL
 * (?mode=dark&bg=…&surface=…&fg=…&muted=…&border=…). Those override the
 * surface/text/border tokens in globals.css so the pane matches the app.
 * Without them (a normal browser tab) the OS light/dark setting is used.
 */

import type { CSSProperties } from 'react';

export type HermesMode = 'light' | 'dark';

/** Only plain colour syntax is accepted, so a URL can't smuggle other CSS in. */
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([0-9a-zA-Z.,%/\s-]{1,80}\))$/;

const PARAM_TO_VAR: Record<string, string[]> = {
  bg: ['--h-bg'],
  surface: ['--h-surface'],
  sunk: ['--h-sunk'],
  fg: ['--h-text', '--h-text-2'],
  muted: ['--h-muted'],
  border: ['--h-border'],
};

export interface HermesTheme { mode: HermesMode | null; style: CSSProperties }

export function readHermesTheme(search: string): HermesTheme {
  const params = new URLSearchParams(search);
  const m = params.get('mode');
  const style: Record<string, string> = {};
  for (const [param, vars] of Object.entries(PARAM_TO_VAR)) {
    const value = params.get(param)?.trim();
    if (value && SAFE_COLOR.test(value)) vars.forEach(v => { style[v] = value; });
  }
  return { mode: m === 'dark' || m === 'light' ? m : null, style: style as CSSProperties };
}

/** OS preference, for when the URL doesn't say. */
export function systemMode(): HermesMode {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
