'use client';

import { useLanguage } from '@/contexts/LanguageContext';

/**
 * LanguageToggle — compact EN / 中文 switcher for the toolbar.
 * Matches the existing dark-outline button style used across the app.
 */
export function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="shrink-0 flex items-center rounded-full border border-gray-300 overflow-hidden text-xs font-semibold">
      <button
        onClick={() => setLang('en')}
        aria-label="Switch to English"
        className={`px-2.5 py-1 transition-colors ${
          lang === 'en'
            ? 'bg-indigo-600 text-white'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
        }`}
      >
        EN
      </button>
      <span className="w-px h-4 bg-gray-200" />
      <button
        onClick={() => setLang('zh')}
        aria-label="切换至中文"
        className={`px-2.5 py-1 transition-colors ${
          lang === 'zh'
            ? 'bg-indigo-600 text-white'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
        }`}
      >
        中文
      </button>
    </div>
  );
}
