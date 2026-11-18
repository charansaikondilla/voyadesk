import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, CheckCheck, Mail, MessageCircle, Minus, MoreHorizontal, Smartphone, Users } from "lucide-react";
import { canRead, canWrite, type AudiencePreview, type Collection } from "@voyadesk/core";
import { useReport, type QueryState } from "../../lib/hooks";
import { money } from "../../lib/format";
import type { Rule } from "./segmentRules";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Avatar, Badge, Button, IconButton, Skeleton, Textarea, cx, type Tone } from "../ui";

/* ───────────────────────── channels ───────────────────────── */

export type Channel = "whatsapp" | "email" | "sms";

export const CHANNEL: Record<Channel, { label: string; icon: ReactNode; tone: Tone; color: string; reach: string }> = {
  whatsapp: { label: "WhatsApp", icon: <MessageCircle />, tone: "green", color: "#059669", reach: "phone number" },
  email: { label: "Email", icon: <Mail />, tone: "blue", color: "#1d5fd1", reach: "email address" },
  sms: { label: "SMS", icon: <Smartphone />, tone: "violet", color: "#7c3aed", reach: "phone number" },
};

export function ChannelBadge({ channel }: { channel: Channel }) {
  const c = CHANNEL[channel];
  return <Badge tone={c.tone} className="[&_svg]:size-3">{c.icon}{c.label}</Badge>;
}

/* ───────────────────────── access ───────────────────────── */

/** What the signed-in user may see and change in Marketing. */
export function useAccess() {
  const { user } = useSession();
  const role = user?.role;
  const portal = role === "agent" || role === "driver";
  return {
    role,
    read: (c: Collection) => Boolean(role && canRead(role, c)),
    write: (c: Collection) => Boolean(role && !portal && canWrite(role, c)),
  };
}

/* ───────────────────────── placeholders ───────────────────────── */

export const PLACEHOLDER_HELP: Record<string, string> = {
  "{name}": "Customer's first name",
  "{company}": "Your agency name",
  "{link}": "Your website link (tracked)",
  "{destination}": "Destination they asked about",
};

export function fillPlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k.toLowerCase()] ?? m);
}

export function unknownPlaceholders(text: string, allowed: string[]): string[] {
  const found = text.match(/\{\w+\}/g) ?? [];
  return [...new Set(found.filter((t) => !allowed.includes(t.toLowerCase())))];
}

export const storeUrl = () => `${window.location.origin}${window.location.pathname}#/store/${api.tenantId}`;
export const landingUrl = (slug: string) => `${window.location.origin}${window.location.pathname}#/lp/${api.tenantId}/${slug}`;

/**
 * Message box with clickable placeholder chips (inserted at the cursor) and a live character / SMS-part count.
 */
