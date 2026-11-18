import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, CreditCard, FileUp, Hotel, Lock, LogOut, Plane, ShieldCheck, Upload } from "lucide-react";
import { addDays, formatDate, isoDate } from "@voyadesk/core";
import { api, ApiError } from "../../lib/api";
import { downloadDataUrl, humanSize, readFileForUpload } from "../../lib/files";
import { money, titleCase } from "../../lib/format";
import { useLang } from "../../lib/i18n";
import { Badge, Button, Callout, Card, ErrorNote, Field, Input, Loading, Select, StatusBadge, Textarea, cx } from "../../components/ui";
import { ContactFields, SiteShell, useCompany } from "./PublicChrome";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/* ───────────────────────── customer portal: my trips ───────────────────────── */

interface Portal {
  company: { name: string; phone: string; email: string; brandColor: string };
  me: { name: string; phone: string; email: string; trips: number };
  wallet: number;
  bookings: { id: string; number: string; title: string; destination: string; startDate: string; endDate: string; status: string; pax: { adults: number; children: number }; services: { id: string; type: string; title: string; date: string; status: string; voucherNo: string; confirmationNo: string }[]; flights: { flightNo: string; from: string; to: string; departAt: string; pnr: string; status: string }[]; invoice: { id: string; number: string; total: number; paid: number; outstanding: number; dueDate: string } | null }[];
  visas: { id: string; number: string; country: string; visaType: string; status: string; uploadToken: string; decisionNote: string; missing: string[] }[];
  policies: { id: string; number: string; planName: string; from: string; to: string; status: string; travellers: number }[];
  claims: { id: string; number: string; type: string; amount: number; status: string; decisionNote: string }[];
  documents: { id: string; name: string; label: string; size: number; mime: string; createdAt: string }[];
  proposals: { number: string; title: string; total: number; token: string; validUntil: string | null }[];
  openLinks: { token: string; amount: number; url: string }[];
}

const SESSION = "voyadesk.portal";
const loadToken = () => { try { return window.localStorage.getItem(SESSION); } catch { return null; } };
const saveToken = (t: string | null) => { try { if (t) window.localStorage.setItem(SESSION, t); else window.localStorage.removeItem(SESSION); } catch { /* memory only */ } };

