import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock, Check, ChevronRight, Clock, Copy, Megaphone, Pencil, Plus, Send, Sparkles, Trash2, Users, Zap,
} from "lucide-react";
import { isDeletable, WHATSAPP_MARKETING_COST, type Campaign, type MarketingFunnel, type Segment } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useAction, useList, useMutation, useReport } from "../../lib/hooks";
import { formatCompact, formatDateTime, money, relTime } from "../../lib/format";
import { useSession } from "../../lib/session";
import { toast } from "../../lib/toast";
import { Badge, Button, Callout, Card, Confirm, Empty, ErrorNote, Field, IconChip, Input, Modal, SearchInput, StatusBadge, cx } from "../ui";
import {
  AudienceSummary, CardsSkeleton, CHANNEL, ChannelBadge, FilterPills, fillPlaceholders, hourText, MessageEditor, MessagePreview, Metric, plural, roiText,
  RowMenu, storeUrl, unknownPlaceholders, useAccess, useAudience, type Channel,
} from "./kit";
import { rulesSentence } from "./segmentRules";

type Perf = MarketingFunnel["campaigns"][number];
type Filter = "all" | "draft" | "scheduled" | "sent";
const TOKENS = ["{name}", "{company}", "{link}"];

const TEMPLATES: { label: string; text: string }[] = [
  { label: "Festive offer", text: "Hi {name}! This festive season, {company} has handpicked holidays with up to 10% off. Use code FESTIVE10 while seats last. See the offers: {link}" },
  { label: "Welcome back", text: "Hi {name}, it's been a while! Planning your next trip? We've got fresh packages for the coming months — have a look: {link}. Reply here and we'll plan it for you. — {company}" },
  { label: "New package", text: "Hi {name}, new from {company}: a 5-night escape with flights, hotel and transfers included. Limited dates — check them out: {link}" },
];

/* ───────────────────────── Campaigns tab ───────────────────────── */

