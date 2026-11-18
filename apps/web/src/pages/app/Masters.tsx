import { useSearchParams } from "react-router-dom";
import { SERVICE_TYPES, type Entity } from "@voyadesk/core";
import { useList } from "../../lib/hooks";
import { money, titleCase } from "../../lib/format";
import { ResourcePage } from "../../components/ResourcePage";
import { PageHeader, StatusBadge, Tabs } from "../../components/ui";

type Tab = "packages" | "hotels" | "sightseeing" | "transfers" | "visa" | "suppliers";
const CURRENCIES = ["INR", "USD", "AED", "EUR", "THB", "SGD", "GBP"].map((c) => ({ value: c, label: c }));

export function MastersPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "packages";
  const suppliers = useList("suppliers");
  const supName = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? "—";
  const supplierRef = { name: "supplierId", label: "Supplier", type: "ref" as const, ref: "suppliers" as const };
  return (
    <div>
      <PageHeader title="Masters & suppliers" subtitle="Your rate library. Quotes pull hotels, transfers, tours and visa fees from here automatically." />
      <Tabs tabs={[{ key: "packages", label: "Packages" }, { key: "hotels", label: "Hotels & rates" }, { key: "sightseeing", label: "Sightseeing" }, { key: "transfers", label: "Transfers" }, { key: "visa", label: "Visa masters" }, { key: "suppliers", label: "Suppliers" }]} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "packages" && (
        <ResourcePage embedded collection="packages" title="Packages" singular="Package" search={(p) => `${p.name} ${p.destination}`} defaults={{ nights: 4, scope: "domestic", published: false, theme: "leisure", days: [], inclusions: [], exclusions: [], highlights: [] }}
          fields={[
            { name: "name", label: "Package name", type: "text", required: true },
            { name: "destination", label: "Destination (city)", type: "text", required: true },
            { name: "country", label: "Country", type: "text" },
            { name: "nights", label: "Nights", type: "number", required: true },
            { name: "scope", label: "Trip type", type: "select", options: [{ value: "domestic", label: "Domestic" }, { value: "overseas", label: "Overseas" }] },
            { name: "theme", label: "Theme", type: "text" },
            { name: "startingPrice", label: "Starting price (per person, shown on website)", type: "money" },
            { name: "published", label: "Show on storefront", type: "toggle" },
            { name: "highlights", label: "Highlights", type: "tags" },
            { name: "days", label: "Day-by-day plan", type: "days" },
            { name: "inclusions", label: "Inclusions", type: "lines" },
            { name: "exclusions", label: "Exclusions", type: "lines" },
          ]}
          columns={[
            { key: "name", header: "Package", render: (p) => <span><span className="font-medium">{p.name}</span><span className="block text-xs text-ink-500">{p.destination} · {p.nights}N · {titleCase(p.theme)}</span></span>, sort: (p) => p.name },
            { key: "price", header: "From", render: (p) => money(p.startingPrice), align: "right" },
            { key: "scope", header: "Type", render: (p) => titleCase(p.scope) },
            { key: "pub", header: "Website", render: (p) => <StatusBadge status={p.published ? "active" : "draft"} label={p.published ? "Published" : "Hidden"} /> },
          ]} />
      )}
      {tab === "hotels" && (
        <ResourcePage embedded collection="hotels" title="Hotels" singular="Hotel" search={(h) => `${h.name} ${h.city} ${h.country}`} defaults={{ stars: 4, country: "India", rates: [] }}
          fields={[
            { name: "name", label: "Hotel name", type: "text", required: true },
            { name: "city", label: "City", type: "text", required: true },
            { name: "country", label: "Country", type: "text" },
            { name: "stars", label: "Stars", type: "number" },
            supplierRef,
            { name: "description", label: "Description", type: "textarea" },
            { name: "rates", label: "Contracted rates (net, per room per night)", type: "rates" },
          ]}
          columns={[
            { key: "name", header: "Hotel", render: (h) => <span><span className="font-medium">{h.name}</span><span className="block text-xs text-ink-500">{"★".repeat(h.stars)} · {h.city}, {h.country}</span></span>, sort: (h) => h.name },
            { key: "rates", header: "Rates", render: (h) => h.rates.map((r) => `${r.roomType} ${r.mealPlan} ${money(r.netPerNight, r.currency)}`).join(" · ") || "No rates" },
            { key: "sup", header: "Supplier", render: (h) => supName(h.supplierId), hideOnMobile: true },
          ]} />
      )}
      {tab === "sightseeing" && (
        <ResourcePage embedded collection="sightseeing" title="Sightseeing" singular="Tour" search={(s) => `${s.name} ${s.city}`} defaults={{ country: "India", currency: "INR", durationHours: 4 }}
          fields={[
            { name: "name", label: "Tour / activity", type: "text", required: true },
            { name: "city", label: "City", type: "text", required: true },
            { name: "country", label: "Country", type: "text" },
            { name: "durationHours", label: "Duration (hours)", type: "number" },
            { name: "netPerPerson", label: "Net cost per person", type: "money", required: true },
            { name: "currency", label: "Currency", type: "select", options: CURRENCIES },
            supplierRef,
            { name: "description", label: "Description", type: "textarea" },
          ]}
          columns={[
            { key: "name", header: "Tour", render: (s) => <span><span className="font-medium">{s.name}</span><span className="block text-xs text-ink-500">{s.city} · {s.durationHours} h</span></span>, sort: (s) => s.name },
            { key: "cost", header: "Net / person", render: (s) => money(s.netPerPerson, s.currency), align: "right" },
            { key: "sup", header: "Supplier", render: (s) => supName(s.supplierId), hideOnMobile: true },
          ]} />
      )}
      {tab === "transfers" && (
        <ResourcePage embedded collection="transfers" title="Transfers" singular="Transfer" search={(t) => `${t.name} ${t.city}`} defaults={{ country: "India", currency: "INR", vehicle: "Sedan", capacity: 3 }}
          fields={[
            { name: "name", label: "Transfer", type: "text", required: true },
            { name: "city", label: "City", type: "text", required: true },
            { name: "country", label: "Country", type: "text" },
            { name: "vehicle", label: "Vehicle", type: "text" },
            { name: "capacity", label: "Seats", type: "number" },
            { name: "netPerVehicle", label: "Net cost per vehicle", type: "money", required: true },
            { name: "currency", label: "Currency", type: "select", options: CURRENCIES },
            supplierRef,
          ]}
          columns={[
            { key: "name", header: "Transfer", render: (t) => <span><span className="font-medium">{t.name}</span><span className="block text-xs text-ink-500">{t.city} · {t.vehicle} ({t.capacity} seats)</span></span>, sort: (t) => t.name },
            { key: "cost", header: "Net / vehicle", render: (t) => money(t.netPerVehicle, t.currency), align: "right" },
            { key: "sup", header: "Supplier", render: (t) => supName(t.supplierId), hideOnMobile: true },
          ]} />
      )}
      {tab === "visa" && (
        <ResourcePage embedded collection="visaMasters" title="Visa masters" singular="Visa master" search={(v) => `${v.country} ${v.visaType}`} defaults={{ visaType: "Tourist", processingDays: 5, checklist: [] }}
          fields={[
            { name: "country", label: "Country", type: "text", required: true },
            { name: "visaType", label: "Visa type", type: "text" },
            { name: "processingDays", label: "Processing days", type: "number" },
            { name: "validity", label: "Validity", type: "text" },
            { name: "fee", label: "Embassy / government fee", type: "money", required: true },
            { name: "serviceFee", label: "Your service fee", type: "money" },
            { name: "checklist", label: "Document checklist", type: "checklist" },
          ]}
          columns={[
            { key: "c", header: "Visa", render: (v) => <span><span className="font-medium">{v.country}</span><span className="block text-xs text-ink-500">{v.visaType} · {v.processingDays} days</span></span>, sort: (v) => v.country },
            { key: "fee", header: "Fee + service", render: (v) => `${money(v.fee)} + ${money(v.serviceFee)}`, align: "right" },
            { key: "docs", header: "Checklist", render: (v) => `${v.checklist.length} documents` },
          ]} />
      )}
      {tab === "suppliers" && (
        <ResourcePage embedded collection="suppliers" title="Suppliers" singular="Supplier" search={(s) => `${s.name} ${s.city}`} defaults={{ category: "hotel", country: "India", paymentTermsDays: 7 }}
          fields={[
            { name: "name", label: "Supplier name", type: "text", required: true },
            { name: "category", label: "Category", type: "select", options: [...SERVICE_TYPES, "dmc"].map((s) => ({ value: s, label: s === "dmc" ? "DMC (multiple services)" : titleCase(s) })) },
            { name: "city", label: "City", type: "text" },
            { name: "country", label: "Country", type: "text" },
            { name: "email", label: "Email", type: "email" },
            { name: "phone", label: "Phone", type: "phone" },
            { name: "paymentTermsDays", label: "Pay this many days before travel", type: "number" },
            { name: "contractNotes", label: "Contract notes", type: "textarea" },
          ]}
          columns={[
            { key: "name", header: "Supplier", render: (s: Entity<"suppliers">) => <span><span className="font-medium">{s.name}</span><span className="block text-xs text-ink-500">{s.city}, {s.country}</span></span>, sort: (s) => s.name },
            { key: "cat", header: "Category", render: (s) => (s.category === "dmc" ? "DMC" : titleCase(s.category)) },
            { key: "terms", header: "Terms", render: (s) => `${s.paymentTermsDays} days before travel` },
          ]} />
      )}
    </div>
  );
}
