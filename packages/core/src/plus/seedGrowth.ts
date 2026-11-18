/**
 * Demo data for the growth screens: three months of marketing spend, ~56 extra enquiries across every channel
 * (with bookings, invoices and payments for the ones that were won), installed automations and their run history.
 * Rows are validated through the entity schemas and inserted directly (no per-lead workflow), so seeding stays fast.
 * All people and phone numbers are fictional.
 */
import { internals } from "../actions.js";
import { addDays, isoDate, lastMonths } from "../dates.js";
import { ID_PREFIX, schemas, type Automation, type AutomationRun, type Collection, type Entity, type Input, type Lead, type Role } from "../entities.js";
import { newId, randomToken } from "../ids.js";
import { invoiceLegs, paymentLegs } from "../ledger.js";
import { scoreLead, type LeadSource, type LeadStage } from "../rules.js";
import { getSettings, patchRow, type Ctx, type Store } from "../store.js";
import { splitGst } from "../tax.js";
import { AUTOMATION_TEMPLATES } from "./growthRecipes.js";
import { rupees } from "./shared.js";

const R = (rupees: number) => Math.round(rupees * 100);
const DAY = 86_400_000;
const { nextNumber, postLedger, invoiceStatus } = internals;

/** Small deterministic PRNG so the demo looks the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

async function put<C extends Collection>(store: Store, c: C, input: Input<C>, at: Date, opts: { id?: string; updatedAt?: Date } = {}): Promise<Entity<C>> {
  const parsed = schemas[c].parse(input) as object;
  const row = { ...parsed, id: opts.id ?? newId(ID_PREFIX[c]), createdAt: at.toISOString(), updatedAt: (opts.updatedAt ?? at).toISOString() } as Entity<C>;
  return store.insert(c, row);
}

const DESTS = [
  { name: "Dubai", perPax: 55_000, scope: "overseas", nights: 5, note: "Wants a hotel near Dubai Mall and a desert safari" },
  { name: "Bali", perPax: 65_000, scope: "overseas", nights: 6, note: "Honeymoon — private pool villa in Ubud, then Seminyak" },
  { name: "Thailand", perPax: 42_000, scope: "overseas", nights: 5, note: "Phuket + Krabi, island hopping, vegetarian food needed" },
  { name: "Maldives", perPax: 1_20_000, scope: "overseas", nights: 4, note: "Water villa, all-inclusive, anniversary surprise" },
  { name: "Kashmir", perPax: 30_000, scope: "domestic", nights: 5, note: "Srinagar houseboat, Gulmarg gondola, Pahalgam" },
  { name: "Kerala", perPax: 26_000, scope: "domestic", nights: 5, note: "Munnar tea gardens and an Alleppey houseboat night" },
  { name: "Goa", perPax: 18_000, scope: "domestic", nights: 4, note: "Beach resort in North Goa, flexible on dates" },
  { name: "Singapore", perPax: 72_000, scope: "overseas", nights: 5, note: "Family trip — Universal Studios and Sentosa" },
  { name: "Europe", perPax: 1_65_000, scope: "overseas", nights: 9, note: "Switzerland + Paris, first Schengen visa for the family" },
  { name: "Vietnam", perPax: 48_000, scope: "overseas", nights: 6, note: "Hanoi, Ha Long Bay cruise and Da Nang" },
] as const;

const FIRST = ["Aditi", "Rajat", "Shreya", "Nikhil", "Ishita", "Varun", "Megha", "Karthik", "Riya", "Abhishek", "Payal", "Sameer", "Tanya", "Gaurav", "Simran", "Akash", "Neelam", "Pranav", "Divya", "Harshad", "Jyoti", "Manoj", "Kritika", "Yash", "Swati", "Rohit", "Anjali", "Sachin", "Bhavna", "Kunal", "Ritu", "Amol", "Preeti", "Vikas", "Sonal", "Omkar", "Pallavi", "Tushar", "Nandini", "Ankit", "Shweta", "Deepak", "Mansi", "Rahul", "Poonam", "Chetan", "Isha", "Mohit", "Komal", "Siddhesh", "Aparna", "Hemant", "Rashmi", "Arvind", "Juhi", "Naveen"] as const;
const LAST = ["Kulkarni", "Bhatia", "Chopra", "Deshpande", "Ghosh", "Hegde", "Iyengar", "Joshi", "Khanna", "Lal", "Mishra", "Narang", "Oberoi", "Pandit", "Qureshi", "Rathore", "Sethi", "Thakur", "Upadhyay", "Vora", "Wadhwa", "Yadav", "Zaveri", "Bose", "Chauhan", "Dutta", "Gill", "Menon", "Nair", "Shetty"] as const;
const CITIES = ["Mumbai", "Pune", "Delhi", "Bengaluru", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", "Jaipur", "Indore", "Surat", "Lucknow", "Nagpur", "Thane"] as const;
const LOST = ["Price too high", "Booked elsewhere", "Plans postponed", "No response", "Found a cheaper package online", "Dates not finalised — postponed to next year", "Not responding to calls or WhatsApp", "Price — went with another agent", "Visa appointment not available in time"] as const;

type Outcome = LeadStage;
/** Outcomes per channel: paid social brings volume but converts poorly; referrals and Instagram convert best. */
const PLAN: [LeadSource, Outcome[]][] = [
  ["meta_ads", ["won", "won", "lost", "lost", "lost", "lost", "lost", "lost", "negotiation", "quoted", "quoted", "contacted", "contacted", "contacted", "new", "new"]],
  ["google_ads", ["won", "won", "won", "lost", "lost", "quoted", "quoted", "contacted", "contacted", "new"]],
  ["instagram", ["won", "won", "lost", "quoted", "contacted", "new"]],
  ["landing_page", ["won", "lost", "lost", "quoted", "contacted", "new"]],
  ["whatsapp", ["won", "lost", "quoted", "quoted", "contacted", "new"]],
  ["website", ["won", "lost", "quoted", "contacted", "new"]],
  ["referral", ["won", "won", "negotiation", "contacted"]],
  ["email", ["lost", "quoted", "new"]],
];

