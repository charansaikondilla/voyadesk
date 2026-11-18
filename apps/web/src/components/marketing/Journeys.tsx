import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarCheck, Clock, Copy, FileText, Pencil, Plus, Route, Trash2, UserPlus, Workflow } from "lucide-react";
import { isDeletable, type DripSequence } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useList, useMutation } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, Callout, Card, Confirm, Empty, ErrorNote, Field, IconButton, IconChip, Input, Modal, SearchInput, Segmented, Toggle, cx } from "../ui";
import { CardsSkeleton, CHANNEL, fillPlaceholders, MessageEditor, MessagePreview, RowMenu, plural, storeUrl, useAccess, type Channel } from "./kit";

type Trigger = DripSequence["trigger"];
type DripStep = DripSequence["steps"][number];
const TOKENS = ["{name}", "{destination}", "{company}", "{link}"];

export const TRIGGERS: Record<Trigger, { title: string; sentence: string; icon: ReactNode; day0: string }> = {
  new_lead: { title: "A new lead arrives", sentence: "When a new lead comes in", icon: <UserPlus />, day0: "the day the lead arrives" },
  quote_sent: { title: "A quote is sent", sentence: "When you send a quote", icon: <FileText />, day0: "the day the quote is sent" },
  no_reply_3d: { title: "No reply for 3 days", sentence: "When a lead goes quiet for 3 days", icon: <Clock />, day0: "the day they go quiet" },
  trip_completed: { title: "A trip is completed", sentence: "When a customer gets back from a trip", icon: <CalendarCheck />, day0: "the day the trip ends" },
};

const dayLabel = (d: number) => (d === 0 ? "Same day" : `Day ${d}`);