export function CustomerPortalPage() {
  const { tenantId = "demo" } = useParams();
  const { store } = useCompany();
  const { t } = useLang();
  const [token, setToken] = useState<string | null>(loadToken);
  const [data, setData] = useState<Portal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ demoCode?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [claimFor, setClaimFor] = useState<string | null>(null);

  const refresh = (tok = token) => {
    if (!tok) return;
    api.publicAction<Portal>(tenantId, "customerPortal", { token: tok }).then(setData, (e) => { setErr(errText(e, "Please sign in again.")); setToken(null); saveToken(null); setData(null); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [token, tenantId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try { await fn(); } catch (e) { setErr(errText(e, "Something went wrong. Please try again.")); } finally { setBusy(null); }
  };

  if (!token || !data) {
    return (
      <SiteShell store={store}>
        <div className="mx-auto max-w-sm px-4 py-10">
          <Card>
            <h1 className="text-xl font-semibold">{t("myTrips")}</h1>
            <p className="mt-1 text-sm text-ink-600">Bookings, vouchers, payments, visa and insurance in one place.</p>
            {err && <div className="mt-3"><Callout tone="bad">{err}</Callout></div>}
            {!sent ? (
              <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void run("send", async () => { setSent(await api.publicAction(tenantId, "customerRequestCode", { login })); }); }}>
                <Field label={t("phoneOrEmail")} required><Input required value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></Field>
                <Button type="submit" className="w-full" busy={busy === "send"}>{t("sendCode")}</Button>
              </form>
            ) : (
              <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void run("verify", async () => { const r = await api.publicAction<{ token: string }>(tenantId, "customerVerify", { login, code }); saveToken(r.token); setToken(r.token); }); }}>
                <p className="text-sm text-ink-600">If {login} is on our records, a code is on its way.</p>
                {sent.demoCode && <Callout tone="info">Demo: your code is <b>{sent.demoCode}</b> (on a live account it arrives by WhatsApp or email).</Callout>}
                <Field label={t("enterCode")} required><Input required inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" /></Field>
                <Button type="submit" className="w-full" busy={busy === "verify"}>{t("signIn")}</Button>
                <button type="button" className="w-full text-sm text-brand-700 underline" onClick={() => { setSent(null); setCode(""); }}>Use a different number</button>
              </form>
            )}
            {api.mode === "demo" && !sent && <p className="mt-3 text-xs text-ink-500">Demo customer: try <b>neha.k@example.com</b> or <b>+91 99000 70003</b>.</p>}
          </Card>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell store={store}>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h1 className="text-2xl font-semibold">Hi {data.me.name.split(" ")[0]}</h1><p className="text-sm text-ink-600">{data.me.phone} · {data.me.email}</p></div>
          <div className="flex items-center gap-2">
            {data.wallet > 0 && <Badge tone="green">{t("wallet")}: {money(data.wallet)}</Badge>}
            <Button variant="secondary" size="sm" icon={<LogOut className="size-4" />} onClick={() => { void api.publicAction(tenantId, "customerLogout", { token }); saveToken(null); setToken(null); setData(null); }}>{t("signOut")}</Button>
          </div>
        </div>
        {err && <Callout tone="bad">{err}</Callout>}
        {data.proposals.map((p) => <Callout key={p.token} tone="info"><Link className="underline" to={`/p/${tenantId}/${p.token}`}>Proposal {p.number}: {p.title} — {money(p.total)}</Link>{p.validUntil ? ` · valid until ${formatDate(p.validUntil)}` : ""}</Callout>)}
        {data.bookings.length === 0 && <Card><p className="text-sm text-ink-600">No bookings yet.</p></Card>}
        {data.bookings.map((b) => (
          <Card key={b.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><div className="text-xs text-ink-500">{b.number}</div><h2 className="text-lg font-semibold">{b.title}</h2><div className="text-sm text-ink-600">{formatDate(b.startDate)} – {formatDate(b.endDate)} · {b.pax.adults + b.pax.children} travellers</div></div>
              <StatusBadge status={b.status} />
            </div>
            <ul className="mt-3 divide-y divide-line text-sm">
              {b.services.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{s.title}</span><span className="text-ink-500"> · {formatDate(s.date)}{s.confirmationNo ? ` · ref ${s.confirmationNo}` : ""}</span></span>
                  <span className="flex items-center gap-2">{s.voucherNo ? <Badge tone="green">Voucher {s.voucherNo}</Badge> : <StatusBadge status={s.status} />}</span>
                </li>
              ))}
            </ul>
            {b.flights.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{b.flights.map((f) => <Badge key={f.pnr + f.flightNo} tone="cyan"><Plane className="size-3" />{f.flightNo} {f.from}→{f.to} · PNR {f.pnr || "pending"}</Badge>)}</div>}
            {b.invoice && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                <span>Invoice {b.invoice.number}: {money(b.invoice.total)} · paid {money(b.invoice.paid)}{b.invoice.outstanding > 0 ? ` · due ${formatDate(b.invoice.dueDate)}` : ""}</span>
                {b.invoice.outstanding > 0 && <Button size="sm" busy={busy === b.id} onClick={() => void run(b.id, async () => { const l = await api.publicAction<{ url: string }>(tenantId, "customerPayInvoice", { token, invoiceId: b.invoice!.id }); if (l.url.startsWith("#")) window.location.hash = l.url.slice(1); else window.location.href = l.url; })}>{t("payBalance")} {money(b.invoice.outstanding)}</Button>}
              </div>
            )}
          </Card>
        ))}
        {data.visas.length > 0 && (
          <Card>
            <h2 className="mb-2 font-semibold">Visa applications</h2>
            {data.visas.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm first:border-0">
                <span>{v.country} {v.visaType} · {v.number}{v.missing.length ? <span className="text-amber-700"> · {v.missing.length} document{v.missing.length > 1 ? "s" : ""} missing</span> : ""}{v.decisionNote ? ` · ${v.decisionNote}` : ""}</span>
                <span className="flex items-center gap-2"><StatusBadge status={v.status} />{v.missing.length > 0 && <Link to={`/visa-upload/${tenantId}/${v.uploadToken}`} className="text-brand-700 underline">{t("upload")}</Link>}</span>
              </div>
            ))}
          </Card>
        )}
        {data.policies.length > 0 && (
          <Card>
            <h2 className="mb-2 font-semibold">{t("insurance")}</h2>
            {data.policies.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm first:border-0">
                <span><ShieldCheck className="mr-1 inline size-4 text-emerald-600" />{p.planName} · {p.number} · {formatDate(p.from)} – {formatDate(p.to)}</span>
                <span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.status === "issued" && <Button size="sm" variant="secondary" onClick={() => setClaimFor(p.id)}>Make a claim</Button>}</span>
              </div>
            ))}
            {data.claims.length > 0 && <div className="mt-2 space-y-1 text-sm">{data.claims.map((c) => <div key={c.id} className="flex justify-between"><span>{t("claims")} {c.number} · {titleCase(c.type)} · {money(c.amount)}{c.decisionNote ? ` · ${c.decisionNote}` : ""}</span><StatusBadge status={c.status} /></div>)}</div>}
            {claimFor && <ClaimForm tenantId={tenantId} token={token} policyId={claimFor} onDone={() => { setClaimFor(null); refresh(); }} />}
          </Card>
        )}
        <Card>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">{t("documents")}</h2><UploadButton label={t("upload")} onFile={(f) => run("doc", async () => { await api.publicAction(tenantId, "customerUpload", { token, ...f, label: f.name }); refresh(); })} busy={busy === "doc"} /></div>
          {data.documents.length === 0 ? <p className="text-sm text-ink-500">Keep passport copies and visas here so we always have them.</p> : (
            <ul className="divide-y divide-line text-sm">{data.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2"><span>{d.label || d.name} <span className="text-ink-400">· {humanSize(d.size)}</span></span><Button size="sm" variant="ghost" onClick={() => void run(d.id, async () => { const f = await api.publicAction<{ name: string; dataUrl: string }>(tenantId, "customerFile", { token, fileId: d.id }); downloadDataUrl(f.name, f.dataUrl); })}>Download</Button></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </SiteShell>
  );
}

function UploadButton({ label, onFile, busy, accept = "image/*,application/pdf" }: { label: string; onFile: (f: { name: string; mime: string; dataUrl: string }) => void; busy?: boolean; accept?: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50", busy && "opacity-60")}>
        <Upload className="size-4" />{busy ? "Uploading…" : label}
        <input type="file" accept={accept} className="sr-only" disabled={busy} onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setErr(null);
          try { onFile(await readFileForUpload(file)); } catch (x) { setErr(x instanceof Error ? x.message : "Could not read the file."); }
        }} />
      </label>
      {err && <span className="mt-1 text-xs text-rose-600">{err}</span>}
    </span>
  );
}

