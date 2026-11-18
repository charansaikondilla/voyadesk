import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { formatDate, isoDate, priceOfQuote, type Booking, type Invoice, type Quote, type Service, type Settings } from "@voyadesk/core";
import { api, ApiError } from "../../lib/api";
import { money, SERVICE_ICON_LABEL } from "../../lib/format";
import { Button, ErrorNote, Loading } from "../../components/ui";

function usePrintData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load().then(setData, (e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function Sheet({ settings, title, children, brand }: { settings: Settings; title: string; children: ReactNode; brand?: { name: string; phone: string; email: string } | null }) {
  const nav = useNavigate();
  return (
    <div className="min-h-full bg-canvas py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between gap-2 px-4">
        <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={() => nav(-1)}>Back</Button>
        <span className="flex items-center gap-2"><span className="hidden text-xs text-ink-500 sm:inline">Choose "Save as PDF" in the print dialog</span><Button icon={<Printer className="size-4" />} onClick={() => { try { window.print(); } catch { /* blocked in some embedded viewers */ } }}>Print / save as PDF</Button></span>
      </div>
      <div className="print-page mx-auto max-w-3xl rounded-xl border border-line bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-2 pb-4" style={{ borderColor: settings.brandColor }}>
          <div>
            <div className="text-xl font-semibold" style={{ color: settings.brandColor }}>{brand?.name || settings.companyName}</div>
            {brand?.name && <div className="mt-1 text-xs text-ink-600">{[brand.phone, brand.email].filter(Boolean).join(" · ")}</div>}
            <div className={brand?.name ? "hidden" : "mt-1 whitespace-pre-line text-xs text-ink-600"}>{settings.legalName}{settings.address ? `\n${settings.address}` : ""}{settings.gstin ? `\nGSTIN ${settings.gstin}` : ""}{settings.phone ? ` · ${settings.phone}` : ""}</div>
          </div>
          <div className="text-right text-lg font-semibold uppercase tracking-wide text-ink-700">{title}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PrintInvoicePage() {
  const { id = "" } = useParams();
  const { data, error } = usePrintData(async () => ({ inv: await api.get("invoices", id), me: await api.me() }), [id]);
  if (error) return <div className="p-6"><ErrorNote message={error} /></div>;
  if (!data) return <Loading />;
  const { inv, me } = data as { inv: Invoice; me: { settings: Settings } };
  return (
    <Sheet settings={me.settings} title="Tax invoice">
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><div className="text-xs uppercase text-ink-500">Billed to</div><div className="font-medium">{inv.partyName}</div>{inv.gstin && <div>GSTIN {inv.gstin}</div>}<div>Place of supply: {inv.placeOfSupply}</div></div>
        <div className="text-right"><div>Invoice <b>{inv.number}</b></div><div>Date {formatDate(inv.issueDate)}</div><div>Due {formatDate(inv.dueDate)}</div></div>
      </div>
      <table className="mt-6 w-full text-sm"><thead><tr className="border-b border-line text-left text-xs uppercase text-ink-500"><th className="py-2">Description</th><th>SAC</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{inv.lines.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-2">{l.description}</td><td>{l.sac}</td><td className="text-right">{money(l.amount, inv.currency)}</td></tr>)}</tbody></table>
      <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Taxable value</dt><dd>{money(inv.sell)}</dd></div>
        {inv.igst ? <div className="flex justify-between"><dt>IGST</dt><dd>{money(inv.igst)}</dd></div> : <><div className="flex justify-between"><dt>CGST</dt><dd>{money(inv.cgst)}</dd></div><div className="flex justify-between"><dt>SGST</dt><dd>{money(inv.sgst)}</dd></div></>}
        {inv.tcs > 0 && <div className="flex justify-between"><dt>TCS (sec. 206C(1G) / 394)</dt><dd>{money(inv.tcs)}</dd></div>}
        <div className="flex justify-between border-t border-ink-800 pt-1 text-base font-semibold"><dt>Total</dt><dd>{money(inv.total)}</dd></div>
        <div className="flex justify-between text-ink-600"><dt>Paid</dt><dd>{money(inv.paid)}</dd></div>
        {inv.credited > 0 && <div className="flex justify-between text-ink-600"><dt>Credit notes</dt><dd>{money(inv.credited)}</dd></div>}
        <div className="flex justify-between font-medium"><dt>Balance due</dt><dd>{money(inv.total - inv.paid - inv.credited)}</dd></div>
      </dl>
      <p className="mt-8 text-xs text-ink-500">This is a computer-generated invoice. Tour operator services billed at a gross package value attract GST at the applicable rate without input tax credit.</p>
    </Sheet>
  );
}

export function PrintVoucherPage() {
  const { id = "" } = useParams();
  const { data, error } = usePrintData(async () => {
    const sv = await api.get("services", id);
    const [bk, me, suppliers] = await Promise.all([api.get("bookings", sv.bookingId), api.me(), api.list("suppliers").catch(() => [])]);
    const agent = bk.agentId ? await api.get("agents", bk.agentId).catch(() => null) : null;
    return { sv, bk, me, supplier: suppliers.find((s) => s.id === sv.supplierId), brand: agent?.brandName ? { name: agent.brandName, phone: agent.brandPhone || agent.phone, email: agent.brandEmail || agent.email } : null };
  }, [id]);
  if (error) return <div className="p-6"><ErrorNote message={error} /></div>;
  if (!data) return <Loading />;
  const { sv, bk, me, supplier, brand } = data as { sv: Service; bk: Booking; me: { settings: Settings }; supplier?: { name: string; phone: string }; brand: { name: string; phone: string; email: string } | null };
  return (
    <Sheet settings={me.settings} title="Service voucher" brand={brand}>
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><div className="text-xs uppercase text-ink-500">Guest</div><div className="text-lg font-medium">{bk.contactName}</div><div>{bk.pax.adults} adults{bk.pax.children ? `, ${bk.pax.children} children` : ""}</div></div>
        <div className="text-right"><div>Voucher <b>{sv.voucherNo || "—"}</b></div><div>Booking {bk.number}</div></div>
      </div>
      <div className="mt-6 rounded-xl border border-line p-4 text-sm">
        <div className="text-xs uppercase text-ink-500">{SERVICE_ICON_LABEL[sv.type]}</div>
        <div className="text-lg font-medium">{sv.title}</div>
        <div className="mt-2 grid grid-cols-2 gap-2"><div>Date: <b>{formatDate(sv.date)}</b>{sv.endDate ? ` → ${formatDate(sv.endDate)}` : ""}</div><div>Confirmation: <b>{sv.confirmationNo || "—"}</b></div>{supplier && <div>Supplier: {supplier.name}</div>}</div>
      </div>
      <p className="mt-6 text-xs text-ink-500">Please present this voucher at check-in / pickup. For help during travel call {brand?.phone || me.settings.phone || "your travel consultant"}.</p>
    </Sheet>
  );
}

export function PrintQuotePage() {
  const { id = "" } = useParams();
  const { data, error } = usePrintData(async () => {
    const q = await api.get("quotes", id);
    const agent = q.agentId ? await api.get("agents", q.agentId).catch(() => null) : null;
    return { q, me: await api.me(), brand: agent?.brandName ? { name: agent.brandName, phone: agent.brandPhone || agent.phone, email: agent.brandEmail || agent.email } : null };
  }, [id]);
  if (error) return <div className="p-6"><ErrorNote message={error} /></div>;
  if (!data) return <Loading />;
  const { q, me, brand } = data as { q: Quote; me: { settings: Settings }; brand: { name: string; phone: string; email: string } | null };
  const p = priceOfQuote(q, isoDate(new Date()));
  const priced = new Map(p.lines.map((l) => [l.id, l]));
  return (
    <Sheet settings={me.settings} title="Travel proposal" brand={brand}>
      <h1 className="mt-6 text-2xl font-semibold">{q.title}</h1>
      <div className="text-sm text-ink-600">{q.number} · for {q.contactName} · {q.destination} · {formatDate(q.startDate)} · {q.nights}N/{q.nights + 1}D · {q.pax.adults} adults{q.pax.children ? `, ${q.pax.children} children` : ""}</div>
      <h2 className="mt-6 font-semibold">Itinerary</h2>
      <ol className="mt-2 space-y-2 text-sm">{q.days.map((d, i) => <li key={i}><b>Day {i + 1}: {d.title}</b><div className="text-ink-600">{d.description}</div></li>)}</ol>
      <h2 className="mt-6 font-semibold">Services</h2>
      <table className="mt-2 w-full text-sm"><tbody>{[...q.lines].sort((a, b) => a.day - b.day).map((l) => <tr key={l.id} className="border-b border-line"><td className="py-1.5">Day {l.day}</td><td>{l.title}{l.optional ? " (optional)" : ""}</td><td className="text-right">{l.optional ? `+${money(priced.get(l.id)?.total ?? 0)}` : "Included"}</td></tr>)}</tbody></table>
      <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Package price</dt><dd>{money(p.sell)}</dd></div>
        <div className="flex justify-between"><dt>GST</dt><dd>{money(p.gst)}</dd></div>
        {p.tcs > 0 && <div className="flex justify-between"><dt>TCS</dt><dd>{money(p.tcs)}</dd></div>}
        <div className="flex justify-between border-t border-ink-800 pt-1 text-base font-semibold"><dt>Total</dt><dd>{money(p.total)}</dd></div>
      </dl>
      <div className="mt-6 grid grid-cols-2 gap-6 text-sm"><div><h3 className="font-semibold">Included</h3><ul className="list-disc pl-5">{q.inclusions.map((x) => <li key={x}>{x}</li>)}</ul></div><div><h3 className="font-semibold">Not included</h3><ul className="list-disc pl-5">{q.exclusions.map((x) => <li key={x}>{x}</li>)}</ul></div></div>
      <p className="mt-6 whitespace-pre-wrap text-xs text-ink-500">{q.terms}</p>
    </Sheet>
  );
}
