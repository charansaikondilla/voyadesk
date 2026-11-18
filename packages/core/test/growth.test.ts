import { beforeAll, describe, expect, it } from "vitest";
import {
  addDays, createRow, isoDate, MemoryStore, patchRow, runAction, runJobs, runPublicAction, runReport, seedDemo, trialBalance,
  type AutomationTestResult, type AudiencePreview, type Ctx, type LedgerEntry, type MarketingFunnel, type Role,
} from "../src/index.js";

const NOW = new Date("2026-11-15T05:30:00Z");
const at = (ms: number, role: Role = "owner"): Ctx => ({ tenantId: "demo", userId: "u1", role, agentId: null, now: new Date(NOW.getTime() + ms) });
const demo = (role: Role = "owner") => at(0, role);
const pub = (): Ctx => ({ tenantId: "demo", userId: "public", role: "admin", agentId: null, now: NOW });
const day = (n: number) => addDays(isoDate(NOW), n);
const DAY = 86_400_000;

async function team(s: MemoryStore) {
  const owner = await createRow(s, "users", { name: "Aarav Mehta", email: "owner@x.in", role: "owner" }, NOW);
  const priya = await createRow(s, "users", { name: "Priya Nair", email: "priya@x.in", role: "sales" }, NOW);
  const rohan = await createRow(s, "users", { name: "Rohan Gupta", email: "rohan@x.in", role: "sales" }, NOW);
  await createRow(s, "users", { name: "Accounts", email: "acc@x.in", role: "accounts" }, NOW);
  await createRow(s, "users", { name: "Ops", email: "ops@x.in", role: "ops" }, NOW);
  return { owner, priya, rohan };
}

const lead = (extra: Record<string, unknown> = {}) => ({ name: "Asha Rao", phone: "+91 98765 43210", email: "asha@example.com", source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2, ...extra });
const capture = async (s: MemoryStore, extra: Record<string, unknown> = {}, ctx = demo("sales")) =>
  ((await runAction(s, ctx, "captureLead", lead(extra))) as { lead: { id: string } }).lead;

const save = (s: MemoryStore, body: Record<string, unknown>) => runAction(s, demo(), "saveAutomation", { description: "", days: 0, conditions: [], active: true, ...body }) as Promise<{ id: string; runs: number }>;
const step = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, channel: "whatsapp", message: "", title: "", value: "", userId: null, dueInDays: 0, ...extra });

