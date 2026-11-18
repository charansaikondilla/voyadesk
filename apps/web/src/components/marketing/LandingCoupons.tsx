import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Globe, Pencil, Plus, Tag, Ticket, Trash2 } from "lucide-react";
import { formatDate, isDeletable, type Coupon, type LandingPage, type MarketingFunnel } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useList, useMutation, useReport } from "../../lib/hooks";
import { formatCompact, money, pct } from "../../lib/format";
import { copyText } from "../../lib/toast";
import {
  Badge, Button, Card, Confirm, DataTable, Empty, ErrorNote, Field, IconButton, IconChip, Input, Modal, MoneyInput, Progress, SearchInput, Segmented, Select,
  StatusBadge, Textarea, Toggle, cx, type Column,
} from "../ui";
import { CardsSkeleton, FilterPills, landingUrl, Metric, RowMenu, useAccess } from "./kit";

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

/* ───────────────────────── Landing pages ───────────────────────── */

export function LandingTab({ newOpen, onNew, onCloseNew }: { newOpen: boolean; onNew: () => void; onCloseNew: () => void }) {
  const access = useAccess();
  const canEdit = access.write("landingPages");
  const pages = useList("landingPages");
  const packages = useList("packages", access.read("packages"));
  const report = useReport<MarketingFunnel>("marketingFunnel", { days: 365 });
  const m = useMutation();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<LandingPage | null>(null);
  const [deleting, setDeleting] = useState<LandingPage | null>(null);
  const perf = useMemo(() => new Map((report.data?.landingPages ?? []).map((p) => [p.id, p])), [report.data]);
  const all = useMemo(() => [...(pages.data ?? [])].sort((a, b) => Number(b.published) - Number(a.published) || b.createdAt.localeCompare(a.createdAt)), [pages.data]);
  const rows = all.filter((l) => !q || `${l.title} ${l.slug} ${l.headline}`.toLowerCase().includes(q.toLowerCase()));
  const pkgName = (id: string | null) => (id ? packages.data?.find((p) => p.id === id)?.name ?? null : null);
  const open = (l: LandingPage | null) => { setEditing(l); onNew(); };
  const close = () => { setEditing(null); onCloseNew(); };
  const publish = (l: LandingPage, v: boolean) => void m.run(() => api.update("landingPages", l.id, { published: v }), v ? "Page is live" : "Page unpublished");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Landing pages</h2>
          <p className="text-[13px] text-ink-500">One page per offer for your ads and posts. Every enquiry lands in Leads with the page as its source.</p>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search pages…" label="Search landing pages" className="w-full sm:max-w-xs" />
      </div>
      {pages.error && !pages.data ? <ErrorNote message={pages.error.message} onRetry={pages.reload} /> : !pages.data ? <CardsSkeleton n={3} h="h-[200px]" /> : rows.length === 0 ? (
        <Empty icon={<Globe />} title={all.length ? "No pages match" : "Create a landing page"}
          action={!all.length && canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => open(null)}>New landing page</Button> : undefined}>
          {q ? `Nothing matches “${q}”.` : "Feature a package with a headline and an enquiry form. Share the link in Meta or Google ads, Instagram bio or WhatsApp status."}
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((l) => {
            const p = perf.get(l.id);
            const leads = p?.leads ?? l.leads;
            const url = landingUrl(l.slug);
            return (
              <Card key={l.id} className="flex flex-col">
                <div className="flex items-start gap-3">
                  <IconChip tone={l.published ? "cyan" : "gray"}><Globe /></IconChip>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" disabled={!canEdit} onClick={canEdit ? () => open(l) : undefined} className="min-w-0 text-left disabled:cursor-default">
                        <h3 className="truncate text-[15px] font-semibold text-ink-900 hover:text-brand-700">{l.title}</h3>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusBadge status={l.published ? "active" : "draft"} label={l.published ? "Live" : "Draft"} />
                        {canEdit && <RowMenu items={[
                          { label: "Edit page", icon: <Pencil />, onClick: () => open(l) },
                          { label: l.published ? "Unpublish" : "Publish", icon: <Globe />, onClick: () => publish(l, !l.published) },
                          { label: "Delete", icon: <Trash2 />, onClick: () => setDeleting(l), danger: true, hidden: isDeletable("landingPages", l) !== true },
                        ]} />}
                      </div>
                    </div>
                    <p className="truncate font-mono text-xs text-ink-500">/{l.slug}{pkgName(l.packageId) ? <span className="font-sans"> · {pkgName(l.packageId)}</span> : null}</p>
                  </div>
                </div>
                {l.headline && <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-ink-700">{l.headline}</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <Metric label="Leads" value={leads} />
                  <Metric label="Booked" value={p ? p.won : "—"} sub={p && leads ? `${Math.round((p.won / leads) * 100)}%` : undefined} />
                  <Metric label="Revenue" value={p ? formatCompact(p.revenue) : "—"} tone={p && p.revenue ? "good" : undefined} />
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                  {l.published ? (
                    <>
                      <Button size="sm" variant="soft" icon={<Copy className="size-3.5" />} onClick={() => void copyText(url)}>Copy link</Button>
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-700 hover:bg-slate-100"><ExternalLink className="size-3.5" />Open</a>
                    </>
                  ) : canEdit ? <Button size="sm" variant="secondary" icon={<Globe className="size-3.5" />} busy={m.busy} onClick={() => publish(l, true)}>Publish</Button>
                    : <span className="text-xs text-ink-500">Not published yet</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {canEdit && newOpen && <LandingEditor page={editing} packages={(packages.data ?? []).map((p) => ({ id: p.id, name: p.name }))} onClose={close} />}
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger busy={m.busy} title="Delete this landing page?" confirmLabel="Delete page"
        message={deleting && <><b>{deleting.title}</b> will go offline right away and links in your ads will stop working. Leads it brought in stay.</>}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await m.run(() => api.remove("landingPages", deleting.id).then(() => true), "Landing page deleted");
          if (ok) setDeleting(null);
        }} />
    </div>
  );
}

function LandingEditor({ page, packages, onClose }: { page: LandingPage | null; packages: { id: string; name: string }[]; onClose: () => void }) {
  const m = useMutation();
  const [v, setV] = useState({ title: page?.title ?? "", slug: page?.slug ?? "", packageId: page?.packageId ?? null as string | null, headline: page?.headline ?? "", body: page?.body ?? "", published: page?.published ?? false });
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!slugTouched) setV((x) => ({ ...x, slug: slugify(x.title) })); }, [v.title, slugTouched]);
  const errs = {
    title: !v.title.trim() ? "Give the page a title" : m.fieldErrors["title"],
    slug: !/^[a-z0-9-]{3,60}$/.test(v.slug) ? "3–60 lowercase letters, numbers or dashes" : m.fieldErrors["slug"],
  };
  const save = async () => {
    setTouched(true);
    if (errs.title || errs.slug) return;
    const body = { ...v, title: v.title.trim(), headline: v.headline.trim(), body: v.body.trim() };
    const r = await m.run(() => (page ? api.update("landingPages", page.id, body) : api.create("landingPages", body)), page ? "Page saved" : v.published ? "Page is live" : "Page saved as draft");
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="lg" title={page ? `Edit ${page.title}` : "New landing page"} description="Keep it short: one offer, one headline, one button."
      footer={<><div className="mr-auto self-center"><Toggle checked={v.published} onChange={(published) => setV({ ...v, published })} label={v.published ? "Live" : "Draft"} /></div><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.busy} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required error={touched ? errs.title : undefined} className="sm:col-span-2">
          <Input autoFocus value={v.title} maxLength={120} invalid={touched && Boolean(errs.title)} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Bali Honeymoon 2027" />
        </Field>
        <Field label="Web address" required error={touched || slugTouched ? errs.slug : undefined} hint={<span className="break-all font-mono">{landingUrl(v.slug || "your-page")}</span>}>
          <Input value={v.slug} maxLength={60} invalid={(touched || slugTouched) && Boolean(errs.slug)} onChange={(e) => { setSlugTouched(true); setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }); }} />
        </Field>
        <Field label="Featured package" hint="Shows its price, nights and highlights">
          <Select value={v.packageId ?? ""} onChange={(e) => setV({ ...v, packageId: e.target.value || null })}>
            <option value="">— None —</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Headline" className="sm:col-span-2" hint={`${v.headline.length}/160`}>
          <Input value={v.headline} maxLength={160} onChange={(e) => setV({ ...v, headline: e.target.value })} placeholder="Your Bali honeymoon, planned end to end" />
        </Field>
        <Field label="Details" className="sm:col-span-2">
          <Textarea value={v.body} maxLength={4000} rows={5} onChange={(e) => setV({ ...v, body: e.target.value })} placeholder="What's included, who it's for, why book with you." />
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────── Coupons ───────────────────────── */

