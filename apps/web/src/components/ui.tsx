import {
  Component, forwardRef, useEffect, useId, useMemo, useState, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes,
  type MouseEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronDown, ChevronUp, Info, Inbox, Loader2, Search, X, XCircle } from "lucide-react";
import { dismiss, toast, type Toast } from "../lib/toast";
import { titleCase } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ─────────── Buttons ─────────── */
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "soft";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-brand-700",
  secondary: "bg-white text-ink-800 ring-1 ring-inset ring-line-strong shadow-xs hover:bg-slate-50 hover:ring-ink-300",
  ghost: "text-ink-700 hover:bg-slate-100 hover:text-ink-900",
  danger: "bg-rose-600 text-white shadow-xs hover:bg-rose-700",
  success: "bg-emerald-600 text-white shadow-xs hover:bg-emerald-700",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100",
};
const BTN_SIZE = { sm: "h-8 px-3 text-[13px] rounded-lg", md: "h-10 px-4 text-sm rounded-lg", lg: "h-12 px-6 text-[15px] rounded-xl" } as const;
const BTN_BASE = "inline-flex items-center justify-center gap-2 font-medium transition-[background-color,box-shadow,transform,color] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 whitespace-nowrap select-none";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; busy?: boolean; icon?: ReactNode }>(
  ({ variant = "primary", size = "md", busy, icon, className, children, disabled, type = "button", ...rest }, ref) => (
    <button ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={cx(BTN_BASE, BTN_SIZE[size], BTN[variant], className)} {...rest}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export function ButtonLink({ to, variant = "primary", size = "md", className, children, icon }: { to: string; variant?: BtnVariant; size?: "sm" | "md" | "lg"; className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link to={to} className={cx(BTN_BASE, BTN_SIZE[size], BTN[variant], className)}>
      {icon}
      {children}
    </Link>
  );
}

/** Square icon-only button with an accessible name. */
export function IconButton({ label, children, onClick, className, tone = "ghost" }: { label: string; children: ReactNode; onClick?: (e: MouseEvent) => void; className?: string; tone?: "ghost" | "secondary" }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-500 transition-colors hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-600", tone === "secondary" ? "bg-white ring-1 ring-inset ring-line-strong hover:bg-slate-50" : "hover:bg-slate-100", className)}>
      {children}
    </button>
  );
}

/* ─────────── Layout bits ─────────── */
export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx("rounded-xl border border-line bg-white shadow-card", padded && "p-4 sm:p-5", className)}>{children}</div>;
}

