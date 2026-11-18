import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpen, Clock, MessageCircle, Plus, Power, Sparkles, Workflow, Zap } from "lucide-react";
import { canWrite, type Automation, type AutomationRun, type AutomationTemplate } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useAction, useList, useReport } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { toast } from "../../lib/toast";
import { Button, Confirm, Empty, ErrorNote, PageHeader, SearchInput, Segmented, Select, Skeleton, Stat, Tabs } from "../../components/ui";
import { AutomationBuilder } from "../../components/automations/builder";
import { AutomationCard, FirstRun, HistoryPanel, RecipeGallery, TestModal, type HistoryStatus } from "../../components/automations/lists";
import {
  CATEGORIES, CATEGORY, MESSAGE_STEPS, TRIGGERS, draftFrom, staffOnly, type Category, type Draft,
} from "../../components/automations/meta";

type TabKey = "automations" | "recipes" | "history";
const TABS: TabKey[] = ["automations", "recipes", "history"];
const HISTORY_STATUSES: HistoryStatus[] = ["all", "attention", "done", "skipped"];
const DAY = 86_400_000;
/** Rough minutes a person spends on each thing an automation does (typing a message, creating a task…). */
const MINUTES_PER_ACTION = 3;

export function AutomationsPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useSession();
  const writable = user ? canWrite(user.role, "automations") : false;

  const autos = useList("automations");
  const runs = useList("automationRuns");
  const templates = useReport<AutomationTemplate[]>("automationTemplates");
  const usersQ = useList("users");
  const users = useMemo(() => staffOnly(usersQ.data), [usersQ.data]);
  const { act, run, busy } = useAction();

  const tabParam = params.get("tab") as TabKey | null;
  const tab: TabKey = tabParam && TABS.includes(tabParam) ? tabParam : "automations";
  const statusParam = params.get("status");
  const historyStatus: HistoryStatus = statusParam && (HISTORY_STATUSES as string[]).includes(statusParam) ? (statusParam as HistoryStatus) : statusParam === "failed" ? "attention" : "all";
  const historyAutomation = params.get("automation") ?? "";

  const [builder, setBuilder] = useState<{ key: number; initial: Draft } | null>(null);
  const [testing, setTesting] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [cat, setCat] = useState<Category | "">("");
  const [q, setQ] = useState("");

  const openBuilder = useCallback((initial: Draft) => setBuilder({ key: Date.now(), initial }), []);

  const patchParams = useCallback((fn: (p: URLSearchParams) => void) => {
    setParams((cur) => { const p = new URLSearchParams(cur); fn(p); return p; }, { replace: true });
  }, [setParams]);

  // Deep links: ?new=1, ?template=<key>, ?edit=<id>
  useEffect(() => {
    const isNew = params.get("new") === "1";
    const tk = params.get("template");
    const edit = params.get("edit");
    if (!isNew && !tk && !edit) return;
    if (!user) return;
    const clear = () => patchParams((p) => { p.delete("new"); p.delete("template"); p.delete("edit"); });
    if (!writable) { clear(); return; }
    if (tk) {
      if (templates.data) {
        const tpl = templates.data.find((t) => t.key === tk);
        if (tpl) openBuilder(draftFrom({ ...tpl.automation, active: true }));
        else toast.info("That recipe isn't available any more — start from a blank one instead.");
        clear();
      } else if (templates.error) {
        toast.error("Couldn't load that recipe. You can build it from scratch.");
        openBuilder(draftFrom(null));
        clear();
      }
      return;
    }
    if (edit) {
      if (autos.data) {
        const a = autos.data.find((x) => x.id === edit);
        if (a) openBuilder(draftFrom(a));
        else toast.info("That automation no longer exists.");
        clear();
      } else if (autos.error) clear();
      return;
    }
    openBuilder(draftFrom(null));
    clear();
  }, [params, user, writable, templates.data, templates.error, autos.data, autos.error, openBuilder, patchParams]);

  // Drop optimistic toggles once the server agrees
  useEffect(() => {
    if (!autos.data) return;
    setOverrides((o) => {
      const next = { ...o };
      let changed = false;
      for (const [id, v] of Object.entries(o)) {
        const a = autos.data!.find((x) => x.id === id);
        if (!a || a.active === v) { delete next[id]; changed = true; }
      }
      return changed ? next : o;
    });
  }, [autos.data]);

  const isActive = (a: Automation) => overrides[a.id] ?? a.active;
  const templateByKey = useMemo(() => new Map((templates.data ?? []).map((t) => [t.key, t])), [templates.data]);
  const categoryOf = useCallback((a: Automation): Category => templateByKey.get(a.template)?.category ?? TRIGGERS[a.trigger]?.category ?? "sales", [templateByKey]);
  const installed = useMemo(() => new Set((autos.data ?? []).map((a) => a.template).filter(Boolean)), [autos.data]);

  const runsByAuto = useMemo(() => {
    const m = new Map<string, AutomationRun[]>();
    [...(runs.data ?? [])].sort((a, b) => b.at.localeCompare(a.at)).forEach((r) => {
      const list = m.get(r.automationId);
      if (list) list.push(r); else m.set(r.automationId, [r]);
    });
    return m;
  }, [runs.data]);

  const health = useMemo(() => {
    const since = Date.now() - 7 * DAY;
    const week = (runs.data ?? []).filter((r) => Date.parse(r.at) >= since);
    const handled = week.filter((r) => r.status === "done" || r.status === "partial");
    const actions = handled.reduce((n, r) => n + r.steps.filter((s) => s.ok).length, 0);
    const messages = week.reduce((n, r) => n + r.steps.filter((s) => s.ok && MESSAGE_STEPS.includes(s.kind)).length, 0);
    const attention = week.filter((r) => r.status === "failed" || r.status === "partial");
    const attentionBy = new Map<string, number>();
    attention.forEach((r) => attentionBy.set(r.automationId, (attentionBy.get(r.automationId) ?? 0) + 1));
    const list = autos.data ?? [];
    return {
      active: list.filter((a) => overrides[a.id] ?? a.active).length, total: list.length,
      runs: week.length, handled: handled.length, messages, attention: attention.length, attentionBy, minutes: actions * MINUTES_PER_ACTION,
    };
  }, [runs.data, autos.data, overrides]);

  const all = useMemo(() => [...(autos.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || (b.lastRunAt ?? b.createdAt).localeCompare(a.lastRunAt ?? a.createdAt)), [autos.data]);
  const counts = { all: all.length, active: all.filter(isActive).length, paused: all.filter((a) => !isActive(a)).length };
  const usedCategories = CATEGORIES.filter((c) => all.some((a) => categoryOf(a) === c));
  const shown = all.filter((a) => {
    const on = isActive(a);
    if (filter === "active" && !on) return false;
    if (filter === "paused" && on) return false;
    if (cat && categoryOf(a) !== cat) return false;
    return !q || `${a.name} ${a.description} ${TRIGGERS[a.trigger]?.label ?? ""}`.toLowerCase().includes(q.toLowerCase());
  });

  /* ── actions ── */
  const toggle = async (a: Automation, v: boolean) => {
    setOverrides((o) => ({ ...o, [a.id]: v }));
    const ok = await run(async () => { await api.action("toggleAutomation", { automationId: a.id, active: v }); return true; }, v ? `“${a.name}” is on` : `“${a.name}” paused — nothing will run until you switch it back on`);
    if (!ok) setOverrides((o) => { const n = { ...o }; delete n[a.id]; return n; });
  };
  const install = async (t: AutomationTemplate) => {
    setInstalling(t.key);
    const r = await act<Automation>("installAutomation", { templateKey: t.key, active: true }, `“${t.name}” is on — it's working for you now`);
    setInstalling(null);
    return r;
  };
  const runNow = async (a: Automation) => {
    setRunningId(a.id);
    const r = await act<{ ran: number; skipped: number }>("runAutomationNow", { automationId: a.id },
      (x) => (x.ran ? `Done for ${x.ran} ${x.ran === 1 ? "record" : "records"}${x.skipped ? ` · ${x.skipped} skipped` : ""}` : x.skipped ? `Nothing new to do — ${x.skipped} already handled` : "Nobody is due right now"));
    setRunningId(null);
    if (r && testing) setTesting(null);
  };
  const remove = async () => {
    if (!deleting) return;
    const name = deleting.name;
    const ok = await run(async () => { await api.action("deleteAutomation", { automationId: deleting.id }); return true; }, `“${name}” deleted`);
    if (ok) setDeleting(null);
  };

  const setTab = (k: TabKey) => setParams(k === "automations" ? {} : { tab: k });
  const historyFilter = (f: { automation?: string; status?: HistoryStatus }) => patchParams((p) => {
    p.set("tab", "history");
    if (f.automation !== undefined) { if (f.automation) p.set("automation", f.automation); else p.delete("automation"); }
    if (f.status !== undefined) { if (f.status !== "all") p.set("status", f.status); else p.delete("status"); }
  });

  const loadingFirst = !autos.data && autos.loading;
  const hours = health.minutes >= 60 ? `${Math.round(health.minutes / 6) / 10} h` : `${health.minutes} min`;
  const headline = !autos.data ? null
    : health.handled > 0 ? <>Automations handled <b className="font-semibold text-ink-900">{health.handled} follow-up{health.handled === 1 ? "" : "s"}</b> for you this week{health.minutes >= 5 ? <> — about <b className="font-semibold text-ink-900">{hours}</b> of busywork saved.</> : "."}</>
    : health.active > 0 ? <>Your automations are watching. Nothing needed doing this week — they'll step in the moment something does.</>
    : health.total > 0 ? <>All your automations are paused. Switch one on and VoyaDesk starts following up for you.</>
    : <>Set up your first automation and VoyaDesk starts following up for you — even after hours.</>;

  return (
    <div className="space-y-6">
      <PageHeader title="Automations" subtitle="Set it once and VoyaDesk follows up for you — every lead, every quote, every balance."
        actions={writable && <>
          {tab !== "recipes" && <Button variant="secondary" icon={<BookOpen className="size-4" />} onClick={() => setTab("recipes")}>Recipes</Button>}
          <Button icon={<Plus className="size-4" />} onClick={() => openBuilder(draftFrom(null))}>New automation</Button>
        </>} />

      {/* health strip */}
      <section aria-label="How your automations are doing" className="space-y-3">
        {headline && (
          <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 via-white to-white px-4 py-3 text-sm leading-6 text-ink-700">
            <Sparkles className="mt-1 size-4 shrink-0 text-brand-600" aria-hidden /><p>{headline}</p>
          </div>
        )}
        {autos.error && !autos.data ? null : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {loadingFirst ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[108px] rounded-xl" />) : <>
              <Stat label="Switched on" value={<>{health.active}<span className="text-base font-medium text-ink-400"> / {health.total}</span></>} icon={<Power />} tone={health.active ? "good" : "default"} hint={health.total ? `${health.total - health.active} paused` : "None yet"} />
              <Stat label="Ran this week" value={runs.data ? health.runs : "—"} icon={<Zap />} hint={runs.data ? `${health.handled} did something` : "History unavailable"} to="/app/automations?tab=history" />
              <Stat label="Messages sent" value={runs.data ? health.messages : "—"} icon={<MessageCircle />} hint="WhatsApp, email & SMS · 7 days" />
              <Stat label="Needs a look" value={runs.data ? health.attention : "—"} icon={<AlertTriangle />} tone={health.attention ? "bad" : "default"}
                hint={health.attention ? "Something didn't go through" : "All clear this week"} to="/app/automations?tab=history&status=attention" />
            </>}
          </div>
        )}
      </section>

      <div>
        <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
          { key: "automations", label: "My automations", ...(autos.data ? { count: autos.data.length } : {}) },
          { key: "recipes", label: "Recipes", ...(templates.data ? { count: templates.data.length } : {}) },
          { key: "history", label: <>History{health.attention > 0 && <span className="size-1.5 rounded-full bg-rose-500" aria-label="needs attention" />}</> },
        ]} />

        {tab === "automations" && (
          autos.error && !autos.data ? (
            <ErrorNote message={autos.error.status === 404 ? "Automations aren't available on this workspace yet." : autos.error.message} onRetry={autos.reload} />
          ) : loadingFirst ? (
            <div className="grid gap-3 xl:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[150px] rounded-xl" />)}</div>
          ) : all.length === 0 ? (
            <FirstRun templates={templates.data} writable={writable} installing={installing} onInstall={(t) => void install(t)} onBrowse={() => setTab("recipes")} onNew={() => openBuilder(draftFrom(null))} />
          ) : (
            <>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Segmented label="Show" value={filter} onChange={setFilter} className="self-start" options={[
                  { value: "all", label: <>All <span className="tabular-nums text-ink-400">{counts.all}</span></> },
                  { value: "active", label: <>On <span className="tabular-nums text-ink-400">{counts.active}</span></> },
                  { value: "paused", label: <>Paused <span className="tabular-nums text-ink-400">{counts.paused}</span></> },
                ]} />
                <div className="flex flex-col gap-2 sm:flex-row">
                  {usedCategories.length > 1 && (
                    <Select value={cat} onChange={(e) => setCat(e.target.value as Category | "")} aria-label="Filter by area" className="sm:w-44">
                      <option value="">All areas</option>
                      {usedCategories.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
                    </Select>
                  )}
                  <SearchInput value={q} onChange={setQ} placeholder="Search automations…" className="sm:w-64" label="Search automations" />
                </div>
              </div>
              {shown.length === 0 ? (
                <Empty icon={<Workflow />} title="Nothing matches" action={<Button variant="secondary" size="sm" onClick={() => { setFilter("all"); setCat(""); setQ(""); }}>Clear filters</Button>}>
                  {q ? `No automation matches “${q}”.` : filter === "paused" ? "Every automation is switched on." : filter === "active" ? "Every automation is paused right now." : "Try a different area."}
                </Empty>
              ) : (
                <ul className="grid gap-3 xl:grid-cols-2">
                  {shown.map((a) => (
                    <AutomationCard key={a.id} a={a} active={isActive(a)} runs={runsByAuto.get(a.id) ?? []} attention={health.attentionBy.get(a.id) ?? 0} users={users} category={categoryOf(a)} writable={writable}
                      onToggle={(v) => void toggle(a, v)} onEdit={() => openBuilder(draftFrom(a))} onTest={() => setTesting(a)} onRunNow={() => void runNow(a)}
                      onDuplicate={() => openBuilder(draftFrom(a, { copy: true }))} onDelete={() => setDeleting(a)} />
                  ))}
                </ul>
              )}
              {writable && (
                <button type="button" onClick={() => setTab("recipes")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm font-medium text-ink-600 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-700">
                  <BookOpen className="size-4" />Find more ready-made recipes
                </button>
              )}
            </>
          )
        )}

        {tab === "recipes" && (
          <RecipeGallery templates={templates.data} loading={templates.loading} error={templates.error} onRetry={templates.reload} installed={installed} writable={writable}
            installing={installing} users={users} onInstall={(t) => void install(t)} onCustomise={(t) => openBuilder(draftFrom({ ...t.automation, active: true }))} />
        )}

        {tab === "history" && (
          <HistoryPanel runs={runs.data} loading={runs.loading} error={runs.error} onRetry={runs.reload} automations={autos.data ?? []}
            automationId={historyAutomation} status={historyStatus} onFilter={historyFilter} />
        )}
      </div>

      {builder && <AutomationBuilder key={builder.key} initial={builder.initial} onClose={() => setBuilder(null)} />}
      {testing && (
        <TestModal a={testing} writable={writable} running={runningId === testing.id} onClose={() => setTesting(null)}
          onEdit={() => { const a = testing; setTesting(null); openBuilder(draftFrom(a)); }} onRunNow={() => void runNow(testing)} />
      )}
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger busy={busy} title="Delete this automation?" confirmLabel="Delete"
        message={deleting && <>“<b>{deleting.name}</b>” will stop straight away and can't be brought back. Its history stays, so you can still see what it did. <span className="mt-2 flex items-center gap-1.5 text-ink-500"><Clock className="size-3.5" />Just want a break? Pause it instead.</span></>}
        onConfirm={() => void remove()} />
    </div>
  );
}
