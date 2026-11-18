import type { ReactNode } from "react";
import {
  AlarmClock, ArrowRightLeft, Bell, BriefcaseBusiness, CheckCheck, CreditCard, FileClock, FileText, Flame, Hourglass, ListTodo, MessageCircle,
  PlaneLanding, PlaneTakeoff, Stamp, Tag, UserPlus, UserRoundCheck, Wallet, Workflow,
} from "lucide-react";
import {
  AUTOMATION_TIME_TRIGGERS, BOOKING_STATUSES, INVOICE_STATUSES, LEAD_SOURCES, LEAD_STAGES, QUOTE_STATUSES, VISA_STATUSES,
  type Automation, type AutomationField, type AutomationRun, type AutomationStepKind, type AutomationTemplate, type AutomationTrigger, type User,
} from "@voyadesk/core";
import { money, SOURCE_LABEL, titleCase } from "../../lib/format";
import type { Tone } from "../ui";

/* ───────────────────────── types ───────────────────────── */

export type Condition = Automation["conditions"][number];
export type Step = Automation["steps"][number];
export type Op = Condition["op"];
export type Category = AutomationTemplate["category"];
export type SubjectType = AutomationRun["subjectType"];
export type RunStatus = AutomationRun["status"];

/** A step while it's being edited: `_k` is a stable React key so reordering never confuses inputs. */
export type DraftStep = Step & { _k: string };

export interface Draft {
  id?: string;
  name: string;
  description: string;
  trigger: AutomationTrigger | null;
  days: number;
  conditions: (Condition & { _k: string })[];
  steps: DraftStep[];
  active: boolean;
}

let keySeq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export const MAX_STEPS = 10;

/* ───────────────────────── categories ───────────────────────── */

export const CATEGORY: Record<Category, { label: string; tone: Tone; blurb: string }> = {
  sales: { label: "Sales", tone: "blue", blurb: "Reply fast, follow up, never lose a lead" },
  payments: { label: "Payments", tone: "green", blurb: "Collect balances without awkward calls" },
  marketing: { label: "Marketing", tone: "violet", blurb: "Reviews, referrals and repeat trips" },
  operations: { label: "Operations", tone: "cyan", blurb: "Smooth trips, no last-minute surprises" },
  visa: { label: "Visa", tone: "amber", blurb: "Chase documents and keep travellers posted" },
};
export const CATEGORIES = Object.keys(CATEGORY) as Category[];

/* ───────────────────────── triggers ───────────────────────── */

export interface TriggerMeta {
  /** Card title in the picker. */
  label: string;
  /** Helper line under the title. */
  hint: string;
  /** Short name used in auto-suggested names. */
  short: string;
  icon: ReactNode;
  category: Category;
  subject: SubjectType;
  /** Plural noun for "Runs for every …". */
  noun: string;
  time: boolean;
  /** Time triggers: the sentence around the days input. */
  before?: string;
  after?: string;
  defaultDays?: number;
  minDays?: number;
}

