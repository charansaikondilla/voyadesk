import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Ban, CheckCircle2, FileText, Printer, Ticket, UserPlus } from "lucide-react";
import { BOOKING_STATUSES, formatDate, type Service } from "@voyadesk/core";
import { useAction, useList, useOne } from "../../lib/hooks";
import { useNavigate as useNav } from "react-router-dom";
import { money, SERVICE_ICON_LABEL, titleCase } from "../../lib/format";
import {
  Button, Callout, Card, CardTitle, DataTable, ErrorNote, Field, Input, KeyValue, Loading, Modal, MoneyInput, PageHeader, Select, StatusBadge, Tabs,
} from "../../components/ui";
import { ActivityFeed } from "./Dashboard";
import { RecordPaymentModal } from "./Finance";
import { BookingExtras } from "../../components/plus";
import { RecordTrail } from "../../components/RecordTrail";

export function BookingsPage() {
  const q = useList("bookings");
  const nav = useNavigate();
  const [tab, setTab] = useState("upcoming");
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => (q.data ?? []).filter((b) =>
    tab === "all" ? true : tab === "upcoming" ? b.status !== "cancelled" && b.endDate >= today : b.status === tab,
  ).sort((a, b) => (tab === "upcoming" ? (a.startDate < b.startDate ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1)), [q.data, tab, today]);
  return (
    <div>
      <PageHeader title="Bookings" subtitle="One file per trip: services, suppliers, vouchers, invoice and payments." />
      <Tabs tabs={[{ key: "upcoming", label: "Upcoming & travelling" }, ...BOOKING_STATUSES.map((s) => ({ key: s, label: titleCase(s) })), { key: "all", label: "All" }]} value={tab} onChange={setTab} />
      {q.error && !q.data ? <ErrorNote message={q.error.message} onRetry={q.reload} /> : !q.data ? <Loading /> : (
        <DataTable rows={rows} onRowClick={(b) => nav(`/app/bookings/${b.id}`)} search={(b) => `${b.number} ${b.contactName} ${b.destination}`} columns={[
          { key: "no", header: "File", render: (b) => <span><span className="font-medium">{b.number}</span>{b.agentId && <span className="block text-xs text-violet-700">B2B</span>}</span>, sort: (b) => b.number },
          { key: "cust", header: "Customer", render: (b) => b.contactName, sort: (b) => b.contactName },
          { key: "trip", header: "Trip", render: (b) => `${b.destination} · ${b.pax.adults + b.pax.children} pax`, hideOnMobile: true },
          { key: "dates", header: "Dates", render: (b) => `${formatDate(b.startDate)} → ${formatDate(b.endDate)}`, sort: (b) => b.startDate },
          { key: "sell", header: "Sell", render: (b) => money(b.sellTotal), sort: (b) => b.sellTotal, align: "right" },
          { key: "status", header: "Status", render: (b) => <StatusBadge status={b.status} /> },
        ]} />
      )}
    </div>
  );
}

function AssignModal({ service, open, onClose }: { service: Service | null; open: boolean; onClose: () => void }) {
  const resources = useList("resources");
  const { act, busy } = useAction();
  const [resourceId, setResourceId] = useState("");
  const [via, setVia] = useState("whatsapp");
  if (!service) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Assign to ${service.title}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!resourceId} onClick={async () => { const r = await act("assignResource", { serviceId: service.id, resourceId, notifiedVia: via }, "Assigned; details queued to send"); if (r) onClose(); }}>Assign</Button></>}>
      <div className="space-y-3">
        <Field label="Driver, guide or vehicle"><Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}><option value="">Choose…</option>{(resources.data ?? []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{titleCase(r.kind)}: {r.name}{r.city ? ` (${r.city})` : ""}</option>)}</Select></Field>
        <Field label="Send details by"><Select value={via} onChange={(e) => setVia(e.target.value)}><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="app">Field app</option></Select></Field>
        <p className="text-xs text-ink-500">We check for double-booking on {formatDate(service.date)}{service.endDate ? ` to ${formatDate(service.endDate)}` : ""} before assigning.</p>
      </div>
    </Modal>
  );
}

