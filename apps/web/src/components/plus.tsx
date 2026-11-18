import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BadgeCheck, Camera, CheckCircle2, ChevronRight, CreditCard, Download, FileText, Hourglass, MapPin, PhoneMissed, Plus, Send, Sparkles, Stamp, Trash2, Upload } from "lucide-react";
import {
  emiPlan, formatDate, makeDocx, makeXlsx, makeZip, parseDataUrl, type Amendment, type Entity, type FileRow, type PaymentLink, type Quote,
} from "@voyadesk/core";
import { api } from "../lib/api";
import { DOCX_MIME, XLSX_MIME, downloadBytes, downloadDataUrl, humanSize, readFileForUpload } from "../lib/files";
import { money, relTime, titleCase } from "../lib/format";
import { useAction, useList, useReport } from "../lib/hooks";
import { useSession } from "../lib/session";
import { copyText, toast } from "../lib/toast";
import { Badge, Button, Callout, Card, CardTitle, Empty, Field, Input, Modal, MoneyInput, Select, StatusBadge, Textarea, cx } from "./ui";
import { PaymentLinkButton } from "./paylinks";

const linkUrl = (l: PaymentLink) => (l.url.startsWith("#") ? `${window.location.origin}${window.location.pathname}${l.url}` : l.url);

/* ───────────────────────── files ───────────────────────── */

export function FilePicker({ label = "Upload", onFile, busy, accept = "image/*,application/pdf,.doc,.docx", size = "sm" }: { label?: string; onFile: (f: { name: string; mime: string; dataUrl: string }) => void; busy?: boolean; accept?: string; size?: "sm" | "md" }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white font-medium text-ink-800 hover:bg-slate-50", size === "sm" ? "px-2.5 py-1.5 text-sm" : "px-3 py-2 text-sm", busy && "pointer-events-none opacity-60")}>
      <Upload className="size-4" />{busy ? "Uploading…" : label}
      <input type="file" accept={accept} className="sr-only" onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try { onFile(await readFileForUpload(file)); } catch (x) { toast.error(x instanceof Error ? x.message : "Could not read the file."); }
      }} />
    </label>
  );
}

