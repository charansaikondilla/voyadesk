import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown, ArrowUp, Bell, ChevronDown, Clock3, FlaskConical, Info, Lightbulb, Plus, Power, Sparkles, Trash2, Wand2, X, Zap,
} from "lucide-react";
import {
  LEAD_STAGES, type Automation, type AutomationField, type AutomationStepKind, type AutomationTestResult, type AutomationTrigger, type User,
} from "@voyadesk/core";
import { api, ApiError } from "../../lib/api";
import { invalidate, useList } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { toast } from "../../lib/toast";
import { Button, Callout, Confirm, Field, IconButton, IconChip, Input, Modal, MoneyInput, Segmented, Select, Skeleton, Textarea, Toggle, cx } from "../ui";
import {
  CHANNEL_LABEL, EVENT_TRIGGERS, FIELDS, MAX_STEPS, OP_LABEL, PAYMENT_LINK_TRIGGERS, PLACEHOLDERS, STAGE_LABEL, STEPS, STEP_ORDER, TEMP_LABEL, TIME_TRIGGERS, TRIGGERS,
  blankStep, conditionPhrase, conditionSuggestions, defaultCondition, defaultMessage, draftIssues, fieldsFor, fillSample, isTimeTrigger, newKey, paymentLinkAllowed,
  payloadOf, placeholdersFor, readableField, selectOptions, staffOnly, stepPhrase, suggestName, triggerSentence,
  type Condition, type Draft, type DraftStep, type Issue,
} from "./meta";
import { FlowChips, MessagePreview, StepNumber, TestResultView } from "./parts";

