"use client";

/**
 * EditDialog — change the Hermes install from the canvas. Always three steps:
 * fill the form → review the diff and the exact commands → apply.
 * Nothing is written until the user presses Apply on the review screen.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import type { EditApplyResult, EditPlanView, HermesProfile, HermesSnapshot } from "@/lib/hermes/types";
import { lineDiff, withContext } from "@/lib/hermes/edit/diff";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useLanguage } from "@/contexts/LanguageContext";

export type EditRequest =
  | { op: "add-agent" }
  | { op: "edit-agent"; profile: HermesProfile }
  | { op: "add-project" };

interface Props {
  request: EditRequest;
  snapshot: HermesSnapshot;
  onClose: () => void;
  onApplied: () => void;
}

const COLORS = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
const input = "w-full rounded-md border border-(--h-border) bg-(--h-surface) px-2.5 py-1.5 text-sm text-(--h-text) focus:border-(--h-accent) focus:outline-none focus:ring-1 focus:ring-(--h-accent)";
const label = "text-[12px] font-medium text-(--h-muted)";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function EditDialog({ request, snapshot, onClose, onApplied }: Props) {
  const { t } = useLanguage();
  const [stage, setStage] = useState<"form" | "review" | "done">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<EditPlanView | null>(null);
  const [result, setResult] = useState<EditApplyResult | null>(null);
  const ref = useFocusTrap(true);

  // Form state (one object per op keeps the component simple).
  const edit = request.op === "edit-agent" ? request.profile : null;
  const [form, setForm] = useState<Record<string, string>>(() => ({
    id: "", role: "", description: edit?.description ?? "", model: edit?.model ?? "",
    responsibilities: "", delivery: "", giveIt: "", name: "", slug: "", color: COLORS[1],
  }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const models = useMemo(() => [...new Set(snapshot.profiles.map(p => p.model).filter(Boolean) as string[])], [snapshot.profiles]);

  const title = request.op === "add-agent" ? t("hermes.edit.addAgent")
    : request.op === "add-project" ? t("hermes.edit.addProject")
    : `${t("hermes.edit.editAgent")} ${edit?.name ?? ""}`;

  async function preview() {
    setBusy(true); setError(null);
    const payload = request.op === "add-agent"
      ? { id: form.id, role: form.role, description: form.description, model: form.model, responsibilities: form.responsibilities, delivery: form.delivery, giveIt: form.giveIt }
      : request.op === "edit-agent"
        ? { id: edit!.id, description: form.description, model: form.model }
        : { name: form.name, slug: form.slug || slugify(form.name), description: form.description, color: form.color };
    try {
      const res = await fetch("/api/hermes/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: request.op, input: payload }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setPlan(body as EditPlanView);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/hermes/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id }) });
      const body = await res.json();
      if (res.status === 410) throw new Error(body?.error);
      setResult(body as EditApplyResult);
      setStage("done");
      if ((body as EditApplyResult).ok) onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("form");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10" role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="hermes-edit-title"
        className="w-full max-w-2xl rounded-xl border border-(--h-border) bg-(--h-surface) shadow-xl"
        onKeyDown={e => { if (e.key === "Escape" && !busy) onClose(); }}>
        <div className="flex items-center gap-3 border-b border-(--h-border) px-5 py-3">
          <h2 id="hermes-edit-title" className="flex-1 text-[15px] font-semibold text-(--h-text)">{title}</h2>
          <span className="rounded bg-(--h-sunk) px-2 py-0.5 font-mono text-[11px] text-(--h-muted)" title={t("hermes.edit.target")}>{snapshot.home}</span>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t("hermes.edit.close")} className="rounded p-1 text-(--h-faint) hover:bg-(--h-sunk) hover:text-(--h-text-2)"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {error && <p className="rounded-lg border border-(--h-bad) bg-(--h-bad-soft) px-3 py-2 text-[13px] text-(--h-bad)">{error}</p>}

          {stage === "form" && (
            <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); preview(); }}>
              {request.op === "add-agent" && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field id="he-id" label={t("hermes.edit.f.id")} hint={t("hermes.edit.f.idHint")}>
                      <input id="he-id" className={input} value={form.id} onChange={set("id")} placeholder="personal-editor" required autoFocus />
                    </Field>
                    <Field id="he-role" label={t("hermes.edit.f.role")}>
                      <input id="he-role" className={input} value={form.role} onChange={set("role")} placeholder="Editor" required />
                    </Field>
                  </div>
                  <Field id="he-desc" label={t("hermes.edit.f.description")} hint={t("hermes.edit.f.descriptionHint")}>
                    <input id="he-desc" className={input} value={form.description} onChange={set("description")} required />
                  </Field>
                  <Field id="he-model" label={t("hermes.edit.f.model")}>
                    <input id="he-model" className={`${input} font-mono`} value={form.model} onChange={set("model")} list="he-models" required />
                    <datalist id="he-models">{models.map(m => <option key={m} value={m} />)}</datalist>
                  </Field>
                  <Field id="he-resp" label={t("hermes.edit.f.responsibilities")} hint={t("hermes.edit.f.oneLine")}>
                    <textarea id="he-resp" className={`${input} min-h-[80px]`} value={form.responsibilities} onChange={set("responsibilities")} required />
                  </Field>
                  <Field id="he-deliv" label={t("hermes.edit.f.delivery")} hint={t("hermes.edit.f.optional")}>
                    <textarea id="he-deliv" className={`${input} min-h-[60px]`} value={form.delivery} onChange={set("delivery")} />
                  </Field>
                  <Field id="he-give" label={t("hermes.edit.f.giveIt")} hint={t("hermes.edit.f.giveItHint")}>
                    <input id="he-give" className={input} value={form.giveIt} onChange={set("giveIt")} />
                  </Field>
                  <p className="rounded-lg bg-(--h-sunk) px-3 py-2 text-[12px] leading-relaxed text-(--h-muted)">{t("hermes.edit.lockedRules")}</p>
                </>
              )}
              {request.op === "edit-agent" && (
                <>
                  <Field id="he-desc" label={t("hermes.edit.f.description")} hint={t("hermes.edit.f.descriptionHint")}>
                    <textarea id="he-desc" className={`${input} min-h-[70px]`} value={form.description} onChange={set("description")} required autoFocus />
                  </Field>
                  <Field id="he-model" label={t("hermes.edit.f.model")}>
                    <input id="he-model" className={`${input} font-mono`} value={form.model} onChange={set("model")} list="he-models" />
                    <datalist id="he-models">{models.map(m => <option key={m} value={m} />)}</datalist>
                  </Field>
                </>
              )}
              {request.op === "add-project" && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field id="he-name" label={t("hermes.edit.f.projectName")}>
                      <input id="he-name" className={input} value={form.name} onChange={set("name")} placeholder="Research" required autoFocus />
                    </Field>
                    <Field id="he-slug" label={t("hermes.edit.f.slug")} hint={t("hermes.edit.f.slugHint")}>
                      <input id="he-slug" className={`${input} font-mono`} value={form.slug} onChange={set("slug")} placeholder={slugify(form.name) || "research"} />
                    </Field>
                  </div>
                  <Field id="he-desc" label={t("hermes.edit.f.description")} hint={t("hermes.edit.f.optional")}>
                    <input id="he-desc" className={input} value={form.description} onChange={set("description")} />
                  </Field>
                  <div className="flex flex-col gap-1">
                    <span className={label}>{t("hermes.edit.f.color")}</span>
                    <div className="flex gap-2" role="radiogroup" aria-label={t("hermes.edit.f.color")}>
                      {COLORS.map(c => (
                        <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                          className={`h-6 w-6 rounded-full border-2 ${form.color === c ? "border-(--h-text)" : "border-white ring-1 ring-(--h-border)"}`} style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onClose} className="rounded-md border border-(--h-border) px-3 py-1.5 text-sm text-(--h-text-2) hover:bg-(--h-sunk)">{t("hermes.edit.cancel")}</button>
                <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-(--h-accent) px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("hermes.edit.preview")}
                </button>
              </div>
            </form>
          )}

          {stage === "review" && plan && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-(--h-muted)">{t("hermes.edit.reviewIntro").replace("{home}", plan.home)}</p>
              {plan.changes.map(c => <DiffCard key={c.path + c.label} change={c} />)}
              <section className="flex flex-col gap-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">{t("hermes.edit.steps")}</div>
                <ol className="flex flex-col gap-1">
                  {plan.steps.map((s, i) => (
                    <li key={i} className="rounded-md bg-(--h-sunk) px-2.5 py-1.5">
                      <div className="text-[12.5px] text-(--h-text-2)">{i + 1}. {s.label}</div>
                      <code className="block break-all font-mono text-[11.5px] text-(--h-muted)">{s.command}</code>
                    </li>
                  ))}
                </ol>
              </section>
              {plan.warnings.map(w => (
                <p key={w} className="flex gap-2 rounded-lg border border-(--h-warn) bg-(--h-warn-soft) px-3 py-2 text-[12.5px] leading-relaxed text-(--h-warn)">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{w}</span>
                </p>
              ))}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStage("form")} disabled={busy} className="rounded-md border border-(--h-border) px-3 py-1.5 text-sm text-(--h-text-2) hover:bg-(--h-sunk)">{t("hermes.edit.back")}</button>
                <button type="button" onClick={apply} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-(--h-accent) px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("hermes.edit.apply")}
                </button>
              </div>
            </div>
          )}

          {stage === "done" && result && (
            <div className="flex flex-col gap-3">
              <p className={`flex items-center gap-2 text-sm font-medium ${result.ok ? "text-(--h-ok)" : "text-(--h-bad)"}`}>
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {result.ok ? t("hermes.edit.applied") : result.error ?? t("hermes.edit.failed")}
              </p>
              <ol className="flex flex-col gap-1">
                {result.steps.map((s, i) => (
                  <li key={i} className="rounded-md bg-(--h-sunk) px-2.5 py-1.5">
                    <div className={`text-[12.5px] ${s.ok ? "text-(--h-text-2)" : "text-(--h-bad)"}`}>{s.ok ? "✓" : "✗"} {s.label}</div>
                    {s.output && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-(--h-muted)">{s.output}</pre>}
                  </li>
                ))}
              </ol>
              {result.backupDir && <p className="text-[12px] text-(--h-muted)">{t("hermes.edit.backup")} <code className="font-mono">{result.backupDir}</code></p>}
              <div className="flex justify-end">
                <button type="button" onClick={onClose} className="rounded-md bg-(--h-text) px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">{t("hermes.edit.close")}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ id, label: text, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>{text}{hint && <span className="ml-1.5 font-normal text-(--h-faint)">{hint}</span>}</label>
      {children}
    </div>
  );
}

function DiffCard({ change }: { change: EditPlanView["changes"][number] }) {
  const rows = useMemo(() => withContext(lineDiff(change.before, change.after), 3), [change.before, change.after]);
  return (
    <section className="overflow-hidden rounded-lg border border-(--h-border)">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-(--h-border) bg-(--h-sunk) px-3 py-1.5">
        <span className="text-[12.5px] font-medium text-(--h-text-2)">{change.label}</span>
        <span className="break-all font-mono text-[11px] text-(--h-faint)">{change.path}</span>
      </div>
      <pre className="max-h-72 overflow-auto font-mono text-[11.5px] leading-[1.55]">
        {rows.map((r, i) => r.kind === "gap"
          ? <div key={i} className="bg-(--h-sunk) px-3 text-(--h-faint)">⋯ {r.count}</div>
          : <div key={i} className={`whitespace-pre-wrap break-words px-3 ${r.kind === "add" ? "bg-(--h-ok-soft) text-(--h-ok)" : r.kind === "del" ? "bg-(--h-bad-soft) text-(--h-bad)" : "text-(--h-muted)"}`}>
              {r.kind === "add" ? "+ " : r.kind === "del" ? "− " : "  "}{r.text || " "}
            </div>)}
      </pre>
    </section>
  );
}
