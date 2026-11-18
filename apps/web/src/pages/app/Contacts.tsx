import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Baby, Briefcase, CalendarDays, CircleDollarSign, Crown, FileText, Mail, MapPin, MessageCircle, Pencil, Phone, PhoneCall,
  Plane, Plus, Receipt, Repeat, Stamp, StickyNote, Trash2, UserPlus, Users, Wallet,
} from "lucide-react";
import { canRead, canWrite, formatDate, type Entity, type Role } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useList, useMutation, useOne } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { money, relTime, titleCase } from "../../lib/format";
import { customerRecords, useGraph } from "../../lib/graph";
import { useRecent } from "../../lib/recent";
import { ResourcePage } from "../../components/ResourcePage";
import { cleanValues, EntityForm, type FieldDef } from "../../components/forms";
import {
  Avatar, Badge, Button, Callout, Card, CardTitle, DataTable, Empty, ErrorNote, Field, IconChip, Input, KeyValue, Loading, Modal,
  PageHeader, Segmented, Stat, StatusBadge, Tabs, cx, type Tone,
} from "../../components/ui";
import { ContactDocuments } from "../../components/plus";
import { NewLeadModal } from "./Leads";

type Contact = Entity<"contacts">;

export const CONTACT_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "kind", label: "Type", type: "select", options: [{ value: "customer", label: "Individual" }, { value: "corporate", label: "Corporate" }] },
  { name: "phone", label: "Phone", type: "phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "city", label: "City", type: "text" },
  { name: "pan", label: "PAN (for TCS)", type: "text" },
  { name: "passportNo", label: "Passport no.", type: "text" },
  { name: "dob", label: "Date of birth", type: "date", nullable: true },
  { name: "tags", label: "Tags", type: "tags", placeholder: "vip, honeymoon, repeat" },
  { name: "preferences", label: "Preferences", type: "textarea", placeholder: "Veg meals, sea-facing rooms, aisle seats…" },
];

/** A simple value tier so the team sees who matters at a glance. */
export function customerTier(c: Contact): { label: string; tone: Tone; icon: ReactNode } | null {
  if (c.tags.some((t) => t.toLowerCase() === "vip") || c.totalSpend >= 50_000_000) return { label: "VIP", tone: "violet", icon: <Crown className="size-3" /> };
  if (c.trips >= 2) return { label: "Repeat", tone: "green", icon: <Repeat className="size-3" /> };
  if (c.trips === 1) return { label: "Travelled", tone: "blue", icon: <Plane className="size-3" /> };
  return null;
}

const digits = (p: string) => { const d = p.replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d; };

/* ═════════════════════════ Customers list ═════════════════════════ */

type Segment = "all" | "vip" | "repeat" | "new" | "due" | "corporate";

