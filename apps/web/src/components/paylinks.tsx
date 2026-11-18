import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock, Check, CheckCircle2, Copy, CreditCard, ExternalLink, FileText, Landmark, Mail, MessageCircle, Send, Share2, Smartphone, Stamp, Wallet,
} from "lucide-react";
import { T, emiPlan, formatDate, type Entity, type PaymentLink } from "@voyadesk/core";
import { money, relTime } from "../lib/format";
import { useAction, useList } from "../lib/hooks";
import { useSession } from "../lib/session";
import { copyText } from "../lib/toast";
import { Avatar, Badge, Button, Callout, Field, IconChip, Modal, MoneyInput, Progress, SearchInput, Segmented, Toggle, cx } from "./ui";

/* ───────────────────────── helpers shared by every payment-link screen ───────────────────────── */

export const paylinkUrl = (l: Pick<PaymentLink, "url">) => (l.url.startsWith("#") ? `${window.location.origin}${window.location.pathname}${l.url}` : l.url);

/** A link that is still "created" after its expiry is expired for every practical purpose (the job marks it later). */
export function effectiveStatus(l: PaymentLink, now = Date.now()): PaymentLink["status"] {
  if (l.status === "created" && l.expiresAt && Date.parse(l.expiresAt) < now) return "expired";
  return l.status;
}

export const LINK_STATUS_LABEL: Record<string, string> = { created: "Awaiting payment", paid: "Paid", expired: "Expired", cancelled: "Cancelled" };

export const PURPOSE_LABEL: Record<PaymentLink["purpose"], string> = { invoice: "Invoice", proposal: "Trip proposal", visa: "Visa fee", policy: "Insurance" };

