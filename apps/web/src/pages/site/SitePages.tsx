import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, Bot, Briefcase, Check, FileText, Globe2, Handshake, Landmark, Megaphone, Menu, MessageCircle,
  ShieldCheck, Sparkles, Stamp, Users, X,
} from "lucide-react";
import { Brand, PRODUCT_NAME } from "../../components/Brand";
import { Button, ButtonLink, Card, Field, Input, Select, Textarea, cx } from "../../components/ui";
import { BUSINESS_TYPES, FEATURE_GROUPS, INTEGRATIONS } from "./catalog";

const GROUP_ICON: Record<string, ReactNode> = {
  sales: <Users className="size-5" />, itinerary: <FileText className="size-5" />, operations: <Briefcase className="size-5" />,
  finance: <Landmark className="size-5" />, marketing: <Megaphone className="size-5" />, portals: <Globe2 className="size-5" />,
  b2b: <Handshake className="size-5" />, visa: <Stamp className="size-5" />, ai: <Bot className="size-5" />,
};

export function SiteLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const links = [
    { to: "/features", label: "Features" },
    { to: "/solutions/b2c", label: "Solutions" },
    { to: "/pricing", label: "Pricing" },
    { to: "/integrations", label: "Integrations" },
  ];
  return (
    <div className="min-h-full bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Brand />
          <nav className="hidden items-center gap-7 text-sm text-ink-700 md:flex">
            {links.map((l) => <Link key={l.to} to={l.to} className="hover:text-brand-700">{l.label}</Link>)}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
            <ButtonLink to="/signup">Start free trial</ButtonLink>
          </div>
          <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
        </div>
        {open && (
          <div className="border-t border-line px-4 py-3 md:hidden">
            {links.map((l) => <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block py-2 text-sm text-ink-800">{l.label}</Link>)}
            <div className="mt-2 flex gap-2"><ButtonLink to="/login" variant="secondary" className="flex-1">Sign in</ButtonLink><ButtonLink to="/signup" className="flex-1">Start free</ButtonLink></div>
          </div>
        )}
      </header>
      <main>{children}</main>
      <footer className="border-t border-line bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 md:grid-cols-4">
          <div><Brand /><p className="mt-3 text-sm text-ink-500">The travel business CRM: leads, itineraries, bookings, accounts, B2B and visa in one place.</p></div>
          <FooterCol title="Product" links={[["Features", "/features"], ["Pricing", "/pricing"], ["Integrations", "/integrations"], ["Live demo", "/login"]]} />
          <FooterCol title="Solutions" links={BUSINESS_TYPES.map((b) => [b.name, `/solutions/${b.key}`])} />
          <FooterCol title="Company" links={[["Contact sales", "/contact"], ["Sign in", "/login"], ["Start free trial", "/signup"]]} />
        </div>
        <div className="border-t border-line py-4 text-center text-xs text-ink-500">© {new Date().getFullYear()} {PRODUCT_NAME}. Tax rules shown are defaults — confirm with your chartered accountant.</div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: string[][] }) {
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-ink-900">{title}</div>
      <ul className="space-y-2 text-sm text-ink-600">{links.map(([l, to]) => <li key={to}><Link to={to!} className="hover:text-brand-700">{l}</Link></li>)}</ul>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-line bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Today</div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Books balanced</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[["New leads", "12"], ["Quotes sent", "8"], ["Collected", "₹3.4L"]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] text-ink-500">{k}</div><div className="mt-1 text-lg font-semibold">{v}</div></div>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {[["Ritika S.", "5N Dubai · 4 pax", "Hot", "bg-rose-50 text-rose-700"], ["Tanvi B.", "6N Bali honeymoon", "Warm", "bg-amber-50 text-amber-800"], ["Harsh V.", "4N Manali · 6 pax", "Quoted", "bg-violet-50 text-violet-700"]].map(([n, t, s, c]) => (
            <div key={n} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
              <div><div className="font-medium">{n}</div><div className="text-xs text-ink-500">{t}</div></div>
              <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", c)}>{s}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute -bottom-6 -left-4 hidden w-56 rounded-2xl border border-line bg-white p-3 text-xs shadow-lg sm:block">
        <div className="flex items-center gap-2 font-medium text-emerald-700"><MessageCircle className="size-4" />WhatsApp bot</div>
        <p className="mt-1 text-ink-600">“5N Dubai, 4 pax, 27 Jan, 2.4L” → lead scored, assigned to Priya, quote drafted.</p>
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <SiteLayout>
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 md:grid-cols-2 md:py-20">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200"><Sparkles className="size-3.5" />Built for Indian travel businesses</span>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">Run your whole travel business from one simple screen.</h1>
            <p className="mt-4 text-lg text-ink-600">Leads, itineraries, bookings, GST/TCS invoices, B2B agents and visa — connected, so a confirmed quote becomes a booking, an invoice and balanced books without re-typing.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to="/login" size="lg" icon={<ArrowRight className="size-4" />}>Open the live demo</ButtonLink>
              <ButtonLink to="/signup" size="lg" variant="secondary">Start free trial</ButtonLink>
            </div>
            <p className="mt-3 text-sm text-ink-500">No demo call needed. Set up in an afternoon, first quote in minutes.</p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight">One connected flow, no double entry</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-ink-600">Every module works on the same records, so each step hands the next one exactly what it needs.</p>
        <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {["Enquiry captured & scored", "Itinerary priced live", "Proposal link + payment", "Booking file & vouchers", "GST/TCS invoice & ledger", "Reports & re-engagement"].map((s, i) => (
            <li key={s} className="relative rounded-2xl border border-line bg-white p-4">
              <div className="mb-2 flex size-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{i + 1}</div>
              <div className="text-sm font-medium text-ink-900">{s}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-semibold tracking-tight">Everything a travel company needs</h2>
          <p className="mt-2 text-ink-600">Switch on only the modules you use — the screen stays simple.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GROUPS.map((g) => (
              <Card key={g.key}>
                <div className="flex items-center gap-2 text-brand-700">{GROUP_ICON[g.key]}<span className="font-semibold text-ink-900">{g.name}</span></div>
                <p className="mt-2 text-sm text-ink-600">{g.tagline}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-ink-700">{g.features.slice(0, 4).map((f) => <li key={f.name} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{f.name}</li>)}</ul>
              </Card>
            ))}
          </div>
          <div className="mt-8 text-center"><ButtonLink to="/features" variant="secondary">See all {FEATURE_GROUPS.reduce((a, g) => a + g.features.length, 0)} features</ButtonLink></div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">Made for your kind of business</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {BUSINESS_TYPES.map((b) => (
            <Link key={b.key} to={`/solutions/${b.key}`} className="group rounded-2xl border border-line p-5 transition-shadow hover:shadow-md">
              <div className="text-lg font-semibold text-ink-900 group-hover:text-brand-700">{b.name}</div>
              <p className="mt-1 text-sm text-ink-600">{b.pitch}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700">How it works <ArrowRight className="size-4" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-[#0f1b33] py-16 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-3">
          {[
            [<ShieldCheck key="s" className="size-6" />, "Correct money, every time", "Prices, GST and TCS come from one tested engine; every payment posts a balanced ledger entry."],
            [<BadgeCheck key="b" className="size-6" />, "Easy for new staff", "Role-based screens, one obvious next step, checks before anything goes to a customer."],
            [<Globe2 key="g" className="size-6" />, "Works on the phone", "Every screen is responsive; customers get mobile proposals and payment links."],
          ].map(([icon, t, d]) => (
            <div key={String(t)}><div className="text-brand-300">{icon}</div><div className="mt-3 text-lg font-semibold">{t}</div><p className="mt-1 text-sm text-slate-300">{d}</p></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Questions</h2>
        <div className="mt-8 divide-y divide-line rounded-2xl border border-line">
          {[
            ["Do I need a demo call to start?", "No. Sign up, pick your business type and the setup guide walks you through the rest. The live demo is open to everyone."],
            ["Does it handle GST and TCS?", "Yes. Invoices split CGST/SGST/IGST by place of supply and TCS on overseas packages follows dated rules (2% flat from 1 April 2026). Rates are editable; confirm them with your CA."],
            ["Can my sub-agents use it?", "Yes. Agents get their own portal with slab pricing, wallet and credit — and never see your supplier costs."],
            ["Can I connect WhatsApp and payment gateways?", "Yes. Signed webhooks for WhatsApp and Meta lead ads are built in; Razorpay, Stripe and PayPal connect from Settings."],
          ].map(([q, a]) => <details key={q} className="group p-5"><summary className="cursor-pointer list-none font-medium text-ink-900">{q}</summary><p className="mt-2 text-sm text-ink-600">{a}</p></details>)}
        </div>
      </section>

      <section className="bg-brand-600 py-14 text-center text-white">
        <h2 className="text-3xl font-semibold">See your agency running on {PRODUCT_NAME} today</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink to="/login" variant="secondary" size="lg">Open the live demo</ButtonLink>
          <ButtonLink to="/signup" size="lg" className="bg-white/10 ring-1 ring-white/40 hover:bg-white/20">Start free trial</ButtonLink>
        </div>
      </section>
    </SiteLayout>
  );
}

export function FeaturesPage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-4xl font-semibold tracking-tight">Features</h1>
        <p className="mt-2 max-w-2xl text-ink-600">Every module shares one database, so a lead, its quote, the booking, the invoice and the ledger entries are always the same record seen from different desks.</p>
        <nav className="mt-6 flex flex-wrap gap-2">{FEATURE_GROUPS.map((g) => <a key={g.key} href={`#${g.key}`} onClick={(e) => { e.preventDefault(); document.getElementById(g.key)?.scrollIntoView({ behavior: "smooth" }); }} className="rounded-full border border-line px-3 py-1 text-sm hover:bg-slate-50">{g.name}</a>)}</nav>
        <div className="mt-10 space-y-12">
          {FEATURE_GROUPS.map((g) => (
            <section key={g.key} id={g.key} className="scroll-mt-24">
              <div className="flex items-center gap-2 text-brand-700">{GROUP_ICON[g.key]}<h2 className="text-2xl font-semibold text-ink-900">{g.name}</h2></div>
              <p className="mt-1 text-ink-600">{g.tagline}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.features.map((f) => (
                  <div key={f.name} className="rounded-xl border border-line p-4">
                    <div className="font-medium text-ink-900">{f.name}</div>
                    <p className="mt-1 text-sm text-ink-600">{f.desc}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

export function SolutionsPage() {
  const { type } = useParams();
  const b = BUSINESS_TYPES.find((x) => x.key === type) ?? BUSINESS_TYPES[0]!;
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 flex flex-wrap gap-2">
          {BUSINESS_TYPES.map((x) => <Link key={x.key} to={`/solutions/${x.key}`} className={cx("rounded-full px-3 py-1.5 text-sm", x.key === b.key ? "bg-brand-600 text-white" : "border border-line hover:bg-slate-50")}>{x.name}</Link>)}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">{b.name}</h1>
        <p className="mt-2 max-w-2xl text-lg text-ink-600">{b.pitch}</p>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold">How the work flows</h2>
            <ol className="mt-4 space-y-3">
              {b.workflow.map((s, i) => (
                <li key={s} className="flex gap-3 text-sm"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span><span className="pt-0.5 text-ink-800">{s}</span></li>
              ))}
            </ol>
          </Card>
          <div className="space-y-6">
            <Card>
              <h2 className="font-semibold">Built for {b.name.toLowerCase()}</h2>
              <ul className="mt-3 space-y-2 text-sm">{b.unique.map((u) => <li key={u} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{u}</li>)}</ul>
            </Card>
            <Card>
              <h2 className="font-semibold">Modules switched on</h2>
              <div className="mt-3 flex flex-wrap gap-2">{b.modules.map((m) => <span key={m} className="rounded-full bg-slate-100 px-3 py-1 text-sm">{m}</span>)}</div>
            </Card>
          </div>
        </div>
        <div className="mt-10 flex gap-3"><ButtonLink to="/login">Try it in the demo</ButtonLink><ButtonLink to="/signup" variant="secondary">Start free trial</ButtonLink></div>
      </section>
    </SiteLayout>
  );
}

export const PLANS = [
  { name: "Starter", price: "₹24,000", per: "per year", who: "Small agencies, up to 3 users", features: ["Leads, pipeline, tasks", "Itinerary & quotation builder", "Proposal links + payments", "Bookings & vouchers", "GST/TCS invoicing", "WhatsApp bot (usage billed)"], cta: "Start free trial" },
  { name: "Growth", price: "₹60,000", per: "per year", who: "Growing agencies and DMCs, unlimited users", features: ["Everything in Starter", "B2B agent portal, wallet & credit", "Visa desk with passport scan", "Marketing campaigns & drips", "Storefront & landing pages", "Driver/guide allocation"], cta: "Start free trial", highlight: true },
  { name: "Enterprise", price: "Custom", per: "", who: "Multi-branch operators and portals", features: ["Everything in Growth", "Flight & hotel API connections", "Custom workflows and reports", "Single sign-on", "Dedicated onboarding", "Priority support"], cta: "Contact sales" },
];

export function PricingPage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-center text-4xl font-semibold tracking-tight">Simple pricing</h1>
        <p className="mt-2 text-center text-ink-600">14-day free trial. Prices exclude 18% GST. Message and gateway charges are billed at cost.</p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={cx("flex flex-col rounded-2xl border p-6", p.highlight ? "border-brand-600 shadow-lg ring-1 ring-brand-600" : "border-line")}>
              {p.highlight && <span className="mb-3 self-start rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-medium text-white">Most popular</span>}
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="mt-1 text-sm text-ink-500">{p.who}</div>
              <div className="mt-4"><span className="text-3xl font-semibold">{p.price}</span> <span className="text-sm text-ink-500">{p.per}</span></div>
              <ul className="mt-5 flex-1 space-y-2 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{f}</li>)}</ul>
              <ButtonLink to={p.cta === "Contact sales" ? "/contact" : "/signup"} variant={p.highlight ? "primary" : "secondary"} className="mt-6">{p.cta}</ButtonLink>
            </div>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

export function IntegrationsPage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-4xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-2 max-w-2xl text-ink-600">Built-in engines work out of the box. Adapters are ready connection points — add your provider credentials in Settings → Integrations.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((i) => (
            <div key={i.name} className="flex items-center justify-between rounded-xl border border-line p-4">
              <div><div className="font-medium">{i.name}</div><div className="text-sm text-ink-500">{i.kind}</div></div>
              <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", i.status === "built-in" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700")}>{i.status === "built-in" ? "Built in" : "Adapter"}</span>
            </div>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

export function ContactPage() {
  const [form, setForm] = useState({ name: "", company: "", phone: "", type: "b2c", message: "" });
  const [sent, setSent] = useState(false);
  const body = `Name: ${form.name}\nCompany: ${form.company}\nPhone: ${form.phone}\nBusiness: ${form.type}\n\n${form.message}`;
  return (
    <SiteLayout>
      <section className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Talk to sales</h1>
        <p className="mt-2 text-ink-600">Tell us about your agency and we'll help you set up.</p>
        <Card className="mt-6">
          {sent ? <p className="text-sm text-ink-700">Your email app opened with the details. If it didn't, write to sales@example.com.</p> : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); window.location.href = `mailto:sales@example.com?subject=${encodeURIComponent(`${PRODUCT_NAME} enquiry — ${form.company}`)}&body=${encodeURIComponent(body)}`; setSent(true); }}>
              <Field label="Your name" required><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Company" required><Input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
              <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Business type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{BUSINESS_TYPES.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}</Select></Field>
              <Field label="What do you need?"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
              <Button type="submit" className="w-full">Send</Button>
            </form>
          )}
        </Card>
      </section>
    </SiteLayout>
  );
}
