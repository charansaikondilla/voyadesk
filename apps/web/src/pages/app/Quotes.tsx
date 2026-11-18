import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDate, QUOTE_STATUSES } from "@voyadesk/core";
import { useList } from "../../lib/hooks";
import { money, titleCase } from "../../lib/format";
import { ButtonLink, DataTable, ErrorNote, Loading, PageHeader, StatusBadge, Tabs } from "../../components/ui";

export function QuotesPage() {
  const q = useList("quotes");
  const nav = useNavigate();
  const [tab, setTab] = useState<string>("all");
  const rows = useMemo(() => (q.data ?? []).filter((x) => tab === "all" || x.status === tab).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), [q.data, tab]);
  const count = (s: string) => (q.data ?? []).filter((x) => x.status === s).length;
  return (
    <div>
      <PageHeader title="Quotes & itineraries" subtitle="Build from a lead or a template. Quotes become bookings when the customer accepts." actions={<><ButtonLink to="/app/masters?tab=packages" variant="secondary">Templates</ButtonLink><ButtonLink to="/app/leads">Start from a lead</ButtonLink></>} />
      <Tabs tabs={[{ key: "all", label: "All", count: q.data?.length ?? 0 }, ...QUOTE_STATUSES.map((s) => ({ key: s, label: titleCase(s), count: count(s) }))]} value={tab} onChange={setTab} />
      {q.error && !q.data ? <ErrorNote message={q.error.message} onRetry={q.reload} /> : !q.data ? <Loading /> : (
        <DataTable rows={rows} onRowClick={(x) => nav(`/app/quotes/${x.id}`)} search={(x) => `${x.number} ${x.contactName} ${x.destination} ${x.title}`} columns={[
          { key: "no", header: "Quote", render: (x) => <span><span className="font-medium">{x.number}</span><span className="block text-xs text-ink-500">v{x.version}{x.agentId ? " · B2B" : ""}</span></span>, sort: (x) => x.number },
          { key: "cust", header: "Customer", render: (x) => x.contactName, sort: (x) => x.contactName },
          { key: "trip", header: "Trip", render: (x) => `${x.destination || "—"} · ${x.nights}N`, hideOnMobile: true },
          { key: "start", header: "Starts", render: (x) => formatDate(x.startDate), sort: (x) => x.startDate ?? "" },
          { key: "total", header: "Total", render: (x) => money(x.total, x.currency), sort: (x) => x.total, align: "right" },
          { key: "views", header: "Views", render: (x) => x.views, align: "right", hideOnMobile: true },
          { key: "status", header: "Status", render: (x) => <StatusBadge status={x.status} /> },
        ]} />
      )}
    </div>
  );
}