export function ContactsPage() {
  const nav = useNavigate();
  const { user } = useSession();
  const g = useGraph();
  const files = useList("files");
  const [seg, setSeg] = useState<Segment>("all");
  const [docs, setDocs] = useState<{ id: string; name: string } | null>(null);

  const stats = useMemo(() => {
    const due = new Map<string, number>();
    for (const i of g.invoices) {
      if (i.partyType !== "customer" || !i.partyId || i.status === "cancelled") continue;
      due.set(i.partyId, (due.get(i.partyId) ?? 0) + Math.max(0, i.total - i.paid - i.credited));
    }
    const open = new Map<string, number>();
    for (const l of g.leads) if (l.contactId && !["won", "lost"].includes(l.stage)) open.set(l.contactId, (open.get(l.contactId) ?? 0) + 1);
    const total = g.contacts.reduce((s, c) => s + c.totalSpend, 0);
    const travelled = g.contacts.filter((c) => c.trips > 0);
    return {
      due, open, total, count: g.contacts.length,
      repeat: g.contacts.filter((c) => c.trips >= 2).length,
      vip: g.contacts.filter((c) => customerTier(c)?.label === "VIP").length,
      avg: travelled.length ? Math.round(total / travelled.length) : 0,
      owed: [...due.values()].reduce((s, v) => s + v, 0),
    };
  }, [g.invoices, g.leads, g.contacts]);

  const filter = (c: Contact) => {
    switch (seg) {
      case "vip": return customerTier(c)?.label === "VIP";
      case "repeat": return c.trips >= 2;
      case "new": return c.trips === 0;
      case "due": return (stats.due.get(c.id) ?? 0) > 0;
      case "corporate": return c.kind === "corporate";
      default: return true;
    }
  };
  const canSeeMoney = user ? canRead(user.role as Role, "invoices") : false;

  return (
    <>
      <PageHeader title="Customers" subtitle="One profile per traveller — every enquiry, quote, trip, invoice, visa and conversation in one place." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Customers" value={stats.count} hint={`${stats.repeat} repeat · ${stats.vip} VIP`} icon={<Users />} />
        <Stat label="Lifetime revenue" value={money(stats.total)} hint="Across all customers" icon={<Wallet />} tone="good" />
        <Stat label="Average trip value" value={money(stats.avg)} hint="Per customer who travelled" icon={<Plane />} />
        {canSeeMoney
          ? <Stat label="Owed by customers" value={money(stats.owed)} hint={`${stats.due.size ? [...stats.due.values()].filter((v) => v > 0).length : 0} with dues`} icon={<CircleDollarSign />} tone={stats.owed > 0 ? "warn" : "default"} to="/app/finance" />
          : <Stat label="Open enquiries" value={[...stats.open.values()].reduce((s, v) => s + v, 0)} icon={<FileText />} />}
      </div>
      <div className="mb-4 overflow-x-auto no-scrollbar">
        <Segmented label="Customer segment" value={seg} onChange={setSeg} size="sm" options={[
          { value: "all", label: "All" }, { value: "vip", label: "VIP" }, { value: "repeat", label: "Repeat" },
          { value: "new", label: "Not travelled yet" }, ...(canSeeMoney ? [{ value: "due" as const, label: "With dues" }] : []), { value: "corporate", label: "Corporate" },
        ]} />
      </div>
      <ResourcePage collection="contacts" title="Customer list" singular="Customer" embedded
        search={(c) => `${c.name} ${c.phone} ${c.email} ${c.city} ${c.tags.join(" ")}`} defaults={{ kind: "customer", tags: [], family: [] }}
        filter={filter} onRowClick={(c) => nav(`/app/contacts/${c.id}`)} fields={CONTACT_FIELDS}
        columns={[
          { key: "name", header: "Customer", sort: (c) => c.name, render: (c) => {
            const tier = customerTier(c);
            return (
              <span className="flex items-center gap-3">
                <Avatar name={c.name} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium text-ink-900">{c.name}{tier && <Badge tone={tier.tone}>{tier.icon}{tier.label}</Badge>}{c.kind === "corporate" && <Badge>Corporate</Badge>}</span>
                  <span className="block truncate text-xs text-ink-500">{[c.phone || c.email, c.city].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
            );
          } },
          { key: "tags", header: "Tags", hideOnMobile: true, render: (c) => <span className="inline-flex flex-wrap gap-1">{c.tags.filter((t) => t.toLowerCase() !== "vip").slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span> },
          { key: "leads", header: "Open enquiries", align: "right", sort: (c) => stats.open.get(c.id) ?? 0, render: (c) => { const n = stats.open.get(c.id) ?? 0; return n ? <Badge tone="blue">{n} open</Badge> : <span className="text-ink-400">—</span>; } },
          { key: "trips", header: "Trips", render: (c) => c.trips, sort: (c) => c.trips, align: "right" },
          { key: "spend", header: "Lifetime spend", render: (c) => <span className="font-medium tabular-nums">{money(c.totalSpend)}</span>, sort: (c) => c.totalSpend, align: "right" },
          ...(canSeeMoney ? [{ key: "due", header: "Due", align: "right" as const, sort: (c: Contact) => stats.due.get(c.id) ?? 0, render: (c: Contact) => { const d = stats.due.get(c.id) ?? 0; return d > 0 ? <span className="font-medium tabular-nums text-amber-700">{money(d)}</span> : <span className="text-ink-400">—</span>; } }] : []),
          { key: "docs", header: "Documents", align: "right", hideOnMobile: true, render: (c) => { const n = (files.data ?? []).filter((f) => f.ownerType === "contact" && f.ownerId === c.id).length; return <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDocs({ id: c.id, name: c.name }); }}>{n ? `${n} file${n > 1 ? "s" : ""}` : "Add"}</Button>; } },
        ]} />
      <Modal open={docs !== null} onClose={() => setDocs(null)} size="lg" title={`${docs?.name ?? ""} — documents`}>{docs && <ContactDocuments contactId={docs.id} />}</Modal>
    </>
  );
}