function ClaimForm({ tenantId, token, policyId, onDone }: { tenantId: string; token: string; policyId: string; onDone: () => void }) {
  const [f, setF] = useState({ type: "medical", amount: "", description: "" });
  const [file, setFile] = useState<{ name: string; mime: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="mt-3 space-y-3 rounded-xl border border-line p-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        await api.publicAction(tenantId, "customerClaim", { token, policyId, type: f.type, amount: Math.round(Number(f.amount) * 100), description: f.description, file: file ?? undefined });
        onDone();
      } catch (x) { setErr(errText(x, "Claim not sent.")); } finally { setBusy(false); }
    }}>
      {err && <Callout tone="bad">{err}</Callout>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened?"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["medical", "baggage", "cancellation", "delay", "other"].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select></Field>
        <Field label="Amount (₹)" required><Input required type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      </div>
      <Field label="Details" required><Textarea required minLength={10} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="flex items-center justify-between gap-2"><UploadButton label={file ? file.name : "Attach bill or report"} onFile={setFile} /><Button type="submit" busy={busy}>Send claim</Button></div>
    </form>
  );
}

/* ───────────────────────── visa document upload (no login) ───────────────────────── */

interface VisaUploadInfo {
  company: { name: string; brandColor: string; phone: string };
  number: string; country: string; visaType: string; status: string; closed: boolean;
  applicants: { index: number; name: string; docs: { name: string; received: boolean; uploaded: string[] }[] }[];
}

