"use client";

import { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle } from "lucide-react";
import { PROVIDERS, type AIProvider, type ProviderMeta } from "@/lib/aiClient";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AIConfig {
  provider: AIProvider;
  models: Record<AIProvider, string>;
  keys: Record<AIProvider, string>;
}

export const AI_CONFIG_KEY = "nwt_ai_config";

export function loadAIConfig(): AIConfig {
  if (typeof window === "undefined") return makeDefaultConfig();
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AIConfig>;
      const defaults = makeDefaultConfig();
      const models = { ...defaults.models, ...(parsed.models ?? {}) };

      // Doubao switched from model names to user-specific endpoint IDs (ep-…).
      // Any stale model name (not starting with "ep-") must be cleared so the
      // user is prompted to enter their real endpoint ID instead of hitting a
      // "model not found" error from the Ark API.
      if (models.doubao && !models.doubao.startsWith("ep-")) {
        models.doubao = "";
      }

      return {
        ...defaults,
        ...parsed,
        keys:   { ...defaults.keys, ...(parsed.keys ?? {}) },
        models,
      };
    }
  } catch {}
  return makeDefaultConfig();
}

function makeDefaultConfig(): AIConfig {
  const models = {} as Record<AIProvider, string>;
  const keys   = {} as Record<AIProvider, string>;
  for (const p of PROVIDERS) {
    models[p.id] = p.defaultModel;
    keys[p.id]   = "";
  }
  return { provider: "anthropic", models, keys };
}

// ── Provider colour helpers ────────────────────────────────────────────────

const COLORS: Record<AIProvider, { ring: string; bg: string; text: string; dot: string; badge: string }> = {
  anthropic: {
    ring:  "ring-indigo-500",
    bg:    "bg-indigo-50",
    text:  "text-indigo-700",
    dot:   "bg-indigo-500",
    badge: "bg-indigo-100 text-indigo-700",
  },
  gemini: {
    ring:  "ring-blue-500",
    bg:    "bg-blue-50",
    text:  "text-blue-700",
    dot:   "bg-blue-500",
    badge: "bg-blue-100 text-blue-700",
  },
  doubao: {
    ring:  "ring-violet-500",
    bg:    "bg-violet-50",
    text:  "text-violet-700",
    dot:   "bg-violet-500",
    badge: "bg-violet-100 text-violet-700",
  },
};

// ── Provider logo marks (SVG-free, text-based) ─────────────────────────────

