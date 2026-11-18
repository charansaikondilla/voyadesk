import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, RotateCcw } from "lucide-react";
import { BUSINESS_TYPES, INDIAN_STATES, isValidGstin, MODULES, ROLES, type ModuleKey, type Settings } from "@voyadesk/core";
import { api, LocalApi } from "../../lib/api";
import { invalidate, useAction, useList, useMutation } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { formatDate, ROLE_LABEL, titleCase } from "../../lib/format";
import { ResourcePage } from "../../components/ResourcePage";
import { Button, Callout, Card, CardTitle, Confirm, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, Toggle } from "../../components/ui";
import { AutomationSettings, IntegrationsPanel } from "./Plus";

type Tab = "company" | "team" | "modules" | "tax" | "routing" | "integrations" | "data";

const MODULE_INFO: Record<ModuleKey, string> = {
  sales: "Leads, pipeline, customers, tasks", itinerary: "Quote & itinerary builder, proposals", operations: "Bookings, vouchers, drivers & guides",
  finance: "Invoices, payments, payables, ledger, GST/TCS", marketing: "Campaigns, segments, drips, landing pages, coupons",
  b2b: "Agent portal, slabs, wallet & credit", visa: "Visa cases, masters, passport scan", ai: "AI quote generator, lead qualification", portals: "Storefront, visa tracker, booking engines",
};

function CompanyTab({ s }: { s: Settings }) {
  const m = useMutation();
  const { refresh } = useSession();
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const gstinBad = v.gstin !== "" && !isValidGstin(v.gstin);
  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" required error={m.fieldErrors["companyName"]}><Input value={v.companyName} onChange={(e) => setV({ ...v, companyName: e.target.value })} /></Field>
        <Field label="Legal name"><Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} /></Field>
        <Field label="GSTIN" error={gstinBad ? "GSTIN should be 15 characters, e.g. 27AABCS1234D1Z5" : undefined}><Input value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></Field>
        <Field label="State (for CGST/SGST vs IGST)"><Select value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })}>{INDIAN_STATES.map((st) => <option key={st}>{st}</option>)}</Select></Field>
        <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="Default markup %"><Input type="number" step="0.5" value={v.defaultMarkupBps / 100} onChange={(e) => setV({ ...v, defaultMarkupBps: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></Field>
        <Field label="Brand colour"><div className="flex gap-2"><input type="color" aria-label="Brand colour" value={v.brandColor} onChange={(e) => setV({ ...v, brandColor: e.target.value })} className="h-10 w-14 rounded border border-line" /><Input value={v.brandColor} onChange={(e) => setV({ ...v, brandColor: e.target.value })} /></div></Field>
        <Field label="Invoice prefix"><Input value={v.invoicePrefix} onChange={(e) => setV({ ...v, invoicePrefix: e.target.value })} /></Field>
        <Field label="Quote prefix"><Input value={v.quotePrefix} onChange={(e) => setV({ ...v, quotePrefix: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-end"><Button busy={m.busy} disabled={gstinBad} onClick={async () => { const r = await m.run(() => api.update("settings", s.id, { companyName: v.companyName, legalName: v.legalName, gstin: v.gstin, state: v.state, phone: v.phone, email: v.email, address: v.address, defaultMarkupBps: v.defaultMarkupBps, brandColor: v.brandColor, invoicePrefix: v.invoicePrefix, quotePrefix: v.quotePrefix }), "Company details saved"); if (r) await refresh(); }}>Save</Button></div>
    </Card>
  );
}

function TeamTab() {
  const { act, busy } = useAction();
  const agents = useList("agents");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState("");
  const [role, setRole] = useState("sales");
  const [agentId, setAgentId] = useState("");
  return (
    <>
      <ResourcePage embedded collection="users" title="Team" singular="Person" search={(u) => `${u.name} ${u.email} ${u.role}`} defaults={{ role: "sales", active: true }}
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "phone", label: "Phone", type: "phone" },
          { name: "title", label: "Job title", type: "text" },
          { name: "role", label: "Role", type: "select", options: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r]! })) },
          { name: "agentId", label: "Agency (for B2B agent logins)", type: "ref", ref: "agents" },
          { name: "resourceId", label: "Driver/guide record (for field-app logins)", type: "ref", ref: "resources" },
          { name: "active", label: "Active", type: "toggle" },
        ]}
        columns={[
          { key: "name", header: "Person", render: (u) => <span><span className="font-medium">{u.name}</span><span className="block text-xs text-ink-500">{u.email}</span></span>, sort: (u) => u.name },
          { key: "role", header: "Role", render: (u) => ROLE_LABEL[u.role] },
          { key: "active", header: "Status", render: (u) => <StatusBadge status={u.active ? "active" : "inactive"} /> },
        ]} />
      <div className="mt-3"><Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Invite many at once</Button></div>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite your team" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} onClick={async () => {
        const users = rows.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((p) => p[0] && p[1]).map(([name, email]) => ({ name, email, role, agentId: role === "agent" ? agentId || null : null }));
        const r = await act<{ created: unknown[]; skipped: string[] }>("inviteUsers", { users }, (x) => `${x.created.length} invited${x.skipped.length ? `, ${x.skipped.length} already existed` : ""}`);
        if (r) { setOpen(false); setRows(""); }
      }}>Send invites</Button></>}>
        <div className="space-y-3">
          <Field label="One person per line: Name, email" hint="Paste from a spreadsheet. Everyone gets the role below; change it per person later."><Textarea rows={6} value={rows} onChange={(e) => setRows(e.target.value)} placeholder={"Asha Rao, asha@agency.in\nVikram Shah, vikram@agency.in"} /></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
          {role === "agent" && <Field label="Agency"><Select value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">Choose…</option>{(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
          {api.mode === "server" && <Callout tone="info">After inviting, set each person's first password from their row (or connect your email provider to send invite links).</Callout>}
        </div>
      </Modal>
    </>
  );
}

