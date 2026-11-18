import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlarmClock, BellRing, CheckCircle2, Clock3, Copy, CreditCard, ExternalLink, Link2, MessageCircle, MoreHorizontal, Plus, TrendingUp, XCircle, Zap } from "lucide-react";
import { formatDate, type PaymentLink } from "@voyadesk/core";
import { money, relTime } from "../../lib/format";
import { useAction, useList } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { copyText } from "../../lib/toast";
import {
  CreatePaymentLinkModal, LINK_STATUS_LABEL, LinkStatusLine, PURPOSE_LABEL, effectiveStatus, expiresIn, outstanding, paylinkUrl, reminderText, waUrl,
} from "../../components/paylinks";
import { Avatar, Badge, Button, Card, CardTitle, Confirm, Empty, ErrorNote, IconButton, PageHeader, SearchInput, Skeleton, Stat, StatusBadge, cx } from "../../components/ui";

type Filter = "all" | "created" | "paid" | "closed";
const DAY = 86_400_000;

export function PaymentLinksPage() {
  const [params, setParams] = useSearchParams();
  const { user, settings } = useSession();
  const links = useList("paymentLinks");
  const invoices = useList("invoices");
  const { act, busy } = useAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(30);
  const [cancel, setCancel] = useState<PaymentLink | null>(null);
  const [preset, setPreset] = useState<{ kind: "invoice"; id: string } | null>(null);
  const canCancel = ["owner", "admin", "accounts"].includes(user?.role ?? "");
  const company = settings?.companyName ?? "";

  const createOpen = params.get("new") === "1" || preset !== null;
  const openCreate = (invoiceId?: string) => { if (invoiceId) setPreset({ kind: "invoice", id: invoiceId }); else setParams({ new: "1" }); };
  const closeCreate = () => { setPreset(null); if (params.get("new")) setParams({}); };

  const all = useMemo(() => [...(links.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [links.data]);

  const stats = useMemo(() => {
    const now = Date.now();
    const paid = all.filter((l) => l.status === "paid");
    const paid30 = paid.filter((l) => l.paidAt && now - Date.parse(l.paidAt) < 30 * DAY);
    const open = all.filter((l) => effectiveStatus(l, now) === "created");
    const expiring = open.filter((l) => l.expiresAt && Date.parse(l.expiresAt) - now < 2 * DAY);
    const decided = all.filter((l) => effectiveStatus(l, now) !== "created");
    const hours = paid.filter((l) => l.paidAt).map((l) => (Date.parse(l.paidAt!) - Date.parse(l.createdAt)) / 3_600_000).sort((a, b) => a - b);
    const median = hours.length ? hours[Math.floor(hours.length / 2)]! : null;
    return {
      collected30: paid30.reduce((a, l) => a + l.amount, 0), paid30: paid30.length,
      openAmt: open.reduce((a, l) => a + l.amount, 0), open: open.length,
      expiring: expiring.length, expiringAmt: expiring.reduce((a, l) => a + l.amount, 0),
      rate: decided.length ? Math.round((paid.length / decided.length) * 100) : null,
      median,
    };
  }, [all]);

  // Invoices with money due and no live link: the next people to ask for money
  const unlinked = useMemo(() => {
    const live = new Set(all.filter((l) => effectiveStatus(l) === "created").map((l) => l.invoiceId));
    const today = new Date().toISOString().slice(0, 10);
    return (invoices.data ?? [])
      .filter((i) => outstanding(i) > 0 && i.status !== "cancelled" && !live.has(i.id))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => ({ ...i, overdue: i.dueDate < today }));
  }, [invoices.data, all]);

  const counts = useMemo(() => ({
    all: all.length,
    created: all.filter((l) => effectiveStatus(l) === "created").length,
    paid: all.filter((l) => l.status === "paid").length,
    closed: all.filter((l) => ["expired", "cancelled"].includes(effectiveStatus(l))).length,
  }), [all]);

  const rows = all.filter((l) => {
    const st = effectiveStatus(l);
    const okF = filter === "all" || (filter === "closed" ? st === "expired" || st === "cancelled" : st === filter);
    return okF && (!q || `${l.customerName} ${l.phone} ${l.email} ${PURPOSE_LABEL[l.purpose]} ${l.provider}`.toLowerCase().includes(q.toLowerCase()));
  });

  const mode = all[0]?.provider;

  return (
    <div className="space-y-6">
      <PageHeader title="Payment links" subtitle={<span className="inline-flex flex-wrap items-center gap-2">Collect by UPI, cards, net banking and EMI. Paid links settle the invoice on their own.
        {mode && (mode === "sandbox" ? <Badge tone="cyan" dot>Test mode</Badge> : <Badge tone="green" dot>Live · {mode}</Badge>)}</span>}
        actions={<Button icon={<Plus className="size-4" />} onClick={() => openCreate()}>New payment link</Button>} />

      {links.error && !links.data ? <ErrorNote message={links.error.message} onRetry={links.reload} /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {!links.data ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[108px] rounded-xl" />) : <>
            <Stat label="Collected · 30 days" value={money(stats.collected30)} tone="good" icon={<TrendingUp />} hint={`${stats.paid30} payment${stats.paid30 === 1 ? "" : "s"} via links`} />
            <Stat label="Awaiting payment" value={money(stats.openAmt)} icon={<Clock3 />} hint={`${stats.open} open link${stats.open === 1 ? "" : "s"}`} />
            <Stat label="Expiring in 48 h" value={stats.expiring} tone={stats.expiring ? "warn" : "default"} icon={<AlarmClock />} hint={stats.expiring ? `${money(stats.expiringAmt)} — send a reminder` : "Nothing about to lapse"} />
            <Stat label="Paid rate" value={stats.rate === null ? "—" : `${stats.rate}%`} icon={<Zap />} hint={stats.rate === null ? "No links have closed yet" : stats.median === null ? "of links that closed" : `Typically paid in ${stats.median < 1 ? "under an hour" : stats.median < 24 ? `${Math.round(stats.median)} h` : `${Math.round(stats.median / 24)} d`}`} />
          </>}
        </div>
      )}

      {unlinked.length > 0 && (
        <Card>
          <CardTitle icon={<BellRing className="size-[18px]" />} title="Ready to collect" subtitle={`${unlinked.length} invoice${unlinked.length === 1 ? " has" : "s have"} money due and no open link · ${money(unlinked.reduce((a, i) => a + outstanding(i), 0))} in total`} />
          <ul className="-mx-1 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unlinked.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                <Avatar name={i.partyName} />
                <div className="min-w-0 flex-1">
                  <Link to={`/app/finance/invoices/${i.id}`} className="block truncate text-sm font-semibold text-ink-900 hover:text-brand-700">{i.partyName}</Link>
                  <div className="truncate text-xs text-ink-500"><span className="tabular-nums">{money(outstanding(i))}</span> · <span className={i.overdue ? "font-medium text-rose-600" : ""}>{i.overdue ? "overdue since" : "due"} {formatDate(i.dueDate)}</span></div>
                </div>
                <Button size="sm" variant="soft" icon={<CreditCard className="size-3.5" />} onClick={() => openCreate(i.id)}>Collect</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Filter links" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
            {([["all", "All"], ["created", "Awaiting"], ["paid", "Paid"], ["closed", "Expired & cancelled"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => { setFilter(k); setLimit(30); }}
                className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition", filter === k ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-line hover:text-ink-900")}>
                {label}<span className={cx("tabular-nums text-xs", filter === k ? "text-white/70" : "text-ink-400")}>{counts[k]}</span>
              </button>
            ))}
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Customer, phone, gateway…" className="w-full sm:max-w-xs" />
        </div>

        {!links.data ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}</div>
        ) : rows.length === 0 ? (
          <Empty icon={<Link2 />} title={all.length ? "No links here" : "No payment links yet"} action={!all.length ? <Button icon={<Plus className="size-4" />} onClick={() => openCreate()}>Create your first link</Button> : undefined}>
            {q ? `Nothing matches “${q}”.` : all.length ? "Try another filter." : "Send a link and get paid by UPI, card or EMI in minutes — no app or login for your customer."}
          </Empty>
        ) : (
          <div className="rounded-xl border border-line bg-white shadow-card">
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-4 rounded-t-xl border-b border-line bg-slate-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500 md:grid">
              <span>Customer</span><span className="text-right">Amount</span><span>Status</span><span className="w-[120px] text-right">Actions</span>
            </div>
            <ul className="divide-y divide-line/80">
              {rows.slice(0, limit).map((l) => <LinkRow key={l.id} l={l} company={company} canCancel={canCancel} onCancel={() => setCancel(l)} />)}
            </ul>
            {rows.length > limit && <div className="border-t border-line p-2 text-center"><Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 30)}>Show {Math.min(30, rows.length - limit)} more</Button></div>}
          </div>
        )}
      </div>

      <CreatePaymentLinkModal open={createOpen} onClose={closeCreate} preset={preset} />
      <Confirm open={cancel !== null} onClose={() => setCancel(null)} danger busy={busy} title="Cancel this payment link?" confirmLabel="Cancel link"
        message={cancel && <>The link for <b>{money(cancel.amount)}</b> to {cancel.customerName || "the customer"} will stop working immediately. If they open it they'll be asked to contact you for a new one.</>}
        onConfirm={async () => { if (!cancel) return; const r = await act("cancelPaymentLink", { linkId: cancel.id }, "Link cancelled"); if (r) setCancel(null); }} />
    </div>
  );
}

