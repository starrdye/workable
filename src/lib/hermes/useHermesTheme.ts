/**
 * useHermesTheme / useEmbedded — browser-derived state for the Hermes view,
 * read with useSyncExternalStore so SSR renders light and the client follows
 * the URL (Hermes theme) or the OS light/dark setting as it changes.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { readHermesTheme, systemMode, type HermesMode } from './theme';
import { isEmbedded } from '@/lib/embed';

export interface ResolvedTheme { mode: HermesMode; style: CSSProperties }

const SERVER_THEME: ResolvedTheme = { mode: 'light', style: {} };
let cacheKey = '';
let cached: ResolvedTheme = SERVER_THEME;

function themeSnapshot(): ResolvedTheme {
  const fromUrl = readHermesTheme(window.location.search);
  const mode = fromUrl.mode ?? systemMode();
  const key = `${mode}|${window.location.search}`;
  if (key !== cacheKey) { cacheKey = key; cached = { mode, style: fromUrl.style }; }
  return cached; // same object until something changes, as useSyncExternalStore requires
}

function subscribeToScheme(onChange: () => void) {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

export function useHermesTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeToScheme, themeSnapshot, () => SERVER_THEME);
}

const noSubscribe = () => () => {};

export function useEmbedded(): boolean {
  return useSyncExternalStore(noSubscribe, isEmbedded, () => false);
}