export function VisaUploadPage() {
  const { tenantId = "demo", token = "" } = useParams();
  const [info, setInfo] = useState<VisaUploadInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.publicAction<VisaUploadInfo>(tenantId, "visaUploadInfo", { token }).then(setInfo, (e) => setErr(errText(e, "This link could not be opened.")));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [tenantId, token]);
  if (err && !info) return <div className="mx-auto max-w-md p-6"><ErrorNote message={err} /></div>;
  if (!info) return <Loading label="Opening your checklist…" />;
  const done = info.applicants.reduce((a, x) => a + x.docs.filter((d) => d.received).length, 0);
  const total = info.applicants.reduce((a, x) => a + x.docs.length, 0);
  return (
    <div className="min-h-full bg-canvas">
      <header className="text-white" style={{ background: info.company.brandColor }}><div className="mx-auto max-w-2xl px-4 py-3 font-semibold">{info.company.name}</div></header>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div><h1 className="text-2xl font-semibold">{info.country} visa documents</h1><p className="text-sm text-ink-600">Application {info.number} · {info.visaType} · {done} of {total} received</p></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        {info.closed && <Callout tone="info">This application has been submitted. Contact us on {info.company.phone} to change documents.</Callout>}
        {err && <Callout tone="bad">{err}</Callout>}
        {info.applicants.map((a) => (
          <Card key={a.index}>
            <h2 className="mb-2 font-semibold">{a.name}</h2>
            <ul className="divide-y divide-line">
              {a.docs.map((d) => (
                <li key={d.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex items-center gap-2">{d.received ? <CheckCircle2 className="size-4 text-emerald-600" /> : <FileUp className="size-4 text-amber-600" />}<span>{d.name}{d.uploaded.length ? <span className="text-ink-400"> · {d.uploaded.join(", ")}</span> : ""}</span></span>
                  {!info.closed && <UploadButton label={d.received ? "Replace" : "Upload"} busy={busy === `${a.index}:${d.name}`} onFile={async (f) => {
                    setBusy(`${a.index}:${d.name}`);
                    setErr(null);
                    try { await api.publicAction(tenantId, "visaUpload", { token, applicantIndex: a.index, docName: d.name, ...f }); await load(); } catch (x) { setErr(errText(x, "Upload failed.")); } finally { setBusy(null); }
                  }} />}
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <p className="text-center text-xs text-ink-500">Photos and PDFs up to 8 MB. Files go only to {info.company.name}'s visa desk.</p>
      </div>
    </div>
  );
}

/* ───────────────────────── booking engines on the website ───────────────────────── */

const airportHint = "3-letter code, e.g. BOM";

interface Offer { id: string; airlineName: string; flightNo: string; from: string; to: string; departAt: string; arriveAt: string; durationMin: number; stops: number; baggage: string; refundable: boolean; seatsLeft: number; sell: number; sandbox: boolean }

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function FlightsSitePage() {
  const { store, tenantId } = useCompany();
  const { t } = useLang();
  const nav = useNavigate();
  const [q, setQ] = useState({ from: "BOM", to: "DXB", date: addDays(isoDate(new Date()), 14), adults: 1, children: 0, cabin: "economy" as const });
  const [res, setRes] = useState<{ offers: Offer[]; sandbox: boolean } | null>(null);
  const [pick, setPick] = useState<Offer | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [pax, setPax] = useState<{ name: string; dob: string; gender: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const travellers = q.adults + q.children;
  return (
    <SiteShell store={store}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("flights")}</h1>
        <Card>
          <form className="grid gap-3 sm:grid-cols-6" onSubmit={async (e) => {
            e.preventDefault();
            setBusy("search"); setErr(null); setPick(null);
            try { setRes(await api.publicAction(tenantId, "publicFlightSearch", q)); } catch (x) { setErr(errText(x, "Search failed.")); setRes(null); } finally { setBusy(null); }
          }}>
            <Field label={t("from")} hint={airportHint}><Input required maxLength={3} value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value.toUpperCase() })} /></Field>
            <Field label={t("to")}><Input required maxLength={3} value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value.toUpperCase() })} /></Field>
            <Field label={t("date")}><Input required type="date" value={q.date} min={isoDate(new Date())} onChange={(e) => setQ({ ...q, date: e.target.value })} /></Field>
            <Field label={t("adults")}><Input type="number" min={1} max={9} value={q.adults} onChange={(e) => setQ({ ...q, adults: Number(e.target.value) || 1 })} /></Field>
            <Field label={t("children")}><Input type="number" min={0} max={8} value={q.children} onChange={(e) => setQ({ ...q, children: Number(e.target.value) || 0 })} /></Field>
            <div className="flex items-end"><Button type="submit" className="w-full" busy={busy === "search"} icon={<Plane className="size-4" />}>{t("search")}</Button></div>
          </form>
        </Card>
        {err && <Callout tone="bad">{err}</Callout>}
        {res?.sandbox && <Callout tone="info">Demo fares from the sandbox — not real airline availability. Live fares appear once a flight supplier (e.g. Amadeus) is connected.</Callout>}
        {res && res.offers.length === 0 && <Callout tone="warn">{t("noResults")}</Callout>}
        {res && !pick && <div className="space-y-2">{res.offers.map((o) => (
          <Card key={o.id} className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="font-medium">{o.airlineName} · {o.flightNo}</div><div className="text-sm text-ink-600">{time(o.departAt)} {o.from} → {time(o.arriveAt)} {o.to} · {Math.floor(o.durationMin / 60)}h {o.durationMin % 60}m · {o.stops ? `${o.stops} ${t("stop")}` : t("nonStop")}</div><div className="text-xs text-ink-500">{o.baggage}{o.refundable ? " · refundable" : ""} · {o.seatsLeft} {t("seatsLeft")}</div></div>
            <div className="text-right"><div className="text-xl font-semibold">{money(o.sell)}</div><Button size="sm" onClick={() => { setPick(o); setPax(Array.from({ length: travellers }, () => ({ name: "", dob: "", gender: "M" }))); }}>{t("bookNow")}</Button></div>
          </Card>
        ))}</div>}
        {pick && (
          <Card>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              setBusy("book"); setErr(null);
              try {
                const r = await api.publicAction<{ token: string }>(tenantId, "publicFlightQuote", { offerId: pick.id, query: q, contact, passengers: pax.map((p) => `${p.name.trim()}|${p.dob}|${p.gender}`) });
                nav(`/p/${tenantId}/${r.token}`);
              } catch (x) { setErr(errText(x, "Could not book this fare.")); } finally { setBusy(null); }
            }}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{pick.airlineName} {pick.flightNo} · {pick.from}→{pick.to} · {formatDate(pick.departAt.slice(0, 10))}</div><div className="text-lg font-semibold">{money(pick.sell)}</div></div>
              <div className="text-sm font-medium">{t("passengers")}</div>
              {pax.map((p, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[1fr_170px_110px]">
                  <Input required aria-label={`Traveller ${k + 1} name`} placeholder={`Traveller ${k + 1}`} value={p.name} onChange={(e) => setPax(pax.map((x, i) => (i === k ? { ...x, name: e.target.value } : x)))} />
                  <Input required type="date" aria-label={t("dob")} value={p.dob} max={isoDate(new Date())} onChange={(e) => setPax(pax.map((x, i) => (i === k ? { ...x, dob: e.target.value } : x)))} />
                  <Select aria-label="Gender" value={p.gender} onChange={(e) => setPax(pax.map((x, i) => (i === k ? { ...x, gender: e.target.value } : x)))}><option value="M">Male</option><option value="F">Female</option></Select>
                </div>
              ))}
              <ContactFields value={contact} onChange={setContact} />
              <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setPick(null)}>Back</Button><Button type="submit" busy={busy === "book"} className="ml-auto">{t("continue")}</Button></div>
            </form>
          </Card>
        )}
      </div>
    </SiteShell>
  );
}