function ConfirmServiceModal({ service, open, onClose }: { service: Service | null; open: boolean; onClose: () => void }) {
  const { act, busy } = useAction();
  const [conf, setConf] = useState("");
  if (!service) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Confirm ${service.title}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" busy={busy} onClick={async () => { const r = await act("updateServiceStatus", { serviceId: service.id, status: "confirmed", confirmationNo: conf }, "Service confirmed"); if (r) { setConf(""); onClose(); } }}>Confirm</Button></>}>
      <Field label="Supplier confirmation number" hint={["hotel", "flight"].includes(service.type) ? "Required for hotels and flights" : "Optional"}><Input value={conf} onChange={(e) => setConf(e.target.value)} placeholder="e.g. HTL-48213" /></Field>
    </Modal>
  );
}

export function ServicesTable({ services, showBooking }: { services: (Service & { bookingNumber?: string; assigned?: string[]; supplierName?: string })[]; showBooking?: boolean }) {
  const { act } = useAction();
  const go = useNav();
  const [assign, setAssign] = useState<Service | null>(null);
  const [confirm, setConfirm] = useState<Service | null>(null);
  return (
    <>
      <DataTable rows={services} columns={[
        { key: "date", header: "Date", render: (s) => formatDate(s.date), sort: (s) => s.date },
        { key: "svc", header: "Service", render: (s) => <span><span className="font-medium">{s.title}</span><span className="block text-xs text-ink-500">{SERVICE_ICON_LABEL[s.type]}{s.supplierName ? ` · ${s.supplierName}` : ""}{showBooking && s.bookingNumber ? ` · ${s.bookingNumber}` : ""}</span></span> },
        { key: "status", header: "Status", render: (s) => <span className="inline-flex flex-col items-end gap-0.5 md:items-start"><StatusBadge status={s.status} />{s.confirmationNo && <span className="text-xs text-ink-500">#{s.confirmationNo}</span>}</span> },
        ...(services.some((s) => s.assigned) ? [{ key: "asg", header: "Assigned", render: (s: Service & { assigned?: string[] }) => (s.assigned?.length ? s.assigned.join(", ") : "—") }] : []),
        { key: "act", header: "", align: "right" as const, render: (s) => (
          <span className="inline-flex flex-wrap justify-end gap-1">
            {s.status === "pending" && <Button size="sm" variant="ghost" onClick={() => act("updateServiceStatus", { serviceId: s.id, status: "requested" }, "Marked as requested from supplier")}>Request</Button>}
            {(s.status === "pending" || s.status === "requested") && <Button size="sm" variant="secondary" icon={<CheckCircle2 className="size-4" />} onClick={() => setConfirm(s)}>Confirm</Button>}
            {s.status === "confirmed" && !s.voucherNo && <Button size="sm" variant="secondary" icon={<Ticket className="size-4" />} onClick={() => act("generateVoucher", { serviceId: s.id }, "Voucher issued")}>Voucher</Button>}
            {s.voucherNo && <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => go(`/print/voucher/${s.id}`)}>{s.voucherNo}</Button>}
            {["transfer", "sightseeing", "activity"].includes(s.type) && s.status !== "cancelled" && <Button size="sm" variant="ghost" icon={<UserPlus className="size-4" />} onClick={() => setAssign(s)}>Assign</Button>}
          </span>
        ) },
      ]} empty="No services." />
      <AssignModal service={assign} open={assign !== null} onClose={() => setAssign(null)} />
      <ConfirmServiceModal service={confirm} open={confirm !== null} onClose={() => setConfirm(null)} />
    </>
  );
}

function CancelModal({ bookingId, open, onClose }: { bookingId: string; open: boolean; onClose: () => void }) {
  const { act, busy } = useAction();
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState<number | null>(0);
  const [refundTo, setRefundTo] = useState("bank");
  return (
    <Modal open={open} onClose={onClose} title="Cancel booking" footer={<><Button variant="secondary" onClick={onClose}>Keep booking</Button><Button variant="danger" busy={busy} onClick={async () => { const r = await act("cancelBooking", { bookingId, reason, cancellationCharge: charge ?? 0, refundTo }, "Booking cancelled; credit note issued"); if (r) onClose(); }}>Cancel booking</Button></>}>
      <div className="space-y-3">
        <Callout tone="warn">All services are cancelled and a credit note is issued for the invoice minus the cancellation charge. Raise cancellations with suppliers separately.</Callout>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cancellation charge you keep"><MoneyInput value={charge} onChange={setCharge} /></Field>
          <Field label="Refund money already paid to"><Select value={refundTo} onChange={(e) => setRefundTo(e.target.value)}><option value="bank">Bank / original method</option><option value="wallet">Customer or agent wallet</option><option value="none">No refund now</option></Select></Field>
        </div>
      </div>
    </Modal>
  );
}

export function BookingDetailPage() {
  const { id } = useParams();
  const b = useOne("bookings", id);
  const services = useList("services");
  const suppliers = useList("suppliers");
  const invoices = useList("invoices");
  const payments = useList("payments");
  const acts = useList("activities");
  const assignments = useList("assignments");
  const resources = useList("resources");
  const bills = useList("supplierBills");
  const { act, busy } = useAction();
  const [tab, setTab] = useState<"services" | "money" | "activity">("services");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  if (b.error) return <ErrorNote message={b.error.message} />;
  if (!b.data) return <Loading />;
  const bk = b.data;
  const svc = (services.data ?? []).filter((s) => s.bookingId === bk.id).sort((x, y) => (x.date < y.date ? -1 : 1)).map((s) => ({
    ...s, supplierName: suppliers.data?.find((x) => x.id === s.supplierId)?.name ?? "",
    assigned: (assignments.data ?? []).filter((a) => a.serviceId === s.id).map((a) => resources.data?.find((r) => r.id === a.resourceId)?.name ?? "—"),
  }));
  const inv = invoices.data?.find((i) => i.id === bk.invoiceId);
  const pays = (payments.data ?? []).filter((p) => p.invoiceId === bk.invoiceId);
  const myBills = (bills.data ?? []).filter((x) => x.bookingId === bk.id);
  const confirmed = svc.filter((s) => s.status === "confirmed").length;
  const live = svc.filter((s) => s.status !== "cancelled").length;
  const outstanding = inv ? inv.total - inv.paid - inv.credited : 0;

  return (
    <div>
      <PageHeader back={{ to: "/app/bookings", label: "Bookings" }} title={<span className="flex items-center gap-2">{bk.number}<StatusBadge status={bk.status} /></span>}
        subtitle={`${bk.contactName} · ${bk.title}`}
        actions={<>
          {bk.status === "confirmed" && <Button variant="secondary" busy={busy} onClick={() => act("updateBookingStatus", { bookingId: bk.id, status: "in_progress" }, "Marked as travelling")}>Mark travelling</Button>}
          {bk.status === "in_progress" && <Button variant="secondary" busy={busy} onClick={() => act("updateBookingStatus", { bookingId: bk.id, status: "completed" }, "Trip completed")}>Mark completed</Button>}
          {inv && outstanding > 0 && <Button onClick={() => setPayOpen(true)}>Record payment</Button>}
          {["confirmed", "in_progress"].includes(bk.status) && <Button variant="secondary" icon={<Ban className="size-4" />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
        </>} />
      {!bk.agentId && <RecordTrail anchor={{ kind: "booking", id: bk.id }} current="booking" />}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><div className="text-xs uppercase text-ink-500">Dates</div><div className="mt-1 font-medium">{formatDate(bk.startDate)} → {formatDate(bk.endDate)}</div></Card>
        <Card><div className="text-xs uppercase text-ink-500">Services confirmed</div><div className="mt-1 font-medium">{confirmed} of {live}</div></Card>
        <Card><div className="text-xs uppercase text-ink-500">Sell / cost</div><div className="mt-1 font-medium">{money(bk.sellTotal)} <span className="text-ink-400">/</span> {money(bk.costTotal)}</div><div className="text-xs text-emerald-700">Margin {money(bk.sellTotal - bk.costTotal)}</div></Card>
        <Card><div className="text-xs uppercase text-ink-500">Customer owes</div><div className={outstanding > 0 ? "mt-1 font-medium text-amber-700" : "mt-1 font-medium text-emerald-700"}>{inv ? money(outstanding) : "—"}</div></Card>
      </div>

      <Tabs tabs={[{ key: "services", label: "Services & vouchers", count: svc.length }, { key: "money", label: "Invoice & payments" }, { key: "activity", label: "History" }]} value={tab} onChange={setTab} />
      {tab === "services" && <ServicesTable services={svc} />}
      {tab === "services" && <div className="mt-5 space-y-5"><BookingExtras booking={bk} /></div>}
      {tab === "money" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle title="Customer invoice" action={inv && <Link to={`/app/finance/invoices/${inv.id}`} className="text-sm text-brand-700 hover:underline">Open</Link>} />
            {inv ? <KeyValue items={[["Invoice", inv.number], ["Status", <StatusBadge key="s" status={inv.status} />], ["Taxable value", money(inv.sell)], ["GST", money(inv.gst)], ["TCS", money(inv.tcs)], ["Total", money(inv.total)], ["Paid", money(inv.paid)], ["Credited", money(inv.credited)], ["Due", formatDate(inv.dueDate)]]} /> : <p className="text-sm text-ink-500">No invoice.</p>}
            {pays.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">{pays.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{formatDate(p.date)} · {titleCase(p.method)}{p.direction === "out" ? " (refund)" : ""}</span><span className={p.direction === "out" ? "text-rose-700" : "text-emerald-700"}>{p.direction === "out" ? "−" : "+"}{money(p.amount)}</span></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardTitle title="Supplier bills" action={<Link to="/app/finance/payables" className="text-sm text-brand-700 hover:underline">Payables</Link>} />
            {myBills.length === 0 ? <p className="text-sm text-ink-500">No supplier bills (services without a supplier are not billed).</p> : (
              <ul className="divide-y divide-line text-sm">{myBills.map((x) => <li key={x.id} className="flex items-center justify-between py-2"><span>{x.supplierName}<span className="block text-xs text-ink-500">Due {formatDate(x.dueDate)}</span></span><span className="flex items-center gap-2">{money(x.amount)}<StatusBadge status={x.status} /></span></li>)}</ul>
            )}
          </Card>
        </div>
      )}
      {tab === "activity" && <Card><ActivityFeed items={(acts.data ?? []).filter((a) => a.bookingId === bk.id).sort((x, y) => (x.at < y.at ? 1 : -1))} /></Card>}
      {bk.quoteId && <p className="mt-4 text-sm text-ink-500"><FileText className="mr-1 inline size-4" />Created from <Link to={`/app/quotes/${bk.quoteId}`} className="text-brand-700 hover:underline">the accepted quote</Link>{bk.leadId && <> for <Link to={`/app/leads/${bk.leadId}`} className="text-brand-700 hover:underline">this lead</Link></>}.</p>}
      <CancelModal bookingId={bk.id} open={cancelOpen} onClose={() => setCancelOpen(false)} />
      {inv && <RecordPaymentModal invoice={inv} open={payOpen} onClose={() => setPayOpen(false)} />}
    </div>
  );
}
