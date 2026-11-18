import type { Segment } from "@voyadesk/core";

export type Rule = Segment["rules"][number];
export type RuleField = Rule["field"];
export type RuleOp = Rule["op"];

export interface FieldMeta {
  label: string;
  ops: { op: RuleOp; label: string }[];
  input: "text" | "number" | "money" | "temperature";
  placeholder: string;
  hint?: string;
}

export const RULE_FIELDS: Record<RuleField, FieldMeta> = {
  tag: { label: "Tag", ops: [{ op: "eq", label: "is" }], input: "text", placeholder: "vip" },
  city: { label: "City", ops: [{ op: "eq", label: "is" }, { op: "contains", label: "contains" }], input: "text", placeholder: "Mumbai" },
  trips: { label: "Trips taken", ops: [{ op: "gte", label: "at least" }, { op: "lte", label: "at most" }, { op: "eq", label: "exactly" }], input: "number", placeholder: "1" },
  totalSpend: { label: "Total spend", ops: [{ op: "gte", label: "at least" }, { op: "lte", label: "at most" }], input: "money", placeholder: "50000", hint: "in ₹" },
  destination: { label: "Enquired about", ops: [{ op: "contains", label: "contains" }], input: "text", placeholder: "Dubai" },
  temperature: { label: "Lead temperature", ops: [{ op: "eq", label: "is" }], input: "temperature", placeholder: "hot" },
};

export const FIELD_ORDER: RuleField[] = ["trips", "totalSpend", "destination", "city", "tag", "temperature"];

const inr = (v: string) => `₹${Number(v || 0).toLocaleString("en-IN")}`;

/** One rule in plain English, e.g. "have taken at least 2 trips". */
export function ruleText(r: Rule): string {
  const v = r.value.trim();
  switch (r.field) {
    case "tag": return `are tagged “${v}”`;
    case "city": return r.op === "contains" ? `live in a city containing “${v}”` : `live in ${v}`;
    case "trips": {
      const n = Number(v);
      const w = n === 1 ? "trip" : "trips";
      return r.op === "gte" ? `have taken at least ${n} ${w}` : r.op === "lte" ? `have taken at most ${n} ${w}` : `have taken exactly ${n} ${w}`;
    }
    case "totalSpend": return r.op === "lte" ? `have spent at most ${inr(v)}` : r.op === "eq" ? `have spent exactly ${inr(v)}` : `have spent at least ${inr(v)}`;
    case "destination": return `asked about ${v ? v.replace(/\b\w/g, (c) => c.toUpperCase()) : "…"}`;
    case "temperature": return `have a ${v} lead`;
  }
}

export function rulesSentence(rules: Rule[]): string {
  const valid = rules.filter((r) => r.value.trim());
  if (valid.length === 0) return "Everyone in your contacts";
  const parts = valid.map(ruleText);
  const last = parts.pop()!;
  return `Customers who ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
}

export function ruleError(r: Rule): string | null {
  if (!r.value.trim()) return "Enter a value";
  const m = RULE_FIELDS[r.field];
  if ((m.input === "number" || m.input === "money") && (!/^\d+(\.\d+)?$/.test(r.value.trim()))) return "Enter a number";
  return null;
}

export const cleanRules = (rules: Rule[]) => rules.filter((r) => !ruleError(r)).map((r) => ({ ...r, value: r.value.trim() }));