interface HotelResult { hotelId: string; hotel: string; city: string; country: string; stars: number; roomType: string; mealPlan: string; roomsLeft: number | null; instant: boolean; sell: number; description: string }

export function HotelsSitePage() {
  const { store, tenantId } = useCompany();
  const { t } = useLang();
  const nav = useNavigate();
  const [q, setQ] = useState({ city: "Goa", checkIn: addDays(isoDate(new Date()), 20), nights: 3, rooms: 1, adults: 2, children: 0 });
  const [res, setRes] = useState<HotelResult[] | null>(null);
  const [pick, setPick] = useState<HotelResult | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <SiteShell store={store}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("hotels")}</h1>
        <Card>
          <form className="grid gap-3 sm:grid-cols-6" onSubmit={async (e) => {
            e.preventDefault();
            setBusy("search"); setErr(null); setPick(null);
            try { setRes(await api.publicAction(tenantId, "publicHotelSearch", q)); } catch (x) { setErr(errText(x, "Search failed.")); setRes(null); } finally { setBusy(null); }
          }}>
            <Field label={t("city")}><Input required value={q.city} onChange={(e) => setQ({ ...q, city: e.target.value })} /></Field>
            <Field label={t("checkIn")}><Input required type="date" min={isoDate(new Date())} value={q.checkIn} onChange={(e) => setQ({ ...q, checkIn: e.target.value })} /></Field>
            <Field label={t("nights")}><Input type="number" min={1} max={30} value={q.nights} onChange={(e) => setQ({ ...q, nights: Number(e.target.value) || 1 })} /></Field>
            <Field label={t("rooms")}><Input type="number" min={1} max={10} value={q.rooms} onChange={(e) => setQ({ ...q, rooms: Number(e.target.value) || 1 })} /></Field>
            <Field label={t("adults")}><Input type="number" min={1} max={20} value={q.adults} onChange={(e) => setQ({ ...q, adults: Number(e.target.value) || 1 })} /></Field>
            <div className="flex items-end"><Button type="submit" className="w-full" busy={busy === "search"} icon={<Hotel className="size-4" />}>{t("search")}</Button></div>
          </form>
        </Card>
        {err && <Callout tone="bad">{err}</Callout>}
        {res && res.length === 0 && <Callout tone="warn">{t("noResults")}</Callout>}
        {res && !pick && <div className="grid gap-3 sm:grid-cols-2">{res.map((h) => (
          <Card key={`${h.hotelId}${h.roomType}${h.mealPlan}`}>
            <div className="flex items-start justify-between gap-2"><div><div className="font-medium">{h.hotel}</div><div className="text-sm text-ink-600">{"★".repeat(h.stars)} · {h.roomType} · {h.mealPlan}</div></div>{h.instant ? <Badge tone="green">{t("instant")}</Badge> : <Badge>{t("onRequest")}</Badge>}</div>
            <div className="mt-2 flex items-end justify-between"><div className="text-xs text-ink-500">{h.roomsLeft !== null ? `${h.roomsLeft} ${t("roomsLeft")}` : ""}</div><div className="text-right"><div className="text-xl font-semibold">{money(h.sell)}</div><Button size="sm" onClick={() => setPick(h)}>{t("bookNow")}</Button></div></div>
          </Card>
        ))}</div>}
        {pick && (
          <Card>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              setBusy("book"); setErr(null);
              try {
                const r = await api.publicAction<{ token: string }>(tenantId, "publicHotelQuote", { hotelId: pick.hotelId, roomType: pick.roomType, mealPlan: pick.mealPlan, checkIn: q.checkIn, nights: q.nights, rooms: q.rooms, adults: q.adults, children: q.children, contact });
                nav(`/p/${tenantId}/${r.token}`);
              } catch (x) { setErr(errText(x, "Could not book these rooms.")); } finally { setBusy(null); }
            }}>
              <div className="flex flex-wrap justify-between gap-2"><div className="font-medium">{pick.hotel} · {pick.roomType} ({pick.mealPlan}) · {q.nights} nights from {formatDate(q.checkIn)}</div><div className="text-lg font-semibold">{money(pick.sell)}</div></div>
              <ContactFields value={contact} onChange={setContact} />
              <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setPick(null)}>Back</Button><Button type="submit" busy={busy === "book"} className="ml-auto">{t("continue")}</Button></div>
            </form>
          </Card>
        )}
      </div>
    </SiteShell>
  );
}

