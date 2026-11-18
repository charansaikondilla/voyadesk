import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Building2, CalendarClock, Check, CreditCard, Lock, Mail, MessageCircle, Phone, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { money, titleCase } from "../../lib/format";
import { Badge, Button, ErrorNote, cx } from "../../components/ui";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

interface LinkInfo {
  company: { name: string; brandColor: string; phone: string; email: string };
  link: { amount: number; currency: string; status: string; provider: string; url: string; customerName: string; emiMonths: number; purpose: string; paidAt: string | null };
  emi: { months: number; monthly: number; total: number; noCost: boolean; rateBps: number }[];
}

type Method = "upi" | "card" | "netbanking" | "emi";
const PURPOSE: Record<string, string> = { invoice: "Trip invoice", proposal: "Trip booking", visa: "Visa fee", policy: "Travel insurance" };

/** Customer checkout: opened from a WhatsApp/email link on a phone, so it is built phone-first. */
export function PayPage() {
  const { tenantId = "demo", token = "" } = useParams();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("upi");
  const [months, setMonths] = useState(3);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const load = () => api.publicAction<LinkInfo>(tenantId, "payLinkInfo", { token }).then((x) => {
    setInfo(x);
    if (x.link.emiMonths) { setMethod("emi"); setMonths(x.link.emiMonths); } else if (x.emi[0]) setMonths(x.emi[0].months);
  }, (e) => setErr(errText(e, "This payment link could not be opened.")));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [tenantId, token]);

  if (err && !info) return <div className="mx-auto max-w-md p-6"><ErrorNote message={err} /></div>;
  if (!info) return <PaySkeleton />;

  const { company: c, link: l } = info;
  const brand = c.brandColor || "#1d5fd1";
  const paid = l.status === "paid" || done !== null;
  const closed = !paid && (l.status === "expired" || l.status === "cancelled");
  const sandbox = l.provider === "sandbox";
  const plan = info.emi.find((e) => e.months === months);
  const fromMonthly = info.emi.length ? Math.min(...info.emi.map((e) => e.monthly)) : null;
  const wa = c.phone ? `https://wa.me/${c.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${c.name}, I need help with my payment link of ${money(l.amount, l.currency)}.`)}` : null;

  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.publicAction<{ bookingNumber: string | null }>(tenantId, "sandboxPay", { token, method, emiMonths: method === "emi" ? months : 0 });
      setDone(r.bookingNumber ?? "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(errText(e, "Payment failed. Nothing was charged."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-canvas">
      {/* brand band */}
      <div className="relative h-44 overflow-hidden text-white" style={{ background: `linear-gradient(135deg, ${brand}, color-mix(in srgb, ${brand} 70%, #000))` }}>
        <div className="absolute -right-16 -top-20 size-64 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -left-10 top-16 size-40 rounded-full bg-white/[0.06]" aria-hidden />
        <div className="relative mx-auto flex max-w-md items-center justify-between px-4 pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/95 text-base font-bold shadow-sm" style={{ color: brand }}>{c.name.trim()[0]?.toUpperCase() ?? "•"}</span>
            <span className="truncate font-semibold">{c.name}</span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur"><Lock className="size-3" />Secure<span className="hidden min-[400px]:inline"> payment</span></span>
        </div>
      </div>

      <div className="relative mx-auto -mt-24 max-w-md space-y-4 px-4 pb-32">
        <div className="animate-pop-in overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
          {/* amount */}
          <div className="px-5 pb-5 pt-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink-500">{paid ? "Amount paid" : "Amount to pay"}{l.customerName ? ` · ${l.customerName}` : ""}</span>
              <Badge tone="gray">{PURPOSE[l.purpose] ?? titleCase(l.purpose)}</Badge>
            </div>
            <div className={cx("mt-1 text-[40px] font-semibold leading-tight tracking-[-0.03em] tabular-nums", paid ? "text-emerald-700" : "text-ink-900")}>{money(l.amount, l.currency)}</div>
            {!paid && !closed && method === "emi" && plan && (
              <div className="mt-0.5 text-sm text-violet-700">{plan.months} × {money(plan.monthly)} a month{plan.noCost ? " · no-cost EMI" : ` · total ${money(plan.total)}`}</div>
            )}
          </div>

          {paid ? (
            <div className="border-t border-line px-5 py-6 text-center">
              <span className="mx-auto mb-3 inline-flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.2 4.2L19 7" strokeDasharray="40" className="animate-check" /></svg>
              </span>
              <h1 className="text-lg font-semibold text-ink-900">Payment received</h1>
              <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-ink-600">
                Thank you!{done ? ` Booking ${done} is confirmed.` : ""} A receipt is on its way to your WhatsApp and email.
              </p>
              <Link to={`/my/${tenantId}`} className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm" style={{ background: brand }}>View my trips</Link>
            </div>
          ) : closed ? (
            <div className="border-t border-line px-5 py-6 text-center">
              <span className="mx-auto mb-3 inline-flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-600"><AlertCircle className="size-7" /></span>
              <h1 className="text-base font-semibold text-ink-900">This link has {l.status === "expired" ? "expired" : "been cancelled"}</h1>
              <p className="mt-1 text-sm text-ink-600">No money was taken. Please ask {c.name} for a new one — it takes them a few seconds.</p>
              {wa && <a href={wa} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] text-sm font-semibold text-white"><MessageCircle className="size-4" />Ask on WhatsApp</a>}
            </div>
          ) : !sandbox ? (
            <div className="space-y-3 border-t border-line px-5 py-5">
              <p className="text-sm leading-6 text-ink-600">You'll finish on {titleCase(l.provider)}'s secure page — pay by UPI, card, net banking{info.emi.length ? " or EMI" : ""}. This page updates once the payment is confirmed.</p>
              <a href={l.url} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.99]" style={{ background: brand }}><Lock className="size-4" />Continue to {titleCase(l.provider)}</a>
              <Button variant="secondary" className="w-full" busy={checking} icon={<RefreshCw className="size-4" />} onClick={async () => { setChecking(true); await load(); setChecking(false); }}>I've paid — check again</Button>
            </div>
          ) : (
            <div className="border-t border-line px-5 py-5">
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-cyan-50 px-3 py-2.5 text-[13px] leading-5 text-cyan-900">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span>Sandbox (test) checkout: no money moves. On your own account this step is Razorpay, Stripe or PayPal.</span>
              </div>
              <div className="mb-2 text-sm font-semibold text-ink-900">How would you like to pay?</div>
              <div role="radiogroup" aria-label="Payment method" className="space-y-2">
                <MethodCard m="upi" cur={method} set={setMethod} brand={brand} icon={<Smartphone />} title="UPI" sub="GPay, PhonePe, Paytm, BHIM — instant" tag="Recommended" />
                <MethodCard m="card" cur={method} set={setMethod} brand={brand} icon={<CreditCard />} title="Card" sub="Visa, Mastercard, RuPay, Amex" />
                <MethodCard m="netbanking" cur={method} set={setMethod} brand={brand} icon={<Building2 />} title="Net banking" sub="All major Indian banks" />
                {info.emi.length > 0 && (
                  <MethodCard m="emi" cur={method} set={setMethod} brand={brand} icon={<CalendarClock />} title="EMI" sub={fromMonthly !== null ? `From ${money(fromMonthly)} a month on credit cards` : "Monthly instalments"}>
                    {method === "emi" && (
                      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="EMI plan">
                        {info.emi.map((e) => (
                          <button key={e.months} type="button" role="radio" aria-checked={months === e.months} onClick={(ev) => { ev.stopPropagation(); setMonths(e.months); }}
                            className={cx("rounded-lg border bg-white px-3 py-2 text-left transition", months === e.months ? "ring-2" : "border-line hover:border-line-strong")}
                            style={months === e.months ? { borderColor: brand, ["--tw-ring-color" as string]: `color-mix(in srgb, ${brand} 22%, transparent)` } : undefined}>
                            <span className="flex items-center justify-between text-xs text-ink-500">{e.months} months{e.noCost && <span className="font-semibold text-emerald-700">No-cost</span>}</span>
                            <span className="block text-[15px] font-semibold tabular-nums text-ink-900">{money(e.monthly)}<span className="text-xs font-normal text-ink-500">/mo</span></span>
                            {!e.noCost && <span className="block text-[11px] text-ink-500">Total {money(e.total)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </MethodCard>
                )}
              </div>
              {err && <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{err}</div>}
              {/* desktop pay button; phones get the sticky bar below */}
              <div className="mt-5 hidden sm:block"><PayButton brand={brand} busy={busy} onClick={pay} label={`Pay ${money(l.amount, l.currency)} (test)`} /></div>
            </div>
          )}
        </div>

        {/* trust + contact */}
        <div className="flex items-center justify-center gap-4 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1"><Lock className="size-3.5" />Encrypted</span>
          <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" />{sandbox ? "Test gateway" : `Secured by ${titleCase(l.provider)}`}</span>
          <span className="inline-flex items-center gap-1"><Check className="size-3.5" />Instant receipt</span>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="text-sm font-semibold text-ink-900">Questions about this payment?</div>
          <div className="mt-0.5 text-xs text-ink-500">{c.name} is happy to help.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {wa && <a href={wa} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-[13px] font-medium text-emerald-800 hover:bg-emerald-100"><MessageCircle className="size-4" />WhatsApp</a>}
            {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[13px] font-medium text-ink-700 hover:bg-slate-200"><Phone className="size-4" />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[13px] font-medium text-ink-700 hover:bg-slate-200"><Mail className="size-4" />Email</a>}
          </div>
        </div>
      </div>

      {sandbox && !paid && !closed && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 pt-3 backdrop-blur sm:hidden">
          <div className="mx-auto mb-3 max-w-md"><PayButton brand={brand} busy={busy} onClick={pay} label={`Pay ${money(l.amount, l.currency)} (test)`} /></div>
        </div>
      )}
    </div>
  );
}

function MethodCard({ m, cur, set, brand, icon, title, sub, tag, children }: { m: Method; cur: Method; set: (m: Method) => void; brand: string; icon: ReactNode; title: string; sub: string; tag?: string; children?: ReactNode }) {
  const on = cur === m;
  return (
    <div role="radio" aria-checked={on} tabIndex={0} onClick={() => set(m)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(m); } }}
      className={cx("cursor-pointer rounded-xl border p-3 transition focus-visible:outline-2 focus-visible:outline-offset-2", on ? "bg-slate-50/60" : "border-line hover:border-line-strong")}
      style={on ? { borderColor: brand, boxShadow: `0 0 0 3px color-mix(in srgb, ${brand} 14%, transparent)`, outlineColor: brand } : { outlineColor: brand }}>
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5" style={{ background: `color-mix(in srgb, ${brand} 10%, white)`, color: brand }}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">{title}{tag && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{tag}</span>}</span>
          <span className="block truncate text-xs text-ink-500">{sub}</span>
        </span>
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: on ? brand : "#b4bfcd", background: on ? brand : "transparent" }}>
          {on && <span className="size-2 rounded-full bg-white" />}
        </span>
      </div>
      {children}
    </div>
  );
}

function PayButton({ brand, busy, onClick, label }: { brand: string; busy: boolean; onClick: () => void; label: string }) {
  return (
    <Button size="lg" className="w-full !h-[52px] !rounded-xl text-[15px] font-semibold" busy={busy} icon={<Lock className="size-4" />} style={{ background: brand }} onClick={onClick}>{label}</Button>
  );
}

function PaySkeleton() {
  return (
    <div className="min-h-full bg-canvas" role="status" aria-label="Opening secure payment…">
      <div className="h-44 bg-slate-300/60" />
      <div className="mx-auto -mt-24 max-w-md px-4">
        <div className="space-y-4 rounded-2xl border border-line bg-white p-5 shadow-pop">
          <div className="skeleton h-4 w-32" /><div className="skeleton h-10 w-48" />
          <div className="space-y-2 pt-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
        </div>
        <p className="mt-4 text-center text-sm text-ink-500">Opening secure payment…</p>
      </div>
    </div>
  );
}