/** Minutes until the first reply, by channel (some paid-ad leads wait far too long — that's the point of the report). */
const REPLY_MINS: Record<string, [number, number]> = {
  whatsapp: [3, 25], website: [20, 95], google_ads: [12, 150], instagram: [8, 60], meta_ads: [35, 420], landing_page: [20, 210], referral: [5, 40], email: [60, 600],
};

export async function seedGrowth(store: Store, base: Date, tenantId = "demo"): Promise<void> {
  const r = rng(20261116);
  const settings = await getSettings(store, base);
  const today = isoDate(base, settings.timezone);
  const users = await store.list("users");
  const by = (role: Role) => users.find((u) => u.role === role && u.active);
  const sales = users.filter((u) => u.role === "sales" && u.active);
  const priya = sales[0] ?? by("owner")!, rohan = sales[1] ?? priya;
  const ops = by("ops") ?? by("owner")!;
  const ctxAt = (d: Date): Ctx => ({ tenantId, userId: "seed", role: "owner", agentId: null, now: d });
  const stamp = (daysAgo: number, hour: number, minute: number) => {
    const d = new Date(`${addDays(today, -daysAgo)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
    return d.getTime() > base.getTime() - 30 * 60_000 ? new Date(base.getTime() - (30 + r.int(10, 200)) * 60_000) : d;
  };
  const clampNow = (d: Date) => (d.getTime() > base.getTime() ? new Date(base.getTime() - 60_000) : d);

  /* Marketing spend: four months of realistic small-agency budgets (August to the current month) */
  const months = lastMonths(today, 4);
  const SPEND: [LeadSource, number[], string][] = [
    ["meta_ads", [12_000, 14_500, 16_000, 9_000], "Facebook + Instagram lead-form ads (Dubai, Bali, Thailand)"],
    ["google_ads", [6_000, 6_500, 7_500, 4_000], "Search ads: \"Dubai tour package from Mumbai\", \"Kashmir package\""],
    ["instagram", [1_500, 2_000, 2_500, 1_200], "Boosted reels and two travel-creator stories"],
    ["landing_page", [3_000, 3_000, 3_500, 2_000], "Paid traffic to the Bali and Kashmir landing pages"],
    ["email", [999, 999, 999, 999], "Brevo newsletter plan"],
  ];
  for (const [source, amounts, note] of SPEND) {
    for (const [k, m] of months.entries()) {
      await put(store, "channelSpend", { month: m, source, amount: R(amounts[k] ?? amounts[amounts.length - 1]!), note: k === months.length - 1 ? `${note} (month to date)` : note }, new Date(`${m}-01T10:00:00+05:30`) < base ? new Date(`${m}-01T10:00:00+05:30`) : base);
    }
  }

  /* A second landing page */
  const lpKashmir = await put(store, "landingPages", { title: "Kashmir Houseboat Escape", slug: "kashmir-houseboat", headline: "Srinagar, Gulmarg & Pahalgam — 5 nights from ₹28,900", body: "Houseboat stay on Dal Lake, Gulmarg gondola and a Pahalgam day trip, with a local expert on call.", published: true, leads: 0 }, new Date(base.getTime() - 70 * DAY));
  const lpBali = (await store.list("landingPages")).find((l) => l.slug === "bali-honeymoon");
  const diwali = (await store.list("campaigns")).find((c) => c.status === "sent");
  const diwaliAt = diwali?.scheduledAt ? Date.parse(diwali.scheduledAt) : base.getTime() - 15 * DAY;

  /* Enquiries */
  let idx = 0;
  const nth: Record<string, number> = {};
  let bali = 0, kashmir = 0, campaignLeads = 0;
  const created: Lead[] = [];
  for (const [source, outcomes] of PLAN) {
    for (const outcome of outcomes) {
      const i = idx++;
      const dest = source === "landing_page" ? DESTS[i % 2 === 0 ? 1 : 4] : source === "whatsapp" && i % 2 === 0 ? DESTS[0] : DESTS[(i * 7 + 3) % DESTS.length]!;
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 11 + 5) % LAST.length]}`;
      const phone = `+91 97${String(10_000 + i * 173).padStart(3, "0").slice(0, 3)} ${String(10_000 + ((i * 7919) % 90_000)).slice(0, 5)}`;
      const email = i % 3 === 2 ? "" : `${name.split(" ")[0]!.toLowerCase()}.${name.split(" ")[1]!.toLowerCase()}@example.com`;
      const k = (nth[outcome] = (nth[outcome] ?? -1) + 1);
      // Spread each outcome across the 90 days so every range (7/30/90) has wins, losses and open leads
      const daysAgo = outcome === "new" ? r.int(0, 3) : outcome === "contacted" ? 2 + ((k * 11) % 38) : outcome === "quoted" || outcome === "negotiation" ? 3 + ((k * 13) % 45) : outcome === "won" ? 8 + ((k * 29) % 76) : 5 + ((k * 37) % 83);
      let at = stamp(daysAgo, r.int(8, 22), r.int(0, 59));
      if (outcome === "new") at = new Date(Math.min(at.getTime(), base.getTime() - r.int(150, 900) * 60_000));
      const family = r.next() < 0.35;
      const adults = family ? r.pick([2, 3, 4]) : 2;
      const children = family ? r.int(1, 2) : 0;
      const budget = Math.round((dest.perPax * (adults + children * 0.6) * (0.8 + r.next() * 0.5)) / 1000) * 1000;
      const travelDate = addDays(isoDate(at, settings.timezone), r.int(18, 55));
      const contacted = outcome !== "new";
      const [lo, hi] = REPLY_MINS[source] ?? [20, 120];
      const touchAt = contacted ? clampNow(new Date(at.getTime() + r.int(lo, hi) * 60_000)) : null;
      const ownerId = ["Dubai", "Bali", "Maldives", "Europe", "Singapore"].includes(dest.name) ? priya.id : rohan.id;
      const tiedLp = source === "landing_page" ? (dest.name === "Bali" ? "bali-honeymoon" : "kashmir-houseboat") : null;
      if (tiedLp === "bali-honeymoon") bali++;
      if (tiedLp === "kashmir-houseboat") kashmir++;
      const campaignId = diwali && source === "whatsapp" && dest.name === "Dubai" && at.getTime() > diwaliAt ? diwali.id : null;
      if (campaignId) campaignLeads++;
      const scored = scoreLead({ source, budget: R(budget), payingPax: adults + children, travelDate, destination: dest.name, phone, email: email || null, activityCount: contacted ? 1 : 0, today: isoDate(at, settings.timezone) });
      const wonAt = outcome === "won" ? clampNow(new Date(at.getTime() + r.int(2, 9) * DAY)) : null;
      const closedAt = outcome === "lost" ? clampNow(new Date(at.getTime() + r.int(2, 12) * DAY)) : wonAt;
      const contactId = newId(ID_PREFIX.contacts);
      const leadId = newId(ID_PREFIX.leads);
      const bookingId = outcome === "won" ? newId(ID_PREFIX.bookings) : null;
      const sell = bookingId ? Math.round((R(budget) * (0.88 + r.next() * 0.2)) / 10_000) * 10_000 : 0;
      const gst = Math.round(sell * 0.05);
      const nights = dest.nights;
      const endDate = addDays(travelDate, nights);
      const completed = bookingId !== null && endDate < today;

      await put(store, "contacts", {
        name, phone, email, city: CITIES[(i * 5) % CITIES.length]!, tags: [source === "referral" ? "referred" : "", dest.name === "Bali" || dest.name === "Maldives" ? "honeymoon" : "", family ? "family" : ""].filter(Boolean),
        trips: bookingId ? 1 : 0, totalSpend: bookingId ? sell + gst : 0,
      }, at, { id: contactId });
      const notes = [
        `${dest.note}.`,
        tiedLp ? `Landing page: ${tiedLp}` : "",
        source === "meta_ads" ? `Meta lead form: "${dest.name} ${r.pick(["Diwali", "winter", "family", "honeymoon"])} offer"` : "",
        source === "google_ads" ? `Searched: "${dest.name.toLowerCase()} tour package"` : "",
        source === "referral" ? `Referred by a past traveller (${r.pick(["Ananya Sharma", "Rahul Verma", "Arjun Reddy", "Nisha Agarwal"])})` : "",
      ].filter(Boolean).join("\n");
      const lastActivity = closedAt ?? touchAt ?? at;
      const lead = await put(store, "leads", {
        contactId, name, phone, email, source, service: "holiday", destination: dest.name, travelDate, nights, pax: { adults, children, infants: 0 }, budget: R(budget),
        notes, stage: outcome, temperature: outcome === "lost" ? "cold" : scored.temperature, score: scored.score, scoreReasons: scored.reasons, ownerId,
        lostReason: outcome === "lost" ? r.pick(LOST) : "", lastActivityAt: lastActivity.toISOString(), bookingId, campaignId,
      }, at, { id: leadId, updatedAt: lastActivity });
      created.push(lead);
      if (touchAt) {
        const kind = source === "email" ? "email" : r.next() < 0.5 ? "call" : "whatsapp";
        const body = kind === "call" ? `Called ${name.split(" ")[0]} — discussed ${dest.name} dates, hotels and budget.` : kind === "email" ? `Replied with two ${dest.name} itineraries and prices.` : `Shared ${dest.name} sample itineraries on WhatsApp.`;
        await put(store, "activities", { leadId, kind, direction: "out", body, at: touchAt.toISOString(), byId: ownerId, durationSec: kind === "call" ? r.int(90, 600) : null }, touchAt);
      }

      if (bookingId && wonAt) {
        const wonDay = isoDate(wonAt, settings.timezone);
        const startDate = travelDate > wonDay ? travelDate : addDays(wonDay, 10);
        const end = addDays(startDate, nights);
        const status = end < today ? "completed" : startDate <= today ? "in_progress" : "confirmed";
        const invoiceId = newId(ID_PREFIX.invoices);
        const ctx = ctxAt(wonAt);
        const total = sell + gst;
        const dueDate = addDays(wonDay, 7) < startDate ? addDays(wonDay, 7) : startDate;
        const fullyPaid = completed || status === "in_progress" || r.next() < 0.3;
        const advance = Math.round(total * 0.4 / 100) * 100;
        const paid = fullyPaid ? total : advance;
        const number = await nextNumber(store, "booking", settings.bookingPrefix, wonDay);
        await put(store, "bookings", {
          number, leadId, contactName: name, phone, email, title: `${nights}N ${dest.name} holiday for ${adults + children}`, destination: dest.name, startDate, endDate: end,
          pax: { adults, children, infants: 0 }, status, sellTotal: sell, costTotal: Math.round(sell * 0.83), invoiceId, ownerId, scope: dest.scope,
        }, wonAt, { id: bookingId, updatedAt: status === "completed" ? clampNow(new Date(`${end}T10:00:00+05:30`)) : wonAt });
        const party = { type: "customer" as const, id: contactId, name };
        await put(store, "invoices", {
          number: await nextNumber(store, "invoice", settings.invoicePrefix, wonDay), bookingId, partyType: "customer", partyId: contactId, partyName: name,
          placeOfSupply: settings.state, supplierState: settings.state, scope: dest.scope, issueDate: wonDay, dueDate, currency: "INR",
          lines: [{ description: `Tour package: ${nights}N ${dest.name} (${adults + children} pax)`, sac: "998555", amount: sell }],
          sell, gst, ...splitGst(gst, settings.state, settings.state), tcs: 0, total, paid, status: invoiceStatus({ total, paid, credited: 0 }),
        }, wonAt, { id: invoiceId });
        await postLedger(store, ctx, wonDay, invoiceLegs({ party, sell, gst, tcs: 0 }), { type: "invoice", id: invoiceId, memo: `Invoice — ${number}` });
        const pays = fullyPaid && !completed ? [total] : fullyPaid ? [advance, total - advance] : [advance];
        for (const [k, amount] of pays.entries()) {
          if (amount <= 0) continue;
          const payAt = k === 0 ? wonAt : clampNow(new Date(Math.max(wonAt.getTime() + 3 * 3600_000, Math.min(Date.parse(`${addDays(startDate, -9)}T15:00:00+05:30`), base.getTime() - DAY))));
          const payDay = isoDate(payAt, settings.timezone);
          const p = await put(store, "payments", {
            invoiceId, partyType: "customer", partyId: contactId, partyName: name, amount, method: k === 0 ? r.pick(["upi", "card", "upi"] as const) : "bank_transfer",
            gateway: k === 0 ? "razorpay" : "manual", reference: k === 0 ? `pay_${randomToken(10)}` : `NEFT${r.int(100000, 999999)}`, date: payDay, direction: "in", purpose: "invoice",
          }, payAt);
          await postLedger(store, ctxAt(payAt), payDay, paymentLegs({ party, amount, fromWallet: false }), { type: "payment", id: p.id, memo: `Payment for ${number}` });
        }
      }
    }
  }
  if (lpBali && bali) await patchRow(store, "landingPages", lpBali.id, { leads: lpBali.leads + bali }, base);
  if (kashmir) await patchRow(store, "landingPages", lpKashmir.id, { leads: kashmir }, base);
  if (diwali && campaignLeads) await patchRow(store, "campaigns", diwali.id, { leadCount: diwali.leadCount + campaignLeads }, base);

  await seedAutomations(store, base, tenantId, { opsId: ops.id, today, tz: settings.timezone, r });
}

