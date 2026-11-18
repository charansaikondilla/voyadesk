/**
 * Contract between the growth engine (automations + marketing funnel, in ./growth.ts) and the web app.
 * Money is always in paise; rates in basis points (10000 = 100%) unless named *Pct.
 */
import type { Automation, AutomationTrigger, Entity } from "../entities.js";
import type { LeadSource } from "../rules.js";

/* ───────────────────────── marketing funnel report: runReport("marketingFunnel", { days }) ───────────────────────── */

export interface FunnelStage {
  key: "leads" | "contacted" | "quoted" | "won";
  label: string;
  count: number;
  /** Sum of lead budgets (leads/contacted/quoted) or booking sell totals (won). */
  value: number;
}

export interface ChannelRow {
  source: LeadSource;
  label: string;
  leads: number;
  contacted: number;
  quoted: number;
  won: number;
  lost: number;
  /** Booked revenue (sell total of non-cancelled bookings won from these leads). */
  revenue: number;
  /** Ad / channel spend recorded in channelSpend for months inside the range. */
  spend: number;
  /** Cost per lead; null when no spend recorded or no leads. */
  cpl: number | null;
  /** Cost per won booking; null when no spend or no wins. */
  cac: number | null;
  /** (revenue - spend) / spend * 100, rounded; null when no spend. */
  roiPct: number | null;
  /** won / leads in bps. */
  conversionBps: number;
  /** Median minutes from lead creation to first outbound touch; null when unknown. */
  responseMins: number | null;
  /** Leads in this channel in the previous period of the same length (for trend arrows). */
  prevLeads: number;
}

export interface MarketingFunnel {
  range: { from: string; to: string; days: number };
  totals: {
    leads: number; prevLeads: number; won: number; prevWon: number; revenue: number; prevRevenue: number; spend: number;
    cpl: number | null; cac: number | null; roiPct: number | null; conversionBps: number;
    avgDealSize: number | null; avgDaysToWin: number | null;
    /** Open pipeline: sum of budgets of leads not won/lost. */
    pipelineValue: number;
  };
  stages: FunnelStage[];
  channels: ChannelRow[];
  /** One row per week (Monday ISO date), oldest first, covering the range. */
  weekly: { week: string; leads: number; won: number; revenue: number }[];
  campaigns: {
    id: string; name: string; channel: "whatsapp" | "email" | "sms"; status: "draft" | "scheduled" | "sent";
    sent: number; delivered: number; read: number; leads: number; bookings: number; revenue: number; cost: number; roiPct: number | null;
    scheduledAt: string | null;
  }[];
  landingPages: { id: string; title: string; slug: string; published: boolean; leads: number; won: number; revenue: number }[];
  /** Why leads were lost (lostReason, normalised), most common first. */
  lostReasons: { reason: string; count: number }[];
  automation: { active: number; total: number; runs30d: number; messages30d: number; failed30d: number };
  bestSendHour: { hour: number; sample: number };
  /** Plain-English, actionable observations, most important first (max 5). */
  insights: { tone: "good" | "warn" | "info"; text: string; to?: string }[];
}

/* ───────────────────────── audience preview: runReport("audiencePreview", { segmentId?, rules?, channel }) ───────────────────────── */

export interface AudiencePreview {
  /** Contacts matching the segment rules. */
  count: number;
  /** Of those, how many can be reached on the chosen channel (have a phone for whatsapp/sms, an email for email). */
  reachable: number;
  sample: { id: string; name: string; city: string; phone: string; email: string; trips: number; totalSpend: number }[];
  /** Estimated cost in paise for the chosen channel (WhatsApp marketing rate × reachable; 0 for email). */
  estCost: number;
}

/* ───────────────────────── automations ───────────────────────── */

/** A ready-made recipe shown in the gallery. `automation` is exactly what installAutomation saves. */
export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  category: "sales" | "payments" | "marketing" | "operations" | "visa";
  /** Problem this solves, written from the employee's point of view. */
  why: string;
  automation: Pick<Automation, "name" | "description" | "trigger" | "days" | "conditions" | "steps">;
}

/** Result of testAutomation: who would be affected right now, without changing anything. */
export interface AutomationTestResult {
  trigger: AutomationTrigger;
  /** Subjects that match the trigger + conditions (time triggers: due now; event triggers: the last 30 days of events). */
  matches: { subjectType: Entity<"automationRuns">["subjectType"]; subjectId: string; name: string; reason: string; alreadyRan: boolean }[];
  /** Each step rendered for the first match (message text with placeholders filled), for the preview. */
  preview: { kind: Automation["steps"][number]["kind"]; summary: string }[];
  /** Human warnings, e.g. "3 matches have no phone number — WhatsApp will be skipped". */
  warnings: string[];
}