const I = "size-[18px]";
export const TRIGGERS: Record<AutomationTrigger, TriggerMeta> = {
  lead_created: { label: "A new enquiry comes in", hint: "From any source — WhatsApp, ads, website, walk-in", short: "New lead", icon: <UserPlus className={I} />, category: "sales", subject: "lead", noun: "new lead", time: false },
  lead_stage_changed: { label: "A lead moves to a new stage", hint: "e.g. marked Won, Lost or Negotiation", short: "Lead stage change", icon: <ArrowRightLeft className={I} />, category: "sales", subject: "lead", noun: "stage change", time: false },
  quote_sent: { label: "A quote is sent", hint: "Right after you share a quote with the customer", short: "Quote sent", icon: <FileText className={I} />, category: "sales", subject: "quote", noun: "quote sent", time: false },
  quote_accepted: { label: "A customer accepts a quote", hint: "They said yes — strike while it's hot", short: "Quote accepted", icon: <CheckCheck className={I} />, category: "payments", subject: "quote", noun: "accepted quote", time: false },
  booking_confirmed: { label: "A booking is confirmed", hint: "When a trip is locked in", short: "Booking confirmed", icon: <BriefcaseBusiness className={I} />, category: "operations", subject: "booking", noun: "confirmed booking", time: false },
  payment_received: { label: "A payment comes in", hint: "Any amount against an invoice", short: "Payment received", icon: <Wallet className={I} />, category: "payments", subject: "invoice", noun: "payment", time: false },
  visa_status_changed: { label: "A visa application moves forward", hint: "Docs pending, submitted, approved…", short: "Visa update", icon: <Stamp className={I} />, category: "visa", subject: "visaCase", noun: "visa update", time: false },
  lead_idle: { label: "A lead goes quiet", hint: "No reply or activity for a while", short: "Quiet lead", icon: <Hourglass className={I} />, category: "sales", subject: "lead", noun: "quiet lead", time: true, before: "A lead has had no reply for", after: "days", defaultDays: 3, minDays: 1 },
  quote_idle: { label: "A quote gets no answer", hint: "Sent, but the customer hasn't decided", short: "Unanswered quote", icon: <FileClock className={I} />, category: "sales", subject: "quote", noun: "unanswered quote", time: true, before: "A quote has had no answer for", after: "days", defaultDays: 3, minDays: 1 },
  invoice_overdue: { label: "A payment is overdue", hint: "The balance is past its due date", short: "Overdue balance", icon: <AlarmClock className={I} />, category: "payments", subject: "invoice", noun: "overdue invoice", time: true, before: "An invoice is", after: "days past its due date", defaultDays: 1, minDays: 0 },
  trip_upcoming: { label: "A trip is coming up", hint: "Reminders, documents, final balance", short: "Trip coming up", icon: <PlaneTakeoff className={I} />, category: "operations", subject: "booking", noun: "upcoming trip", time: true, before: "", after: "days before the customer travels", defaultDays: 7, minDays: 0 },
  trip_completed: { label: "A trip has ended", hint: "Ask for a review or plan the next one", short: "Trip ended", icon: <PlaneLanding className={I} />, category: "marketing", subject: "booking", noun: "finished trip", time: true, before: "", after: "days after the customer is back", defaultDays: 2, minDays: 0 },
};

export const isTimeTrigger = (t: AutomationTrigger | null | undefined): boolean => Boolean(t && (AUTOMATION_TIME_TRIGGERS as readonly string[]).includes(t));
export const EVENT_TRIGGERS = (Object.keys(TRIGGERS) as AutomationTrigger[]).filter((t) => !isTimeTrigger(t));
export const TIME_TRIGGERS = (Object.keys(TRIGGERS) as AutomationTrigger[]).filter((t) => isTimeTrigger(t));

/** "When a new enquiry comes in", "When a lead has had no reply for 3 days", "7 days before the customer travels". */
export function triggerSentence(t: AutomationTrigger, days: number): string {
  const m = TRIGGERS[t];
  if (!m.time) return `When ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}`;
  const d = `${days} day${days === 1 ? "" : "s"}`;
  switch (t) {
    case "lead_idle": return days ? `When a lead has had no reply for ${d}` : "When a lead goes quiet";
    case "quote_idle": return days ? `When a quote has had no answer for ${d}` : "When a quote gets no answer";
    case "invoice_overdue": return days ? `When a payment is ${d} overdue` : "When a payment falls due";
    case "trip_upcoming": return days ? `${d} before a trip starts` : "On the day a trip starts";
    case "trip_completed": return days ? `${d} after a trip ends` : "The day a trip ends";
    default: return m.label;
  }
}

/* ───────────────────────── conditions ───────────────────────── */

export type FieldKind = "select" | "text" | "money" | "number";
export interface FieldMeta { label: string; kind: FieldKind; ops: Op[]; hint?: string }

export const FIELDS: Record<AutomationField, FieldMeta> = {
  source: { label: "Lead source", kind: "select", ops: ["eq", "neq"] },
  destination: { label: "Destination", kind: "text", ops: ["contains", "eq", "neq"] },
  service: { label: "Looking for", kind: "select", ops: ["eq", "neq"] },
  stage: { label: "Lead stage", kind: "select", ops: ["eq", "neq"] },
  temperature: { label: "Lead temperature", kind: "select", ops: ["eq", "neq"] },
  score: { label: "Lead score", kind: "number", ops: ["gte", "lte", "eq"], hint: "0–100" },
  budget: { label: "Budget", kind: "money", ops: ["gte", "lte"] },
  amount: { label: "Amount", kind: "money", ops: ["gte", "lte"] },
  ownerId: { label: "Owner", kind: "select", ops: ["eq", "neq"] },
  pax: { label: "Travellers", kind: "number", ops: ["gte", "lte", "eq"] },
  status: { label: "Status", kind: "select", ops: ["eq", "neq"] },
  country: { label: "Visa country", kind: "text", ops: ["contains", "eq", "neq"] },
};