export function MessageEditor({ value, onChange, tokens, channel, invalid, label = "Message", id, rows = 6, disabled }: {
  value: string; onChange: (v: string) => void; tokens: string[]; channel: Channel; invalid?: boolean; label?: string; id?: string; rows?: number; disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    if (pending.current !== null && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(pending.current, pending.current);
      pending.current = null;
    }
  }, [value]);
  const insert = (t: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${t}${value.slice(end)}`;
    pending.current = start + pad.length + t.length;
    onChange(next);
  };
  const len = value.length;
  const unicode = /[^\x00-\x7F₹]/.test(value);
  const per = unicode ? 70 : 160;
  const parts = Math.max(1, Math.ceil(len / per));
  const limit = channel === "whatsapp" ? 1024 : 2000;
  const unknown = unknownPlaceholders(value, tokens);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-700">{label}</label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Insert a placeholder">
          {tokens.map((t) => (
            <button key={t} type="button" disabled={disabled} onClick={() => insert(t)} title={PLACEHOLDER_HELP[t]} aria-label={`Insert ${t} — ${PLACEHOLDER_HELP[t] ?? ""}`}
              className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100 transition hover:bg-brand-100 disabled:opacity-50">
              + {t}
            </button>
          ))}
        </div>
      </div>
      <Textarea ref={ref} id={id} rows={rows} value={value} disabled={disabled} invalid={invalid} maxLength={limit} onChange={(e) => onChange(e.target.value)}
        placeholder={channel === "email" ? "Hi {name}, …" : "Hi {name}! …"} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <span>{unknown.length > 0 ? <span className="text-amber-700">{unknown.join(", ")} won't be filled in — use the chips above.</span> : "Placeholders are filled in for each person."}</span>
        <span className={cx("tabular-nums", len > limit * 0.9 && "text-amber-700")}>
          {len}/{limit}{channel === "sms" && len > 0 ? ` · ${parts} SMS${parts > 1 ? " parts" : ""}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── message preview (phone mock) ───────────────────────── */

export function MessagePreview({ channel, text, sender, subject, to, className }: { channel: Channel; text: string; sender: string; subject?: string; to?: string; className?: string }) {
  const time = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const body = text.trim() || "Your message will appear here.";
  const linkify = (s: string) => s.split(/(https?:\/\/\S+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <span key={i} className="break-all text-sky-700 underline">{p}</span> : <span key={i}>{p}</span>));
  if (channel === "email") {
    return (
      <div className={cx("overflow-hidden rounded-2xl border border-line bg-white shadow-card", className)} aria-label="Email preview">
        <div className="space-y-1 border-b border-line bg-slate-50 px-4 py-3 text-xs">
          <div className="flex gap-2"><span className="w-12 shrink-0 text-ink-400">From</span><span className="truncate font-medium text-ink-800">{sender}</span></div>
          <div className="flex gap-2"><span className="w-12 shrink-0 text-ink-400">To</span><span className="truncate text-ink-700">{to || "customer@example.com"}</span></div>
          <div className="flex gap-2"><span className="w-12 shrink-0 text-ink-400">Subject</span><span className="truncate font-semibold text-ink-900">{subject || "(no subject)"}</span></div>
        </div>
        <div className={cx("min-h-[160px] whitespace-pre-wrap break-words px-4 py-4 text-sm leading-6", text.trim() ? "text-ink-800" : "text-ink-400")}>{linkify(body)}</div>
        <div className="border-t border-line px-4 py-2 text-[11px] text-ink-400">Sent by {sender} · Unsubscribe</div>
      </div>
    );
  }
  const wa = channel === "whatsapp";
  return (
    <div className={cx("mx-auto w-full max-w-[300px] rounded-[28px] bg-ink-900 p-2 shadow-pop", className)} aria-label={`${CHANNEL[channel].label} preview`}>
      <div className="overflow-hidden rounded-[22px]">
        <div className={cx("flex items-center gap-2.5 px-3 py-2.5 text-white", wa ? "bg-[#075e54]" : "bg-slate-700")}>
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">{sender.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{sender}</div>
            <div className="text-[10.5px] text-white/70">{wa ? "Business account" : "Text message"}</div>
          </div>
        </div>
        <div className={cx("min-h-[230px] px-3 py-4", wa ? "bg-[#efeae2]" : "bg-white")}>
          <div className={cx("relative max-w-[88%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[13px] leading-5 shadow-xs", wa ? "rounded-tl-none bg-white text-ink-900" : "rounded-bl-none bg-slate-100 text-ink-900", !text.trim() && "text-ink-400")}>
            {linkify(body)}
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-ink-400">{time}{wa && <CheckCheck className="size-3 text-sky-500" />}</div>
          </div>
          {wa && <div className="mt-3 max-w-[88%] rounded-lg bg-white/70 px-3 py-1.5 text-center text-[11px] font-medium text-sky-700">Reply STOP to opt out</div>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── numbers ───────────────────────── */

/** Change vs the previous period, ready for <Stat trend>. */
export function trendOf(cur: number, prev: number, goodWhenUp = true): { value: string; up: boolean; good: boolean } | undefined {
  if (!prev && !cur) return undefined;
  if (!prev) return { value: "new", up: true, good: goodWhenUp };
  const d = Math.round(((cur - prev) / prev) * 100);
  return { value: `${Math.abs(d)}%`, up: d >= 0, good: d === 0 ? true : goodWhenUp ? d > 0 : d < 0 };
}

export function TrendArrow({ cur, prev, label }: { cur: number; prev: number; label?: string }) {
  if (!prev && !cur) return <Minus className="size-3.5 text-ink-300" aria-label="No change" />;
  const t = trendOf(cur, prev)!;
  const flat = t.value === "0%";
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", flat ? "text-ink-400" : t.up ? "text-emerald-700" : "text-rose-700")} title={label ?? `Previous period: ${prev}`}>
      {flat ? <Minus className="size-3.5" /> : t.up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{t.value}
    </span>
  );
}

/** ROI as +240%; very large returns read better as a multiple (e.g. 38× back). */
export const roiText = (r: number | null | undefined) => (r === null || r === undefined ? "—" : r >= 10_000 ? "100×+ back" : r >= 1000 ? `${Math.round(r / 100 + 1).toLocaleString("en-IN")}× back` : `${r > 0 ? "+" : ""}${r}%`);
export const bpsPct = (bps: number) => `${(bps / 100).toFixed(bps >= 1000 || bps % 100 === 0 ? 0 : 1)}%`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
export function minsText(m: number | null | undefined) {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 60 * 24) return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
  return `${Math.round(m / 1440)} d`;
}
export const hourText = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString("en-IN", { hour: "numeric" });

/* ───────────────────────── months ───────────────────────── */

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export function shiftMonth(key: string, by: number) {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return monthKey(new Date(y, m - 1 + by, 1));
}
export const monthLong = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

/** Debounce a value (live previews while typing). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ───────────────────────── small building blocks ───────────────────────── */

export function CardsSkeleton({ n = 3, h = "h-[148px]", cols = "md:grid-cols-2 xl:grid-cols-3" }: { n?: number; h?: string; cols?: string }) {
  return <div className={cx("grid gap-3", cols)}>{Array.from({ length: n }, (_, i) => <Skeleton key={i} className={cx(h, "rounded-xl")} />)}</div>;
}

export interface MenuItem { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean }

/** "⋯" overflow menu for card actions. */
export function RowMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const visible = items.filter((i) => !i.hidden);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (visible.length === 0) return null;
  return (
    <div className="relative">
      <IconButton label={label} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}><MoreHorizontal className="size-4" /></IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div role="menu" className="absolute right-0 z-40 mt-1 w-52 animate-pop-in rounded-xl border border-line bg-white p-1 text-sm shadow-pop">
            {visible.map((i) => (
              <button key={i.label} role="menuitem" type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); i.onClick(); }}
                className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left [&_svg]:size-4", i.danger ? "text-rose-700 hover:bg-rose-50" : "text-ink-800 hover:bg-slate-50 [&_svg]:text-ink-400")}>
                {i.icon}{i.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Filter pills with counts (same look as Payment links). */
export function FilterPills<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition", value === o.key ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-line hover:text-ink-900")}>
          {o.label}{o.count !== undefined && <span className={cx("tabular-nums text-xs", value === o.key ? "text-white/70" : "text-ink-400")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Labelled numeric cell used in performance strips. */
export function Metric({ label, value, sub, strong, tone }: { label: string; value: ReactNode; sub?: ReactNode; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">{label}</div>
      <div className={cx("truncate tabular-nums", strong ? "text-[15px] font-semibold" : "text-sm font-semibold", tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-ink-900")}>{value}</div>
      {sub && <div className="truncate text-[11px] tabular-nums text-ink-500">{sub}</div>}
    </div>
  );
}

/* ───────────────────────── audience preview ───────────────────────── */

export function useAudience(target: { segmentId?: string | null; rules?: Rule[] }, channel: Channel, enabled = true) {
  const params: Record<string, unknown> = target.segmentId ? { segmentId: target.segmentId, channel } : { rules: target.rules ?? [], channel };
  return useReport<AudiencePreview>("audiencePreview", params, enabled);
}

/** Live "who will get this" panel: matches, reachable on the channel, cost and a few names. */
export function AudienceSummary({ q, channel, compact }: { q: QueryState<AudiencePreview>; channel: Channel; compact?: boolean }) {
  const a = q.data;
  if (q.error && !a) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong bg-slate-50/70 p-3 text-[13px] text-ink-600">
        <div className="flex items-start gap-2"><Users className="mt-0.5 size-4 shrink-0 text-ink-400" /><span>{q.error.status === 404 ? "Live audience counts aren't available yet." : q.error.message}</span></div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={q.reload}>Try again</Button>
      </div>
    );
  }
  if (!a) return <Skeleton className={compact ? "h-[76px] rounded-xl" : "h-[132px] rounded-xl"} />;
  const unreachable = a.count - a.reachable;
  return (
    <div className={cx("rounded-xl border border-line bg-white p-3.5 transition-opacity", q.loading && "opacity-60")} aria-live="polite" aria-busy={q.loading || undefined}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">Will receive</div>
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-ink-900">{a.reachable.toLocaleString("en-IN")} <span className="text-sm font-normal text-ink-500">of {plural(a.count, "match", "matches")}</span></div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">Est. cost</div>
          <div className="text-base font-semibold tabular-nums text-ink-900">{channel === "email" ? "Free" : money(a.estCost)}</div>
        </div>
      </div>
      {unreachable > 0 && <p className="mt-1.5 text-xs text-amber-700">{plural(unreachable, "contact")} without a {CHANNEL[channel].reach} will be skipped.</p>}
      {!compact && a.sample.length > 0 && (
        <div className="mt-3 border-t border-dashed border-line pt-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">For example</div>
          <ul className="space-y-1.5">
            {a.sample.slice(0, 4).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[13px]">
                <Avatar name={s.name} size={6} />
                <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{s.name}</span>
                <span className="shrink-0 truncate text-xs text-ink-500">{[s.city, s.trips ? plural(s.trips, "trip") : ""].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.count === 0 && <p className="mt-2 text-[13px] text-ink-500">Nobody matches yet — loosen a rule to reach more people.</p>}
    </div>
  );
}
