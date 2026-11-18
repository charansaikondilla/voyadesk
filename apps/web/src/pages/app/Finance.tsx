import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Printer, XCircle } from "lucide-react";
import { RecordTrail } from "../../components/RecordTrail";
import { formatDate, formatMonth, type AgingBuckets, type Invoice, type LedgerRow } from "@voyadesk/core";
import { useAction, useList, useOne, useReport } from "../../lib/hooks";
import { copyText } from "../../lib/toast";
import { money, titleCase } from "../../lib/format";
import {
  Button, Callout, Card, CardTitle, DataTable, ErrorNote, Field, Input, KeyValue, Loading, Modal, MoneyInput, PageHeader, Select, Stat, StatusBadge, Tabs,
} from "../../components/ui";
import { InvoiceExtras } from "../../components/plus";

const METHODS = ["upi", "card", "netbanking", "bank_transfer", "cash", "cheque", "wallet"];

export function RecordPaymentModal({ invoice, open, onClose }: { invoice: Invoice; open: boolean; onClose: () => void }) {
  const outstanding = invoice.total - invoice.paid - invoice.credited;
  const { act, busy } = useAction();
  const [amount, setAmount] = useState<number | null>(outstanding);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={`Record payment — ${invoice.number}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("recordPayment", { invoiceId: invoice.id, amount: amount ?? 0, method, reference }, "Payment recorded and posted to the ledger"); if (r) onClose(); }}>Record</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Outstanding: <b>{money(outstanding)}</b></p>
        <Field label="Amount received"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.filter((m) => m !== "wallet" || invoice.partyType === "agent").map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select></Field>
        <Field label="Reference (UTR, cheque no.)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CreditNoteModal({ invoice, open, onClose }: { invoice: Invoice; open: boolean; onClose: () => void }) {
  const { act, busy } = useAction();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [refundTo, setRefundTo] = useState("none");
  return (
    <Modal open={open} onClose={onClose} title={`Credit note on ${invoice.number}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" busy={busy} onClick={async () => { const r = await act("issueCreditNote", { invoiceId: invoice.id, amount: amount ?? 0, reason, refundTo }, "Credit note issued"); if (r) onClose(); }}>Issue credit note</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Can credit up to <b>{money(invoice.total - invoice.credited)}</b>. GST and TCS are reversed in proportion.</p>
        <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Hotel downgrade" /></Field>
        <Field label="Refund any overpayment to"><Select value={refundTo} onChange={(e) => setRefundTo(e.target.value)}><option value="none">Keep as credit</option><option value="bank">Bank / original method</option><option value="wallet">Wallet</option></Select></Field>
      </div>
    </Modal>
  );
}

interface AgingData { asOf: string; receivables: AgingBuckets; payables: AgingBuckets; receivablesByParty: (AgingBuckets & { party: string; partyType: string })[]; payablesByParty: (AgingBuckets & { party: string })[] }

function AgingBar({ b }: { b: AgingBuckets }) {
  const parts = [["Not due", b.notDue, "#10b981"], ["1–30", b.d1_30, "#f59e0b"], ["31–60", b.d31_60, "#f97316"], ["61–90", b.d61_90, "#ef4444"], ["90+", b.d90plus, "#991b1b"]] as const;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">{parts.map(([k, v, c]) => (b.total ? <div key={k} style={{ width: `${(v / b.total) * 100}%`, background: c }} title={`${k}: ${money(v)}`} /> : null))}</div>
      <div className="mt-2 grid grid-cols-5 gap-1 text-xs">{parts.map(([k, v, c]) => <div key={k}><span className="inline-block size-2 rounded-sm" style={{ background: c }} /> {k}<div className="font-medium tabular-nums">{money(v)}</div></div>)}</div>
    </div>
  );
}

