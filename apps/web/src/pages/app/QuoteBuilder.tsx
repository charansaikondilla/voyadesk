import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, Eye, Plus, Printer, Save, Send, Trash2, XCircle } from "lucide-react";
import { RecordTrail } from "../../components/RecordTrail";
import {
  checkQuote, emptyLine, isoDate, newId, priceOfQuote, SERVICE_TYPES, type Booking, type MarkupRule, type PriceLine, type PricingResult, type Quote,
} from "@voyadesk/core";
import { api } from "../../lib/api";
import { useAction, useList, useOne } from "../../lib/hooks";
import { copyText } from "../../lib/toast";
import { money, pct, SERVICE_ICON_LABEL, titleCase } from "../../lib/format";
import {
  Button, Callout, Card, CardTitle, ErrorNote, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, StatusBadge, Tabs, Textarea, Toggle, cx,
} from "../../components/ui";
import { DaysEditor } from "../../components/forms";
import { DayPhoto, QuoteOptionsEditor, downloadQuoteWord } from "../../components/plus";
import { useSession } from "../../lib/session";

type Draft = Pick<Quote, "title" | "destination" | "scope" | "startDate" | "nights" | "pax" | "currency" | "fx" | "markupMode" | "packageMarkup" | "taxBasis" | "gstRateBps" | "hasPan" | "priorFyAmount" | "discount" | "lines" | "days" | "inclusions" | "exclusions" | "terms" | "contactName" | "phone" | "email">;

const draftOf = (q: Quote): Draft => ({
  title: q.title, destination: q.destination, scope: q.scope, startDate: q.startDate, nights: q.nights, pax: q.pax, currency: q.currency, fx: q.fx,
  markupMode: q.markupMode, packageMarkup: q.packageMarkup, taxBasis: q.taxBasis, gstRateBps: q.gstRateBps, hasPan: q.hasPan, priorFyAmount: q.priorFyAmount,
  discount: q.discount, lines: q.lines, days: q.days, inclusions: q.inclusions, exclusions: q.exclusions, terms: q.terms, contactName: q.contactName, phone: q.phone, email: q.email,
});

export function shareUrl(token: string) {
  return `${window.location.origin}${window.location.pathname}#/p/${api.tenantId || "demo"}/${token}`;
}