export function CampaignsTab({ composeOpen, onCompose, onCloseCompose, initialSegmentId = null }: { composeOpen: boolean; onCompose: () => void; onCloseCompose: () => void; initialSegmentId?: string | null }) {
  const access = useAccess();
  const canEdit = access.write("campaigns");
  const campaigns = useList("campaigns");
  const segments = useList("segments", access.read("segments"));
  const report = useReport<MarketingFunnel>("marketingFunnel", { days: 365 });
  const m = useMutation();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const perf = useMemo(() => new Map((report.data?.campaigns ?? []).map((c) => [c.id, c])), [report.data]);
  const all = useMemo(() => [...(campaigns.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [campaigns.data]);
  const segName = (id: string | null) => (id ? segments.data?.find((s) => s.id === id)?.name ?? "Saved audience" : "All contacts");
  const counts = { all: all.length, draft: all.filter((c) => c.status === "draft").length, scheduled: all.filter((c) => c.status === "scheduled").length, sent: all.filter((c) => c.status === "sent").length };
  const rows = all.filter((c) => (filter === "all" || c.status === filter) && (!q || `${c.name} ${c.message} ${segName(c.segmentId)}`.toLowerCase().includes(q.toLowerCase())));

  const totals = useMemo(() => {
    const sent = all.filter((c) => c.status === "sent").map((c) => perfOf(c, perf.get(c.id)));
    return {
      n: sent.length,
      sent: sent.reduce((a, p) => a + p.sent, 0),
      leads: sent.reduce((a, p) => a + p.leads, 0),
      bookings: sent.reduce((a, p) => a + p.bookings, 0),
      revenue: sent.reduce((a, p) => a + p.revenue, 0),
      cost: sent.reduce((a, p) => a + p.cost, 0),
    };
  }, [all, perf]);

  const openComposer = (c: Campaign | null) => { setEditing(c); onCompose(); };
  const closeComposer = () => { setEditing(null); onCloseCompose(); };
  const duplicate = async (c: Campaign) => {
    const copy = await m.run(() => api.create("campaigns", { name: `${c.name} (copy)`.slice(0, 120), channel: c.channel, segmentId: c.segmentId, message: c.message }), "Copied as a new draft");
    if (copy) openComposer(copy);
  };

  return (
    <div className="space-y-5">
      <Callout tone="info">
        Messages go out through the WhatsApp/email provider connected in Settings → Integrations (the demo doesn't really send). WhatsApp marketing messages cost about ₹{(WHATSAPP_MARKETING_COST / 100).toFixed(2)} each plus your provider's fee and 18% GST; email is free.
      </Callout>

      {all.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Sent · 12 months" value={totals.sent.toLocaleString("en-IN")} sub={plural(totals.n, "campaign")} />
          <SummaryTile label="Leads from campaigns" value={totals.leads.toLocaleString("en-IN")} sub={totals.sent ? `${((totals.leads / totals.sent) * 100).toFixed(1)}% of messages` : "—"} />
          <SummaryTile label="Bookings · revenue" value={formatCompact(totals.revenue)} sub={plural(totals.bookings, "booking")} tone="good" />
          <SummaryTile label="Message cost" value={money(totals.cost)} sub={totals.cost ? `ROI ${roiText(Math.round(((totals.revenue - totals.cost) / totals.cost) * 100))}` : "Email is free"} />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterPills label="Filter campaigns" value={filter} onChange={setFilter}
          options={[{ key: "all", label: "All", count: counts.all }, { key: "draft", label: "Drafts", count: counts.draft }, { key: "scheduled", label: "Scheduled", count: counts.scheduled }, { key: "sent", label: "Sent", count: counts.sent }]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search campaigns…" label="Search campaigns" className="w-full sm:max-w-xs" />
      </div>

      {campaigns.error && !campaigns.data ? <ErrorNote message={campaigns.error.message} onRetry={campaigns.reload} /> : !campaigns.data ? <CardsSkeleton n={4} h="h-[190px]" cols="lg:grid-cols-2" /> : rows.length === 0 ? (
        <Empty icon={<Megaphone />} title={all.length ? "No campaigns here" : "Send your first campaign"}
          action={!all.length && canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => openComposer(null)}>New campaign</Button> : undefined}>
          {q ? `Nothing matches “${q}”.` : all.length ? "Try another filter." : "Bring past travellers back with a WhatsApp or email offer. You'll see who gets it and what it costs before anything is sent."}
        </Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <CampaignCard key={c.id} c={c} perf={perf.get(c.id)} segName={segName(c.segmentId)} canEdit={canEdit}
              onOpen={() => openComposer(c)} onDuplicate={() => void duplicate(c)} onDelete={() => setDeleting(c)} />
          ))}
        </div>
      )}

      {canEdit && composeOpen && <CampaignComposer open campaign={editing} initialSegmentId={initialSegmentId} segments={segments.data ?? []} onClose={closeComposer} onDuplicate={(c) => void duplicate(c)} />}
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger busy={m.busy} title="Delete this campaign?" confirmLabel="Delete campaign"
        message={deleting && <><b>{deleting.name}</b> will be removed{deleting.status === "scheduled" ? " and won't go out" : ""}. This can't be undone.</>}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await m.run(() => api.remove("campaigns", deleting.id).then(() => true), "Campaign deleted");
          if (ok) setDeleting(null);
        }} />
    </div>
  );
}

function SummaryTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3 shadow-card">
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div className={cx("mt-0.5 text-xl font-semibold tabular-nums tracking-tight", tone === "good" ? "text-emerald-700" : "text-ink-900")}>{value}</div>
      {sub && <div className="text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

/** Performance for a campaign: the report when available, otherwise the counters stored on the campaign. */
function perfOf(c: Campaign, p: Perf | undefined): Omit<Perf, "id" | "name" | "channel" | "status" | "scheduledAt"> {
  if (p) return p;
  return { sent: c.sentCount, delivered: c.sentCount, read: c.openCount, leads: c.leadCount, bookings: 0, revenue: 0, cost: c.cost, roiPct: null };
}

function CampaignCard({ c, perf, segName, canEdit, onOpen, onDuplicate, onDelete }: {
  c: Campaign; perf: Perf | undefined; segName: string; canEdit: boolean; onOpen: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const ch = CHANNEL[c.channel];
  const p = perfOf(c, perf);
  const deletable = isDeletable("campaigns", c) === true;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3">
        <IconChip tone={ch.tone}>{ch.icon}</IconChip>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={canEdit ? onOpen : undefined} disabled={!canEdit} className="min-w-0 text-left disabled:cursor-default">
              <h3 className="truncate text-[15px] font-semibold text-ink-900 hover:text-brand-700">{c.name}</h3>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <StatusBadge status={c.status} />
              {canEdit && <RowMenu items={[
                { label: c.status === "sent" ? "View details" : "Edit", icon: <Pencil />, onClick: onOpen },
                { label: "Duplicate", icon: <Copy />, onClick: onDuplicate },
                { label: "Delete", icon: <Trash2 />, onClick: onDelete, danger: true, hidden: !deletable },
              ]} />}
            </div>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
            <span>{ch.label}</span><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><Users className="size-3" />{segName}</span>
            <span aria-hidden>·</span>
            <span>{c.status === "sent" ? `sent ${relTime(c.scheduledAt ?? c.updatedAt)}` : c.status === "scheduled" ? `goes out ${formatDateTime(c.scheduledAt)}` : `created ${relTime(c.createdAt)}`}</span>
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-ink-600">{c.message}</p>
      <div className="mt-auto pt-3">
        {c.status === "sent" ? <PerfStrip p={p} /> : (
          <div className={cx("flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2", c.status === "scheduled" ? "bg-cyan-50/70" : "bg-slate-50")}>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-700">
              {c.status === "scheduled" ? <><CalendarClock className="size-4 text-cyan-700" />Scheduled for {formatDateTime(c.scheduledAt)}</> : <><Pencil className="size-3.5 text-ink-400" />Draft — not sent yet</>}
            </span>
            {canEdit && <Button size="sm" variant={c.status === "draft" ? "primary" : "soft"} icon={<Send className="size-3.5" />} onClick={onOpen}>{c.status === "draft" ? "Review & send" : "Review"}</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}

/** sent → delivered → read → leads → bookings → revenue, with step rates. */
export function PerfStrip({ p }: { p: Omit<Perf, "id" | "name" | "channel" | "status" | "scheduledAt"> }) {
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const steps = [
    { label: "Sent", value: p.sent.toLocaleString("en-IN") },
    { label: "Delivered", value: p.delivered.toLocaleString("en-IN"), sub: rate(p.delivered, p.sent) },
    { label: "Read", value: p.read.toLocaleString("en-IN"), sub: rate(p.read, p.delivered || p.sent) },
    { label: "Leads", value: p.leads.toLocaleString("en-IN"), sub: rate(p.leads, p.sent) },
    { label: "Bookings", value: p.bookings.toLocaleString("en-IN"), sub: rate(p.bookings, p.leads) },
  ];
  return (
    <div className="rounded-lg border border-line bg-slate-50/60 p-3">
      <ol className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5" aria-label="Campaign results">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex items-start gap-1">
            <Metric label={s.label} value={s.value} sub={s.sub} />
            {i < steps.length - 1 && <ChevronRight className="absolute -right-2 top-3 hidden size-3.5 text-ink-300 sm:block" aria-hidden />}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line pt-2.5 text-[13px]">
        <span className="text-ink-600">Revenue <b className="tabular-nums text-ink-900">{money(p.revenue)}</b> · cost <span className="tabular-nums">{money(p.cost)}</span></span>
        <Badge tone={p.roiPct === null ? "gray" : p.roiPct >= 0 ? "green" : "red"}>ROI {roiText(p.roiPct)}</Badge>
      </div>
    </div>
  );
}

/* ───────────────────────── composer ───────────────────────── */

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Basics", "Audience", "Message", "Send"] as const;
type When = "now" | "best" | "pick";

const localInput = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 16);
};

export function CampaignComposer({ open, campaign, segments, onClose, onDuplicate, initialSegmentId = null }: { open: boolean; campaign: Campaign | null; segments: Segment[]; onClose: () => void; onDuplicate: (c: Campaign) => void; initialSegmentId?: string | null }) {
  const { settings } = useSession();
  const company = settings?.companyName || "Your agency";
  const report = useReport<MarketingFunnel>("marketingFunnel", { days: 90 }, open);
  const m = useMutation();
  const { act, busy: acting } = useAction();
  const locked = campaign?.status === "sent";

  const [id, setId] = useState<string | null>(campaign?.id ?? null);
  const [step, setStep] = useState<Step>(campaign ? 3 : 0);
  const [name, setName] = useState(campaign?.name ?? "");
  const [channel, setChannel] = useState<Channel>(campaign?.channel ?? "whatsapp");
  const [segmentId, setSegmentId] = useState<string | null>(campaign ? campaign.segmentId : initialSegmentId);
  const [message, setMessage] = useState(campaign?.message ?? "");
  const [when, setWhen] = useState<When>("now");
  const [at, setAt] = useState(() => localInput(new Date(Date.now() + 24 * 3_600_000)));
  const [confirm, setConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    setId(campaign?.id ?? null); setStep(campaign ? 3 : 0); setName(campaign?.name ?? ""); setChannel(campaign?.channel ?? "whatsapp");
    setSegmentId(campaign ? campaign.segmentId : initialSegmentId); setMessage(campaign?.message ?? ""); setWhen("now"); setTouched(false);
  }, [campaign?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const audience = useAudience({ segmentId }, channel, open);
  const a = audience.data;
  const first = a?.sample[0];
  const vars = { name: first?.name.split(/\s+/)[0] ?? "Priya", company, link: storeUrl() };
  const filled = fillPlaceholders(message, vars);
  const bestHour = report.data?.bestSendHour;
  const unknown = unknownPlaceholders(message, TOKENS);

  const errs = { name: !name.trim() ? "Give the campaign a name" : undefined, message: !message.trim() ? "Write the message" : undefined };
  const stepOk = (s: Step) => (s === 0 ? !errs.name : s === 2 ? !errs.message : true);
  const canSave = !errs.name && !errs.message;
  const reachable = a?.reachable ?? null;
  const cost = a ? (channel === "whatsapp" ? a.estCost : channel === "email" ? 0 : a.estCost) : null;
  const pickedAt = when === "pick" ? new Date(at) : null;
  const pickBad = when === "pick" && (!at || Number.isNaN(pickedAt!.getTime()) || pickedAt!.getTime() < Date.now() + 60_000);

  const persist = async (): Promise<string | null> => {
    const body = { name: name.trim(), channel, segmentId, message: message.trim() };
    const row = await m.run(() => (id ? api.update("campaigns", id, body) : api.create("campaigns", body)));
    if (!row) return null;
    setId(row.id);
    return row.id;
  };

  const saveDraft = async () => {
    setTouched(true);
    if (!canSave || locked) return;
    const cid = await persist();
    if (cid) { toast.success(campaign ? "Changes saved" : "Draft saved"); onClose(); }
  };

  const go = async () => {
    setTouched(true);
    if (!canSave || locked || sending.current) return;
    if (when === "now") { setConfirm(true); return; }
    if (pickBad) return;
    sending.current = true;
    try {
      const cid = await persist();
      if (!cid) return;
      const r = await act("scheduleCampaign", { campaignId: cid, at: when === "best" ? null : pickedAt!.toISOString() }, when === "best" ? "Scheduled for the best time to reach this audience" : `Scheduled for ${formatDateTime(pickedAt!.toISOString())}`);
      if (r) onClose();
    } finally { sending.current = false; }
  };

  const sendNow = async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      const cid = await persist();
      if (!cid) return;
      const r = await act<Campaign>("sendCampaign", { campaignId: cid }, (x) => `Sending to ${plural(x.sentCount, "person", "people")}${x.cost ? ` · est. ${money(x.cost)}` : ""}`);
      if (r) { setConfirm(false); onClose(); }
    } finally { sending.current = false; }
  };

  const next = () => { setTouched(true); if (stepOk(step)) { setTouched(false); setStep((s) => Math.min(3, s + 1) as Step); } };
  const segment = segments.find((s) => s.id === segmentId);
  const busy = m.busy || acting;

  const footer = locked ? (
    <>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      {campaign && <Button icon={<Copy className="size-4" />} onClick={() => { onClose(); onDuplicate(campaign); }}>Duplicate</Button>}
    </>
  ) : (
    <>
      {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1) as Step)} className="mr-auto">Back</Button>}
      <Button variant="secondary" busy={m.busy && !confirm} disabled={busy} onClick={() => void saveDraft()}>Save draft</Button>
      {step < 3 ? <Button onClick={next} icon={<ChevronRight className="size-4" />}>Next: {STEPS[step + 1]}</Button> : (
        <Button busy={busy} disabled={pickBad || reachable === 0} icon={when === "now" ? <Send className="size-4" /> : <CalendarClock className="size-4" />} onClick={() => void go()}>
          {when === "now" ? `Send${reachable ? ` to ${reachable.toLocaleString("en-IN")}` : ""}` : when === "best" ? "Schedule for best time" : "Schedule"}
        </Button>
      )}
    </>
  );

  return (
    <>
      <Modal open={open} onClose={onClose} size="xl" title={locked ? campaign?.name ?? "Campaign" : campaign ? "Edit campaign" : "New campaign"}
        description={locked ? `Sent ${formatDateTime(campaign?.scheduledAt ?? campaign?.updatedAt)} · sent campaigns can't be changed or re-sent — duplicate it to send again.` : "Pick who gets it, write it, check the preview, then send or schedule."}
        footer={footer}>
        {!locked && (
          <ol className="mb-5 flex items-center gap-1.5 overflow-x-auto no-scrollbar" aria-label="Steps">
            {STEPS.map((label, i) => {
              const done = i < step;
              const reachableStep = i <= step || [0, 1, 2].slice(0, i).every((s) => stepOk(s as Step));
              return (
                <li key={label} className="flex shrink-0 items-center gap-1.5">
                  <button type="button" disabled={!reachableStep} onClick={() => setStep(i as Step)} aria-current={i === step ? "step" : undefined}
                    className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium transition", i === step ? "bg-brand-600 text-white" : done ? "bg-brand-50 text-brand-700 hover:bg-brand-100" : "bg-slate-100 text-ink-500 hover:text-ink-800 disabled:opacity-60")}>
                    <span className={cx("inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold", i === step ? "bg-white/25" : done ? "bg-brand-600 text-white" : "bg-white text-ink-500")}>{done ? <Check className="size-3" /> : i + 1}</span>
                    {label}
                  </button>
                  {i < STEPS.length - 1 && <ChevronRight className="size-3.5 text-ink-300" aria-hidden />}
                </li>
              );
            })}
          </ol>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {(locked || step === 0) && (
              <>
                {!locked && (
                  <Field label="Campaign name" required error={touched ? errs.name : undefined} hint={channel === "email" ? "Also used as the email subject line." : "Only your team sees this."}>
                    <Input autoFocus value={name} maxLength={120} invalid={touched && Boolean(errs.name)} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali Dubai special" />
                  </Field>
                )}
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-ink-700">Channel</div>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Channel">
                    {(Object.keys(CHANNEL) as Channel[]).map((k) => {
                      const c = CHANNEL[k];
                      const sel = channel === k;
                      return (
                        <button key={k} type="button" role="radio" aria-checked={sel} disabled={locked} onClick={() => setChannel(k)}
                          className={cx("flex items-start gap-2.5 rounded-xl border p-3 text-left transition disabled:cursor-default", sel ? "border-brand-500 bg-brand-50/50 ring-2 ring-brand-100" : "border-line bg-white hover:border-line-strong")}>
                          <IconChip tone={c.tone} size="sm">{c.icon}</IconChip>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink-900">{c.label}</span>
                            <span className="block text-xs text-ink-500">{k === "whatsapp" ? `₹${(WHATSAPP_MARKETING_COST / 100).toFixed(2)}/msg · best replies` : k === "email" ? "Free · longer content" : "Short text · provider rate"}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {(locked || step === 1) && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink-700">Who should get it?</span>
                  {!locked && <Link to="/app/marketing?tab=segments&new=1" className="text-[13px] font-medium text-brand-700 hover:underline" onClick={onClose}>+ New audience</Link>}
                </div>
                <div className="space-y-2" role="radiogroup" aria-label="Audience">
                  {[{ id: null as string | null, name: "Everyone", description: "All contacts in your CRM", rules: [] as Segment["rules"] }, ...segments].filter((s) => !locked || s.id === segmentId).map((s) => {
                    const sel = segmentId === s.id;
                    return (
                      <button key={s.id ?? "all"} type="button" role="radio" aria-checked={sel} disabled={locked} onClick={() => setSegmentId(s.id)}
                        className={cx("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-default", sel ? "border-brand-500 bg-brand-50/50 ring-2 ring-brand-100" : "border-line bg-white hover:border-line-strong")}>
                        <span className={cx("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border", sel ? "border-brand-600 bg-brand-600" : "border-line-strong")}>{sel && <span className="size-1.5 rounded-full bg-white" />}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink-900">{s.name}</span>
                          <span className="block text-xs leading-5 text-ink-500">{s.id ? rulesSentence(s.rules) : s.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {segments.length === 0 && !locked && <p className="mt-2 text-xs text-ink-500">Tip: build audiences like “Past travellers” or “Asked about Dubai” in the Audiences tab.</p>}
              </div>
            )}

            {(locked || step === 2) && (
              <div className="space-y-3">
                {!locked && !message.trim() && (
                  <div>
                    <div className="mb-1.5 text-[13px] font-medium text-ink-700">Start from a template</div>
                    <div className="flex flex-wrap gap-2">
                      {TEMPLATES.map((t) => <Button key={t.label} size="sm" variant="secondary" icon={<Sparkles className="size-3.5 text-violet-600" />} onClick={() => setMessage(t.text)}>{t.label}</Button>)}
                    </div>
                  </div>
                )}
                {locked ? (
                  <div>
                    <div className="mb-1.5 text-[13px] font-medium text-ink-700">Message</div>
                    <p className="whitespace-pre-wrap rounded-xl border border-line bg-slate-50 p-3 text-sm leading-6 text-ink-800">{message}</p>
                  </div>
                ) : (
                  <>
                    <MessageEditor id="campaign-message" value={message} onChange={setMessage} tokens={TOKENS} channel={channel} invalid={touched && Boolean(errs.message)} />
                    {touched && errs.message && <p className="text-xs text-rose-600">{errs.message}</p>}
                  </>
                )}
                {channel === "whatsapp" && !locked && <p className="text-xs leading-5 text-ink-500">WhatsApp needs an approved marketing template for messages to people who haven't written to you in 24 hours. Keep it short and include a clear next step.</p>}
              </div>
            )}

            {!locked && step === 3 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-line">
                  <ReviewRow label="Campaign" onEdit={() => setStep(0)}>{name || <span className="text-rose-600">No name yet</span>} · <ChannelBadge channel={channel} /></ReviewRow>
                  <ReviewRow label="Audience" onEdit={() => setStep(1)}>{segment ? segment.name : "Everyone"}{reachable !== null && <span className="text-ink-500"> · {plural(reachable, "person", "people")}</span>}</ReviewRow>
                  <ReviewRow label="Message" onEdit={() => setStep(2)}><span className="line-clamp-2">{message || <span className="text-rose-600">No message yet</span>}</span></ReviewRow>
                </div>
                {unknown.length > 0 && <Callout tone="warn">{unknown.join(", ")} isn't a placeholder we can fill — it will be sent as typed.</Callout>}
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-ink-700">When should it go out?</div>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="When to send">
                    <WhenCard sel={when === "now"} onClick={() => setWhen("now")} icon={<Zap />} title="Send now" sub="Starts within a minute" />
                    <WhenCard sel={when === "best"} onClick={() => setWhen("best")} icon={<Sparkles />} title="Best time" sub={bestHour?.sample ? `Around ${hourText(bestHour.hour)}, when people reply most` : "When your customers reply most"} />
                    <WhenCard sel={when === "pick"} onClick={() => setWhen("pick")} icon={<Clock />} title="Pick a time" sub="Choose date and time" />
                  </div>
                  {when === "pick" && (
                    <Field label="Send on" className="mt-3 max-w-xs" error={pickBad ? "Pick a time in the future" : undefined}>
                      <Input type="datetime-local" value={at} min={localInput(new Date())} onChange={(e) => setAt(e.target.value)} invalid={pickBad} />
                    </Field>
                  )}
                </div>
                {reachable === 0 && <Callout tone="bad">Nobody in this audience has a {CHANNEL[channel].reach}. Pick another audience or channel.</Callout>}
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start" aria-label="Preview">
            <AudienceSummary q={audience} channel={channel} compact={step === 2} />
            <div className={cx(step === 0 && !locked ? "hidden lg:block" : "")}>
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">
                <span>Preview</span>{first && <span className="normal-case tracking-normal">as {first.name}</span>}
              </div>
              <MessagePreview channel={channel} text={filled} sender={company} subject={name} to={first?.email} />
            </div>
          </aside>
        </div>
      </Modal>

      <Confirm open={confirm} onClose={() => setConfirm(false)} busy={busy} title={`Send to ${reachable === null ? "this audience" : plural(reachable, "person", "people")} now?`} confirmLabel="Yes, send now"
        message={
          <div className="space-y-2">
            <p><b>{name}</b> goes out on {CHANNEL[channel].label} to {reachable === null ? "everyone reachable in" : <b>{plural(reachable, "person", "people")}</b>} {segment ? <>in <b>{segment.name}</b></> : "in your contacts"}.</p>
            <p>Estimated cost: <b>{cost === null ? "—" : cost === 0 ? "free" : money(cost)}</b>{channel !== "email" && " + provider fee + 18% GST"}.</p>
            <p className="text-ink-500">Once sent it can't be undone or sent again.</p>
          </div>
        }
        onConfirm={() => void sendNow()} />
    </>
  );
}

function ReviewRow({ label, children, onEdit }: { label: string; children: ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-0">
      <span className="w-20 shrink-0 text-xs font-medium text-ink-500">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-ink-900">{children}</span>
      <button type="button" onClick={onEdit} className="shrink-0 text-[13px] font-medium text-brand-700 hover:underline" aria-label={`Change ${label.toLowerCase()}`}>Change</button>
    </div>
  );
}

function WhenCard({ sel, onClick, icon, title, sub }: { sel: boolean; onClick: () => void; icon: ReactNode; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={sel} onClick={onClick}
      className={cx("flex items-start gap-2.5 rounded-xl border p-3 text-left transition", sel ? "border-brand-500 bg-brand-50/50 ring-2 ring-brand-100" : "border-line bg-white hover:border-line-strong")}>
      <IconChip tone={sel ? "blue" : "gray"} size="sm">{icon}</IconChip>
      <span className="min-w-0"><span className="block text-sm font-semibold text-ink-900">{title}</span><span className="block text-xs leading-5 text-ink-500">{sub}</span></span>
    </button>
  );
}