describe("event automations", () => {
  it("lead_created fires once per lead (idempotent across the hook and the runJobs sweep)", async () => {
    const s = new MemoryStore();
    await team(s);
    await runAction(s, demo(), "installAutomation", { templateKey: "instant-reply", active: true });
    const l = await capture(s);
    const runs = await s.list("automationRuns");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "done", subjectType: "lead", subjectId: l.id, subjectName: "Asha Rao" });
    const msg = (await s.list("outbox")).find((o) => o.leadId === l.id && /Thank you for your Goa enquiry/.test(o.body));
    expect(msg?.body).toMatch(/^Hi Asha! /);
    expect((await s.list("activities")).some((a) => a.leadId === l.id && a.body.startsWith('Automation "Instant reply'))).toBe(true);

    const jobs = await runJobs(s, at(60_000));
    expect(jobs["automations"]).toBe(0);
    await capture(s, {}, at(120_000, "sales")); // same person + destination → updates the open lead, no new lead
    expect(await s.list("automationRuns")).toHaveLength(1);
    const auto = (await s.list("automations"))[0]!;
    expect(auto.runs).toBe(1);
    expect(auto.lastRunAt).toBe(NOW.toISOString());
  });

  it("only runs when every condition passes (money in paise)", async () => {
    const s = new MemoryStore();
    await team(s);
    await runAction(s, demo(), "installAutomation", { templateKey: "hot-high-budget" });
    await capture(s, { budget: 1_00_000_00 });
    expect(await s.list("automationRuns")).toHaveLength(0);
    const big = await capture(s, { name: "Dev Shah", phone: "+91 98111 00000", email: "", destination: "Maldives", budget: 5_00_000_00 });
    const [run] = await s.list("automationRuns");
    expect(run).toMatchObject({ status: "done", subjectId: big.id });
    expect((await s.get("leads", big.id))!.temperature).toBe("hot");
    expect((await s.list("tasks")).some((t) => t.leadId === big.id && /₹5,00,000 Maldives/.test(t.title) && t.priority === "high")).toBe(true);
  });

  it("quote accepted without full payment sends a payment link for the balance", async () => {
    const s = new MemoryStore();
    await team(s);
    const sup = await createRow(s, "suppliers", { name: "Sea Breeze Resorts", category: "hotel", city: "Goa", paymentTermsDays: 7 }, NOW);
    await createRow(s, "hotels", { name: "Sea Breeze", city: "Goa", country: "India", stars: 4, supplierId: sup.id, rates: [{ roomType: "Deluxe", mealPlan: "CP", season: "regular", netPerNight: 450_000, currency: "INR" }] }, NOW);
    await runAction(s, demo(), "installAutomation", { templateKey: "collect-after-confirmation" });
    const l = await capture(s);
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: l.id })) as { id: string };
    await runAction(s, demo(), "sendQuote", { quoteId: q.id, channel: "link" });
    await runAction(s, demo(), "acceptQuote", { quoteId: q.id });
    const [run] = await s.list("automationRuns");
    expect(run).toMatchObject({ status: "done", trigger: "quote_accepted", subjectId: q.id });
    const [link] = await s.list("paymentLinks");
    const inv = (await s.list("invoices"))[0]!;
    expect(link).toMatchObject({ invoiceId: inv.id, amount: inv.total, status: "created" });
    expect((await s.list("outbox")).some((o) => o.kind === "reminder" && o.body.includes(link!.url) && o.body.includes("Thank you for confirming your Goa holiday"))).toBe(true);
    expect(trialBalance((await s.list("ledger")) as unknown as LedgerEntry[]).balanced).toBe(true);
  });

  it("set_stage respects the lead flow and skips with a reason instead of throwing", async () => {
    const s = new MemoryStore();
    await team(s);
    await save(s, { name: "Push to negotiation", trigger: "lead_created", steps: [step("set_stage", { value: "negotiation" }), step("create_task", { title: "Call {name}" })] });
    await save(s, { name: "Mark contacted", trigger: "lead_created", steps: [step("set_stage", { value: "contacted" })] });
    const l = await capture(s);
    const runs = await s.list("automationRuns");
    const bad = runs.find((r) => r.automationName === "Push to negotiation")!;
    expect(bad.status).toBe("partial");
    expect(bad.steps[0]).toMatchObject({ kind: "set_stage", ok: false });
    expect(bad.steps[0]!.detail).toMatch(/Skipped: a new lead can't move to negotiation/);
    expect(bad.steps[1]).toMatchObject({ kind: "create_task", ok: true });
    expect(runs.find((r) => r.automationName === "Mark contacted")!.status).toBe("done");
    expect((await s.get("leads", l.id))!.stage).toBe("contacted");
    // Changes made by automations never trigger other automations (no loops)
    await save(s, { name: "On stage change", trigger: "lead_stage_changed", steps: [step("add_tag", { title: "moved" })] });
    await capture(s, { name: "Ravi", phone: "+91 90000 11111", email: "", destination: "Kerala" });
    expect((await s.list("automationRuns")).filter((r) => r.automationName === "On stage change")).toHaveLength(0);
    await runAction(s, demo(), "updateLeadStage", { leadId: l.id, stage: "quoted" });
    expect((await s.list("automationRuns")).filter((r) => r.automationName === "On stage change")).toHaveLength(1);
  });

  it("a failing step makes the run partial and never rolls back the user's action", async () => {
    const s = new MemoryStore();
    const { rohan } = await team(s);
    await save(s, { name: "Give Rohan the lead", trigger: "lead_created", steps: [step("assign_owner", { userId: rohan.id }), step("send_message", { message: "Hi {name}, {owner} here from {company}." })] });
    await patchRow(s, "users", rohan.id, { active: false }, NOW);
    const l = await capture(s);
    expect(await s.get("leads", l.id)).toBeTruthy();
    const [run] = await s.list("automationRuns");
    expect(run!.status).toBe("partial");
    expect(run!.steps[0]).toMatchObject({ kind: "assign_owner", ok: false, detail: expect.stringMatching(/no longer an active user/) });
    expect(run!.steps[1]).toMatchObject({ kind: "send_message", ok: true });
  });
});