export function FinanceOverviewPage() {
  const aging = useReport<AgingData>("aging");
  const books = useReport<{ trial: { debit: number; credit: number; balanced: boolean }; accounts: { account: string; balance: number }[] }>("books");
  if ((aging.error && !aging.data) || (books.error && !books.data)) return <ErrorNote message={(aging.error ?? books.error)!.message} />;
  if (!aging.data || !books.data) return <Loading />;
  const bal = (a: string) => books.data!.accounts.find((x) => x.account === a)?.balance ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader title="Finance overview" subtitle={`As of ${formatDate(aging.data.asOf)}`} actions={<Link to="/app/finance/invoices" className="text-sm text-brand-700 hover:underline">All invoices →</Link>} />
      {books.data.trial.balanced ? <Callout tone="good">Books balanced: debits {money(books.data.trial.debit)} = credits {money(books.data.trial.credit)}.</Callout> : <Callout tone="bad">Books do not balance — contact support.</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bank & gateway" value={money(bal("bank"))} />
        <Stat label="Customers & agents owe" value={money(aging.data.receivables.total)} tone={aging.data.receivables.total - aging.data.receivables.notDue > 0 ? "warn" : "default"} />
        <Stat label="We owe suppliers" value={money(aging.data.payables.total)} />
        <Stat label="GST + TCS collected" value={money(bal("gst_output") + bal("tcs_payable"))} hint="Owed to government" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle title="Receivables aging" subtitle="By days past due" /><AgingBar b={aging.data.receivables} />
          <ul className="mt-4 divide-y divide-line text-sm">{aging.data.receivablesByParty.slice(0, 8).map((p) => <li key={p.party} className="flex justify-between py-2"><span>{p.party} <span className="text-xs text-ink-500">({p.partyType})</span></span><span className="tabular-nums">{money(p.total)}</span></li>)}</ul>
        </Card>
        <Card><CardTitle title="Payables aging" subtitle="Supplier bills by due date" /><AgingBar b={aging.data.payables} />
          <ul className="mt-4 divide-y divide-line text-sm">{aging.data.payablesByParty.slice(0, 8).map((p) => <li key={p.party} className="flex justify-between py-2"><span>{p.party}</span><span className="tabular-nums">{money(p.total)}</span></li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

export function InvoicesPage() {
  const q = useList("invoices");
  const nav = useNavigate();
  const [tab, setTab] = useState("open");
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => (q.data ?? []).filter((i) => {
    const out = i.total - i.paid - i.credited;
    return tab === "all" ? true : tab === "open" ? out > 0 && i.status !== "cancelled" : tab === "overdue" ? out > 0 && i.dueDate < today && i.status !== "cancelled" : i.status === tab;
  }).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1)), [q.data, tab, today]);
  return (
    <div>
      <PageHeader title="Invoices" subtitle="GST invoices are created automatically when a booking is confirmed." />
      <Tabs tabs={[{ key: "open", label: "Unpaid" }, { key: "overdue", label: "Overdue" }, { key: "paid", label: "Paid" }, { key: "cancelled", label: "Cancelled" }, { key: "all", label: "All" }]} value={tab} onChange={setTab} />
      {q.error && !q.data ? <ErrorNote message={q.error.message} /> : !q.data ? <Loading /> : (
        <DataTable rows={rows} onRowClick={(i) => nav(`/app/finance/invoices/${i.id}`)} search={(i) => `${i.number} ${i.partyName}`} columns={[
          { key: "no", header: "Invoice", render: (i) => <span className="font-medium">{i.number}</span>, sort: (i) => i.number },
          { key: "party", header: "Billed to", render: (i) => <span>{i.partyName}<span className="block text-xs text-ink-500">{titleCase(i.partyType)}</span></span>, sort: (i) => i.partyName },
          { key: "date", header: "Date", render: (i) => formatDate(i.issueDate), sort: (i) => i.issueDate, hideOnMobile: true },
          { key: "due", header: "Due", render: (i) => <span className={i.dueDate < today && i.total - i.paid - i.credited > 0 ? "text-rose-700" : ""}>{formatDate(i.dueDate)}</span>, sort: (i) => i.dueDate },
          { key: "total", header: "Total", render: (i) => money(i.total), sort: (i) => i.total, align: "right" },
          { key: "out", header: "Outstanding", render: (i) => money(i.total - i.paid - i.credited), sort: (i) => i.total - i.paid - i.credited, align: "right" },
          { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
        ]} />
      )}
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const q = useOne("invoices", id);
  const payments = useList("payments");
  const notes = useList("creditNotes");
  const [pay, setPay] = useState(false);
  const [cn, setCn] = useState(false);
  const go = useNavigate();
  if (q.error) return <ErrorNote message={q.error.message} />;
  if (!q.data) return <Loading />;
  const i = q.data;
  const outstanding = i.total - i.paid - i.credited;
  return (
    <div>
      <PageHeader back={{ to: "/app/finance/invoices", label: "Invoices" }} title={<span className="flex items-center gap-2">{i.number}<StatusBadge status={i.status} /></span>} subtitle={`${i.partyName} · issued ${formatDate(i.issueDate)}`}
        actions={<>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => go(`/print/invoice/${i.id}`)}>Print / PDF</Button>
          {i.status !== "cancelled" && i.total > i.credited && <Button variant="secondary" onClick={() => setCn(true)}>Credit note</Button>}
          {outstanding > 0 && <Button onClick={() => setPay(true)}>Record payment</Button>}
        </>} />
      {i.partyType === "customer" && <RecordTrail anchor={{ kind: "invoice", id: i.id }} current="invoice" />}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle title="Invoice lines" />
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-ink-500"><tr><th className="py-1">Description</th><th>SAC</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">{i.lines.map((l, k) => <tr key={k}><td className="py-2">{l.description}</td><td>{l.sac || "—"}</td><td className="text-right tabular-nums">{money(l.amount)}</td></tr>)}</tbody></table>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            {[["Taxable value", i.sell], ...(i.igst ? [["IGST", i.igst]] : [["CGST", i.cgst], ["SGST", i.sgst]]), ...(i.tcs ? [["TCS (overseas package)", i.tcs]] : [])].map(([k, v]) => <div key={String(k)} className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className="tabular-nums">{money(Number(v))}</dd></div>)}
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(i.total)}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardTitle title="Status" />
          <KeyValue items={[["Paid", money(i.paid)], ["Credited", money(i.credited)], ["Outstanding", money(outstanding)], ["Due date", formatDate(i.dueDate)], ["Place of supply", i.placeOfSupply], ["Scope", titleCase(i.scope)]]} />
          {i.bookingId && <Link to={`/app/bookings/${i.bookingId}`} className="mt-3 inline-block text-sm text-brand-700 hover:underline">Open booking →</Link>}
        </Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card><CardTitle title="Payments" />{(payments.data ?? []).filter((p) => p.invoiceId === i.id).map((p) => <div key={p.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{formatDate(p.date)} · {titleCase(p.method)} {p.reference && <span className="text-ink-500">({p.reference})</span>}</span><span className={p.direction === "out" ? "text-rose-700" : "text-emerald-700"}>{p.direction === "out" ? "−" : "+"}{money(p.amount)}</span></div>)}</Card>
        <Card><CardTitle title="Credit notes" />{(notes.data ?? []).filter((c) => c.invoiceId === i.id).map((c) => <div key={c.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{c.number} · {c.reason}</span><span>{money(c.amount)}</span></div>)}</Card>
      </div>
      <div className="mt-5"><InvoiceExtras invoice={i} /></div>
      <RecordPaymentModal invoice={i} open={pay} onClose={() => setPay(false)} />
      <CreditNoteModal invoice={i} open={cn} onClose={() => setCn(false)} />
    </div>
  );
}

export function PaymentsPage() {
  const q = useList("payments");
  return (
    <div>
      <PageHeader title="Payments" subtitle="Money in (customers, agents, wallet top-ups) and out (suppliers, refunds)." />
      {!q.data ? <Loading /> : (
        <DataTable rows={[...q.data].sort((a, b) => (a.date < b.date ? 1 : -1))} search={(p) => `${p.partyName} ${p.reference} ${p.method}`} columns={[
          { key: "date", header: "Date", render: (p) => formatDate(p.date), sort: (p) => p.date },
          { key: "party", header: "Party", render: (p) => <span>{p.partyName}<span className="block text-xs text-ink-500">{titleCase(p.purpose)}</span></span> },
          { key: "method", header: "Method", render: (p) => `${titleCase(p.method)}${p.gateway !== "manual" ? ` · ${titleCase(p.gateway)}` : ""}`, hideOnMobile: true },
          { key: "ref", header: "Reference", render: (p) => p.reference || "—", hideOnMobile: true },
          { key: "amt", header: "Amount", render: (p) => <span className={p.direction === "out" ? "text-rose-700" : "text-emerald-700"}>{p.direction === "out" ? "−" : "+"}{money(p.amount)}</span>, sort: (p) => (p.direction === "out" ? -p.amount : p.amount), align: "right" },
        ]} />
      )}
    </div>
  );
}

export function PayablesPage() {
  const q = useList("supplierBills");
  const { act, busy } = useAction();
  const [paying, setPaying] = useState<{ id: string; max: number; name: string } | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader title="Supplier payables" subtitle="Bills are raised per supplier when a booking is confirmed, due before travel by the supplier's terms." />
      {!q.data ? <Loading /> : (
        <DataTable rows={[...q.data].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))} search={(b) => b.supplierName} columns={[
          { key: "sup", header: "Supplier", render: (b) => <span className="font-medium">{b.supplierName}</span>, sort: (b) => b.supplierName },
          { key: "due", header: "Due", render: (b) => <span className={b.status !== "paid" && b.dueDate < today ? "text-rose-700" : ""}>{formatDate(b.dueDate)}</span>, sort: (b) => b.dueDate },
          { key: "amt", header: "Amount", render: (b) => money(b.amount), align: "right", sort: (b) => b.amount },
          { key: "out", header: "Outstanding", render: (b) => money(b.amount - b.paid), align: "right" },
          { key: "status", header: "Status", render: (b) => <StatusBadge status={b.status} /> },
          { key: "pay", header: "", align: "right", render: (b) => b.status !== "paid" ? <Button size="sm" variant="secondary" onClick={() => { setPaying({ id: b.id, max: b.amount - b.paid, name: b.supplierName }); setAmount(b.amount - b.paid); }}>Pay</Button> : null },
        ]} />
      )}
      <Modal open={paying !== null} onClose={() => setPaying(null)} title={`Pay ${paying?.name ?? ""}`} size="sm" footer={<><Button variant="secondary" onClick={() => setPaying(null)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("paySupplierBill", { billId: paying!.id, amount: amount ?? 0, method: "bank_transfer" }, "Supplier payment posted"); if (r) setPaying(null); }}>Record payment</Button></>}>
        <Field label={`Amount (outstanding ${money(paying?.max ?? 0)})`}><MoneyInput value={amount} onChange={setAmount} /></Field>
      </Modal>
    </div>
  );
}

