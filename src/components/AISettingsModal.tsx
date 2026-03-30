"use client";

import { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle } from "lucide-react";
import { PROVIDERS, type AIProvider, type ProviderMeta } from "@/lib/aiClient";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useAIEngineMode } from "@/contexts/AIEngineContext";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AIConfig {
  provider: AIProvider;
  models: Record<AIProvider, string>;
  keys: Record<AIProvider, string>;
  baseUrls?: Partial<Record<AIProvider, string>>;
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

      return {
        ...defaults,
        ...parsed,
        keys:     { ...defaults.keys, ...(parsed.keys ?? {}) },
        models,
        baseUrls: { ...(parsed.baseUrls ?? {}) },
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
  demo: {
    ring:  "ring-emerald-500",
    bg:    "bg-emerald-50",
    text:  "text-emerald-700",
    dot:   "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700",
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
  /** When true, all settings fields are read-only (demo mode) */
  isDemoMode?: boolean;
}

export function AISettingsModal({ isOpen, onClose, onSave, currentConfig, isDemoMode }: AISettingsModalProps) {
  const [config, setConfig] = useState<AIConfig>(currentConfig);
  const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({ anthropic: false, gemini: false, doubao: false, demo: false });
  const [saved, setSaved] = useState(false);
  const { mode: engineMode, setMode: setEngineMode } = useAIEngineMode();
  
  const modalRef = useFocusTrap(isOpen);

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

  const setBaseUrl = (p: AIProvider, url: string) =>
    setConfig((c) => ({ ...c, baseUrls: { ...c.baseUrls, [p]: url } }));

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
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col relative border border-slate-100 max-h-[90vh] overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 shrink-0">
          <div>
            <h2 id="ai-settings-title" className="text-lg font-bold text-slate-800">AI Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5">Choose your AI provider, model, and API key</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Demo mode banner ────────────────────────────────────────────── */}
        {isDemoMode && (
          <div className="px-8 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-3 shrink-0">
            <span className="text-xl select-none">🎭</span>
            <div>
              <p className="text-sm font-bold text-emerald-800 leading-tight">Demo Mode — read only</p>
              <p className="text-xs text-emerald-600 leading-tight mt-0.5">Settings are pre-configured for the scripted Jack workflow. Export (PNG, CSV) and data flow are fully functional.</p>
            </div>
          </div>
        )}

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
                    onClick={() => !isDemoMode && setProvider(meta.id)}
                    title={isDemoMode ? "Demo mode — no editing" : undefined}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                      isActive
                        ? `${c.bg} border-current ${c.text} ring-2 ${c.ring} ring-offset-1`
                        : "border-slate-200 hover:border-slate-300 bg-white text-slate-700"
                    } ${isDemoMode ? "cursor-not-allowed" : ""}`}
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

          {/* ── Section 2: Doubao billing plan toggle ─────────────────────── */}
          {activeProvider === "doubao" && activeMeta.codingPlanBaseUrl && (
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Billing Plan — <span className={activeColor.text}>ByteDance</span>
              </p>
              {(() => {
                const isCodingPlan = (config.baseUrls?.doubao ?? "").includes("/coding/");
                const switchPlan = (coding: boolean) => {
                  const url = coding
                    ? activeMeta.codingPlanBaseUrl!
                    : (activeMeta.defaultBaseUrl ?? "");
                  // Switch base URL and reset model to a sensible default for the plan
                  setBaseUrl("doubao", url);
                  if (coding) {
                    // Pre-select the first coding plan model if no model is set yet
                    const first = activeMeta.codingPlanModels?.[0];
                    if (first && !config.models.doubao) setModel("doubao", first.id);
                  } else {
                    // Clear model so user fills in the endpoint ID
                    setModel("doubao", "");
                  }
                };
                return (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        id: false,
                        label: "Standard",
                        sub: "Pay-per-use",
                        desc: "Requires an ep-xxx endpoint ID from Ark console.",
                        hint: "/api/v3",
                      },
                      {
                        id: true,
                        label: "Coding Plan",
                        sub: "Subscription",
                        desc: "Use a direct model name — no endpoint ID needed.",
                        hint: "/api/coding/v3",
                      },
                    ].map((opt) => {
                      const isActive = isCodingPlan === opt.id;
                      return (
                        <button
                          key={String(opt.id)}
                          onClick={() => switchPlan(opt.id)}
                          className={`text-left p-4 rounded-2xl border-2 transition-all ${
                            isActive
                              ? "bg-violet-50 border-violet-400 text-violet-800 ring-2 ring-violet-400 ring-offset-1"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-bold text-sm">{opt.label}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-auto ${
                              isActive ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"
                            }`}>
                              {opt.sub}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-snug mb-1.5">{opt.desc}</p>
                          <code className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            isActive ? "bg-violet-100 text-violet-600" : "bg-slate-100 text-slate-400"
                          }`}>{opt.hint}</code>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </section>
          )}

          {/* ── Section 2b: Model / Endpoint selection ────────────────────── */}
          <section>
            {(() => {
              const isCodingPlan =
                activeProvider === "doubao" &&
                (config.baseUrls?.doubao ?? "").includes("/coding/");
              const showModelList =
                !activeMeta.usesEndpointId || isCodingPlan;
              const modelList = isCodingPlan
                ? (activeMeta.codingPlanModels ?? [])
                : activeMeta.models;
              const sectionLabel = isCodingPlan
                ? "Model"
                : activeMeta.usesEndpointId
                ? "Endpoint ID"
                : "Model";

              return (
                <>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    {sectionLabel} — <span className={activeColor.text}>{activeMeta.name}</span>
                  </p>

                  {showModelList ? (
                    /* Model dropdown (Anthropic / Gemini / Doubao coding plan) */
                    <div className="space-y-2">
                      {modelList.map((m) => {
                        const isSelected = config.models[activeProvider] === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => !isDemoMode && setModel(activeProvider, m.id)}
                            title={isDemoMode ? "Demo mode — no editing" : undefined}
                            className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all flex items-start gap-3 ${
                              isSelected
                                ? `${activeColor.bg} border-current ${activeColor.text}`
                                : "border-slate-200 bg-white hover:border-slate-300 text-slate-700"
                            } ${isDemoMode ? "cursor-not-allowed" : ""}`}
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
                  ) : (
                    /* Free-text endpoint ID (Doubao standard) */
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={config.models[activeProvider] ?? ""}
                        onChange={(e) => !isDemoMode && setModel(activeProvider, e.target.value.trim())}
                        readOnly={isDemoMode}
                        title={isDemoMode ? "Demo mode — no editing" : undefined}
                        placeholder={activeMeta.endpointPlaceholder}
                        className={`w-full bg-slate-50 border-2 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 transition-colors ${
                          config.models[activeProvider]
                            ? `border-current ${activeColor.text} focus:${activeColor.ring}`
                            : "border-slate-200 focus:border-violet-400 focus:ring-violet-400"
                        } ${isDemoMode ? "cursor-not-allowed opacity-70" : ""}`}
                      />
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {activeMeta.endpointHint}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
          </section>

          {/* ── Section 2c: Base URL (advanced / manual override) ─────────── */}
          {activeMeta.defaultBaseUrl && !(activeProvider === "doubao") && (
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Base URL — <span className={activeColor.text}>{activeMeta.name}</span>
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={config.baseUrls?.[activeProvider] ?? ""}
                  onChange={(e) => setBaseUrl(activeProvider, e.target.value.trim())}
                  placeholder={activeMeta.baseUrlPlaceholder ?? activeMeta.defaultBaseUrl}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:border-violet-400 focus:ring-violet-400 transition-colors"
                />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {activeMeta.baseUrlHint}
                  {!config.baseUrls?.[activeProvider] && (
                    <span className="text-slate-300"> · Leave blank to use the default.</span>
                  )}
                </p>
              </div>
            </section>
          )}

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
                        onChange={(e) => !isDemoMode && setKey(meta.id, e.target.value)}
                        readOnly={isDemoMode}
                        title={isDemoMode ? "Demo mode — no editing" : undefined}
                        placeholder={meta.keyPlaceholder}
                        className={`w-full bg-slate-50 border rounded-xl px-4 py-2.5 pr-11 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 font-mono transition-colors ${
                          config.provider === meta.id
                            ? `border-current ${c.text} focus:${c.ring}`
                            : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-400"
                        } ${isDemoMode ? "cursor-not-allowed opacity-70" : ""}`}
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

          {/* ── Section 4: AI Engine Mode ─────────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              AI Engine Mode
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                {
                  value: 'monolithic' as const,
                  label: 'Monolithic',
                  badge: 'Stable',
                  badgeColor: 'bg-indigo-100 text-indigo-700',
                  activeRing: 'ring-indigo-500',
                  activeBg: 'bg-indigo-50 border-indigo-400 text-indigo-800',
                  desc: 'Single AI call — fast, reliable, works for most workflows.',
                },
                {
                  value: 'distributed' as const,
                  label: 'Distributed',
                  badge: 'Experimental',
                  badgeColor: 'bg-emerald-100 text-emerald-700',
                  activeRing: 'ring-emerald-500',
                  activeBg: 'bg-emerald-50 border-emerald-400 text-emerald-800',
                  desc: 'Parallel node agents — deeper analysis, higher token cost.',
                },
              ] as const).map((opt) => {
                const isActive = engineMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => !isDemoMode && setEngineMode(opt.value)}
                    title={isDemoMode ? "Demo mode — no editing" : undefined}
                    className={`relative flex flex-col items-start gap-1.5 p-4 rounded-2xl border-2 transition-all text-left ${
                      isActive
                        ? `${opt.activeBg} ring-2 ${opt.activeRing} ring-offset-1`
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    } ${isDemoMode ? "cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span className="font-bold text-sm">{opt.label}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-auto ${opt.badgeColor}`}>
                        {opt.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{opt.desc}</p>
                    {isActive && (
                      <span className="absolute top-2 right-2">
                        <CheckCircle className="w-3.5 h-3.5 text-current" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              Preference saved automatically. Toggle anytime from the toolbar pill next to AI Settings.
            </p>
          </section>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-8 pb-7 pt-4 border-t border-slate-100 space-y-2 shrink-0">
          {!hasKeyForActive && !isDemoMode && (
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
