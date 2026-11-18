import { useState } from "react";
import { Link } from "react-router-dom";
import { PlaneLanding, PlaneTakeoff, Plus, UserPlus } from "lucide-react";
import { addDays, formatDate, isoDate, type Booking, type Service } from "@voyadesk/core";
import { useAction, useList, useReport } from "../../lib/hooks";
import { money, titleCase } from "../../lib/format";
import { ResourcePage } from "../../components/ResourcePage";
import { Button, Card, CardTitle, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Stat, StatusBadge } from "../../components/ui";
import { ServicesTable } from "./Bookings";
import { downloadRoomingList } from "../../components/plus";

interface OpsData {
  from: string;
  to: string;
  items: (Service & { bookingNumber: string; contactName: string; pax: number; supplierName: string; assigned: string[] })[];
  arrivals: Booking[];
  departures: Booking[];
  unassignedTransfers: number;
  unconfirmed: number;
}

export function OperationsPage() {
  const [from, setFrom] = useState(isoDate(new Date()));
  const [days, setDays] = useState(7);
  const q = useReport<OpsData>("operations", { from, days });
  return (
    <div>
      <PageHeader title="Ops board" subtitle="Every service in the window: confirm with suppliers, issue vouchers, assign drivers and guides."
        actions={<div className="flex gap-2"><Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value || isoDate(new Date()))} className="w-40" /><Select aria-label="Days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-28"><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></Select></div>} />
      {q.error && !q.data ? <ErrorNote message={q.error.message} onRetry={q.reload} /> : !q.data ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Arrivals" value={q.data.arrivals.length} icon={<PlaneLanding className="size-4" />} />
            <Stat label="Departures" value={q.data.departures.length} icon={<PlaneTakeoff className="size-4" />} />
            <Stat label="Not yet confirmed" value={q.data.unconfirmed} tone={q.data.unconfirmed ? "warn" : "good"} />
            <Stat label="Transfers/tours without driver or guide" value={q.data.unassignedTransfers} tone={q.data.unassignedTransfers ? "warn" : "good"} icon={<UserPlus className="size-4" />} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {([["Arrivals", q.data.arrivals, "startDate"], ["Departures", q.data.departures, "endDate"]] as const).map(([t, rows, key]) => (
              <Card key={t}><CardTitle title={t} subtitle={`${formatDate(q.data!.from)} – ${formatDate(q.data!.to)}`} />
                {rows.length === 0 ? <p className="text-sm text-ink-500">None.</p> : <ul className="divide-y divide-line text-sm">{rows.map((b) => <li key={b.id}><Link to={`/app/bookings/${b.id}`} className="flex justify-between py-2 hover:text-brand-700"><span>{b.contactName}<span className="block text-xs text-ink-500">{b.number} · {b.destination}</span></span><span className="text-ink-600">{formatDate(b[key])}</span></Link></li>)}</ul>}
              </Card>
            ))}
          </div>
          <div><h2 className="mb-3 text-base font-semibold">Services</h2><ServicesTable services={q.data.items} showBooking /></div>
        </div>
      )}
    </div>
  );
}

