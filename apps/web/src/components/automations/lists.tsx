import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Copy, FlaskConical, History, Pencil, PlayCircle, Plus, Sparkles, Trash2, Wand2, XCircle,
} from "lucide-react";
import type { Automation, AutomationRun, AutomationTemplate, AutomationTestResult, User } from "@voyadesk/core";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatDateTime, relTime } from "../../lib/format";
import { Badge, Button, Callout, Empty, IconChip, Modal, SearchInput, Segmented, Select, Skeleton, Toggle, cx } from "../ui";
import {
  CATEGORIES, CATEGORY, RUN_STATUS, STEPS, SUBJECT_LABEL, TRIGGERS, isTimeTrigger, subjectPath, type Category,
} from "./meta";
import { FlowChips, OverflowMenu, RunDots, TestResultView } from "./parts";

/* ───────────────────────── one automation, read as a sentence ───────────────────────── */

export function AutomationCard({ a, active, runs, attention, users, category, writable, onToggle, onEdit, onTest, onRunNow, onDuplicate, onDelete }: {
  a: Automation; active: boolean; runs: AutomationRun[]; attention: number; users: User[]; category: Category; writable: boolean;
  onToggle: (v: boolean) => void; onEdit: () => void; onTest: () => void; onRunNow: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const t = TRIGGERS[a.trigger] ?? { icon: null };
  const time = isTimeTrigger(a.trigger);
  return (
    <li className={cx("group flex min-w-0 flex-col rounded-xl border bg-white p-4 shadow-card transition", active ? "border-line hover:border-line-strong" : "border-dashed border-line-strong bg-slate-50/50")}>
      <div className="flex items-start gap-3">
        <span className={cx("transition-opacity", !active && "opacity-50")}><IconChip tone={CATEGORY[category].tone}>{t.icon}</IconChip></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {writable
              ? <button type="button" onClick={onEdit} className="truncate text-left text-[15px] font-semibold tracking-[-0.01em] text-ink-900 hover:text-brand-700">{a.name}</button>
              : <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink-900">{a.name}</h3>}
            {!active && <Badge tone="gray">Paused</Badge>}
          </div>
          <p className="truncate text-xs text-ink-500">{a.description || `${CATEGORY[category].label} · ${time ? "checks every minute" : "runs the moment it happens"}`}</p>
        </div>
        {writable ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Toggle checked={active} onChange={onToggle} label={<span className="sr-only">{active ? `Pause ${a.name}` : `Switch on ${a.name}`}</span>} />
            <OverflowMenu label={`More for ${a.name}`} items={[
              { label: "Edit", icon: <Pencil />, onSelect: onEdit },
              { label: "Test with real data", icon: <FlaskConical />, onSelect: onTest },
              time && { label: "Run now", icon: <PlayCircle />, onSelect: onRunNow, disabled: !active, hint: active ? undefined : "Switch it on first" },
              { label: "Duplicate", icon: <Copy />, onSelect: onDuplicate },
              { label: "Delete", icon: <Trash2 />, onSelect: onDelete, danger: true },
            ]} />
          </div>
        ) : (
          <Badge tone={active ? "green" : "gray"} dot>{active ? "On" : "Paused"}</Badge>
        )}
      </div>
      <FlowChips className={cx("mt-3", !active && "opacity-70")} trigger={a.trigger} days={a.days} conditions={a.conditions} steps={a.steps} users={users} />
      <div className="flex-1" />
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/80 pt-3 text-xs text-ink-500">
        <span className="tabular-nums">
          {a.runs ? <>Ran <b className="font-semibold text-ink-800">{a.runs.toLocaleString("en-IN")}</b> time{a.runs === 1 ? "" : "s"} · last <span title={a.lastRunAt ? formatDateTime(a.lastRunAt) : undefined}>{relTime(a.lastRunAt)}</span></> : active ? "Waiting for its first match" : "Hasn't run yet"}
        </span>
        <span className="flex items-center gap-2">
          {attention > 0 && (
            <Link to={`/app/automations?tab=history&automation=${encodeURIComponent(a.id)}&status=attention`} className="rounded-full focus-visible:outline-2 focus-visible:outline-brand-600">
              <Badge tone="red" dot>{attention} need{attention === 1 ? "s" : ""} a look</Badge>
            </Link>
          )}
          <Link to={`/app/automations?tab=history&automation=${encodeURIComponent(a.id)}`} className="rounded p-0.5 hover:bg-slate-100" aria-label={`History of ${a.name}`}><RunDots runs={runs.slice(0, 8)} /></Link>
        </span>
      </div>
    </li>
  );
}

/* ───────────────────────── recipe gallery ───────────────────────── */

export function RecipeGallery({ templates, loading, error, onRetry, installed, writable, installing, onInstall, onCustomise, users }: {
  users: User[]; templates: AutomationTemplate[] | undefined; loading: boolean; error: ApiError | null; onRetry: () => void; installed: Set<string>; writable: boolean;
  installing: string | null; onInstall: (t: AutomationTemplate) => void; onCustomise: (t: AutomationTemplate) => void;
}) {
  const [cat, setCat] = useState<Category | "all">("all");
  if (!templates && loading) {
    return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[230px] rounded-xl" />)}</div>;
  }
  if (!templates) {
    return (
      <Empty icon={<BookOpen />} title="Recipes aren't available right now" action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}>
        {error?.status === 404 ? "The recipe library hasn't been set up on this workspace yet. You can still build your own automation." : error?.message ?? "Something went wrong loading recipes."}
      </Empty>
    );
  }
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, templates.filter((t) => t.category === c).length])) as Record<Category, number>;
  const shown = CATEGORIES.filter((c) => (cat === "all" || cat === c) && counts[c] > 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-ink-600">Ready-made automations for the things that usually slip. Switch one on in a click, or tweak it first.</p>
        <div role="tablist" aria-label="Recipe category" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
          {(["all", ...CATEGORIES] as const).filter((c) => c === "all" || counts[c] > 0).map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
              className={cx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition", cat === c ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-line hover:text-ink-900")}>
              {c === "all" ? "All" : CATEGORY[c].label}<span className={cx("text-xs tabular-nums", cat === c ? "text-white/70" : "text-ink-400")}>{c === "all" ? templates.length : counts[c]}</span>
            </button>
          ))}
        </div>
      </div>
      {!writable && <Callout tone="info">You can browse recipes. To switch one on, ask an owner, admin or the marketing team.</Callout>}
      {templates.length === 0 && <Empty icon={<BookOpen />} title="No recipes yet">Build your own automation with the New automation button.</Empty>}
      {shown.map((c) => (
        <section key={c} aria-labelledby={`cat-${c}`}>
          <div className="mb-3 flex items-baseline gap-2">
            <h3 id={`cat-${c}`} className="text-[15px] font-semibold text-ink-900">{CATEGORY[c].label}</h3>
            <span className="text-[13px] text-ink-500">{CATEGORY[c].blurb}</span>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.filter((t) => t.category === c).map((t) => {
              const done = installed.has(t.key);
              return (
                <li key={t.key} className="flex flex-col rounded-xl border border-line bg-white p-4 shadow-card transition hover:-translate-y-px hover:shadow-lift">
                  <div className="flex items-start gap-3">
                    <IconChip tone={CATEGORY[c].tone}>{TRIGGERS[t.automation.trigger]?.icon}</IconChip>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold leading-5 text-ink-900">{t.name}</h4>
                      <p className="mt-0.5 text-xs leading-5 text-ink-500">{t.description}</p>
                    </div>
                    {done && <Badge tone="green" dot>Installed</Badge>}
                  </div>
                  {t.why && (
                    <p className="mt-3 rounded-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-[13px] italic leading-5 text-ink-700">“{t.why}”</p>
                  )}
                  <FlowChips size="sm" className="mt-3" trigger={t.automation.trigger} days={t.automation.days} conditions={t.automation.conditions} steps={t.automation.steps} users={users} />
                  {writable && (
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      {done ? (
                        <Button size="sm" variant="secondary" icon={<Wand2 className="size-3.5" />} onClick={() => onCustomise(t)}>Customise a copy</Button>
                      ) : (
                        <>
                          <Button size="sm" busy={installing === t.key} disabled={installing !== null && installing !== t.key} icon={<Plus className="size-3.5" />} onClick={() => onInstall(t)}>Switch on</Button>
                          <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} onClick={() => onCustomise(t)}>Customise</Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ───────────────────────── history ───────────────────────── */

/** YYYY-MM-DD in the viewer's time zone, so "Today" means today in India, not in UTC. */
const localDay = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-CA"); };

export type HistoryStatus = "all" | "attention" | "done" | "skipped";
const PAGE = 40;

export function HistoryPanel({ runs, loading, error, onRetry, automations, automationId, status, onFilter }: {
  runs: AutomationRun[] | undefined; loading: boolean; error: ApiError | null; onRetry: () => void; automations: Automation[];
  automationId: string; status: HistoryStatus; onFilter: (f: { automation?: string; status?: HistoryStatus }) => void;
}) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  useEffect(() => setLimit(PAGE), [automationId, status, q]);

  const sorted = useMemo(() => [...(runs ?? [])].sort((a, b) => b.at.localeCompare(a.at)), [runs]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    sorted.forEach((r) => { if (!m.has(r.automationId)) m.set(r.automationId, r.automationName || "Deleted automation"); });
    automations.forEach((a) => m.set(a.id, a.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sorted, automations]);
  const base = sorted.filter((r) => (!automationId || r.automationId === automationId) && (!q || `${r.subjectName} ${r.automationName}`.toLowerCase().includes(q.toLowerCase())));
  const match = (r: AutomationRun, s: HistoryStatus) => s === "all" || (s === "attention" ? r.status === "failed" || r.status === "partial" : r.status === s);
  const rows = base.filter((r) => match(r, status));
  const count = (s: HistoryStatus) => base.filter((r) => match(r, s)).length;

  if (!runs && loading) return <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[64px] rounded-xl" />)}</div>;
  if (!runs) {
    return (
      <Empty icon={<History />} title="History isn't available right now" action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}>
        {error?.status === 404 ? "Run history will appear here once automations are set up on this workspace." : error?.message ?? "Something went wrong."}
      </Empty>
    );
  }

  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 86_400_000).toISOString());
  const dayLabel = (d: string) => (d === today ? "Today" : d === yesterday ? "Yesterday" : formatDate(d));
  const page = rows.slice(0, limit);
  const groups: { day: string; items: AutomationRun[] }[] = [];
  page.forEach((r) => {
    const d = localDay(r.at);
    const g = groups[groups.length - 1];
    if (g && g.day === d) g.items.push(r);
    else groups.push({ day: d, items: [r] });
  });
  const filtered = Boolean(automationId || status !== "all" || q);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <Segmented<HistoryStatus> label="Filter by result" value={status} onChange={(s) => onFilter({ status: s })} options={[
            { value: "all", label: <>All <span className="tabular-nums text-ink-400">{count("all")}</span></> },
            { value: "attention", label: <>Needs a look <span className={cx("tabular-nums", count("attention") ? "text-rose-600" : "text-ink-400")}>{count("attention")}</span></> },
            { value: "done", label: <>Done <span className="tabular-nums text-ink-400">{count("done")}</span></> },
            { value: "skipped", label: <>Skipped <span className="tabular-nums text-ink-400">{count("skipped")}</span></> },
          ]} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={automationId} onChange={(e) => onFilter({ automation: e.target.value })} aria-label="Filter by automation" className="sm:w-60">
            <option value="">All automations</option>
            {names.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder="Customer or automation…" className="sm:w-60" label="Search history" />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty icon={<History />} title={filtered ? "Nothing matches these filters" : "Nothing has run yet"}
          action={filtered ? <Button variant="secondary" size="sm" onClick={() => { setQ(""); onFilter({ automation: "", status: "all" }); }}>Clear filters</Button> : undefined}>
          {filtered ? (status === "attention" ? "No problems to look at. Everything ran smoothly." : "Try a different automation or result.")
            : "Each time an automation does something, you'll see it here — who it was for and exactly what happened."}
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.day} aria-label={dayLabel(g.day)}>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">{dayLabel(g.day)}</h3>
              <ol className="divide-y divide-line/80 overflow-hidden rounded-xl border border-line bg-white shadow-card">
                {g.items.map((r) => <RunRow key={r.id} r={r} open={open.has(r.id)} onToggle={() => toggle(r.id)} />)}
              </ol>
            </section>
          ))}
          <div className="flex flex-col items-center gap-2 text-[13px] text-ink-500">
            <span className="tabular-nums">Showing {page.length} of {rows.length}</span>
            {rows.length > limit && <Button variant="secondary" size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

function RunRow({ r, open, onToggle }: { r: AutomationRun; open: boolean; onToggle: () => void }) {
  const st = RUN_STATUS[r.status];
  const okCount = r.steps.filter((s) => s.ok).length;
  const detailId = `run-${r.id}`;
  return (
    <li className={cx(open && "bg-slate-50/50")}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={cx("mt-1.5 size-2.5 shrink-0 rounded-full ring-[3px]", st.dot, r.status === "failed" ? "ring-rose-100" : r.status === "partial" ? "ring-amber-100" : r.status === "done" ? "ring-emerald-100" : "ring-slate-100")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-sm font-semibold text-ink-900">{r.automationName || "Automation"}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
            <span>{SUBJECT_LABEL[r.subjectType]}</span>
            <Link to={subjectPath(r.subjectType, r.subjectId)} className="max-w-[14rem] truncate font-medium text-brand-700 hover:underline">{r.subjectName || "Open record"}</Link>
            <span aria-hidden>·</span>
            <time dateTime={r.at} title={formatDateTime(r.at)}>{relTime(r.at)}</time>
          </div>
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={detailId}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-slate-100 hover:text-ink-900">
          <span className="tabular-nums">{r.steps.length ? `${okCount}/${r.steps.length}` : "Details"}</span>
          <span className="sr-only">{open ? "Hide details" : "Show details"}</span>
          <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div id={detailId} className="px-4 pb-3 pl-[2.6rem]">
          {r.error && <div className="mb-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{r.error}</div>}
          {r.steps.length === 0 ? (
            <p className="text-[13px] text-ink-500">{r.status === "skipped" ? "Nothing to do this time — it didn't match the rules, or it already ran for this record." : "No actions were recorded."}</p>
          ) : (
            <ol className="space-y-1.5">
              {r.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-5">
                  {s.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Worked" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-label="Didn't work" />}
                  <span className="min-w-0"><span className="font-medium text-ink-800">{STEPS[s.kind]?.label ?? s.kind}</span>{s.detail && <span className={cx("block break-words", s.ok ? "text-ink-500" : "text-rose-700")}>{s.detail}</span>}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

/* ───────────────────────── test an existing automation ───────────────────────── */

export function TestModal({ a, onClose, writable, onEdit, onRunNow, running }: { a: Automation; onClose: () => void; writable: boolean; onEdit: () => void; onRunNow: () => void; running: boolean }) {
  const [state, setState] = useState<{ loading: boolean; result: AutomationTestResult | null; error: string | null }>({ loading: true, result: null, error: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    api.action<AutomationTestResult>("testAutomation", { automationId: a.id }).then(
      (result) => alive.current && setState({ loading: false, result, error: null }),
      (e: unknown) => {
        if (!alive.current) return;
        const err = e instanceof ApiError ? e : new ApiError(String(e), 500);
        setState({ loading: false, result: null, error: err.status === 404 ? "Testing isn't available yet on this workspace." : err.message });
      },
    );
    return () => { alive.current = false; };
  }, [a.id]);
  const time = isTimeTrigger(a.trigger);
  const fresh = state.result?.matches.filter((m) => !m.alreadyRan).length ?? 0;
  return (
    <Modal open onClose={onClose} size="md" title={`Test “${a.name}”`} description="A dry run against your real records. Nothing is sent or changed."
      footer={<>
        {writable && <Button variant="ghost" className="mr-auto" icon={<Pencil className="size-4" />} onClick={onEdit}>Edit</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {writable && time && a.active && fresh > 0 && <Button busy={running} icon={<PlayCircle className="size-4" />} onClick={onRunNow}>Run now for {fresh}</Button>}
      </>}>
      {state.loading ? (
        <div className="space-y-2" role="status" aria-label="Testing"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-20" /></div>
      ) : state.error ? (
        <Callout tone="warn">{state.error}</Callout>
      ) : state.result ? (
        <TestResultView result={state.result} linkable />
      ) : null}
    </Modal>
  );
}

/* ───────────────────────── empty state for first-timers ───────────────────────── */

export function FirstRun({ templates, writable, installing, onInstall, onBrowse, onNew }: {
  templates: AutomationTemplate[] | undefined; writable: boolean; installing: string | null; onInstall: (t: AutomationTemplate) => void; onBrowse: () => void; onNew: () => void;
}) {
  const picks = (templates ?? []).slice(0, 3);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
      <div className="bg-gradient-to-br from-brand-50 via-white to-violet-50/60 px-5 py-7 text-center sm:px-8">
        <span className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-card ring-1 ring-line"><Sparkles className="size-6" /></span>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink-900">Stop chasing. Let VoyaDesk follow up for you.</h2>
        <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-ink-600">Reply to every new enquiry in seconds, nudge quiet leads, remind customers about balances and ask for reviews — automatically, in your own words.</p>
        {writable && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button icon={<BookOpen className="size-4" />} onClick={onBrowse}>Browse recipes</Button>
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={onNew}>Build your own</Button>
          </div>
        )}
      </div>
      {picks.length > 0 && (
        <div className="border-t border-line p-4 sm:p-5">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Popular to start with</div>
          <ul className="grid gap-2 md:grid-cols-3">
            {picks.map((t) => (
              <li key={t.key} className="flex items-start gap-3 rounded-xl border border-line p-3">
                <IconChip tone={CATEGORY[t.category].tone} size="sm">{TRIGGERS[t.automation.trigger]?.icon}</IconChip>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold leading-5 text-ink-900">{t.name}</div>
                  <div className="line-clamp-2 text-xs leading-4 text-ink-500">{t.why || t.description}</div>
                  {writable && <Button size="sm" variant="soft" className="mt-2" busy={installing === t.key} disabled={installing !== null && installing !== t.key} onClick={() => onInstall(t)}>Switch on</Button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