const STAGES = [
  { key: "when", label: "When", long: "When should it run?" },
  { key: "if", label: "If", long: "Only for some? (optional)" },
  { key: "then", label: "Then", long: "What should happen?" },
  { key: "name", label: "Save", long: "Name it and switch it on" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

/**
 * The When → If → Then builder. One question per screen, a live plain-English summary on the side,
 * and a dry run against real records before anything is saved.
 */
export function AutomationBuilder({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved?: (a: Automation) => void }) {
  const { settings, user } = useSession();
  const usersQ = useList("users");
  const users = useMemo(() => staffOnly(usersQ.data), [usersQ.data]);
  const ctx = { company: settings?.companyName || "your agency", owner: user?.name?.split(/\s+/)[0] || "Priya" };

  const [draft, setDraft] = useState<Draft>(initial);
  const [stage, setStage] = useState(0);
  const [nameTouched, setNameTouched] = useState(Boolean(initial.name.trim()));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; fields?: Record<string, string> | undefined } | null>(null);
  const [test, setTest] = useState<{ loading: boolean; result: AutomationTestResult | null; error: string | null; sig: string }>({ loading: false, result: null, error: null, sig: "" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const alive = useRef(true);
  const testRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => { alive.current = false; }, []);

  const suggestion = suggestName(draft, users);
  const finalDraft: Draft = { ...draft, name: nameTouched ? draft.name : suggestion };
  const issues = draftIssues(finalDraft);
  const issuesAt = (k: StageKey) => issues.filter((i) => i.where === k);
  const payload = payloadOf(finalDraft);
  const sig = JSON.stringify({ ...payload, name: "", description: "", active: true });
  const dirty = JSON.stringify(payloadOf(initial)) !== JSON.stringify(payload);
  const stale = test.result !== null && test.sig !== sig;
  const t = draft.trigger;
  const tm = t ? TRIGGERS[t] : null;

  const requestClose = () => {
    if (confirmDiscard) return; // Escape closes the confirm first
    if (dirty && !saving) setConfirmDiscard(true);
    else onClose();
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const pickTrigger = (nt: AutomationTrigger) => {
    if (nt === draft.trigger) return;
    const d = draft;
    const m = TRIGGERS[nt];
    const allowed = fieldsFor(nt);
    const kept = d.conditions.filter((c) => allowed.includes(c.field));
    const dropped = d.conditions.length - kept.length;
    if (dropped > 0) toast.info(`Removed ${dropped} rule${dropped === 1 ? "" : "s"} that don't apply to this`);
    // Re-seed the starter action only while the person hasn't touched it
    const first = d.steps[0];
    const untouched = d.steps.length === 1 && first !== undefined && first.message === defaultMessage(first.kind, d.trigger) && (first.kind === "send_message" || first.kind === "send_payment_link");
    const starterKind: AutomationStepKind = nt === "invoice_overdue" ? "send_payment_link" : "send_message";
    const steps = d.steps.length === 0 || untouched ? [blankStep(starterKind, nt)] : d.steps;
    setDraft({ ...d, trigger: nt, days: m.time ? m.defaultDays ?? 1 : 0, conditions: kept, steps });
  };

  const go = (to: number) => {
    if (to > stage) {
      const cur = issuesAt(STAGES[stage]!.key);
      if (cur.length) { setShowErrors(true); return; }
    }
    setStage(Math.max(0, Math.min(STAGES.length - 1, to)));
  };

  const runTest = async () => {
    if (!t || draft.steps.length === 0) return;
    setTest((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.action<AutomationTestResult>("testAutomation", { draft: { ...payload, name: payload.name || "Untitled automation" } });
      if (!alive.current) return;
      setTest({ loading: false, result: r, error: null, sig });
      window.requestAnimationFrame(() => testRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (e) {
      if (!alive.current) return;
      const err = e instanceof ApiError ? e : new ApiError(String(e), 500);
      setTest((s) => ({ ...s, loading: false, error: err.status === 404 ? "Testing isn't available yet on this workspace. You can still save it." : err.message }));
    }
  };

  const save = async () => {
    if (issues.length) {
      setShowErrors(true);
      const first = issues[0]!;
      setStage(STAGES.findIndex((s) => s.key === first.where));
      toast.error(first.text);
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const a = await api.action<Automation>("saveAutomation", payload);
      invalidate();
      toast.success(payload.active ? `“${payload.name}” is on — it's working for you now` : `“${payload.name}” saved and paused`);
      onSaved?.(a);
      onClose();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e), 500);
      if (!alive.current) return;
      setServerError({ message: err.message, fields: err.fields });
      toast.error(err.message);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const isLast = stage === STAGES.length - 1;

  return (
    <Modal open onClose={requestClose} size="xl" title={draft.id ? "Edit automation" : "New automation"}
      description="Tell VoyaDesk when to act, who it's for and what to do. It follows up so you don't have to."
      footer={<>
        <span className="mr-auto hidden self-center text-xs text-ink-500 sm:block">Step {stage + 1} of {STAGES.length}{stage === 1 ? " · optional" : ""}</span>
        {stage === 0 ? <Button variant="secondary" onClick={requestClose}>Cancel</Button> : <Button variant="secondary" onClick={() => go(stage - 1)}>Back</Button>}
        {draft.id && !isLast && <Button variant="soft" busy={saving} onClick={() => void save()}>Save now</Button>}
        {isLast
          ? <Button busy={saving} icon={finalDraft.active ? <Power className="size-4" /> : undefined} onClick={() => void save()}>{draft.id ? "Save changes" : finalDraft.active ? "Save & switch on" : "Save (paused)"}</Button>
          : <Button onClick={() => go(stage + 1)}>{stage === 1 && draft.conditions.length === 0 ? "Skip — run for everyone" : "Next"}</Button>}
      </>}>
      {/* stepper */}
      <nav aria-label="Builder steps" className="mb-5">
        <ol className="grid grid-cols-4 gap-1.5">
          {STAGES.map((s, i) => {
            const bad = showErrors && issuesAt(s.key).length > 0;
            const done = i < stage && issuesAt(s.key).length === 0;
            return (
              <li key={s.key}>
                <button type="button" onClick={() => go(i)} aria-current={i === stage ? "step" : undefined}
                  className={cx("flex w-full items-center gap-2 rounded-xl border px-2 py-2 text-left transition sm:px-3",
                    i === stage ? "border-brand-500 bg-brand-50/60 ring-[3px] ring-brand-100" : bad ? "border-rose-300 bg-rose-50/50" : "border-line bg-white hover:border-line-strong")}>
                  <StepNumber n={i + 1} done={done} active={i === stage} />
                  <span className="min-w-0">
                    <span className={cx("block text-[13px] font-semibold", i === stage ? "text-brand-800" : "text-ink-800")}>{s.label}</span>
                    <span className="hidden truncate text-[11px] text-ink-500 md:block">{s.long}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {serverError && (
            <div className="mb-4">
              <Callout tone="bad" title="Couldn't save yet">
                {serverError.message}
                {serverError.fields && Object.keys(serverError.fields).length > 0 && (
                  <ul className="mt-1 list-disc pl-4">{Object.entries(serverError.fields).map(([k, v]) => <li key={k}><b>{readableField(k)}:</b> {v}</li>)}</ul>
                )}
              </Callout>
            </div>
          )}
          {stage === 0 && <WhenStep draft={draft} onPick={pickTrigger} onDays={(days) => set({ days })} error={showErrors ? issuesAt("when")[0]?.text : undefined} />}
          {stage === 1 && <IfStep draft={draft} users={users} onChange={(conditions) => set({ conditions })} showErrors={showErrors} />}
          {stage === 2 && <ThenStep draft={draft} users={users} usersLoading={usersQ.loading && !usersQ.data} ctx={ctx} onChange={(steps) => set({ steps })} issues={showErrors ? issuesAt("then") : []} onGoWhen={() => setStage(0)} />}
          {stage === 3 && (
            <NameStep draft={finalDraft} users={users} suggestion={suggestion} nameTouched={nameTouched} tested={test.result !== null && !stale}
              onName={(name) => { setNameTouched(true); set({ name }); }} onUseSuggestion={() => { setNameTouched(false); set({ name: "" }); }}
              onDescription={(description) => set({ description })} onActive={(active) => set({ active })} error={showErrors ? issuesAt("name")[0]?.text : undefined} />
          )}
        </div>

        {/* live summary */}
        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-slate-50 to-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">In plain words</span>
              {finalDraft.active ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500" />Will be on</span> : <span className="text-[11px] font-medium text-ink-500">Paused</span>}
            </div>
            <div className="space-y-3.5 p-4 text-sm">
              <SummaryBlock label="When" onClick={() => setStage(0)} bad={showErrors && issuesAt("when").length > 0}>
                {t ? <span className="flex items-start gap-2"><span className="mt-0.5 text-brand-600 [&_svg]:size-4">{tm!.icon}</span><span className="font-medium text-ink-900">{triggerSentence(t, draft.days)}</span></span>
                  : <span className="text-ink-400">Not chosen yet</span>}
              </SummaryBlock>
              <SummaryBlock label="If" onClick={() => setStage(1)} bad={showErrors && issuesAt("if").length > 0}>
                {draft.conditions.length === 0 ? <span className="text-ink-500">{tm ? `Every ${tm.noun}` : "Everyone"}</span> : (
                  <ul className="space-y-1">{draft.conditions.map((c, i) => <li key={c._k} className="text-ink-800">{i > 0 && <span className="text-ink-400">and </span>}{conditionPhrase(c, t, users)}</li>)}</ul>
                )}
              </SummaryBlock>
              <SummaryBlock label="Then" onClick={() => setStage(2)} bad={showErrors && issuesAt("then").length > 0}>
                {draft.steps.length === 0 ? <span className="text-ink-400">No actions yet</span> : (
                  <ol className="space-y-1.5">
                    {draft.steps.map((s, i) => (
                      <li key={s._k} className="flex items-start gap-2">
                        <IconChip tone={STEPS[s.kind].tone} size="sm">{STEPS[s.kind].icon}</IconChip>
                        <span className="pt-0.5 text-ink-800"><span className="text-ink-400">{i + 1}.</span> {stepPhrase(s, users)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </SummaryBlock>
            </div>
            <div className="border-t border-line bg-white p-3">
              <Button variant="secondary" className="w-full" icon={<FlaskConical className="size-4" />} busy={test.loading} disabled={!t || draft.steps.length === 0} onClick={() => void runTest()}>
                {test.result && !stale ? "Test again" : "Test with real data"}
              </Button>
              <p className="mt-1.5 text-center text-[11px] leading-4 text-ink-500">{stale ? "You changed something — test again to refresh." : "Shows who'd be affected. Nothing is sent."}</p>
            </div>
          </div>

          <div ref={testRef} aria-live="polite">
            {test.loading && !test.result && <div className="space-y-2 rounded-2xl border border-line bg-white p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
            {test.error && <Callout tone="warn">{test.error}</Callout>}
            {test.result && (
              <div className={cx("rounded-2xl border border-line bg-white p-4 transition-opacity", (stale || test.loading) && "opacity-60")}>
                <TestResultView result={test.result} willBeActive={finalDraft.active} />
              </div>
            )}
          </div>
        </aside>
      </div>

      <Confirm open={confirmDiscard} onClose={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); onClose(); }} danger
        title="Discard your changes?" confirmLabel="Discard" message="You haven't saved this automation. If you close now, your changes will be lost." />
    </Modal>
  );
}

function SummaryBlock({ label, children, onClick, bad }: { label: string; children: ReactNode; onClick: () => void; bad?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx("block w-full rounded-lg text-left transition-colors -m-1 p-1 hover:bg-slate-100/70", bad && "ring-1 ring-rose-300")} aria-label={`Edit the ${label} part`}>
      <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{label}</span>
      {children}
    </button>
  );
}

function StageHeading({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink-900">{title}</h3>
      {hint && <p className="mt-0.5 text-[13px] leading-5 text-ink-500">{hint}</p>}
    </div>
  );
}

/* ───────────────────────── ① WHEN ───────────────────────── */

const DAY_PRESETS: Partial<Record<AutomationTrigger, number[]>> = {
  lead_idle: [1, 2, 3, 7], quote_idle: [2, 3, 5, 7], invoice_overdue: [0, 1, 3, 7], trip_upcoming: [1, 3, 7, 14], trip_completed: [1, 2, 7, 30],
};

function WhenStep({ draft, onPick, onDays, error }: { draft: Draft; onPick: (t: AutomationTrigger) => void; onDays: (d: number) => void; error?: string | undefined }) {
  const card = (t: AutomationTrigger) => {
    const m = TRIGGERS[t];
    const on = draft.trigger === t;
    return (
      <div key={t} className={cx("rounded-xl border transition", on ? "border-brand-500 bg-brand-50/50 ring-[3px] ring-brand-100" : "border-line bg-white hover:border-line-strong hover:shadow-xs")}>
        <button type="button" role="radio" aria-checked={on} onClick={() => onPick(t)} className="flex w-full items-start gap-3 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-brand-600">
          <IconChip tone={on ? "blue" : "gray"}>{m.icon}</IconChip>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink-900">{m.label}</span>
            <span className="block text-xs leading-5 text-ink-500">{m.hint}</span>
          </span>
        </button>
        {on && m.time && <DaysSentence t={t} days={draft.days} onDays={onDays} />}
      </div>
    );
  };
  return (
    <div>
      <StageHeading title="When should it run?" hint="Pick the moment you'd normally have to remember to do something." />
      {error && <div className="mb-3"><Callout tone="bad">{error}</Callout></div>}
      <section aria-labelledby="grp-events">
        <h4 id="grp-events" className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Zap className="size-3.5" />Something happens</h4>
        <div role="radiogroup" aria-labelledby="grp-events" className="grid gap-2 sm:grid-cols-2">{EVENT_TRIGGERS.map(card)}</div>
      </section>
      <section aria-labelledby="grp-time" className="mt-5">
        <h4 id="grp-time" className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Clock3 className="size-3.5" />Time passes</h4>
        <div role="radiogroup" aria-labelledby="grp-time" className="grid gap-2 sm:grid-cols-2">{TIME_TRIGGERS.map(card)}</div>
        <p className="mt-2 text-xs text-ink-500">Time-based automations check every minute, so nobody slips through — even at 2 am.</p>
      </section>
    </div>
  );
}

function DaysSentence({ t, days, onDays }: { t: AutomationTrigger; days: number; onDays: (d: number) => void }) {
  const m = TRIGGERS[t];
  const min = m.minDays ?? 0;
  const [text, setText] = useState(String(days));
  useEffect(() => { if (Number(text) !== days) setText(String(days)); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = !Number.isInteger(days) || days < min || days > 365;
  return (
    <div className="border-t border-brand-200/70 px-3 pb-3 pt-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-800">
        {m.before && <span>{m.before}</span>}
        <Input type="number" inputMode="numeric" min={min} max={365} value={text} invalid={bad} aria-label="Number of days" className="h-9 w-[72px] text-center tabular-nums"
          onChange={(e) => { setText(e.target.value); const n = e.target.value === "" ? NaN : Number(e.target.value); onDays(Number.isNaN(n) ? -1 : Math.floor(n)); }} />
        <span>{m.after}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Quick picks">
        {(DAY_PRESETS[t] ?? []).map((n) => (
          <button key={n} type="button" aria-pressed={days === n} onClick={() => onDays(n)}
            className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition", days === n ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-ink-600 ring-line hover:ring-line-strong")}>
            {n === 0 ? (t === "invoice_overdue" ? "On due date" : "Same day") : `${n} day${n === 1 ? "" : "s"}`}
          </button>
        ))}
      </div>
      {bad && <p className="mt-1.5 text-xs text-rose-600">Use a whole number from {min} to 365.</p>}
    </div>
  );
}

/* ───────────────────────── ② IF ───────────────────────── */

function IfStep({ draft, users, onChange, showErrors }: { draft: Draft; users: User[]; onChange: (c: Draft["conditions"]) => void; showErrors: boolean }) {
  const t = draft.trigger;
  const tm = t ? TRIGGERS[t] : null;
  const fields = fieldsFor(t);
  if (!t || !tm) return <Callout tone="info">First choose <b>when</b> it should run — then you can narrow it down here.</Callout>;
  const add = (c?: Condition) => onChange([...draft.conditions, { ...(c ?? defaultCondition(fields[0]!, t, users)), _k: newKey() }]);
  const update = (i: number, c: Condition) => onChange(draft.conditions.map((x, j) => (j === i ? { ...c, _k: x._k } : x)));
  const remove = (i: number) => onChange(draft.conditions.filter((_, j) => j !== i));
  const suggestions = conditionSuggestions(t).filter((s) => fields.includes(s.c.field) && !draft.conditions.some((c) => c.field === s.c.field && c.value === s.c.value));
  return (
    <div>
      <StageHeading title="Only for some of them?" hint={`Leave this empty to run for every ${tm.noun}. Add a rule to narrow it down.`} />
      {draft.conditions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-slate-50/60 px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink-800">Runs for every {tm.noun}</p>
          <p className="mt-0.5 text-xs text-ink-500">That's usually what you want. Need to be pickier? Try one of these:</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {draft.conditions.map((c, i) => (
            <li key={c._k}>
              {i > 0 && <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400"><span className="h-px flex-1 bg-line" />and<span className="h-px flex-1 bg-line" /></div>}
              <ConditionRow c={c} index={i} t={t} fields={fields} users={users} onChange={(nc) => update(i, nc)} onRemove={() => remove(i)} showError={showErrors} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => add()}>Add a rule</Button>
        {suggestions.map((s) => (
          <button key={s.label} type="button" onClick={() => add(s.c)} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink-700 ring-1 ring-inset ring-line transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200">
            <Plus className="size-3" />{s.label}
          </button>
        ))}
      </div>
      {draft.conditions.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] leading-5 text-ink-700">
          <Info className="mt-0.5 size-4 shrink-0 text-ink-400" />
          <span>Runs for every {tm.noun} <b className="font-semibold text-ink-900">{draft.conditions.map((c) => conditionPhrase(c, t, users)).join(" and ")}</b>.</span>
        </div>
      )}
    </div>
  );
}

function ConditionRow({ c, index, t, fields, users, onChange, onRemove, showError }: {
  c: Condition; index: number; t: AutomationTrigger; fields: AutomationField[]; users: User[]; onChange: (c: Condition) => void; onRemove: () => void; showError: boolean;
}) {
  const m = FIELDS[c.field];
  const empty = !c.value.trim();
  const n = index + 1;
  let input: ReactNode;
  if (m.kind === "select") {
    const opts = selectOptions(c.field, t, users);
    input = (
      <Select value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label={`Rule ${n} value`} invalid={showError && empty}>
        {!opts.some((o) => o.value === c.value) && <option value="">{opts.length ? "Choose…" : "Nothing to choose"}</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    );
  } else if (m.kind === "money") {
    input = <MoneyInput value={c.value && !Number.isNaN(Number(c.value)) ? Number(c.value) : null} onChange={(v) => onChange({ ...c, value: v === null ? "" : String(v) })} invalid={showError && empty} aria-label={`Rule ${n} amount`} placeholder="1,00,000" />;
  } else if (m.kind === "number") {
    input = <Input type="number" inputMode="numeric" min={0} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} invalid={showError && empty} aria-label={`Rule ${n} number`} placeholder={m.hint ?? "0"} />;
  } else {
    input = <Input value={c.value} maxLength={120} onChange={(e) => onChange({ ...c, value: e.target.value })} invalid={showError && empty} aria-label={`Rule ${n} text`} placeholder={c.field === "country" ? "e.g. Schengen, Dubai" : "e.g. Bali, Kerala"} />;
  }
  return (
    <div className="rounded-xl border border-line bg-white p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] sm:items-center">
        <Select value={c.field} aria-label={`Rule ${n} field`} onChange={(e) => onChange(defaultCondition(e.target.value as AutomationField, t, users))}>
          {fields.map((f) => <option key={f} value={f}>{FIELDS[f].label}</option>)}
        </Select>
        <div className="sm:order-last"><IconButton label={`Remove rule ${n}`} onClick={onRemove}><X className="size-4" /></IconButton></div>
        <Select value={c.op} aria-label={`Rule ${n} comparison`} onChange={(e) => onChange({ ...c, op: e.target.value as Condition["op"] })} className="col-span-2 sm:col-span-1">
          {m.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
        </Select>
        <div className="col-span-2 sm:col-span-1">{input}</div>
      </div>
      {showError && empty && <p className="mt-1.5 text-xs text-rose-600">Enter a value, or remove this rule.</p>}
    </div>
  );
}

/* ───────────────────────── ③ THEN ───────────────────────── */

function ThenStep({ draft, users, usersLoading, ctx, onChange, issues, onGoWhen }: {
  draft: Draft; users: User[]; usersLoading: boolean; ctx: { company: string; owner: string }; onChange: (s: DraftStep[]) => void; issues: Issue[]; onGoWhen: () => void;
}) {
  const t = draft.trigger;
  const [openKey, setOpenKey] = useState<string | null>(draft.steps[0]?._k ?? null);
  const [picking, setPicking] = useState(draft.steps.length === 0);
  if (!t) return <Callout tone="info">First choose <b>when</b> it should run — the actions depend on it.</Callout>;
  const full = draft.steps.length >= MAX_STEPS;
  const add = (kind: AutomationStepKind) => {
    const s = blankStep(kind, t);
    onChange([...draft.steps, s]);
    setOpenKey(s._k);
    setPicking(false);
  };
  const update = (i: number, patch: Partial<DraftStep>) => onChange(draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (i: number) => onChange(draft.steps.filter((_, j) => j !== i));
  return (
    <div>
      <StageHeading title="What should happen?" hint="Actions run in this order, one after another. Messages go from your connected WhatsApp, email or SMS." />
      {issues.some((i) => i.index === undefined) && <div className="mb-3"><Callout tone="bad">{issues.find((i) => i.index === undefined)!.text}</Callout></div>}
      <ol className="space-y-2">
        {draft.steps.map((s, i) => {
          const open = openKey === s._k;
          const err = issues.find((x) => x.index === i);
          const m = STEPS[s.kind];
          return (
            <li key={s._k} className={cx("rounded-xl border bg-white transition", open ? "border-line-strong shadow-card" : "border-line", err && "border-rose-300")}>
              <div className="flex items-center gap-2 p-2.5">
                <button type="button" onClick={() => setOpenKey(open ? null : s._k)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand-600">
                  <span className="w-4 shrink-0 text-center text-xs font-semibold tabular-nums text-ink-400">{i + 1}</span>
                  <IconChip tone={m.tone} size="sm">{m.icon}</IconChip>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-900">{m.label}</span>
                    {!open && <span className={cx("block truncate text-xs", err ? "text-rose-600" : "text-ink-500")}>{err ? err.text.replace(/^Action \d+: /, "") : stepPhrase(s, users)}</span>}
                  </span>
                  <ChevronDown className={cx("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")} />
                </button>
                <div className="flex shrink-0 items-center">
                  <IconButton label={`Move action ${i + 1} up`} onClick={() => move(i, -1)} className={cx(i === 0 && "pointer-events-none opacity-30")}><ArrowUp className="size-4" /></IconButton>
                  <IconButton label={`Move action ${i + 1} down`} onClick={() => move(i, 1)} className={cx(i === draft.steps.length - 1 && "pointer-events-none opacity-30")}><ArrowDown className="size-4" /></IconButton>
                  <IconButton label={`Remove action ${i + 1}`} onClick={() => remove(i)} className="hover:!text-rose-600"><Trash2 className="size-4" /></IconButton>
                </div>
              </div>
              {open && (
                <div className="border-t border-line px-3 pb-3 pt-3 sm:px-4">
                  <StepEditor s={s} t={t} users={users} usersLoading={usersLoading} ctx={ctx} onChange={(p) => update(i, p)} error={err?.text} onGoWhen={onGoWhen} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {picking && !full ? (
        <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-900">Add an action</span>
            {draft.steps.length > 0 && <IconButton label="Close action picker" onClick={() => setPicking(false)}><X className="size-4" /></IconButton>}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {STEP_ORDER.map((k) => {
              const m = STEPS[k];
              const blocked = k === "send_payment_link" && !paymentLinkAllowed(t);
              return (
                <button key={k} type="button" disabled={blocked} onClick={() => add(k)}
                  className="flex items-start gap-2.5 rounded-lg border border-line bg-white p-2.5 text-left transition hover:border-brand-300 hover:shadow-xs disabled:cursor-not-allowed disabled:bg-slate-50 disabled:hover:border-line disabled:hover:shadow-none">
                  <IconChip tone={blocked ? "gray" : m.tone} size="sm">{m.icon}</IconChip>
                  <span className="min-w-0">
                    <span className={cx("block text-[13px] font-semibold", blocked ? "text-ink-500" : "text-ink-900")}>{m.label}</span>
                    <span className="block text-[11.5px] leading-4 text-ink-500">{blocked ? "Only when there's money to collect — e.g. a payment is overdue, a booking is confirmed or a trip is coming up." : m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} disabled={full} onClick={() => setPicking(true)}>Add another action</Button>
          <span className="text-xs text-ink-500">{full ? `That's the maximum of ${MAX_STEPS}.` : `${draft.steps.length} of ${MAX_STEPS}`}</span>
        </div>
      )}
    </div>
  );
}

const DUE_OPTIONS = [0, 1, 2, 3, 5, 7, 14, 30];

function StepEditor({ s, t, users, usersLoading, ctx, onChange, error, onGoWhen }: {
  s: DraftStep; t: AutomationTrigger; users: User[]; usersLoading: boolean; ctx: { company: string; owner: string }; onChange: (p: Partial<DraftStep>) => void; error?: string | undefined; onGoWhen: () => void;
}) {
  const fieldErr = error?.replace(/^Action \d+: /, "");
  const peopleSelect = (label: string, nullLabel: string) => (
    <Field label={label} hint={usersLoading ? "Loading your team…" : undefined}>
      <Select value={s.userId ?? ""} onChange={(e) => onChange({ userId: e.target.value || null })} aria-label={label}>
        <option value="">{nullLabel}</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ""}</option>)}
      </Select>
    </Field>
  );
  switch (s.kind) {
    case "send_message":
    case "send_payment_link":
      return (
        <div className="space-y-3">
          {s.kind === "send_payment_link" && !paymentLinkAllowed(t) && (
            <Callout tone="bad" title="This won't work with the current “When”">
              A payment link needs a balance to collect. It works with: {PAYMENT_LINK_TRIGGERS.map((x) => TRIGGERS[x].label.toLowerCase()).join(", ")}.{" "}
              <button type="button" onClick={onGoWhen} className="font-semibold underline">Change “When”</button> or remove this action.
            </Callout>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-ink-700">Send by</span>
            <Segmented size="sm" label="Channel" value={s.channel} onChange={(channel) => onChange({ channel })}
              options={(["whatsapp", "email", "sms"] as const).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
          </div>
          <MessageComposer value={s.message} onChange={(message) => onChange({ message })} keys={placeholdersFor(s.kind, t)} error={fieldErr} label={s.kind === "send_payment_link" ? "Message with the link" : "Message"}
            hint={s.kind === "send_payment_link" ? "The secure link and amount are added automatically — use {link} and {amount} to place them." : undefined} />
          <MessagePreview text={fillSample(s.message, ctx)} channel={s.channel} company={ctx.company} />
          {s.channel === "whatsapp" && <p className="flex items-start gap-1.5 text-[11.5px] leading-4 text-ink-500"><Lightbulb className="mt-px size-3.5 shrink-0" />Keep it short and personal — people reply to messages that sound like you, not a robot.</p>}
        </div>
      );
    case "notify_owner":
      return (
        <div className="space-y-3">
          <MessageComposer value={s.message} onChange={(message) => onChange({ message })} keys={placeholdersFor(s.kind, t)} error={fieldErr} label="What should the alert say?" hint="Goes to the person who owns the lead or booking." />
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3">
            <IconChip tone="amber" size="sm"><Bell /></IconChip>
            <div className="min-w-0 text-[13px] leading-5"><div className="text-xs font-medium text-amber-800">VoyaDesk alert · to {ctx.owner}</div><p className="whitespace-pre-wrap break-words text-ink-800">{fillSample(s.message, ctx) || "…"}</p></div>
          </div>
        </div>
      );
    case "create_task":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Task" className="sm:col-span-2" error={fieldErr}>
            <Input value={s.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. Call the customer about dates" invalid={Boolean(fieldErr)} />
          </Field>
          <Field label="Due">
            <Select value={String(s.dueInDays)} onChange={(e) => onChange({ dueInDays: Number(e.target.value) })}>
              {(DUE_OPTIONS.includes(s.dueInDays) ? DUE_OPTIONS : [...DUE_OPTIONS, s.dueInDays].sort((a, b) => a - b)).map((d) => (
                <option key={d} value={d}>{d === 0 ? "Same day" : d === 1 ? "Next day" : `In ${d} days`}</option>
              ))}
            </Select>
          </Field>
          {peopleSelect("For", "Whoever owns the record")}
        </div>
      );
    case "assign_owner":
      return (
        <div className="space-y-2">
          {peopleSelect("Assign to", "Share fairly among the sales team (round-robin)")}
          <p className="text-xs leading-5 text-ink-500">{s.userId ? "Every match goes to this person." : "Each new one goes to the next salesperson in turn, so nobody is overloaded."}</p>
        </div>
      );
    case "set_temperature":
      return (
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700">Mark the lead as</span>
          <Segmented label="Mark the lead as" value={s.value || "hot"} onChange={(value) => onChange({ value })} options={["hot", "warm", "cold"].map((v) => ({ value: v, label: TEMP_LABEL[v] ?? v }))} />
        </div>
      );
    case "set_stage":
      return (
        <Field label="Move the lead to" error={fieldErr}>
          <Select value={s.value} onChange={(e) => onChange({ value: e.target.value })}>
            {!s.value && <option value="">Choose a stage…</option>}
            {LEAD_STAGES.map((v) => <option key={v} value={v}>{STAGE_LABEL[v]}</option>)}
          </Select>
        </Field>
      );
    case "add_tag":
      return (
        <Field label="Tag" error={fieldErr} hint="A short label like honeymoon, vip or review-asked — handy for lists and campaigns.">
          <Input value={s.title} maxLength={40} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. honeymoon" invalid={Boolean(fieldErr)} />
        </Field>
      );
  }
}

function MessageComposer({ value, onChange, keys, error, label, hint }: { value: string; onChange: (v: string) => void; keys: string[]; error?: string | undefined; label: string; hint?: string | undefined }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (k: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const pad = start > 0 && !/\s$/.test(value.slice(0, start)) ? " " : "";
    const next = `${value.slice(0, start)}${pad}${k}${value.slice(end)}`;
    onChange(next.slice(0, 2000));
    window.requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + pad.length + k.length;
      el.setSelectionRange(pos, pos);
    });
  };
  return (
    <div>
      <Field label={label} error={error} hint={hint}>
        <Textarea ref={ref} value={value} maxLength={2000} rows={4} onChange={(e) => onChange(e.target.value)} invalid={Boolean(error)} placeholder="Hi {name}, …" />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Insert a detail">
        <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-ink-500"><Wand2 className="size-3" />Insert:</span>
        {PLACEHOLDERS.filter((p) => keys.includes(p.key)).map((p) => (
          <button key={p.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.key)} title={`Adds ${p.key}`}
            className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-700 transition hover:bg-brand-50 hover:text-brand-700">
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── ④ NAME & SAVE ───────────────────────── */

function NameStep({ draft, users, suggestion, nameTouched, tested, onName, onUseSuggestion, onDescription, onActive, error }: {
  draft: Draft; users: User[]; suggestion: string; nameTouched: boolean; tested: boolean; onName: (n: string) => void; onUseSuggestion: () => void;
  onDescription: (d: string) => void; onActive: (a: boolean) => void; error?: string | undefined;
}) {
  return (
    <div className="space-y-4">
      <StageHeading title="Name it and switch it on" hint="A clear name helps your team know what's running." />
      {draft.trigger && (
        <div className="rounded-xl border border-line bg-slate-50/70 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Sparkles className="size-3.5" />Here's what you're setting up</div>
          <FlowChips trigger={draft.trigger} days={draft.days} conditions={draft.conditions} steps={draft.steps} users={users} />
        </div>
      )}
      <Field label="Name" required error={error} hint={!nameTouched && suggestion ? "Suggested from what you picked — change it if you like." : undefined}>
        <Input value={draft.name} maxLength={160} onChange={(e) => onName(e.target.value)} placeholder="e.g. Welcome new Meta Ads leads" invalid={Boolean(error)} />
      </Field>
      {nameTouched && suggestion && draft.name !== suggestion && (
        <button type="button" onClick={onUseSuggestion} className="-mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Wand2 className="size-3" />Use “{suggestion}”</button>
      )}
      <Field label="Note for your team (optional)">
        <Textarea value={draft.description} maxLength={300} rows={2} onChange={(e) => onDescription(e.target.value)} placeholder="e.g. So no Meta lead waits more than a minute for a reply" className="min-h-[60px]" />
      </Field>
      <div className={cx("rounded-xl border p-3 transition-colors", draft.active ? "border-emerald-200 bg-emerald-50/50" : "border-line")}>
        <Toggle checked={draft.active} onChange={onActive} label={
          <span><span className="block text-sm font-medium text-ink-900">{draft.active ? "Switch on right away" : "Keep it paused for now"}</span>
            <span className="block text-xs text-ink-500">{draft.active ? (isTimeTrigger(draft.trigger) ? "Starts checking within a minute." : "Runs the next time this happens.") : "Nothing runs until you switch it on from the list."}</span></span>
        } />
      </div>
      {!tested && draft.active && (
        <Callout tone="info">Not sure? Press <b>Test with real data</b> to see exactly who'd be affected before you switch it on.</Callout>
      )}
    </div>
  );
}
