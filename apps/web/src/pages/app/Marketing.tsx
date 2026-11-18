import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Collection } from "@voyadesk/core";
import { useList } from "../../lib/hooks";
import { Button, ErrorBoundary, PageHeader, Tabs } from "../../components/ui";
import { useAccess } from "../../components/marketing/kit";
import { MarketingOverview } from "../../components/marketing/Overview";
import { CampaignsTab } from "../../components/marketing/Campaigns";
import { AudiencesTab } from "../../components/marketing/Audiences";
import { JourneysTab } from "../../components/marketing/Journeys";
import { CouponsTab, LandingTab } from "../../components/marketing/LandingCoupons";

type Tab = "overview" | "campaigns" | "segments" | "drips" | "landing" | "coupons";

const TABS: { key: Tab; label: string; collection: Collection | null; newLabel: string | null }[] = [
  { key: "overview", label: "Overview", collection: null, newLabel: null },
  { key: "campaigns", label: "Campaigns", collection: "campaigns", newLabel: "New campaign" },
  { key: "segments", label: "Audiences", collection: "segments", newLabel: "New audience" },
  { key: "drips", label: "Journeys", collection: "dripSequences", newLabel: "New journey" },
  { key: "landing", label: "Landing pages", collection: "landingPages", newLabel: "New landing page" },
  { key: "coupons", label: "Coupons", collection: "coupons", newLabel: "New coupon" },
];

export function MarketingPage() {
  const [params, setParams] = useSearchParams();
  const access = useAccess();
  // The funnel report is for owners, admins and marketing; everyone else starts on the first tab they can use
  const funnel = ["owner", "admin", "marketing"].includes(access.role ?? "");
  const visible = TABS.filter((t) => (t.collection ? access.read(t.collection) : funnel));
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = visible.some((t) => t.key === raw) ? raw! : visible[0]?.key ?? "overview";
  const current = TABS.find((t) => t.key === tab)!;
  const newOpen = params.get("new") === "1";

  // Small counters on the tabs that need attention
  const campaigns = useList("campaigns", access.read("campaigns"));
  const scheduled = campaigns.data?.filter((c) => c.status === "scheduled").length;

  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(); const d = p.get("days"); if (d) n.set("days", d); if (t !== visible[0]?.key) n.set("tab", t); return n; });
  const openNew = useCallback((t: Tab = tab) => setParams((p) => { const n = new URLSearchParams(p); if (t !== "overview") n.set("tab", t); n.set("new", "1"); return n; }), [setParams, tab]);
  const closeNew = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete("new"); n.delete("segment"); return n; }, { replace: true }), [setParams]);

  const canNew = current.collection ? access.write(current.collection) : access.write("campaigns");
  const headerAction = canNew ? (
    <Button icon={<Plus className="size-4" />} onClick={() => openNew(tab === "overview" ? "campaigns" : tab)}>{current.newLabel ?? "New campaign"}</Button>
  ) : null;

  const tabs = useMemo(() => visible.map((t) => ({ key: t.key, label: t.label, count: t.key === "campaigns" && scheduled ? scheduled : undefined })), [visible, scheduled]);
  const props = { newOpen, onNew: () => openNew(), onCloseNew: closeNew };

  return (
    <div>
      <PageHeader title="Marketing" subtitle="Find out which channels bring bookings, then reach the right customers at the right time." actions={headerAction} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <ErrorBoundary key={tab}>
        {tab === "overview" && <MarketingOverview onNewCampaign={access.write("campaigns") ? () => openNew("campaigns") : undefined} />}
        {tab === "campaigns" && <CampaignsTab composeOpen={newOpen} onCompose={() => openNew("campaigns")} onCloseCompose={closeNew} initialSegmentId={params.get("segment")} />}
        {tab === "segments" && <AudiencesTab {...props} />}
        {tab === "drips" && <JourneysTab {...props} />}
        {tab === "landing" && <LandingTab {...props} />}
        {tab === "coupons" && <CouponsTab {...props} />}
      </ErrorBoundary>
    </div>
  );
}