type CouponState = "active" | "paused" | "expired" | "scheduled" | "used_up";
const COUPON_LABEL: Record<CouponState, string> = { active: "Active", paused: "Paused", expired: "Expired", scheduled: "Starts later", used_up: "Used up" };
const COUPON_TONE: Record<CouponState, string> = { active: "active", paused: "inactive", expired: "expired", scheduled: "scheduled", used_up: "closed" };

export function couponState(c: Coupon, today = new Date().toISOString().slice(0, 10)): CouponState {
  if (!c.active) return "paused";
  if (c.validTo && c.validTo < today) return "expired";
  if (c.maxUses && c.uses >= c.maxUses) return "used_up";
  if (c.validFrom && c.validFrom > today) return "scheduled";
  return "active";
}

export function CouponsTab({ newOpen, onNew, onCloseNew }: { newOpen: boolean; onNew: () => void; onCloseNew: () => void }) {
  const access = useAccess();
  const canEdit = access.write("coupons");
  const coupons = useList("coupons");
  const m = useMutation();
  const [filter, setFilter] = useState<"all" | "active" | "ended">("all");
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const open = (c: Coupon | null) => { setEditing(c); onNew(); };
  const close = () => { setEditing(null); onCloseNew(); };
  const all = useMemo(() => [...(coupons.data ?? [])].sort((a, b) => b.uses - a.uses || a.code.localeCompare(b.code)), [coupons.data]);
  const live = all.filter((c) => ["active", "scheduled"].includes(couponState(c)));
  const rows = filter === "all" ? all : filter === "active" ? live : all.filter((c) => !live.includes(c));

  const columns: Column<Coupon>[] = [
    {
      key: "code", header: "Code", sort: (c) => c.code, render: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-md border border-dashed border-brand-300 bg-brand-50 px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wide text-brand-800">{c.code}</span>
          <IconButton label={`Copy code ${c.code}`} onClick={(e) => { e.stopPropagation(); void copyText(c.code); }}><Copy className="size-3.5" /></IconButton>
        </span>
      ),
    },
    { key: "val", header: "Discount", sort: (c) => c.value, render: (c) => <span className="font-medium">{c.kind === "percent" ? `${pct(c.value)} off` : `${money(c.value)} off`}</span> },
    {
      key: "uses", header: "Used", sort: (c) => c.uses, render: (c) => c.maxUses ? (
        <span className="inline-flex min-w-[120px] flex-col items-end gap-1 md:items-stretch">
          <span className="text-xs tabular-nums text-ink-700">{c.uses} of {c.maxUses}</span>
          <Progress value={(c.uses / c.maxUses) * 100} tone={c.uses >= c.maxUses ? "red" : c.uses / c.maxUses > 0.8 ? "amber" : "blue"} className="w-[120px]" label={`${c.code} usage`} />
        </span>
      ) : <span className="text-xs tabular-nums text-ink-700">{c.uses} · no limit</span>,
    },
    { key: "valid", header: "Valid", hideOnMobile: false, render: (c) => <span className="text-[13px] text-ink-600">{c.validFrom ? formatDate(c.validFrom) : "Now"} → {c.validTo ? formatDate(c.validTo) : "no end"}</span> },
    { key: "state", header: "Status", sort: (c) => couponState(c), render: (c) => { const s = couponState(c); return <StatusBadge status={COUPON_TONE[s]} label={COUPON_LABEL[s]} />; } },
    ...(canEdit ? [{
      key: "_a", header: "", align: "right" as const, render: (c: Coupon) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <RowMenu items={[
            { label: "Edit", icon: <Pencil />, onClick: () => open(c) },
            { label: c.active ? "Pause" : "Resume", icon: <Tag />, onClick: () => void m.run(() => api.update("coupons", c.id, { active: !c.active }), c.active ? `${c.code} paused` : `${c.code} is active`) },
            { label: "Delete", icon: <Trash2 />, onClick: () => setDeleting(c), danger: true, hidden: isDeletable("coupons", c) !== true },
          ]} />
        </span>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Coupons</h2>
          <p className="text-[13px] text-ink-500">Codes customers enter on your website or that your team applies on a quote.</p>
        </div>
        <FilterPills label="Filter coupons" value={filter} onChange={setFilter}
          options={[{ key: "all", label: "All", count: all.length }, { key: "active", label: "Live", count: live.length }, { key: "ended", label: "Ended & paused", count: all.length - live.length }]} />
      </div>
      {coupons.error && !coupons.data ? <ErrorNote message={coupons.error.message} onRetry={coupons.reload} /> : !coupons.data ? <CardsSkeleton n={3} h="h-[56px]" cols="" /> : all.length === 0 ? (
        <Empty icon={<Ticket />} title="No coupons yet" action={canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => open(null)}>New coupon</Button> : undefined}>
          Create a code like FESTIVE10 for a festival sale or WELCOME2000 for first-time customers.
        </Empty>
      ) : (
        <DataTable rows={rows} columns={columns} search={(c) => c.code} onRowClick={canEdit ? (c) => open(c) : undefined} empty="No coupons in this view." />
      )}
      {canEdit && newOpen && <CouponEditor coupon={editing} onClose={close} />}
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger busy={m.busy} title={`Delete ${deleting?.code ?? "coupon"}?`} confirmLabel="Delete coupon"
        message={deleting && <>Customers won't be able to use <b className="font-mono">{deleting.code}</b> any more.{deleting.uses ? " To keep its history, pause it instead." : ""}</>}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await m.run(() => api.remove("coupons", deleting.id).then(() => true), "Coupon deleted");
          if (ok) setDeleting(null);
        }} />
    </div>
  );
}

