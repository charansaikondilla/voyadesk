import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronsUpDown, ClipboardList, CreditCard, LogOut, Menu, MoreHorizontal, Plus, Search, Sparkles, Stamp, UserPlus, X } from "lucide-react";
import { canRead, ROLE_HOME, type Role } from "@voyadesk/core";
import { isDemo } from "../lib/api";
import { useSession } from "../lib/session";
import { ROLE_LABEL } from "../lib/format";
import { Avatar, Button, ErrorBoundary, Kbd, Loading, cx } from "../components/ui";
import { Brand, Logo, PRODUCT_NAME } from "../components/Brand";
import { CommandPalette, useCommandPaletteHotkey } from "../components/CommandPalette";
import { bottomNav, visibleNav } from "./nav";

export { NAV, visibleNav } from "./nav";

const COLLAPSE_KEY = "voyadesk.nav.collapsed";
const readCollapsed = (): string[] => { try { return JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]; } catch { return []; } };
const writeCollapsed = (v: string[]) => { try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(v)); } catch { /* memory only */ } };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const { user, moduleOn, settings, signOut } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [menu, setMenu] = useState(false);
  if (!user) return null;
  const groups = visibleNav(user.role as Role, moduleOn);
  const toggle = (g: string) => setCollapsed((c) => { const n = c.includes(g) ? c.filter((x) => x !== g) : [...c, g]; writeCollapsed(n); return n; });
  return (
    <nav className="flex h-full flex-col text-slate-300" aria-label="Main">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        <Link to="/app" onClick={onNavigate} className="flex min-w-0 items-center gap-2.5">
          <Logo className="size-8" />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold leading-tight tracking-tight text-white">{PRODUCT_NAME}</span>
            <span className="block truncate text-xs text-slate-400">{settings?.companyName}</span>
          </span>
        </Link>
      </div>

      <div className="px-3 pb-2">
        <button onClick={onSearch} className="flex h-9 w-full items-center gap-2 rounded-lg bg-white/[0.06] px-3 text-left text-[13px] text-slate-400 ring-1 ring-inset ring-white/[0.06] transition hover:bg-white/[0.09] hover:text-slate-200">
          <Search className="size-4" /><span className="flex-1">Search…</span>
          <span className="rounded border border-white/10 px-1 text-[10px] font-medium text-slate-400">{isMac ? "⌘K" : "Ctrl K"}</span>
        </button>
      </div>

      <div className="scroll-dark flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => {
          const isCollapsed = g.group !== "" && collapsed.includes(g.group);
          const hasActive = g.items.some((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
          return (
            <div key={g.group || "main"} className="mt-3 first:mt-1">
              {g.group && (
                <button onClick={() => toggle(g.group)} aria-expanded={!isCollapsed}
                  className="group flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-300">
                  <span className="flex items-center gap-1.5">{g.group}{isCollapsed && hasActive && <span className="size-1.5 rounded-full bg-brand-400" />}</span>
                  <ChevronDown className={cx("size-3.5 opacity-0 transition group-hover:opacity-100", isCollapsed && "-rotate-90 opacity-100")} />
                </button>
              )}
              {!isCollapsed && (
                <div className="mt-0.5 space-y-px">
                  {g.items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate}
                      className={({ isActive }) => cx(
                        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                        isActive ? "bg-white/[0.09] font-medium text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-brand-400" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
                      )}>
                      {({ isActive }) => <><span className={isActive ? "text-brand-300" : "text-slate-500"}>{i.icon}</span>{i.label}</>}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative shrink-0 border-t border-white/[0.06] p-3">
        <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition hover:bg-white/[0.06]">
          <Avatar name={user.name} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-white">{user.name}</span><span className="block truncate text-xs text-slate-400">{ROLE_LABEL[user.role]}</span></span>
          <ChevronsUpDown className="size-4 text-slate-500" />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="absolute inset-x-3 bottom-full z-40 mb-2 animate-pop-in rounded-xl border border-line bg-white p-1 text-ink-800 shadow-pop">
              {isDemo && <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setMenu(false); nav("/login"); }}>Switch demo user</button>}
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50" onClick={() => { signOut(); nav("/"); }}><LogOut className="size-4" />Sign out</button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

function QuickAdd() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { user, moduleOn } = useSession();
  if (!user) return null;
  const role = user.role as Role;
  const items: { label: string; hint: string; to: string; icon: ReactNode; show: boolean }[] = [
    { label: "New lead", hint: "Capture an enquiry", to: "/app/leads?new=1", icon: <UserPlus className="size-4" />, show: canRead(role, "leads") },
    { label: "Payment link", hint: "Collect by UPI, card or EMI", to: "/app/finance/links?new=1", icon: <CreditCard className="size-4" />, show: moduleOn("finance") && canRead(role, "paymentLinks") },
    { label: "Quote from a message (AI)", hint: "Paste a WhatsApp enquiry", to: "/app/ai", icon: <Sparkles className="size-4" />, show: moduleOn("ai") && canRead(role, "leads") },
    { label: "New visa case", hint: "Start an application", to: "/app/visa?new=1", icon: <Stamp className="size-4" />, show: moduleOn("visa") && canRead(role, "visaCases") },
    { label: "New task", hint: "Remind yourself or a teammate", to: "/app/tasks?new=1", icon: <ClipboardList className="size-4" />, show: canRead(role, "tasks") },
  ].filter((i) => i.show);
  if (!items.length) return null;
  return (
    <div className="relative">
      <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">New</Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-40 mt-2 w-72 animate-pop-in rounded-xl border border-line bg-white p-1.5 shadow-pop">
            {items.map((i) => (
              <button key={i.to} role="menuitem" className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50" onClick={() => { setOpen(false); nav(i.to); }}>
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{i.icon}</span>
                <span><span className="block text-sm font-medium text-ink-900">{i.label}</span><span className="block text-xs text-ink-500">{i.hint}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BottomBar({ onMore }: { onMore: () => void }) {
  const { user, moduleOn } = useSession();
  if (!user) return null;
  const items = bottomNav(user.role as Role, moduleOn);
  return (
    <nav aria-label="Quick" className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end ?? i.to === "/app"}
            className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors", isActive ? "text-brand-700" : "text-ink-500")}>
            {({ isActive }) => <><span className={cx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", isActive && "bg-brand-50")}>{i.icon}</span>{i.label}</>}
          </NavLink>
        ))}
        <button onClick={onMore} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-ink-500">
          <span className="flex h-7 w-12 items-center justify-center"><MoreHorizontal className="size-[18px]" /></span>More
        </button>
      </div>
    </nav>
  );
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role as Role)) return <Navigate to={ROLE_HOME[user.role as Role]} replace />;
  return <>{children}</>;
}

export function AppLayout() {
  const { user, loading } = useSession();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const openPalette = useCallback(() => { setDrawer(false); setPalette(true); }, []);
  useCommandPaletteHotkey(openPalette);
  useEffect(() => { setDrawer(false); setPalette(false); }, [loc.pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "agent") return <Navigate to="/agent" replace />;
  if (user.role === "driver") return <Navigate to="/field" replace />;
  return (
    <div className="flex min-h-full">
      <aside className="no-print fixed inset-y-0 left-0 z-20 hidden w-64 bg-navy-950 bg-[radial-gradient(120%_60%_at_0%_0%,rgb(29_95_209/0.16),transparent_60%)] lg:block"><Sidebar onSearch={openPalette} /></aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[80vw] max-w-72 animate-slide-left bg-navy-950 shadow-pop">
            <button className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="size-5" /></button>
            <Sidebar onNavigate={() => setDrawer(false)} onSearch={openPalette} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {isDemo && (
          <div className="no-print flex items-center justify-center gap-2 bg-gradient-to-r from-amber-50 via-amber-100/70 to-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Demo mode — sample agency data stored in this browser only. <Link to="/app/settings?tab=data" className="font-medium underline underline-offset-2">Reset demo</Link>
          </div>
        )}
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/85 px-3 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button className="rounded-lg p-2 text-ink-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <span className="lg:hidden"><Brand to="/app" /></span>
            <button onClick={openPalette} className="hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-slate-50/80 px-3 text-left text-[13px] text-ink-400 transition hover:border-line-strong hover:bg-white lg:flex">
              <Search className="size-4" /><span className="flex-1 truncate">Search leads, customers, bookings, invoices…</span><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>K</Kbd>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={openPalette} className="rounded-lg p-2 text-ink-600 hover:bg-slate-100 lg:hidden" aria-label="Search"><Search className="size-5" /></button>
            <QuickAdd />
            <Link to="/app/tasks" className="hidden rounded-lg p-2 text-ink-500 hover:bg-slate-100 hover:text-ink-800 sm:inline-flex" aria-label="My tasks" title="My tasks"><ClipboardList className="size-[18px]" /></Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-28 pt-5 sm:px-6 sm:pt-7 lg:pb-10">
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<Loading />}><div className="animate-fade-in"><Outlet /></div></Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <BottomBar onMore={() => setDrawer(true)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
