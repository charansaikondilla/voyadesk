import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock, Unlock, Wallet } from "lucide-react";
import { formatDate, type AgentPosition, type StatementLine } from "@voyadesk/core";
import { useAction, useList, useOne, useReport } from "../../lib/hooks";
import { money, pct, titleCase } from "../../lib/format";
import { ResourcePage } from "../../components/ResourcePage";
import { Badge, Button, Callout, Card, CardTitle, ErrorNote, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Stat, StatusBadge } from "../../components/ui";
import { CommissionsPanel } from "./Plus";

export function AgentsPage() {
  const nav = useNavigate();
  return (
    <ResourcePage collection="agents" title="B2B agents" singular="Agent" subtitle="Sub-agents book at their slab price on wallet or credit. They never see your supplier costs."
      search={(a) => `${a.name} ${a.city} ${a.contactName}`} onRowClick={(a) => nav(`/app/b2b/${a.id}`)}
      defaults={{ slab: "silver", markupBps: 900, creditLimit: 0, creditDays: 15, currency: "INR" }}
      fields={[
        { name: "name", label: "Agency name", type: "text", required: true },
        { name: "contactName", label: "Contact person", type: "text" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Phone", type: "phone" },
        { name: "city", label: "City", type: "text" },
        { name: "gstin", label: "GSTIN", type: "text" },
        { name: "slab", label: "Slab", type: "select", options: [{ value: "silver", label: "Silver" }, { value: "gold", label: "Gold" }, { value: "platinum", label: "Platinum" }] },
        { name: "markupBps", label: "Your markup for this agent", type: "percent", hint: "Added on top of net cost in agent quotes" },
        { name: "creditLimit", label: "Credit limit", type: "money" },
        { name: "creditDays", label: "Credit days", type: "number" },
        { name: "commissionBps", label: "Commission on bookings", type: "percent", hint: "Paid to the agent's wallet; use 0 if they earn only through your net rates" },
        { name: "brandName", label: "Their brand on vouchers and quotes (white-label)", type: "text" },
        { name: "brandPhone", label: "Their phone on vouchers", type: "phone" },
        { name: "brandEmail", label: "Their email on vouchers", type: "email" },
      ]}
      columns={[
        { key: "name", header: "Agency", render: (a) => <span><span className="font-medium">{a.name}</span><span className="block text-xs text-ink-500">{a.contactName} · {a.city}</span></span>, sort: (a) => a.name },
        { key: "slab", header: "Slab", render: (a) => <Badge tone={a.slab === "platinum" ? "violet" : a.slab === "gold" ? "amber" : "gray"}>{titleCase(a.slab)}</Badge> },
        { key: "markup", header: "Markup", render: (a) => pct(a.markupBps), align: "right" },
        { key: "credit", header: "Credit limit", render: (a) => money(a.creditLimit), align: "right" },
        { key: "status", header: "Status", render: (a) => <StatusBadge status={a.blocked ? "blocked" : "active"} /> },
      ]} />
  );
}

interface StatementData { lines: StatementLine[]; balance: number; wallet: { lines: StatementLine[]; balance: number }; position: AgentPosition }

export function AgentDetailPage() {
  const { id } = useParams();
  const agent = useOne("agents", id);
  const st = useReport<StatementData>("statement", { partyType: "agent", partyId: id ?? "" }, Boolean(id));
  const bookings = useList("bookings");
  const { act, busy } = useAction();
  const [topUp, setTopUp] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  if (agent.error) return <ErrorNote message={agent.error.message} />;
  if (!agent.data || !st.data) return <Loading />;
  const a = agent.data;
  const pos = st.data.position;
  const theirs = (bookings.data ?? []).filter((b) => b.agentId === a.id);
  return (
    <div className="space-y-5">
      <PageHeader back={{ to: "/app/b2b", label: "Agents" }} title={<span className="flex items-center gap-2">{a.name}<StatusBadge status={a.blocked ? "blocked" : "active"} /></span>} subtitle={`${titleCase(a.slab)} slab · markup ${pct(a.markupBps)} · ${a.creditDays} credit days`}
        actions={<>
          <Button variant="secondary" icon={<Wallet className="size-4" />} onClick={() => setTopUp(true)}>Add wallet money</Button>
          <Button variant={a.blocked ? "success" : "danger"} busy={busy} icon={a.blocked ? <Unlock className="size-4" /> : <Lock className="size-4" />} onClick={() => act("setAgentBlocked", { agentId: a.id, blocked: !a.blocked }, a.blocked ? "Agent unblocked" : "Agent blocked from booking")}>{a.blocked ? "Unblock" : "Block"}</Button>
        </>} />
      {pos.overdue > 0 && <Callout tone="bad" title="Overdue">{money(pos.overdue)} is past due. New bookings are refused until it's paid.</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Wallet balance" value={money(pos.wallet)} tone="good" />
        <Stat label="Owes us" value={money(Math.max(0, pos.receivable))} tone={pos.receivable > 0 ? "warn" : "default"} />
        <Stat label="Credit available" value={money(pos.available)} hint={`of ${money(a.creditLimit)}`} />
        <Stat label="Bookings" value={theirs.length} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle title="Account statement" subtitle="Receivable — running balance" />
          <Statement lines={st.data.lines} />
        </Card>
        <Card><CardTitle title="Wallet statement" />
          <Statement lines={st.data.wallet.lines} />
        </Card>
      </div>
      <Modal open={topUp} onClose={() => setTopUp(false)} title="Add money to wallet" size="sm" footer={<><Button variant="secondary" onClick={() => setTopUp(false)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("topUpWallet", { agentId: a.id, amount: amount ?? 0, method, reference: ref }, "Wallet topped up"); if (r) { setTopUp(false); setAmount(null); setRef(""); } }}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Amount received"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Received by"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{["bank_transfer", "upi", "card", "netbanking", "cheque", "cash"].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select></Field>
          <Field label="Reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
      </Modal>
      <div className="mt-5"><CommissionsPanel agentId={a.id} /></div>
    </div>
  );
}

export function Statement({ lines }: { lines: StatementLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-ink-500">No entries yet.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-ink-500"><tr><th className="py-1 pr-4">Date</th><th className="pr-4">Details</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
      <tbody className="divide-y divide-line">{[...lines].reverse().map((l, i) => <tr key={i}><td className="py-2 pr-4 align-top whitespace-nowrap">{formatDate(l.date)}</td><td className="py-2 pr-4 align-top">{l.memo}</td><td className="text-right tabular-nums">{l.debit ? money(l.debit) : ""}</td><td className="text-right tabular-nums">{l.credit ? money(l.credit) : ""}</td><td className="text-right font-medium tabular-nums">{money(l.balance)}</td></tr>)}</tbody></table></div>
  );
}