function CouponEditor({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const m = useMutation();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [kind, setKind] = useState<Coupon["kind"]>(coupon?.kind ?? "percent");
  const [percent, setPercent] = useState(coupon?.kind === "percent" ? String(coupon.value / 100) : "10");
  const [flat, setFlat] = useState<number | null>(coupon?.kind === "flat" ? coupon.value : 200000);
  const [maxUses, setMaxUses] = useState(String(coupon?.maxUses ?? 0));
  const [validFrom, setValidFrom] = useState(coupon?.validFrom ?? "");
  const [validTo, setValidTo] = useState(coupon?.validTo ?? "");
  const [active, setActive] = useState(coupon?.active ?? true);
  const [touched, setTouched] = useState(false);
  const value = kind === "percent" ? Math.round(Number(percent) * 100) : flat ?? 0;
  const errs = {
    code: !/^[A-Z0-9_-]{3,20}$/.test(code) ? "3–20 letters, digits, - or _" : m.fieldErrors["code"],
    value: kind === "percent" ? (!(Number(percent) > 0 && Number(percent) <= 100) ? "Between 0 and 100%" : undefined) : !(value > 0) ? "Enter an amount" : undefined,
    validTo: validFrom && validTo && validTo < validFrom ? "Ends before it starts" : undefined,
  };
  const save = async () => {
    setTouched(true);
    if (errs.code || errs.value || errs.validTo) return;
    const body = { code, kind, value, maxUses: Math.max(0, Math.floor(Number(maxUses) || 0)), validFrom: validFrom || null, validTo: validTo || null, active };
    const r = await m.run(() => (coupon ? api.update("coupons", coupon.id, body) : api.create("coupons", body)), coupon ? "Coupon saved" : `${code} created`);
    if (r) onClose();
  };
  const sample = 5_000_000;
  const off = kind === "percent" ? Math.round((sample * value) / 10000) : Math.min(sample, value);
  return (
    <Modal open onClose={onClose} size="md" title={coupon ? `Edit ${coupon.code}` : "New coupon"} description="Customers type the code at checkout or share it with your team."
      footer={<><div className="mr-auto self-center"><Toggle checked={active} onChange={setActive} label={active ? "Active" : "Paused"} /></div><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.busy} onClick={() => void save()}>Save coupon</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required error={touched ? errs.code : undefined} className="sm:col-span-2">
          <Input autoFocus value={code} maxLength={20} invalid={touched && Boolean(errs.code)} className="font-mono uppercase tracking-wide" placeholder="FESTIVE10" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))} />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-[13px] font-medium text-ink-700">Discount type</div>
          <Segmented label="Discount type" value={kind} onChange={setKind} options={[{ value: "percent", label: "Percent off" }, { value: "flat", label: "Flat ₹ off" }]} />
        </div>
        <Field label={kind === "percent" ? "Percent off" : "Amount off"} required error={touched ? errs.value : undefined}>
          {kind === "percent" ? (
            <div className="relative">
              <Input inputMode="decimal" value={percent} invalid={touched && Boolean(errs.value)} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))} className="pr-8" />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-400">%</span>
            </div>
          ) : <MoneyInput value={flat} onChange={setFlat} invalid={touched && Boolean(errs.value)} aria-label="Amount off" />}
        </Field>
        <Field label="Max uses" hint="0 = unlimited">
          <Input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Valid from" hint="Empty = from today"><Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        <Field label="Valid until" hint="Empty = no end date" error={errs.validTo}><Input type="date" value={validTo} min={validFrom || undefined} onChange={(e) => setValidTo(e.target.value)} invalid={Boolean(errs.validTo)} /></Field>
      </div>
      {!errs.value && (
        <div className={cx("mt-4 flex items-center gap-2 rounded-xl bg-emerald-50/70 px-3 py-2.5 text-[13px] text-emerald-900")}>
          <Ticket className="size-4 text-emerald-600" />On a {money(sample)} trip, <b className="font-mono">{code || "this code"}</b> saves <b>{money(off)}</b>.
        </div>
      )}
      {coupon && coupon.uses > 0 && <p className="mt-3 text-xs text-ink-500"><Badge tone="blue">{coupon.uses} used</Badge> Changing the discount only affects new uses.</p>}
    </Modal>
  );
}
