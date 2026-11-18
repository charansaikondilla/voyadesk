import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { ROLE_HOME, type Role, type User } from "@voyadesk/core";
import { api, ApiError, HttpApi, isDemo, LocalApi } from "../../lib/api";
import { invalidate } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { ROLE_LABEL } from "../../lib/format";
import { Avatar, Button, Callout, Card, Field, Input, Loading, Toggle, cx } from "../../components/ui";
import { Brand } from "../../components/Brand";
import { BUSINESS_TYPES } from "./catalog";

const ROLE_HINT: Record<string, string> = {
  owner: "Everything: dashboards, money, settings",
  sales: "Leads, quotes, customers, AI studio",
  ops: "Bookings, supplier confirmations, drivers",
  accounts: "Invoices, payments, payables, GST/TCS",
  visa: "Visa cases, checklists, passport scans",
  marketing: "Campaigns, segments, landing pages",
  agent: "B2B portal: quotes, wallet, credit, bookings",
  driver: "Field app: today's pickups and tours",
};

function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 to-canvas px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-center text-sm text-ink-500">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signInDemo, signIn } = useSession();
  const nav = useNavigate();
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (api instanceof LocalApi) void api.users().then((u) => setUsers(u.filter((x) => x.active)));
  }, []);

  if (isDemo) {
    const order: Role[] = ["owner", "sales", "ops", "accounts", "visa", "marketing", "agent", "driver"];
    const picks = order.map((r) => users?.find((u) => u.role === r)).filter((u): u is User => Boolean(u));
    return (
      <AuthShell title="Open the live demo" subtitle="A fictional agency with real workflows. Pick a role to see that person's screen.">
        {!users ? <Loading /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {picks.map((u) => (
              <button key={u.id} onClick={async () => { await signInDemo(u.id); nav(ROLE_HOME[u.role as Role]); }}
                className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 text-left shadow-xs transition hover:border-brand-300 hover:shadow-md">
                <Avatar name={u.name} size={10} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink-900">{ROLE_LABEL[u.role]}</span>
                  <span className="block truncate text-xs text-ink-500">{u.name} · {ROLE_HINT[u.role]}</span>
                </span>
                <ArrowRight className="size-4 text-ink-400" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-6 text-center text-sm text-ink-500">Demo data lives only in this browser. <Link to="/" className="text-brand-700 hover:underline">Back to the website</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back.">
      <Card className="mx-auto max-w-md">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signIn(email, password);
            const me = await api.me();
            nav(ROLE_HOME[me.user.role as Role]);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not sign in");
          } finally {
            setBusy(false);
          }
        }}>
          {error && <Callout tone="bad">{error}</Callout>}
          <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" busy={busy} className="w-full">Sign in</Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-500">New here? <Link to="/signup" className="text-brand-700 hover:underline">Start a free trial</Link></p>
      </Card>
    </AuthShell>
  );
}

export function SignupPage() {
  const nav = useNavigate();
  const { signInDemo, refresh } = useSession();
  const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "", demo: true });
  const [types, setTypes] = useState<string[]>(["b2c"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typeKey = (k: string) => (k === "b2b-dmc" ? "b2b_dmc" : k === "portals" ? "portal" : k);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const businessTypes = types.map(typeKey);
      if (api instanceof HttpApi) {
        await api.signup({ ...form, businessTypes });
        await refresh();
      } else if (api instanceof LocalApi) {
        const owner = (await api.users()).find((u) => u.role === "owner");
        if (!owner) throw new Error("Demo owner missing — reset the demo from Settings.");
        await signInDemo(owner.id);
        const me = await api.me();
        await api.update("settings", me.settings.id, {
          companyName: form.companyName || me.settings.companyName, businessTypes,
          modules: {
            sales: true, itinerary: true, operations: true, finance: true, ai: true,
            marketing: businessTypes.includes("b2c") || businessTypes.includes("portal"),
            b2b: businessTypes.includes("b2b_dmc") || businessTypes.includes("portal"),
            portals: businessTypes.includes("portal") || businessTypes.includes("b2c"),
            visa: businessTypes.includes("visa"),
          },
        });
        await refresh();
        invalidate();
      }
      nav("/app/onboarding");
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Start your free trial" subtitle="Two minutes. No credit card, no demo call.">
      <Card className="mx-auto max-w-xl">
        <form className="space-y-5" onSubmit={submit}>
          {isDemo && <Callout tone="info">This is the live demo: you'll set up the sample agency as its owner. Connect the backend (see README) for real accounts.</Callout>}
          {error && <Callout tone="bad">{error}</Callout>}
          <Field label="Company name" required><Input required minLength={2} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="e.g. Sunrise Holidays" /></Field>
          {!isDemo && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" required><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Work email" required><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Password" required hint="At least 8 characters" className="sm:col-span-2"><Input type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            </div>
          )}
          <div>
            <div className="mb-2 text-sm font-medium text-ink-700">What kind of business are you? <span className="font-normal text-ink-500">(pick all that apply)</span></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {BUSINESS_TYPES.map((b) => {
                const on = types.includes(b.key);
                return (
                  <button type="button" key={b.key} onClick={() => setTypes((t) => (on ? (t.length > 1 ? t.filter((x) => x !== b.key) : t) : [...t, b.key]))}
                    className={cx("rounded-xl border p-3 text-left text-sm transition", on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line hover:bg-slate-50")} aria-pressed={on}>
                    <span className="block font-medium">{b.name}</span><span className="block text-xs text-ink-500">{b.who}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {!isDemo && <Toggle checked={form.demo} onChange={(v) => setForm({ ...form, demo: v })} label="Load sample data so I can explore first" />}
          <Button type="submit" busy={busy} size="lg" className="w-full">Create my workspace</Button>
          <p className="text-center text-sm text-ink-500">Already have an account? <Link to="/login" className="text-brand-700 hover:underline">Sign in</Link></p>
        </form>
      </Card>
    </AuthShell>
  );
}
