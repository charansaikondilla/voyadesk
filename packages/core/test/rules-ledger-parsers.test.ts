import { describe, expect, it } from "vitest";
import {
  accountBalance, aging, assertTransition, buildTxn, canTransition, financialYear, findConflicts, invoiceLegs, LEAD_FLOW,
  mrzCheckDigit, parseEnquiry, parseMrz, paymentLegs, QUOTE_FLOW, scoreLead, statement, trialBalance, VISA_FLOW,
  type LedgerEntry,
} from "../src/index.js";

let n = 0;
const meta = (refId: string) => ({ txnId: `t${refId}`, date: "2026-11-15", memo: refId, refType: "test", refId, newId: () => `e${++n}` });

describe("double-entry ledger", () => {
  it("only accepts balanced transactions", () => {
    expect(() => buildTxn([{ account: "bank", debit: 100 }, { account: "revenue", credit: 99 }], meta("x"))).toThrow(/Unbalanced/);
    expect(() => buildTxn([{ account: "bank", debit: -5 }, { account: "revenue", credit: -5 }], meta("y"))).toThrow(/negative/);
    expect(buildTxn([{ account: "bank", debit: 100 }, { account: "revenue", credit: 100 }], meta("z"))).toHaveLength(2);
  });

  it("tracks a customer's balance through invoice and payment", () => {
    const party = { type: "customer" as const, id: "c1", name: "Asha" };
    const entries: LedgerEntry[] = [
      ...buildTxn(invoiceLegs({ party, sell: 10_000, gst: 500, tcs: 210 }), meta("inv")),
      ...buildTxn(paymentLegs({ party, amount: 4_000, fromWallet: false }), meta("pay")),
    ];
    expect(accountBalance(entries, "receivable", { type: "customer", id: "c1" })).toBe(6_710);
    expect(accountBalance(entries, "gst_output")).toBe(500);
    expect(accountBalance(entries, "tcs_payable")).toBe(210);
    expect(trialBalance(entries).balanced).toBe(true);
    const st = statement(entries, "receivable", { type: "customer", id: "c1" });
    expect(st.at(-1)?.balance).toBe(6_710);
  });
});

describe("status machines", () => {
  it("allows only defined transitions", () => {
    expect(canTransition(LEAD_FLOW, "new", "contacted")).toBe(true);
    expect(canTransition(LEAD_FLOW, "won", "lost")).toBe(false);
    expect(canTransition(QUOTE_FLOW, "draft", "accepted")).toBe(false);
    expect(() => assertTransition(VISA_FLOW, "docs_pending", "approved", "Visa case")).toThrow(/cannot move/);
  });
});

describe("resource conflicts", () => {
  const existing = [{ id: "a1", resourceId: "drv", from: "2026-12-01", to: "2026-12-03", serviceId: "s1" }];
  it("detects overlapping dates for the same driver", () => {
    expect(findConflicts(existing, { resourceId: "drv", from: "2026-12-03", to: "2026-12-04", serviceId: "s2" })).toHaveLength(1);
    expect(findConflicts(existing, { resourceId: "drv", from: "2026-12-04", to: "2026-12-05", serviceId: "s2" })).toHaveLength(0);
    expect(findConflicts(existing, { resourceId: "other", from: "2026-12-02", to: "2026-12-02", serviceId: "s2" })).toHaveLength(0);
  });
  it("rejects an end date before the start date", () => {
    expect(() => findConflicts(existing, { resourceId: "drv", from: "2026-12-05", to: "2026-12-01", serviceId: "s3" })).toThrow();
  });
});

describe("lead scoring and aging", () => {
  it("scores a near-term, well-qualified referral as hot and explains why", () => {
    const r = scoreLead({ source: "referral", budget: 300_000_00, payingPax: 2, travelDate: "2026-12-10", destination: "Bali", phone: "9", email: "a@b.c", activityCount: 2, today: "2026-11-15" });
    expect(r.temperature).toBe("hot");
    expect(r.reasons.some((x) => x.includes("budget"))).toBe(true);
    const cold = scoreLead({ source: "other", budget: null, payingPax: 2, travelDate: null, destination: null, phone: null, email: null, activityCount: 0, today: "2026-11-15" });
    expect(cold.temperature).toBe("cold");
  });
  it("buckets receivables by days overdue", () => {
    const b = aging([
      { dueDate: "2026-11-20", outstanding: 100 }, { dueDate: "2026-11-01", outstanding: 200 },
      { dueDate: "2026-09-20", outstanding: 300 }, { dueDate: "2026-06-01", outstanding: 400 }, { dueDate: "2026-11-01", outstanding: 0 },
    ], "2026-11-15");
    expect(b).toEqual({ notDue: 100, d1_30: 200, d31_60: 300, d61_90: 0, d90plus: 400, total: 1000 });
  });
  it("knows Indian financial years", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });
});

describe("passport MRZ", () => {
  const SPECIMEN = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
  it("reads the ICAO 9303 specimen and verifies every check digit", () => {
    const r = parseMrz(SPECIMEN, new Date("2026-11-15"));
    expect(r.valid).toBe(true);
    expect(r).toMatchObject({ surname: "ERIKSSON", givenNames: "ANNA MARIA", passportNo: "L898902C3", nationality: "UTO", sex: "F", dob: "1974-08-12" });
    expect(mrzCheckDigit("L898902C3")).toBe(6);
  });
  it("flags a mistyped digit", () => {
    const bad = SPECIMEN.replace("7408122F", "7408132F");
    const r = parseMrz(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Date of birth/);
  });
});

describe("smart enquiry parser", () => {
  it('reads "5N Dubai, 4 pax, 27 Jan, 1.2L"', () => {
    const r = parseEnquiry("5N Dubai, 4 pax, 27 Jan, 1.2L", ["Dubai", "Bali"], "2026-11-15");
    expect(r).toMatchObject({ destination: "Dubai", nights: 5, adults: 4, travelDate: "2027-01-27", budget: 120_000_00 });
  });
  it("understands couples, children, stars and contact details", () => {
    const r = parseEnquiry("Honeymoon couple to Bali on 12th Feb for 6 nights, 5 star, budget ₹2,50,000. Call 9876543210 or a@x.in", ["Bali"], "2026-11-15");
    expect(r).toMatchObject({ destination: "Bali", adults: 2, nights: 6, hotelStars: 5, budget: 250_000_00, phone: "9876543210", email: "a@x.in", theme: "honeymoon" });
    expect(parseEnquiry("family of 4 with 2 kids, 3 days Goa", ["Goa"], "2026-11-15")).toMatchObject({ adults: 4, children: 2, nights: 2 });
  });
});