export function GroupsPage() {
  const q = useList("groupDepartures");
  const packages = useList("packages");
  const { act, busy } = useAction();
  const [seatFor, setSeatFor] = useState<string | null>(null);
  const [pax, setPax] = useState({ name: "", phone: "" });
  return (
    <div>
      <ResourcePage collection="groupDepartures" title="Group departures" singular="Departure" subtitle="Fixed departures with seats, passengers and rooming lists."
        search={(g) => g.name} defaults={{ seats: 20, status: "open", passengers: [] }}
        fields={[
          { name: "name", label: "Departure name", type: "text", required: true, span: 2 },
          { name: "packageId", label: "Package", type: "ref", ref: "packages" },
          { name: "departureDate", label: "Departure date", type: "date", required: true },
          { name: "seats", label: "Seats", type: "number", required: true },
          { name: "pricePerSeat", label: "Price per seat", type: "money", required: true },
          { name: "status", label: "Status", type: "select", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "departed", label: "Departed" }] },
        ]}
        columns={[
          { key: "name", header: "Departure", render: (g) => <span><span className="font-medium">{g.name}</span><span className="block text-xs text-ink-500">{packages.data?.find((p) => p.id === g.packageId)?.name ?? ""}</span></span> },
          { key: "date", header: "Date", render: (g) => formatDate(g.departureDate), sort: (g) => g.departureDate },
          { key: "seats", header: "Seats", render: (g) => `${g.passengers.length} / ${g.seats}`, align: "right" },
          { key: "price", header: "Per seat", render: (g) => money(g.pricePerSeat), align: "right" },
          { key: "status", header: "Status", render: (g) => <StatusBadge status={g.status} /> },
          { key: "book", header: "", render: (g) => g.status === "open" ? <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={(e) => { e.stopPropagation(); setSeatFor(g.id); }}>Add passenger</Button> : null },
        ]} />
      {(q.data ?? []).filter((g) => g.passengers.length > 0).map((g) => (
        <Card key={g.id} className="mt-5">
          <CardTitle title={`Passenger & rooming list — ${g.name}`} subtitle={`${g.passengers.length} of ${g.seats} seats · ${formatDate(g.departureDate)}`} action={<Button size="sm" variant="secondary" onClick={() => downloadRoomingList(g)}>Download Excel</Button>} />
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-ink-500"><tr><th className="py-1">#</th><th>Name</th><th>Phone</th><th>Room</th><th>Paid</th></tr></thead>
            <tbody className="divide-y divide-line">{g.passengers.map((p, i) => <tr key={i}><td className="py-1.5">{i + 1}</td><td>{p.name}</td><td>{p.phone || "—"}</td><td>{p.room || "—"}</td><td>{p.paid ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
        </Card>
      ))}
      <Modal open={seatFor !== null} onClose={() => setSeatFor(null)} title="Add passenger" size="sm" footer={<><Button variant="secondary" onClick={() => setSeatFor(null)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("bookGroupSeat", { groupId: seatFor, ...pax }, "Seat booked"); if (r) { setSeatFor(null); setPax({ name: "", phone: "" }); } }}>Book seat</Button></>}>
        <div className="space-y-3"><Field label="Passenger name" required><Input value={pax.name} onChange={(e) => setPax({ ...pax, name: e.target.value })} /></Field><Field label="Phone"><Input type="tel" value={pax.phone} onChange={(e) => setPax({ ...pax, phone: e.target.value })} /></Field></div>
      </Modal>
    </div>
  );
}

export function ResourcesPage() {
  const assignments = useList("assignments");
  const today = isoDate(new Date());
  return (
    <ResourcePage collection="resources" title="Drivers, guides & vehicles" singular="Resource" subtitle="Assign them to transfers and tours from a booking; double bookings are blocked automatically."
      search={(r) => `${r.name} ${r.city} ${r.kind}`} defaults={{ kind: "driver", active: true }}
      fields={[
        { name: "kind", label: "Type", type: "select", options: [{ value: "driver", label: "Driver" }, { value: "guide", label: "Guide" }, { value: "vehicle", label: "Vehicle" }] },
        { name: "name", label: "Name / registration", type: "text", required: true },
        { name: "phone", label: "Phone", type: "phone" },
        { name: "city", label: "City", type: "text" },
        { name: "details", label: "Details", type: "text", span: 2, placeholder: "Languages, vehicle type, seats…" },
        { name: "active", label: "Active", type: "toggle" },
      ]}
      columns={[
        { key: "name", header: "Name", render: (r) => <span><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-500">{r.details}</span></span>, sort: (r) => r.name },
        { key: "kind", header: "Type", render: (r) => titleCase(r.kind), sort: (r) => r.kind },
        { key: "city", header: "City", render: (r) => r.city || "—" },
        { key: "next", header: "Next 7 days", render: (r) => `${(assignments.data ?? []).filter((a) => a.resourceId === r.id && a.to >= today && a.from <= addDays(today, 7)).length} jobs`, align: "right" },
        { key: "active", header: "Status", render: (r) => <StatusBadge status={r.active ? "active" : "inactive"} /> },
      ]} />
  );
}
