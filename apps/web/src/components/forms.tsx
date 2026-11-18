import { useMemo, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { type Collection } from "@voyadesk/core";
import { useList } from "../lib/hooks";
import { Button, Field, Input, MoneyInput, Select, Textarea, Toggle, cx } from "./ui";

export type FieldType =
  | "text" | "email" | "phone" | "textarea" | "number" | "money" | "percent" | "date" | "select" | "toggle"
  | "tags" | "lines" | "ref" | "multiref" | "color" | "rates" | "checklist" | "days";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  ref?: Collection;
  refLabel?: (row: Record<string, unknown>) => string;
  refFilter?: (row: Record<string, unknown>) => boolean;
  required?: boolean;
  hint?: ReactNode;
  span?: 1 | 2;
  placeholder?: string;
  nullable?: boolean;
  /** Pick the input type from the other values (e.g. coupon value is % or ₹ depending on its kind). */
  typeFrom?: (values: Record<string, unknown>) => FieldType;
}

type Values = Record<string, unknown>;

function RefSelect({ def, value, onChange, invalid }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; invalid: boolean }) {
  const q = useList(def.ref!);
  const rows = (q.data ?? []) as unknown as Record<string, unknown>[];
  const opts = rows.filter((r) => (def.refFilter ? def.refFilter(r) : true));
  return (
    <Select invalid={invalid} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{def.nullable === false ? "Select…" : "— None —"}</option>
      {opts.map((r) => <option key={String(r["id"])} value={String(r["id"])}>{def.refLabel ? def.refLabel(r) : String(r["name"] ?? r["id"])}</option>)}
    </Select>
  );
}

function MultiRef({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const q = useList(def.ref!);
  const rows = ((q.data ?? []) as unknown as Record<string, unknown>[]).filter((r) => (def.refFilter ? def.refFilter(r) : true));
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  return (
    <div className="grid gap-1.5 rounded-lg border border-line p-2 sm:grid-cols-2">
      {rows.map((r) => {
        const id = String(r["id"]);
        return (
          <label key={id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" className="size-4 accent-brand-600" checked={selected.has(id)} onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(id); else next.delete(id);
              onChange([...next]);
            }} />
            {def.refLabel ? def.refLabel(r) : String(r["name"] ?? id)}
          </label>
        );
      })}
      {rows.length === 0 && <span className="text-sm text-ink-500">Nothing to choose yet.</span>}
    </div>
  );
}

interface Rate { roomType: string; mealPlan: string; season: string; netPerNight: number; currency: string }

function RatesEditor({ value, onChange }: { value: Rate[]; onChange: (v: Rate[]) => void }) {
  const set = (i: number, patch: Partial<Rate>) => onChange(value.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1.4fr_.8fr_.9fr_1fr_.7fr_auto]">
          <Input aria-label="Room type" placeholder="Room type" value={r.roomType} onChange={(e) => set(i, { roomType: e.target.value })} />
          <Select aria-label="Meal plan" value={r.mealPlan} onChange={(e) => set(i, { mealPlan: e.target.value })}>{["EP", "CP", "MAP", "AP", "AI"].map((m) => <option key={m}>{m}</option>)}</Select>
          <Select aria-label="Season" value={r.season} onChange={(e) => set(i, { season: e.target.value })}><option value="regular">Regular</option><option value="peak">Peak</option></Select>
          <MoneyInput aria-label="Net per night" value={r.netPerNight} currency={r.currency} onChange={(v) => set(i, { netPerNight: v ?? 0 })} />
          <Select aria-label="Currency" value={r.currency} onChange={(e) => set(i, { currency: e.target.value })}>{["INR", "USD", "AED", "EUR", "THB", "SGD", "GBP"].map((c) => <option key={c}>{c}</option>)}</Select>
          <Button variant="ghost" size="sm" aria-label="Remove rate" onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { roomType: "", mealPlan: "CP", season: "regular", netPerNight: 0, currency: "INR" }])}>Add rate</Button>
    </div>
  );
}

interface DayPlan { title: string; description: string; photoId: string | null }