function LinkRow({ l, company, canCancel, onCancel }: { l: PaymentLink; company: string; canCancel: boolean; onCancel: () => void }) {
  const [menu, setMenu] = useState(false);
  const st = effectiveStatus(l);
  const live = st === "created";
  const urgent = live && (expiresIn(l.expiresAt)?.endsWith("h") ?? false);
  const target = l.invoiceId ? `/app/finance/invoices/${l.invoiceId}` : l.visaCaseId ? `/app/visa/${l.visaCaseId}` : null;
  return (
    <li className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-slate-50/60 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]", urgent && "bg-amber-50/40")}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative">
          <Avatar name={l.customerName || "?"} />
          <span className={cx("absolute -bottom-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full ring-2 ring-white",
            st === "paid" ? "bg-emerald-500 text-white" : st === "created" ? "bg-brand-500 text-white" : "bg-slate-300 text-white")}>
            {st === "paid" ? <CheckCircle2 className="size-3" /> : st === "created" ? <Clock3 className="size-2.5" /> : <XCircle className="size-3" />}
          </span>
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-900">{l.customerName || "Customer"}</div>
          <div className="truncate text-xs text-ink-500">{PURPOSE_LABEL[l.purpose]} · created {relTime(l.createdAt)}{l.provider === "sandbox" ? " · test" : ""}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums text-ink-900">{money(l.amount, l.currency)}</div>
        {l.emiMonths > 0 && <div className="text-[11px] text-violet-700">EMI {l.emiMonths} months</div>}
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs md:col-span-1">
        <StatusBadge status={st} label={LINK_STATUS_LABEL[st]} />
        <LinkStatusLine l={l} />
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-1 md:w-[120px]">
        {live && <>
          <IconButton label="Copy link" onClick={() => void copyText(paylinkUrl(l))}><Copy className="size-4" /></IconButton>
          <a href={waUrl(l.phone, reminderText(l, company))} target="_blank" rel="noreferrer" aria-label="Remind on WhatsApp" title="Remind on WhatsApp"
            className="inline-flex size-8 items-center justify-center rounded-lg text-emerald-600 transition-colors hover:bg-emerald-50"><MessageCircle className="size-4" /></a>
        </>}
        <div className="relative">
          <IconButton label="More actions" onClick={() => setMenu((m) => !m)}><MoreHorizontal className="size-4" /></IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute right-0 z-40 mt-1 w-52 animate-pop-in rounded-xl border border-line bg-white p-1 text-sm shadow-pop">
                <a role="menuitem" href={paylinkUrl(l)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"><ExternalLink className="size-4 text-ink-400" />Open payment page</a>
                {target && <Link role="menuitem" to={target} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"><Link2 className="size-4 text-ink-400" />Open {l.visaCaseId ? "visa case" : "invoice"}</Link>}
                {live && canCancel && <button role="menuitem" onClick={() => { setMenu(false); onCancel(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-700 hover:bg-rose-50"><XCircle className="size-4" />Cancel link</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