export const OP_LABEL: Record<Op, string> = { eq: "is", neq: "is not", gte: "is at least", lte: "is at most", contains: "contains" };

const LEAD_FIELDS: AutomationField[] = ["source", "destination", "service", "stage", "temperature", "score", "budget", "pax", "ownerId"];

/** Which conditions make sense for each trigger (all resolve from the subject and its linked lead). */
export function fieldsFor(t: AutomationTrigger | null): AutomationField[] {
  if (!t) return [];
  const s = TRIGGERS[t].subject;
  if (s === "lead") return LEAD_FIELDS;
  if (s === "visaCase") return ["country", "status", "source", "ownerId"];
  return ["amount", "status", ...LEAD_FIELDS];
}

export const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", quoted: "Quoted", negotiation: "Negotiation", won: "Won", lost: "Lost" };
export const TEMP_LABEL: Record<string, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const SERVICE_LABEL: Record<string, string> = { holiday: "Holiday package", visa: "Visa", flight: "Flights", hotel: "Hotel only", transfer: "Transfers" };
const STATUS_SETS: Record<SubjectType, readonly string[]> = {
  lead: LEAD_STAGES, quote: QUOTE_STATUSES, booking: BOOKING_STATUSES, invoice: INVOICE_STATUSES, visaCase: VISA_STATUSES,
};
const VISA_LABEL: Record<string, string> = { docs_pending: "Documents pending", docs_received: "Documents received", in_process: "In process" };

export function selectOptions(field: AutomationField, t: AutomationTrigger | null, users: User[]): { value: string; label: string }[] {
  switch (field) {
    case "source": return LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] ?? titleCase(s) }));
    case "service": return Object.entries(SERVICE_LABEL).map(([value, label]) => ({ value, label }));
    case "stage": return LEAD_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] ?? titleCase(s) }));
    case "temperature": return Object.entries(TEMP_LABEL).map(([value, label]) => ({ value, label }));
    case "ownerId": return users.map((u) => ({ value: u.id, label: u.name }));
    case "status": return (STATUS_SETS[t ? TRIGGERS[t].subject : "lead"] ?? []).map((s) => ({ value: s, label: VISA_LABEL[s] ?? titleCase(s) }));
    default: return [];
  }
}

export function defaultCondition(field: AutomationField, t: AutomationTrigger | null, users: User[]): Condition {
  const m = FIELDS[field];
  const first = m.kind === "select" ? selectOptions(field, t, users)[0]?.value ?? "" : "";
  const value = field === "source" ? "meta_ads" : field === "temperature" ? "hot" : field === "stage" ? "won" : field === "budget" || field === "amount" ? "10000000" : field === "score" ? "60" : field === "pax" ? "4" : first;
  return { field, op: m.ops[0]!, value };
}

/** Value shown to people: "Meta Ads", "₹1,00,000", "Priya". */
export function valueLabel(c: Condition, t: AutomationTrigger | null, users: User[]): string {
  const m = FIELDS[c.field];
  if (m.kind === "money") return c.value && !Number.isNaN(Number(c.value)) ? money(Number(c.value)) : "…";
  if (m.kind === "select") return selectOptions(c.field, t, users).find((o) => o.value === c.value)?.label ?? (c.field === "ownerId" ? "someone" : titleCase(c.value || "…"));
  return c.value || "…";
}

