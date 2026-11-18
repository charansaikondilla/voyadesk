import { Suspense, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { LogOut, Wallet } from "lucide-react";
import { formatDate, type AgentPosition, type Quote, type StatementLine } from "@voyadesk/core";
import { useAction, useList, useReport } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { money, titleCase } from "../../lib/format";
import { Brand } from "../../components/Brand";
import {
  Button, Callout, Card, CardTitle, DataTable, ErrorBoundary, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Stat, StatusBadge, cx,
} from "../../components/ui";
import { Statement } from "../app/B2B";
import { NewVisaModal } from "../app/Visa";
import { shareUrl } from "../app/QuoteBuilder";
import { copyText } from "../../lib/toast";

interface StatementData { lines: StatementLine[]; balance: number; wallet: { lines: StatementLine[]; balance: number }; position: AgentPosition; agent: { name: string; creditLimit: number; creditDays: number; blocked: boolean; slab: string } }

function useStatement() {
  const { user } = useSession();
  return useReport<StatementData>("statement", { partyType: "agent", partyId: user?.agentId ?? "" }, Boolean(user?.agentId));
}

function Home() {
  const st = useStatement();
  const bookings = useList("bookings");
  if (!st.data) return <Loading />;
  const p = st.data.position;
  return (
    <div className="space-y-5">
      <PageHeader title={`Welcome, ${st.data.agent.name}`} subtitle={`${titleCase(st.data.agent.slab)} partner · ${st.data.agent.creditDays} days credit`} />
      {st.data.agent.blocked && <Callout tone="bad">Your account is on hold. Please clear overdue dues to book again.</Callout>}
      {p.overdue > 0 && <Callout tone="warn">{money(p.overdue)} is overdue.</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Wallet" value={money(p.wallet)} tone="good" />
        <Stat label="Credit available" value={money(p.available)} hint={`Limit ${money(st.data.agent.creditLimit)}`} />
        <Stat label="Outstanding" value={money(Math.max(0, p.receivable))} />
        <Stat label="Bookings" value={bookings.data?.length ?? "—"} />
      </div>
      <Card><CardTitle title="Upcoming trips" />
        <ul className="divide-y divide-line text-sm">{(bookings.data ?? []).filter((b) => b.status !== "cancelled").sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).slice(0, 8).map((b) => <li key={b.id} className="flex justify-between py-2"><span>{b.contactName}<span className="block text-xs text-ink-500">{b.number} · {b.destination}</span></span><span className="text-right">{formatDate(b.startDate)}<span className="block"><StatusBadge status={b.status} /></span></span></li>)}</ul>
      </Card>
    </div>
  );
}

function Packages() {
  const pk = useList("packages");
  const nav = useNavigate();
  const { act, busy } = useAction();
  const [pick, setPick] = useState<string | null>(null);
  const [f, setF] = useState({ contactName: "", startDate: "", adults: "2", children: "0", phone: "" });
  return (
    <div>
      <PageHeader title="Packages" subtitle="Prices include your partner rate. Build a quote, then book on wallet or credit." />
      {!pk.data ? <Loading /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pk.data.map((p) => (
          <Card key={p.id}><div className="text-xs uppercase text-ink-500">{p.destination}</div><div className="font-semibold">{p.name}</div><div className="text-sm text-ink-600">{p.nights} nights · {titleCase(p.theme)}</div><Button size="sm" className="mt-3" onClick={() => setPick(p.id)}>Build quote</Button></Card>
        ))}</div>
      )}
      <Modal open={pick !== null} onClose={() => setPick(null)} title="Quote for your client" footer={<><Button variant="secondary" onClick={() => setPick(null)}>Cancel</Button><Button busy={busy} onClick={async () => {
        const q = await act<Quote>("agentCreateQuote", { packageId: pick, startDate: f.startDate, adults: Number(f.adults) || 1, children: Number(f.children) || 0, contactName: f.contactName, phone: f.phone || undefined }, "Quote ready");
        if (q) { setPick(null); nav("/agent/quotes"); }
      }}>Create quote</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client name" required><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
          <Field label="Client phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Travel date" required><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Adults"><Input type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} /></Field><Field label="Children"><Input type="number" min={0} value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} /></Field></div>
        </div>
      </Modal>
    </div>
  );
}

