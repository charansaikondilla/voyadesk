import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Pencil, Plus, Send, Trash2, Users, X } from "lucide-react";
import { isDeletable, type Segment } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useList, useMutation } from "../../lib/hooks";
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, IconButton, IconChip, Input, Modal, SearchInput, Segmented, Select, cx } from "../ui";
import { AudienceSummary, CardsSkeleton, RowMenu, plural, useAccess, useAudience, useDebounced, type Channel } from "./kit";
import { cleanRules, FIELD_ORDER, RULE_FIELDS, ruleError, rulesSentence, ruleText, type Rule, type RuleField } from "./segmentRules";

const QUICK: { label: string; rule: Rule }[] = [
  { label: "Past travellers", rule: { field: "trips", op: "gte", value: "1" } },
  { label: "Repeat travellers", rule: { field: "trips", op: "gte", value: "2" } },
  { label: "Spent ₹1L+", rule: { field: "totalSpend", op: "gte", value: "100000" } },
  { label: "Hot leads", rule: { field: "temperature", op: "eq", value: "hot" } },
  { label: "Asked about Dubai", rule: { field: "destination", op: "contains", value: "dubai" } },
];

export function AudiencesTab({ newOpen, onNew, onCloseNew }: { newOpen: boolean; onNew: () => void; onCloseNew: () => void }) {
  const access = useAccess();
  const canEdit = access.write("segments");
  const segments = useList("segments");
  const campaigns = useList("campaigns", access.read("campaigns"));
  const m = useMutation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState<Segment | null>(null);

  const all = useMemo(() => [...(segments.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [segments.data]);
  const rows = all.filter((s) => !q || `${s.name} ${s.description} ${rulesSentence(s.rules)}`.toLowerCase().includes(q.toLowerCase()));
  const usedBy = (id: string) => (campaigns.data ?? []).filter((c) => c.segmentId === id && c.status !== "sent");
  const open = (s: Segment | null) => { setEditing(s); onNew(); };
  const close = () => { setEditing(null); onCloseNew(); };
  const duplicate = async (s: Segment) => {
    const copy = await m.run(() => api.create("segments", { name: `${s.name} (copy)`.slice(0, 120), description: s.description, rules: s.rules }), "Audience copied");
    if (copy) open(copy);
  };
  const blocking = deleting ? usedBy(deleting.id) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Segments</h2>
          <p className="text-[13px] text-ink-500">Saved audiences of customers you can send campaigns to. Counts update on their own as your contacts change.</p>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search audiences…" label="Search audiences" className="w-full sm:max-w-xs" />
      </div>

      {segments.error && !segments.data ? <ErrorNote message={segments.error.message} onRetry={segments.reload} /> : !segments.data ? <CardsSkeleton n={3} /> : rows.length === 0 ? (
        <Empty icon={<Users />} title={all.length ? "No audiences match" : "Create your first audience"}
          action={!all.length && canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => open(null)}>New audience</Button> : undefined}>
          {q ? `Nothing matches “${q}”.` : "Group customers by trips taken, spend, city, tags or the destinations they asked about — then send them a campaign."}
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <SegmentCard key={s.id} s={s} canEdit={canEdit} canCampaign={access.write("campaigns")}
              onEdit={() => open(s)} onDuplicate={() => void duplicate(s)} onDelete={() => setDeleting(s)}
              onCampaign={() => navigate(`/app/marketing?tab=campaigns&new=1&segment=${s.id}`)} />
          ))}
        </div>
      )}

      {canEdit && newOpen && <SegmentEditor segment={editing} onClose={close} />}
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger busy={m.busy} title="Delete this audience?" confirmLabel={blocking.length ? "OK" : "Delete audience"}
        message={deleting && (blocking.length
          ? <><b>{deleting.name}</b> is used by {plural(blocking.length, "draft or scheduled campaign")} ({blocking.slice(0, 2).map((c) => c.name).join(", ")}{blocking.length > 2 ? "…" : ""}). Change their audience first, then delete it.</>
          : <><b>{deleting.name}</b> will be removed. Contacts aren't affected, and past campaign results stay.</>)}
        onConfirm={async () => {
          if (!deleting) return;
          if (blocking.length) { setDeleting(null); return; }
          const ok = await m.run(() => api.remove("segments", deleting.id).then(() => true), "Audience deleted");
          if (ok) setDeleting(null);
        }} />
    </div>
  );
}