/* ───────────────────────── automations and their history ───────────────────────── */

async function seedAutomations(store: Store, base: Date, tenantId: string, o: { opsId: string; today: string; tz: string; r: ReturnType<typeof rng> }): Promise<void> {
  const installedAt = new Date(base.getTime() - 41 * DAY);
  const tpl = (key: string) => AUTOMATION_TEMPLATES.find((t) => t.key === key)!;
  const plan: { key: string; active: boolean; at: Date }[] = [
    { key: "instant-reply", active: true, at: installedAt },
    { key: "hot-high-budget", active: true, at: installedAt },
    { key: "quote-follow-up", active: true, at: new Date(installedAt.getTime() + 2 * DAY) },
    { key: "viewed-not-paid", active: true, at: new Date(installedAt.getTime() + 2 * DAY) },
    { key: "balance-before-departure", active: true, at: new Date(installedAt.getTime() + 6 * DAY) },
    { key: "review-after-trip", active: true, at: new Date(installedAt.getTime() + 6 * DAY) },
    { key: "payment-tell-ops", active: false, at: new Date(installedAt.getTime() + 9 * DAY) },
  ];
  const autos = new Map<string, Automation>();
  for (const p of plan) {
    const t = tpl(p.key);
    const steps = t.automation.steps.map((s, i) => (p.key === "payment-tell-ops" && i === 0 ? { ...s, userId: o.opsId } : s));
    autos.set(p.key, await put(store, "automations", { ...t.automation, steps, active: p.active, template: t.key, runs: 0, lastRunAt: null }, p.at, { updatedAt: p.active ? p.at : new Date(base.getTime() - 8 * DAY) }));
  }

  const [leads, quotes, bookings, invoices, payments, users] = await Promise.all([store.list("leads"), store.list("quotes"), store.list("bookings"), store.list("invoices"), store.list("payments"), store.list("users")]);
  const settings = (await store.list("settings"))[0]!;
  const first = (n: string) => n.split(" ")[0] ?? n;
  const ownerOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? "the owner";
  const since = base.getTime() - 14 * DAY;
  type RunIn = { auto: Automation; subjectType: AutomationRun["subjectType"]; subjectId: string; subjectName: string; keyPart: string; at: Date; steps: { kind: Automation["steps"][number]["kind"]; ok: boolean; detail: string }[] };
  const runs: RunIn[] = [];
  const status = (steps: RunIn["steps"]): AutomationRun["status"] => {
    const did = steps.some((s) => s.ok && !s.detail.startsWith("Skipped"));
    const bad = steps.some((s) => !s.ok);
    return did ? (bad ? "partial" : "done") : bad && steps.some((s) => !s.ok && !s.detail.startsWith("Skipped")) ? "failed" : "skipped";
  };
  const link = (path: string) => `${settings.appUrl ? settings.appUrl.replace(/\/?$/, "/") : ""}#${path}`;
  const short = (s: string) => (s.length > 90 ? `${s.slice(0, 89)}…` : s);

  // Instant reply + high-budget fast lane: every non-WhatsApp lead of the last 14 days
  const instant = autos.get("instant-reply")!, hot = autos.get("hot-high-budget")!;
  for (const l of leads.filter((x) => Date.parse(x.createdAt) >= Math.max(since, Date.parse(instant.createdAt)))) {
    const at = new Date(Date.parse(l.createdAt) + 4000);
    if (l.source !== "whatsapp") {
      const msg = `Hi ${first(l.name)}! Thank you for your ${l.destination || "holiday"} enquiry with ${settings.companyName}. ${first(ownerOf(l.ownerId))} from our team will call you shortly…`;
      runs.push({ auto: instant, subjectType: "lead", subjectId: l.id, subjectName: l.name, keyPart: l.id, at, steps: [l.phone || l.email
        ? { kind: "send_message", ok: true, detail: `${l.phone ? "WhatsApp" : "Email"} queued to ${l.phone || l.email}: "${short(msg)}"` }
        : { kind: "send_message", ok: false, detail: "Skipped: no phone number or email on file" }] });
    }
    if ((l.budget ?? 0) >= 30_000_000) {
      runs.push({ auto: hot, subjectType: "lead", subjectId: l.id, subjectName: l.name, keyPart: l.id, at: new Date(at.getTime() + 1000), steps: [
        l.temperature === "hot" ? { kind: "set_temperature", ok: true, detail: "Skipped: already hot" } : { kind: "set_temperature", ok: true, detail: `Marked hot (was ${l.temperature})` },
        { kind: "notify_owner", ok: true, detail: `Alerted ${ownerOf(l.ownerId)}: "High-value enquiry: ${first(l.name)}, ${l.destination}, budget ${rupees(l.budget!)}. Call within 15 minutes."` },
        { kind: "create_task", ok: true, detail: `Task "Call ${first(l.name)} now — ${rupees(l.budget!)} ${l.destination} enquiry" for ${ownerOf(l.ownerId)}, due today` },
      ] });
    }
  }

  // Quote follow-ups (2 days quiet) and "opened but didn't pay" (1 day after viewing)
  const qf = autos.get("quote-follow-up")!, vnp = autos.get("viewed-not-paid")!;
  for (const q of quotes.filter((x) => x.status === "sent" || x.status === "viewed")) {
    const lead = leads.find((l) => l.id === q.leadId);
    const owner = ownerOf(q.ownerId ?? lead?.ownerId ?? null);
    const due2 = Date.parse(q.updatedAt) + 2 * DAY;
    if (due2 <= base.getTime() && due2 >= since && due2 >= Date.parse(qf.createdAt)) {
      runs.push({ auto: qf, subjectType: "quote", subjectId: q.id, subjectName: q.contactName, keyPart: `${q.id}|v${q.version}`, at: new Date(due2 + 60_000), steps: [
        q.phone || q.email
          ? { kind: "send_message", ok: true, detail: `WhatsApp queued to ${q.phone || q.email}: "${short(`Hi ${first(q.contactName)}, did you get a chance to look at your ${q.destination || "holiday"} proposal? Here it is again: ${link(`/p/${tenantId}/${q.shareToken}`)}`)}"` }
          : { kind: "send_message", ok: false, detail: "Skipped: no phone number or email on file" },
        { kind: "create_task", ok: true, detail: `Task "Call ${first(q.contactName)} about the ${q.destination} quote (${rupees(q.total)})" for ${owner}, due today` },
      ] });
    }
    const due1 = Date.parse(q.updatedAt) + DAY;
    if (q.status === "viewed" && due1 <= base.getTime() && due1 >= since) {
      runs.push({ auto: vnp, subjectType: "quote", subjectId: q.id, subjectName: q.contactName, keyPart: `${q.id}|v${q.version}`, at: new Date(due1 + 60_000), steps: [
        { kind: "send_message", ok: true, detail: `WhatsApp queued to ${q.phone || q.email}: "${short(`Hi ${first(q.contactName)}, I saw you had a look at your ${q.destination} proposal. Shall I lock it for you?`)}"` },
        { kind: "notify_owner", ok: true, detail: `Alerted ${owner}: "${first(q.contactName)} opened the ${q.destination} proposal (${rupees(q.total)}) but hasn't paid yet. Call today."` },
      ] });
    }
  }

  // Balance 7 days before departure, and reviews 2 days after the trip
  const bal = autos.get("balance-before-departure")!, rev = autos.get("review-after-trip")!;
  for (const b of bookings.filter((x) => x.status !== "cancelled")) {
    const inv = invoices.find((i) => i.id === b.invoiceId);
    const dueAt = Date.parse(`${addDays(b.startDate, -7)}T09:00:00+05:30`);
    if (b.status === "confirmed" && dueAt <= base.getTime() && dueAt >= Math.max(since, Date.parse(bal.createdAt)) && b.startDate >= o.today) {
      const out = inv ? Math.max(0, inv.total - inv.paid - inv.credited) : 0;
      runs.push({ auto: bal, subjectType: "booking", subjectId: b.id, subjectName: b.contactName, keyPart: `${b.id}|${b.startDate}`, at: new Date(dueAt), steps: [
        !inv ? { kind: "send_payment_link", ok: false, detail: "Skipped: there's no invoice for this booking yet" }
          : inv.partyType === "agent" ? { kind: "send_payment_link", ok: true, detail: `Skipped: ${inv.number} is billed to a B2B agent` }
          : out <= 0 ? { kind: "send_payment_link", ok: true, detail: `Skipped: nothing is due on ${inv.number}` }
          : { kind: "send_payment_link", ok: true, detail: `Payment link for ${rupees(out)} on ${inv.number} sent by WhatsApp to ${b.phone}` },
        { kind: "create_task", ok: true, detail: `Task "Confirm ${first(b.contactName)} has paid the balance before travel on ${b.startDate}" for ${ownerOf(b.ownerId)}, due in 2 days` },
      ] });
    }
    const revAt = Date.parse(`${addDays(b.endDate, 2)}T11:00:00+05:30`);
    if (b.endDate < o.today && revAt <= base.getTime() && revAt >= Math.max(since, Date.parse(rev.createdAt))) {
      const lead = leads.find((l) => l.id === b.leadId);
      runs.push({ auto: rev, subjectType: "booking", subjectId: b.id, subjectName: b.contactName, keyPart: b.id, at: new Date(revAt), steps: [
        b.phone || b.email
          ? { kind: "send_message", ok: true, detail: `WhatsApp queued to ${b.phone || b.email}: "${short(`Welcome back, ${first(b.contactName)}! We hope ${b.destination} was everything you wished for. Could you spare 30 seconds for a review?`)}"` }
          : { kind: "send_message", ok: false, detail: "Skipped: no phone number or email on file" },
        lead?.contactId ? { kind: "add_tag", ok: true, detail: `Tagged ${b.contactName} "past-traveller"` } : { kind: "add_tag", ok: false, detail: "Skipped: there's no customer record to tag" },
      ] });
    }
  }

  // Payment → operations: ran for a few days, then paused (ops asked for one daily summary instead)
  const pto = autos.get("payment-tell-ops")!;
  const pausedAt = base.getTime() - 8 * DAY;
  for (const p of payments.filter((x) => x.direction === "in" && x.purpose === "invoice" && x.invoiceId && Date.parse(x.createdAt) >= Math.max(since, Date.parse(pto.createdAt)) && Date.parse(x.createdAt) < pausedAt)) {
    const inv = invoices.find((i) => i.id === p.invoiceId);
    const b = bookings.find((x) => x.id === inv?.bookingId);
    runs.push({ auto: pto, subjectType: "invoice", subjectId: p.invoiceId!, subjectName: p.partyName, keyPart: p.id, at: new Date(Date.parse(p.createdAt) + 3000), steps: [
      { kind: "create_task", ok: true, detail: `Task "Payment of ${rupees(p.amount)} received from ${first(p.partyName)} (${b?.destination ?? "trip"}) — confirm services and send vouchers" for ${ownerOf(o.opsId)}, due today` },
    ] });
  }

  runs.sort((a, b) => a.at.getTime() - b.at.getTime());
  const counts = new Map<string, { n: number; last: string }>();
  for (const x of runs) {
    const steps = x.steps.map((s) => ({ ...s, detail: s.detail.slice(0, 300) }));
    await put(store, "automationRuns", {
      automationId: x.auto.id, automationName: x.auto.name, trigger: x.auto.trigger, subjectType: x.subjectType, subjectId: x.subjectId, subjectName: x.subjectName.slice(0, 160),
      status: status(steps), steps, error: "", at: x.at.toISOString(), key: `${x.auto.id}|${x.auto.trigger}|${x.keyPart}`.slice(0, 240),
    }, x.at);
    const c = counts.get(x.auto.id) ?? { n: 0, last: "" };
    counts.set(x.auto.id, { n: c.n + 1, last: x.at.toISOString() > c.last ? x.at.toISOString() : c.last });
  }
  for (const a of autos.values()) {
    const c = counts.get(a.id);
    // Runs before the 14-day history window are summarised in the counter only
    const older = a.active ? o.r.int(6, 25) : 9;
    await patchRow(store, "automations", a.id, { runs: (c?.n ?? 0) + older, lastRunAt: c?.last ?? new Date(Date.parse(a.createdAt) + 5 * DAY).toISOString() }, base);
  }
}