/** "from Meta Ads", "budget is at least ₹1,00,000", "going to Bali". */
export function conditionPhrase(c: Condition, t: AutomationTrigger | null, users: User[]): string {
  const v = valueLabel(c, t, users);
  if (c.field === "source") return c.op === "neq" ? `not from ${v}` : `from ${v}`;
  if (c.field === "destination" && (c.op === "contains" || c.op === "eq")) return `going to ${v}`;
  if (c.field === "country" && (c.op === "contains" || c.op === "eq")) return `for a ${v} visa`;
  if (c.field === "temperature" && c.op === "eq") return `${v.toLowerCase()} leads only`;
  if (c.field === "ownerId") return c.op === "neq" ? `not owned by ${v}` : `owned by ${v}`;
  if (c.field === "pax") return `${OP_LABEL[c.op]} ${v} travellers`.replace(/^is /, "");
  return `${FIELDS[c.field].label.toLowerCase()} ${OP_LABEL[c.op]} ${v}`;
}

/** Quick-add suggestions under the IF step. */
export function conditionSuggestions(t: AutomationTrigger | null): { label: string; c: Condition }[] {
  if (!t) return [];
  const s = TRIGGERS[t].subject;
  if (s === "lead") return [
    { label: "Only Meta Ads leads", c: { field: "source", op: "eq", value: "meta_ads" } },
    { label: "Only hot leads", c: { field: "temperature", op: "eq", value: "hot" } },
    { label: "Budget ₹1 lakh+", c: { field: "budget", op: "gte", value: "10000000" } },
    ...(t === "lead_stage_changed" ? [{ label: "Only when marked Won", c: { field: "stage", op: "eq", value: "won" } as Condition }] : []),
  ];
  if (s === "visaCase") return [
    { label: "Only Documents pending", c: { field: "status", op: "eq", value: "docs_pending" } },
    { label: "Only approved visas", c: { field: "status", op: "eq", value: "approved" } },
  ];
  return [
    { label: "Amount ₹50,000+", c: { field: "amount", op: "gte", value: "5000000" } },
    { label: "Only international", c: { field: "destination", op: "neq", value: "India" } },
  ];
}

/* ───────────────────────── steps (actions) ───────────────────────── */

export interface StepMeta { label: string; hint: string; icon: ReactNode; tone: Tone }
const S = "size-4";
export const STEPS: Record<AutomationStepKind, StepMeta> = {
  send_message: { label: "Send a message", hint: "WhatsApp, email or SMS to the customer", icon: <MessageCircle className={S} />, tone: "green" },
  send_payment_link: { label: "Send a payment link", hint: "UPI / card link for the balance due", icon: <CreditCard className={S} />, tone: "green" },
  create_task: { label: "Create a task", hint: "A to-do with a due date", icon: <ListTodo className={S} />, tone: "blue" },
  assign_owner: { label: "Assign to someone", hint: "Pick a person or share fairly", icon: <UserRoundCheck className={S} />, tone: "violet" },
  set_temperature: { label: "Mark hot, warm or cold", hint: "Change how urgent the lead is", icon: <Flame className={S} />, tone: "red" },
  set_stage: { label: "Move the lead", hint: "Change its stage in the pipeline", icon: <ArrowRightLeft className={S} />, tone: "cyan" },
  add_tag: { label: "Add a tag", hint: "Label it for lists and campaigns", icon: <Tag className={S} />, tone: "gray" },
  notify_owner: { label: "Alert the owner", hint: "A heads-up to the person in charge", icon: <Bell className={S} />, tone: "amber" },
};
export const STEP_ORDER: AutomationStepKind[] = ["send_message", "send_payment_link", "create_task", "assign_owner", "notify_owner", "set_temperature", "set_stage", "add_tag"];

export const PAYMENT_LINK_TRIGGERS: AutomationTrigger[] = ["invoice_overdue", "booking_confirmed", "trip_upcoming", "quote_accepted"];
export const paymentLinkAllowed = (t: AutomationTrigger | null) => Boolean(t && PAYMENT_LINK_TRIGGERS.includes(t));
/** Steps that change the lead record — they need a lead behind the subject. */
export const LEAD_ONLY_STEPS: AutomationStepKind[] = ["set_stage", "set_temperature"];

export const CHANNEL_LABEL: Record<Step["channel"], string> = { whatsapp: "WhatsApp", email: "Email", sms: "SMS" };

