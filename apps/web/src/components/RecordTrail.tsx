import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Briefcase, Check, CircleDollarSign, FileText, Receipt, User, Users } from "lucide-react";
import { formatDate } from "@voyadesk/core";
import { useChain, type Anchor, type Chain } from "../lib/graph";
import { useRecent, type RecentItem } from "../lib/recent";
import { money } from "../lib/format";
import { Skeleton, StatusBadge, cx } from "./ui";

type StepKey = "contact" | "lead" | "quote" | "booking" | "invoice" | "paid";

interface Step {
  key: StepKey;
  label: string;
  icon: ReactNode;
  done: boolean;
  title?: ReactNode;
  meta?: ReactNode;
  to?: string;
  empty: string;
}

function recentFor(c: Chain, a: Anchor, current: StepKey, to: string): Omit<RecentItem, "at"> | null {
  const who = c.contact?.name ?? c.lead?.name ?? c.booking?.contactName ?? "";
  if (a.kind === "visa") return { to, kind: "Visa case", label: who || "Visa case", hint: "Visa desk" };
  switch (current) {
    case "lead": return c.lead ? { to, kind: "Lead", label: c.lead.name, hint: c.lead.destination || c.lead.service } : null;
    case "quote": { const q = c.quotes.find((x) => to.endsWith(x.id)) ?? c.quotes[0]; return q ? { to, kind: "Quote", label: `${q.number || "Draft quote"} · ${q.contactName}`, hint: q.destination || q.title } : null; }
    case "booking": return c.booking ? { to, kind: "Booking", label: `${c.booking.number} · ${c.booking.contactName}`, hint: c.booking.destination || c.booking.title } : null;
    case "invoice": return c.invoice ? { to, kind: "Invoice", label: `${c.invoice.number} · ${c.invoice.partyName}`, hint: money(c.invoice.total) } : null;
    default: return null;
  }
}

/**
 * The journey strip shown at the top of every record: Customer → Enquiry → Quote → Booking → Invoice → Paid.
 * Each step links to its record, so staff can move along the trip in one click instead of hunting in lists.
 */
