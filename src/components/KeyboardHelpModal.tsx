"use client";

import { useEffect, useRef } from "react";
import { X, Keyboard } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";

const SHORTCUTS: { keys: string[]; actionKey: TranslationKey }[] = [
  { keys: ["N"],                    actionKey: "keyboard.addNode" },
  { keys: ["Delete"],               actionKey: "keyboard.deleteSelected" },
  { keys: ["Cmd", "Z"],             actionKey: "keyboard.undo" },
  { keys: ["Cmd", "Shift", "Z"],    actionKey: "keyboard.redo" },
  { keys: ["Cmd", "E"],             actionKey: "keyboard.exportCsv" },
  { keys: ["Cmd", "K"],             actionKey: "keyboard.openSearch" },
  { keys: ["Escape"],               actionKey: "keyboard.deselect" },
  { keys: ["Tab"],                  actionKey: "keyboard.cycleNodes" },
  { keys: ["?"],                    actionKey: "keyboard.showHelp" },
];

interface KeyboardHelpModalProps {
  onClose: () => void;
}

export function KeyboardHelpModal({ onClose }: KeyboardHelpModalProps) {
  const { t } = useLanguage();
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable[0]?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('keyboard.title')}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={modalRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-indigo-500" />
            <span className="font-semibold text-slate-800">{t('keyboard.title')}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label={t('keyboard.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcut list */}
        <div className="px-6 py-4 space-y-2">
          {SHORTCUTS.map(({ keys, actionKey }) => (
            <div key={actionKey} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-slate-600">{t(actionKey)}</span>
              <div className="flex items-center gap-1">
                {keys.map((k, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-slate-300 text-xs">+</span>}
                    <kbd className="px-2 py-0.5 text-xs font-mono bg-slate-100 border border-slate-300 rounded text-slate-700 shadow-sm">
                      {k}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 text-xs text-slate-400 text-center">
          {t('keyboard.footer')}
        </div>
      </div>
    </div>
  );
}
