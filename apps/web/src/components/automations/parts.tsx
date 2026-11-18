import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, Mail, MoreHorizontal, Smartphone, Users } from "lucide-react";
import type { AutomationRun, AutomationTestResult, AutomationTrigger, User } from "@voyadesk/core";
import { relTime } from "../../lib/format";
import { Badge, Callout, IconChip, cx } from "../ui";
import {
  CHANNEL_LABEL, RUN_STATUS, STEPS, SUBJECT_LABEL, TRIGGERS, conditionPhrase, isTimeTrigger, stepPhrase, subjectPath, triggerSentence,
  type Condition, type Step,
} from "./meta";

/* ───────────────────────── overflow menu (keyboard friendly) ───────────────────────── */

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }

export function OverflowMenu({ label, items }: { label: string; items: (MenuItem | false | null | undefined)[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const real = items.filter(Boolean) as MenuItem[];
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [open]);
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };
  if (real.length === 0) return null;
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-slate-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-600">
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => close(false)} aria-hidden />
          <div id={id} ref={list} role="menu" aria-label={label} onKeyDown={onKey} className="absolute right-0 z-40 mt-1 w-56 animate-pop-in rounded-xl border border-line bg-white p-1 text-sm shadow-pop">
            {real.map((it) => (
              <button key={it.label} type="button" role="menuitem" disabled={it.disabled} title={it.hint}
                onClick={() => { setOpen(false); it.onSelect(); }}
                className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                  it.danger ? "text-rose-700 hover:bg-rose-50 focus:bg-rose-50" : "text-ink-800 hover:bg-slate-50 focus:bg-slate-50")}>
                <span className={cx("[&_svg]:size-4", it.danger ? "text-rose-500" : "text-ink-400")}>{it.icon}</span>
                <span className="min-w-0 flex-1">{it.label}{it.hint && it.disabled && <span className="block text-[11px] text-ink-500">{it.hint}</span>}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── the automation as a sentence of chips ───────────────────────── */

const CHIP_TONE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200/70", blue: "bg-brand-50 text-brand-800 ring-brand-200/70", violet: "bg-violet-50 text-violet-800 ring-violet-200/70",
  red: "bg-rose-50 text-rose-800 ring-rose-200/70", cyan: "bg-cyan-50 text-cyan-800 ring-cyan-200/70", gray: "bg-slate-100 text-slate-700 ring-slate-200/80", amber: "bg-amber-50 text-amber-800 ring-amber-200/70",
};

export function FlowChips({ trigger, days, conditions, steps, users, size = "md", className }: {
  trigger: AutomationTrigger; days: number; conditions: Condition[]; steps: Step[]; users: User[]; size?: "sm" | "md"; className?: string;
}) {
  const t = TRIGGERS[trigger] as (typeof TRIGGERS)[AutomationTrigger] | undefined;
  if (!t) return null;
  const chip = cx("inline-flex max-w-full items-center gap-1 rounded-md ring-1 ring-inset [&_svg]:size-3.5 [&_svg]:shrink-0", size === "sm" ? "px-1.5 py-0.5 text-[11.5px]" : "px-2 py-0.5 text-[12.5px]");
  return (
    <div className={cx("flex min-w-0 flex-wrap items-center gap-1.5 leading-5", className)}>
      <span className={cx(chip, "bg-ink-900 font-medium text-white ring-ink-900")}>{t.icon}<span className="truncate">{triggerSentence(trigger, days)}</span></span>
      {conditions.map((c, i) => (
        <span key={i} className={cx(chip, CHIP_TONE.gray)}><span className="truncate">{conditionPhrase(c, trigger, users)}</span></span>
      ))}
      <ArrowRight className="size-3.5 shrink-0 text-ink-400" aria-label="then" />
      {steps.map((s, i) => (
        <span key={i} className={cx(chip, CHIP_TONE[STEPS[s.kind].tone])}>{STEPS[s.kind].icon}<span className="truncate">{stepPhrase(s, users)}</span></span>
      ))}
    </div>
  );
}

/* ───────────────────────── run status dots ───────────────────────── */

