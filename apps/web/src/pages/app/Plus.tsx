import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bot, Download, FileUp, Hotel, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plane, Plus, Send, ShieldCheck, Sparkles, TrendingUp, Upload } from "lucide-react";
import { addDays, formatDate, isoDate, type Entity, type Settings } from "@voyadesk/core";
import { api, type IntegrationsInfo } from "../../lib/api";
import { money, relTime, titleCase } from "../../lib/format";
import { useAction, useList, useQuery, useReport } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { copyText, toast } from "../../lib/toast";
import { ResourcePage } from "../../components/ResourcePage";
import { RankBars } from "../../components/charts";
import { DeliveryChip } from "../../components/plus";
import { Badge, Button, Callout, Card, CardTitle, DataTable, Empty, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Stat, StatusBadge, Tabs, Textarea, Toggle, cx } from "../../components/ui";
import { AiMessageTab } from "./AiStudio";

const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`);

/* ───────────────────────── Calls ───────────────────────── */

export function CallsPage() {
  const calls = useList("calls");
  const leads = useList("leads");
  const users = useList("users");
  const segments = useList("segments");
  const rep = useReport<{ today: number; todayMissed: number; recordings: number; followUpRate: number; avgTalkSec: number; aiCalls: number; byUser: { name: string; calls: number; talkMinutes: number }[] }>("calls", {});
  const { act, busy } = useAction();
  const [tab, setTab] = useState<"all" | "missed" | "ai">("all");
  const [logOpen, setLogOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [f, setF] = useState({ phone: "", name: "", direction: "out", status: "answered", minutes: "3" });
  const [ai, setAi] = useState({ segmentId: "", leadIds: [] as string[], script: "Hi {name}, this is the travel desk calling about your holiday enquiry. Are your dates still the same, and shall we send options on WhatsApp?" });
  const rows = (calls.data ?? []).filter((c) => (tab === "missed" ? c.status === "missed" : tab === "ai" ? c.source === "ai_voice" : true)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const r = rep.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Calls" subtitle="Every call logged against the lead automatically — IVR, your team's phones (SIM app) and AI voice calls." actions={<><Button variant="secondary" icon={<Bot className="size-4" />} onClick={() => setAiOpen(true)}>AI voice calls</Button><Button icon={<Plus className="size-4" />} onClick={() => setLogOpen(true)}>Log a call</Button></>} />
      {r && <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Calls today" value={r.today} icon={<PhoneCall className="size-4" />} />
        <Stat label="Missed today" value={r.todayMissed} tone={r.todayMissed ? "bad" : "good"} icon={<PhoneMissed className="size-4" />} />
        <Stat label="Call-back rate" value={`${r.followUpRate}%`} tone={r.followUpRate >= 90 ? "good" : "warn"} hint="Missed calls returned" />
        <Stat label="Average talk time" value={secs(r.avgTalkSec)} />
        <Stat label="Recordings" value={r.recordings} hint={`${r.aiCalls} AI calls`} />
      </div>}
      {r && r.byUser.length > 0 && <Card><CardTitle title="Calls by team member" /><RankBars items={r.byUser.map((u) => ({ label: `${u.name} · ${u.talkMinutes} min`, value: u.calls }))} /></Card>}
      <Tabs tabs={[{ key: "all", label: "All calls", count: (calls.data ?? []).length }, { key: "missed", label: "Missed", count: (calls.data ?? []).filter((c) => c.status === "missed").length }, { key: "ai", label: "AI voice", count: (calls.data ?? []).filter((c) => c.source === "ai_voice").length }]} value={tab} onChange={setTab} />
      <DataTable rows={rows} search={(c) => `${c.name} ${c.phone} ${c.outcome}`} empty="No calls yet. Connect your IVR or the SIM call-log app in Settings → Integrations." columns={[
        { key: "d", header: "", render: (c) => (c.direction === "in" ? c.status === "missed" ? <PhoneMissed className="size-4 text-rose-600" /> : <PhoneIncoming className="size-4 text-emerald-600" /> : <PhoneOutgoing className="size-4 text-brand-600" />) },
        { key: "who", header: "Caller", render: (c) => <span><span className="font-medium">{c.name || c.phone}</span><span className="block text-xs text-ink-500">{c.phone}</span></span>, sort: (c) => c.name },
        { key: "lead", header: "Lead", render: (c) => (c.leadId ? <Link className="text-brand-700 hover:underline" to={`/app/leads/${c.leadId}`} onClick={(e) => e.stopPropagation()}>{leads.data?.find((l) => l.id === c.leadId)?.name ?? "Open lead"}</Link> : "—"), hideOnMobile: true },
        { key: "when", header: "When", render: (c) => relTime(c.startedAt), sort: (c) => c.startedAt },
        { key: "len", header: "Length", render: (c) => (c.durationSec ? secs(c.durationSec) : "—"), align: "right" },
        { key: "by", header: "Team", render: (c) => users.data?.find((u) => u.id === c.userId)?.name ?? (c.source === "ai_voice" ? "AI voice" : "—"), hideOnMobile: true },
        { key: "rec", header: "Recording / outcome", render: (c) => <span className="block max-w-xs">{c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} className="h-8 w-48" /> : null}{c.outcome && <span className="block text-xs text-ink-600">{c.outcome}</span>}{c.transcript && <details className="text-xs text-ink-500"><summary className="cursor-pointer">Transcript</summary><pre className="whitespace-pre-wrap">{c.transcript}</pre></details>}</span> },
        { key: "s", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
      ]} />
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log a call" footer={<Button busy={busy} onClick={async () => { const x = await act("recordCall", { phone: f.phone, name: f.name || undefined, direction: f.direction, status: f.status, durationSec: Math.round(Number(f.minutes) * 60) || 0, source: "manual" }, "Call logged"); if (x) setLogOpen(false); }}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" required><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Direction"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="out">Outgoing</option><option value="in">Incoming</option></Select></Field>
          <Field label="Result"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="answered">Answered</option><option value="missed">Missed</option><option value="no_answer">No answer</option><option value="busy">Busy</option></Select></Field>
          <Field label="Minutes"><Input type="number" min={0} step="0.5" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={aiOpen} onClose={() => setAiOpen(false)} size="lg" title="AI voice calls" footer={<Button busy={busy} icon={<Bot className="size-4" />} onClick={async () => { const x = await act<{ calls: unknown[]; sandbox: boolean }>("startAiCalls", { leadIds: ai.leadIds, segmentId: ai.segmentId || undefined, script: ai.script }, (res) => `${res.calls.length} call(s) ${res.sandbox ? "simulated (sandbox)" : "placed"}`); if (x) { setAiOpen(false); setTab("ai"); } }}>Start calls</Button>}>
        <div className="space-y-3">
          <Callout tone="info">The voice assistant reads your script, asks the questions and logs the answer on each lead. Interested people get a call-back task. In the demo calls are simulated; live calls go through your voice provider (e.g. Exotel voice bot).</Callout>
          <Field label="Call a segment"><Select value={ai.segmentId} onChange={(e) => setAi({ ...ai, segmentId: e.target.value })}><option value="">— Pick leads below instead —</option>{(segments.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Or pick open leads"><div className="max-h-40 overflow-y-auto rounded-lg border border-line p-2 text-sm">{(leads.data ?? []).filter((l) => l.phone && !["won", "lost"].includes(l.stage)).slice(0, 40).map((l) => <label key={l.id} className="flex items-center gap-2 py-0.5"><input type="checkbox" className="accent-brand-600" checked={ai.leadIds.includes(l.id)} onChange={(e) => setAi({ ...ai, leadIds: e.target.checked ? [...ai.leadIds, l.id] : ai.leadIds.filter((x) => x !== l.id) })} />{l.name} · {l.destination || "—"}</label>)}</div></Field>
          <Field label="Script" hint="{name} becomes the customer's first name"><Textarea rows={4} value={ai.script} onChange={(e) => setAi({ ...ai, script: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── Booking engines (staff) ───────────────────────── */

interface Offer { id: string; airlineName: string; flightNo: string; from: string; to: string; departAt: string; arriveAt: string; durationMin: number; stops: number; baggage: string; refundable: boolean; seatsLeft: number; sell: number; netFare: number }
interface HotelResult { hotelId: string; hotel: string; city: string; stars: number; roomType: string; mealPlan: string; roomsLeft: number | null; instant: boolean; sell: number }
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function EnginesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "flights" | "hotels" | "series" | "insurance") || "flights";
  const { user } = useSession();
  const quotes = useList("quotes");
  const series = useList("seriesFares");
  const plans = useList("insurancePlans");
  const { act, busy } = useAction();
  const nav = useNavigate();
  const [fq, setFq] = useState({ from: "BOM", to: "DXB", date: addDays(isoDate(new Date()), 21), adults: 2, children: 0, cabin: "economy" as const });
  const [offers, setOffers] = useState<{ offers: Offer[]; sandbox: boolean } | null>(null);
  const [hq, setHq] = useState({ city: "Goa", checkIn: addDays(isoDate(new Date()), 21), nights: 3, rooms: 1, adults: 2, children: 0 });
  const [hotels, setHotels] = useState<HotelResult[] | null>(null);
  const [target, setTarget] = useState<{ kind: "flight"; offer: Offer } | { kind: "hotel"; h: HotelResult } | { kind: "series"; sf: Entity<"seriesFares"> } | { kind: "insurance"; plan: Entity<"insurancePlans"> } | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [addTo, setAddTo] = useState("");
  const [extra, setExtra] = useState({ seats: 1, from: addDays(isoDate(new Date()), 21), to: addDays(isoDate(new Date()), 27), destination: "Dubai", travellers: "" });
  const draftQuotes = (quotes.data ?? []).filter((q) => q.status !== "accepted").slice(0, 50);
  const isAgent = user?.role === "agent";

  const createQuote = async () => {
    if (!target) return;
    let q: { id: string } | undefined;
    if (target.kind === "flight" && addTo) q = await act("addFlightToQuote", { quoteId: addTo, offerId: target.offer.id, query: fq }, "Live fare added to the quote");
    else if (target.kind === "flight") q = await act("flightQuote", { offerId: target.offer.id, query: fq, contact }, "Quote created");
    else if (target.kind === "hotel") q = await act("hotelQuote", { hotelId: target.h.hotelId, roomType: target.h.roomType, mealPlan: target.h.mealPlan, checkIn: hq.checkIn, nights: hq.nights, rooms: hq.rooms, adults: hq.adults, children: hq.children, contact }, "Quote created");
    else if (target.kind === "series") q = await act("seriesQuote", { seriesId: target.sf.id, seats: extra.seats, contact }, "Seats quoted");
    else q = await act("insuranceQuote", { planId: target.plan.id, from: extra.from, to: extra.to, destination: extra.destination, travellers: extra.travellers.split(",").map((n) => n.trim()).filter(Boolean).map((name) => ({ name, dob: null })), contact }, "Insurance quoted");
    if (q) { setTarget(null); nav(isAgent ? "/agent" : `/app/quotes/${q.id}`); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Flights, hotels & more" subtitle="Search live fares and your own contracted inventory, then turn the result into a quote in one click." />
      <Tabs tabs={[{ key: "flights", label: "Flights" }, { key: "hotels", label: "Hotels" }, { key: "series", label: "Series fares" }, { key: "insurance", label: "Insurance" }]} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "flights" && <>
        <Card><form className="grid gap-3 sm:grid-cols-7" onSubmit={async (e) => { e.preventDefault(); const r = await act<{ offers: Offer[]; sandbox: boolean }>("flightSearch", fq); if (r) setOffers(r); }}>
          <Field label="From"><Input maxLength={3} value={fq.from} onChange={(e) => setFq({ ...fq, from: e.target.value.toUpperCase() })} /></Field>
          <Field label="To"><Input maxLength={3} value={fq.to} onChange={(e) => setFq({ ...fq, to: e.target.value.toUpperCase() })} /></Field>
          <Field label="Date"><Input type="date" value={fq.date} onChange={(e) => setFq({ ...fq, date: e.target.value })} /></Field>
          <Field label="Adults"><Input type="number" min={1} max={9} value={fq.adults} onChange={(e) => setFq({ ...fq, adults: Number(e.target.value) || 1 })} /></Field>
          <Field label="Children"><Input type="number" min={0} max={8} value={fq.children} onChange={(e) => setFq({ ...fq, children: Number(e.target.value) || 0 })} /></Field>
          <Field label="Cabin"><Select value={fq.cabin} onChange={(e) => setFq({ ...fq, cabin: e.target.value as "economy" })}><option value="economy">Economy</option><option value="premium">Premium</option><option value="business">Business</option></Select></Field>
          <div className="flex items-end"><Button type="submit" className="w-full" busy={busy} icon={<Plane className="size-4" />}>Search</Button></div>
        </form></Card>
        {offers?.sandbox && <Callout tone="info">Sandbox fares (demo). Connect a flight supplier in Settings → Integrations for live GDS/LCC fares and ticketing.</Callout>}
        {offers && <DataTable rows={offers.offers} empty="No flights found." columns={[
          { key: "a", header: "Flight", render: (o) => <span><span className="font-medium">{o.airlineName}</span><span className="block text-xs text-ink-500">{o.flightNo}</span></span> },
          { key: "t", header: "Time", render: (o) => `${hhmm(o.departAt)} → ${hhmm(o.arriveAt)} · ${Math.floor(o.durationMin / 60)}h${o.durationMin % 60 ? ` ${o.durationMin % 60}m` : ""}`, sort: (o) => o.departAt },
          { key: "s", header: "Stops", render: (o) => (o.stops ? `${o.stops} stop` : "Non-stop") },
          { key: "b", header: "Bags", render: (o) => o.baggage, hideOnMobile: true },
          ...(isAgent ? [] : [{ key: "n", header: "Net", render: (o: Offer) => money(o.netFare), align: "right" as const }]),
          { key: "p", header: "Sell (incl. tax)", render: (o) => <b>{money(o.sell)}</b>, align: "right", sort: (o) => o.sell },
          { key: "x", header: "", render: (o) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget({ kind: "flight", offer: o }); }}>Use</Button>, align: "right" },
        ]} />}
      </>}
      {tab === "hotels" && <>
        <Card><form className="grid gap-3 sm:grid-cols-6" onSubmit={async (e) => { e.preventDefault(); const r = await act<HotelResult[]>("hotelSearch", hq); if (r) setHotels(r); }}>
          <Field label="City"><Input value={hq.city} onChange={(e) => setHq({ ...hq, city: e.target.value })} /></Field>
          <Field label="Check-in"><Input type="date" value={hq.checkIn} onChange={(e) => setHq({ ...hq, checkIn: e.target.value })} /></Field>
          <Field label="Nights"><Input type="number" min={1} value={hq.nights} onChange={(e) => setHq({ ...hq, nights: Number(e.target.value) || 1 })} /></Field>
          <Field label="Rooms"><Input type="number" min={1} value={hq.rooms} onChange={(e) => setHq({ ...hq, rooms: Number(e.target.value) || 1 })} /></Field>
          <Field label="Adults"><Input type="number" min={1} value={hq.adults} onChange={(e) => setHq({ ...hq, adults: Number(e.target.value) || 1 })} /></Field>
          <div className="flex items-end"><Button type="submit" className="w-full" busy={busy} icon={<Hotel className="size-4" />}>Search</Button></div>
        </form></Card>
        {hotels && <DataTable rows={hotels.map((h) => ({ ...h, id: `${h.hotelId}${h.roomType}${h.mealPlan}` }))} empty="Nothing available for these dates." columns={[
          { key: "h", header: "Hotel", render: (h) => <span><span className="font-medium">{h.hotel}</span><span className="block text-xs text-ink-500">{"★".repeat(h.stars)} · {h.roomType} · {h.mealPlan}</span></span> },
          { key: "a", header: "Availability", render: (h) => (h.instant ? <Badge tone="green">{h.roomsLeft} rooms · instant</Badge> : <Badge>On request</Badge>) },
          { key: "p", header: "Sell (incl. tax)", render: (h) => <b>{money(h.sell)}</b>, align: "right", sort: (h) => h.sell },
          { key: "x", header: "", render: (h) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget({ kind: "hotel", h }); }}>Quote</Button>, align: "right" },
        ]} />}
      </>}
      {tab === "series" && <DataTable rows={(series.data ?? []).filter((s) => s.status === "open")} empty="No open series fares. Add them in Inventory." columns={[
        { key: "r", header: "Route", render: (s) => <span className="font-medium">{s.from} → {s.to}</span> },
        { key: "f", header: "Flight", render: (s) => `${s.airline} ${s.flightNo}` },
        { key: "d", header: "Departs", render: (s) => `${formatDate(s.departDate)} ${s.departTime}`, sort: (s) => s.departDate },
        { key: "l", header: "Seats left", render: (s) => <Badge tone={s.seats - s.sold < 5 ? "red" : "green"}>{s.seats - s.sold} of {s.seats}</Badge> },
        { key: "p", header: "Fare", render: (s) => money(s.sellFare), align: "right" },
        { key: "x", header: "", render: (s) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setTarget({ kind: "series", sf: s }); }}>Quote seats</Button>, align: "right" },
      ]} />}
      {tab === "insurance" && <div className="grid gap-3 sm:grid-cols-3">{(plans.data ?? []).filter((p) => p.active).map((p) => (
        <Card key={p.id}><div className="font-medium">{p.name}</div><div className="text-xs text-ink-500">{p.insurer} · {titleCase(p.region)} · {money(p.premiumPerDay)}/day (min {money(p.minPremium)})</div><ul className="mt-2 space-y-0.5 text-sm">{p.benefits.slice(0, 3).map((b) => <li key={b}>• {b}</li>)}</ul><Button size="sm" className="mt-3" icon={<ShieldCheck className="size-4" />} onClick={() => setTarget({ kind: "insurance", plan: p })}>Quote this plan</Button></Card>
      ))}</div>}
      <Modal open={target !== null} onClose={() => setTarget(null)} size="lg" title="Create a quote" footer={<><Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button><Button busy={busy} onClick={() => void createQuote()}>{target?.kind === "flight" && addTo ? "Add to quote" : "Create quote"}</Button></>}>
        <div className="space-y-3">
          {target?.kind === "flight" && !isAgent && <Field label="Add to an existing quote (optional)"><Select value={addTo} onChange={(e) => setAddTo(e.target.value)}><option value="">— New flight-only quote —</option>{draftQuotes.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.contactName} · {q.title}</option>)}</Select></Field>}
          {target?.kind === "series" && <Field label="Seats"><Input type="number" min={1} max={target.sf.seats - target.sf.sold} value={extra.seats} onChange={(e) => setExtra({ ...extra, seats: Number(e.target.value) || 1 })} /></Field>}
          {target?.kind === "insurance" && <div className="grid gap-3 sm:grid-cols-3"><Field label="Destination"><Input value={extra.destination} onChange={(e) => setExtra({ ...extra, destination: e.target.value })} /></Field><Field label="From"><Input type="date" value={extra.from} onChange={(e) => setExtra({ ...extra, from: e.target.value })} /></Field><Field label="To"><Input type="date" value={extra.to} onChange={(e) => setExtra({ ...extra, to: e.target.value })} /></Field><Field label="Traveller names (comma separated)" className="sm:col-span-3"><Input value={extra.travellers} onChange={(e) => setExtra({ ...extra, travellers: e.target.value })} /></Field></div>}
          {!(target?.kind === "flight" && addTo) && <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Customer name" required><Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></Field>
            <Field label="Phone" required><Input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
          </div>}
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── Inventory & rate import ───────────────────────── */

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "allotments" | "series" | "plans" | "vehicles" | "import") || "allotments";
  const hotels = useList("hotels");
  const hotelName = (id: string) => hotels.data?.find((h) => h.id === id)?.name ?? "Hotel";
  return (
    <div className="space-y-4">
      <PageHeader title="Inventory & rates" subtitle="Contracted rooms with live availability, series fares, insurance plans, vehicle rates and rate-sheet import." />
      <Tabs tabs={[{ key: "allotments", label: "Hotel allotments" }, { key: "series", label: "Series fares" }, { key: "plans", label: "Insurance plans" }, { key: "vehicles", label: "Vehicle rates" }, { key: "import", label: "Import rate sheet" }]} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "allotments" && <><AvailabilityGrid /><ResourcePage embedded collection="allotments" title="Allotment blocks" singular="Allotment" search={(a) => hotelName(a.hotelId) + a.roomType}
        columns={[{ key: "h", header: "Hotel", render: (a) => hotelName(a.hotelId) }, { key: "r", header: "Room type", render: (a) => a.roomType }, { key: "d", header: "Dates", render: (a) => `${formatDate(a.from)} – ${formatDate(a.to)}` }, { key: "n", header: "Rooms/night", render: (a) => a.rooms, align: "right" }, { key: "b", header: "Nights sold", render: (a) => Object.values(a.booked).reduce((x, y) => x + y, 0), align: "right" }]}
        fields={[{ name: "hotelId", label: "Hotel", type: "ref", ref: "hotels", required: true, nullable: false }, { name: "roomType", label: "Room type (as in the hotel's rates)", type: "text", required: true }, { name: "from", label: "From", type: "date", required: true }, { name: "to", label: "To", type: "date", required: true }, { name: "rooms", label: "Rooms per night", type: "number", required: true }, { name: "releaseDays", label: "Release days before arrival", type: "number" }]}
        defaults={{ rooms: 5, releaseDays: 7, booked: {} }} /></>}
      {tab === "series" && <ResourcePage embedded collection="seriesFares" title="Series fares" singular="Series fare" search={(s) => `${s.from} ${s.to} ${s.flightNo}`}
        columns={[{ key: "r", header: "Route", render: (s) => `${s.from} → ${s.to}` }, { key: "f", header: "Flight", render: (s) => `${s.airline} ${s.flightNo}` }, { key: "d", header: "Departs", render: (s) => `${formatDate(s.departDate)} ${s.departTime}`, sort: (s) => s.departDate }, { key: "s", header: "Sold", render: (s) => `${s.sold}/${s.seats}`, align: "right" }, { key: "n", header: "Net", render: (s) => money(s.netFare), align: "right" }, { key: "p", header: "Sell", render: (s) => money(s.sellFare), align: "right" }, { key: "st", header: "", render: (s) => <StatusBadge status={s.status} /> }]}
        fields={[{ name: "airline", label: "Airline", type: "text", required: true }, { name: "flightNo", label: "Flight no.", type: "text", required: true }, { name: "from", label: "From (IATA)", type: "text", required: true }, { name: "to", label: "To (IATA)", type: "text", required: true }, { name: "departDate", label: "Departure date", type: "date", required: true }, { name: "departTime", label: "Departs at", type: "text" }, { name: "arriveTime", label: "Arrives at", type: "text" }, { name: "returnFlightNo", label: "Return flight", type: "text" }, { name: "returnDate", label: "Return date", type: "date" }, { name: "seats", label: "Seats blocked", type: "number", required: true }, { name: "netFare", label: "Net fare per seat", type: "money", required: true }, { name: "sellFare", label: "Sell fare per seat", type: "money", required: true }, { name: "baggage", label: "Baggage", type: "text" }, { name: "pnr", label: "Group PNR", type: "text" }, { name: "supplierId", label: "Supplier", type: "ref", ref: "suppliers" }, { name: "status", label: "Status", type: "select", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] }]}
        defaults={{ departTime: "06:00", arriveTime: "09:00", seats: 30, status: "open" }} />}
      {tab === "plans" && <ResourcePage embedded collection="insurancePlans" title="Insurance plans" singular="Plan" search={(p) => p.name + p.insurer}
        columns={[{ key: "n", header: "Plan", render: (p) => <span className="font-medium">{p.name}</span> }, { key: "i", header: "Insurer", render: (p) => p.insurer }, { key: "r", header: "Region", render: (p) => titleCase(p.region) }, { key: "p", header: "Per day", render: (p) => money(p.premiumPerDay), align: "right" }, { key: "a", header: "", render: (p) => <StatusBadge status={p.active ? "active" : "inactive"} /> }]}
        fields={[{ name: "name", label: "Plan name", type: "text", required: true }, { name: "insurer", label: "Insurer", type: "text", required: true }, { name: "region", label: "Region", type: "select", options: ["domestic", "asia", "worldwide", "schengen"].map((v) => ({ value: v, label: titleCase(v) })) }, { name: "sumInsured", label: "Sum insured", type: "money" }, { name: "premiumPerDay", label: "Premium per traveller per day", type: "money", required: true }, { name: "minPremium", label: "Minimum premium", type: "money" }, { name: "maxAge", label: "Maximum age", type: "number" }, { name: "benefits", label: "Benefits", type: "tags" }, { name: "active", label: "On sale", type: "toggle" }]}
        defaults={{ region: "asia", maxAge: 70, active: true }} />}
      {tab === "vehicles" && <ResourcePage embedded collection="vehicleRates" title="Vehicle rates" singular="Vehicle" search={(v) => v.name + v.city}
        columns={[{ key: "n", header: "Vehicle", render: (v) => <span className="font-medium">{v.name}</span> }, { key: "c", header: "Seats", render: (v) => v.capacity, align: "right" }, { key: "d", header: "Per day", render: (v) => money(v.perDay), align: "right" }, { key: "k", header: "Per extra km", render: (v) => money(v.perKm), align: "right" }, { key: "i", header: "Km/day included", render: (v) => v.kmIncludedPerDay, align: "right" }, { key: "city", header: "City", render: (v) => v.city || "Any" }]}
        fields={[{ name: "name", label: "Vehicle", type: "text", required: true }, { name: "capacity", label: "Seats", type: "number", required: true }, { name: "perDay", label: "Rate per day", type: "money", required: true }, { name: "perKm", label: "Rate per extra km", type: "money" }, { name: "kmIncludedPerDay", label: "Km included per day", type: "number" }, { name: "allowancePerDay", label: "Driver allowance per day", type: "money" }, { name: "city", label: "City (blank = any)", type: "text" }]}
        defaults={{ capacity: 4, kmIncludedPerDay: 250 }} />}
      {tab === "import" && <RateImport />}
    </div>
  );
}

function AvailabilityGrid() {
  const r = useReport<{ dates: string[]; rows: { hotel: string; city: string; roomType: string; cells: ({ total: number; booked: number } | null)[] }[] }>("availability", { days: 14 });
  if (!r.data) return <Loading />;
  if (!r.data.rows.length) return null;
  return (
    <Card padded={false}>
      <div className="px-4 pt-4"><CardTitle title="Rooms left — next 14 nights" subtitle="Updates instantly as bookings confirm or cancel" /></div>
      <div className="overflow-x-auto pb-3">
        <table className="min-w-full text-xs">
          <thead><tr><th className="sticky left-0 bg-white px-4 py-1 text-left font-medium text-ink-500">Hotel · room</th>{r.data.dates.map((d) => <th key={d} className="px-1 py-1 font-medium text-ink-500">{d.slice(8)}/{d.slice(5, 7)}</th>)}</tr></thead>
          <tbody>{r.data.rows.map((row) => (
            <tr key={row.hotel + row.roomType}><td className="sticky left-0 whitespace-nowrap bg-white px-4 py-1">{row.hotel} · {row.roomType}</td>{row.cells.map((c, i) => { const left = c ? c.total - c.booked : null; return <td key={i} className="px-0.5 py-1 text-center"><span className={cx("inline-block min-w-7 rounded px-1 py-0.5 tabular-nums", left === null ? "text-ink-300" : left === 0 ? "bg-rose-100 text-rose-800" : left <= 1 ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800")}>{left ?? "—"}</span></td>; })}</tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function RateImport() {
  const suppliers = useList("suppliers");
  const { act, busy } = useAction();
  const [kind, setKind] = useState<"hotels" | "sightseeing" | "transfers">("hotels");
  const [csv, setCsv] = useState("");
  const [url, setUrl] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const sample = kind === "hotels" ? "Hotel,City,Country,Stars,Room type,Meal plan,Season,Net per night,Currency\nSea Breeze Resort,Goa,India,4,Deluxe,CP,regular,4500,INR" : kind === "sightseeing" ? "Name,City,Country,Duration hours,Net per person,Currency\nDhow cruise dinner,Dubai,UAE,2,95,AED" : "Name,City,Vehicle,Capacity,Net per vehicle,Currency\nAirport to Calangute,Goa,Innova,6,1800,INR";
  return (
    <Card>
      <CardTitle title="Import a supplier rate sheet" subtitle="Paste CSV, upload a .csv file, or use a Google Sheets link. Existing rates are updated, new ones added." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What's in the sheet"><Select value={kind} onChange={(e) => setKind(e.target.value as "hotels")}><option value="hotels">Hotel rates</option><option value="sightseeing">Sightseeing</option><option value="transfers">Transfers</option></Select></Field>
        <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">— None —</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Upload CSV"><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"><Upload className="size-4" />Choose file<input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setCsv(await f.text()); }} /></label></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Google Sheets link" className="min-w-[260px] flex-1"><Input placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} /></Field><Button variant="secondary" busy={busy} disabled={!url} onClick={async () => { try { setCsv(await api.fetchSheet(url)); toast.success("Sheet loaded — check it and import"); } catch (x) { toast.error(x instanceof Error ? x.message : "Couldn't open the sheet"); } }}>Load sheet</Button></div>
      <Field label="Rates (CSV)" className="mt-3" hint={<span>Columns like: <code className="text-xs">{sample.split("\n")[0]}</code> <button type="button" className="text-brand-700 underline" onClick={() => setCsv(sample)}>Use example</button></span>}><Textarea rows={8} className="font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} /></Field>
      <div className="mt-3 flex items-center gap-3"><Button busy={busy} disabled={!csv.trim()} icon={<FileUp className="size-4" />} onClick={async () => { const r = await act<{ created: number; updated: number; skipped: number; errors: string[] }>("importRates", { kind, csv, supplierId: supplierId || null }, (x) => `${x.created} added, ${x.updated} updated`); if (r) setResult(r); }}>Import rates</Button>{result && <span className="text-sm text-ink-600">{result.created} added · {result.updated} updated · {result.skipped} skipped</span>}</div>
      {result && result.errors.length > 0 && <Callout tone="warn">{result.errors.map((e) => <div key={e}>{e}</div>)}</Callout>}
    </Card>
  );
}

/* ───────────────────────── Insurance: policies + claims ───────────────────────── */

export function InsurancePage() {
  const policies = useList("policies");
  const claims = useList("claims");
  const { act, busy } = useAction();
  const [decide, setDecide] = useState<{ claim: Entity<"claims">; status: string; note: string } | null>(null);
  const next: Record<string, string[]> = { submitted: ["in_review", "rejected"], in_review: ["approved", "rejected"], approved: ["paid"] };
  return (
    <div className="space-y-4">
      <PageHeader title="Insurance" subtitle="Policies sold with trips or on their own, and customers' claims from the portal." actions={<Link to="/app/engines?tab=insurance"><Button icon={<ShieldCheck className="size-4" />}>Sell a policy</Button></Link>} />
      <Card padded={false}><div className="p-4"><CardTitle title="Claims" /></div>
        <DataTable rows={claims.data ?? []} empty="No claims." columns={[
          { key: "n", header: "Claim", render: (c) => <span className="font-medium">{c.number}</span> }, { key: "p", header: "Policy", render: (c) => c.policyNumber }, { key: "w", header: "Customer", render: (c) => c.contactName },
          { key: "t", header: "Type", render: (c) => titleCase(c.type) }, { key: "a", header: "Amount", render: (c) => money(c.amount), align: "right" }, { key: "s", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
          { key: "x", header: "", render: (c) => (next[c.status] ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setDecide({ claim: c, status: next[c.status]![0]!, note: "" }); }}>Update</Button> : null), align: "right" },
        ]} />
      </Card>
      <Card padded={false}><div className="p-4"><CardTitle title="Policies" /></div>
        <DataTable rows={policies.data ?? []} search={(p) => `${p.number} ${p.contactName} ${p.destination}`} empty="No policies yet." columns={[
          { key: "n", header: "Policy", render: (p) => <span className="font-medium">{p.number}</span> }, { key: "pl", header: "Plan", render: (p) => p.planName }, { key: "c", header: "Customer", render: (p) => p.contactName },
          { key: "d", header: "Cover", render: (p) => `${formatDate(p.from)} – ${formatDate(p.to)}` }, { key: "t", header: "Travellers", render: (p) => p.travellers.length, align: "right" }, { key: "pr", header: "Premium", render: (p) => money(p.premium), align: "right" }, { key: "s", header: "", render: (p) => <StatusBadge status={p.status} /> },
        ]} />
      </Card>
      <Modal open={decide !== null} onClose={() => setDecide(null)} title={`Update ${decide?.claim.number ?? ""}`} footer={<Button busy={busy} onClick={async () => { if (!decide) return; const r = await act("decideClaim", { claimId: decide.claim.id, status: decide.status, note: decide.note || undefined }, "Claim updated — customer notified"); if (r) setDecide(null); }}>Save</Button>}>
        {decide && <div className="space-y-3"><p className="text-sm">{decide.claim.description}</p><Field label="New status"><Select value={decide.status} onChange={(e) => setDecide({ ...decide, status: e.target.value })}>{(next[decide.claim.status] ?? []).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field><Field label="Note to the customer" required={decide.status === "rejected"}><Textarea value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} /></Field></div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────── Messages: outbox, drafts, follow-ups ───────────────────────── */

interface FollowUpItem { kind: string; refId: string; name: string; phone: string; email: string; body: string; reason: string }

export function MessagesPage() {
  const outbox = useList("outbox");
  const { act, busy } = useAction();
  const [tab, setTab] = useState<"all" | "draft" | "failed" | "followups">("all");
  const preview = useQuery<{ items: FollowUpItem[] }>("followups", () => api.action("aiFollowUps", { mode: "preview" }), tab === "followups");
  const rows = (outbox.data ?? []).filter((o) => (tab === "draft" ? o.status === "draft" : tab === "failed" ? o.status === "failed" || (o.status === "queued" && o.error) : true)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const drafts = (outbox.data ?? []).filter((o) => o.status === "draft");
  return (
    <div className="space-y-4">
      <PageHeader title="Messages" subtitle="Every WhatsApp, email and SMS the system sends: notifications, reminders, campaigns, drips and AI follow-ups." actions={<DeliveryChip />} />
      <Tabs tabs={[{ key: "all", label: "All", count: (outbox.data ?? []).length }, { key: "draft", label: "Drafts to approve", count: drafts.length }, { key: "failed", label: "Needs attention", count: (outbox.data ?? []).filter((o) => o.status === "failed" || (o.status === "queued" && o.error)).length }, { key: "followups", label: "Follow-ups due" }]} value={tab} onChange={setTab} />
      {tab === "draft" && drafts.length > 0 && <div className="flex gap-2"><Button busy={busy} icon={<Send className="size-4" />} onClick={() => void act("approveDrafts", { ids: drafts.map((d) => d.id) }, "Drafts approved and queued")}>Approve and send all ({drafts.length})</Button><Button variant="secondary" busy={busy} onClick={() => void act("approveDrafts", { ids: drafts.map((d) => d.id), discard: true }, "Drafts discarded")}>Discard all</Button></div>}
      {tab === "followups" ? (
        !preview.data ? <Loading /> : preview.data.items.length === 0 ? <Empty>No follow-ups due. Everyone has been nudged in the last 3 days.</Empty> : <>
          <div className="flex flex-wrap gap-2"><Button busy={busy} icon={<Sparkles className="size-4" />} onClick={() => void act("aiFollowUps", { mode: "send" }, (r: { queued: number }) => `${r.queued} follow-ups sent`)}>Send all now</Button><Button variant="secondary" busy={busy} onClick={() => void act("aiFollowUps", { mode: "draft" }, (r: { queued: number }) => `${r.queued} drafts created for review`)}>Create drafts to review</Button></div>
          <DataTable rows={preview.data.items.map((f) => ({ ...f, id: f.refId }))} columns={[
            { key: "w", header: "Who", render: (f) => <span><span className="font-medium">{f.name}</span><span className="block text-xs text-ink-500">{f.phone || f.email}</span></span> },
            { key: "k", header: "Why", render: (f) => <span><Badge>{titleCase(f.kind)}</Badge> <span className="text-sm">{f.reason}</span></span> },
            { key: "b", header: "Message", render: (f) => <span className="text-sm text-ink-600">{f.body || "Payment reminder with a fresh pay link"}</span> },
          ]} />
        </>
      ) : (
        <DataTable rows={rows} search={(o) => `${o.to} ${o.body} ${o.kind}`} empty="No messages yet." columns={[
          { key: "w", header: "When", render: (o) => relTime(o.sentAt ?? o.createdAt), sort: (o) => o.createdAt },
          { key: "c", header: "Channel", render: (o) => <Badge tone={o.channel === "whatsapp" ? "green" : o.channel === "email" ? "blue" : "gray"}>{o.channel === "whatsapp" ? "WhatsApp" : titleCase(o.channel)}</Badge> },
          { key: "t", header: "To", render: (o) => o.to },
          { key: "k", header: "Type", render: (o) => titleCase(o.kind), hideOnMobile: true },
          { key: "b", header: "Message", render: (o) => <span className="block max-w-md truncate text-sm text-ink-600" title={o.body}>{o.body}</span> },
          { key: "s", header: "Status", render: (o) => <span><StatusBadge status={o.status} />{o.error && <span className="block text-xs text-amber-700">{o.error}</span>}</span> },
          { key: "x", header: "", render: (o) => (o.status === "failed" ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void act("retryMessage", { outboxId: o.id }, "Will retry"); }}>Retry</Button> : null), align: "right" },
        ]} />
      )}
    </div>
  );
}

/* ───────────────────────── Payment links, approvals, commissions ───────────────────────── */

export function ApprovalsPage() {
  const amendments = useList("amendments");
  const bookings = useList("bookings");
  const { user } = useSession();
  const { act, busy } = useAction();
  const can = user && ["owner", "admin", "accounts"].includes(user.role);
  return (
    <div className="space-y-4">
      <PageHeader title="Approvals" subtitle="Changes to confirmed bookings, with their cost and margin impact. Approving applies the change, bills the supplier and invoices the customer." />
      <DataTable rows={[...(amendments.data ?? [])].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt))} empty="No changes requested." columns={[
        { key: "n", header: "Change", render: (a) => <span><span className="font-medium">{a.number}</span><span className="block text-xs text-ink-500">{relTime(a.createdAt)}</span></span> },
        { key: "b", header: "Booking", render: (a) => { const b = bookings.data?.find((x) => x.id === a.bookingId); return b ? <Link to={`/app/bookings/${b.id}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{b.number} · {b.contactName}</Link> : "—"; } },
        { key: "r", header: "Reason", render: (a) => a.reason },
        { key: "c", header: "Cost", render: (a) => `${a.costImpact >= 0 ? "+" : "−"}${money(Math.abs(a.costImpact))}`, align: "right" },
        { key: "p", header: "Price", render: (a) => `${a.sellImpact >= 0 ? "+" : "−"}${money(Math.abs(a.sellImpact))}`, align: "right" },
        { key: "m", header: "Margin", render: (a) => <span className={a.sellImpact - a.costImpact >= 0 ? "text-emerald-700" : "text-rose-700"}>{a.sellImpact - a.costImpact >= 0 ? "+" : "−"}{money(Math.abs(a.sellImpact - a.costImpact))}</span>, align: "right" },
        { key: "s", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
        { key: "x", header: "", render: (a) => (a.status === "pending" && can ? <span className="flex gap-1"><Button size="sm" busy={busy} onClick={(e) => { e.stopPropagation(); void act("decideAmendment", { amendmentId: a.id, approve: true }, "Approved and applied"); }}>Approve</Button><Button size="sm" variant="secondary" busy={busy} onClick={(e) => { e.stopPropagation(); void act("decideAmendment", { amendmentId: a.id, approve: false, note: "Not approved" }, "Rejected"); }}>Reject</Button></span> : null), align: "right" },
      ]} />
    </div>
  );
}

