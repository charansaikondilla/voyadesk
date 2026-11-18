import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Globe, MessageCircle, Send, X } from "lucide-react";
import { addDays, isoDate } from "@voyadesk/core";
import { api, ApiError, type PublicStore } from "../../lib/api";
import { money } from "../../lib/format";
import { LANGS, useLang, type Key } from "../../lib/i18n";
import { Button, Callout, Field, Input, cx } from "../../components/ui";

/* ───────── campaign tracking (?c=<campaign id> on any website link) ───────── */
let campaignId: string | null = null;
export function useCampaign(): string | null {
  const [params] = useSearchParams();
  const c = params.get("c");
  if (c && /^cmp_[\w]+$/.test(c)) {
    campaignId = c;
    try { window.sessionStorage.setItem("voyadesk.campaign", c); } catch { /* fine */ }
  }
  if (!campaignId) {
    try { campaignId = window.sessionStorage.getItem("voyadesk.campaign"); } catch { /* fine */ }
  }
  return campaignId;
}

export function LangSwitch({ dark }: { dark?: boolean }) {
  const { lang, setLang, t } = useLang();
  return (
    <label className={cx("inline-flex items-center gap-1 text-sm", dark ? "text-white/90" : "text-ink-600")}>
      <Globe className="size-4" aria-hidden />
      <span className="sr-only">{t("language")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as "en")} className={cx("rounded-md border-0 bg-transparent py-0.5 pl-1 pr-6 text-sm focus:ring-2", dark ? "text-white [&>option]:text-ink-900" : "text-ink-800")}>
        {LANGS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
      </select>
    </label>
  );
}

const NAV: [string, Key][] = [["", "holidays"], ["flights", "flights"], ["hotels", "hotels"], ["series", "series"], ["insurance", "insurance"]];

/** Website header used on every public page: brand, booking-engine tabs, visa status, my trips, language. */
export function SiteHeader({ store }: { store: Pick<PublicStore, "company"> | null }) {
  const { tenantId = "demo" } = useParams();
  const { t } = useLang();
  useCampaign();
  const color = store?.company.brandColor ?? "#1d5fd1";
  return (
    <header className="text-white" style={{ background: color }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <Link to={`/store/${tenantId}`} className="text-lg font-semibold">{store?.company.name ?? "Holidays"}</Link>
        <div className="flex items-center gap-3 text-sm">
          <LangSwitch dark />
          <Link to={`/my/${tenantId}`} className="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25">{t("myTrips")}</Link>
        </div>
      </div>
      <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2 pt-3 text-sm" aria-label="Book">
        {NAV.map(([path, key]) => (
          <NavLink key={key} end={path === ""} to={path ? `/book/${tenantId}/${path}` : `/store/${tenantId}`} className={({ isActive }) => cx("whitespace-nowrap rounded-full px-3 py-1.5", isActive ? "bg-white text-ink-900" : "text-white/90 hover:bg-white/15")}>{t(key)}</NavLink>
        ))}
        <NavLink to={`/visa-status/${tenantId}`} className={({ isActive }) => cx("whitespace-nowrap rounded-full px-3 py-1.5", isActive ? "bg-white text-ink-900" : "text-white/90 hover:bg-white/15")}>{t("visa")}</NavLink>
      </nav>
    </header>
  );
}

export function SiteShell({ store, children }: { store: Pick<PublicStore, "company"> | null; children: ReactNode }) {
  const { tenantId = "demo" } = useParams();
  return (
    <div className="min-h-full bg-canvas">
      <SiteHeader store={store} />
      {children}
      <footer className="py-8 text-center text-xs text-ink-500">{store?.company.name} · {store?.company.phone} · <Link to={`/visa-status/${tenantId}`} className="underline">Visa status</Link> · <Link to={`/my/${tenantId}`} className="underline">My trips</Link></footer>
      <ChatWidget color={store?.company.brandColor ?? "#1d5fd1"} />
    </div>
  );
}

/** Loads the agency's public profile (name, colour, phone) for engine pages. */
export function useCompany() {
  const { tenantId = "demo" } = useParams();
  const [store, setStore] = useState<PublicStore | null>(null);
  useEffect(() => { api.publicStore(tenantId).then(setStore, () => undefined); }, [tenantId]);
  return { store, tenantId };
}

/* ───────── website chat: visitors become WhatsApp leads ───────── */

export function ChatWidget({ color }: { color: string }) {
  const { tenantId = "demo" } = useParams();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<{ name: string; phone: string } | null>(null);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ me: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log, open]);
  const send = async (body: string, person = who) => {
    if (!person || !body.trim()) return;
    setLog((l) => [...l, { me: true, text: body }]);
    setText("");
    setBusy(true);
    setErr(null);
    try {
      const r = await api.publicAction<{ replies: string[] }>(tenantId, "webChat", { name: person.name, phone: person.phone, text: body });
      setLog((l) => [...l, ...r.replies.map((x) => ({ me: false, text: x }))]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Message not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg" style={{ background: color }}>
          <MessageCircle className="size-5" />{t("chat")}
        </button>
      )}
      {open && (
        <div className="fixed bottom-4 right-4 z-30 flex h-[460px] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl" role="dialog" aria-label={t("chat")}>
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: color }}>
            <span className="font-medium">{t("chat")}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><X className="size-5" /></button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3 text-sm">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-xs">{t("chatHello")}</div>
            {log.map((m, i) => <div key={i} className={cx("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2", m.me ? "ml-auto rounded-tr-sm text-white" : "rounded-tl-sm bg-white shadow-xs")} style={m.me ? { background: color } : undefined}>{m.text}</div>)}
            {busy && <div className="text-xs text-ink-400">…</div>}
            {err && <div className="text-xs text-rose-600">{err}</div>}
            <div ref={end} />
          </div>
          {!who ? (
            <form className="space-y-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); if (form.name && form.phone) setWho(form); }}>
              <Input required aria-label={t("yourName")} placeholder={t("yourName")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input required type="tel" aria-label={t("phone")} placeholder={t("phone")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Button type="submit" className="w-full" style={{ background: color }}>{t("startChat")}</Button>
            </form>
          ) : (
            <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
              <Input aria-label={t("typeMessage")} placeholder={t("typeMessage")} value={text} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" busy={busy} aria-label={t("send")} icon={<Send className="size-4" />} style={{ background: color }} />
            </form>
          )}
        </div>
      )}
    </>
  );
}

