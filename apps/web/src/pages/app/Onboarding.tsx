import { Link } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { useAction, useList } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Card, PageHeader, cx } from "../../components/ui";

interface Step {
  key: string;
  title: string;
  why: string;
  to: string;
  cta: string;
  auto?: boolean;
}

export function OnboardingPage() {
  const { settings, refresh } = useSession();
  const { act } = useAction();
  const users = useList("users");
  const hotels = useList("hotels");
  const quotes = useList("quotes");
  if (!settings) return null;
  const done = settings.onboarding ?? {};
  const auto: Record<string, boolean> = {
    profile: Boolean(settings.gstin && settings.phone),
    team: (users.data ?? []).length > 1,
    masters: (hotels.data ?? []).length > 0,
    firstQuote: (quotes.data ?? []).some((q) => q.status !== "draft"),
    payments: Object.values(settings.gateways ?? {}).some(Boolean),
  };
  const steps: Step[] = [
    { key: "profile", title: "Add your company details", why: "GSTIN and state decide CGST/SGST vs IGST on every invoice.", to: "/app/settings?tab=company", cta: "Company settings" },
    { key: "modules", title: "Pick your modules", why: "Switch off what you don't use so new staff see a simpler screen.", to: "/app/settings?tab=modules", cta: "Modules" },
    { key: "tax", title: "Check tax rules", why: "GST and TCS defaults are dated rules — confirm them with your CA.", to: "/app/settings?tab=tax", cta: "Tax rules" },
    { key: "masters", title: "Add hotels, transfers and tours", why: "Quotes auto-suggest services from your rate library.", to: "/app/masters", cta: "Masters" },
    { key: "team", title: "Invite your team", why: "Paste names and emails — everyone lands on the screen for their role.", to: "/app/settings?tab=team", cta: "Invite team" },
    { key: "routing", title: "Set lead routing", why: "New enquiries are assigned automatically by destination and service.", to: "/app/settings?tab=routing", cta: "Routing rules" },
    { key: "firstQuote", title: "Send your first quote", why: "Open a lead, press Build quote, review, send.", to: "/app/leads", cta: "Go to leads" },
    { key: "payments", title: "Connect payments and WhatsApp", why: "Customers pay from the proposal link; WhatsApp enquiries become leads.", to: "/app/settings?tab=integrations", cta: "Integrations" },
  ];
  const isDone = (k: string) => Boolean(done[k] || auto[k]);
  const count = steps.filter((s) => isDone(s.key)).length;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Setup guide" subtitle={`${count} of ${steps.length} done — most agencies finish in an afternoon.`} />
      <div className="mb-5 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${(count / steps.length) * 100}%` }} /></div>
      <div className="space-y-3">
        {steps.map((s, i) => {
          const ok = isDone(s.key);
          return (
            <Card key={s.key} className={cx(ok && "bg-emerald-50/40")}>
              <div className="flex items-start gap-3">
                <button aria-label={ok ? "Mark not done" : "Mark done"} onClick={async () => { await act("completeOnboardingStep", { step: s.key, done: !done[s.key] }); await refresh(); }} className="mt-0.5">
                  {ok ? <CheckCircle2 className="size-6 text-emerald-600" /> : <Circle className="size-6 text-ink-300" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cx("font-medium", ok && "text-ink-500")}>{i + 1}. {s.title}</div>
                  <p className="text-sm text-ink-500">{s.why}</p>
                </div>
                <Link to={s.to} className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">{s.cta}</Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