export function LedgerPage() {
  const books = useReport<{ trial: { debit: number; credit: number; balanced: boolean }; accounts: { account: string; balance: number }[] }>("books");
  const q = useList("ledger");
  const [account, setAccount] = useState("");
  const rows = useMemo(() => (q.data ?? []).filter((e) => !account || e.account === account).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.txnId.localeCompare(b.txnId))), [q.data, account]);
  return (
    <div className="space-y-5">
      <PageHeader title="Ledger & books" subtitle="Double-entry: every business event posts a transaction whose debits equal its credits." />
      {books.data && (
        <Card>
          <CardTitle title="Trial balance" action={books.data.trial.balanced ? <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Balanced</span> : <span className="inline-flex items-center gap-1 text-sm text-rose-700"><XCircle className="size-4" />Not balanced</span>} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{books.data.accounts.map((a) => <button key={a.account} onClick={() => setAccount(account === a.account ? "" : a.account)} className={`rounded-lg border p-3 text-left ${account === a.account ? "border-brand-600 bg-brand-50" : "border-line"}`}><div className="text-xs uppercase text-ink-500">{titleCase(a.account)}</div><div className="mt-1 font-semibold tabular-nums">{money(a.balance)}</div></button>)}</div>
        </Card>
      )}
      {!q.data ? <Loading /> : (
        <DataTable<LedgerRow> rows={rows} search={(e) => `${e.memo} ${e.partyName ?? ""} ${e.account}`} pageSize={40} columns={[
          { key: "date", header: "Date", render: (e) => formatDate(e.date), sort: (e) => e.date },
          { key: "acc", header: "Account", render: (e) => titleCase(e.account) },
          { key: "party", header: "Party", render: (e) => e.partyName ?? "—", hideOnMobile: true },
          { key: "memo", header: "Memo", render: (e) => e.memo, hideOnMobile: true },
          { key: "dr", header: "Debit", render: (e) => (e.debit ? money(e.debit) : ""), align: "right" },
          { key: "cr", header: "Credit", render: (e) => (e.credit ? money(e.credit) : ""), align: "right" },
        ]} />
      )}
    </div>
  );
}