export function JourneysTab({ newOpen, onNew, onCloseNew }: { newOpen: boolean; onNew: () => void; onCloseNew: () => void }) {
  const access = useAccess();
  const canEdit = access.write("dripSequences");
  const drips = useList("dripSequences");
  const m = useMutation();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<DripSequence | null>(null);
  const [deleting, setDeleting] = useState<DripSequence | null>(null);
  const all = useMemo(() => [...(drips.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [drips.data]);
  const rows = all.filter((d) => !q || `${d.name} ${TRIGGERS[d.trigger].title} ${d.steps.map((s) => s.message).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const open = (d: DripSequence | null) => { setEditing(d); onNew(); };
  const close = () => { setEditing(null); onCloseNew(); };
  const toggle = (d: DripSequence, active: boolean) => void m.run(() => api.update("dripSequences", d.id, { active }), active ? `${d.name} is running` : `${d.name} paused`);
  const duplicate = async (d: DripSequence) => {
    const copy = await m.run(() => api.create("dripSequences", { name: `${d.name} (copy)`.slice(0, 120), trigger: d.trigger, steps: d.steps, active: false }), "Journey copied (paused)");
    if (copy) open(copy);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Drip journeys</h2>
          <p className="text-[13px] text-ink-500">Messages that go out on their own, a set number of days after something happens.</p>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search journeys…" label="Search journeys" className="w-full sm:max-w-xs" />
      </div>

      {drips.error && !drips.data ? <ErrorNote message={drips.error.message} onRetry={drips.reload} /> : !drips.data ? <CardsSkeleton n={2} h="h-[260px]" cols="lg:grid-cols-2" /> : rows.length === 0 ? (
        <Empty icon={<Route />} title={all.length ? "No journeys match" : "Automate your follow-ups"}
          action={!all.length && canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => open(null)}>New journey</Button> : undefined}>
          {q ? `Nothing matches “${q}”.` : "Welcome new leads, nudge quiet ones and ask for reviews after trips — without remembering to do it."}
        </Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((d) => (
            <JourneyCard key={d.id} d={d} canEdit={canEdit} busy={m.busy} onToggle={(v) => toggle(d, v)} onEdit={() => open(d)} onDuplicate={() => void duplicate(d)} onDelete={() => setDeleting(d)} />
          ))}
        </div>
      )}

      <Callout tone="info">Need conditions, tasks or owner alerts too? <Link to="/app/automations" className="font-medium underline">Automations</Link> can do “when → if → then” with any step.</Callout>

      {canEdit && newOpen && <JourneyEditor drip={editing} onClose={close} />}
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger busy={m.busy} title="Delete this journey?" confirmLabel="Delete journey"
        message={deleting && <><b>{deleting.name}</b> will stop and be removed. Messages already sent stay in your outbox. {deleting.active && "If you only want to stop it for now, pause it instead."}</>}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await m.run(() => api.remove("dripSequences", deleting.id).then(() => true), "Journey deleted");
          if (ok) setDeleting(null);
        }} />
    </div>
  );
}

function JourneyCard({ d, canEdit, busy, onToggle, onEdit, onDuplicate, onDelete }: { d: DripSequence; canEdit: boolean; busy: boolean; onToggle: (v: boolean) => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const t = TRIGGERS[d.trigger];
  const last = d.steps.reduce((a, s) => Math.max(a, s.afterDays), 0);
  return (
    <Card className={cx("flex flex-col", !d.active && "bg-slate-50/60")}>
      <div className="flex items-start gap-3">
        <IconChip tone={d.active ? "green" : "gray"}><Workflow /></IconChip>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={canEdit ? onEdit : undefined} disabled={!canEdit} className="min-w-0 text-left disabled:cursor-default">
              <h3 className="truncate text-[15px] font-semibold text-ink-900 hover:text-brand-700">{d.name}</h3>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              {canEdit ? <Toggle checked={d.active} disabled={busy} onChange={onToggle} label={<span className="sr-only">{d.active ? "Pause" : "Start"} {d.name}</span>} />
                : <span className={cx("text-xs font-medium", d.active ? "text-emerald-700" : "text-ink-500")}>{d.active ? "Running" : "Paused"}</span>}
              {canEdit && <RowMenu items={[
                { label: "Edit steps", icon: <Pencil />, onClick: onEdit },
                { label: "Duplicate", icon: <Copy />, onClick: onDuplicate },
                { label: "Delete", icon: <Trash2 />, onClick: onDelete, danger: true, hidden: isDeletable("dripSequences", d) !== true },
              ]} />}
            </div>
          </div>
          <p className="text-xs text-ink-500">{d.active ? "Running" : "Paused"} · {plural(d.steps.length, "message")}{d.steps.length > 1 ? ` over ${last} days` : ""}</p>
        </div>
      </div>
      <ol className="relative mt-4 space-y-3 pl-1">
        <li className="relative flex gap-3">
          <span className="relative z-[1] inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white [&_svg]:size-3.5">{t.icon}</span>
          <div className="min-w-0 pt-1 text-[13px] font-medium text-ink-800">{t.sentence}</div>
          {d.steps.length > 0 && <span className="absolute bottom-[-12px] left-[13px] top-7 w-px bg-line" aria-hidden />}
        </li>
        {d.steps.map((s, i) => {
          const c = CHANNEL[s.channel];
          return (
            <li key={i} className="relative flex gap-3">
              {i < d.steps.length - 1 && <span className="absolute bottom-[-12px] left-[13px] top-7 w-px bg-line" aria-hidden />}
              <span className={cx("relative z-[1] inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white [&_svg]:size-3.5", c.tone === "green" ? "bg-emerald-50 text-emerald-600" : c.tone === "blue" ? "bg-brand-50 text-brand-600" : "bg-violet-50 text-violet-600")}>{c.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-ink-900">{dayLabel(s.afterDays)} <span className="font-normal text-ink-500">· {c.label}</span></div>
                <p className="line-clamp-2 text-[13px] leading-5 text-ink-600">{s.message || <span className="italic text-ink-400">Empty message</span>}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {d.steps.length === 0 && <p className="mt-2 text-[13px] text-amber-700">No messages yet — add a step so this journey does something.</p>}
    </Card>
  );
}

/* ───────────────────────── editor ───────────────────────── */

function JourneyEditor({ drip, onClose }: { drip: DripSequence | null; onClose: () => void }) {
  const { settings } = useSession();
  const company = settings?.companyName || "Your agency";
  const m = useMutation();
  const [name, setName] = useState(drip?.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>(drip?.trigger ?? "new_lead");
  const [active, setActive] = useState(drip?.active ?? true);
  const [steps, setSteps] = useState<DripStep[]>(drip?.steps.length ? drip.steps : [{ afterDays: 0, channel: "whatsapp", message: "" }]);
  const [focus, setFocus] = useState(0);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setName(drip?.name ?? ""); setTrigger(drip?.trigger ?? "new_lead"); setActive(drip?.active ?? true);
    setSteps(drip?.steps.length ? drip.steps : [{ afterDays: 0, channel: "whatsapp", message: "" }]); setFocus(0); setTouched(false);
  }, [drip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameErr = !name.trim() ? "Give the journey a name" : undefined;
  const stepErr = steps.map((s) => (!s.message.trim() ? "Write the message" : s.afterDays < 0 || s.afterDays > 365 ? "0 to 365 days" : null));
  const outOfOrder = steps.some((s, i) => i > 0 && s.afterDays < steps[i - 1]!.afterDays);
  const valid = !nameErr && stepErr.every((e) => !e) && steps.length > 0;
  const cur = steps[Math.min(focus, steps.length - 1)];
  const preview = cur ? fillPlaceholders(cur.message, { name: "Priya", destination: "Dubai", company, link: storeUrl() }) : "";

  const patch = (i: number, p: Partial<DripStep>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const add = () => {
    const lastDay = steps.reduce((a, s) => Math.max(a, s.afterDays), 0);
    setSteps((ss) => [...ss, { afterDays: Math.min(365, ss.length ? lastDay + 2 : 0), channel: ss[ss.length - 1]?.channel ?? "whatsapp", message: "" }]);
    setFocus(steps.length);
  };
  /** Moving a message swaps it with its neighbour but keeps the day slots, so the timeline stays in order. */
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    setSteps((ss) => {
      const n = [...ss];
      const a = n[i]!; const b = n[j]!;
      n[i] = { ...b, afterDays: a.afterDays };
      n[j] = { ...a, afterDays: b.afterDays };
      return n;
    });
    setFocus(j);
  };
  const remove = (i: number) => { setSteps((ss) => ss.filter((_, j) => j !== i)); setFocus((f) => Math.max(0, Math.min(f, steps.length - 2))); };

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    const sorted = steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.afterDays - b.s.afterDays || a.i - b.i).map(({ s }) => ({ ...s, message: s.message.trim() }));
    const body = { name: name.trim(), trigger, active, steps: sorted };
    const r = await m.run(() => (drip ? api.update("dripSequences", drip.id, body) : api.create("dripSequences", body)), drip ? "Journey saved" : active ? "Journey created and running" : "Journey saved (paused)");
    if (r) onClose();
  };

  return (
    <Modal open onClose={onClose} size="xl" title={drip ? `Edit ${drip.name}` : "New journey"} description="Pick what starts it, then add the messages and when each one goes out."
      footer={<>
        <div className="mr-auto self-center"><Toggle checked={active} onChange={setActive} label={active ? "Running" : "Paused"} /></div>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={m.busy} onClick={() => void save()}>{drip ? "Save journey" : "Create journey"}</Button>
      </>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <Field label="Name" required error={touched ? nameErr : undefined}>
            <Input autoFocus value={name} maxLength={120} invalid={touched && Boolean(nameErr)} onChange={(e) => setName(e.target.value)} placeholder="e.g. New lead welcome" />
          </Field>

          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-700">Start this journey when…</div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Trigger">
              {(Object.keys(TRIGGERS) as Trigger[]).map((k) => {
                const t = TRIGGERS[k]; const sel = trigger === k;
                return (
                  <button key={k} type="button" role="radio" aria-checked={sel} onClick={() => setTrigger(k)}
                    className={cx("flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm font-medium transition", sel ? "border-brand-500 bg-brand-50/50 text-ink-900 ring-2 ring-brand-100" : "border-line bg-white text-ink-700 hover:border-line-strong")}>
                    <IconChip tone={sel ? "blue" : "gray"} size="sm">{t.icon}</IconChip>{t.title}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-700">Messages</span>
              <span className="text-xs text-ink-500">Days count from {TRIGGERS[trigger].day0}.</span>
            </div>
            {drip && drip.active && <div className="mb-3"><Callout tone="warn">People already in this journey continue by step number. Add new messages at the end to avoid anyone getting one twice.</Callout></div>}
            <ol className="relative space-y-0">
              {steps.map((s, i) => {
                const prev = steps[i - 1];
                const gap = prev ? s.afterDays - prev.afterDays : s.afterDays;
                const err = touched ? stepErr[i] : null;
                return (
                  <li key={i}>
                    <div className="flex items-center gap-2 py-1.5 pl-3 text-[11px] font-medium text-ink-500">
                      <span className="h-4 w-px bg-line-strong" aria-hidden />
                      {i === 0 ? (s.afterDays === 0 ? "Right away" : `${plural(s.afterDays, "day")} after it starts`) : gap < 0 ? <span className="text-amber-700">Goes before the previous message — it will be sorted by day when you save</span> : gap === 0 ? "Same day as the previous message" : `${plural(gap, "day")} later`}
                    </div>
                    <div onFocusCapture={() => setFocus(i)} onClick={() => setFocus(i)}
                      className={cx("rounded-xl border bg-white p-3 transition", focus === i ? "border-brand-400 ring-2 ring-brand-100" : err ? "border-rose-300" : "border-line")}>
                      <div className="mb-2.5 flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-6 items-center rounded-full bg-ink-900 px-2 text-[11px] font-semibold text-white">Step {i + 1}</span>
                        <label className="inline-flex items-center gap-1.5 text-[13px] text-ink-700">
                          Day
                          <Input type="number" min={0} max={365} inputMode="numeric" aria-label={`Step ${i + 1} day`} value={s.afterDays} className="h-8 w-[72px] text-center"
                            onChange={(e) => patch(i, { afterDays: Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0))) })} />
                        </label>
                        <Segmented size="sm" label={`Step ${i + 1} channel`} value={s.channel} onChange={(v) => patch(i, { channel: v as Channel })}
                          options={(Object.keys(CHANNEL) as Channel[]).map((k) => ({ value: k, label: CHANNEL[k].label }))} />
                        <div className="ml-auto flex items-center">
                          <IconButton label={`Move step ${i + 1} earlier`} onClick={() => move(i, -1)} className={i === 0 ? "pointer-events-none opacity-30" : undefined}><ArrowUp className="size-4" /></IconButton>
                          <IconButton label={`Move step ${i + 1} later`} onClick={() => move(i, 1)} className={i === steps.length - 1 ? "pointer-events-none opacity-30" : undefined}><ArrowDown className="size-4" /></IconButton>
                          <IconButton label={`Remove step ${i + 1}`} onClick={() => remove(i)} className={steps.length === 1 ? "pointer-events-none opacity-30" : "hover:text-rose-600"}><Trash2 className="size-4" /></IconButton>
                        </div>
                      </div>
                      <MessageEditor id={`drip-step-${i}`} label="Message" rows={3} value={s.message} onChange={(v) => patch(i, { message: v })} tokens={TOKENS} channel={s.channel} invalid={Boolean(err)} />
                      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button className="mt-3" size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={add} disabled={steps.length >= 12}>Add message</Button>
            {outOfOrder && <p className="mt-2 text-xs text-amber-700">Steps will be saved in day order.</p>}
          </div>
        </div>

        <aside className="min-w-0 space-y-2 lg:sticky lg:top-0 lg:self-start" aria-label="Preview">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">
            <span>Preview · step {Math.min(focus, steps.length - 1) + 1}</span>{cur && <span className="normal-case tracking-normal">{dayLabel(cur.afterDays)}</span>}
          </div>
          {cur && <MessagePreview channel={cur.channel} text={preview} sender={company} subject={name || "A message from us"} to="priya@example.com" />}
          <p className="text-xs leading-5 text-ink-500">Shown for a sample lead “Priya” who asked about Dubai. Click a step to preview it.</p>
        </aside>
      </div>
    </Modal>
  );
}