export function FileList({ files, onDelete }: { files: FileRow[]; onDelete?: (f: FileRow) => void }) {
  const { act } = useAction();
  if (!files.length) return <p className="text-sm text-ink-500">No files yet.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="min-w-0"><span className="font-medium">{f.label || f.name}</span><span className="text-ink-500"> · {f.name} · {humanSize(f.size)} · {f.uploadedVia === "customer" ? "uploaded by customer" : f.uploadedVia === "agent" ? "uploaded by agent" : "staff"} · {relTime(f.createdAt)}</span></span>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={async () => { const full = await act<FileRow>("getFile", { fileId: f.id }); if (full) downloadDataUrl(full.name, full.dataUrl); }}>Download</Button>
            {onDelete && <Button size="sm" variant="ghost" aria-label="Delete file" onClick={() => onDelete(f)}><Trash2 className="size-4 text-rose-600" /></Button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ContactDocuments({ contactId }: { contactId: string }) {
  const files = useList("files");
  const { act, busy } = useAction();
  const mine = (files.data ?? []).filter((f) => f.ownerType === "contact" && f.ownerId === contactId);
  return (
    <Card>
      <CardTitle title="Documents" subtitle="Passports, visas, tickets and IDs for this customer and their family" action={<FilePicker busy={busy} onFile={(f) => void act("uploadFile", { ownerType: "contact", ownerId: contactId, ...f, label: f.name.replace(/\.[^.]+$/, "") }, "Document saved")} />} />
      <FileList files={mine} onDelete={(f) => void act("deleteFile", { fileId: f.id }, "File removed")} />
    </Card>
  );
}

/* ───────────────────────── payment links ───────────────────────── */

export { PaymentLinkButton };

/* ───────────────────────── invoice extras: payment link, EMI preview, multi-PAN TCS ───────────────────────── */

export function InvoiceExtras({ invoice }: { invoice: Entity<"invoices"> }) {
  const payers = useList("tcsPayers");
  const links = useList("paymentLinks");
  const { act, busy } = useAction();
  const mine = (payers.data ?? []).filter((p) => p.invoiceId === invoice.id);
  const myLinks = (links.data ?? []).filter((l) => l.invoiceId === invoice.id);
  const [edit, setEdit] = useState(false);
  const [rows, setRows] = useState<{ name: string; pan: string; relation: string; amount: number | null }[]>([]);
  const outstanding = invoice.total - invoice.paid - invoice.credited;
  const sum = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  return (
    <Card>
      <CardTitle title="Collect & comply" subtitle="Online payment links, EMI and TCS split across several PANs" action={outstanding > 0 ? <span className="flex gap-2"><PaymentLinkButton invoiceId={invoice.id} /></span> : undefined} />
      {outstanding > 0 && <p className="mb-3 text-sm text-ink-600">EMI for the balance {money(outstanding)}: {[3, 6, 12].map((m) => `${m} × ${money(emiPlan(outstanding, m, m === 3 ? 0 : 1400).monthly)}`).join(" · ")}</p>}
      {myLinks.length > 0 && <ul className="mb-3 space-y-1 text-sm">{myLinks.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2"><span>{money(l.amount)} via {titleCase(l.provider)} · {relTime(l.createdAt)}{l.emiMonths ? ` · EMI ${l.emiMonths}m` : ""}</span><span className="flex items-center gap-2"><StatusBadge status={l.status} />{l.status === "created" && <Button size="sm" variant="ghost" onClick={() => void copyText(linkUrl(l))}>Copy link</Button>}</span></li>)}</ul>}
      <div className="flex items-center justify-between"><div className="text-sm font-medium">TCS payers (PAN)</div>{invoice.scope === "overseas" && <Button size="sm" variant="secondary" onClick={() => { setRows(mine.length ? mine.map((p) => ({ name: p.name, pan: p.pan, relation: p.relation, amount: p.amount })) : [{ name: invoice.partyName, pan: invoice.pan, relation: "Self", amount: invoice.total }]); setEdit(true); }}>{mine.length ? "Edit split" : "Split across PANs"}</Button>}</div>
      {mine.length === 0 ? <p className="text-sm text-ink-500">{invoice.scope === "overseas" ? "All TCS is reported against one PAN." : "TCS applies to overseas packages only."}</p> : (
        <ul className="mt-1 text-sm">{mine.map((p) => <li key={p.id} className="flex justify-between py-0.5"><span>{p.name} · {p.pan}{p.relation ? ` (${p.relation})` : ""} {p.verified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">format checked</Badge>}</span><span>{money(p.amount)}</span></li>)}</ul>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} size="lg" title="Split TCS across PANs" footer={<><Button variant="secondary" onClick={() => setEdit(false)}>Cancel</Button><Button busy={busy} disabled={sum !== invoice.total} onClick={async () => { const r = await act("setTcsPayers", { invoiceId: invoice.id, payers: rows.map((r) => ({ ...r, amount: r.amount ?? 0 })) }, "PAN split saved"); if (r) setEdit(false); }}>Save</Button></>}>
        <div className="space-y-2">
          {rows.map((r, k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-[1fr_140px_110px_150px_auto]">
              <Input aria-label="Payer name" placeholder="Name" value={r.name} onChange={(e) => setRows(rows.map((x, i) => (i === k ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label="PAN" placeholder="ABCDE1234F" value={r.pan} onChange={(e) => setRows(rows.map((x, i) => (i === k ? { ...x, pan: e.target.value.toUpperCase() } : x)))} />
              <Input aria-label="Relation" placeholder="Relation" value={r.relation} onChange={(e) => setRows(rows.map((x, i) => (i === k ? { ...x, relation: e.target.value } : x)))} />
              <MoneyInput aria-label="Amount" value={r.amount} onChange={(v) => setRows(rows.map((x, i) => (i === k ? { ...x, amount: v } : x)))} />
              <Button variant="ghost" aria-label="Remove" onClick={() => setRows(rows.filter((_, i) => i !== k))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setRows([...rows, { name: "", pan: "", relation: "", amount: Math.max(0, invoice.total - sum) }])}>Add payer</Button>
          <p className={cx("text-sm", sum === invoice.total ? "text-emerald-700" : "text-amber-700")}>Total {money(sum)} of {money(invoice.total)}{sum !== invoice.total ? " — amounts must add up to the invoice total" : ""}</p>
        </div>
      </Modal>
    </Card>
  );
}

/* ───────────────────────── booking extras: amendments, tickets, policies, driver location ───────────────────────── */

export function BookingExtras({ booking }: { booking: Entity<"bookings"> }) {
  const { user } = useSession();
  const amendments = useList("amendments");
  const services = useList("services");
  const flights = useList("flightOrders");
  const policies = useList("policies");
  const assignments = useList("assignments");
  const resources = useList("resources");
  const suppliers = useList("suppliers");
  const { act, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ reason: string; kind: "add" | "change" | "remove"; serviceId: string; type: string; title: string; date: string; netCost: number | null; supplierId: string; sellImpact: number | null; lower: boolean }>({ reason: "", kind: "add", serviceId: "", type: "sightseeing", title: "", date: booking.startDate, netCost: null, supplierId: "", sellImpact: null, lower: false });
  const mine = (amendments.data ?? []).filter((a) => a.bookingId === booking.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const svc = (services.data ?? []).filter((s) => s.bookingId === booking.id && s.status !== "cancelled");
  const fo = (flights.data ?? []).filter((x) => x.bookingId === booking.id);
  const pol = (policies.data ?? []).filter((x) => x.bookingId === booking.id);
  const located = (assignments.data ?? []).filter((a) => a.bookingId === booking.id && a.lastLat !== null);
  const canApprove = user && ["owner", "admin", "accounts"].includes(user.role);
  const canRequest = user && ["owner", "admin", "ops", "sales"].includes(user.role) && !["cancelled", "completed"].includes(booking.status);
  return (
    <>
      {(fo.length > 0 || pol.length > 0 || located.length > 0) && (
        <Card>
          <CardTitle title="Tickets, policies and live status" />
          <ul className="space-y-1.5 text-sm">
            {fo.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2"><span>✈ {x.airline} {x.flightNo} {x.from}→{x.to} · {formatDate(x.departAt.slice(0, 10))} · PNR <b>{x.pnr || "—"}</b>{x.ticketNos.length ? ` · tickets ${x.ticketNos.join(", ")}` : ""}{x.error ? ` · ${x.error}` : ""}</span><StatusBadge status={x.status} /></li>)}
            {pol.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2"><span>🛡 {x.planName} · {x.number} · {x.travellers.length} traveller(s)</span><StatusBadge status={x.status} /></li>)}
            {located.map((a) => { const r = (resources.data ?? []).find((x) => x.id === a.resourceId); return <li key={a.id} className="flex flex-wrap justify-between gap-2"><span><MapPin className="mr-1 inline size-4 text-brand-600" />{r?.name ?? "Driver"} last seen {relTime(a.lastSeenAt)} · <a className="text-brand-700 underline" href={`https://www.google.com/maps?q=${a.lastLat},${a.lastLng}`} target="_blank" rel="noreferrer">open map</a></span><StatusBadge status={a.status} /></li>; })}
          </ul>
        </Card>
      )}
      <Card>
        <CardTitle title="Changes after booking" subtitle="Every change shows its cost impact and needs approval from accounts or the owner" action={canRequest ? <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Request change</Button> : undefined} />
        {mine.length === 0 ? <p className="text-sm text-ink-500">No changes requested.</p> : (
          <ul className="divide-y divide-line text-sm">
            {mine.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{a.number}</b> · {a.reason} · cost {a.costImpact >= 0 ? "+" : "−"}{money(Math.abs(a.costImpact))} · price {a.sellImpact >= 0 ? "+" : "−"}{money(Math.abs(a.sellImpact))} · margin <span className={a.sellImpact - a.costImpact >= 0 ? "text-emerald-700" : "text-rose-700"}>{a.sellImpact - a.costImpact >= 0 ? "+" : "−"}{money(Math.abs(a.sellImpact - a.costImpact))}</span></span>
                <span className="flex items-center gap-2"><StatusBadge status={a.status} />{a.status === "pending" && canApprove && <><Button size="sm" busy={busy} onClick={() => void act("decideAmendment", { amendmentId: a.id, approve: true }, "Change approved and applied")}>Approve</Button><Button size="sm" variant="secondary" busy={busy} onClick={() => { void act("decideAmendment", { amendmentId: a.id, approve: false, note: "Not approved" }, "Change rejected"); }}>Reject</Button></>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Request a change" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} onClick={async () => {
        const sell = (f.sellImpact ?? 0) * (f.lower ? -1 : 1);
        const r = await act("requestAmendment", { bookingId: booking.id, reason: f.reason, sellImpact: sell, changes: [{ kind: f.kind, serviceId: f.kind === "add" ? null : f.serviceId || null, type: f.type, title: f.title, date: f.date, netCost: f.netCost ?? 0, supplierId: f.supplierId || null }] }, "Change sent for approval");
        if (r) setOpen(false);
      }}>Send for approval</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Why is it changing?" required className="sm:col-span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Customer wants a sea-view room" /></Field>
          <Field label="Change"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "add" })}><option value="add">Add a service</option><option value="change">Change a service</option><option value="remove">Remove a service</option></Select></Field>
          {f.kind !== "add" ? <Field label="Service"><Select value={f.serviceId} onChange={(e) => { const s = svc.find((x) => x.id === e.target.value); setF({ ...f, serviceId: e.target.value, title: s?.title ?? "", netCost: s?.netCost ?? null, date: s?.date ?? f.date }); }}><option value="">Select…</option>{svc.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select></Field>
            : <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["hotel", "flight", "transfer", "sightseeing", "activity", "meal", "insurance", "other"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>}
          {f.kind !== "remove" && <Field label="Service name"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>}
          {f.kind !== "remove" && <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
          {f.kind !== "remove" && <Field label={f.kind === "change" ? "New net cost" : "Net cost"}><MoneyInput value={f.netCost} onChange={(v) => setF({ ...f, netCost: v })} /></Field>}
          {f.kind === "add" && <Field label="Supplier"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">— None —</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
          <Field label="Price change to the customer (before GST)"><MoneyInput value={f.sellImpact} onChange={(v) => setF({ ...f, sellImpact: v })} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={f.lower} onChange={(e) => setF({ ...f, lower: e.target.checked })} />Price goes down (credit note)</label>
        </div>
        <Callout tone="info">Margin impact: {money(((f.sellImpact ?? 0) * (f.lower ? -1 : 1)) - (f.kind === "remove" ? -(svc.find((s) => s.id === f.serviceId)?.netCost ?? 0) : f.kind === "change" ? (f.netCost ?? 0) - (svc.find((s) => s.id === f.serviceId)?.netCost ?? 0) : (f.netCost ?? 0)))}</Callout>
      </Modal>
    </>
  );
}

/* ───────────────────────── visa extras: link, uploads, ZIP, passport photo, payment ───────────────────────── */

export function VisaExtras({ visaCase }: { visaCase: Entity<"visaCases"> }) {
  const files = useList("files");
  const { act, busy } = useAction();
  const [app, setApp] = useState(0);
  const [doc, setDoc] = useState(visaCase.applicants[0]?.docs[0]?.name ?? "");
  const [scan, setScan] = useState<string | null>(null);
  const mine = (files.data ?? []).filter((f) => f.ownerType === "visaCase" && f.ownerId === visaCase.id);
  const uploadUrl = `${window.location.origin}${window.location.pathname}#/visa-upload/${api.tenantId}/${visaCase.uploadToken}`;
  const zip = async () => {
    const full = await Promise.all(mine.map((f) => api.action<FileRow>("getFile", { fileId: f.id })));
    const entries = full.map((f) => {
      const who = f.applicantIndex !== null ? visaCase.applicants[f.applicantIndex]?.name ?? "Applicant" : "Case";
      return { name: `${who}/${(f.label || "Document").replace(/[\\/]/g, "-")} - ${f.name}`, data: parseDataUrl(f.dataUrl)?.bytes ?? new Uint8Array() };
    });
    downloadBytes(`${visaCase.number.replace(/\//g, "-")}-documents.zip`, makeZip(entries), "application/zip");
  };
  return (
    <Card>
      <CardTitle title="Documents" subtitle="Customers upload from their phone with the secure link — no login" action={<span className="flex flex-wrap gap-2">{visaCase.fee - visaCase.paid > 0 && <PaymentLinkButton visaCaseId={visaCase.id} label="Fee payment link" />}<Button size="sm" variant="secondary" onClick={() => void copyText(uploadUrl)}>Copy upload link</Button>{mine.length > 0 && <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void zip()}>Download all (ZIP)</Button>}</span>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Applicant"><Select value={app} onChange={(e) => { const i = Number(e.target.value); setApp(i); setDoc(visaCase.applicants[i]?.docs[0]?.name ?? ""); }}>{visaCase.applicants.map((a, i) => <option key={i} value={i}>{a.name || `Applicant ${i + 1}`}</option>)}</Select></Field>
        <Field label="Document"><Select value={doc} onChange={(e) => setDoc(e.target.value)}>{(visaCase.applicants[app]?.docs ?? []).map((d) => <option key={d.name} value={d.name}>{d.received ? "✓ " : ""}{d.name}</option>)}</Select></Field>
        <FilePicker busy={busy} label="Upload for customer" onFile={(f) => void act("uploadFile", { ownerType: "visaCase", ownerId: visaCase.id, applicantIndex: app, label: doc, ...f }, "Document saved and ticked")} />
        <PassportPhotoScan onMrz={setScan} />
      </div>
      {scan && <Callout tone="good" title="Passport machine-readable lines found">
        <pre className="whitespace-pre-wrap break-all font-mono text-xs">{scan}</pre>
        <Button size="sm" className="mt-2" busy={busy} onClick={async () => { const r = await act("scanPassport", { caseId: visaCase.id, applicantIndex: app, mrz: scan }, "Passport details saved"); if (r) setScan(null); }}>Save to {visaCase.applicants[app]?.name || "applicant"}</Button>
      </Callout>}
      <FileList files={mine} onDelete={(f) => void act("deleteFile", { fileId: f.id }, "File removed")} />
    </Card>
  );
}

/** Read the two machine-readable lines at the bottom of a passport photo, entirely in the browser. */
export function PassportPhotoScan({ onMrz }: { onMrz: (mrz: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm font-medium hover:bg-slate-50", busy && "pointer-events-none opacity-60")}>
      <Camera className="size-4" />{busy ? "Reading passport…" : "Scan passport photo"}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setBusy(true);
        try {
          const { readMrzFromImage } = await import("../lib/ocr");
          const mrz = await readMrzFromImage(file);
          if (mrz) onMrz(mrz);
          else toast.error("Couldn't find the passport's bottom two lines. Retake the photo flat, in good light, with the whole page visible.");
        } catch {
          toast.error("The passport photo reader couldn't load here. Type or paste the two lines under the photo with Scan passport instead (the photo reader works in the installed app).");
        } finally {
          setBusy(false);
        }
      }} />
    </label>
  );
}

/* ───────────────────────── quote extras: options, photos, Word ───────────────────────── */

export function QuoteOptionsEditor({ quote }: { quote: Quote }) {
  const { act, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [assign, setAssign] = useState<Record<string, string>>({});
  const start = () => {
    setNames(Object.fromEntries((quote.options.length ? quote.options : [{ key: "A", name: "Option A — Standard" }, { key: "B", name: "Option B — Premium" }]).map((o) => [o.key, o.name])));
    setAssign(Object.fromEntries(quote.lines.map((l) => [l.id, l.option ?? ""])));
    setOpen(true);
  };
  const keys = Object.keys(names);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={start} disabled={quote.status === "accepted"}>{quote.options.length ? `${quote.options.length} options` : "Offer options A/B"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Itinerary options" footer={<>
        {quote.options.length > 0 && <Button variant="secondary" busy={busy} onClick={async () => { const r = await act("setQuoteOptions", { quoteId: quote.id, options: [], lineOptions: Object.fromEntries(quote.lines.map((l) => [l.id, ""])) }, "Options removed"); if (r) setOpen(false); }}>Remove options</Button>}
        <Button busy={busy} onClick={async () => { const r = await act("setQuoteOptions", { quoteId: quote.id, options: keys.map((k) => ({ key: k, name: names[k]! })), lineOptions: assign }, "Options saved"); if (r) setOpen(false); }}>Save options</Button></>}>
        <p className="mb-3 text-sm text-ink-600">Put each service in every option (shared) or in one option only. The customer sees each option's total and picks one.</p>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {keys.map((k) => <Field key={k} label={`Option ${k}`}><Input value={names[k]} onChange={(e) => setNames({ ...names, [k]: e.target.value })} /></Field>)}
          {keys.length < 3 && <Button variant="secondary" className="self-end" onClick={() => { const k = ["A", "B", "C"].find((x) => !keys.includes(x))!; setNames({ ...names, [k]: `Option ${k}` }); }}>Add option</Button>}
        </div>
        <ul className="divide-y divide-line text-sm">
          {quote.lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{l.title}</span>
              <Select aria-label={`Option for ${l.title}`} className="w-auto" value={assign[l.id] ?? ""} onChange={(e) => setAssign({ ...assign, [l.id]: e.target.value })}><option value="">In every option</option>{keys.map((k) => <option key={k} value={k}>Only {names[k]}</option>)}</Select>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

export function DayPhoto({ quote, index, onChange }: { quote: Quote; index: number; onChange: (photoId: string | null) => void }) {
  const files = useList("files");
  const { act, busy } = useAction();
  const day = quote.days[index];
  const photo = day?.photoId ? (files.data ?? []).find((f) => f.id === day.photoId) : undefined;
  return (
    <span className="inline-flex items-center gap-2">
      {photo && <Badge tone="green">Photo: {photo.name}</Badge>}
      <FilePicker accept="image/*" label={photo ? "Change photo" : "Add photo"} busy={busy} onFile={async (f) => {
        const r = await act<{ id: string }>("uploadFile", { ownerType: "quote", ownerId: quote.id, label: `Day ${index + 1}`, ...f }, "Photo added");
        if (r) onChange(r.id);
      }} />
      {photo && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
    </span>
  );
}

export function downloadQuoteWord(quote: Quote, company: string, totals: { total: number; perPerson: number }) {
  const bytes = makeDocx([
    { kind: "title", text: quote.title },
    { kind: "small", text: `${company} · Proposal ${quote.number} · prepared for ${quote.contactName}` },
    { kind: "para", text: `${quote.destination} · ${quote.startDate ? formatDate(quote.startDate) : "dates to be confirmed"} · ${quote.nights}N/${quote.nights + 1}D · ${quote.pax.adults} adults${quote.pax.children ? `, ${quote.pax.children} children` : ""}` },
    { kind: "heading", text: "Day by day" },
    ...quote.days.flatMap((d, i) => [{ kind: "subheading" as const, text: `Day ${i + 1}: ${d.title}` }, { kind: "para" as const, text: d.description }]),
    { kind: "heading", text: "Services" },
    { kind: "table", rows: [["Day", "Service", "Type"], ...quote.lines.filter((l) => !l.optional || l.selected).map((l) => [String(l.day), l.title, titleCase(l.type)])] },
    { kind: "heading", text: "Included" }, ...quote.inclusions.map((x) => ({ kind: "bullet" as const, text: x })),
    { kind: "heading", text: "Not included" }, ...quote.exclusions.map((x) => ({ kind: "bullet" as const, text: x })),
    { kind: "heading", text: "Price" },
    { kind: "para", text: `Total ${money(totals.total)} (${money(totals.perPerson)} per person), including taxes.` },
    { kind: "small", text: quote.terms },
  ]);
  downloadBytes(`${quote.number.replace(/\//g, "-")} ${quote.title}.docx`.replace(/[\\:*?"<>|]/g, ""), bytes, DOCX_MIME);
}

/* ───────────────────────── group departure Excel ───────────────────────── */

export function downloadRoomingList(g: Entity<"groupDepartures">) {
  const bytes = makeXlsx([
    { name: "Rooming list", rows: [["#", "Name", "Phone", "Room", "Paid"], ...g.passengers.map((p, i) => [i + 1, p.name, p.phone, p.room, p.paid ? "Yes" : "No"])] },
    { name: "Summary", rows: [["Departure", g.name], ["Date", g.departureDate], ["Seats", g.seats], ["Booked", g.passengers.length], ["Price per seat (₹)", g.pricePerSeat / 100], ["Paid", g.passengers.filter((p) => p.paid).length]] },
  ]);
  downloadBytes(`${g.name.replace(/[\\/:*?"<>|]/g, "")} rooming list.xlsx`, bytes, XLSX_MIME);
}

/* ───────────────────────── inbox: owner + internal notes ───────────────────────── */

export function ThreadPanel({ phone }: { phone: string }) {
  const threads = useList("chatThreads");
  const users = useList("users");
  const { act, busy } = useAction();
  const [note, setNote] = useState("");
  const t = (threads.data ?? []).find((x) => x.phone === phone);
  const staff = (users.data ?? []).filter((u) => u.active && !["agent", "driver"].includes(u.role));
  return (
    <div className="space-y-2 border-t border-line bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-500">Owner</span>
        <Select aria-label="Conversation owner" className="w-auto" value={t?.ownerId ?? ""} onChange={(e) => void act("assignThread", { phone, ownerId: e.target.value || null }, "Conversation assigned")}><option value="">Unassigned</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <Button size="sm" variant="ghost" onClick={() => void act("setThreadStatus", { phone, status: t?.status === "closed" ? "open" : "closed" }, t?.status === "closed" ? "Reopened" : "Closed")}>{t?.status === "closed" ? "Reopen" : "Close chat"}</Button>
      </div>
      {(t?.notes ?? []).length > 0 && <ul className="space-y-1">{t!.notes.map((n, i) => <li key={i} className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900"><b>{n.byName}</b> · {relTime(n.at)}: {n.body}</li>)}</ul>}
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; const r = await act("addThreadNote", { phone, body: note }, "Note added"); if (r) setNote(""); }}>
        <Input aria-label="Internal note" placeholder="Internal note (customer doesn't see this)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary" busy={busy} icon={<Send className="size-4" />}>Note</Button>
      </form>
    </div>
  );
}

/* ───────────────────────── dashboard: what needs attention now ───────────────────────── */

export function AttentionPanel() {
  const { user } = useSession();
  const calls = useList("calls");
  const amendments = useList("amendments");
  const outbox = useList("outbox");
  const holds = useList("holds");
  const visa = useList("visaCases");
  const files = useList("files");
  const tasks = useList("tasks");
  const items = useMemo(() => {
    const out: { tone: "red" | "amber" | "blue"; count: number; text: string; cta: string; to: string; icon: ReactNode }[] = [];
    const s = (n: number) => (n > 1 ? "s" : "");
    const missed = (calls.data ?? []).filter((c) => c.status === "missed" && c.callbackTaskId && !(tasks.data ?? []).find((t) => t.id === c.callbackTaskId)?.done);
    if (missed.length) out.push({ tone: "red", count: missed.length, text: `missed call${s(missed.length)} waiting for a call-back`, cta: "Call back", to: "/app/calls", icon: <PhoneMissed /> });
    const failed = (outbox.data ?? []).filter((o) => o.status === "failed");
    if (failed.length) out.push({ tone: "red", count: failed.length, text: `message${s(failed.length)} failed to send`, cta: "Retry", to: "/app/messages", icon: <AlertTriangle /> });
    const pending = (amendments.data ?? []).filter((a: Amendment) => a.status === "pending");
    if (pending.length) out.push({ tone: "amber", count: pending.length, text: `booking change${s(pending.length)} waiting for approval`, cta: "Review", to: "/app/approvals", icon: <BadgeCheck /> });
    const held = (holds.data ?? []).filter((h) => h.status === "held");
    if (held.length) out.push({ tone: "amber", count: held.length, text: `customer${held.length > 1 ? "s are" : " is"} holding a proposal — follow up before it expires`, cta: "Follow up", to: "/app/quotes", icon: <Hourglass /> });
    const drafts = (outbox.data ?? []).filter((o) => o.status === "draft");
    if (drafts.length) out.push({ tone: "blue", count: drafts.length, text: `AI follow-up draft${s(drafts.length)} to review`, cta: "Review", to: "/app/messages", icon: <Sparkles /> });
    const uploads = (files.data ?? []).filter((f) => f.ownerType === "visaCase" && f.uploadedVia === "customer" && Date.now() - new Date(f.createdAt).getTime() < 3 * 86_400_000);
    if (uploads.length) out.push({ tone: "blue", count: uploads.length, text: `visa document${s(uploads.length)} uploaded by customers to review`, cta: "Check", to: "/app/visa", icon: <FileText /> });
    const ready = (visa.data ?? []).filter((v) => v.status === "docs_received");
    if (ready.length) out.push({ tone: "blue", count: ready.length, text: `visa case${s(ready.length)} ready to submit`, cta: "Submit", to: "/app/visa", icon: <Stamp /> });
    return out;
  }, [calls.data, amendments.data, outbox.data, holds.data, visa.data, files.data, tasks.data]);
  if (!user || ["agent", "driver"].includes(user.role)) return null;
  const tone = { red: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-600", blue: "bg-brand-50 text-brand-600" } as const;
  return (
    <section aria-labelledby="attn-title">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 id="attn-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">Needs attention{items.length > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white tabular-nums">{items.length}</span>}</h2>
        <span className="text-xs text-ink-500">The few things to act on right now</span>
      </div>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-white px-4 py-3.5">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-5" /></span>
          <div><div className="text-sm font-semibold text-emerald-900">All clear. Nothing urgent.</div><div className="text-xs text-emerald-800/70">New calls, approvals and customer uploads will show up here.</div></div>
        </div>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{items.map((x, i) => (
          <li key={i}>
            <Link to={x.to} className="group flex h-full items-center gap-3 rounded-xl border border-line bg-white p-3 shadow-card transition hover:-translate-y-px hover:border-line-strong hover:shadow-lift">
              <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", tone[x.tone])}>{x.icon}</span>
              <span className="min-w-0 flex-1 text-sm leading-5 text-ink-700"><span className="mr-1 text-base font-semibold tabular-nums text-ink-900">{x.count}</span>{x.text}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-700 opacity-80 group-hover:opacity-100">{x.cta}<ChevronRight className="size-3.5" /></span>
            </Link>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

export function DeliveryChip() {
  const r = useReport<{ provider: { messaging: string; sandbox: boolean }; waiting: number }>("messaging", {});
  if (!r.data) return null;
  return r.data.provider.sandbox ? <Badge tone="cyan">Sandbox delivery</Badge> : r.data.provider.messaging === "none" ? <Badge tone="amber">WhatsApp/email not connected · {r.data.waiting} waiting</Badge> : <Badge tone="green">Live: {r.data.provider.messaging}</Badge>;
}

export { FileText, Textarea };