export function defaultMessage(kind: AutomationStepKind, t: AutomationTrigger | null): string {
  if (kind === "send_payment_link") {
    if (t === "invoice_overdue") return "Hi {name}, a gentle reminder that {amount} for your {destination} trip is now due. You can pay securely here: {link}\n\nThank you — {company}";
    if (t === "trip_upcoming") return "Hi {name}, your {destination} trip is almost here! The balance of {amount} is due before travel. Pay in one tap: {link}";
    return "Hi {name}, thank you for choosing {company}! To lock in your {destination} trip, please pay {amount} here: {link}";
  }
  if (kind === "notify_owner") {
    if (t === "lead_idle") return "{name} hasn't heard from us in a while. Please call today.";
    if (t === "invoice_overdue") return "{name}'s payment of {amount} is overdue. Please follow up.";
    return "Heads-up: {name} needs your attention.";
  }
  switch (t) {
    case "lead_created": return "Hi {name}, thanks for contacting {company}! I'm {owner} and I'll plan your {destination} trip. When are you thinking of travelling, and how many people?";
    case "lead_idle": return "Hi {name}, just checking in on your {destination} plans. Shall I share a few options this week? — {owner}, {company}";
    case "quote_sent": return "Hi {name}, your {destination} quote is ready: {link}\nHappy to tweak anything — just reply here.";
    case "quote_idle": return "Hi {name}, did you get a chance to look at the {destination} quote? Prices can change, so let me know if you'd like me to hold it.";
    case "quote_accepted": return "Wonderful, {name}! Your {destination} trip is on. I'll send the next steps shortly. — {owner}";
    case "booking_confirmed": return "Hi {name}, your {destination} trip is confirmed for {date}! We'll share vouchers and your itinerary soon.";
    case "payment_received": return "Hi {name}, we've received {amount}. Thank you! Your receipt is on its way. — {company}";
    case "visa_status_changed": return "Hi {name}, an update on your visa application — please check the latest from {company}.";
    case "invoice_overdue": return "Hi {name}, a friendly reminder that {amount} is now due for your {destination} trip.";
    case "trip_upcoming": return "Hi {name}, only a few days to go for {destination}! Keep your passport and tickets handy. Have a great trip!";
    case "trip_completed": return "Welcome back, {name}! We hope you loved {destination}. Could you spare a minute to leave us a review? It really helps a small business like ours.";
    default: return "Hi {name}, ";
  }
}

export function blankStep(kind: AutomationStepKind, t: AutomationTrigger | null): DraftStep {
  return {
    _k: newKey(), kind, channel: "whatsapp", message: kind === "send_message" || kind === "send_payment_link" || kind === "notify_owner" ? defaultMessage(kind, t) : "",
    title: kind === "create_task" ? (t === "lead_idle" ? "Call the customer — no reply yet" : t === "invoice_overdue" ? "Call about the overdue payment" : t === "trip_upcoming" ? "Check documents before travel" : "Follow up with the customer") : "",
    value: kind === "set_temperature" ? "hot" : kind === "set_stage" ? "contacted" : "", userId: null, dueInDays: kind === "create_task" ? 1 : 0,
  };
}

/** "send WhatsApp", "assign to Priya", "create task “Call back”". */
export function stepPhrase(s: Step, users: User[]): string {
  const who = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "a teammate" : null);
  switch (s.kind) {
    case "send_message": return `send ${CHANNEL_LABEL[s.channel]}`;
    case "send_payment_link": return `send payment link${s.channel !== "whatsapp" ? ` by ${CHANNEL_LABEL[s.channel].toLowerCase()}` : ""}`;
    case "create_task": return `create task${s.title ? ` “${s.title.length > 28 ? `${s.title.slice(0, 27)}…` : s.title}”` : ""}${who(s.userId) ? ` for ${who(s.userId)}` : ""}`;
    case "assign_owner": return who(s.userId) ? `assign to ${who(s.userId)}` : "share among sales team";
    case "set_temperature": return `mark ${(TEMP_LABEL[s.value] ?? s.value).toLowerCase() || "…"}`;
    case "set_stage": return `move to ${STAGE_LABEL[s.value] ?? (s.value || "…")}`;
    case "add_tag": return `tag “${s.title || "…"}”`;
    case "notify_owner": return "alert the owner";
  }
}

const STEP_SHORT: Record<AutomationStepKind, string> = {
  send_message: "message", send_payment_link: "payment link", create_task: "task", assign_owner: "assign", set_temperature: "mark", set_stage: "move", add_tag: "tag", notify_owner: "alert",
};