function ModulesTab({ s }: { s: Settings }) {
  const m = useMutation();
  const { refresh } = useSession();
  const save = async (patch: Partial<Settings>) => { const r = await m.run(() => api.update("settings", s.id, patch), "Saved"); if (r) await refresh(); };
  return (
    <div className="space-y-5">
      <Card>
        <CardTitle title="Business types" subtitle="Used for defaults and the setup guide." />
        <div className="flex flex-wrap gap-4">{BUSINESS_TYPES.map((b) => <Toggle key={b} checked={s.businessTypes.includes(b)} onChange={(on) => save({ businessTypes: on ? [...s.businessTypes, b] : s.businessTypes.filter((x) => x !== b).length ? s.businessTypes.filter((x) => x !== b) : s.businessTypes })} label={{ b2c: "B2C agency", b2b_dmc: "B2B / DMC", portal: "Travel portal", visa: "Visa business" }[b]} />)}</div>
      </Card>
      <Card>
        <CardTitle title="Modules" subtitle="Switch off what you don't use — the menu gets simpler for everyone." />
        <div className="divide-y divide-line">{MODULES.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 py-3">
            <div><div className="font-medium">{titleCase(k === "b2b" ? "B2B" : k === "ai" ? "AI & automation" : k)}</div><div className="text-sm text-ink-500">{MODULE_INFO[k]}</div></div>
            <Toggle checked={Boolean(s.modules[k])} onChange={(on) => save({ modules: { ...s.modules, [k]: on } })} />
          </div>
        ))}</div>
      </Card>
    </div>
  );
}