export function RunDots({ runs }: { runs: AutomationRun[] }) {
  if (runs.length === 0) return <span className="text-xs text-ink-400">No runs yet</span>;
  const label = runs.map((r) => RUN_STATUS[r.status].label).join(", ");
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Last ${runs.length} runs: ${label}`}>
      {[...runs].reverse().map((r) => (
        <span key={r.id} title={`${RUN_STATUS[r.status].label} · ${r.subjectName || SUBJECT_LABEL[r.subjectType]} · ${relTime(r.at)}`} className={cx("h-3 w-1.5 rounded-full", RUN_STATUS[r.status].dot)} />
      ))}
    </span>
  );
}

/* ───────────────────────── message preview ───────────────────────── */

export function MessagePreview({ text, channel, company, label = "Customer receives" }: { text: string; channel: Step["channel"]; company: string; label?: string }) {
  const time = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (channel === "email") {
    return (
      <div className="rounded-xl border border-line bg-slate-50 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500"><Mail className="size-3.5" />{label}</div>
        <div className="rounded-lg bg-white p-3 shadow-xs">
          <div className="border-b border-line pb-2 text-xs text-ink-500"><span className="font-semibold text-ink-800">{company}</span> · to Rahul</div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-800">{text || <span className="text-ink-400">Your message will appear here…</span>}</p>
        </div>
      </div>
    );
  }
  if (channel === "sms") {
    return (
      <div className="rounded-xl border border-line bg-slate-50 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500"><Smartphone className="size-3.5" />{label}</div>
        <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-slate-200/80 px-3 py-2 text-[13px] leading-5 text-ink-900">
          <p className="whitespace-pre-wrap break-words">{text || <span className="text-ink-400">Your message will appear here…</span>}</p>
        </div>
        <div className="mt-1 text-[11px] text-ink-500">{text.length} characters{text.length > 160 ? ` · sent as ${Math.ceil(text.length / 153)} SMS` : ""}</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-[#e7f6e9] p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800/70">{label} on WhatsApp</div>
      <div className="relative max-w-[92%] rounded-lg rounded-tl-none bg-white px-3 pb-1.5 pt-2 text-[13px] leading-5 text-ink-800 shadow-xs">
        <p className="whitespace-pre-wrap break-words">{text || <span className="text-ink-400">Your message will appear here…</span>}</p>
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-ink-400">{time}<CheckCheck className="size-3.5 text-sky-500" /></div>
      </div>
    </div>
  );
}

/* ───────────────────────── dry-run results ───────────────────────── */

export function TestResultView({ result, linkable, willBeActive }: { result: AutomationTestResult; linkable?: boolean; willBeActive?: boolean }) {
  const time = isTimeTrigger(result.trigger);
  const fresh = result.matches.filter((m) => !m.alreadyRan);
  const [all, setAll] = useState(false);
  const shown = all ? result.matches : result.matches.slice(0, 6);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <IconChip tone={result.matches.length ? "blue" : "gray"}><Users /></IconChip>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink-900">
            {result.matches.length === 0 ? "Nobody matches right now" : `${result.matches.length} ${result.matches.length === 1 ? "match" : "matches"}${time ? " due now" : " in the last 30 days"}`}
          </div>
          <div className="text-xs leading-5 text-ink-500">
            {result.matches.length === 0
              ? time ? "That's fine — it will pick people up as soon as they qualify." : "It will run the next time this happens."
              : `${fresh.length} would get this${result.matches.length - fresh.length ? ` · ${result.matches.length - fresh.length} already did` : ""}. Nothing was sent — this is a preview.`}
          </div>
        </div>
      </div>

      {time && willBeActive && fresh.length > 0 && (
        <Callout tone="warn" title="Heads-up">Once saved and switched on, {fresh.length === 1 ? "this person" : `these ${fresh.length} people`} will be contacted within a minute.</Callout>
      )}

      {result.matches.length > 0 && (
        <ul className="divide-y divide-line/80 overflow-hidden rounded-xl border border-line bg-white">
          {shown.map((m) => (
            <li key={`${m.subjectType}:${m.subjectId}`} className="flex items-start gap-2.5 px-3 py-2">
              <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", m.alreadyRan ? "bg-slate-300" : "bg-brand-500")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {linkable ? <Link to={subjectPath(m.subjectType, m.subjectId)} className="truncate text-sm font-medium text-ink-900 hover:text-brand-700">{m.name || SUBJECT_LABEL[m.subjectType]}</Link>
                    : <span className="truncate text-sm font-medium text-ink-900">{m.name || SUBJECT_LABEL[m.subjectType]}</span>}
                  <Badge tone="gray">{SUBJECT_LABEL[m.subjectType]}</Badge>
                  {m.alreadyRan && <Badge tone="gray" dot>Already done</Badge>}
                </div>
                {m.reason && <div className="text-xs leading-5 text-ink-500">{m.reason}</div>}
              </div>
            </li>
          ))}
          {result.matches.length > 6 && (
            <li className="px-3 py-1.5 text-center"><button type="button" onClick={() => setAll((a) => !a)} className="text-xs font-medium text-brand-700 hover:underline">{all ? "Show fewer" : `Show all ${result.matches.length}`}</button></li>
          )}
        </ul>
      )}

      {result.preview.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">What would happen{result.matches[0] ? ` for ${result.matches[0].name}` : ""}</div>
          <ol className="space-y-1.5">
            {result.preview.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-2.5 py-2">
                <IconChip tone={STEPS[p.kind].tone} size="sm">{STEPS[p.kind].icon}</IconChip>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink-500">{i + 1}. {STEPS[p.kind].label}</div>
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-800">{p.summary}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="space-y-1.5">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-2.5 py-2 text-[13px] leading-5 text-amber-900"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />{w}</div>
          ))}
        </div>
      )}
      {result.matches.length > 0 && result.warnings.length === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" />Looks good — no problems found.</div>
      )}
    </div>
  );
}

export function StepNumber({ n, done, active }: { n: number; done?: boolean; active?: boolean }) {
  return (
    <span className={cx("inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
      active ? "bg-brand-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 text-ink-600")}>
      {done && !active ? <CheckCheck className="size-3" /> : n}
    </span>
  );
}

export const channelWord = (c: Step["channel"]) => CHANNEL_LABEL[c];