export function CommissionsPanel({ agentId }: { agentId?: string }) {
  const r = useReport<{ rows: (Entity<"commissions"> & { agentName: string })[]; accrued: number; paid: number }>("commissions", {});
  const { user } = useSession();
  const { act, busy } = useAction();
  const rows = (r.data?.rows ?? []).filter((c) => !agentId || c.agentId === agentId);
  const open = rows.filter((c) => c.status === "accrued");
  return (
    <Card>
      <CardTitle title="Commissions" subtitle={`Accrued ${money(open.reduce((a, c) => a + c.amount, 0))} · paid ${money(rows.filter((c) => c.status === "paid").reduce((a, c) => a + c.amount, 0))}`} action={open.length && user && ["owner", "admin", "accounts"].includes(user.role) ? <Button size="sm" busy={busy} onClick={() => void act("payCommissions", { commissionIds: open.map((c) => c.id) }, "Commission paid to the agents' wallets")}>Pay {open.length} to wallets</Button> : undefined} />
      {rows.length === 0 ? <p className="text-sm text-ink-500">No commissions yet. Set a commission % on the agent to pay commission instead of (or as well as) slab pricing.</p> : (
        <ul className="divide-y divide-line text-sm">{rows.map((c) => <li key={c.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{c.bookingNumber} · {c.agentName} · {(c.rateBps / 100).toFixed(1)}% of {money(c.basis)}</span><span className="flex items-center gap-2">{money(c.amount)} <StatusBadge status={c.status} /></span></li>)}</ul>
      )}
    </Card>
  );
}

/* ───────────────────────── AI studio ───────────────────────── */

export function AiStudioPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "message" | "import" | "itinerary" | "insights") || "message";
  return (
    <div className="space-y-4">
      <PageHeader title="AI studio" subtitle="Let the system do the typing and the thinking: quotes from messages, emails and PDFs, supplier itineraries, follow-ups and forecasts." />
      <Tabs tabs={[{ key: "message", label: "Quote from a message" }, { key: "import", label: "Email / PDF enquiry" }, { key: "itinerary", label: "Supplier itinerary" }, { key: "insights", label: "Insights & forecast" }]} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "message" && <AiMessageTab />}
      {tab === "import" && <ImportEnquiry />}
      {tab === "itinerary" && <ImportItinerary />}
      {tab === "insights" && <Insights />}
    </div>
  );
}