function SegmentCard({ s, canEdit, canCampaign, onEdit, onDuplicate, onDelete, onCampaign }: { s: Segment; canEdit: boolean; canCampaign: boolean; onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onCampaign: () => void }) {
  const wa = useAudience({ segmentId: s.id }, "whatsapp");
  const deletable = isDeletable("segments", s) === true;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3">
        <IconChip tone="violet"><Users /></IconChip>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={canEdit ? onEdit : undefined} disabled={!canEdit} className="min-w-0 text-left disabled:cursor-default">
              <h3 className="truncate text-[15px] font-semibold text-ink-900 hover:text-brand-700">{s.name}</h3>
            </button>
            {canEdit && <RowMenu items={[
              { label: "Edit rules", icon: <Pencil />, onClick: onEdit },
              { label: "Duplicate", icon: <Copy />, onClick: onDuplicate },
              { label: "Delete", icon: <Trash2 />, onClick: onDelete, danger: true, hidden: !deletable },
            ]} />}
          </div>
          {s.description && <p className="truncate text-xs text-ink-500">{s.description}</p>}
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-ink-700">{rulesSentence(s.rules)}</p>
      {s.rules.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.rules.map((r, i) => <Badge key={i} tone="violet">{RULE_FIELDS[r.field].label}: {ruleText(r).replace(/^(are|have|live|asked) /, "")}</Badge>)}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <div className="text-[13px] text-ink-600" aria-live="polite">
          {wa.data ? <><b className="text-lg tabular-nums text-ink-900">{wa.data.count.toLocaleString("en-IN")}</b> {wa.data.count === 1 ? "contact" : "contacts"} <span className="text-ink-400">· {wa.data.reachable} on WhatsApp</span></>
            : wa.error ? <span className="text-ink-400">Count unavailable</span> : <span className="skeleton inline-block h-5 w-28 rounded" />}
        </div>
        {canCampaign && <Button size="sm" variant="soft" icon={<Send className="size-3.5" />} onClick={onCampaign}>Campaign</Button>}
      </div>
    </Card>
  );
}

/* ───────────────────────── editor ───────────────────────── */