/** Auto-suggested name: "New lead from Meta Ads → WhatsApp + assign". */
export function suggestName(d: Pick<Draft, "trigger" | "days" | "conditions" | "steps">, users: User[]): string {
  if (!d.trigger) return "";
  const m = TRIGGERS[d.trigger];
  let head = m.short;
  if (m.time && d.days) head = d.trigger === "trip_upcoming" ? `${d.days} days before trip` : d.trigger === "trip_completed" ? `${d.days} days after trip` : `${m.short} (${d.days} d)`;
  const src = d.conditions.find((c) => c.field === "source" && c.op === "eq");
  if (src) head += ` from ${valueLabel(src, d.trigger, users)}`;
  const firstMsg = d.steps.find((s) => s.kind === "send_message");
  const parts = d.steps.slice(0, 2).map((s) => (s === firstMsg ? CHANNEL_LABEL[s.channel] : STEP_SHORT[s.kind]));
  const tail = parts.length ? ` → ${parts.join(" + ")}${d.steps.length > 2 ? " +" : ""}` : "";
  return `${head}${tail}`.slice(0, 80);
}

/* ───────────────────────── placeholders ───────────────────────── */

export const PLACEHOLDERS: { key: string; label: string; sample: (ctx: { company: string; owner: string }) => string }[] = [
  { key: "{name}", label: "Customer name", sample: () => "Rahul" },
  { key: "{destination}", label: "Destination", sample: () => "Bali" },
  { key: "{company}", label: "Your company", sample: (c) => c.company },
  { key: "{owner}", label: "Owner's name", sample: (c) => c.owner },
  { key: "{amount}", label: "Amount", sample: () => "₹48,500" },
  { key: "{date}", label: "Date", sample: () => new Date(Date.now() + 14 * 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) },
  { key: "{link}", label: "Link", sample: () => "https://pay.voyadesk.in/r/8KX2" },
];

/** Which placeholders mean something for this step + trigger. */
export function placeholdersFor(kind: AutomationStepKind, t: AutomationTrigger | null): string[] {
  const s = t ? TRIGGERS[t].subject : "lead";
  const keys = ["{name}", "{destination}", "{company}", "{owner}"];
  if (s !== "lead" || kind === "send_payment_link") keys.push("{amount}");
  if (s === "booking" || s === "visaCase" || s === "invoice") keys.push("{date}");
  if (kind === "send_payment_link" || t === "quote_sent" || t === "quote_idle") keys.push("{link}");
  return keys;
}

export function fillSample(text: string, ctx: { company: string; owner: string }): string {
  return PLACEHOLDERS.reduce((acc, p) => acc.split(p.key).join(p.sample(ctx)), text);
}

/* ───────────────────────── runs & subjects ───────────────────────── */

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone; dot: string }> = {
  done: { label: "Done", tone: "green", dot: "bg-emerald-500" },
  partial: { label: "Partly done", tone: "amber", dot: "bg-amber-500" },
  skipped: { label: "Skipped", tone: "gray", dot: "bg-slate-300" },
  failed: { label: "Failed", tone: "red", dot: "bg-rose-500" },
};

export const SUBJECT_LABEL: Record<SubjectType, string> = { lead: "Lead", quote: "Quote", booking: "Booking", invoice: "Invoice", visaCase: "Visa case" };

export function subjectPath(type: SubjectType, id: string): string {
  switch (type) {
    case "lead": return `/app/leads/${id}`;
    case "quote": return `/app/quotes/${id}`;
    case "booking": return `/app/bookings/${id}`;
    case "invoice": return `/app/finance/invoices/${id}`;
    case "visaCase": return `/app/visa/${id}`;
  }
}

export const MESSAGE_STEPS: AutomationStepKind[] = ["send_message", "send_payment_link"];
export const STAFF_ROLES = ["owner", "admin", "sales", "ops", "accounts", "visa", "marketing"];
export const staffOnly = (users: User[] | undefined) => (users ?? []).filter((u) => u.active && STAFF_ROLES.includes(u.role));

export const FallbackIcon = <Workflow className={I} />;

/* ───────────────────────── draft helpers ───────────────────────── */

