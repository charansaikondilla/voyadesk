import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, Check, Clock, Lock, MapPin, Phone, Tag, Users } from "lucide-react";
import { emiPlan, formatDate } from "@voyadesk/core";
import { api, ApiError } from "../../lib/api";
import { money } from "../../lib/format";
import { useLang } from "../../lib/i18n";
import { Button, Callout, Card, ErrorNote, Input, Loading, cx } from "../../components/ui";
import { LangSwitch } from "./PublicChrome";

interface Proposal {
  company: { name: string; phone: string; email: string; brandColor: string; gateways: Record<string, boolean>; advancePercent: number; emiPlans: { months: number; rateBps: number }[] };
  quote: {
    id: string; number: string; title: string; contactName: string; destination: string; startDate: string | null; nights: number;
    pax: { adults: number; children: number; infants: number }; currency: string; status: string; validUntil: string | null; chosenOption: string;
    days: { title: string; description: string; photoId?: string | null }[]; inclusions: string[]; exclusions: string[]; terms: string; scope: string; version: number;
    lines: { id: string; type: string; title: string; day: number; optional: boolean; selected: boolean; option: string; sell: number; total: number }[];
    options: { key: string; name: string; total: number; perPerson: number; sell: number; gst: number; tcs: number }[];
  };
  pricing: { sell: number; gst: number; tcs: number; tcsNote: string | null; discount: number; total: number; perPerson: number; payingPax: number };
  booking: { number: string; status: string } | null;
  invoice: { number: string; total: number; paid: number; outstanding: number } | null;
  expired: boolean;
}

const EMI_DEFAULT = [{ months: 3, rateBps: 0 }, { months: 6, rateBps: 1300 }, { months: 9, rateBps: 1400 }, { months: 12, rateBps: 1500 }];