describe("time automations", () => {
  it("lead_idle runs from runJobs once per quiet spell", async () => {
    const s = new MemoryStore();
    await team(s);
    const a = await save(s, { name: "Quiet leads", trigger: "lead_idle", days: 2, conditions: [{ field: "stage", op: "eq", value: "new" }], steps: [step("send_message", { message: "Hi {name}, still planning {destination}?" })] });
    const quiet = await capture(s, {}, at(-3 * DAY, "sales"));
    await capture(s, { name: "Fresh", phone: "+91 90000 22222", email: "", destination: "Kerala" }, at(-1 * DAY, "sales"));
    const r1 = await runJobs(s, demo());
    expect(r1["automations"]).toBe(1);
    const [run] = await s.list("automationRuns");
    expect(run).toMatchObject({ automationId: a.id, subjectId: quiet.id, status: "done" });
    expect((await s.list("outbox")).some((o) => o.leadId === quiet.id && o.kind === "followup" && o.body === "Hi Asha, still planning Goa?")).toBe(true);
    expect((await runJobs(s, at(60_000)))["automations"]).toBe(0);
    await expect(runAction(s, demo(), "runAutomationNow", { automationId: a.id })).resolves.toEqual({ ran: 0, skipped: 1 });
  });

  it("event automations can't be run by hand", async () => {
    const s = new MemoryStore();
    await team(s);
    const a = (await runAction(s, demo(), "installAutomation", { templateKey: "instant-reply" })) as { id: string };
    await expect(runAction(s, demo(), "runAutomationNow", { automationId: a.id })).rejects.toMatchObject({ status: 422, message: "This runs by itself whenever a new lead comes in." });
  });
});

describe("saving, installing and testing", () => {
  it("validates in plain English", async () => {
    const s = new MemoryStore();
    await team(s);
    await expect(save(s, { name: "x", trigger: "lead_created", steps: [step("send_payment_link")] })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/payment links need a booking or invoice/) });
    await expect(save(s, { name: "x", trigger: "lead_idle", days: 0, steps: [step("create_task", { title: "Call" })] })).rejects.toMatchObject({ status: 422 });
    await expect(save(s, { name: "x", trigger: "lead_created", steps: [step("send_message")] })).rejects.toMatchObject({ message: "Action 1: write the message." });
    await expect(save(s, { name: "x", trigger: "lead_created", steps: [step("set_stage", { value: "won" })] })).rejects.toMatchObject({ status: 422 });
    await expect(save(s, { name: "x", trigger: "lead_created", steps: [step("assign_owner", { userId: "usr_nope" })] })).rejects.toMatchObject({ status: 422 });
    await expect(save(s, { name: "x", trigger: "trip_upcoming", days: 0, steps: [step("send_payment_link")] })).resolves.toMatchObject({ trigger: "trip_upcoming", days: 0 });
    await expect(runAction(s, demo("sales"), "saveAutomation", { name: "x", trigger: "lead_created", steps: [step("add_tag", { title: "t" })] })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a duplicate install with a 409 naming the existing automation", async () => {
    const s = new MemoryStore();
    await team(s);
    await runAction(s, demo(), "installAutomation", { templateKey: "quote-follow-up" });
    await expect(runAction(s, demo(), "installAutomation", { templateKey: "quote-follow-up" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('"Follow up quotes that get no answer"') });
    const templates = (await runReport(s, demo("sales"), "automationTemplates", {})) as { key: string; automation: Record<string, unknown> }[];
    expect(templates.length).toBeGreaterThanOrEqual(10);
    for (const t of templates) {
      const fresh = new MemoryStore();
      await team(fresh);
      await expect(runAction(fresh, demo(), "installAutomation", { templateKey: t.key })).resolves.toMatchObject({ template: t.key, active: true });
    }
  });
});