interface SeriesRow { id: string; airline: string; flightNo: string; from: string; to: string; departDate: string; departTime: string; arriveTime: string; returnDate: string | null; returnFlightNo: string; seatsLeft: number; sellFare: number; baggage: string }

export function SeriesSitePage() {
  const { store, tenantId } = useCompany();
  const { t } = useLang();
  const nav = useNavigate();
  const [rows, setRows] = useState<SeriesRow[] | null>(null);
  const [pick, setPick] = useState<SeriesRow | null>(null);
  const [seats, setSeats] = useState(1);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.publicAction<SeriesRow[]>(tenantId, "publicSeries", {}).then(setRows, (e) => setErr(errText(e, "Could not load fares."))); }, [tenantId]);
  return (
    <SiteShell store={store}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("series")}</h1>
        {err && <Callout tone="bad">{err}</Callout>}
        {!rows ? <Loading /> : rows.length === 0 ? <Callout>{t("noResults")}</Callout> : !pick ? (
          <div className="grid gap-3 sm:grid-cols-2">{rows.map((r) => (
            <Card key={r.id}>
              <div className="flex justify-between"><div className="font-medium">{r.from} → {r.to}</div><Badge tone={r.seatsLeft < 5 ? "red" : "green"}>{r.seatsLeft} {t("seatsLeft")}</Badge></div>
              <div className="text-sm text-ink-600">{r.airline} {r.flightNo} · {formatDate(r.departDate)} {r.departTime}–{r.arriveTime}{r.returnDate ? ` · return ${formatDate(r.returnDate)}` : ""}</div>
              <div className="text-xs text-ink-500">{r.baggage}</div>
              <div className="mt-2 flex items-end justify-between"><div className="text-xl font-semibold">{money(r.sellFare)} <span className="text-xs font-normal text-ink-500">{t("perPerson")}</span></div><Button size="sm" onClick={() => setPick(r)}>{t("bookNow")}</Button></div>
            </Card>
          ))}</div>
        ) : (
          <Card>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true); setErr(null);
              try { const r = await api.publicAction<{ token: string }>(tenantId, "publicSeriesQuote", { seriesId: pick.id, seats, contact }); nav(`/p/${tenantId}/${r.token}`); } catch (x) { setErr(errText(x, "Could not hold these seats.")); } finally { setBusy(false); }
            }}>
              <div className="font-medium">{pick.from} → {pick.to} · {formatDate(pick.departDate)} · {money(pick.sellFare)} {t("perPerson")}</div>
              <Field label="Seats"><Input type="number" min={1} max={Math.min(9, pick.seatsLeft)} value={seats} onChange={(e) => setSeats(Number(e.target.value) || 1)} /></Field>
              <ContactFields value={contact} onChange={setContact} />
              <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setPick(null)}>Back</Button><Button type="submit" busy={busy} className="ml-auto">{t("continue")}</Button></div>
            </form>
          </Card>
        )}
      </div>
    </SiteShell>
  );
}