interface TaxData { gst: { month: string; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; gst: number; creditNotes: number }[]; tcs: { month: string; invoices: number; collectedOn: number; tcs: number }[]; tcsInvoices: { number: string; date: string; party: string; pan: string; amount: number; tcs: number }[] }

export function TaxPage() {
  const q = useReport<TaxData>("gst", { months: 12 });
  const rules = useList("tcsRules");
  const gstRules = useList("taxRules");
  if (q.error && !q.data) return <ErrorNote message={q.error.message} />;
  if (!q.data) return <Loading />;
  const csvText = () => ["Month,Invoices,Taxable,CGST,SGST,IGST,Total GST,Credit notes", ...q.data!.gst.map((r) => [r.month, r.invoices, r.taxable / 100, r.cgst / 100, r.sgst / 100, r.igst / 100, r.gst / 100, r.creditNotes / 100].join(","))].join("\n");
  const csv = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csvText()], { type: "text/csv" }));
    a.download = "gst-summary.csv";
    a.click();
  };
  return (
    <div className="space-y-5">
      <PageHeader title="GST & TCS" subtitle="Return-ready monthly summaries. Rules are dated data you can edit in Settings → Tax rules." actions={<><Button variant="secondary" onClick={() => void copyText(csvText())}>Copy GST CSV</Button><Button variant="secondary" onClick={csv}>Download CSV</Button></>} />
      <Callout tone="info">Defaults: tour packages 5% GST without ITC (SAC 998555); agent service fees 18% on the fee; overseas-package TCS 2% flat from 1 April 2026. Confirm rates with your chartered accountant.</Callout>
      <Card padded={false}>
        <div className="p-4 sm:p-5"><CardTitle title="GST by month" /></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-ink-500"><tr><th className="px-4 py-2">Month</th><th className="px-3 text-right">Invoices</th><th className="px-3 text-right">Taxable</th><th className="px-3 text-right">CGST</th><th className="px-3 text-right">SGST</th><th className="px-3 text-right">IGST</th><th className="px-4 text-right">Credit notes</th></tr></thead>
          <tbody className="divide-y divide-line">{q.data.gst.map((r) => <tr key={r.month}><td className="px-4 py-2">{formatMonth(r.month)}</td><td className="px-3 text-right">{r.invoices}</td><td className="px-3 text-right tabular-nums">{money(r.taxable)}</td><td className="px-3 text-right tabular-nums">{money(r.cgst)}</td><td className="px-3 text-right tabular-nums">{money(r.sgst)}</td><td className="px-3 text-right tabular-nums">{money(r.igst)}</td><td className="px-4 text-right tabular-nums">{money(r.creditNotes)}</td></tr>)}</tbody></table></div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle title="TCS collected on overseas packages" />
          <ul className="divide-y divide-line text-sm">{q.data.tcsInvoices.length === 0 ? <li className="py-2 text-ink-500">None yet.</li> : q.data.tcsInvoices.map((t) => <li key={t.number} className="flex justify-between py-2"><span>{t.number} · {t.party}<span className="block text-xs text-ink-500">{formatDate(t.date)} · on {money(t.amount)}</span></span><span className="tabular-nums">{money(t.tcs)}</span></li>)}</ul>
        </Card>
        <Card><CardTitle title="Rules in force" />
          <ul className="space-y-2 text-sm">
            {(gstRules.data ?? []).map((r) => <li key={r.id}><b>GST {r.rateBps / 100}%</b> on {r.basis === "markup_only" ? "service fee" : "total"} — {r.appliesTo === "*" ? "any service" : r.appliesTo} ({r.scope}), from {formatDate(r.effectiveFrom)}{r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : ""}</li>)}
            {(rules.data ?? []).map((r) => <li key={r.id}><b>TCS {r.thresholdMinor === null ? `${r.rateBelowBps / 100}% flat` : `${r.rateBelowBps / 100}% / ${r.rateAboveBps / 100}%`}</b> from {formatDate(r.effectiveFrom)}{r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : " (current)"}<span className="block text-xs text-ink-500">{r.note}</span></li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