function ProviderMark({ meta }: { meta: ProviderMeta }) {
  const c = COLORS[meta.id];
  return (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm select-none ${c.bg} ${c.text}`}>
      {meta.label.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: AIConfig) => void;
  currentConfig: AIConfig;
}

export function AISettingsModal({ isOpen, onClose, onSave, currentConfig }: AISettingsModalProps) {
  const [config, setConfig] = useState<AIConfig>(currentConfig);
  const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({ anthropic: false, gemini: false, doubao: false });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(currentConfig);
      setSaved(false);
    }
  }, [isOpen, currentConfig]);

  if (!isOpen) return null;

  const activeProvider = config.provider;
  const activeMeta     = PROVIDERS.find((p) => p.id === activeProvider)!;
  const activeColor    = COLORS[activeProvider];

  const setProvider = (p: AIProvider) =>
    setConfig((c) => ({ ...c, provider: p }));

  const setKey = (p: AIProvider, key: string) =>
    setConfig((c) => ({ ...c, keys: { ...c.keys, [p]: key } }));

  const setModel = (p: AIProvider, model: string) =>
    setConfig((c) => ({ ...c, models: { ...c.models, [p]: model } }));

  const toggleShowKey = (p: AIProvider) =>
    setShowKey((s) => ({ ...s, [p]: !s[p] }));

  const handleSave = () => {
    onSave(config);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
  };

  const hasKeyForActive = !!config.keys[activeProvider]?.trim();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col relative border border-slate-100 max-h-[90vh] overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">AI Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5">Choose your AI provider, model, and API key</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">

          {/* ── Section 1: Provider selection ─────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              AI Provider
            </p>
            <div className="grid grid-cols-3 gap-3">
              {PROVIDERS.map((meta) => {
                const c        = COLORS[meta.id];
                const isActive = config.provider === meta.id;
                const hasKey   = !!config.keys[meta.id]?.trim();
                return (
                  <button
                    key={meta.id}
                    onClick={() => setProvider(meta.id)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                      isActive
                        ? `${c.bg} border-current ${c.text} ring-2 ${c.ring} ring-offset-1`
                        : "border-slate-200 hover:border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <ProviderMark meta={meta} />
                    <div className="text-center">
                      <div className="font-bold text-xs">{meta.name}</div>
                      <div className={`text-[10px] mt-0.5 font-semibold ${isActive ? c.text : "text-slate-400"}`}>
                        {meta.label}
                      </div>
                    </div>
                    {/* Active key indicator */}
                    {hasKey && (
                      <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${c.dot}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Section 2: Model / Endpoint selection ─────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              {activeMeta.usesEndpointId ? "Endpoint ID" : "Model"} —{" "}
              <span className={activeColor.text}>{activeMeta.name}</span>
            </p>

            {activeMeta.usesEndpointId ? (
              /* Doubao: free-text endpoint ID input */
              <div className="space-y-2">
                <input
                  type="text"
                  value={config.models[activeProvider] ?? ""}
                  onChange={(e) => setModel(activeProvider, e.target.value.trim())}
                  placeholder={activeMeta.endpointPlaceholder}
                  className={`w-full bg-slate-50 border-2 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 transition-colors ${
                    config.models[activeProvider]
                      ? `border-current ${activeColor.text} focus:${activeColor.ring}`
                      : "border-slate-200 focus:border-violet-400 focus:ring-violet-400"
                  }`}
                />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {activeMeta.endpointHint}
                </p>
              </div>
            ) : (
              /* Anthropic / Gemini: radio button list */
              <div className="space-y-2">
                {activeMeta.models.map((m) => {
                  const isSelected = config.models[activeProvider] === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setModel(activeProvider, m.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all flex items-start gap-3 ${
                        isSelected
                          ? `${activeColor.bg} border-current ${activeColor.text}`
                          : "border-slate-200 bg-white hover:border-slate-300 text-slate-700"
                      }`}
                    >
                      <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? "border-current" : "border-slate-300"
                      }`}>
                        {isSelected && <span className={`w-2 h-2 rounded-full ${activeColor.dot}`} />}
                      </span>
                      <span>
                        <span className={`block text-sm font-semibold ${isSelected ? activeColor.text : "text-slate-800"}`}>
                          {m.label}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">{m.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Section 3: API keys for all providers ─────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              API Keys
            </p>
            <div className="space-y-4">
              {PROVIDERS.map((meta) => {
                const c      = COLORS[meta.id];
                const key    = config.keys[meta.id] ?? "";
                const isShow = showKey[meta.id];
                return (
                  <div key={meta.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>
                        {meta.name}
                      </span>
                      {key && (
                        <span className="text-xs text-emerald-600 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Key saved
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={isShow ? "text" : "password"}
                        value={key}
                        onChange={(e) => setKey(meta.id, e.target.value)}
                        placeholder={meta.keyPlaceholder}
                        className={`w-full bg-slate-50 border rounded-xl px-4 py-2.5 pr-11 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 font-mono transition-colors ${
                          config.provider === meta.id
                            ? `border-current ${c.text} focus:${c.ring}`
                            : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-400"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey(meta.id)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {isShow ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">{meta.keyHint}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-8 pb-7 pt-4 border-t border-slate-100 space-y-2 shrink-0">
          {!hasKeyForActive && (
            <p className="text-xs text-amber-600 text-center">
              Add an API key for <strong>{activeMeta.name}</strong> to enable AI features.
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saved}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                saved
                  ? "bg-emerald-500 text-white"
                  : `${activeColor.bg} border-2 border-current ${activeColor.text} hover:opacity-90`
              }`}
            >
              {saved ? (
                <><CheckCircle className="w-4 h-4" /> Saved</>
              ) : (
                "Save Settings"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
