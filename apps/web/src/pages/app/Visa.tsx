import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, Copy, Plus, ScanLine } from "lucide-react";
import { RecordTrail } from "../../components/RecordTrail";
import { VISA_FLOW, formatDate, type VisaCase, type VisaStatus } from "@voyadesk/core";
import { useAction, useList, useOne } from "../../lib/hooks";
import { money, titleCase } from "../../lib/format";
import { Badge, Button, Callout, Card, CardTitle, ErrorNote, Field, Input, KeyValue, Loading, Modal, PageHeader, Select, StatusBadge, Textarea } from "../../components/ui";
import { ActivityFeed } from "./Dashboard";
import { api } from "../../lib/api";
import { copyText } from "../../lib/toast";
import { VisaExtras } from "../../components/plus";

const BOARD: VisaStatus[] = ["docs_pending", "docs_received", "submitted", "in_process", "approved", "rejected"];

export function NewVisaModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (v: VisaCase) => void }) {
  const masters = useList("visaMasters");
  const { act, busy } = useAction();
  const [f, setF] = useState({ contactName: "", phone: "", email: "", country: "", travelDate: "", applicants: "" });
  useEffect(() => { if (open) setF({ contactName: "", phone: "", email: "", country: "", travelDate: "", applicants: "" }); }, [open]);
  const countries = [...new Set((masters.data ?? []).map((m) => m.country))];
  return (
    <Modal open={open} onClose={onClose} title="New visa case" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={async () => {
      const applicants = f.applicants.split("\n").map((s) => s.trim()).filter(Boolean);
      const r = await act<VisaCase>("createVisaCase", { contactName: f.contactName, phone: f.phone, email: f.email, country: f.country, travelDate: f.travelDate || null, applicants: applicants.length ? applicants : [f.contactName] }, (v) => `${v.number} opened with the ${v.country} checklist`);
      if (r) { onClose(); onCreated?.(r); }
    }}>Create case</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name" required><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Country" required><Select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">Choose…</option>{countries.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Travel date"><Input type="date" value={f.travelDate} onChange={(e) => setF({ ...f, travelDate: e.target.value })} /></Field>
        <Field label="Applicants" hint="One name per line (defaults to the customer)" className="sm:col-span-2"><Textarea value={f.applicants} onChange={(e) => setF({ ...f, applicants: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function VisaPage() {
  const q = useList("visaCases");
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Visa desk" subtitle="Checklists, passport scans and status updates — a customer update is queued at every step." actions={<Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: "1" })}>New visa case</Button>} />
      {q.error && !q.data ? <ErrorNote message={q.error.message} /> : !q.data ? <Loading /> : (
        <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-3 sm:mx-0 sm:px-0">
          {BOARD.map((st) => {
            const col = q.data!.filter((v) => v.status === st);
            return (
              <div key={st} className="w-64 shrink-0 rounded-xl bg-slate-100/70 p-2">
                <div className="mb-2 flex items-center justify-between px-1.5 pt-1"><span className="text-sm font-semibold">{titleCase(st)}</span><Badge>{col.length}</Badge></div>
                <div className="space-y-2">{col.map((v) => {
                  const total = v.applicants.reduce((a, x) => a + x.docs.length, 0);
                  const got = v.applicants.reduce((a, x) => a + x.docs.filter((d) => d.received).length, 0);
                  return (
                    <Link key={v.id} to={`/app/visa/${v.id}`} className="block rounded-xl border border-line bg-white p-3 shadow-xs hover:border-brand-300">
                      <div className="font-medium">{v.contactName}</div>
                      <div className="text-xs text-ink-500">{v.number} · {v.country} · {v.applicants.length} pax</div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${total ? (got / total) * 100 : 0}%` }} /></div>
                      <div className="mt-1 text-xs text-ink-500">{got}/{total} documents{v.travelDate ? ` · travel ${formatDate(v.travelDate)}` : ""}</div>
                    </Link>
                  );
                })}{col.length === 0 && <div className="py-6 text-center text-xs text-ink-400">Empty</div>}</div>
              </div>
            );
          })}
        </div>
      )}
      <NewVisaModal open={params.get("new") === "1"} onClose={() => setParams({})} onCreated={(v) => nav(`/app/visa/${v.id}`)} />
    </div>
  );
}

const SAMPLE_MRZ = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";

export function VisaDetailPage() {
  const { id } = useParams();
  const q = useOne("visaCases", id);
  const acts = useList("activities");
  const { act, busy } = useAction();
  const [scanFor, setScanFor] = useState<number | null>(null);
  const [mrz, setMrz] = useState("");
  const [next, setNext] = useState<VisaStatus | "">("");
  const [note, setNote] = useState("");
  if (q.error) return <ErrorNote message={q.error.message} />;
  if (!q.data) return <Loading />;
  const v = q.data;
  const options = VISA_FLOW[v.status];
  const uploadLink = `${window.location.origin}${window.location.pathname}#/visa-status/${api.tenantId || "demo"}`;
  return (
    <div>
      <PageHeader back={{ to: "/app/visa", label: "Visa desk" }} title={<span className="flex items-center gap-2">{v.number}<StatusBadge status={v.status} /></span>} subtitle={`${v.contactName} · ${v.country} ${v.visaType}`} />
      <RecordTrail anchor={{ kind: "visa", contactId: v.contactId, phone: v.phone, email: v.email }} current="contact" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {v.applicants.map((a, i) => {
            const got = a.docs.filter((d) => d.received).length;
            return (
              <Card key={i}>
                <CardTitle title={a.name} subtitle={`${got} of ${a.docs.length} documents · passport ${a.passportNo || "not scanned"}${a.expiry ? ` (expires ${formatDate(a.expiry)})` : ""}`}
                  action={<Button size="sm" variant="secondary" icon={<ScanLine className="size-4" />} onClick={() => { setScanFor(i); setMrz(""); }}>Scan passport</Button>} />
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {a.docs.map((d) => (
                    <li key={d.name}><button className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => act("markVisaDoc", { caseId: v.id, applicantIndex: i, docName: d.name, received: !d.received })}>
                      {d.received ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-4 shrink-0 text-ink-300" />}<span className={d.received ? "text-ink-500" : ""}>{d.name}</span>
                    </button></li>
                  ))}
                </ul>
              </Card>
            );
          })}
          <VisaExtras visaCase={v} />
          <Card><CardTitle title="History" /><ActivityFeed items={(acts.data ?? []).filter((x) => x.visaCaseId === v.id).sort((x, y) => (x.at < y.at ? 1 : -1))} /></Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardTitle title="Case" />
            <KeyValue items={[["Country", v.country], ["Visa", v.visaType], ["Travel date", formatDate(v.travelDate)], ["Fee", money(v.fee)], ["Phone", v.phone || "—"], ["Agent case", v.agentId ? "Yes" : "No"]]} />
            {v.decisionNote && <Callout tone={v.status === "rejected" ? "bad" : "good"}>{v.decisionNote}</Callout>}
          </Card>
          {options.length > 0 && (
            <Card>
              <CardTitle title="Move case forward" subtitle="A WhatsApp update is queued for the customer." />
              <div className="space-y-3">
                <Select aria-label="Next status" value={next} onChange={(e) => setNext(e.target.value as VisaStatus)}><option value="">Choose next step…</option>{options.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</Select>
                {(next === "rejected" || next === "approved") && <Textarea aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={next === "rejected" ? "Reason to share with the customer (required)" : "Note, e.g. e-visa number"} />}
                <Button className="w-full" busy={busy} disabled={!next} onClick={async () => { const r = await act("advanceVisaCase", { caseId: v.id, status: next, note: note || undefined }, "Status updated; customer update queued"); if (r) { setNext(""); setNote(""); } }}>Update status</Button>
              </div>
            </Card>
          )}
          <Card>
            <CardTitle title="Customer links" />
            <p className="text-sm text-ink-600">Status tracker (customer enters {v.number} and their phone):</p>
            <div className="mt-2 flex gap-2"><Input readOnly value={uploadLink} aria-label="Tracker link" /><Button variant="secondary" aria-label="Copy" onClick={() => void copyText(uploadLink)}><Copy className="size-4" /></Button></div>
          </Card>
        </div>
      </div>
      <Modal open={scanFor !== null} onClose={() => setScanFor(null)} title="Scan passport (MRZ)" footer={<><Button variant="secondary" onClick={() => setScanFor(null)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act<{ warnings: string[] }>("scanPassport", { caseId: v.id, applicantIndex: scanFor ?? 0, mrz }, (x) => (x.warnings.length ? `Passport read. Warning: ${x.warnings[0]}` : "Passport read — all check digits valid")); if (r) setScanFor(null); }}>Read passport</Button></>}>
        <div className="space-y-3 text-sm">
          <p>Type or paste the two lines at the bottom of the passport photo page. With an OCR provider connected, a photo fills this in automatically.</p>
          <Textarea className="font-mono text-xs" rows={3} value={mrz} onChange={(e) => setMrz(e.target.value.toUpperCase())} placeholder="P<IND…" aria-label="MRZ lines" />
          <button className="text-xs text-brand-700 hover:underline" onClick={() => setMrz(SAMPLE_MRZ)}>Use the ICAO specimen passport to try it</button>
        </div>
      </Modal>
    </div>
  );
}
