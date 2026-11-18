import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Briefcase, CornerDownLeft, CreditCard, FileText, History, Home, Megaphone, Plus, Receipt, Search, Sparkles, Users, Workflow } from "lucide-react";
import { readRecent } from "../lib/recent";
import { canRead, canWrite, type Role } from "@voyadesk/core";
import { useList } from "../lib/hooks";
import { useSession } from "../lib/session";
import { money } from "../lib/format";
import { visibleNav } from "../layouts/nav";
import { Kbd, cx } from "./ui";

interface Item { id: string; group: string; label: string; hint?: string; icon: ReactNode; to: string; keywords?: string }

/** Open from anywhere: ⌘K / Ctrl+K, or "/" when not typing. */
export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpen(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); onOpen(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

const I = "size-4";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, moduleOn } = useSession();
  const nav = useNavigate();
  const role = (user?.role ?? "sales") as Role;
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Records load only while the palette is open
  const leads = useList("leads", open && canRead(role, "leads"));
  const contacts = useList("contacts", open && canRead(role, "contacts"));
  const bookings = useList("bookings", open && canRead(role, "bookings"));
  const invoices = useList("invoices", open && canRead(role, "invoices"));

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.clearTimeout(t); document.body.style.overflow = prev; };
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!user) return [];
    const actions: Item[] = [
      canRead(role, "leads") && { id: "a-lead", group: "Quick actions", label: "New lead", hint: "Capture an enquiry", icon: <Plus className={I} />, to: "/app/leads?new=1", keywords: "add create enquiry" },
      moduleOn("finance") && canRead(role, "paymentLinks") && { id: "a-pay", group: "Quick actions", label: "Create a payment link", hint: "UPI, card, EMI", icon: <CreditCard className={I} />, to: "/app/finance/links?new=1", keywords: "collect money upi razorpay" },
      moduleOn("ai") && canRead(role, "leads") && { id: "a-ai", group: "Quick actions", label: "Quote from a WhatsApp message", hint: "AI studio", icon: <Sparkles className={I} />, to: "/app/ai", keywords: "ai paste" },
      canWrite(role, "automations") && { id: "a-auto", group: "Quick actions", label: "Create an automation", hint: "When → If → Then", icon: <Workflow className={I} />, to: "/app/automations?new=1", keywords: "workflow rule auto follow up reminder" },
      moduleOn("marketing") && canWrite(role, "campaigns") && { id: "a-cmp", group: "Quick actions", label: "New campaign", hint: "WhatsApp, email, SMS", icon: <Megaphone className={I} />, to: "/app/marketing?tab=campaigns&new=1", keywords: "broadcast blast offer marketing" },
      canRead(role, "tasks") && { id: "a-task", group: "Quick actions", label: "New task", icon: <Plus className={I} />, to: "/app/tasks?new=1", keywords: "todo reminder" },
      moduleOn("visa") && canRead(role, "visaCases") && { id: "a-visa", group: "Quick actions", label: "New visa case", icon: <Plus className={I} />, to: "/app/visa?new=1" },
    ].filter(Boolean) as Item[];
    const pages: Item[] = visibleNav(role, moduleOn).flatMap((g) => g.items.map((i) => ({ id: `p-${i.to}`, group: "Go to", label: i.label, hint: g.group || undefined, icon: i.icon, to: i.to })));
    const recent: Item[] = open ? readRecent().map((r) => ({ id: `r-${r.to}`, group: "Recently viewed", label: r.label, hint: [r.kind, r.hint].filter(Boolean).join(" · "), icon: <History className={I} />, to: r.to })) : [];
    const needle = q.trim().toLowerCase();
    if (!needle) return [...recent.slice(0, 5), ...actions, ...pages];
    const match = (i: Item) => `${i.label} ${i.hint ?? ""} ${i.keywords ?? ""}`.toLowerCase().includes(needle);
    const rec: Item[] = [];
    const take = <T,>(rows: T[] | undefined, text: (r: T) => string, mk: (r: T) => Item) => {
      for (const r of rows ?? []) {
        if (text(r).toLowerCase().includes(needle)) rec.push(mk(r));
        if (rec.length > 40) break;
      }
    };
    take(leads.data, (l) => `${l.name} ${l.phone} ${l.email} ${l.destination}`, (l) => ({ id: `l-${l.id}`, group: "Leads", label: l.name, hint: [l.destination, l.phone].filter(Boolean).join(" · "), icon: <Users className={I} />, to: `/app/leads/${l.id}` }));
    take(contacts.data, (c) => `${c.name} ${c.phone} ${c.email} ${c.city}`, (c) => ({ id: `c-${c.id}`, group: "Customers", label: c.name, hint: [c.city, c.phone].filter(Boolean).join(" · "), icon: <Home className={I} />, to: `/app/contacts/${c.id}` }));
    take(bookings.data, (b) => `${b.number} ${b.contactName} ${b.destination} ${b.title}`, (b) => ({ id: `b-${b.id}`, group: "Bookings", label: `${b.number} · ${b.contactName}`, hint: b.destination || b.title, icon: <Briefcase className={I} />, to: `/app/bookings/${b.id}` }));
    take(invoices.data, (i) => `${i.number} ${i.partyName}`, (i) => ({ id: `i-${i.id}`, group: "Invoices", label: `${i.number} · ${i.partyName}`, hint: `${money(i.total)}${i.total - i.paid - i.credited > 0 ? ` · ${money(i.total - i.paid - i.credited)} due` : " · paid"}`, icon: <Receipt className={I} />, to: `/app/finance/invoices/${i.id}` }));
    return [...recent.filter(match), ...actions.filter(match), ...pages.filter(match), ...rec];
  }, [q, open, user, role, moduleOn, leads.data, contacts.data, bookings.data, invoices.data]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const go = (i: Item | undefined) => { if (!i) return; onClose(); nav(i.to); };
  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[70] flex animate-fade-in items-start justify-center bg-slate-950/45 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search and jump" className="w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 shrink-0 text-ink-400" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads, customers, bookings, invoices or pages…"
            aria-label="Search everything" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={items[active] ? `cmdk-${items[active]!.id}` : undefined}
            className="h-14 w-full bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }} />
          <span className="hidden sm:block"><Kbd>Esc</Kbd></span>
        </div>
        <div ref={listRef} id="cmdk-list" role="listbox" className="max-h-[56vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-ink-500">No matches for “{q}”. Try a name, phone number or booking number.</div>
          ) : items.map((i, idx) => {
            const header = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            return (
              <div key={i.id}>
                {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400 first:pt-1">{header}</div>}
                <button id={`cmdk-${i.id}`} data-idx={idx} role="option" aria-selected={idx === active} onMouseMove={() => setActive(idx)} onClick={() => go(i)}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", idx === active ? "bg-brand-50 text-brand-800" : "text-ink-800")}>
                  <span className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-md", idx === active ? "bg-white text-brand-600 shadow-xs" : "bg-slate-100 text-ink-500")}>{i.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.label}</span>{i.hint && <span className="block truncate text-xs text-ink-500">{i.hint}</span>}</span>
                  {idx === active ? <CornerDownLeft className="size-4 shrink-0 text-brand-500" /> : <ArrowRight className="size-4 shrink-0 text-transparent" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-line bg-slate-50/70 px-4 py-2 text-xs text-ink-500 sm:flex">
          <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="ml-auto inline-flex items-center gap-1"><FileText className="size-3.5" />Tip: press <Kbd>/</Kbd> anywhere to search</span>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