/* ═════════════════════════ Customer 360 profile ═════════════════════════ */

type TimelineKind = "call" | "message" | "money" | "trip" | "note" | "visa";
interface TimelineItem { id: string; at: string; kind: TimelineKind; title: ReactNode; detail?: ReactNode; to?: string }
const TL_STYLE: Record<TimelineKind, { tone: Tone; icon: ReactNode }> = {
  call: { tone: "cyan", icon: <PhoneCall /> }, message: { tone: "green", icon: <MessageCircle /> }, money: { tone: "green", icon: <CircleDollarSign /> },
  trip: { tone: "blue", icon: <Briefcase /> }, note: { tone: "gray", icon: <StickyNote /> }, visa: { tone: "violet", icon: <Stamp /> },
};

type ProfileTab = "timeline" | "enquiries" | "quotes" | "bookings" | "money" | "visa" | "documents";

export function CustomerDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useSession();
  const role = (user?.role ?? "sales") as Role;
  const q = useOne("contacts", id);
  const g = useGraph();
  const visas = useList("visaCases", canRead(role, "visaCases"));
  const calls = useList("calls", canRead(role, "calls"));
  const acts = useList("activities", canRead(role, "activities"));
  const msgs = useList("messages", canRead(role, "messages"));
  const tasks = useList("tasks", canRead(role, "tasks"));
  const files = useList("files", canRead(role, "files"));
  const m = useMutation();
  const [tab, setTab] = useState<ProfileTab>("timeline");
  const [tlFilter, setTlFilter] = useState<"all" | TimelineKind>("all");
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [enquiry, setEnquiry] = useState(false);
  const [member, setMember] = useState<{ name: string; relation: string; dob: string; passportNo: string } | null>(null);

  const data = useMemo(() => {
    const c = q.data;
    if (!c || !g.ready) return null;
    const r = customerRecords(g, c);
    const myVisas = (visas.data ?? []).filter((v) => v.contactId === c.id || r.sameParty(v.phone, v.email)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const visaIds = new Set(myVisas.map((v) => v.id));
    const myCalls = (calls.data ?? []).filter((x) => x.contactId === c.id || (x.leadId && r.leadIds.has(x.leadId)) || r.sameParty(x.phone, ""));
    const myMsgs = (msgs.data ?? []).filter((x) => (x.leadId && r.leadIds.has(x.leadId)) || r.sameParty(x.phone, ""));
    const myActs = (acts.data ?? []).filter((a) => (a.leadId && r.leadIds.has(a.leadId)) || (a.bookingId && r.bookingIds.has(a.bookingId)) || (a.visaCaseId && visaIds.has(a.visaCaseId)));
    const myTasks = (tasks.data ?? []).filter((t) => !t.done && ((t.leadId && r.leadIds.has(t.leadId)) || (t.bookingId && r.bookingIds.has(t.bookingId)) || (t.visaCaseId && visaIds.has(t.visaCaseId))))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    const docCount = (files.data ?? []).filter((f) => f.ownerType === "contact" && f.ownerId === c.id).length;

    const tl: TimelineItem[] = [];
    for (const a of myActs) {
      if (a.kind === "payment") continue; // shown from the payment records themselves
      const kind: TimelineKind = a.kind === "call" ? "call" : a.kind === "whatsapp" || a.kind === "email" ? "message" : "note";
      tl.push({ id: `a-${a.id}`, at: a.at, kind, title: a.body || titleCase(a.kind), detail: titleCase(a.kind), to: a.bookingId ? `/app/bookings/${a.bookingId}` : a.leadId ? `/app/leads/${a.leadId}` : a.visaCaseId ? `/app/visa/${a.visaCaseId}` : undefined });
    }
    for (const x of myCalls) tl.push({ id: `c-${x.id}`, at: x.startedAt, kind: "call", title: `${x.direction === "in" ? "Incoming" : "Outgoing"} call · ${titleCase(x.status)}${x.durationSec ? ` · ${Math.round(x.durationSec / 60)} min` : ""}`, detail: x.outcome || undefined, to: "/app/calls" });
    for (const x of myMsgs) tl.push({ id: `m-${x.id}`, at: x.at, kind: "message", title: x.body, detail: `${x.direction === "in" ? "Received" : "Sent"} · ${titleCase(x.channel)}`, to: "/app/inbox" });
    for (const x of r.payments) tl.push({ id: `p-${x.id}`, at: `${x.date}T12:00:00.000Z`, kind: "money", title: `${x.direction === "in" ? "Paid" : "Refunded"} ${money(x.amount)}`, detail: `${titleCase(x.method)}${x.reference ? ` · ${x.reference}` : ""}`, to: x.invoiceId ? `/app/finance/invoices/${x.invoiceId}` : undefined });
    for (const b of r.bookings) tl.push({ id: `b-${b.id}`, at: b.createdAt, kind: "trip", title: `Booked ${b.title || b.destination} · ${b.number}`, detail: `${formatDate(b.startDate)} → ${formatDate(b.endDate)} · ${money(b.sellTotal)}`, to: `/app/bookings/${b.id}` });
    for (const x of r.quotes) tl.push({ id: `q-${x.id}`, at: x.createdAt, kind: "trip", title: `Quote ${x.number || "draft"} · ${x.destination || x.title}`, detail: `${titleCase(x.status)} · ${money(x.total)}`, to: `/app/quotes/${x.id}` });
    for (const l of r.leads) tl.push({ id: `l-${l.id}`, at: l.createdAt, kind: "note", title: `New enquiry: ${l.destination || titleCase(l.service)}`, detail: `${titleCase(l.source)} · ${titleCase(l.stage)}`, to: `/app/leads/${l.id}` });
    for (const v of myVisas) tl.push({ id: `v-${v.id}`, at: v.createdAt, kind: "visa", title: `Visa case ${v.number}: ${v.country} ${v.visaType}`, detail: titleCase(v.status), to: `/app/visa/${v.id}` });
    tl.sort((a, b) => (a.at < b.at ? 1 : -1));

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = r.bookings.filter((b) => b.endDate >= today && b.status !== "cancelled").sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
    const openLeads = r.leads.filter((l) => !["won", "lost"].includes(l.stage));
    const destinations = [...new Set(r.bookings.filter((b) => b.status !== "cancelled").map((b) => b.destination).filter(Boolean))];
    return { c, r, myVisas, myTasks, docCount, tl, upcoming, openLeads, destinations, lastTouch: tl[0]?.at ?? null };
  }, [q.data, g, visas.data, calls.data, msgs.data, acts.data, tasks.data, files.data]);

  useRecent(q.data ? { to: `/app/contacts/${q.data.id}`, kind: "Customer", label: q.data.name, hint: [q.data.city, q.data.phone].filter(Boolean).join(" · ") } : null);

  if (q.error) return <ErrorNote message={q.error.message} onRetry={q.reload} />;
  if (!data) return <Loading label="Loading customer…" />;
  const { c, r } = data;
  const tier = customerTier(c);
  const writable = canWrite(role, "contacts");
  const canMoney = g.can("invoices");
  const today = new Date().toISOString().slice(0, 10);

  const openEdit = () => { m.setFieldErrors({}); setValues(Object.fromEntries(CONTACT_FIELDS.map((f) => [f.name, (c as unknown as Record<string, unknown>)[f.name]]))); setEditing(true); };
  const save = async () => { if (await m.run(() => api.update("contacts", c.id, cleanValues(CONTACT_FIELDS, values)), "Customer updated")) setEditing(false); };
  const saveFamily = async (family: Contact["family"]) => m.run(() => api.update("contacts", c.id, { family }), "Travellers updated");

  const tabs: { key: ProfileTab; label: string; count?: number; show: boolean }[] = [
    { key: "timeline", label: "Timeline", count: data.tl.length, show: true },
    { key: "enquiries", label: "Enquiries", count: r.leads.length, show: g.can("leads") },
    { key: "quotes", label: "Quotes", count: r.quotes.length, show: g.can("quotes") },
    { key: "bookings", label: "Trips", count: r.bookings.length, show: g.can("bookings") },
    { key: "money", label: "Invoices & payments", count: r.invoices.length, show: canMoney },
    { key: "visa", label: "Visa", count: data.myVisas.length, show: canRead(role, "visaCases") },
    { key: "documents", label: "Documents", count: data.docCount, show: canRead(role, "files") },
  ];
  const tl = data.tl.filter((t) => tlFilter === "all" || t.kind === tlFilter);

  return (
    <div>
      <Link to="/app/contacts" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-500 transition-colors hover:text-brand-700"><span aria-hidden>←</span> Customers</Link>

      {/* ── Identity header ── */}
      <Card className="mb-5 overflow-hidden" padded={false}>
        <div className="h-16 bg-[linear-gradient(110deg,var(--color-brand-600),var(--color-brand-400)_55%,#7dd3fc)] sm:h-20" aria-hidden />
        <div className="flex flex-col gap-4 px-4 pb-4 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pb-5">
          <div className="flex min-w-0 items-end gap-4">
            <span className="-mt-10 shrink-0 rounded-full bg-white p-1 shadow-card"><Avatar name={c.name} size={16} /></span>
            <div className="min-w-0 pb-0.5">
              <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-[-0.02em] text-ink-900">
                <span className="truncate">{c.name}</span>
                {tier && <Badge tone={tier.tone}>{tier.icon}{tier.label}</Badge>}
                {c.kind === "corporate" && <Badge>Corporate</Badge>}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-500">
                {c.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{c.city}</span>}
                <span>Customer since {formatDate(c.createdAt.slice(0, 10))}</span>
                {data.lastTouch && <span>Last contact {relTime(data.lastTouch)}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-800 ring-1 ring-inset ring-line-strong hover:bg-slate-50"><Phone className="size-4" />Call</a>}
            {c.phone && <a href={`https://wa.me/${digits(c.phone)}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-800 ring-1 ring-inset ring-line-strong hover:bg-slate-50"><MessageCircle className="size-4 text-emerald-600" />WhatsApp</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-800 ring-1 ring-inset ring-line-strong hover:bg-slate-50"><Mail className="size-4" />Email</a>}
            {writable && <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={openEdit}>Edit</Button>}
            {g.can("leads") && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEnquiry(true)}>New enquiry</Button>}
          </div>
        </div>
        {c.tags.length > 0 && <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5 sm:px-6">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      </Card>

      {/* ── Key numbers ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Lifetime spend" value={money(c.totalSpend)} icon={<Wallet />} tone="good" />
        <Stat label="Trips" value={c.trips} hint={data.destinations.slice(0, 2).join(", ") || "None yet"} icon={<Plane />} />
        <Stat label="Avg trip value" value={money(c.trips ? Math.round(c.totalSpend / c.trips) : 0)} icon={<Briefcase />} />
        <Stat label="Open enquiries" value={data.openLeads.length} icon={<FileText />} tone={data.openLeads.length ? "warn" : "default"} />
        {canMoney && <Stat label="Outstanding" value={money(r.due)} hint={`${money(r.paidIn)} paid so far`} icon={<CircleDollarSign />} tone={r.due > 0 ? "bad" : "default"} />}
        <Stat label="Visa cases" value={data.myVisas.length} hint={data.myVisas[0] ? titleCase(data.myVisas[0].status) : undefined} icon={<Stamp />} />
      </div>

      {r.due > 0 && canMoney && (
        <div className="mb-5"><Callout tone="warn" title={`${money(r.due)} is still due`}>
          {r.invoices.filter((i) => i.total - i.paid - i.credited > 0 && i.status !== "cancelled").map((i) => (
            <Link key={i.id} to={`/app/finance/invoices/${i.id}`} className="mr-3 font-medium underline underline-offset-2">{i.number} ({money(i.total - i.paid - i.credited)}, due {formatDate(i.dueDate)})</Link>
          ))}
        </Callout></div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── Main column ── */}
        <div className="min-w-0 lg:col-span-2">
          <Card>
            <Tabs tabs={tabs.filter((t) => t.show).map(({ key, label, count }) => ({ key, label, count }))} value={tab} onChange={setTab} />

            {tab === "timeline" && (
              <>
                <div className="mb-4 overflow-x-auto no-scrollbar">
                  <Segmented label="Filter timeline" size="sm" value={tlFilter} onChange={setTlFilter} options={[
                    { value: "all", label: "Everything" }, { value: "call", label: "Calls" }, { value: "message", label: "Messages" },
                    { value: "trip", label: "Quotes & trips" }, { value: "money", label: "Payments" }, { value: "visa", label: "Visa" }, { value: "note", label: "Notes" },
                  ]} />
                </div>
                {tl.length === 0 ? <Empty title="Nothing here yet">Calls, messages, quotes, trips and payments for {c.name} appear here as they happen.</Empty> : (
                  <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-line">
                    {tl.slice(0, 80).map((t) => {
                      const s = TL_STYLE[t.kind];
                      const inner = (
                        <>
                          <span className="relative z-[1] ring-4 ring-white"><IconChip tone={s.tone} size="sm">{s.icon}</IconChip></span>
                          <span className="min-w-0 flex-1 pt-0.5">
                            <span className="line-clamp-2 text-sm leading-5 text-ink-900">{t.title}</span>
                            <span className="mt-0.5 block text-xs text-ink-500">{t.detail ? <>{t.detail} · </> : null}{relTime(t.at)}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={t.id}>
                          {t.to ? <Link to={t.to} className="flex gap-3 rounded-lg p-1.5 transition hover:bg-slate-50">{inner}</Link> : <div className="flex gap-3 p-1.5">{inner}</div>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </>
            )}

            {tab === "enquiries" && (
              <DataTable rows={r.leads} onRowClick={(l) => nav(`/app/leads/${l.id}`)} empty={<>No enquiries yet. <button className="font-medium text-brand-700 hover:underline" onClick={() => setEnquiry(true)}>Add one</button></>}
                columns={[
                  { key: "dest", header: "Enquiry", render: (l) => <span><span className="font-medium">{l.destination || titleCase(l.service)}</span><span className="block text-xs text-ink-500">{titleCase(l.source)} · {relTime(l.createdAt)}</span></span> },
                  { key: "travel", header: "Travel", render: (l) => (l.travelDate ? formatDate(l.travelDate) : "—"), hideOnMobile: true },
                  { key: "pax", header: "Pax", render: (l) => l.pax.adults + l.pax.children + l.pax.infants, align: "right", hideOnMobile: true },
                  { key: "budget", header: "Budget", render: (l) => money(l.budget), align: "right" },
                  { key: "stage", header: "Stage", render: (l) => <StatusBadge status={l.stage} /> },
                ]} />
            )}

            {tab === "quotes" && (
              <DataTable rows={r.quotes} onRowClick={(x) => nav(`/app/quotes/${x.id}`)} empty="No quotes yet."
                columns={[
                  { key: "n", header: "Quote", render: (x) => <span><span className="font-medium">{x.number || "Draft"}</span><span className="block text-xs text-ink-500">{x.title} · v{x.version}</span></span> },
                  { key: "d", header: "Destination", render: (x) => x.destination || "—", hideOnMobile: true },
                  { key: "views", header: "Views", render: (x) => x.views, align: "right", hideOnMobile: true },
                  { key: "t", header: "Total", render: (x) => money(x.total), align: "right", sort: (x) => x.total },
                  { key: "s", header: "Status", render: (x) => <StatusBadge status={x.status} /> },
                ]} />
            )}

            {tab === "bookings" && (
              <DataTable rows={r.bookings} onRowClick={(b) => nav(`/app/bookings/${b.id}`)} empty="No trips booked yet."
                columns={[
                  { key: "n", header: "Trip", render: (b) => <span><span className="font-medium">{b.title || b.destination}</span><span className="block text-xs text-ink-500">{b.number}</span></span> },
                  { key: "dates", header: "Dates", render: (b) => `${formatDate(b.startDate)} → ${formatDate(b.endDate)}`, sort: (b) => b.startDate },
                  { key: "sell", header: "Value", render: (b) => money(b.sellTotal), align: "right", sort: (b) => b.sellTotal },
                  { key: "s", header: "Status", render: (b) => <StatusBadge status={b.status} /> },
                ]} />
            )}

            {tab === "money" && (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-ink-500">Billed</div><div className="mt-0.5 font-semibold tabular-nums">{money(r.billed)}</div></div>
                  <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Received</div><div className="mt-0.5 font-semibold tabular-nums text-emerald-800">{money(r.paidIn)}</div></div>
                  <div className={cx("rounded-lg p-3", r.due > 0 ? "bg-amber-50" : "bg-slate-50")}><div className={cx("text-xs", r.due > 0 ? "text-amber-700" : "text-ink-500")}>Outstanding</div><div className={cx("mt-0.5 font-semibold tabular-nums", r.due > 0 && "text-amber-800")}>{money(r.due)}</div></div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-ink-800">Invoices</h4>
                  <DataTable rows={r.invoices} onRowClick={(i) => nav(`/app/finance/invoices/${i.id}`)} pageSize={10} empty="No invoices yet."
                    columns={[
                      { key: "n", header: "Invoice", render: (i) => <span><span className="font-medium">{i.number}</span><span className="block text-xs text-ink-500">Issued {formatDate(i.issueDate)}</span></span> },
                      { key: "t", header: "Total", render: (i) => money(i.total), align: "right" },
                      { key: "d", header: "Due", render: (i) => { const d = i.total - i.paid - i.credited; return d > 0 ? <span className={cx("font-medium", i.dueDate < today ? "text-rose-700" : "text-amber-700")}>{money(d)}</span> : "—"; }, align: "right" },
                      { key: "s", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
                    ]} />
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-ink-800">Payments</h4>
                  <DataTable rows={r.payments} pageSize={10} empty="No payments yet."
                    onRowClick={(p) => p.invoiceId && nav(`/app/finance/invoices/${p.invoiceId}`)}
                    columns={[
                      { key: "d", header: "Date", render: (p) => formatDate(p.date), sort: (p) => p.date },
                      { key: "m", header: "Method", render: (p) => <span>{titleCase(p.method)}{p.reference && <span className="block text-xs text-ink-500">{p.reference}</span>}</span> },
                      { key: "a", header: "Amount", align: "right", render: (p) => <span className={cx("font-medium tabular-nums", p.direction === "in" ? "text-emerald-700" : "text-rose-700")}>{p.direction === "in" ? "+" : "−"}{money(p.amount)}</span> },
                    ]} />
                </div>
              </div>
            )}

            {tab === "visa" && (
              <DataTable rows={data.myVisas} onRowClick={(v) => nav(`/app/visa/${v.id}`)}
                empty={<>No visa cases. <Link to="/app/visa?new=1" className="font-medium text-brand-700 hover:underline">Start one</Link></>}
                columns={[
                  { key: "n", header: "Case", render: (v) => <span><span className="font-medium">{v.number}</span><span className="block text-xs text-ink-500">{v.applicants.length} applicant{v.applicants.length === 1 ? "" : "s"}</span></span> },
                  { key: "c", header: "Visa", render: (v) => `${v.country} · ${v.visaType}` },
                  { key: "t", header: "Travel", render: (v) => (v.travelDate ? formatDate(v.travelDate) : "—"), hideOnMobile: true },
                  { key: "s", header: "Status", render: (v) => <StatusBadge status={v.status} /> },
                ]} />
            )}

            {tab === "documents" && <ContactDocuments contactId={c.id} />}
          </Card>
        </div>

        {/* ── Side column ── */}
        <div className="space-y-5">
          {data.upcoming && (
            <Link to={`/app/bookings/${data.upcoming.id}`} className="block rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4 shadow-card transition hover:shadow-lift">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-700"><CalendarDays className="size-3.5" />{data.upcoming.startDate <= today ? "Travelling now" : "Next trip"}</div>
              <div className="mt-1.5 text-[15px] font-semibold text-ink-900">{data.upcoming.title || data.upcoming.destination}</div>
              <div className="mt-0.5 text-sm text-ink-600">{formatDate(data.upcoming.startDate)} → {formatDate(data.upcoming.endDate)}</div>
              <div className="mt-2 flex items-center gap-2"><StatusBadge status={data.upcoming.status} /><span className="text-xs text-ink-500">{data.upcoming.number}</span></div>
            </Link>
          )}

          <Card>
            <CardTitle title="Profile" action={writable && <Button size="sm" variant="ghost" onClick={openEdit}><Pencil className="size-4" /></Button>} />
            <KeyValue items={[
              ["Phone", c.phone || "—"], ["Email", <span className="break-all">{c.email || "—"}</span>], ["City", c.city || "—"],
              ["Date of birth", c.dob ? formatDate(c.dob) : "—"], ["PAN", c.pan || <span className="text-amber-700">Missing — needed for TCS</span>], ["Passport", c.passportNo || "—"],
            ]} />
            {c.preferences && <div className="mt-4 rounded-lg bg-amber-50/70 p-3 text-sm text-amber-900"><div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700">Preferences</div>{c.preferences}</div>}
          </Card>

          <Card>
            <CardTitle title="Family & co-travellers" subtitle={`${c.family.length} saved — reused on quotes and visa forms`}
              action={writable && <Button size="sm" variant="soft" icon={<UserPlus className="size-4" />} onClick={() => setMember({ name: "", relation: "", dob: "", passportNo: "" })}>Add</Button>} />
            {c.family.length === 0 ? <p className="text-sm text-ink-500">No travellers saved yet.</p> : (
              <ul className="divide-y divide-line">
                {c.family.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 py-2">
                    <Avatar name={f.name} size={8} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block text-xs text-ink-500">{[f.relation && titleCase(f.relation), f.dob && formatDate(f.dob), f.passportNo].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                    {f.dob && f.dob > `${new Date().getFullYear() - 12}` && <Baby className="size-4 text-ink-400" aria-label="Child" />}
                    {writable && <button aria-label={`Remove ${f.name}`} className="rounded p-1 text-ink-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => void saveFamily(c.family.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.myTasks.length > 0 && (
            <Card>
              <CardTitle title="Open tasks" subtitle={`${data.myTasks.length} for this customer`} action={<Link to="/app/tasks" className="text-[13px] font-medium text-brand-700 hover:underline">All tasks</Link>} />
              <ul className="space-y-2">
                {data.myTasks.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", t.dueAt < new Date().toISOString() ? "bg-rose-500" : t.priority === "high" ? "bg-amber-500" : "bg-slate-300")} />
                    <Link to={t.bookingId ? `/app/bookings/${t.bookingId}` : t.leadId ? `/app/leads/${t.leadId}` : t.visaCaseId ? `/app/visa/${t.visaCaseId}` : "/app/tasks"} className="min-w-0 flex-1 hover:text-brand-700">
                      <span className="block">{t.title}</span><span className="text-xs text-ink-500">Due {relTime(t.dueAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardTitle title="Quick actions" />
            <div className="grid gap-2">
              {g.can("leads") && <QuickLink icon={<Plus />} label="New enquiry" hint="Holiday, flight, hotel or visa" onClick={() => setEnquiry(true)} />}
              {canRead(role, "visaCases") && <QuickLink icon={<Stamp />} label="Start a visa case" hint="Checklist and passport scan" to="/app/visa?new=1" />}
              {canRead(role, "paymentLinks") && <QuickLink icon={<Receipt />} label="Send a payment link" hint="UPI, card or EMI" to="/app/finance/links?new=1" />}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} size="lg" title="Edit customer"
        footer={<><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button busy={m.busy} onClick={save}>Save</Button></>}>
        <EntityForm fields={CONTACT_FIELDS} values={values} onChange={setValues} errors={m.fieldErrors} />
      </Modal>

      <Modal open={member !== null} onClose={() => setMember(null)} title="Add a traveller"
        footer={<><Button variant="secondary" onClick={() => setMember(null)}>Cancel</Button><Button busy={m.busy} disabled={!member?.name.trim()} onClick={async () => {
          if (!member) return;
          const ok = await saveFamily([...c.family, { name: member.name.trim(), relation: member.relation.trim(), dob: member.dob || null, passportNo: member.passportNo.trim() }]);
          if (ok) setMember(null);
        }}>Add traveller</Button></>}>
        {member && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required><Input value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} autoFocus /></Field>
            <Field label="Relation"><Input value={member.relation} onChange={(e) => setMember({ ...member, relation: e.target.value })} placeholder="Spouse, child, parent…" /></Field>
            <Field label="Date of birth"><Input type="date" value={member.dob} onChange={(e) => setMember({ ...member, dob: e.target.value })} /></Field>
            <Field label="Passport no."><Input value={member.passportNo} onChange={(e) => setMember({ ...member, passportNo: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <NewLeadModal open={enquiry} onClose={() => setEnquiry(false)} prefill={{ name: c.name, phone: c.phone, email: c.email }} />
    </div>
  );
}

function QuickLink({ icon, label, hint, to, onClick }: { icon: ReactNode; label: string; hint: string; to?: string; onClick?: () => void }) {
  const body = (
    <>
      <IconChip size="sm">{icon}</IconChip>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink-900">{label}</span><span className="block text-xs text-ink-500">{hint}</span></span>
      <span aria-hidden className="text-ink-300">→</span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-left transition hover:border-brand-200 hover:bg-brand-50/40";
  return to ? <Link to={to} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}
