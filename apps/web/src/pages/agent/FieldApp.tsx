import { useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, LogOut, MapPin, Phone, PlayCircle } from "lucide-react";
import { addDays, formatDate, isoDate } from "@voyadesk/core";
import { useAction, useList } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { SERVICE_ICON_LABEL } from "../../lib/format";
import { Brand } from "../../components/Brand";
import { Button, Card, Empty, Loading } from "../../components/ui";
import { toast } from "../../lib/toast";

/** The phone's current position, if the driver allows it (otherwise the update goes without it). */
function here(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({});
    const t = window.setTimeout(() => resolve({}), 6000);
    try {
      navigator.geolocation.getCurrentPosition((p) => { window.clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); }, () => { window.clearTimeout(t); resolve({}); }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 });
    } catch {
      window.clearTimeout(t);
      resolve({});
    }
  });
}

/** Driver / guide view: today's and upcoming jobs, with one-tap status updates. */
export function FieldApp() {
  const { user, loading, signOut } = useSession();
  const nav = useNavigate();
  const resources = useList("resources", Boolean(user));
  const assignments = useList("assignments", Boolean(user));
  const services = useList("services", Boolean(user));
  const bookings = useList("bookings", Boolean(user));
  const { act, busy } = useAction();
  const me = useMemo(() => resources.data?.find((r) => user && r.id === user.resourceId), [resources.data, user]);
  const today = isoDate(new Date());
  const jobs = useMemo(() => (assignments.data ?? []).filter((a) => a.resourceId === me?.id && a.to >= today && a.from <= addDays(today, 14)).sort((a, b) => (a.from < b.from ? -1 : 1)), [assignments.data, me, today]);

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "driver") return <Navigate to="/app" replace />;
  return (
    <div className="min-h-full bg-canvas">
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4"><Brand to="/field" /><button aria-label="Sign out" onClick={() => { signOut(); nav("/"); }}><LogOut className="size-5 text-ink-500" /></button></header>
      <main className="mx-auto max-w-md space-y-3 p-4">
        <h1 className="text-xl font-semibold">Hi {user.name.split(" ")[0]} 👋</h1>
        <p className="text-sm text-ink-500">Your jobs for the next 14 days.</p>
        {!assignments.data || !services.data ? <Loading /> : !me ? <Empty>Your profile isn't linked to a driver/guide record yet. Ask the operations team.</Empty> : jobs.length === 0 ? <Empty>No jobs assigned.</Empty> : jobs.map((a) => {
          const sv = services.data!.find((s) => s.id === a.serviceId);
          const bk = bookings.data?.find((b) => b.id === a.bookingId);
          return (
            <Card key={a.id}>
              <div className="text-xs font-medium uppercase text-brand-700">{a.from === today ? "Today" : formatDate(a.from)} · {sv ? SERVICE_ICON_LABEL[sv.type] : ""}</div>
              <div className="mt-1 font-semibold">{sv?.title ?? "Service"}</div>
              {bk && <div className="mt-1 space-y-0.5 text-sm text-ink-600"><div>{bk.contactName} · {bk.pax.adults + bk.pax.children} guests</div><div className="flex items-center gap-1"><MapPin className="size-4" />{bk.destination} · {bk.number}</div>{bk.phone && <a href={`tel:${bk.phone}`} className="flex items-center gap-1 text-brand-700"><Phone className="size-4" />{bk.phone}</a>}</div>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" busy={busy} icon={<PlayCircle className="size-4" />} onClick={async () => act("driverUpdate", { assignmentId: a.id, status: "started", ...(await here()) }, "Marked started — ops can see it")}>Started</Button>
                <Button variant="success" busy={busy} icon={<CheckCircle2 className="size-4" />} onClick={async () => act("driverUpdate", { assignmentId: a.id, status: "completed", ...(await here()) }, "Marked completed")}>Completed</Button>
              </div>
              <Button size="sm" variant="ghost" className="mt-2 w-full" busy={busy} onClick={async () => { const pos = await here(); if (pos.lat === undefined) { toast.error("Location is off. Allow location for this app in your phone settings."); return; } await act("driverUpdate", { assignmentId: a.id, status: "location", ...pos }, "Location shared with operations"); }}>Share my live location</Button>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
