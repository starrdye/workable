'use client';

/**
 * contexts/LanguageContext.tsx — Global English / 简体中文 language switch.
 *
 * Design pattern: follows AIEngineContext.tsx exactly.
 * - Browser language detection: if navigator.language starts with 'zh', default to 'zh'; else 'en'.
 * - Persists to localStorage key 'nwt_language'.
 * - useLanguage() returns { lang, setLang, t } — t(key) performs a flat lookup.
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { translations, type Language, type TranslationKey } from '@/lib/i18n';

// ── Types ────────────────────────────────────────────────────────────────────

interface LanguageContextValue {
  /** Current language code */
  lang: Language;
  /** Set a specific language */
  setLang: (lang: Language) => void;
  /** Translate a key to the current language */
  t: (key: TranslationKey) => string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nwt_language';
const DEFAULT_LANG: Language = 'en';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
    // Browser language detection
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) return 'zh';
  } catch {
    // localStorage unavailable — keep default
  }
  return DEFAULT_LANG;
}

// ── Context ──────────────────────────────────────────────────────────────────

const LanguageContext = createContext<LanguageContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Static initial value — real value loaded in useEffect to avoid hydration mismatch
  const [lang, setLangState] = useState<Language>(DEFAULT_LANG);

  // Load persisted preference (client-only)
  useEffect(() => {
    setLangState(getInitialLanguage());
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    try { localStorage.setItem(STORAGE_KEY, newLang); } catch { /* noop */ }
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return (translations[lang] as Record<string, string>)[key]
      ?? (translations['en'] as Record<string, string>)[key]
      ?? key;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within <LanguageProvider>');
  }
  return ctx;
}