export function ProposalPage() {
  const { tenantId = "demo", token = "" } = useParams();
  const { t } = useLang();
  const [data, setData] = useState<Proposal | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [option, setOption] = useState<string>("");
  const [mode, setMode] = useState<"advance" | "full" | "emi">("advance");
  const [emiMonths, setEmiMonths] = useState(3);
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  const load = () => api.publicAction<Proposal>(tenantId, "viewProposal", { token }).then((d) => {
    setData(d);
    setSelected(d.quote.lines.filter((l) => l.optional && l.selected).map((l) => l.id));
    setOption((o) => o || d.quote.chosenOption || d.quote.options[0]?.key || "");
  }, (e: unknown) => setError(e instanceof ApiError ? e.message : "This link could not be opened."));
  useEffect(() => {
    void load();
    api.publicAction<Record<string, string>>(tenantId, "proposalPhotos", { token }).then(setPhotos, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, token]);

  const visibleLines = useMemo(() => (data ? data.quote.lines.filter((l) => !l.option || !option || l.option === option) : []), [data, option]);
  const base = useMemo(() => {
    if (!data) return 0;
    const opt = data.quote.options.find((o) => o.key === option);
    return opt ? opt.total : data.pricing.total;
  }, [data, option]);
  const extra = useMemo(() => (data ? visibleLines.filter((l) => l.optional && !l.selected && selected.includes(l.id)).reduce((a, l) => a + l.total, 0) - visibleLines.filter((l) => l.optional && l.selected && !selected.includes(l.id)).reduce((a, l) => a + l.total, 0) : 0), [data, visibleLines, selected]);

  if (error && !data) return <div className="mx-auto max-w-lg p-6"><ErrorNote message={error} /></div>;
  if (!data) return <Loading label="Opening your proposal…" />;
  const { quote: q, pricing: p, company: c } = data;
  const total = base + extra;
  // Same rule as the server: the agency's advance %, rounded to the rupee (amounts are in paise)
  const advance = Math.min(total, Math.max(100, Math.round((total * c.advancePercent) / 100 / 100) * 100));
  const accepted = q.status === "accepted";
  const byDay = new Map<number, typeof q.lines>();
  visibleLines.filter((l) => !l.optional).forEach((l) => byDay.set(l.day, [...(byDay.get(l.day) ?? []), l]));
  const emi = (c.emiPlans?.length ? c.emiPlans : EMI_DEFAULT).map((e) => emiPlan(total, e.months, e.rateBps));

  const pay = async () => {
    setBusy("pay");
    setError(null);
    try {
      const link = await api.publicAction<{ url: string }>(tenantId, "proposalPay", { token, option: option || undefined, selectedOptionalIds: selected, mode: mode === "emi" ? "full" : mode, emiMonths: mode === "emi" ? emiMonths : 0 });
      if (link.url.startsWith("#")) window.location.hash = link.url.slice(1);
      else window.location.href = link.url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment could not start. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full bg-canvas pb-44">
      <header className="text-white" style={{ background: c.brandColor }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <span className="font-semibold">{c.name}</span>
          <span className="flex items-center gap-3">
            <LangSwitch dark />
            {c.phone && <span className="hidden items-center gap-1 text-sm opacity-90 sm:inline-flex"><Phone className="size-4" />{c.phone}</span>}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div>
          <div className="text-sm text-ink-500">Proposal {q.number}{q.version > 1 ? ` · version ${q.version}` : ""} for {q.contactName}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{q.title}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-ink-600">
            {q.destination && <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{q.destination}</span>}
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" />{formatDate(q.startDate)}{q.nights ? ` · ${q.nights}N/${q.nights + 1}D` : ""}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-4" />{q.pax.adults} adults{q.pax.children ? `, ${q.pax.children} children` : ""}</span>
          </div>
        </div>
        {accepted && data.booking && <Callout tone="good" title="Booking confirmed">Your reference is <b>{data.booking.number}</b>.{data.invoice && data.invoice.outstanding > 0 ? ` Balance due: ${money(data.invoice.outstanding)}.` : " Fully paid — thank you!"}</Callout>}
        {held && <Callout tone="good" title="Held for you">{held}</Callout>}
        {data.expired && !accepted && <Callout tone="warn">This proposal expired on {formatDate(q.validUntil)}. Please contact us for updated prices.</Callout>}
        {error && <Callout tone="bad">{error}</Callout>}

        {q.options.length > 1 && !accepted && (
          <Card>
            <h2 className="mb-3 font-semibold">{t("chooseOption")}</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {q.options.map((o) => (
                <button key={o.key} type="button" onClick={() => setOption(o.key)} className={cx("rounded-xl border p-3 text-left transition", option === o.key ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100" : "border-line bg-white hover:border-brand-300")}>
                  <div className="text-sm font-medium">{o.name}</div>
                  <div className="mt-1 text-lg font-semibold">{money(o.total, q.currency)}</div>
                  <div className="text-xs text-ink-500">{money(o.perPerson, q.currency)} {t("perPerson")}</div>
                </button>
              ))}
            </div>
          </Card>
        )}

        {q.days.length > 0 && (
          <Card>
            <h2 className="mb-3 font-semibold">Your itinerary</h2>
            <ol className="space-y-4">
              {q.days.map((d, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: c.brandColor }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{d.title}</div>
                    <p className="text-sm text-ink-600">{d.description}</p>
                    {d.photoId && photos[d.photoId] && <img src={photos[d.photoId]} alt={d.title} className="mt-2 max-h-56 w-full rounded-xl object-cover" loading="lazy" />}
                    {(byDay.get(i + 1) ?? []).length > 0 && <ul className="mt-1 space-y-0.5 text-sm text-ink-700">{(byDay.get(i + 1) ?? []).map((l) => <li key={l.id} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{l.title}</li>)}</ul>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}
        {q.days.length === 0 && (
          <Card><h2 className="mb-2 font-semibold">What's included</h2><ul className="space-y-1 text-sm">{visibleLines.filter((l) => !l.optional).map((l) => <li key={l.id} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{l.title}</li>)}</ul></Card>
        )}

        {visibleLines.some((l) => l.optional) && (
          <Card>
            <h2 className="mb-3 font-semibold">Make it better</h2>
            <div className="space-y-2">{visibleLines.filter((l) => l.optional).map((l) => (
              <label key={l.id} className={cx("flex items-center justify-between gap-3 rounded-xl border p-3", selected.includes(l.id) ? "border-brand-600 bg-brand-50" : "border-line")}>
                <span className="flex items-center gap-3"><input type="checkbox" disabled={accepted} className="size-5 accent-brand-600" checked={selected.includes(l.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /><span className="text-sm font-medium">{l.title}</span></span>
                <span className="text-sm">+{money(l.total, q.currency)}</span>
              </label>
            ))}</div>
          </Card>
        )}

        {(q.inclusions.length > 0 || q.exclusions.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card><h2 className="mb-2 font-semibold">Included</h2><ul className="space-y-1 text-sm">{q.inclusions.map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{x}</li>)}</ul></Card>
            <Card><h2 className="mb-2 font-semibold">Not included</h2><ul className="space-y-1 text-sm text-ink-600">{q.exclusions.map((x) => <li key={x}>– {x}</li>)}</ul></Card>
          </div>
        )}

        <Card>
          <h2 className="mb-3 font-semibold">Price</h2>
          <dl className="space-y-1.5 text-sm">
            {q.options.length === 0 && <>
              <div className="flex justify-between"><dt className="text-ink-500">Price</dt><dd>{money(p.sell, q.currency)}</dd></div>
              {p.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount applied</dt><dd>−{money(p.discount, q.currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-500">GST</dt><dd>{money(p.gst, q.currency)}</dd></div>
              {p.tcs > 0 && <div className="flex justify-between"><dt className="text-ink-500">TCS (overseas package, adjustable against your income tax)</dt><dd>{money(p.tcs, q.currency)}</dd></div>}
            </>}
            {q.options.length > 0 && <div className="flex justify-between"><dt className="text-ink-500">{q.options.find((o) => o.key === option)?.name ?? "Option"} (incl. taxes)</dt><dd>{money(base, q.currency)}</dd></div>}
            {extra !== 0 && <div className="flex justify-between"><dt className="text-ink-500">Add-ons selected</dt><dd>{extra > 0 ? "+" : "−"}{money(Math.abs(extra), q.currency)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold"><dt>{t("total")}</dt><dd>{money(total, q.currency)}</dd></div>
            <div className="text-right text-xs text-ink-500">{money(Math.round(total / Math.max(1, p.payingPax)), q.currency)} {t("perPerson")}{extra !== 0 ? " · final tax recalculated on payment" : ""}</div>
          </dl>
          {!accepted && !data.expired && (
            <form className="mt-3 flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              if (!coupon.trim()) return;
              setBusy("coupon");
              setError(null);
              try {
                await api.publicAction(tenantId, "proposalCoupon", { token, code: coupon.trim() });
                await load();
                setCoupon("");
              } catch (x) {
                setError(x instanceof ApiError ? x.message : "Coupon could not be applied.");
              } finally {
                setBusy(null);
              }
            }}>
              <Input aria-label={t("coupon")} placeholder={t("coupon")} value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} className="max-w-[200px]" />
              <Button type="submit" variant="secondary" busy={busy === "coupon"} icon={<Tag className="size-4" />}>{t("apply")}</Button>
            </form>
          )}
          <p className="mt-3 whitespace-pre-wrap text-xs text-ink-500">{q.terms}</p>
        </Card>

        {!accepted && !data.expired && (
          <Card>
            <h2 className="mb-3 font-semibold">{t("payOnline")}</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {([["advance", t("payAdvance"), money(advance, q.currency)], ["full", t("payFull"), money(total, q.currency)], ["emi", t("emi"), `${money(emi[0]!.monthly, q.currency)}/mo`]] as const).map(([k, label, sub]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={cx("rounded-xl border p-3 text-left", mode === k ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100" : "border-line bg-white")}>
                  <div className="text-sm font-medium">{label}</div><div className="text-xs text-ink-500">{sub}</div>
                </button>
              ))}
            </div>
            {mode === "emi" && (
              <div className="mt-3 space-y-1.5">
                {emi.map((e) => (
                  <label key={e.months} className={cx("flex items-center justify-between rounded-lg border px-3 py-2 text-sm", emiMonths === e.months ? "border-brand-600 bg-brand-50" : "border-line")}>
                    <span className="flex items-center gap-2"><input type="radio" name="emi" className="accent-brand-600" checked={emiMonths === e.months} onChange={() => setEmiMonths(e.months)} />{e.months} months{e.noCost ? " · no-cost EMI" : ` · ${(e.rateBps / 100).toFixed(0)}% p.a.`}</span>
                    <span className="font-medium">{money(e.monthly, q.currency)}/month</span>
                  </label>
                ))}
                <p className="text-xs text-ink-500">EMI is offered by your card bank or EMI partner on the payment page. Total payable {money(emi.find((e) => e.months === emiMonths)!.total, q.currency)}.</p>
              </div>
            )}
          </Card>
        )}
      </div>

      {!accepted && !data.expired && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <Button variant="secondary" busy={busy === "hold"} icon={<Clock className="size-4" />} onClick={async () => {
              setBusy("hold");
              setError(null);
              try {
                const h = await api.publicAction<{ holdUntil: string; amount: number }>(tenantId, "proposalHold", { token, option: option || undefined, selectedOptionalIds: selected });
                setHeld(`Price locked at ${money(h.amount, q.currency)} until ${new Date(h.holdUntil).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. Pay any time before then from this page.`);
                window.scrollTo({ top: 0, behavior: "smooth" });
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not hold this proposal.");
              } finally {
                setBusy(null);
              }
            }}>{t("hold")}</Button>
            <Button size="lg" className="sm:ml-auto" busy={busy === "pay"} icon={<Lock className="size-4" />} style={{ background: c.brandColor }} onClick={pay}>
              {mode === "emi" ? `${t("emi")} · ${money(emi.find((e) => e.months === emiMonths)!.monthly, q.currency)}/mo` : `${t("bookNow")} · ${money(mode === "full" ? total : advance, q.currency)}`}
            </Button>
          </div>
          <p className="pb-2 text-center text-[11px] text-ink-400">{api.mode === "demo" ? "Demo: sandbox payment page — no money moves." : "You'll pay on your agency's secure payment page."}</p>
        </div>
      )}
    </div>
  );
}
