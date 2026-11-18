import { Link } from "react-router-dom";
import { ExternalLink, Globe2, Handshake, Plane, Stamp, Store } from "lucide-react";
import { api } from "../../lib/api";
import { useList } from "../../lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "../../components/ui";

export function PortalsPage() {
  const packages = useList("packages");
  const lps = useList("landingPages");
  const t = api.tenantId || "demo";
  const base = `${window.location.origin}${window.location.pathname}#`;
  const items = [
    { icon: <Store className="size-5" />, title: "Holiday storefront (B2C)", desc: `${(packages.data ?? []).filter((p) => p.published).length} published packages and open group departures. Enquiries arrive as scored website leads.`, href: `/store/${t}` },
    { icon: <Handshake className="size-5" />, title: "B2B agent portal", desc: "Agents build quotes at their slab price, book on wallet or credit, and see their statement. Invite agents from Settings → Team.", href: "/agent" },
    { icon: <Stamp className="size-5" />, title: "Visa status tracker", desc: "Customers check progress with their file number and phone — no login.", href: `/visa-status/${t}` },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Website & portals" subtitle="Customer- and agent-facing front-ends that share your CRM's data." />
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((i) => (
          <Card key={i.title}>
            <div className="flex items-center gap-2 text-brand-700">{i.icon}<span className="font-semibold text-ink-900">{i.title}</span></div>
            <p className="mt-2 text-sm text-ink-600">{i.desc}</p>
            <Link to={i.href} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Open <ExternalLink className="size-3.5" /></Link>
            <div className="mt-1 break-all text-xs text-ink-400">{base}{i.href}</div>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle title="Landing pages" action={<Link to="/app/marketing?tab=landing" className="text-sm text-brand-700 hover:underline">Manage</Link>} />
        <ul className="divide-y divide-line text-sm">{(lps.data ?? []).map((l) => <li key={l.id} className="flex items-center justify-between py-2"><span>{l.title} <span className="text-ink-500">/{l.slug}</span></span><span className="flex items-center gap-2"><Badge tone={l.published ? "green" : "gray"}>{l.published ? "Live" : "Draft"}</Badge>{l.published && <Link className="text-brand-700 hover:underline" to={`/lp/${t}/${l.slug}`}>Open</Link>}</span></li>)}</ul>
      </Card>
      <Card>
        <CardTitle title="Booking engines" subtitle="Connect live inventory from Settings → Integrations" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm"><Plane className="mt-0.5 size-5 text-brand-700" /><div><div className="font-medium">Flights (GDS / LCC aggregators)</div><p className="text-ink-600">Adapter ready for an India aggregator account. Start with an aggregator — direct GDS contracts are costly and slow to obtain.</p></div></div>
          <div className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm"><Globe2 className="mt-0.5 size-5 text-brand-700" /><div><div className="font-medium">Hotels (API + contracted)</div><p className="text-ink-600">Contracted rates live in Masters today; an API adapter adds live availability alongside them.</p></div></div>
        </div>
      </Card>
    </div>
  );
}