export function DaysEditor({ value, onChange, renderExtra }: { value: DayPlan[]; onChange: (v: DayPlan[]) => void; renderExtra?: (index: number) => ReactNode }) {
  const set = (i: number, patch: Partial<DayPlan>) => onChange(value.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-2">
      {value.map((d, i) => (
        <div key={i} className="rounded-lg border border-line p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="shrink-0 rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">Day {i + 1}</span>
            <Input aria-label={`Day ${i + 1} title`} value={d.title} placeholder="Title" onChange={(e) => set(i, { title: e.target.value })} />
            <Button variant="ghost" size="sm" aria-label="Remove day" onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button>
          </div>
          <Textarea aria-label={`Day ${i + 1} plan`} value={d.description} placeholder="What happens this day" className="min-h-[60px]" onChange={(e) => set(i, { description: e.target.value })} />
          {renderExtra && <div className="mt-1.5">{renderExtra(i)}</div>}
        </div>
      ))}
      <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { title: "", description: "", photoId: null }])}>Add day</Button>
    </div>
  );
}

export function FieldInput({ def, value, onChange, error }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: string | undefined }) {
  const invalid = Boolean(error);
  switch (def.type) {
    case "textarea":
      return <Textarea invalid={invalid} value={(value as string) ?? ""} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <Input invalid={invalid} type="number" inputMode="numeric" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? (def.nullable ? null : 0) : Number(e.target.value))} />;
    case "money":
      return <MoneyInput invalid={invalid} value={value as number | null} onChange={(v) => onChange(v === null ? (def.nullable ? null : 0) : v)} />;
    case "percent":
      return (
        <div className="relative">
          <Input invalid={invalid} type="number" step="0.1" inputMode="decimal" value={value === null || value === undefined ? "" : String(Number(value) / 100)} onChange={(e) => onChange(e.target.value === "" ? (def.nullable ? null : 0) : Math.round(Number(e.target.value) * 100))} className="pr-8" />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-400">%</span>
        </div>
      );
    case "date":
      return <Input invalid={invalid} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "select":
      return (
        <Select invalid={invalid} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    case "toggle":
      return <div className="pt-1.5"><Toggle checked={Boolean(value)} onChange={onChange} label={value ? "Yes" : "No"} /></div>;
    case "tags":
      return <Input invalid={invalid} value={Array.isArray(value) ? (value as string[]).join(", ") : ""} placeholder={def.placeholder ?? "comma, separated"} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />;
    case "lines":
    case "checklist":
      return <Textarea invalid={invalid} value={Array.isArray(value) ? (value as string[]).join("\n") : ""} placeholder={def.placeholder ?? "One per line"} onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trimStart()).filter((s, i, a) => s !== "" || i === a.length - 1))} />;
    case "ref":
      return <RefSelect def={def} value={value} onChange={onChange} invalid={invalid} />;
    case "multiref":
      return <MultiRef def={def} value={value} onChange={onChange} />;
    case "color":
      return <div className="flex items-center gap-2"><input type="color" aria-label={def.label} value={(value as string) ?? "#1d5fd1"} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 rounded border border-line" /><Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} /></div>;
    case "rates":
      return <RatesEditor value={(value as Rate[]) ?? []} onChange={onChange} />;
    case "days":
      return <DaysEditor value={(value as DayPlan[]) ?? []} onChange={onChange} />;
    default:
      return <Input invalid={invalid} type={def.type === "email" ? "email" : def.type === "phone" ? "tel" : "text"} value={(value as string) ?? ""} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Clean list values before saving (drop blank lines). */
export function cleanValues(fields: FieldDef[], v: Values): Values {
  const out: Values = { ...v };
  for (const f of fields) {
    if ((f.type === "lines" || f.type === "checklist") && Array.isArray(out[f.name])) out[f.name] = (out[f.name] as string[]).map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

export function EntityForm({ fields, values, onChange, errors }: { fields: FieldDef[]; values: Values; onChange: (v: Values) => void; errors: Record<string, string> }) {
  const errFor = useMemo(() => (name: string) => errors[name] ?? Object.entries(errors).find(([k]) => k.startsWith(`${name}.`))?.[1], [errors]);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((raw) => {
        const f = raw.typeFrom ? { ...raw, type: raw.typeFrom(values) } : raw;
        return (
        <Field key={f.name} label={f.label} error={errFor(f.name)} hint={f.hint} required={f.required}
          className={cx((f.span === 2 || ["textarea", "lines", "checklist", "rates", "days", "multiref"].includes(f.type)) && "sm:col-span-2")}>
          <FieldInput def={f} value={values[f.name]} error={errFor(f.name)} onChange={(v) => onChange({ ...values, [f.name]: v })} />
        </Field>
        );
      })}
    </div>
  );
}