function DataTab() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  if (!(api instanceof LocalApi)) return <Card><p className="text-sm text-ink-600">Your data is stored in your PostgreSQL database. Back it up with your database provider's tools.</p></Card>;
  const localApi = api;
  return (
    <Card>
      <CardTitle title="Demo data" subtitle="The demo keeps its data in this browser." />
      <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setConfirm(true)}>Reset demo to fresh sample data</Button>
      <Confirm open={confirm} onClose={() => setConfirm(false)} danger busy={busy} title="Reset the demo?" confirmLabel="Reset" message="All changes you made in this browser are replaced by fresh sample data dated around today."
        onConfirm={async () => { setBusy(true); await localApi.reset(); await refresh(); invalidate(); setBusy(false); setConfirm(false); }} />
    </Card>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "company";
  const { settings } = useSession();
  const users = useList("users");
  if (!settings) return null;
  return (
    <div>
      <PageHeader title="Settings" subtitle={settings.companyName} />
      <Tabs tabs={[{ key: "company", label: "Company" }, { key: "team", label: "Team & roles" }, { key: "modules", label: "Modules" }, { key: "tax", label: "Tax rules" }, { key: "routing", label: "Lead routing" }, { key: "integrations", label: "Payments & integrations" }, { key: "data", label: "Data" }]} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "company" && <CompanyTab s={settings} />}
      {tab === "team" && <TeamTab />}
      {tab === "modules" && <ModulesTab s={settings} />}
      {tab === "tax" && (
        <div className="space-y-5">
          <Callout tone="warn">Rates change with each Budget. Add a new dated rule instead of editing an old one, so past invoices keep their rate. Confirm with your chartered accountant.</Callout>
          <ResourcePage embedded collection="taxRules" title="GST rules" singular="GST rule" search={(r) => r.appliesTo} defaults={{ appliesTo: "package", scope: "*", rateBps: 500, basis: "cost_plus_markup", effectiveFrom: new Date().toISOString().slice(0, 10) }}
            fields={[
              { name: "appliesTo", label: "Applies to", type: "select", options: [{ value: "package", label: "Tour package (gross price)" }, { value: "*", label: "Any service (service fee)" }, ...["hotel", "flight", "transfer", "sightseeing", "visa"].map((s) => ({ value: s, label: titleCase(s) }))] },
              { name: "scope", label: "Scope", type: "select", options: [{ value: "*", label: "Domestic and overseas" }, { value: "domestic", label: "Domestic" }, { value: "overseas", label: "Overseas" }] },
              { name: "rateBps", label: "GST rate", type: "percent" },
              { name: "basis", label: "Charged on", type: "select", options: [{ value: "cost_plus_markup", label: "Full price" }, { value: "markup_only", label: "Markup / service fee only" }] },
              { name: "sac", label: "SAC code", type: "text" },
              { name: "effectiveFrom", label: "From", type: "date", required: true },
              { name: "effectiveTo", label: "To (blank = still in force)", type: "date", nullable: true },
              { name: "note", label: "Note", type: "text", span: 2 },
            ]}
            columns={[
              { key: "a", header: "Applies to", render: (r) => (r.appliesTo === "*" ? "Any service" : titleCase(r.appliesTo)) },
              { key: "r", header: "Rate", render: (r) => `${r.rateBps / 100}% on ${r.basis === "markup_only" ? "fee" : "full price"}` },
              { key: "d", header: "In force", render: (r) => `${formatDate(r.effectiveFrom)} → ${r.effectiveTo ? formatDate(r.effectiveTo) : "now"}` },
            ]} />
          <ResourcePage embedded collection="tcsRules" title="TCS rules (overseas packages)" singular="TCS rule" search={(r) => r.note} defaults={{ effectiveFrom: new Date().toISOString().slice(0, 10), thresholdMinor: null, rateBelowBps: 200, rateAboveBps: 200, noPanRateBps: 500 }}
            fields={[
              { name: "effectiveFrom", label: "From", type: "date", required: true },
              { name: "effectiveTo", label: "To (blank = still in force)", type: "date", nullable: true },
              { name: "thresholdMinor", label: "Threshold per buyer per FY (blank = none)", type: "money", nullable: true },
              { name: "rateBelowBps", label: "Rate up to threshold", type: "percent" },
              { name: "rateAboveBps", label: "Rate above threshold", type: "percent" },
              { name: "noPanRateBps", label: "Rate without PAN", type: "percent", nullable: true },
              { name: "note", label: "Note", type: "text", span: 2 },
            ]}
            columns={[
              { key: "d", header: "In force", render: (r) => `${formatDate(r.effectiveFrom)} → ${r.effectiveTo ? formatDate(r.effectiveTo) : "now"}` },
              { key: "r", header: "Rate", render: (r) => (r.thresholdMinor === null ? `${r.rateBelowBps / 100}% flat` : `${r.rateBelowBps / 100}% then ${r.rateAboveBps / 100}%`) },
              { key: "n", header: "Note", render: (r) => r.note, hideOnMobile: true },
            ]} />
        </div>
      )}
      {tab === "routing" && (
        <ResourcePage embedded collection="routingRules" title="Lead routing" singular="Routing rule" search={(r) => r.name} defaults={{ service: "any", destination: "", assigneeIds: [], active: true }}
          fields={[
            { name: "name", label: "Rule name", type: "text", required: true },
            { name: "service", label: "Service", type: "select", options: ["any", "holiday", "visa", "flight", "hotel", "transfer"].map((s) => ({ value: s, label: titleCase(s) })) },
            { name: "destination", label: "Destination (blank = any)", type: "text" },
            { name: "assigneeIds", label: "Assign to (rotates through them in turn)", type: "multiref", ref: "users", refFilter: (u) => Boolean(u["active"]) && !["agent", "driver"].includes(String(u["role"])), refLabel: (u) => `${String(u["name"])} (${ROLE_LABEL[String(u["role"])] ?? ""})` },
            { name: "active", label: "Active", type: "toggle" },
          ]}
          columns={[
            { key: "n", header: "Rule", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "m", header: "Matches", render: (r) => `${titleCase(r.service)}${r.destination ? ` · ${r.destination}` : ""}` },
            { key: "a", header: "Assigns to", render: (r) => r.assigneeIds.map((id) => users.data?.find((u) => u.id === id)?.name ?? id).join(", ") },
            { key: "s", header: "", render: (r) => <StatusBadge status={r.active ? "active" : "inactive"} /> },
          ]} />
      )}
      {tab === "integrations" && <div className="space-y-5"><AutomationSettings s={settings} /><IntegrationsPanel /></div>}
      {tab === "data" && <DataTab />}
    </div>
  );
}
