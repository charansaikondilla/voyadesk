import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, FileText, Flame, LayoutGrid, List, MapPin, MessageCircle, Phone, Plus, Sparkles } from "lucide-react";
import { RecordTrail } from "../../components/RecordTrail";
import { LEAD_SOURCES, LEAD_STAGES, formatDate, type Lead, type Quote } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useAction, useList, useMutation, useOne } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { formatCompact, money, relTime, SOURCE_LABEL, titleCase } from "../../lib/format";
import {
  Avatar, Badge, Button, Callout, Card, CardTitle, DataTable, ErrorNote, Field, Input, KeyValue, Loading, Modal, MoneyInput,
  PageHeader, SearchInput, Segmented, Select, StatusBadge, Tabs, Textarea, cx,
} from "../../components/ui";
import { ActivityFeed, TaskList } from "./Dashboard";

const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", quoted: "Quoted", negotiation: "Negotiation", won: "Won", lost: "Lost" };

export function NewLeadModal({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: { name?: string; phone?: string; email?: string } }) {
  const nav = useNavigate();
  const { act, busy, fieldErrors } = useAction();
  const [mode, setMode] = useState<"form" | "paste">("form");
  const blank = { name: "", phone: "", email: "", source: "website", service: "holiday", destination: "", travelDate: "", nights: "", adults: "2", children: "0", budget: null as number | null, notes: "", text: "" };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF({ ...blank, ...prefill }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const submit = async () => {
    const input = mode === "paste"
      ? { text: f.text, name: f.name || undefined, phone: f.phone || undefined, source: f.source }
      : {
          name: f.name, phone: f.phone || undefined, email: f.email || undefined, source: f.source, service: f.service, destination: f.destination || undefined,
          travelDate: f.travelDate || null, nights: f.nights ? Number(f.nights) : null, adults: Number(f.adults) || 1, children: Number(f.children) || 0, budget: f.budget, notes: f.notes || undefined,
        };
    const r = await act<{ lead: Lead; duplicate: boolean }>("captureLead", input, (x) => (x.duplicate ? "This person already had an open lead — it was updated instead" : "Lead created and assigned"));
    if (r) {
      onClose();
      nav(`/app/leads/${r.lead.id}`);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New lead" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Create lead</Button></>}>
      <Tabs tabs={[{ key: "form", label: "Fill in details" }, { key: "paste", label: <span className="inline-flex items-center gap-1"><Sparkles className="size-4" />Paste a message</span> }]} value={mode} onChange={setMode} />
      {mode === "paste" ? (
        <div className="space-y-4">
          <Field label="Customer's message" hint={'e.g. "5N Dubai, 4 pax, 27 Jan, budget 1.2L, 4 star" — destination, nights, travellers, date and budget are picked out automatically.'}>
            <Textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={4} placeholder="Paste a WhatsApp or email enquiry" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Source"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={fieldErrors["name"]}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone" error={fieldErrors["phone"]}><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 98765 43210" /></Field>
          <Field label="Email" error={fieldErrors["email"]}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Source"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
          <Field label="Service"><Select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>{["holiday", "visa", "flight", "hotel", "transfer"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Destination"><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="e.g. Dubai" /></Field>
          <Field label="Travel date" error={fieldErrors["travelDate"]}><Input type="date" value={f.travelDate} onChange={(e) => setF({ ...f, travelDate: e.target.value })} /></Field>
          <Field label="Nights"><Input type="number" min={0} value={f.nights} onChange={(e) => setF({ ...f, nights: e.target.value })} /></Field>
          <Field label="Adults"><Input type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} /></Field>
          <Field label="Children"><Input type="number" min={0} value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} /></Field>
          <Field label="Budget (total)"><MoneyInput value={f.budget} onChange={(v) => setF({ ...f, budget: v })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}

const STAGE_DOT: Record<string, string> = { new: "bg-blue-500", contacted: "bg-cyan-500", quoted: "bg-violet-500", negotiation: "bg-amber-500", won: "bg-emerald-500", lost: "bg-slate-400" };

function LeadCard({ lead, owner }: { lead: Lead; owner?: string | undefined }) {
  const digits = lead.phone.replace(/\D/g, "");
  const scoreTone = lead.temperature === "hot" ? "bg-rose-500" : lead.temperature === "warm" ? "bg-amber-500" : "bg-blue-400";
  return (
    <div className="group rounded-xl border border-line bg-white shadow-card transition hover:-translate-y-px hover:border-brand-200 hover:shadow-lift">
      <Link to={`/app/leads/${lead.id}`} className="block p-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-semibold text-ink-900">{lead.temperature === "hot" && <Flame className="size-3.5 shrink-0 text-rose-500" aria-label="Hot" />}{lead.name}</div>
            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-500"><MapPin className="size-3 shrink-0" />{lead.destination || titleCase(lead.service)} · {lead.pax.adults + lead.pax.children} pax</div>
          </div>
          {lead.budget ? <span className="shrink-0 rounded-md bg-slate-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink-700">{formatCompact(lead.budget)}</span> : null}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100" title={`Score ${lead.score} / 100`}><div className={cx("h-full rounded-full", scoreTone)} style={{ width: `${lead.score}%` }} /></div>
          <span className="text-[11px] font-medium tabular-nums text-ink-500">{lead.score}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
          <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />{lead.travelDate ? formatDate(lead.travelDate) : "Date TBD"}</span>
          <span>{SOURCE_LABEL[lead.source]} · {relTime(lead.lastActivityAt ?? lead.createdAt)}</span>
        </div>
      </Link>
      <div className="flex items-center justify-between border-t border-line/70 px-2 py-1.5">
        <div className="flex gap-0.5">
          {digits ? <>
            <a href={`tel:${lead.phone.replace(/\s/g, "")}`} aria-label={`Call ${lead.name}`} title="Call" className="inline-flex size-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-slate-100 hover:text-ink-800"><Phone className="size-3.5" /></a>
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.name}`} title="WhatsApp" className="inline-flex size-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-emerald-50 hover:text-emerald-700"><MessageCircle className="size-3.5" /></a>
          </> : <span className="px-1.5 text-[11px] text-ink-400">No phone</span>}
        </div>
        {owner ? <span className="flex items-center gap-1.5 text-[11px] text-ink-500"><span className="hidden max-w-[90px] truncate sm:inline">{owner.split(" ")[0]}</span><Avatar name={owner} size={6} /></span> : <span className="text-[11px] font-medium text-amber-700">Unassigned</span>}
      </div>
    </div>
  );
}

export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useSession();
  const leads = useList("leads");
  const users = useList("users");
  const [view, setView] = useState<"board" | "list">(() => (window.innerWidth < 768 ? "list" : "board"));
  const [who, setWho] = useState<"all" | "mine">("all");
  const [temp, setTemp] = useState("");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const newOpen = params.get("new") === "1";
  const ownerName = (id: string | null) => users.data?.find((u) => u.id === id)?.name;

  const rows = useMemo(() => (leads.data ?? []).filter((l) =>
    (who === "all" || l.ownerId === user?.id) && (!temp || l.temperature === temp) &&
    (!q || `${l.name} ${l.destination} ${l.phone} ${l.email}`.toLowerCase().includes(q.toLowerCase())),
  ).sort((a, b) => b.score - a.score), [leads.data, who, temp, q, user?.id]);
  const hot = (leads.data ?? []).filter((l) => l.temperature === "hot" && !["won", "lost"].includes(l.stage)).length;

  return (
    <div>
      <PageHeader title="Leads" subtitle={<>Every enquiry, scored and assigned. Hot leads first.{hot > 0 && <> · <button onClick={() => setTemp("hot")} className="font-medium text-rose-600 hover:underline">{hot} hot right now</button></>}</>} actions={<>
        <Segmented size="sm" label="View" value={view} onChange={setView} options={[
          { value: "board", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Board</span> },
          { value: "list", label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" />List</span> },
        ]} />
        <Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: "1" })}>New lead</Button>
      </>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput label="Search leads" placeholder="Search name, phone, destination…" value={q} onChange={setQ} className="w-full sm:max-w-xs" />
        <div className="flex flex-wrap gap-2">
          <Segmented size="sm" label="Owner filter" value={who} onChange={setWho} options={[{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }]} />
          <Segmented size="sm" label="Temperature filter" value={temp} onChange={setTemp} options={[{ value: "", label: "All" }, { value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }]} />
        </div>
        <span className="text-xs text-ink-500 sm:ml-auto">{rows.length} lead{rows.length === 1 ? "" : "s"}</span>
      </div>
      {leads.error && !leads.data ? <ErrorNote message={leads.error.message} onRetry={leads.reload} /> : !leads.data ? <Loading /> : view === "board" ? (
        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-3 sm:mx-0 sm:px-0">
          {LEAD_STAGES.map((stage) => {
            const col = rows.filter((l) => l.stage === stage);
            const value = col.reduce((a, l) => a + (l.budget ?? 0), 0);
            return (
              <div key={stage} className="flex w-[280px] shrink-0 snap-start flex-col rounded-2xl bg-slate-100/80 p-2">
                <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-800"><span className={cx("size-2 rounded-full", STAGE_DOT[stage])} />{STAGE_LABEL[stage]}<span className="rounded-full bg-white px-1.5 text-[11px] font-semibold tabular-nums text-ink-500">{col.length}</span></span>
                  {value > 0 && <span className="text-[11px] font-medium tabular-nums text-ink-500" title="Total budget in this stage">{formatCompact(value)}</span>}
                </div>
                <div className="space-y-2">{col.map((l) => <LeadCard key={l.id} lead={l} owner={ownerName(l.ownerId)} />)}{col.length === 0 && <div className="rounded-xl border border-dashed border-line-strong py-6 text-center text-xs text-ink-400">Empty</div>}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <DataTable rows={rows} onRowClick={(l) => nav(`/app/leads/${l.id}`)} columns={[
          { key: "name", header: "Lead", render: (l) => <span><span className="font-medium">{l.name}</span><span className="block text-xs text-ink-500">{l.phone || l.email}</span></span>, sort: (l) => l.name },
          { key: "dest", header: "Trip", render: (l) => `${l.destination || titleCase(l.service)} · ${l.pax.adults + l.pax.children} pax`, sort: (l) => l.destination },
          { key: "date", header: "Travel", render: (l) => formatDate(l.travelDate), sort: (l) => l.travelDate ?? "9" },
          { key: "stage", header: "Stage", render: (l) => <StatusBadge status={l.stage} />, sort: (l) => LEAD_STAGES.indexOf(l.stage) },
          { key: "score", header: "Score", render: (l) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={l.temperature} />{l.score}</span>, sort: (l) => l.score, align: "right" },
          { key: "owner", header: "Owner", render: (l) => ownerName(l.ownerId) ?? "—", hideOnMobile: true },
          { key: "src", header: "Source", render: (l) => SOURCE_LABEL[l.source], hideOnMobile: true },
        ]} />
      )}
      <NewLeadModal open={newOpen} onClose={() => setParams({})} />
    </div>
  );
}

function LostModal({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const { act, busy } = useAction();
  const [reason, setReason] = useState("Price");
  const [other, setOther] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Mark lead as lost" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" busy={busy} onClick={async () => { const r = await act("updateLeadStage", { leadId: lead.id, stage: "lost", lostReason: reason === "Other" ? other : reason }, "Lead marked lost"); if (r) onClose(); }}>Mark lost</Button></>}>
      <Field label="Why was it lost?"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{["Price", "Booked elsewhere", "Dates changed", "No response", "Trip cancelled", "Other"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
      {reason === "Other" && <Field label="Reason" className="mt-3"><Input value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
    </Modal>
  );
}

export function LeadDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const lead = useOne("leads", id);
  const acts = useList("activities");
  const quotes = useList("quotes");
  const tasks = useList("tasks");
  const users = useList("users");
  const packages = useList("packages");
  const { act, busy } = useAction();
  const m = useMutation();
  const [kind, setKind] = useState<"call" | "whatsapp" | "email" | "note">("call");
  const [body, setBody] = useState("");
  const [mins, setMins] = useState("");
  const [lostOpen, setLostOpen] = useState(false);
  const [pkgId, setPkgId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");

  if (lead.error) return <ErrorNote message={lead.error.message} />;
  if (!lead.data) return <Loading />;
  const l = lead.data;
  const myQuotes = (quotes.data ?? []).filter((q) => q.leadId === l.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const timeline = (acts.data ?? []).filter((a) => a.leadId === l.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const myTasks = (tasks.data ?? []).filter((t) => t.leadId === l.id);
  const salesUsers = (users.data ?? []).filter((u) => ["sales", "owner", "admin", "marketing"].includes(u.role) && u.active);
  const phoneDigits = l.phone.replace(/\D/g, "");
  const nextStages = { new: ["contacted"], contacted: ["negotiation"], quoted: ["negotiation", "contacted"], negotiation: ["quoted"], won: [], lost: ["contacted"] }[l.stage] ?? [];

  const buildQuote = async () => {
    const q = await act<Quote>("createQuoteFromLead", { leadId: l.id, packageId: pkgId || null }, "Draft quote ready — review and send");
    if (q) nav(`/app/quotes/${q.id}`);
  };

  return (
    <div>
      <PageHeader back={{ to: "/app/leads", label: "Leads" }} title={l.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={l.stage} /><StatusBadge status={l.temperature} label={`${titleCase(l.temperature)} · ${l.score}`} /><span>{SOURCE_LABEL[l.source]} · created {relTime(l.createdAt)}</span></span>}
        actions={<>
          {l.phone && <a href={`tel:${l.phone}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm shadow-sm hover:bg-slate-50"><Phone className="size-4" />Call</a>}
          {phoneDigits && <a href={`https://wa.me/${phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm shadow-sm hover:bg-slate-50"><MessageCircle className="size-4 text-emerald-600" />WhatsApp</a>}
          {!["won", "lost"].includes(l.stage) && <Button variant="secondary" onClick={() => setLostOpen(true)}>Mark lost</Button>}
        </>} />
      <RecordTrail anchor={{ kind: "lead", id: l.id }} current="lead" />

      {l.stage === "won" && l.bookingId && <div className="mb-4"><Callout tone="good">Won — <Link to={`/app/bookings/${l.bookingId}`} className="font-medium underline">open the booking file</Link>.</Callout></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {!["won", "lost"].includes(l.stage) && (
            <Card className="border-brand-200 bg-brand-50/40">
              <CardTitle title="Next step: send a quote" subtitle="We'll suggest hotels, transfers and sightseeing for the destination; you adjust and send." />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select aria-label="Start from package" value={pkgId} onChange={(e) => setPkgId(e.target.value)} className="sm:max-w-xs">
                  <option value="">Auto-suggest for {l.destination || "destination"}</option>
                  {(packages.data ?? []).map((p) => <option key={p.id} value={p.id}>Template: {p.name}</option>)}
                </Select>
                <Button icon={<FileText className="size-4" />} busy={busy} onClick={buildQuote}>Build quote</Button>
              </div>
            </Card>
          )}

          <Card>
            <CardTitle title="Log activity" />
            <Tabs tabs={[{ key: "call", label: "Call" }, { key: "whatsapp", label: "WhatsApp" }, { key: "email", label: "Email" }, { key: "note", label: "Note" }]} value={kind} onChange={setKind} />
            <Textarea aria-label="Activity details" value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "call" ? "What did you discuss?" : kind === "note" ? "Internal note" : "Message summary"} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {kind === "call" ? <Input aria-label="Call minutes" type="number" min={0} placeholder="Minutes" value={mins} onChange={(e) => setMins(e.target.value)} className="w-28" /> : <span />}
              <Button busy={busy} disabled={!body.trim()} onClick={async () => {
                const r = await act("logActivity", { leadId: l.id, kind, body, durationSec: kind === "call" && mins ? Number(mins) * 60 : null }, "Logged");
                if (r) { setBody(""); setMins(""); }
              }}>Save</Button>
            </div>
          </Card>

          <Card><CardTitle title="Timeline" /><ActivityFeed items={timeline} /></Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardTitle title="Trip" />
            <KeyValue items={[
              ["Destination", l.destination || "—"], ["Service", titleCase(l.service)], ["Travel date", formatDate(l.travelDate)], ["Nights", l.nights ?? "—"],
              ["Travellers", `${l.pax.adults} adults${l.pax.children ? `, ${l.pax.children} children` : ""}`], ["Budget", money(l.budget)], ["Phone", l.phone || "—"], ["Email", l.email || "—"],
            ]} />
            {l.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-ink-700">{l.notes}</p>}
            <div className="mt-4 grid gap-3">
              <Field label="Owner">
                <Select value={l.ownerId ?? ""} onChange={(e) => m.run(() => api.update("leads", l.id, { ownerId: e.target.value || null }), "Lead reassigned")}>
                  <option value="">Unassigned</option>{salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </Field>
              {nextStages.length > 0 && (
                <Field label="Move stage">
                  <Select value="" onChange={(e) => e.target.value && act("updateLeadStage", { leadId: l.id, stage: e.target.value }, "Stage updated")}>
                    <option value="">Choose…</option>{nextStages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle title="Why this score" subtitle={`${l.score}/100 · ${titleCase(l.temperature)}`} />
            <ul className="space-y-1 text-sm text-ink-700">{l.scoreReasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </Card>

          <Card>
            <CardTitle title="Quotes" />
            {myQuotes.length === 0 ? <p className="text-sm text-ink-500">No quotes yet.</p> : (
              <ul className="divide-y divide-line">{myQuotes.map((q) => (
                <li key={q.id}><Link to={`/app/quotes/${q.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-brand-700">
                  <span><span className="font-medium">{q.number}</span> <span className="text-xs text-ink-500">v{q.version} · {q.views} views</span></span>
                  <span className="flex items-center gap-2">{money(q.total)}<StatusBadge status={q.status} /></span>
                </Link></li>
              ))}</ul>
            )}
          </Card>

          <Card>
            <CardTitle title="Tasks" />
            <TaskList tasks={myTasks} />
            <div className="mt-2 flex gap-2">
              <Input aria-label="New task" placeholder="Add a follow-up…" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              <Button variant="secondary" disabled={!taskTitle.trim()} onClick={async () => {
                const r = await act("createTask", { title: taskTitle, dueAt: new Date(Date.now() + 24 * 3600_000).toISOString(), leadId: l.id }, "Follow-up added for tomorrow");
                if (r) setTaskTitle("");
              }}>Add</Button>
            </div>
          </Card>
        </div>
      </div>
      <LostModal lead={l} open={lostOpen} onClose={() => setLostOpen(false)} />
    </div>
  );
}