async function pdfText(file: File): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Rebuild lines from the text items' vertical positions
    const lines = new Map<number, string[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      const y = Math.round(it.transform[5]!);
      lines.set(y, [...(lines.get(y) ?? []), it.str]);
    }
    out.push([...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.join(" ").trim()).filter(Boolean).join("\n"));
  }
  return out.join("\n");
}

function PdfButton({ onText }: { onText: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50", busy && "pointer-events-none opacity-60")}>
      <Upload className="size-4" />{busy ? "Reading PDF…" : "Read a PDF"}
      <input type="file" accept="application/pdf" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setBusy(true); try { onText(await pdfText(f)); toast.success("PDF read — check the text, then import"); } catch { toast.error("This PDF couldn't be read. If it's a scan, paste the text instead."); } finally { setBusy(false); } }} />
    </label>
  );
}

function ImportEnquiry() {
  const { act, busy } = useAction();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [from, setFrom] = useState({ name: "", email: "" });
  return (
    <Card>
      <CardTitle title="Turn an email or PDF into a lead and draft quote" subtitle="Forward enquiry emails to your inbox address (see Settings → Integrations) and they arrive here automatically. Or paste / upload below." />
      <div className="grid gap-3 sm:grid-cols-2"><Field label="From name"><Input value={from.name} onChange={(e) => setFrom({ ...from, name: e.target.value })} /></Field><Field label="From email"><Input type="email" value={from.email} onChange={(e) => setFrom({ ...from, email: e.target.value })} /></Field></div>
      <Field label="Email or document text" className="mt-3"><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Hi, we are 2 adults and 1 child planning 5 nights in Bali from 12 Feb. Budget around 1.8 lakh. Please share options.\nRegards, Ananya — +91 98111 00000"} /></Field>
      <div className="mt-3 flex flex-wrap gap-2"><PdfButton onText={setText} /><Button busy={busy} disabled={text.trim().length < 5} icon={<Sparkles className="size-4" />} onClick={async () => { const r = await act<{ lead: { id: string }; quote: { id: string } | null; engine: string }>("importEnquiry", { text, source: "email", fromName: from.name || undefined, fromEmail: from.email || undefined, createQuote: true }, (x) => `Lead created${x.quote ? " with a draft quote" : ""} (${x.engine === "claude" ? "AI" : "rule-based"} reader)`); if (r) nav(r.quote ? `/app/quotes/${r.quote.id}` : `/app/leads/${r.lead.id}`); }}>Create lead & quote</Button></div>
    </Card>
  );
}