export function RecordTrail({ anchor, current }: { anchor: Anchor; current: StepKey }) {
  const { chain, graph } = useChain(anchor);
  const loc = useLocation();
  useRecent(chain ? recentFor(chain, anchor, current, loc.pathname) : null);
  if (!chain) {
    return <div className="no-print mb-5 flex gap-2 overflow-hidden">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[74px] min-w-[150px] flex-1 rounded-xl" />)}</div>;
  }
  const { contact, lead, quotes, booking, invoice, payments } = chain;
  const q = quotes.find((x) => x.status === "accepted") ?? quotes[0] ?? null;
  const due = invoice ? Math.max(0, invoice.total - invoice.paid - invoice.credited) : 0;
  const paidPct = invoice && invoice.total > 0 ? Math.min(100, Math.round(((invoice.paid + invoice.credited) / invoice.total) * 100)) : 0;

  const steps: Step[] = [
    graph.can("contacts") && {
      key: "contact", label: "Customer", icon: <User />, done: Boolean(contact), empty: "No profile yet",
      title: contact?.name, meta: contact ? `${contact.trips} trip${contact.trips === 1 ? "" : "s"} · ${money(contact.totalSpend)}` : undefined,
      to: contact ? `/app/contacts/${contact.id}` : undefined,
    },
    graph.can("leads") && {
      key: "lead", label: "Enquiry", icon: <Users />, done: Boolean(lead), empty: "Direct booking",
      title: lead ? (lead.destination || lead.service) : undefined, meta: lead ? <StatusBadge status={lead.stage} /> : undefined,
      to: lead ? `/app/leads/${lead.id}` : undefined,
    },
    graph.can("quotes") && {
      key: "quote", label: quotes.length > 1 ? `Quote · ${quotes.length} versions` : "Quote", icon: <FileText />, done: Boolean(q), empty: "Not quoted yet",
      title: q ? (q.number || "Draft") : undefined, meta: q ? <span className="inline-flex items-center gap-1.5"><StatusBadge status={q.status} /><span className="text-xs tabular-nums text-ink-500">{money(q.total)}</span></span> : undefined,
      to: q ? `/app/quotes/${q.id}` : undefined,
    },
    graph.can("bookings") && {
      key: "booking", label: "Booking", icon: <Briefcase />, done: Boolean(booking), empty: "Not booked yet",
      title: booking ? booking.number : undefined, meta: booking ? <span className="inline-flex items-center gap-1.5"><StatusBadge status={booking.status} /><span className="text-xs text-ink-500">{formatDate(booking.startDate)}</span></span> : undefined,
      to: booking ? `/app/bookings/${booking.id}` : undefined,
    },
    graph.can("invoices") && {
      key: "invoice", label: "Invoice", icon: <Receipt />, done: Boolean(invoice), empty: "Raised on booking",
      title: invoice ? invoice.number : undefined, meta: invoice ? <span className="inline-flex items-center gap-1.5"><StatusBadge status={invoice.status} /><span className="text-xs tabular-nums text-ink-500">{money(invoice.total)}</span></span> : undefined,
      to: invoice ? `/app/finance/invoices/${invoice.id}` : undefined,
    },
    graph.can("invoices") && {
      key: "paid", label: payments.length ? `Paid · ${payments.length} payment${payments.length === 1 ? "" : "s"}` : "Payment", icon: <CircleDollarSign />,
      done: Boolean(invoice) && due === 0 && invoice!.status !== "cancelled", empty: "Nothing collected",
      title: invoice ? (due > 0 ? `${money(due)} due` : "Fully paid") : undefined,
      meta: invoice ? (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><span className={cx("block h-full rounded-full", due > 0 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${paidPct}%` }} /></span>
          <span className="text-xs tabular-nums text-ink-500">{paidPct}%</span>
        </span>
      ) : undefined,
      to: invoice ? `/app/finance/invoices/${invoice.id}` : undefined,
    },
  ].filter(Boolean) as Step[];

  return (
    <nav aria-label="Trip journey" className="no-print -mx-3 mb-5 overflow-x-auto px-3 pb-1 no-scrollbar sm:mx-0 sm:px-0">
      <ol className="flex min-w-max items-stretch gap-0 lg:min-w-0">
        {steps.map((s, i) => {
          const isCurrent = s.key === current;
          const reached = s.done || isCurrent;
          const body = (
            <>
              <span className="flex items-center gap-2">
                <span className={cx("inline-flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
                  isCurrent ? "bg-brand-600 text-white" : s.done ? "bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200" : "bg-slate-100 text-ink-400")}>
                  {s.done && !isCurrent ? <Check /> : s.icon}
                </span>
                <span className={cx("text-[11px] font-semibold uppercase tracking-[0.07em]", isCurrent ? "text-brand-700" : "text-ink-400")}>{s.label}</span>
              </span>
              {reached && s.title ? (
                <>
                  <span className="mt-1.5 block truncate text-[13px] font-semibold text-ink-900">{s.title}</span>
                  {s.meta && <span className="mt-1 block">{s.meta}</span>}
                </>
              ) : <span className="mt-1.5 block text-[13px] text-ink-400">{s.empty}</span>}
            </>
          );
          const cls = cx(
            "block h-full w-[168px] rounded-xl border px-3 py-2.5 text-left transition lg:w-auto lg:min-w-0 lg:flex-1",
            isCurrent ? "border-brand-300 bg-white shadow-card ring-2 ring-brand-100" : reached ? "border-line bg-white hover:-translate-y-px hover:border-brand-200 hover:shadow-lift" : "border-dashed border-line-strong bg-slate-50/60",
          );
          return (
            <li key={s.key} className="flex flex-1 items-center lg:min-w-0">
              {s.to && !isCurrent ? <Link to={s.to} className={cls}>{body}</Link> : <div className={cls} aria-current={isCurrent ? "step" : undefined}>{body}</div>}
              {i < steps.length - 1 && <span aria-hidden className={cx("h-0.5 w-4 shrink-0 sm:w-5", steps[i + 1]!.done || steps[i + 1]!.key === current ? "bg-emerald-300" : "bg-line-strong")} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