describe("on the demo agency", () => {
  let s: MemoryStore;
  beforeAll(async () => {
    s = new MemoryStore();
    await seedDemo(s, NOW);
  }, 60_000);

  it("seeds spend, extra leads, automations and run history with balanced books", async () => {
    expect(trialBalance((await s.list("ledger")) as unknown as LedgerEntry[]).balanced).toBe(true);
    expect((await s.list("channelSpend")).length).toBeGreaterThanOrEqual(15);
    expect((await s.list("leads")).length).toBeGreaterThanOrEqual(60);
    const autos = await s.list("automations");
    expect(autos.length).toBeGreaterThanOrEqual(6);
    expect(autos.some((a) => !a.active)).toBe(true);
    const runs = await s.list("automationRuns");
    expect(runs.length).toBeGreaterThanOrEqual(25);
    expect(new Set(runs.map((r) => r.key)).size).toBe(runs.length);
    // The history already covers what is due, so the next job run doesn't repeat it
    expect((await runJobs(new MemoryStore(s.data), demo()))["automations"]).toBe(0);
  });

  it("testAutomation is a dry run: nothing is written", async () => {
    const before = JSON.stringify(s.data);
    const draft = { name: "Chase quotes", description: "", trigger: "quote_idle", days: 1, conditions: [], active: true, steps: [step("send_message", { message: "Hi {name}, your {destination} quote: {link}" }), step("create_task", { title: "Call {name}" })] };
    const r = (await runAction(s, demo("sales"), "testAutomation", { draft })) as AutomationTestResult;
    expect(r.trigger).toBe("quote_idle");
    expect(r.preview).toHaveLength(2);
    const auto = (await s.list("automations")).find((a) => a.template === "instant-reply")!;
    const r2 = (await runAction(s, demo(), "testAutomation", { automationId: auto.id })) as AutomationTestResult;
    expect(r2.matches.length).toBeGreaterThan(0);
    expect(r2.matches.some((m) => m.alreadyRan)).toBe(true);
    expect(JSON.stringify(s.data)).toBe(before);
    const empty = new MemoryStore();
    await runAction(empty, demo(), "testAutomation", { draft });
    expect(empty.data.rows.settings ?? []).toHaveLength(0);
  });

  it("marketing funnel totals are internally consistent", async () => {
    for (const days of [7, 30, 90, 365]) {
      const f = (await runReport(s, demo(), "marketingFunnel", { days })) as MarketingFunnel;
      expect(f.range.days).toBe(days);
      const c = f.stages.map((x) => x.count);
      for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThanOrEqual(c[i - 1]!);
      expect(f.stages[0]!.count).toBe(f.totals.leads);
      expect(f.stages[3]!.count).toBe(f.totals.won);
      expect(f.channels.reduce((a, x) => a + x.leads, 0)).toBe(f.totals.leads);
      expect(f.channels.reduce((a, x) => a + x.won, 0)).toBe(f.totals.won);
      expect(f.channels.reduce((a, x) => a + x.revenue, 0)).toBe(f.totals.revenue);
      expect(f.channels.reduce((a, x) => a + x.spend, 0)).toBe(f.totals.spend);
      expect(f.weekly.reduce((a, x) => a + x.leads, 0)).toBe(f.totals.leads);
      expect(f.weekly.every((w) => new Date(`${w.week}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
      for (const ch of f.channels) expect(ch.contacted <= ch.leads && ch.quoted <= ch.contacted && ch.won <= ch.quoted).toBe(true);
      expect(f.insights.length).toBeLessThanOrEqual(5);
    }
    const f = (await runReport(s, demo(), "marketingFunnel", { days: 90 })) as MarketingFunnel;
    expect(f.totals.spend).toBeGreaterThan(0);
    expect(f.channels.find((x) => x.source === "meta_ads")!.cpl).toBeGreaterThan(0);
    expect(f.lostReasons.length).toBeGreaterThan(0);
    expect(f.landingPages.some((l) => l.leads > 0)).toBe(true);
    expect(f.insights.length).toBeGreaterThan(0);
    await expect(runReport(s, demo("sales"), "marketingFunnel", { days: 30 })).rejects.toMatchObject({ status: 403 });
    await expect(runReport(s, demo(), "marketingFunnel", { days: 12 })).rejects.toMatchObject({ status: 422 });
  });

  it("audience preview counts reachable contacts and estimates WhatsApp cost", async () => {
    const contacts = await s.list("contacts");
    const all = (await runReport(s, demo("marketing"), "audiencePreview", { channel: "whatsapp" })) as AudiencePreview;
    expect(all.count).toBe(contacts.length);
    expect(all.reachable).toBe(contacts.filter((c) => c.phone).length);
    expect(all.estCost).toBe(all.reachable * 86);
    const past = (await runReport(s, demo("marketing"), "audiencePreview", { channel: "email", rules: [{ field: "trips", op: "gte", value: "1" }] })) as AudiencePreview;
    expect(past.count).toBe(contacts.filter((c) => c.trips >= 1).length);
    expect(past.reachable).toBe(contacts.filter((c) => c.trips >= 1 && c.email).length);
    expect(past.estCost).toBe(0);
    expect(past.sample.length).toBeLessThanOrEqual(8);
    const seg = (await s.list("segments")).find((x) => x.name === "Past travellers")!;
    const bySeg = (await runReport(s, demo("marketing"), "audiencePreview", { segmentId: seg.id, channel: "whatsapp" })) as AudiencePreview;
    expect(bySeg.count).toBe(past.count);
  });

  it("public storefront enquiries trigger automations too", async () => {
    const copy = new MemoryStore(s.data);
    const before = (await copy.list("automationRuns")).length;
    await runPublicAction(copy, pub(), "storefrontEnquiry", { name: "Kiran Patel", phone: "+91 90000 33333", landingSlug: "bali-honeymoon" });
    const runs = await copy.list("automationRuns");
    expect(runs.length).toBe(before + 1);
    expect(runs.at(-1)).toMatchObject({ automationName: "Instant reply to every new enquiry", status: "done", subjectName: "Kiran Patel" });
  });
});