function ImportItinerary() {
  const { act, busy } = useAction();
  const quotes = useList("quotes");
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [pkg, setPkg] = useState({ name: "", destination: "" });
  return (
    <Card>
      <CardTitle title="Supplier itinerary → day plan and priced services" subtitle="Paste or upload a DMC's itinerary. Days, inclusions, exclusions and priced lines (hotels, transfers, tours) are filled in for you to check." />
      <Field label="Itinerary text"><Textarea rows={10} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Day 1: Arrive Dubai\nMeet & greet, transfer to hotel.\nHotel Marina View 4N - AED 1,400\nDay 2: City tour\nHalf-day city tour AED 95 per person\nInclusions\n- Daily breakfast\nExclusions\n- Visa"} /></Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Add to quote"><Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}><option value="">— Save as a new package template —</option>{(quotes.data ?? []).filter((q) => q.status !== "accepted").map((q) => <option key={q.id} value={q.id}>{q.number} · {q.title}</option>)}</Select></Field>
        {!quoteId && <Field label="Package name"><Input value={pkg.name} onChange={(e) => setPkg({ ...pkg, name: e.target.value })} /></Field>}
        {!quoteId && <Field label="Destination"><Input value={pkg.destination} onChange={(e) => setPkg({ ...pkg, destination: e.target.value })} /></Field>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2"><PdfButton onText={setText} /><Button busy={busy} disabled={text.trim().length < 20} icon={<Sparkles className="size-4" />} onClick={async () => { const r = await act<{ quote?: { id: string }; package?: { id: string }; parsed: { days: unknown[]; services: unknown[]; engine: string } }>("importItinerary", { text, quoteId: quoteId || undefined, packageName: pkg.name || undefined, destination: pkg.destination || undefined }, (x) => `${x.parsed.days.length} days and ${x.parsed.services.length} services imported`); if (r?.quote) nav(`/app/quotes/${r.quote.id}`); else if (r?.package) nav("/app/masters"); }}>Import</Button></div>
    </Card>
  );
}

