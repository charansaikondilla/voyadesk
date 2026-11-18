import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, Check, CheckCircle2, Lock, MapPin, Phone, Users } from "lucide-react";
import { formatDate, type Entity } from "@voyadesk/core";
import { api, ApiError, type PublicStore } from "../../lib/api";
import { money, titleCase } from "../../lib/format";
import { Button, Callout, Card, ErrorNote, Field, Input, Loading, StatusBadge, Tabs, Textarea, cx } from "../../components/ui";
import { BookPackageForm, SiteShell, useCampaign } from "./PublicChrome";

export { ProposalPage } from "./Proposal";

function StoreShell({ store, children }: { store: PublicStore | null; children: ReactNode }) {
  return <SiteShell store={store}>{children}</SiteShell>;
}

function useStore() {
  const { tenantId = "demo" } = useParams();
  const [store, setStore] = useState<PublicStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.publicStore(tenantId).then(setStore, (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load")); }, [tenantId]);
  return { store, error, tenantId };
}

export function StorePage() {
  const { store, error, tenantId } = useStore();
  const [theme, setTheme] = useState("");
  return (
    <StoreShell store={store}>
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">Holiday packages</h1>
        <p className="mt-1 text-ink-600">Handpicked trips with hotels, transfers and sightseeing. Ask for a custom quote anytime.</p>
        {error && <div className="mt-4"><ErrorNote message={error} /></div>}
        {!store ? <Loading /> : <>
          <div className="mt-5 flex flex-wrap gap-2">{["", ...new Set(store.packages.map((p) => p.theme))].map((t) => <button key={t || "all"} onClick={() => setTheme(t)} className={cx("rounded-full px-3 py-1 text-sm", theme === t ? "bg-ink-900 text-white" : "border border-line bg-white")}>{t ? titleCase(t) : "All"}</button>)}</div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {store.packages.filter((p) => !theme || p.theme === theme).map((p) => (
              <Link key={p.id} to={`/store/${tenantId}/package/${p.id}`} className="group overflow-hidden rounded-2xl border border-line bg-white shadow-xs transition hover:shadow-md">
                <div className="flex h-28 items-end bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-white"><div><div className="text-xs uppercase tracking-wide opacity-80">{p.destination}</div><div className="text-lg font-semibold">{p.name}</div></div></div>
                <div className="p-4">
                  <div className="text-sm text-ink-600">{p.nights} nights · {titleCase(p.theme)}</div>
                  <ul className="mt-2 space-y-0.5 text-sm">{p.highlights.slice(0, 3).map((h) => <li key={h} className="flex gap-1.5"><Check className="mt-0.5 size-4 text-emerald-600" />{h}</li>)}</ul>
                  <div className="mt-3 text-sm">From <span className="text-lg font-semibold">{money(p.startingPrice)}</span> <span className="text-ink-500">per person</span></div>
                </div>
              </Link>
            ))}
          </div>
          {store.groups.length > 0 && (
            <div className="mt-10">
              <h2 className="text-xl font-semibold">Group departures</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{store.groups.map((g) => <Card key={g.id}><div className="font-medium">{g.name}</div><div className="text-sm text-ink-600">{formatDate(g.departureDate)} · {g.seatsLeft} seats left · {money(g.pricePerSeat)} per seat</div></Card>)}</div>
            </div>
          )}
        </>}
      </section>
    </StoreShell>
  );
}

export function EnquiryForm({ tenantId, packageId, landingSlug, color }: { tenantId: string; packageId?: string; landingSlug?: string; color?: string }) {
  const campaignId = useCampaign();
  const [f, setF] = useState({ name: "", phone: "", email: "", travelDate: "", adults: "2", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (done) return <Callout tone="good" title="Thank you!">A travel expert will call you shortly. Your reference: <b>{done}</b>.</Callout>;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        const r = await api.publicAction<{ reference: string }>(tenantId, "storefrontEnquiry", { packageId: packageId ?? null, landingSlug, name: f.name, phone: f.phone, email: f.email || undefined, travelDate: f.travelDate || null, adults: Number(f.adults) || 1, message: f.message || undefined, campaignId: campaignId ?? undefined });
        setDone(r.reference);
      } catch (x) {
        setErr(x instanceof ApiError ? x.message : "Could not send");
      } finally {
        setBusy(false);
      }
    }}>
      {err && <Callout tone="bad">{err}</Callout>}
      <Field label="Name" required><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Phone" required><Input required type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Travel date"><Input type="date" value={f.travelDate} onChange={(e) => setF({ ...f, travelDate: e.target.value })} /></Field><Field label="Adults"><Input type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} /></Field></div>
      <Field label="Anything else?"><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
      <Button type="submit" busy={busy} className="w-full" style={color ? { background: color } : undefined}>Get my quote</Button>
    </form>
  );
}

function PackageSide({ tenantId, pkg, color }: { tenantId: string; pkg: Entity<"packages">; color: string }) {
  const [tab, setTab] = useState<"book" | "ask">("book");
  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <Tabs tabs={[{ key: "book", label: "Book online" }, { key: "ask", label: "Ask an expert" }]} value={tab} onChange={setTab} />
      <div className="mt-4">{tab === "book" ? <BookPackageForm packageId={pkg.id} nights={pkg.nights} color={color} startingPrice={pkg.startingPrice} /> : <EnquiryForm tenantId={tenantId} packageId={pkg.id} color={color} />}</div>
    </Card>
  );
}