export function CardTitle({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-400">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-ink-500 transition-colors hover:text-brand-700">
            <span aria-hidden>←</span> {back.label}
          </Link>
        )}
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[26px]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Coloured rounded square holding an icon — the visual anchor for stats and list rows. */
export function IconChip({ children, tone = "blue", size = "md" }: { children: ReactNode; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const c = { gray: "bg-slate-100 text-slate-600", blue: "bg-brand-50 text-brand-600", green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", red: "bg-rose-50 text-rose-600", violet: "bg-violet-50 text-violet-600", cyan: "bg-cyan-50 text-cyan-700" }[tone];
  const s = { sm: "size-7 rounded-lg [&_svg]:size-3.5", md: "size-9 rounded-xl [&_svg]:size-[18px]", lg: "size-11 rounded-xl [&_svg]:size-5" }[size];
  return <span className={cx("inline-flex shrink-0 items-center justify-center", c, s)} aria-hidden>{children}</span>;
}

export function Stat({ label, value, hint, tone = "default", icon, to, trend }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad"; icon?: ReactNode; to?: string; trend?: { value: string; up: boolean; good?: boolean } }) {
  const toneCls = { default: "text-ink-900", good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-700" }[tone];
  const chipTone: Tone = { default: "blue", good: "green", warn: "amber", bad: "red" }[tone] as Tone;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-500">{label}</span>
        {icon && <IconChip tone={chipTone} size="sm">{icon}</IconChip>}
      </div>
      <div className={cx("mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums", toneCls)}>{value}</div>
      {(hint || trend) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          {trend && (
            <span className={cx("inline-flex items-center gap-0.5 font-medium", (trend.good ?? trend.up) ? "text-emerald-700" : "text-rose-700")}>
              {trend.up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{trend.value}
            </span>
          )}
          {hint}
        </div>
      )}
    </>
  );
  const cls = "group block rounded-xl border border-line bg-white p-4 shadow-card";
  return to ? <Link to={to} className={cx(cls, "transition hover:-translate-y-px hover:border-brand-200 hover:shadow-lift")}>{body}</Link> : <div className={cls}>{body}</div>;
}

/* ─────────── Badges ─────────── */
type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet" | "cyan";
export type { Tone };
const TONE: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200/80",
  blue: "bg-blue-50 text-blue-700 ring-blue-200/80",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200/80",
  amber: "bg-amber-50 text-amber-800 ring-amber-200/80",
  red: "bg-rose-50 text-rose-700 ring-rose-200/80",
  violet: "bg-violet-50 text-violet-700 ring-violet-200/80",
  cyan: "bg-cyan-50 text-cyan-800 ring-cyan-200/80",
};
const DOT: Record<Tone, string> = { gray: "bg-slate-400", blue: "bg-blue-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", violet: "bg-violet-500", cyan: "bg-cyan-500" };

export function Badge({ tone = "gray", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONE[tone], className)}>
      {dot && <span className={cx("size-1.5 rounded-full", DOT[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** One colour vocabulary for every status in the product (leads, quotes, bookings, invoices, visa…). */
const STATUS_TONE: Record<string, Tone> = {
  new: "blue", contacted: "cyan", quoted: "violet", negotiation: "amber", won: "green", lost: "gray",
  draft: "gray", sent: "blue", viewed: "violet", accepted: "green", rejected: "red", expired: "gray",
  confirmed: "green", in_progress: "blue", completed: "gray", cancelled: "red",
  pending: "amber", requested: "cyan",
  issued: "blue", partially_paid: "amber", paid: "green", open: "amber",
  enquiry: "gray", docs_pending: "amber", docs_received: "cyan", submitted: "blue", in_process: "violet", approved: "green", delivered: "gray",
  hot: "red", warm: "amber", cold: "blue", scheduled: "cyan", closed: "gray", departed: "gray",
  active: "green", inactive: "gray", blocked: "red",
  held: "amber", failed: "red", queued: "amber", skipped: "gray", read: "green", ticketed: "green", booked: "cyan",
  answered: "green", missed: "red", no_answer: "amber", busy: "amber", voicemail: "gray", in_review: "violet",
  reversed: "gray", accrued: "amber", created: "blue", converted: "green", released: "gray", started: "blue", assigned: "gray", issue: "red",
};
export const statusTone = (status: string): Tone => STATUS_TONE[status] ?? "gray";

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"} dot>{label ?? titleCase(status)}</Badge>;
}

/* ─────────── Form controls ─────────── */
const inputCls = "block w-full rounded-lg border border-line-strong bg-white px-3 text-sm text-ink-900 shadow-xs transition-[border-color,box-shadow] placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 focus:outline-none disabled:bg-slate-50 disabled:text-ink-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...rest }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={cx(inputCls, "h-10", invalid && "border-rose-400 focus:border-rose-500 focus:ring-rose-100", className)} {...rest} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ className, invalid, ...rest }, ref) => (
  <textarea ref={ref} aria-invalid={invalid || undefined} className={cx(inputCls, "py-2 min-h-[84px] leading-6", invalid && "border-rose-400", className)} {...rest} />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(({ className, invalid, children, ...rest }, ref) => (
  <select ref={ref} aria-invalid={invalid || undefined} className={cx(inputCls, "select-chevron h-10 cursor-pointer pr-9", invalid && "border-rose-400", className)} {...rest}>
    {children}
  </select>
));
Select.displayName = "Select";

/** Search box with a magnifier; used in toolbars. */
export function SearchInput({ value, onChange, placeholder = "Search…", className, label = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <Input aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9 pr-8" />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:text-ink-700"><X className="size-4" /></button>}
    </div>
  );
}

export function Field({ label, error, hint, children, className, required }: { label: ReactNode; error?: string | undefined; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-700">{label}{required && <span className="text-rose-600"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 flex items-center gap-1 text-xs text-rose-600"><XCircle className="size-3" />{error}</span> : hint ? <span className="mt-1 block text-xs leading-5 text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 text-left text-sm text-ink-700 disabled:opacity-50">
      <span className={cx("relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-slate-300")}>
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

/** Pill-style single choice (view switchers, filters, amount presets). */
export function Segmented<T extends string | number>({ options, value, onChange, size = "md", className, label }: { options: { value: T; label: ReactNode; hint?: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; className?: string; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-lg bg-slate-100 p-0.5", className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("flex-1 whitespace-nowrap rounded-md font-medium transition-all", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]", value === o.value ? "bg-white text-ink-900 shadow-card" : "text-ink-500 hover:text-ink-800")}>
          {o.label}
          {o.hint && <span className="block text-[11px] font-normal text-ink-500">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Money input that shows rupees and stores paise. */
export function MoneyInput({ value, onChange, invalid, placeholder, currency = "INR", ...rest }: { value: number | null | undefined; onChange: (minor: number | null) => void; invalid?: boolean; placeholder?: string; currency?: string; disabled?: boolean; id?: string; "aria-label"?: string }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value / 100));
  useEffect(() => {
    const cur = text === "" ? null : Math.round(Number(text) * 100);
    if (cur !== (value ?? null)) setText(value === null || value === undefined ? "" : String(value / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-400">{currency === "INR" ? "₹" : currency}</span>
      <Input
        {...rest}
        inputMode="decimal"
        invalid={invalid}
        placeholder={placeholder ?? "0"}
        className={cx("tabular-nums", currency === "INR" ? "pl-7" : "pl-12")}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setText(t);
          if (t === "") onChange(null);
          else if (!Number.isNaN(Number(t))) onChange(Math.round(Number((Number(t) * 100).toFixed(4))));
        }}
      />
    </div>
  );
}

/* ─────────── Modal (bottom sheet on phones) ─────────── */
export function Modal({ open, onClose, title, children, footer, size = "md", description }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; description?: ReactNode }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" }[size];
  // Portalled to <body> so no parent's stacking context (sticky headers, animated cards) can sit on top of it
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className={cx("flex max-h-[94vh] w-full animate-slide-up flex-col rounded-t-2xl bg-white shadow-pop sm:max-h-[90vh] sm:animate-pop-in sm:rounded-2xl", w)}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3.5 pt-3 sm:pt-4">
          <div className="min-w-0">
            <h2 id={id} className="text-base font-semibold tracking-[-0.01em] text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
          </div>
          <button onClick={onClose} className="-mr-1 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-slate-100 hover:text-ink-700" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="pb-safe flex flex-wrap justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-sm leading-6 text-ink-700">{message}</div>
    </Modal>
  );
}

/* ─────────── Tabs ─────────── */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="no-scrollbar -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cx("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-2 text-sm font-medium transition-colors", value === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:border-line-strong hover:text-ink-800")}>
          {t.label}
          {t.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", value === t.key ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-ink-600")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ─────────── Data table (cards on phones) ─────────── */
export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide on the phone card layout */
  hideOnMobile?: boolean;
}

export function DataTable<T extends { id: string }>({ rows, columns, onRowClick, search, empty, initialSort, pageSize = 25, toolbar }: {
  rows: T[]; columns: Column<T>[]; onRowClick?: (row: T) => void; search?: (row: T) => string; empty?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" }; pageSize?: number; toolbar?: ReactNode;
}) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => (search ? params.get("q") ?? "" : ""));
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    let r = rows;
    if (q && search) {
      const needle = q.toLowerCase();
      r = r.filter((x) => search(x).toLowerCase().includes(needle));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sort) {
        const f = col.sort;
        r = [...r].sort((a, b) => {
          const va = f(a);
          const vb = f(b);
          const c = va < vb ? -1 : va > vb ? 1 : 0;
          return sort.dir === "asc" ? c : -c;
        });
      }
    }
    return r;
  }, [rows, q, search, sort, columns]);
  useEffect(() => setPage(0), [q]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const view = filtered.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div>
      {(search || toolbar) && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {search ? <SearchInput value={q} onChange={setQ} className="w-full sm:max-w-xs" /> : <span />}
          {toolbar && <div className="flex flex-wrap gap-2">{toolbar}</div>}
        </div>
      )}
      {filtered.length === 0 ? (
        <Empty>{q ? `Nothing matches "${q}".` : empty ?? "Nothing here yet."}</Empty>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white shadow-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={cx("px-4 py-2.5", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                      {c.sort ? (
                        <button className="inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-ink-800" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>
                          {c.header}
                          {sort?.key === c.key ? (sort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : <ChevronDown className="size-3 opacity-30" />}
                        </button>
                      ) : c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/80">
                {view.map((r) => (
                  <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx("transition-colors", onRowClick && "cursor-pointer hover:bg-brand-50/40")}>
                    {columns.map((c) => (
                      <td key={c.key} className={cx("px-4 py-3 align-middle text-ink-800", c.align === "right" && "text-right tabular-nums", c.align === "center" && "text-center", c.className)}>{c.render(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {view.map((r) => (
              <div key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx("rounded-xl border border-line bg-white p-3.5 shadow-card", onRowClick && "active:bg-slate-50")}>
                {columns.filter((c) => !c.hideOnMobile).map((c, i) => (
                  <div key={c.key} className={cx("flex items-start justify-between gap-3 text-sm", i > 0 && "mt-1.5")}>
                    {i > 0 && <span className="shrink-0 text-xs text-ink-500">{c.header}</span>}
                    <span className={cx(i === 0 ? "font-medium text-ink-900" : "text-right text-ink-800")}>{c.render(r)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[13px] text-ink-500">
            <span className="tabular-nums">{filtered.length} {filtered.length === 1 ? "record" : "records"}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="tabular-nums">Page {page + 1} of {pages}</span>
                <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────── States ─────────── */
export function Empty({ children, action, icon, title }: { children: ReactNode; action?: ReactNode; icon?: ReactNode; title?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-white/70 px-6 py-10 text-center">
      <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-slate-100 text-ink-400 [&_svg]:size-5">{icon ?? <Inbox />}</span>
      {title && <div className="mb-1 text-sm font-semibold text-ink-800">{title}</div>}
      <div className="max-w-sm text-sm text-ink-500">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500" role="status">
      <Loader2 className="size-5 animate-spin text-brand-500" /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-lg", className)} aria-hidden />;
}

export function Progress({ value, tone = "blue", className, label }: { value: number; tone?: Tone; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-slate-100", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", DOT[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-white px-1 font-sans text-[11px] font-medium text-ink-500 shadow-xs">{children}</kbd>;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <div className="flex items-start gap-2"><XCircle className="mt-0.5 size-4 shrink-0" /> <span>{message}</span></div>
      {onRetry && <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "good" | "bad"; title?: ReactNode; children: ReactNode }) {
  const map = {
    info: ["border-blue-200/80 bg-blue-50/80 text-blue-900", <Info key="i" className="mt-0.5 size-4 shrink-0 text-blue-600" />],
    warn: ["border-amber-200/80 bg-amber-50/80 text-amber-900", <AlertTriangle key="w" className="mt-0.5 size-4 shrink-0 text-amber-600" />],
    good: ["border-emerald-200/80 bg-emerald-50/80 text-emerald-900", <CheckCircle2 key="g" className="mt-0.5 size-4 shrink-0 text-emerald-600" />],
    bad: ["border-rose-200/80 bg-rose-50/80 text-rose-900", <XCircle key="b" className="mt-0.5 size-4 shrink-0 text-rose-600" />],
  } as const;
  const [cls, icon] = map[tone];
  return (
    <div className={cx("flex gap-2.5 rounded-xl border p-3 text-sm leading-6", cls)}>
      {icon}
      <div className="min-w-0">{title && <div className="font-semibold">{title}</div>}{children}</div>
    </div>
  );
}

export function Avatar({ name, size = 8 }: { name: string; size?: 6 | 8 | 10 | 12 | 16 }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const dim = { 6: "size-6 text-[10px]", 8: "size-8 text-xs", 10: "size-10 text-sm", 12: "size-12 text-base", 16: "size-16 text-xl" }[size];
  return <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white", dim)} style={{ background: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 28) % 360} 58% 40%))` }} aria-hidden>{ini}</span>;
}

/* ─────────── Toasts ─────────── */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => toast.subscribe(setItems), []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:items-end" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-800 shadow-pop">
          {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-emerald-600" /> : t.kind === "error" ? <XCircle className="mt-0.5 size-[18px] shrink-0 text-rose-600" /> : <Info className="mt-0.5 size-[18px] shrink-0 text-brand-600" />}
          <span className="flex-1 leading-5">{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-ink-400 hover:text-ink-700"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}

/* ─────────── Error boundary: one broken widget never blanks the app ─────────── */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="p-6"><ErrorNote message={`This screen hit a problem: ${this.state.error.message}. Your data is safe.`} onRetry={() => this.setState({ error: null })} /></div>
      );
    }
    return this.props.children;
  }
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-dashed border-line py-1.5 sm:block sm:border-0 sm:py-0">
          <dt className="text-[13px] text-ink-500">{k}</dt>
          <dd className="text-right font-medium text-ink-900 sm:mt-0.5 sm:text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