interface InsightsData {
  model: { trainedOn: number; ready: boolean; baseRate: number; factors: { feature: string; value: string; winRate: number; n: number; lift: number }[] };
  predicted: { id: string; name: string; destination: string; stage: string; chance: number; reasons: string[] }[];
  forecast: { history: { month: string; revenue: number }[]; next: { month: string; revenue: number; low: number; high: number }[]; method: string };
  pipeline: { stage: string; open: number; value: number; chance: number; expected: number }[];
  trends: { destination: string; last30: number; prev30: number; growth: number; hasPackage: boolean }[];
  suggestions: string[];
  bestHour: { label: string; sample: number };
  roi: { id: string; name: string; sent: number; delivered: number; leads: number; bookings: number; revenue: number; cost: number; roi: number | null }[];
}

function Insights() {
  const r = useReport<InsightsData>("insights", {});
  const { act, busy } = useAction();
  const d = r.data;
  const maxF = useMemo(() => Math.max(1, ...(d?.forecast.history.map((h) => h.revenue) ?? [1]), ...(d?.forecast.next.map((n) => n.high) ?? [1])), [d]);
  if (!d) return <Loading />;
  const expected = d.pipeline.reduce((a, p) => a + p.expected, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Next month (forecast)" value={money(d.forecast.next[0]?.revenue ?? 0)} icon={<TrendingUp className="size-4" />} hint={`range ${money(d.forecast.next[0]?.low ?? 0)}–${money(d.forecast.next[0]?.high ?? 0)}`} />
        <Stat label="Expected from open pipeline" value={money(expected)} hint="value × win chance by stage" />
        <Stat label="Overall win rate" value={`${d.model.baseRate}%`} hint={`learned from ${d.model.trainedOn} closed leads`} />
        <Stat label="Best time to message" value={d.bestHour.label} hint={d.bestHour.sample >= 5 ? `from ${d.bestHour.sample} customer replies` : "evening default until more customers reply"} />
      </div>
      <Card>
        <CardTitle title="Revenue: last 12 months and forecast" subtitle={d.forecast.method} />
        <div className="flex h-40 items-end gap-1" role="img" aria-label="Monthly revenue and forecast">
          {d.forecast.history.map((h) => <div key={h.month} className="flex h-full flex-1 flex-col items-center gap-1"><div className="flex w-full flex-1 items-end"><div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(h.revenue ? 2 : 0, (h.revenue / maxF) * 100)}%` }} title={`${h.month}: ${money(h.revenue)}`} /></div><span className="text-[10px] text-ink-400">{h.month.slice(5)}</span></div>)}
          {d.forecast.next.map((n) => <div key={n.month} className="flex h-full flex-1 flex-col items-center gap-1"><div className="flex w-full flex-1 items-end"><div className="w-full rounded-t border-2 border-dashed border-brand-400 bg-brand-50" style={{ height: `${Math.max(2, (n.revenue / maxF) * 100)}%` }} title={`${n.month} forecast: ${money(n.revenue)}`} /></div><span className="text-[10px] font-medium text-brand-700">{n.month.slice(5)}*</span></div>)}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle title="Leads most likely to book" subtitle={d.model.ready ? "Learned from your won and lost leads" : `Needs 12 closed leads to learn (has ${d.model.trainedOn}); using rules meanwhile`} action={d.model.ready ? <Button size="sm" variant="secondary" busy={busy} onClick={() => void act("rescoreLeads", {}, (x: { rescored: number }) => `${x.rescored} leads re-scored`)}>Re-score all leads</Button> : undefined} />
          <ul className="divide-y divide-line text-sm">{d.predicted.map((p) => <li key={p.id} className="py-2"><div className="flex justify-between"><Link to={`/app/leads/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link><Badge tone={p.chance >= 60 ? "green" : p.chance >= 35 ? "amber" : "gray"}>{p.chance}% chance</Badge></div><div className="text-xs text-ink-500">{p.destination || "—"} · {titleCase(p.stage)}{p.reasons[0] ? ` · ${p.reasons[0]}` : ""}</div></li>)}</ul>
        </Card>
        <Card>
          <CardTitle title="What to launch next" subtitle="From enquiry trends and seasons in your own data" />
          {d.suggestions.length === 0 ? <p className="text-sm text-ink-500">Not enough enquiries yet.</p> : <ul className="space-y-2 text-sm">{d.suggestions.map((s) => <li key={s} className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" />{s}</li>)}</ul>}
          <div className="mt-4"><RankBars items={d.trends.map((t) => ({ label: `${t.destination}${t.growth ? ` (${t.growth > 0 ? "+" : ""}${t.growth}%)` : ""}`, value: t.last30 }))} /></div>
        </Card>
      </div>
      <Card>
        <CardTitle title="Campaign return on spend" subtitle="Leads and bookings traced back to each campaign" />
        <DataTable rows={d.roi} empty="No campaigns yet." columns={[
          { key: "n", header: "Campaign", render: (c) => <span className="font-medium">{c.name}</span> },
          { key: "s", header: "Sent", render: (c) => c.sent, align: "right" }, { key: "d", header: "Delivered", render: (c) => c.delivered, align: "right" },
          { key: "l", header: "Leads", render: (c) => c.leads, align: "right" }, { key: "b", header: "Bookings", render: (c) => c.bookings, align: "right" },
          { key: "r", header: "Revenue", render: (c) => money(c.revenue), align: "right" }, { key: "c", header: "Cost", render: (c) => money(c.cost), align: "right" },
          { key: "o", header: "ROI", render: (c) => (c.roi === null ? "—" : <Badge tone={c.roi >= 0 ? "green" : "red"}>{c.roi}%</Badge>), align: "right" },
        ]} />
      </Card>
    </div>
  );
}

/* ───────────────────────── Settings → Integrations + automation ───────────────────────── */

const SERVICE_INFO: Record<string, { title: string; what: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[] }> = {
  whatsapp: { title: "WhatsApp Cloud API", what: "Two-way WhatsApp: bot replies, notifications, campaigns, delivery receipts", fields: [{ key: "phoneNumberId", label: "Phone number ID" }, { key: "accessToken", label: "Permanent access token", secret: true }, { key: "appSecret", label: "App secret", secret: true }, { key: "verifyToken", label: "Webhook verify token" }, { key: "templateName", label: "Approved template name (one {{1}} body variable)" }, { key: "templateLang", label: "Template language", placeholder: "en" }] },
  email: { title: "Email (SMTP)", what: "Quotes, receipts, reminders and campaigns by email", fields: [{ key: "host", label: "SMTP host", placeholder: "smtp.zoho.in" }, { key: "port", label: "Port", placeholder: "587" }, { key: "user", label: "Username" }, { key: "pass", label: "Password", secret: true }, { key: "from", label: "From address", placeholder: "Saffron Trails <hello@yourdomain.in>" }] },
  razorpay: { title: "Razorpay", what: "Payment links with UPI, cards, net banking and EMI; auto-reconciliation", fields: [{ key: "keyId", label: "Key ID" }, { key: "keySecret", label: "Key secret", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true }] },
  stripe: { title: "Stripe", what: "Card payments (international customers)", fields: [{ key: "secretKey", label: "Secret key", secret: true }, { key: "webhookSecret", label: "Webhook signing secret", secret: true }] },
  paypal: { title: "PayPal", what: "PayPal checkout", fields: [{ key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Secret", secret: true }, { key: "webhookId", label: "Webhook ID" }, { key: "mode", label: "Mode (sandbox or live)", placeholder: "live" }] },
  gateway: { title: "Default gateway", what: "Which gateway payment links use", fields: [{ key: "provider", label: "razorpay, stripe or paypal", placeholder: "razorpay" }] },
  meta: { title: "Meta lead ads", what: "Facebook/Instagram lead forms straight into Leads", fields: [{ key: "pageAccessToken", label: "Page access token", secret: true }, { key: "appSecret", label: "App secret", secret: true }, { key: "verifyToken", label: "Webhook verify token" }] },
  amadeus: { title: "Amadeus (flights)", what: "Live GDS fares, pricing and flight orders", fields: [{ key: "clientId", label: "API key" }, { key: "clientSecret", label: "API secret", secret: true }, { key: "mode", label: "test or production", placeholder: "test" }] },
  anthropic: { title: "Claude (AI)", what: "AI-written follow-ups, email/PDF reading and itinerary import", fields: [{ key: "apiKey", label: "API key", secret: true }, { key: "model", label: "Model", placeholder: "claude-sonnet-5-5" }] },
  exotel: { title: "Exotel (calls & voice bot)", what: "IVR call logs, recordings and AI voice calls", fields: [{ key: "sid", label: "Account SID" }, { key: "apiKey", label: "API key" }, { key: "apiToken", label: "API token", secret: true }, { key: "callerId", label: "Caller ID (ExoPhone)" }, { key: "flowUrl", label: "Voice-bot flow URL" }, { key: "subdomain", label: "API host", placeholder: "api.exotel.com" }] },
  calls: { title: "Call-log webhook key", what: "Lets your IVR or the SIM call-log app send calls here", fields: [{ key: "key", label: "Secret key (any long random text)", secret: true }] },
};

export function IntegrationsPanel() {
  const info = useQuery<IntegrationsInfo>("integrations", () => api.integrations());
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");
  const d = info.data;
  if (!d) return <Loading />;
  return (
    <div className="space-y-4">
      {d.demo ? <Callout tone="info" title="Demo: everything runs on the built-in sandbox">Messages, payments, flight fares and calls are simulated here. On your own server, add each account's keys below and the same screens work live. Keys are encrypted and never shown again.</Callout>
        : <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">Sandbox (test) mode</div><div className="text-sm text-ink-500">When on, nothing is really sent or charged. Turn off once your accounts are connected.</div></div><Toggle checked={d.sandbox} onChange={(on) => void run(async () => { if (on) await api.setIntegration("sandbox", { enabled: "true" }); else await api.removeIntegration("sandbox"); info.reload(); }, on ? "Sandbox mode on" : "Live mode — real messages and payments")} /></div></Card>}
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(SERVICE_INFO).map(([k, s]) => (
          <Card key={k}>
            <div className="flex items-start justify-between gap-2"><div><div className="font-medium">{s.title}</div><div className="text-sm text-ink-500">{s.what}</div></div>{d.services[k]?.connected ? <Badge tone="green">Connected</Badge> : <Badge>Not connected</Badge>}</div>
            {!d.demo && <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setVals({}); setEdit(k); }}>{d.services[k]?.connected ? "Replace keys" : "Connect"}</Button>{d.services[k]?.connected && <Button size="sm" variant="ghost" onClick={() => void run(async () => { await api.removeIntegration(k); info.reload(); }, `${s.title} disconnected`)}>Disconnect</Button>}</div>}
          </Card>
        ))}
      </div>
      {!d.demo && Object.keys(d.webhooks).length > 0 && (
        <Card>
          <CardTitle title="Webhook addresses" subtitle="Paste these into each provider's dashboard" />
          <ul className="space-y-1 text-sm">{Object.entries(d.webhooks).map(([k, v]) => <li key={k} className="flex flex-wrap items-center gap-2"><span className="w-28 text-ink-500">{titleCase(k)}</span><code className="min-w-0 flex-1 break-all rounded bg-slate-50 px-2 py-1 text-xs">{v}</code><Button size="sm" variant="ghost" onClick={() => void copyText(v)}>Copy</Button></li>)}</ul>
          <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Send a test message to (phone or email)"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field><Button variant="secondary" busy={busy} onClick={() => void run(() => api.testMessage(testTo), "Test message sent")}>Send test</Button></div>
        </Card>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit ? `Connect ${SERVICE_INFO[edit]!.title}` : ""} footer={<Button busy={busy} onClick={() => void run(async () => { await api.setIntegration(edit!, vals); info.reload(); setEdit(null); }, "Saved — keys are encrypted")}>Save</Button>}>
        {edit && <div className="space-y-3">{SERVICE_INFO[edit]!.fields.map((f) => <Field key={f.key} label={f.label}><Input type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} /></Field>)}</div>}
      </Modal>
    </div>
  );
}

export function AutomationSettings({ s }: { s: Settings }) {
  const { run, busy } = useAction();
  const [f, setF] = useState({ appUrl: s.appUrl, holdHours: s.holdHours, advancePercent: s.advancePercent, flightMarkupBps: s.flightMarkupBps, autoFollowUps: s.autoFollowUps, paymentReminders: s.paymentReminders, emiPlans: s.emiPlans });
  return (
    <Card>
      <CardTitle title="Payments & automation" subtitle="How customers pay and what the system does on its own" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Public app address" hint="Used in links inside WhatsApp and email, e.g. https://crm.youragency.in/" className="sm:col-span-2"><Input value={f.appUrl} onChange={(e) => setF({ ...f, appUrl: e.target.value })} placeholder="https://" /></Field>
        <Field label="Advance to confirm (%)"><Input type="number" min={0} max={100} value={f.advancePercent} onChange={(e) => setF({ ...f, advancePercent: Number(e.target.value) || 0 })} /></Field>
        <Field label="Hold a proposal for (hours)"><Input type="number" min={1} max={168} value={f.holdHours} onChange={(e) => setF({ ...f, holdHours: Number(e.target.value) || 48 })} /></Field>
        <Field label="Flight service fee (%)"><Input type="number" min={0} step="0.5" value={f.flightMarkupBps / 100} onChange={(e) => setF({ ...f, flightMarkupBps: Math.round(Number(e.target.value) * 100) })} /></Field>
        <Field label="EMI plans" hint="Months and yearly interest; 0% = no-cost EMI"><div className="flex flex-wrap gap-2">{f.emiPlans.map((p, i) => <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-sm"><Input aria-label="Months" type="number" className="w-14" value={p.months} onChange={(e) => setF({ ...f, emiPlans: f.emiPlans.map((x, k) => (k === i ? { ...x, months: Number(e.target.value) || 3 } : x)) })} />m @<Input aria-label="Rate" type="number" step="0.5" className="w-16" value={p.rateBps / 100} onChange={(e) => setF({ ...f, emiPlans: f.emiPlans.map((x, k) => (k === i ? { ...x, rateBps: Math.round(Number(e.target.value) * 100) } : x)) })} />%</span>)}</div></Field>
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Automatic follow-ups</div><div className="text-sm text-ink-500">Quiet leads, unopened proposals and missing visa documents get a nudge (AI-written when Claude is connected).</div></div><Toggle checked={f.autoFollowUps} onChange={(v) => setF({ ...f, autoFollowUps: v })} /></div>
        <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Payment reminders</div><div className="text-sm text-ink-500">3 days before the due date and when overdue, with a fresh payment link.</div></div><Toggle checked={f.paymentReminders} onChange={(v) => setF({ ...f, paymentReminders: v })} /></div>
      </div>
      <Button className="mt-4" busy={busy} onClick={() => void run(() => api.update("settings", s.id, f), "Saved")}>Save</Button>
    </Card>
  );
}

export { Download, MoneyInput };