function SegmentEditor({ segment, onClose }: { segment: Segment | null; onClose: () => void }) {
  const access = useAccess();
  const contacts = useList("contacts", access.read("contacts"));
  const leads = useList("leads", access.read("leads"));
  const m = useMutation();
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [rules, setRules] = useState<Rule[]>(segment?.rules ?? []);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [touched, setTouched] = useState(false);
  useEffect(() => { setName(segment?.name ?? ""); setDescription(segment?.description ?? ""); setRules(segment?.rules ?? []); setTouched(false); }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useDebounced(cleanRules(rules), 350);
  const preview = useAudience({ rules: live }, channel);

  const suggestions = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 40);
    return {
      tag: uniq((contacts.data ?? []).flatMap((c) => c.tags)),
      city: uniq((contacts.data ?? []).map((c) => c.city)),
      destination: uniq((leads.data ?? []).map((l) => l.destination)),
    } as Partial<Record<RuleField, string[]>>;
  }, [contacts.data, leads.data]);

  const badRules = rules.map(ruleError);
  const nameErr = !name.trim() ? "Give this audience a name" : m.fieldErrors["name"];
  const valid = !nameErr && badRules.every((e) => !e);
  const setRule = (i: number, patch: Partial<Rule>) => setRules((rs) => rs.map((r, j) => {
    if (j !== i) return r;
    const n = { ...r, ...patch };
    if (patch.field && patch.field !== r.field) {
      const meta = RULE_FIELDS[patch.field];
      n.op = meta.ops[0]!.op;
      n.value = patch.field === "temperature" ? "hot" : "";
    }
    return n;
  }));
  const addRule = (r: Rule = { field: "trips", op: "gte", value: "1" }) => setRules((rs) => [...rs, r]);

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    const body = { name: name.trim(), description: description.trim(), rules: cleanRules(rules) };
    const r = await m.run(() => (segment ? api.update("segments", segment.id, body) : api.create("segments", body)), segment ? "Audience updated" : "Audience saved");
    if (r) onClose();
  };

  return (
    <Modal open onClose={onClose} size="xl" title={segment ? `Edit ${segment.name}` : "New audience"} description="Add rules to narrow down who's in it. Everyone matches when there are no rules."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.busy} onClick={() => void save()}>{segment ? "Save changes" : "Save audience"}</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required error={touched ? nameErr : undefined}>
              <Input autoFocus value={name} maxLength={120} invalid={touched && Boolean(nameErr)} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mumbai families" />
            </Field>
            <Field label="Description" hint="Optional — helps your team pick the right one">
              <Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this for?" />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-700">Rules <span className="font-normal text-ink-500">· a contact must match all of them</span></span>
              {rules.length > 0 && <button type="button" className="text-[13px] font-medium text-ink-500 hover:text-rose-700" onClick={() => setRules([])}>Clear all</button>}
            </div>
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-strong bg-slate-50/60 p-4 text-center">
                <p className="text-sm font-medium text-ink-800">Everyone</p>
                <p className="mt-0.5 text-[13px] text-ink-500">No rules yet, so all your contacts are in this audience.</p>
              </div>
            ) : (
              <ol className="space-y-2">
                {rules.map((r, i) => (
                  <li key={i}>
                    {i > 0 && <div className="py-1 pl-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">and</div>}
                    <RuleRow rule={r} index={i} error={touched ? badRules[i] ?? null : null} suggestions={suggestions[r.field] ?? []}
                      onChange={(p) => setRule(i, p)} onRemove={() => setRules((rs) => rs.filter((_, j) => j !== i))} />
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => addRule()}>Add rule</Button>
              <span className="text-xs text-ink-500">or quick add:</span>
              {QUICK.map((qk) => <button key={qk.label} type="button" onClick={() => addRule({ ...qk.rule })} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-100 hover:bg-violet-100">+ {qk.label}</button>)}
            </div>
          </div>

          <div className="rounded-xl bg-violet-50/60 px-3.5 py-3 text-sm leading-6 text-violet-950">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-violet-700">In plain words</span>
            <p>{rulesSentence(rules)}.</p>
          </div>
        </div>

        <aside className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start" aria-label="Live match">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400">Live match</span>
            <Segmented size="sm" label="Reach on channel" value={channel} onChange={setChannel} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} />
          </div>
          <AudienceSummary q={preview} channel={channel} />
        </aside>
      </div>
    </Modal>
  );
}

function RuleRow({ rule, index, error, suggestions, onChange, onRemove }: { rule: Rule; index: number; error: string | null; suggestions: string[]; onChange: (p: Partial<Rule>) => void; onRemove: () => void }) {
  const meta = RULE_FIELDS[rule.field];
  const listId = `rule-sugg-${index}`;
  const n = index + 1;
  return (
    <div className={cx("rounded-xl border bg-white p-2.5", error ? "border-rose-300" : "border-line")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[170px_120px_minmax(0,1fr)_auto]">
        <Select aria-label={`Rule ${n} field`} value={rule.field} onChange={(e) => onChange({ field: e.target.value as RuleField })}>
          {FIELD_ORDER.map((f) => <option key={f} value={f}>{RULE_FIELDS[f].label}</option>)}
        </Select>
        <div className="sm:hidden"><IconButton label={`Remove rule ${n}`} onClick={onRemove}><X className="size-4" /></IconButton></div>
        {meta.ops.length > 1 ? (
          <Select aria-label={`Rule ${n} condition`} value={rule.op} onChange={(e) => onChange({ op: e.target.value as Rule["op"] })}>
            {meta.ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
          </Select>
        ) : <span className="flex h-10 items-center px-1 text-sm text-ink-600">{meta.ops[0]!.label}</span>}
        {meta.input === "temperature" ? (
          <Select aria-label={`Rule ${n} value`} value={rule.value} onChange={(e) => onChange({ value: e.target.value })} className="col-span-2 sm:col-span-1">
            <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
          </Select>
        ) : (
          <div className="relative col-span-2 sm:col-span-1">
            {meta.input === "money" && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-400">₹</span>}
            <Input aria-label={`Rule ${n} value`} value={rule.value} invalid={Boolean(error)} placeholder={meta.placeholder} list={suggestions.length ? listId : undefined}
              inputMode={meta.input === "text" ? undefined : "numeric"} className={meta.input === "money" ? "pl-7" : undefined}
              onChange={(e) => onChange({ value: meta.input === "text" ? e.target.value : e.target.value.replace(/[^\d]/g, "") })} />
            {suggestions.length > 0 && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
          </div>
        )}
        <div className="hidden sm:block"><IconButton label={`Remove rule ${n}`} onClick={onRemove}><Trash2 className="size-4" /></IconButton></div>
      </div>
      {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