export function StorePackagePage() {
  const { store, error, tenantId } = useStore();
  const { id } = useParams();
  const p: Entity<"packages"> | undefined = store?.packages.find((x) => x.id === id);
  return (
    <StoreShell store={store}>
      <section className="mx-auto max-w-5xl px-4 py-8">
        {error && <ErrorNote message={error} />}
        {!store ? <Loading /> : !p ? <ErrorNote message="This package is no longer available." /> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div>
              <Link to={`/store/${tenantId}`} className="text-sm text-brand-700 hover:underline">← All packages</Link>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{p.name}</h1>
              <p className="text-ink-600">{p.destination}, {p.country} · {p.nights} nights · from {money(p.startingPrice)} per person</p>
              <ol className="mt-6 space-y-4">{p.days.map((d, i) => <li key={i} className="flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{i + 1}</span><div><div className="font-medium">{d.title}</div><p className="text-sm text-ink-600">{d.description}</p></div></li>)}</ol>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Card><h2 className="mb-2 font-semibold">Included</h2><ul className="space-y-1 text-sm">{p.inclusions.map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 text-emerald-600" />{x}</li>)}</ul></Card>
                <Card><h2 className="mb-2 font-semibold">Not included</h2><ul className="space-y-1 text-sm text-ink-600">{p.exclusions.map((x) => <li key={x}>– {x}</li>)}</ul></Card>
              </div>
            </div>
            <PackageSide tenantId={tenantId} pkg={p} color={store.company.brandColor} />
          </div>
        )}
      </section>
    </StoreShell>
  );
}

export function VisaTrackerPage() {
  const { tenantId = "demo" } = useParams();
  const [f, setF] = useState({ number: "", phone: "" });
  const [res, setRes] = useState<{ number: string; country: string; visaType: string; status: string; applicants: number; missingDocs: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = ["docs_pending", "docs_received", "submitted", "in_process", "approved"];
  return (
    <div className="min-h-full bg-canvas px-4 py-10">
      <div className="mx-auto max-w-md">
        <h1 className="text-center text-2xl font-semibold">Track your visa</h1>
        <p className="mt-1 text-center text-sm text-ink-500">Enter the file number we sent you and your phone number.</p>
        <Card className="mt-6">
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { setRes(await api.publicAction(tenantId, "visaStatus", f)); } catch (x) { setRes(null); setErr(x instanceof ApiError ? x.message : "Not found"); } finally { setBusy(false); } }}>
            <Field label="File number"><Input required placeholder="VISA/2026-27/0001" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
            <Field label="Phone"><Input required type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Button type="submit" busy={busy} className="w-full">Check status</Button>
            {api.mode === "demo" && <p className="text-xs text-ink-500">Demo: try VISA/2026-27/0001 with +91 99000 10002.</p>}
          </form>
        </Card>
        {err && <div className="mt-4"><ErrorNote message={err} /></div>}
        {res && (
          <Card className="mt-4">
            <div className="flex items-center justify-between"><div className="font-semibold">{res.country} · {res.visaType}</div><StatusBadge status={res.status} /></div>
            <div className="text-sm text-ink-500">{res.number} · {res.applicants} applicant{res.applicants > 1 ? "s" : ""}</div>
            <ol className="mt-4 space-y-2">{steps.map((s) => { const reached = res.status === "delivered" || steps.indexOf(res.status) >= steps.indexOf(s); return <li key={s} className="flex items-center gap-2 text-sm">{reached ? <CheckCircle2 className="size-5 text-emerald-600" /> : <span className="size-5 rounded-full border-2 border-line" />}<span className={reached ? "" : "text-ink-400"}>{titleCase(s)}</span></li>; })}</ol>
            {res.status === "rejected" && <div className="mt-3"><Callout tone="bad">The application was not approved. Your consultant will share the reason and next steps.</Callout></div>}
            {res.missingDocs.length > 0 && <div className="mt-3"><Callout tone="warn" title="Documents still needed">{res.missingDocs.join("; ")}</Callout></div>}
          </Card>
        )}
      </div>
    </div>
  );
}

export function LandingPage() {
  const { tenantId = "demo", slug = "" } = useParams();
  const [lp, setLp] = useState<Entity<"landingPages"> | null | undefined>(undefined);
  const [store, setStore] = useState<PublicStore | null>(null);
  useEffect(() => {
    api.publicStore(tenantId).then((st) => { setStore(st); setLp(st.landingPages.find((r) => r.slug === slug) ?? null); }, () => setLp(null));
  }, [tenantId, slug]);
  if (lp === undefined) return <Loading />;
  if (!lp) return <div className="mx-auto max-w-lg p-6"><ErrorNote message="This offer page is not available." /></div>;
  const pkg = store?.packages.find((p) => p.id === lp.packageId);
  return (
    <div className="min-h-full bg-white">
      <section className="bg-gradient-to-br from-brand-600 to-violet-700 px-4 py-14 text-white">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1fr_360px]">
          <div><div className="text-sm opacity-80">{store?.company.name}</div><h1 className="mt-2 text-4xl font-semibold leading-tight">{lp.headline || lp.title}</h1><p className="mt-3 text-lg opacity-90">{lp.body}</p>
            {pkg && <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm">{pkg.nights} nights · from {money(pkg.startingPrice)} per person</div>}</div>
          <Card className="text-ink-900"><h2 className="mb-3 font-semibold">Get the offer</h2><EnquiryForm tenantId={tenantId} packageId={lp.packageId ?? undefined} landingSlug={lp.slug} /></Card>
        </div>
      </section>
      {pkg && <section className="mx-auto max-w-5xl px-4 py-10"><h2 className="text-xl font-semibold">What's included</h2><ul className="mt-3 grid gap-2 sm:grid-cols-2">{pkg.highlights.concat(pkg.inclusions).map((x) => <li key={x} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 text-emerald-600" />{x}</li>)}</ul></section>}
    </div>
  );
}