function AddServiceMenu({ onAdd, destination }: { onAdd: (l: PriceLine) => void; destination: string }) {
  const hotels = useList("hotels");
  const sights = useList("sightseeing");
  const transfers = useList("transfers");
  const [open, setOpen] = useState(false);
  const match = (city: string, country: string) => !destination || city.toLowerCase() === destination.toLowerCase() || country.toLowerCase() === destination.toLowerCase();
  const items: { label: string; sub: string; make: () => PriceLine }[] = [
    ...(hotels.data ?? []).filter((h) => match(h.city, h.country)).flatMap((h) => h.rates.map((r) => ({
      label: `${h.name} — ${r.roomType} (${r.mealPlan})`, sub: `Hotel · ${h.city} · ${money(r.netPerNight, r.currency)}/night · ${r.season}`,
      make: () => emptyLine({ id: newId("ln"), type: "hotel", title: `${h.name} — ${r.roomType} (${r.mealPlan})`, netCost: r.netPerNight, currency: r.currency, quantity: 1, supplierId: h.supplierId }),
    }))),
    ...(transfers.data ?? []).filter((t) => match(t.city, t.country)).map((t) => ({
      label: t.name, sub: `Transfer · ${t.vehicle} · ${money(t.netPerVehicle, t.currency)}`,
      make: () => emptyLine({ id: newId("ln"), type: "transfer", title: t.name, netCost: t.netPerVehicle, currency: t.currency, supplierId: t.supplierId }),
    })),
    ...(sights.data ?? []).filter((s) => match(s.city, s.country)).map((s) => ({
      label: s.name, sub: `Sightseeing · ${money(s.netPerPerson, s.currency)} per person`,
      make: () => emptyLine({ id: newId("ln"), type: "sightseeing", title: s.name, netCost: s.netPerPerson, currency: s.currency, perPerson: true, supplierId: s.supplierId }),
    })),
  ];
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen((o) => !o)}>Add service</Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-2 max-h-80 w-80 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
            <button className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-slate-50" onClick={() => { onAdd(emptyLine({ id: newId("ln"), type: "other", title: "Custom service" })); setOpen(false); }}>+ Custom line</button>
            {items.length === 0 && <div className="px-3 py-2 text-xs text-ink-500">No masters for {destination || "this destination"} yet. Add them in Masters.</div>}
            {items.map((i, k) => (
              <button key={k} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50" onClick={() => { onAdd(i.make()); setOpen(false); }}>
                <span className="block text-sm">{i.label}</span><span className="block text-xs text-ink-500">{i.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LineRow({ line, priced, perComponent, onChange, onRemove, readOnly }: { line: PriceLine; priced?: PricingResult["lines"][number] | undefined; perComponent: boolean; onChange: (l: PriceLine) => void; onRemove: () => void; readOnly: boolean }) {
  return (
    <div className={cx("rounded-xl border p-3", line.optional ? "border-dashed border-violet-300 bg-violet-50/30" : "border-line")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[70px_110px_1fr]">
        <Field label="Day"><Input disabled={readOnly} type="number" min={1} value={line.day} onChange={(e) => onChange({ ...line, day: Math.max(1, Number(e.target.value) || 1) })} /></Field>
        <Field label="Type"><Select disabled={readOnly} value={line.type} onChange={(e) => onChange({ ...line, type: e.target.value as PriceLine["type"] })}>{SERVICE_TYPES.map((t) => <option key={t} value={t}>{SERVICE_ICON_LABEL[t]}</option>)}</Select></Field>
        <Field label="Service" className="col-span-2 sm:col-span-1"><Input disabled={readOnly} value={line.title} onChange={(e) => onChange({ ...line, title: e.target.value })} /></Field>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label={`Net cost (${line.currency})`}><MoneyInput disabled={readOnly} currency={line.currency} value={line.netCost} onChange={(v) => onChange({ ...line, netCost: v ?? 0 })} /></Field>
        <Field label="Qty / nights"><Input disabled={readOnly} type="number" min={1} value={line.quantity} onChange={(e) => onChange({ ...line, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></Field>
        {perComponent ? (
          <Field label="Markup %"><Input disabled={readOnly} type="number" step="0.5" placeholder="default" value={line.markup?.kind === "percent" ? line.markup.value / 100 : ""} onChange={(e) => onChange({ ...line, markup: e.target.value === "" ? null : { kind: "percent", value: Math.round(Number(e.target.value) * 100), per: "unit" } })} /></Field>
        ) : <div />}
        <div className="flex flex-col justify-end gap-1.5 pb-1">
          <Toggle disabled={readOnly} checked={line.perPerson} onChange={(v) => onChange({ ...line, perPerson: v })} label="Per person" />
          <Toggle disabled={readOnly} checked={line.optional} onChange={(v) => onChange({ ...line, optional: v, selected: v ? line.selected : false })} label="Optional add-on" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
        <span>{priced ? <>Cost {money(priced.base)} · Sell {money(priced.sell)} · GST {money(priced.gst)}{!priced.included && " · not in total"}</> : null}</span>
        {!readOnly && <button onClick={onRemove} className="inline-flex items-center gap-1 text-rose-600 hover:underline"><Trash2 className="size-3.5" />Remove</button>}
      </div>
    </div>
  );
}

export function QuoteBuilderPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const q = useOne("quotes", id);
  const { act, busy } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { settings } = useSession();
  const [transportOpen, setTransportOpen] = useState(false);
  const [trip, setTrip] = useState({ days: "3", km: "120, 200, 120" });
  const [confirmOption, setConfirmOption] = useState("");
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"services" | "days" | "terms" | "customer">("services");
  const [coupon, setCoupon] = useState("");
  const [share, setShare] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [advance, setAdvance] = useState<number | null>(null);
  const [method, setMethod] = useState("upi");

  useEffect(() => {
    if (q.data && !dirty) setDraft(draftOf(q.data));
  }, [q.data, dirty]);

  const today = isoDate(new Date());
  const preview = useMemo<{ pricing: PricingResult | null; error: string | null }>(() => {
    if (!q.data || !draft) return { pricing: null, error: null };
    try {
      return { pricing: priceOfQuote({ ...q.data, ...draft } as Quote, today), error: null };
    } catch (e) {
      return { pricing: null, error: (e as Error).message };
    }
  }, [q.data, draft, today]);
  const check = useMemo(() => (q.data && draft && preview.pricing ? checkQuote({ ...q.data, ...draft } as Quote, today, preview.pricing) : { errors: preview.error ? [preview.error] : [], warnings: [] }), [q.data, draft, preview, today]);

  if (q.error) return <ErrorNote message={q.error.message} />;
  if (!q.data || !draft) return <Loading />;
  const quote = q.data;
  const locked = quote.status === "accepted";
  const pricing = preview.pricing;
  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setDirty(true); };
  const priced = new Map(pricing?.lines.map((p) => [p.id, p]) ?? []);
  const sortedLines = [...draft.lines].sort((a, b) => a.day - b.day);

  const save = async () => {
    const clean = { ...draft, inclusions: draft.inclusions.map((x) => x.trim()).filter(Boolean), exclusions: draft.exclusions.map((x) => x.trim()).filter(Boolean) };
    const r = await act<Quote>("saveQuote", { quoteId: quote.id, patch: clean }, quote.status === "draft" ? "Quote saved" : `Saved as version ${quote.version + 1} — send it again to share the changes`);
    if (r) setDirty(false);
    return r;
  };
  const send = async (channel: "whatsapp" | "email" | "link") => {
    if (dirty && !(await save())) return;
    const r = await act<{ quote: Quote; warnings: string[] }>("sendQuote", { quoteId: quote.id, channel }, "Proposal is live");
    if (r) setShare(shareUrl(r.quote.shareToken));
  };
  const confirm = async () => {
    if (dirty && !(await save())) return;
    const r = await act<{ booking: Booking }>("acceptQuote", { quoteId: quote.id, option: quote.options.length ? confirmOption || quote.chosenOption || quote.options[0]!.key : undefined, payment: advance ? { amount: advance, method, gateway: "manual" } : null }, (x) => `Booking ${x.booking.number} created with invoice`);
    if (r) nav(`/app/bookings/${r.booking.id}`);
  };
  const markup = draft.packageMarkup;
  const setMarkup = (m: Partial<MarkupRule>) => set({ packageMarkup: { ...markup, ...m } });

  return (
    <div>
      <PageHeader back={{ to: quote.leadId ? `/app/leads/${quote.leadId}` : "/app/quotes", label: quote.leadId ? "Lead" : "Quotes" }}
        title={<span className="flex items-center gap-2">{quote.number}<StatusBadge status={quote.status} /></span>}
        subtitle={`${draft.contactName} · v${quote.version} · ${quote.views} customer view${quote.views === 1 ? "" : "s"}${dirty ? " · unsaved changes" : ""}`}
        actions={locked ? (<>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => nav(`/print/quote/${quote.id}`)}>Print</Button>
          <Button variant="secondary" onClick={() => downloadQuoteWord(quote, settings?.companyName ?? "", { total: quote.total, perPerson: pricing?.perPerson ?? 0 })}>Word</Button>
        </>) : <>
          <span className="flex flex-wrap gap-2" title={dirty ? "Save your changes first" : undefined}>
            {!dirty && <QuoteOptionsEditor quote={quote} />}
            <Button variant="secondary" size="sm" disabled={dirty} onClick={() => nav("/app/engines?tab=flights")}>+ Live flight</Button>
            <Button variant="secondary" size="sm" disabled={dirty} onClick={() => setTransportOpen(true)}>+ Transport</Button>
            <Button variant="secondary" size="sm" disabled={dirty} onClick={() => nav("/app/ai?tab=itinerary")}>Import itinerary</Button>
            <Button variant="secondary" size="sm" onClick={() => downloadQuoteWord({ ...quote, ...draft } as Quote, settings?.companyName ?? "", { total: pricing?.total ?? quote.total, perPerson: pricing?.perPerson ?? 0 })}>Word</Button>
          </span>
          <Button variant="secondary" icon={<Save className="size-4" />} busy={busy} disabled={!dirty} onClick={save}>Save</Button>
          <Button variant="secondary" icon={<Eye className="size-4" />} onClick={() => nav(`/print/quote/${quote.id}`)}>Preview / PDF</Button>
          <Button icon={<Send className="size-4" />} busy={busy} disabled={check.errors.length > 0} onClick={() => send("whatsapp")}>{quote.status === "draft" ? "Send" : "Resend"}</Button>
          <Button variant="success" icon={<CheckCircle2 className="size-4" />} disabled={check.errors.length > 0} onClick={() => { setAdvance(pricing ? Math.round(pricing.total / 2) : null); setConfirmOpen(true); }}>Confirm booking</Button>
        </>} />
      <RecordTrail anchor={{ kind: "quote", id: quote.id }} current="quote" />

      {locked && <div className="mb-4"><Callout tone="good">Confirmed. This quote is locked — <Link to={`/app/bookings/${quote.bookingId}`} className="font-medium underline">open the booking</Link> for changes.</Callout></div>}
      {quote.status !== "draft" && !locked && quote.shareToken && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm">
          <span className="text-ink-500">Customer link:</span>
          <Link className="truncate text-brand-700 hover:underline" to={`/p/${api.tenantId || "demo"}/${quote.shareToken}`}>{shareUrl(quote.shareToken)}</Link>
          <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => void copyText(shareUrl(quote.shareToken))}>Copy</Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" className="sm:col-span-2"><Input disabled={locked} value={draft.title} onChange={(e) => set({ title: e.target.value })} /></Field>
              <Field label="Destination"><Input disabled={locked} value={draft.destination} onChange={(e) => set({ destination: e.target.value })} /></Field>
              <Field label="Trip type"><Select disabled={locked} value={draft.scope} onChange={(e) => set({ scope: e.target.value as Draft["scope"] })}><option value="domestic">Domestic</option><option value="overseas">Overseas (TCS)</option></Select></Field>
              <Field label="Start date"><Input disabled={locked} type="date" value={draft.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} /></Field>
              <Field label="Nights"><Input disabled={locked} type="number" min={0} value={draft.nights} onChange={(e) => set({ nights: Math.max(0, Number(e.target.value) || 0) })} /></Field>
              <Field label="Adults"><Input disabled={locked} type="number" min={1} value={draft.pax.adults} onChange={(e) => set({ pax: { ...draft.pax, adults: Math.max(1, Number(e.target.value) || 1) } })} /></Field>
              <Field label="Children / infants">
                <div className="flex gap-2">
                  <Input disabled={locked} aria-label="Children" type="number" min={0} value={draft.pax.children} onChange={(e) => set({ pax: { ...draft.pax, children: Math.max(0, Number(e.target.value) || 0) } })} />
                  <Input disabled={locked} aria-label="Infants" type="number" min={0} value={draft.pax.infants} onChange={(e) => set({ pax: { ...draft.pax, infants: Math.max(0, Number(e.target.value) || 0) } })} />
                </div>
              </Field>
            </div>
          </Card>

          <div className="mt-5">
            <Tabs tabs={[{ key: "services", label: "Services", count: draft.lines.length }, { key: "days", label: "Day plan", count: draft.days.length }, { key: "terms", label: "Inclusions & terms" }, { key: "customer", label: "Customer" }]} value={tab} onChange={setTab} />
            {tab === "services" && (
              <div className="space-y-3">
                {!locked && <AddServiceMenu destination={draft.destination} onAdd={(l) => set({ lines: [...draft.lines, l] })} />}
                {sortedLines.length === 0 && <Callout tone="warn">No services yet. Add hotels, transfers and sightseeing.</Callout>}
                {sortedLines.map((l) => (
                  <LineRow key={l.id} line={l} priced={priced.get(l.id)} perComponent={draft.markupMode === "per_component"} readOnly={locked}
                    onChange={(nl) => set({ lines: draft.lines.map((x) => (x.id === l.id ? nl : x)) })} onRemove={() => set({ lines: draft.lines.filter((x) => x.id !== l.id) })} />
                ))}
              </div>
            )}
            {tab === "days" && (locked ? <ol className="space-y-2">{draft.days.map((d, i) => <li key={i} className="rounded-xl border border-line bg-white p-3 text-sm"><b>Day {i + 1}: {d.title}</b><p className="text-ink-600">{d.description}</p></li>)}</ol> : <DaysEditor value={draft.days} onChange={(days) => set({ days })} renderExtra={(i) => <DayPhoto quote={{ ...quote, days: draft.days } as Quote} index={i} onChange={(photoId) => set({ days: draft.days.map((d, k) => (k === i ? { ...d, photoId } : d)) })} />} />)}
            {tab === "terms" && (
              <Card>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Inclusions" hint="One per line"><Textarea disabled={locked} rows={6} value={draft.inclusions.join("\n")} onChange={(e) => set({ inclusions: e.target.value.split("\n") })} /></Field>
                  <Field label="Exclusions" hint="One per line"><Textarea disabled={locked} rows={6} value={draft.exclusions.join("\n")} onChange={(e) => set({ exclusions: e.target.value.split("\n") })} /></Field>
                  <Field label="Terms & payment policy" className="sm:col-span-2"><Textarea disabled={locked} rows={4} value={draft.terms} onChange={(e) => set({ terms: e.target.value })} /></Field>
                </div>
              </Card>
            )}
            {tab === "customer" && (
              <Card>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Customer name"><Input disabled={locked} value={draft.contactName} onChange={(e) => set({ contactName: e.target.value })} /></Field>
                  <Field label="Phone"><Input disabled={locked} type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
                  <Field label="Email"><Input disabled={locked} type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} /></Field>
                </div>
                {draft.scope === "overseas" && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Toggle disabled={locked} checked={draft.hasPan} onChange={(v) => set({ hasPan: v })} label="Customer's PAN is on file (normal TCS rate)" />
                    <Field label="Overseas packages already billed to this PAN this FY" hint="Used for older slab rules"><MoneyInput disabled={locked} value={draft.priorFyAmount} onChange={(v) => set({ priorFyAmount: v ?? 0 })} /></Field>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardTitle title="Price" subtitle="Updates as you type" />
            {preview.error ? <Callout tone="bad">{preview.error}</Callout> : pricing && (
              <dl className="space-y-1.5 text-sm">
                {[["Net cost", pricing.base], ["Markup", pricing.markup], ...(pricing.discount ? [["Discount", -pricing.discount]] : []), ["Selling price", pricing.sell], [`GST (${pct(draft.gstRateBps)}${draft.taxBasis === "markup_only" ? " on markup" : ""})`, pricing.gst], ...(pricing.tcs ? [["TCS", pricing.tcs]] : [])].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className="tabular-nums">{money(Number(v), draft.currency)}</dd></div>
                ))}
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(pricing.total, draft.currency)}</dd></div>
                <div className="flex justify-between text-xs text-ink-500"><dt>Per paying traveller ({pricing.payingPax})</dt><dd>{money(pricing.perPerson, draft.currency)}</dd></div>
                <div className={cx("mt-2 rounded-lg px-3 py-2 text-xs", pricing.marginBps < 300 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")}>Margin {money(pricing.margin)} · {pct(pricing.marginBps)} of selling price</div>
              </dl>
            )}
          </Card>

          {!locked && (
            <Card>
              <CardTitle title="Markup & tax" />
              <div className="space-y-3">
                <Field label="How to apply markup"><Select value={draft.markupMode} onChange={(e) => set({ markupMode: e.target.value as Draft["markupMode"] })}><option value="overall">On the whole package</option><option value="per_component">Per service (set % on each line)</option></Select></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Default markup"><Select value={markup.kind} onChange={(e) => setMarkup({ kind: e.target.value as MarkupRule["kind"], value: 0 })}><option value="percent">Percent</option><option value="flat">Flat ₹</option></Select></Field>
                  {markup.kind === "percent"
                    ? <Field label="%"><Input type="number" step="0.5" min={0} value={markup.value / 100} onChange={(e) => setMarkup({ value: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></Field>
                    : <Field label="Amount"><MoneyInput value={markup.value} onChange={(v) => setMarkup({ value: v ?? 0 })} /></Field>}
                </div>
                {markup.kind === "flat" && <Field label="Flat markup is"><Select value={markup.per} onChange={(e) => setMarkup({ per: e.target.value as MarkupRule["per"] })}><option value="unit">Once per package</option><option value="person">Per traveller</option></Select></Field>}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="GST basis"><Select value={draft.taxBasis} onChange={(e) => set({ taxBasis: e.target.value as Draft["taxBasis"], gstRateBps: e.target.value === "markup_only" ? 1800 : 500 })}><option value="cost_plus_markup">Full price</option><option value="markup_only">Fee only</option></Select></Field>
                  <Field label="GST %"><Input type="number" step="0.5" min={0} value={draft.gstRateBps / 100} onChange={(e) => set({ gstRateBps: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></Field>
                </div>
                <div>
                  <span className="mb-1 block text-sm font-medium text-ink-700">Coupon {quote.couponCode && <StatusBadge status="active" label={quote.couponCode} />}</span>
                  <div className="flex gap-2"><Input aria-label="Coupon code" placeholder="e.g. FESTIVE10" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /><Button variant="secondary" disabled={dirty} title={dirty ? "Save first" : undefined} onClick={async () => { const r = await act("applyCoupon", { quoteId: quote.id, code: coupon }, coupon ? "Coupon applied" : "Coupon removed"); if (r) setCoupon(""); }}>{coupon ? "Apply" : "Clear"}</Button></div>
                </div>
              </div>
            </Card>
          )}

          {!locked && <Card>
            <CardTitle title="Before you send" />
            {check.errors.length === 0 && check.warnings.length === 0 && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Everything looks good.</p>}
            <ul className="space-y-1.5 text-sm">
              {check.errors.map((e) => <li key={e} className="flex gap-2 text-rose-700"><XCircle className="mt-0.5 size-4 shrink-0" />{e}</li>)}
              {check.warnings.map((w) => <li key={w} className="flex gap-2 text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</li>)}
            </ul>
          </Card>}
        </aside>
      </div>

      <Modal open={share !== null} onClose={() => setShare(null)} title="Proposal is ready to share" footer={<Button onClick={() => setShare(null)}>Done</Button>}>
        {share && (
          <div className="space-y-3 text-sm">
            <p>Your customer can view the itinerary, choose add-ons and pay from this link:</p>
            <div className="flex gap-2"><Input readOnly value={share} aria-label="Proposal link" /><Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => void copyText(share)}>Copy</Button></div>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 font-medium text-white" target="_blank" rel="noreferrer" href={`https://wa.me/${draft.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${encodeURIComponent(`Hi ${draft.contactName}, here is your ${draft.title} proposal: ${share}`)}`}>Share on WhatsApp</a>
              <a className="inline-flex h-10 items-center rounded-lg border border-line px-4 font-medium" href={`mailto:${draft.email}?subject=${encodeURIComponent(draft.title)}&body=${encodeURIComponent(`Hi ${draft.contactName},\n\nHere is your proposal: ${share}`)}`}>Email</a>
              <Link className="inline-flex h-10 items-center rounded-lg border border-line px-4 font-medium" to={`/p/${api.tenantId || "demo"}/${share.split("/").pop() ?? ""}`}>Open as customer</Link>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={transportOpen} onClose={() => setTransportOpen(false)} title="Plan transport" footer={<Button busy={busy} onClick={async () => {
        const km = trip.km.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
        const r = await act<{ plan: { breakdown: string[]; cost: number } }>("addTransportToQuote", { quoteId: quote.id, days: Math.max(1, Number(trip.days) || 1), kmPerDay: km.length ? km : [0], city: draft.destination || undefined }, (x) => `Added: ${x.plan.breakdown.join(" + ")}`);
        if (r) setTransportOpen(false);
      }}>Add to quote</Button>}>
        <div className="space-y-3 text-sm">
          <p>Picks the cheapest mix of vehicles that seats all {draft.pax.adults + draft.pax.children} travellers, using your vehicle rates (day rate, included km, extra km and driver allowance).</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Days with a vehicle"><Input type="number" min={1} value={trip.days} onChange={(e) => setTrip({ ...trip, days: e.target.value })} /></Field><Field label="Km each day" hint="Comma separated"><Input value={trip.km} onChange={(e) => setTrip({ ...trip, km: e.target.value })} /></Field></div>
        </div>
      </Modal>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm booking" footer={<><Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button variant="success" busy={busy} onClick={confirm}>Create booking & invoice</Button></>}>
        <div className="space-y-4 text-sm">
          <p>This creates the booking file, operations tasks, supplier bills and a GST{draft.scope === "overseas" ? "/TCS" : ""} invoice for <b>{money(pricing?.total ?? 0)}</b>, and marks the lead as won.</p>
          {quote.options.length > 0 && <Field label="Which option did the customer choose?"><Select value={confirmOption || quote.chosenOption || quote.options[0]!.key} onChange={(e) => setConfirmOption(e.target.value)}>{quote.options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</Select></Field>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Advance received now (optional)"><MoneyInput value={advance} onChange={setAdvance} /></Field>
            <Field label="Paid by"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{["upi", "card", "netbanking", "bank_transfer", "cash", "cheque"].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