interface PlanRow { id: string; name: string; insurer: string; region: string; sumInsured: number; maxAge: number; benefits: string[]; premium: number | null }

export function InsuranceSitePage() {
  const { store, tenantId } = useCompany();
  const { t } = useLang();
  const nav = useNavigate();
  const [trip, setTrip] = useState({ from: addDays(isoDate(new Date()), 14), to: addDays(isoDate(new Date()), 20), destination: "Dubai" });
  const [people, setPeople] = useState([{ name: "", dob: "" }]);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [pick, setPick] = useState<PlanRow | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.publicAction<PlanRow[]>(tenantId, "publicInsurancePlans", { from: trip.from, to: trip.to, travellers: people.length }).then(setPlans, (e) => setErr(errText(e, "Could not load plans."))); }, [tenantId, trip.from, trip.to, people.length]);
  return (
    <SiteShell store={store}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("insurance")}</h1>
        <Card>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Destination"><Input value={trip.destination} onChange={(e) => setTrip({ ...trip, destination: e.target.value })} /></Field>
            <Field label="Start"><Input type="date" min={isoDate(new Date())} value={trip.from} onChange={(e) => setTrip({ ...trip, from: e.target.value })} /></Field>
            <Field label="End"><Input type="date" min={trip.from} value={trip.to} onChange={(e) => setTrip({ ...trip, to: e.target.value })} /></Field>
            <Field label="Travellers"><Input type="number" min={1} max={9} value={people.length} onChange={(e) => { const n = Math.max(1, Math.min(9, Number(e.target.value) || 1)); setPeople(Array.from({ length: n }, (_, i) => people[i] ?? { name: "", dob: "" })); }} /></Field>
          </div>
        </Card>
        {err && <Callout tone="bad">{err}</Callout>}
        {!plans ? <Loading /> : !pick ? (
          <div className="grid gap-3 sm:grid-cols-3">{plans.map((p) => (
            <Card key={p.id}>
              <div className="font-medium">{p.name}</div><div className="text-xs text-ink-500">{p.insurer} · {titleCase(p.region)} · up to age {p.maxAge}</div>
              <ul className="mt-2 space-y-0.5 text-sm">{p.benefits.slice(0, 4).map((b) => <li key={b} className="flex gap-1.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />{b}</li>)}</ul>
              <div className="mt-3 flex items-end justify-between"><div className="text-xl font-semibold">{p.premium !== null ? money(p.premium) : "—"}</div><Button size="sm" onClick={() => setPick(p)}>{t("bookNow")}</Button></div>
            </Card>
          ))}</div>
        ) : (
          <Card>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true); setErr(null);
              try { const r = await api.publicAction<{ token: string }>(tenantId, "publicInsuranceQuote", { planId: pick.id, ...trip, travellers: people.map((p) => ({ name: p.name, dob: p.dob || null })), contact }); nav(`/p/${tenantId}/${r.token}`); } catch (x) { setErr(errText(x, "Could not price this plan.")); } finally { setBusy(false); }
            }}>
              <div className="font-medium">{pick.name} · {formatDate(trip.from)} – {formatDate(trip.to)}</div>
              {people.map((p, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[1fr_180px]">
                  <Input required aria-label={`Traveller ${k + 1}`} placeholder={`Traveller ${k + 1} name`} value={p.name} onChange={(e) => setPeople(people.map((x, i) => (i === k ? { ...x, name: e.target.value } : x)))} />
                  <Input required type="date" aria-label={t("dob")} max={isoDate(new Date())} value={p.dob} onChange={(e) => setPeople(people.map((x, i) => (i === k ? { ...x, dob: e.target.value } : x)))} />
                </div>
              ))}
              <ContactFields value={contact} onChange={setContact} />
              <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setPick(null)}>Back</Button><Button type="submit" busy={busy} className="ml-auto">{t("continue")}</Button></div>
            </form>
          </Card>
        )}
      </div>
    </SiteShell>
  );
}