/* ───────── book a holiday package online ───────── */

export function BookPackageForm({ packageId, nights, color, startingPrice }: { packageId: string; nights: number; color: string; startingPrice: number }) {
  const { tenantId = "demo" } = useParams();
  const { t } = useLang();
  const nav = useNavigate();
  const c = useCampaign();
  const [f, setF] = useState({ startDate: addDays(isoDate(new Date()), 21), adults: "2", children: "0", name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        const r = await api.publicAction<{ token: string }>(tenantId, "storefrontBook", { packageId, startDate: f.startDate, adults: Number(f.adults) || 1, children: Number(f.children) || 0, contact: { name: f.name, phone: f.phone, email: f.email }, campaignId: c ?? undefined });
        nav(`/p/${tenantId}/${r.token}`);
      } catch (x) {
        setErr(x instanceof ApiError ? x.message : "Could not start the booking.");
      } finally {
        setBusy(false);
      }
    }}>
      {err && <Callout tone="bad">{err}</Callout>}
      <div className="text-sm text-ink-600">{nights} nights · from {money(startingPrice)} {t("perPerson")}</div>
      <Field label={t("date")} required><Input type="date" required min={addDays(isoDate(new Date()), 3)} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("adults")}><Input type="number" min={1} max={20} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} /></Field>
        <Field label={t("children")}><Input type="number" min={0} max={10} value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} /></Field>
      </div>
      <Field label={t("yourName")} required><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t("phone")} required><Input required type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t("email")}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Button type="submit" busy={busy} className="w-full" style={{ background: color }}>{t("getQuote")}</Button>
      <p className="text-center text-xs text-ink-500">You'll see the exact price and can pay, pay in EMIs, or hold it.</p>
    </form>
  );
}

export function ContactFields({ value, onChange }: { value: { name: string; phone: string; email: string }; onChange: (v: { name: string; phone: string; email: string }) => void }) {
  const { t } = useLang();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={t("yourName")} required><Input required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></Field>
      <Field label={t("phone")} required><Input required type="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></Field>
      <Field label={t("email")}><Input type="email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} /></Field>
    </div>
  );
}