export const waUrl = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
export const mailUrl = (email: string, subject: string, body: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export function reminderText(l: PaymentLink, company: string) {
  const first = l.customerName.split(/\s+/)[0] || "there";
  return `Hi ${first}, here is your secure ${company} payment link for ${money(l.amount, l.currency)}${l.emiMonths ? ` (EMI over ${l.emiMonths} months available)` : ""}. Pay by UPI, card or net banking: ${paylinkUrl(l)}`;
}

/** "in 3 d", "in 5 h" — for expiry. */
export function expiresIn(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return null;
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `${Math.max(1, h)} h` : `${Math.round(h / 24)} d`;
}

export const outstanding = (i: Entity<"invoices">) => i.total - i.paid - i.credited;

/* ───────────────────────── share panel: what to do with a fresh link ───────────────────────── */

export function ShareLink({ link, sent }: { link: PaymentLink; sent: boolean }) {
  const { settings } = useSession();
  const company = settings?.companyName ?? "our";
  const url = paylinkUrl(link);
  const text = reminderText(link, company);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center">
        <span className="relative mb-3 inline-flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
          <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.2 4.2L19 7" strokeDasharray="40" className="animate-check" />
          </svg>
        </span>
        <div className="text-[28px] font-semibold tracking-tight tabular-nums text-ink-900">{money(link.amount, link.currency)}</div>
        <div className="mt-1 text-sm text-ink-500">
          Link ready for <span className="font-medium text-ink-800">{link.customerName || "your customer"}</span>
          {link.expiresAt && <> · valid until {formatDate(link.expiresAt.slice(0, 10))}</>}
        </div>
        {sent && (link.phone || link.email) && (
          <Badge tone="green" className="mt-2.5" dot>Sent on {[link.phone && "WhatsApp", link.email && "email"].filter(Boolean).join(" & ")}</Badge>
        )}
        {link.provider === "sandbox" && <Badge tone="cyan" className="mt-2">Test mode — no real money moves</Badge>}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-slate-50 p-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-700" title={url}>{url}</span>
        <Button size="sm" variant={copied ? "success" : "primary"} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => { void copyText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className={cx("grid gap-2", canShare ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <ShareTile href={waUrl(link.phone, text)} icon={<MessageCircle />} label="WhatsApp" tone="green" />
        <ShareTile href={mailUrl(link.email, `Payment link — ${money(link.amount)}`, text)} icon={<Mail />} label="Email" tone="blue" />
        {canShare && <ShareTile onClick={() => { void navigator.share({ title: "Payment link", text, url }).catch(() => undefined); }} icon={<Share2 />} label="More apps" tone="violet" />}
        <ShareTile href={url} icon={<ExternalLink />} label="Preview" tone="gray" />
      </div>
      <p className="text-center text-xs leading-5 text-ink-500">When the customer pays, it's matched to the {PURPOSE_LABEL[link.purpose].toLowerCase()} automatically and they get a receipt.</p>
    </div>
  );
}

function ShareTile({ href, onClick, icon, label, tone }: { href?: string; onClick?: () => void; icon: ReactNode; label: string; tone: "green" | "blue" | "violet" | "gray" }) {
  const cls = "flex flex-col items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-3 text-xs font-medium text-ink-700 transition hover:-translate-y-px hover:border-line-strong hover:shadow-lift";
  const inner = <><IconChip tone={tone}>{icon}</IconChip>{label}</>;
  return href ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/* ───────────────────────── create flow ───────────────────────── */

type Target = { kind: "invoice"; id: string } | { kind: "visa"; id: string };
type AmountMode = "full" | "half" | "quarter" | "custom";

interface Payable {
  key: string;
  target: Target;
  title: string;
  ref: string;
  due: number;
  total: number;
  paidPct: number;
  dueDate: string | null;
  name: string;
  phone: string;
  email: string;
  icon: ReactNode;
  hasOpenLink: boolean;
}

/**
 * One screen to create a link: pick what it's for, how much (full balance or an advance), how the customer may pay,
 * and whether to send it now. A live summary on the side shows exactly what the customer will get.
 */
export function CreatePaymentLinkModal({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: Target | null }) {
  const { settings, moduleOn } = useSession();
  const invoices = useList("invoices", open);
  const visas = useList("visaCases", open && moduleOn("visa"));
  const bookings = useList("bookings", open);
  const agents = useList("agents", open && moduleOn("b2b"));
  const links = useList("paymentLinks", open);
  const { act, busy } = useAction();

  const [kind, setKind] = useState<"invoice" | "visa">("invoice");
  const [sel, setSel] = useState<string>("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<AmountMode>("full");
  const [custom, setCustom] = useState<number | null>(null);
  const [emi, setEmi] = useState(0);
  const [send, setSend] = useState(true);
  const [created, setCreated] = useState<{ link: PaymentLink; sent: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(preset?.kind ?? "invoice");
    setSel(preset ? `${preset.kind}:${preset.id}` : "");
    setQ(""); setMode("full"); setCustom(null); setEmi(0); setSend(true); setCreated(null);
  }, [open, preset?.kind, preset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const payables = useMemo<Payable[]>(() => {
    const openLinks = (links.data ?? []).filter((l) => effectiveStatus(l) === "created");
    const inv: Payable[] = (invoices.data ?? []).filter((i) => outstanding(i) > 0 && i.status !== "cancelled").map((i): Payable => {
      const b = i.bookingId ? bookings.data?.find((x) => x.id === i.bookingId) : undefined;
      const a = i.partyType === "agent" && i.partyId ? agents.data?.find((x) => x.id === i.partyId) : undefined;
      return {
        key: `invoice:${i.id}`, target: { kind: "invoice", id: i.id }, title: i.partyName, ref: `${i.number}${b ? ` · ${b.destination || b.title}` : ""}`,
        due: outstanding(i), total: i.total, paidPct: i.total ? ((i.paid + i.credited) / i.total) * 100 : 0, dueDate: i.dueDate,
        name: i.partyName, phone: a?.phone ?? b?.phone ?? "", email: a?.email ?? b?.email ?? "", icon: <FileText />, hasOpenLink: openLinks.some((l) => l.invoiceId === i.id),
      };
    }).sort((x, y) => (x.dueDate ?? "9").localeCompare(y.dueDate ?? "9"));
    const vis: Payable[] = (visas.data ?? []).filter((v) => v.fee - v.paid > 0 && !["delivered", "rejected"].includes(v.status)).map((v): Payable => ({
      key: `visa:${v.id}`, target: { kind: "visa", id: v.id }, title: v.contactName, ref: `${v.number} · ${v.country} ${v.visaType}`,
      due: v.fee - v.paid, total: v.fee, paidPct: v.fee ? (v.paid / v.fee) * 100 : 0, dueDate: v.travelDate, name: v.contactName, phone: v.phone, email: v.email,
      icon: <Stamp />, hasOpenLink: openLinks.some((l) => l.visaCaseId === v.id),
    }));
    return [...inv, ...vis];
  }, [invoices.data, visas.data, bookings.data, agents.data, links.data]);

  const chosen = payables.find((p) => p.key === sel);
  const list = payables.filter((p) => p.target.kind === kind && (!q || `${p.title} ${p.ref}`.toLowerCase().includes(q.toLowerCase())));
  const due = chosen?.due ?? 0;
  const amount = !chosen ? 0 : mode === "full" ? due : mode === "half" ? Math.round(due / 2) : mode === "quarter" ? Math.round(due / 4) : Math.min(custom ?? 0, due);
  const customBad = mode === "custom" && (custom === null || custom <= 0 || custom > due);
  const plans = (settings?.emiPlans ?? []).map((p) => emiPlan(amount, p.months, p.rateBps));
  const plan = plans.find((p) => p.months === emi);
  const reachable = Boolean(chosen && (chosen.phone || chosen.email));
  const today = new Date().toISOString().slice(0, 10);
  const preview = chosen ? T.paymentReminder(chosen.name, chosen.ref.split(" · ")[0] ?? "", amount, formatDate(chosen.dueDate ?? today), "https://…/pay/…") : "";
  const lockedPreset = Boolean(preset);

  const submit = async () => {
    if (!chosen || amount <= 0 || customBad) return;
    const input = { ...(chosen.target.kind === "invoice" ? { invoiceId: chosen.target.id } : { visaCaseId: chosen.target.id }), amount, emiMonths: emi, send: send && reachable };
    const l = await act<PaymentLink>("createPaymentLink", input, send && reachable ? "Payment link created and sent" : "Payment link created");
    if (l) setCreated({ link: l, sent: send && reachable });
  };

  if (created) {
    return (
      <Modal open={open} onClose={onClose} title="Payment link ready" size="md" footer={<><Link to="/app/finance/links" onClick={onClose} className="mr-auto self-center text-sm font-medium text-brand-700 hover:underline">All payment links</Link><Button onClick={onClose}>Done</Button></>}>
        <ShareLink link={created.link} sent={created.sent} />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title="New payment link" description="Customers pay by UPI, card, net banking or EMI. Paid links settle the invoice automatically."
      footer={<>
        <span className="mr-auto hidden self-center text-xs text-ink-500 sm:block">Valid for 7 days · you can cancel it anytime</span>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={!chosen || amount <= 0 || customBad} icon={send && reachable ? <Send className="size-4" /> : <CreditCard className="size-4" />} onClick={() => void submit()}>
          {send && reachable ? `Create & send ${amount ? money(amount) : ""}` : `Create link ${amount ? money(amount) : ""}`}
        </Button>
      </>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* 1 — what for */}
          <section>
            <StepTitle n={1} title="What is the customer paying for?" />
            {lockedPreset && chosen ? (
              <PayableRow p={chosen} selected onSelect={() => undefined} />
            ) : (
              <>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  {moduleOn("visa") && (
                    <Segmented label="Payable type" value={kind} onChange={(k) => { setKind(k); setSel(""); }} options={[
                      { value: "invoice", label: `Invoices · ${payables.filter((p) => p.target.kind === "invoice").length}` },
                      { value: "visa", label: `Visa fees · ${payables.filter((p) => p.target.kind === "visa").length}` },
                    ]} />
                  )}
                  <SearchInput value={q} onChange={setQ} placeholder="Customer, invoice no., destination…" className="flex-1" />
                </div>
                <div role="radiogroup" aria-label="Choose what to collect for" className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                  {invoices.loading && !invoices.data ? (
                    [0, 1, 2].map((i) => <div key={i} className="skeleton h-[62px] rounded-xl" />)
                  ) : list.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-500">
                      {q ? `Nothing with money due matches “${q}”.` : kind === "invoice" ? "No invoices have money due. Nice work!" : "No visa cases have fees due."}
                    </div>
                  ) : list.map((p) => <PayableRow key={p.key} p={p} selected={sel === p.key} onSelect={() => { setSel(p.key); setMode("full"); setCustom(null); }} />)}
                </div>
              </>
            )}
          </section>

          {/* 2 — how much */}
          <section className={cx(!chosen && "pointer-events-none opacity-45")} aria-disabled={!chosen}>
            <StepTitle n={2} title="How much?" hint={chosen ? `${money(due)} is due` : undefined} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([["full", "Full balance", due], ["half", "50% advance", Math.round(due / 2)], ["quarter", "25% advance", Math.round(due / 4)], ["custom", "Custom", null]] as const).map(([m, label, v]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                  className={cx("rounded-xl border px-3 py-2.5 text-left transition", mode === m ? "border-brand-500 bg-brand-50/60 ring-[3px] ring-brand-100" : "border-line bg-white hover:border-line-strong")}>
                  <span className="block text-xs font-medium text-ink-500">{label}</span>
                  <span className="mt-0.5 block text-[15px] font-semibold tabular-nums text-ink-900">{v === null ? "Any amount" : money(v)}</span>
                </button>
              ))}
            </div>
            {mode === "custom" && (
              <Field label="Amount to collect" className="mt-3 max-w-xs" error={custom !== null && custom > due ? `Can't be more than the ${money(due)} due` : custom !== null && custom <= 0 ? "Enter an amount above zero" : undefined}>
                <MoneyInput value={custom} onChange={setCustom} invalid={customBad && custom !== null} aria-label="Custom amount" />
              </Field>
            )}
          </section>

          {/* 3 — how they pay */}
          <section className={cx(!chosen && "pointer-events-none opacity-45")}>
            <StepTitle n={3} title="How can they pay?" />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" role="radio" aria-checked={emi === 0} onClick={() => setEmi(0)}
                className={cx("flex items-start gap-3 rounded-xl border p-3 text-left transition", emi === 0 ? "border-brand-500 bg-brand-50/60 ring-[3px] ring-brand-100" : "border-line hover:border-line-strong")}>
                <IconChip tone="blue"><Wallet /></IconChip>
                <span><span className="block text-sm font-semibold text-ink-900">Customer chooses</span><span className="block text-xs leading-5 text-ink-500">UPI, cards, net banking — EMI offered on the page too</span></span>
              </button>
              <div className={cx("rounded-xl border p-3 transition", emi > 0 ? "border-brand-500 bg-brand-50/60 ring-[3px] ring-brand-100" : "border-line")}>
                <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setEmi(plans[0]?.months ?? 3)} role="radio" aria-checked={emi > 0}>
                  <IconChip tone="violet"><CalendarClock /></IconChip>
                  <span><span className="block text-sm font-semibold text-ink-900">Suggest an EMI plan</span><span className="block text-xs leading-5 text-ink-500">Opens the page on monthly instalments</span></span>
                </button>
                {emi > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    {plans.map((p) => (
                      <button key={p.months} type="button" onClick={() => setEmi(p.months)} aria-pressed={emi === p.months}
                        className={cx("rounded-lg border px-2.5 py-1.5 text-left", emi === p.months ? "border-brand-500 bg-white" : "border-line bg-white/60 hover:border-line-strong")}>
                        <span className="block text-xs text-ink-500">{p.months} months{p.noCost && <span className="ml-1 font-semibold text-emerald-700">no-cost</span>}</span>
                        <span className="block text-sm font-semibold tabular-nums">{money(p.monthly)}<span className="text-xs font-normal text-ink-500">/mo</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 4 — send */}
          <section className={cx(!chosen && "pointer-events-none opacity-45")}>
            <StepTitle n={4} title="Send it" />
            {chosen && !reachable ? (
              <Callout tone="warn">No phone or email on file for {chosen.name}. Create the link, then copy it or share it on WhatsApp from the next screen.</Callout>
            ) : (
              <div className="rounded-xl border border-line p-3">
                <Toggle checked={send} onChange={setSend} label={<span><span className="block text-sm font-medium text-ink-900">Send now on WhatsApp & email</span><span className="block text-xs text-ink-500">{chosen ? [chosen.phone, chosen.email].filter(Boolean).join(" · ") : "—"}</span></span>} />
                {send && chosen && (
                  <div className="mt-3 rounded-xl bg-[#e7f6e9] p-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800/70">Customer receives</div>
                    <div className="max-w-md rounded-lg rounded-tl-none bg-white px-3 py-2 text-[13px] leading-5 text-ink-800 shadow-xs">{preview}</div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* live summary */}
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-slate-50 to-white">
            <div className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Summary</div>
            <div className="space-y-4 p-4">
              {chosen ? (
                <>
                  <div className="flex items-center gap-3"><Avatar name={chosen.name} size={10} /><div className="min-w-0"><div className="truncate font-semibold text-ink-900">{chosen.name}</div><div className="truncate text-xs text-ink-500">{chosen.ref}</div></div></div>
                  <div>
                    <div className="text-xs text-ink-500">Customer pays</div>
                    <div className="text-[30px] font-semibold leading-tight tracking-tight tabular-nums text-ink-900">{money(amount)}</div>
                    {plan && <div className="text-sm text-violet-700">or {plan.months} × {money(plan.monthly)}{plan.noCost ? " (no-cost EMI)" : ""}</div>}
                  </div>
                  <dl className="space-y-1.5 text-[13px]">
                    <Row k="Balance due" v={money(due)} />
                    <Row k="After this payment" v={money(Math.max(0, due - amount))} />
                    <Row k="Methods" v={emi ? "EMI suggested" : "UPI · Card · Netbanking"} />
                    <Row k="Valid until" v={formatDate(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10))} />
                  </dl>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-ink-500"><span>Paid so far</span><span className="tabular-nums">{Math.round(chosen.paidPct)}%</span></div>
                    <Progress value={chosen.paidPct} tone="green" label="Paid so far" />
                  </div>
                  {chosen.hasOpenLink && <Callout tone="info">An unpaid link already exists for this. A new one works alongside it.</Callout>}
                </>
              ) : (
                <div className="py-8 text-center text-sm text-ink-500"><IconChip tone="gray" size="lg"><Landmark /></IconChip><p className="mt-3">Pick an invoice or visa fee to see what the customer will pay.</p></div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-white px-4 py-2.5 text-xs text-ink-500"><Smartphone className="size-3.5" />Opens on any phone — no app or login needed</div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-500">{k}</dt><dd className="text-right font-medium tabular-nums text-ink-900">{v}</dd></div>;
}

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string | undefined }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900"><span className="inline-flex size-5 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">{n}</span>{title}</h3>
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </div>
  );
}

function PayableRow({ p, selected, onSelect }: { p: Payable; selected: boolean; onSelect: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = p.target.kind === "invoice" && p.dueDate !== null && p.dueDate < today;
  const days = overdue && p.dueDate ? Math.round((Date.parse(today) - Date.parse(p.dueDate)) / 86_400_000) : 0;
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cx("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition", selected ? "border-brand-500 bg-brand-50/60 ring-[3px] ring-brand-100" : "border-line bg-white hover:border-line-strong hover:bg-slate-50/60")}>
      <span className={cx("inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-brand-600 bg-brand-600" : "border-ink-300")}>{selected && <span className="size-1.5 rounded-full bg-white" />}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-ink-900">{p.title}</span>{p.hasOpenLink && <Badge tone="blue">link sent</Badge>}</span>
        <span className="block truncate text-xs text-ink-500">{p.ref}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-ink-900">{money(p.due)}</span>
        <span className={cx("block text-[11px]", overdue ? "font-medium text-rose-600" : "text-ink-500")}>{overdue ? `${days} d overdue` : p.dueDate ? `${p.target.kind === "visa" ? "travels" : "due"} ${formatDate(p.dueDate)}` : "due"}</span>
      </span>
    </button>
  );
}

/** Drop-in button for invoice and visa screens. Opens the full create flow with that item already chosen. */
export function PaymentLinkButton({ invoiceId, visaCaseId, label = "Payment link" }: { invoiceId?: string; visaCaseId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const preset: Target | null = invoiceId ? { kind: "invoice", id: invoiceId } : visaCaseId ? { kind: "visa", id: visaCaseId } : null;
  return (
    <>
      <Button variant="secondary" size="sm" icon={<CreditCard className="size-4" />} onClick={() => setOpen(true)}>{label}</Button>
      <CreatePaymentLinkModal open={open} onClose={() => setOpen(false)} preset={preset} />
    </>
  );
}

/** Compact status line under a link: "Paid 2 h ago · UPI", "Expires in 3 d", … */
export function LinkStatusLine({ l }: { l: PaymentLink }) {
  const st = effectiveStatus(l);
  if (st === "paid") return <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" />Paid {relTime(l.paidAt)}{l.method ? ` · ${l.method === "upi" ? "UPI" : l.method === "emi" ? `EMI ${l.emiMonths}m` : l.method}` : ""}</span>;
  if (st === "created") { const e = expiresIn(l.expiresAt); return <span className={cx(e && e.endsWith("h") ? "font-medium text-amber-700" : "text-ink-500")}>{e ? `Expires in ${e}` : "Open"}</span>; }
  if (st === "expired") return <span className="text-ink-500">Expired {l.expiresAt ? relTime(l.expiresAt) : ""}</span>;
  return <span className="text-ink-500">Cancelled</span>;
}
