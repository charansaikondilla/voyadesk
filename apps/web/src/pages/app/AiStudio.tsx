import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Wand2 } from "lucide-react";
import { formatDate, type Lead, type ParsedEnquiry, type Quote } from "@voyadesk/core";
import { useAction, useList } from "../../lib/hooks";
import { money, SOURCE_LABEL } from "../../lib/format";
import { Button, Callout, Card, CardTitle, Field, Input, Select, StatusBadge, Textarea } from "../../components/ui";

const EXAMPLES = ["5N Dubai, 4 pax, 27 Jan, budget 2.4L, hotel near Dubai Mall", "Honeymoon couple to Bali for 6 nights on 14th Feb, 5 star, ₹2,50,000", "family of 4 with 2 kids, 4 nights Goa, next month, budget 80k"];

export function AiMessageTab() {
  const nav = useNavigate();
  const leads = useList("leads");
  const { act, busy } = useAction();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("whatsapp");
  const [result, setResult] = useState<{ lead: Lead; quote: Quote; parsed: ParsedEnquiry | null; duplicate: boolean } | null>(null);
  const ranked = useMemo(() => (leads.data ?? []).filter((l) => !["won", "lost"].includes(l.stage)).sort((a, b) => b.score - a.score).slice(0, 12), [leads.data]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle title={<span className="inline-flex items-center gap-2"><Wand2 className="size-5 text-brand-600" />Quote from a message</span>} subtitle="Destination, nights, travellers, date, budget, hotel stars and theme are read automatically." />
          <Field label="Customer's message"><Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[0]} /></Field>
          <div className="mt-2 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => setText(e)}>{e.slice(0, 32)}…</button>)}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Source"><Select value={source} onChange={(e) => setSource(e.target.value)}>{["whatsapp", "email", "website", "meta_ads", "ivr", "walk_in"].map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
          </div>
          <Button className="mt-4 w-full" icon={<Sparkles className="size-4" />} busy={busy} disabled={text.trim().length < 5} onClick={async () => {
            const r = await act<{ lead: Lead; quote: Quote; parsed: ParsedEnquiry | null; duplicate: boolean }>("generateAiQuote", { text, name: name || undefined, phone: phone || undefined, source }, "Lead and draft quote created");
            if (r) setResult(r);
          }}>Create lead + draft quote</Button>
        </Card>
        <Card>
          <CardTitle title="Result" />
          {!result ? <p className="text-sm text-ink-500">Paste a message and press the button. The lead is assigned by your routing rules and gets a call-back task.</p> : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1.5">{(["destination", "nights", "travellers", "date", "budget"] as const).map((k) => <span key={k} className={`rounded-full px-2 py-0.5 text-xs ${result.parsed?.matched.includes(k) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-ink-500"}`}>{result.parsed?.matched.includes(k) ? "✓" : "–"} {k}</span>)}</div>
              <div className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between"><span className="font-medium">{result.lead.name}</span><StatusBadge status={result.lead.temperature} label={`${result.lead.temperature} · ${result.lead.score}`} /></div>
                <div className="mt-1 text-ink-600">{result.lead.destination || "—"} · {result.lead.nights ?? "?"}N · {result.lead.pax.adults} adults · {formatDate(result.lead.travelDate)} · budget {money(result.lead.budget)}</div>
                <ul className="mt-2 text-xs text-ink-500">{result.lead.scoreReasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
              <div className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between"><span className="font-medium">{result.quote.number}</span><span className="font-semibold">{money(result.quote.total)}</span></div>
                <div className="mt-1 text-ink-600">{result.quote.lines.length} services suggested · {result.quote.days.length} day plan</div>
              </div>
              {!result.quote.startDate && <Callout tone="warn">No travel date found — add it in the quote before sending.</Callout>}
              <div className="flex gap-2"><Button onClick={() => nav(`/app/quotes/${result.quote.id}`)}>Review quote</Button><Button variant="secondary" onClick={() => nav(`/app/leads/${result.lead.id}`)}>Open lead</Button></div>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <CardTitle title="Lead qualification" subtitle="Who to call first, and why — every point of the score is explained." />
        <div className="divide-y divide-line">{ranked.map((l) => (
          <Link key={l.id} to={`/app/leads/${l.id}`} className="flex flex-col gap-1 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
            <span><span className="font-medium">{l.name}</span> <span className="text-sm text-ink-500">· {l.destination || l.service} · {SOURCE_LABEL[l.source]}</span><span className="block text-xs text-ink-500">{l.scoreReasons.slice(0, 4).join(" · ")}</span></span>
            <StatusBadge status={l.temperature} label={`${l.temperature} · ${l.score}`} />
          </Link>
        ))}</div>
      </Card>
    </div>
  );
}