type Source = Pick<Automation, "name" | "description" | "trigger" | "days" | "conditions" | "steps"> & Partial<Pick<Automation, "id" | "active">>;

export function draftFrom(a: Source | null, opts: { copy?: boolean } = {}): Draft {
  if (!a) return { name: "", description: "", trigger: null, days: 0, conditions: [], steps: [], active: true };
  return {
    ...(a.id && !opts.copy ? { id: a.id } : {}),
    name: opts.copy ? `${a.name} (copy)`.slice(0, 160) : a.name,
    description: a.description ?? "",
    trigger: a.trigger,
    days: a.days ?? 0,
    conditions: (a.conditions ?? []).map((c) => ({ ...c, _k: newKey() })),
    steps: (a.steps ?? []).map((s) => ({
      _k: newKey(), kind: s.kind, channel: s.channel ?? "whatsapp", message: s.message ?? "", title: s.title ?? "", value: s.value ?? "", userId: s.userId ?? null, dueInDays: s.dueInDays ?? 0,
    })),
    active: opts.copy ? false : a.active ?? true,
  };
}

/** Exactly the saveAutomation / testAutomation draft shape (no local keys). */
export function payloadOf(d: Draft) {
  return {
    ...(d.id ? { id: d.id } : {}),
    name: d.name.trim(),
    description: d.description.trim(),
    trigger: d.trigger,
    days: isTimeTrigger(d.trigger) ? d.days : 0,
    conditions: d.conditions.map(({ field, op, value }) => ({ field, op, value: value.trim() })),
    steps: d.steps.map(({ kind, channel, message, title, value, userId, dueInDays }) => ({ kind, channel, message, title, value, userId, dueInDays })),
    active: d.active,
  };
}

export type Issue = { where: "when" | "if" | "then" | "name"; index?: number; text: string };

/** Plain-English problems that would stop a save. The server checks again. */
export function draftIssues(d: Draft): Issue[] {
  const out: Issue[] = [];
  if (!d.trigger) out.push({ where: "when", text: "Choose what starts this automation" });
  const m = d.trigger ? TRIGGERS[d.trigger] : null;
  if (m?.time && (!Number.isInteger(d.days) || d.days < (m.minDays ?? 0) || d.days > 365)) out.push({ where: "when", text: `Enter a number of days between ${m.minDays ?? 0} and 365` });
  d.conditions.forEach((c, i) => {
    if (!c.value.trim()) out.push({ where: "if", index: i, text: `Condition ${i + 1} needs a value` });
    else if ((FIELDS[c.field].kind === "number" || FIELDS[c.field].kind === "money") && Number.isNaN(Number(c.value))) out.push({ where: "if", index: i, text: `Condition ${i + 1} needs a number` });
  });
  if (d.steps.length === 0) out.push({ where: "then", text: "Add at least one action" });
  if (d.steps.length > MAX_STEPS) out.push({ where: "then", text: `Keep it to ${MAX_STEPS} actions or fewer` });
  d.steps.forEach((s, i) => {
    const n = `Action ${i + 1}`;
    if ((s.kind === "send_message" || s.kind === "notify_owner") && !s.message.trim()) out.push({ where: "then", index: i, text: `${n}: write the message` });
    if (s.kind === "send_payment_link" && !paymentLinkAllowed(d.trigger)) out.push({ where: "then", index: i, text: `${n}: payment links only work when there's a balance to collect` });
    if (s.kind === "create_task" && !s.title.trim()) out.push({ where: "then", index: i, text: `${n}: give the task a title` });
    if (s.kind === "add_tag" && !s.title.trim()) out.push({ where: "then", index: i, text: `${n}: type the tag` });
    if ((s.kind === "set_stage" || s.kind === "set_temperature") && !s.value) out.push({ where: "then", index: i, text: `${n}: pick a value` });
  });
  if (!d.name.trim()) out.push({ where: "name", text: "Give it a name" });
  return out;
}

/** Make server field keys like "steps.0.message" readable. */
export function readableField(key: string): string {
  const m = /^(steps|conditions)\.(\d+)\.?(\w*)/.exec(key);
  if (m) return `${m[1] === "steps" ? "Action" : "Condition"} ${Number(m[2]) + 1}${m[3] ? ` · ${titleCase(m[3])}` : ""}`;
  return titleCase(key);
}