function Quotes() {
  const q = useList("quotes");
  const { act, busy } = useAction();
  const [book, setBook] = useState<Quote | null>(null);
  const [payBy, setPayBy] = useState<"wallet" | "credit">("wallet");
  return (
    <div>
      <PageHeader title="My quotes" />
      {!q.data ? <Loading /> : (
        <DataTable rows={[...q.data].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))} search={(x) => `${x.number} ${x.contactName}`} columns={[
          { key: "n", header: "Quote", render: (x) => <span><span className="font-medium">{x.number}</span><span className="block text-xs text-ink-500">{x.title}</span></span> },
          { key: "d", header: "Travel", render: (x) => formatDate(x.startDate) },
          { key: "t", header: "Total", render: (x) => money(x.total), align: "right" },
          { key: "s", header: "Status", render: (x) => <StatusBadge status={x.status} /> },
          { key: "a", header: "", align: "right", render: (x) => x.status === "accepted" ? null : (
            <span className="inline-flex gap-1">
              {x.status === "draft" && <Button size="sm" variant="secondary" onClick={() => act("sendQuote", { quoteId: x.id, channel: "link" }, "Proposal link ready")}>Get client link</Button>}
              {x.status !== "draft" && x.shareToken && <Button size="sm" variant="ghost" onClick={() => void copyText(shareUrl(x.shareToken))}>Copy link</Button>}
              <Button size="sm" onClick={() => setBook(x)}>Book</Button>
            </span>
          ) },
        ]} />
      )}
      <Modal open={book !== null} onClose={() => setBook(null)} title={`Book ${book?.number ?? ""}`} size="sm" footer={<><Button variant="secondary" onClick={() => setBook(null)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("agentBook", { quoteId: book!.id, payBy }, "Booked! Vouchers follow once suppliers confirm."); if (r) setBook(null); }}>Confirm booking</Button></>}>
        <div className="space-y-3 text-sm">
          <p>Total <b>{money(book?.total ?? 0)}</b></p>
          <Field label="Pay with"><Select value={payBy} onChange={(e) => setPayBy(e.target.value as "wallet" | "credit")}><option value="wallet">Wallet balance</option><option value="credit">Credit (pay within your credit days)</option></Select></Field>
          <p className="text-xs text-ink-500">We check your wallet, credit limit and any overdue invoices before confirming.</p>
        </div>
      </Modal>
    </div>
  );
}

function Bookings() {
  const b = useList("bookings");
  return (
    <div><PageHeader title="My bookings" />
      {!b.data ? <Loading /> : <DataTable rows={b.data} search={(x) => `${x.number} ${x.contactName}`} columns={[
        { key: "n", header: "File", render: (x) => <span className="font-medium">{x.number}</span> },
        { key: "c", header: "Client", render: (x) => x.contactName },
        { key: "d", header: "Dates", render: (x) => `${formatDate(x.startDate)} → ${formatDate(x.endDate)}` },
        { key: "s", header: "Sell", render: (x) => money(x.sellTotal), align: "right" },
        { key: "st", header: "Status", render: (x) => <StatusBadge status={x.status} /> },
      ]} />}
    </div>
  );
}

function Visa() {
  const v = useList("visaCases");
  const [open, setOpen] = useState(false);
  return (
    <div><PageHeader title="Visa applications" actions={<Button onClick={() => setOpen(true)}>New application</Button>} />
      {!v.data ? <Loading /> : <DataTable rows={v.data} columns={[
        { key: "n", header: "File", render: (x) => <span className="font-medium">{x.number}</span> },
        { key: "c", header: "Client", render: (x) => x.contactName },
        { key: "co", header: "Country", render: (x) => x.country },
        { key: "d", header: "Documents", render: (x) => `${x.applicants.reduce((a, p) => a + p.docs.filter((d) => d.received).length, 0)}/${x.applicants.reduce((a, p) => a + p.docs.length, 0)}` },
        { key: "s", header: "Status", render: (x) => <StatusBadge status={x.status} /> },
      ]} />}
      <NewVisaModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function StatementPage() {
  const st = useStatement();
  const { user } = useSession();
  const { act, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [ref, setRef] = useState("");
  if (!st.data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader title="Statement & wallet" actions={<Button icon={<Wallet className="size-4" />} onClick={() => setOpen(true)}>Add money</Button>} />
      <div className="grid gap-5 lg:grid-cols-2"><Card><CardTitle title="Account" subtitle={`Balance ${money(st.data.balance)}`} /><Statement lines={st.data.lines} /></Card><Card><CardTitle title="Wallet" subtitle={`Balance ${money(st.data.wallet.balance)}`} /><Statement lines={st.data.wallet.lines} /></Card></div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add money to wallet" size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("topUpWallet", { agentId: user!.agentId, amount: amount ?? 0, method: "bank_transfer", reference: ref }, "Wallet topped up"); if (r) setOpen(false); }}>Add</Button></>}>
        <div className="space-y-3"><Field label="Amount transferred"><MoneyInput value={amount} onChange={setAmount} /></Field><Field label="Bank reference (UTR)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div>
      </Modal>
    </div>
  );
}

export function AgentPortal() {
  const { user, loading, signOut, settings } = useSession();
  const nav = useNavigate();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "agent") return <Navigate to="/app" replace />;
  const links = [["", "Home"], ["packages", "Packages"], ["quotes", "Quotes"], ["bookings", "Bookings"], ["visa", "Visa"], ["statement", "Statement"]];
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3"><Brand to="/agent" /><span className="hidden text-xs text-ink-500 sm:inline">Partner portal · {settings?.companyName}</span></div>
          <button className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-rose-700" onClick={() => { signOut(); nav("/"); }}><LogOut className="size-4" />Sign out</button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3">{links.map(([to, label]) => <NavLink key={to} to={`/agent${to ? `/${to}` : ""}`} end={to === ""} className={({ isActive }) => cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", isActive ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-ink-600")}>{label}</NavLink>)}</nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <ErrorBoundary><Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<Home />} />
            <Route path="packages" element={<Packages />} />
            <Route path="quotes" element={<Quotes />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="visa" element={<Visa />} />
            <Route path="statement" element={<StatementPage />} />
            <Route path="*" element={<Navigate to="/agent" replace />} />
          </Routes>
        </Suspense></ErrorBoundary>
      </main>
    </div>
  );
}
