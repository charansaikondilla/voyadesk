import { describe, expect, it } from "vitest";
import {
  allocate, applyBps, computeTcs, emptyLine, formatMoney, isValidGstin, isValidPan, parseMoney, priceQuote,
  resolveGst, roundHalfUp, splitGst, toMinor, type PricingInput,
} from "../src/index.js";

const R = (rupees: number) => rupees * 100;

function input(over: Partial<PricingInput>): PricingInput {
  return {
    lines: [], pax: { adults: 1, children: 0, infants: 0 }, currency: "INR", fx: {}, markupMode: "overall",
    packageMarkup: { kind: "percent", value: 0, per: "unit" }, taxBasis: "cost_plus_markup", gstRateBps: 500,
    discount: null, tcs: null, ...over,
  };
}

describe("money", () => {
  it("rounds half away from zero and avoids float noise", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(toMinor(1.005)).toBe(101);
    expect(toMinor(19.99)).toBe(1999);
    expect(applyBps(R(10_000), 500)).toBe(R(500));
  });
  it("parses Indian money shorthand", () => {
    expect(parseMoney("1.2L")).toBe(R(120_000));
    expect(parseMoney("₹ 1,20,000")).toBe(R(120_000));
    expect(parseMoney("45k")).toBe(R(45_000));
    expect(parseMoney("2.5 cr")).toBe(R(25_000_000));
    expect(parseMoney("abc")).toBeNull();
  });
  it("allocates without losing a paisa", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocate(7, [0, 0])).toEqual([4, 3]);
    expect(allocate(-10, [1, 1])).toEqual([-5, -5]);
  });
  it("formats rupees with Indian grouping", () => {
    expect(formatMoney(R(115_500))).toBe("₹1,15,500");
    expect(formatMoney(154_560)).toBe("₹1,545.60");
    expect(formatMoney(154_556)).toBe("₹1,545.56");
  });
});

describe("pricing engine — golden cases", () => {
  it("A: one hotel ₹10,000, overall 10% markup, 5% GST on cost+markup = ₹11,550", () => {
    const r = priceQuote(input({
      lines: [emptyLine({ id: "h", type: "hotel", title: "Hotel", netCost: R(10_000) })],
      packageMarkup: { kind: "percent", value: 1000, per: "unit" },
    }));
    expect(r.base).toBe(R(10_000));
    expect(r.markup).toBe(R(1_000));
    expect(r.gst).toBe(R(550));
    expect(r.total).toBe(R(11_550));
  });

  it("B: per-component markup (hotel 5%, transfer 15%), 5% GST on markup only = ₹12,840", () => {
    const r = priceQuote(input({
      markupMode: "per_component", taxBasis: "markup_only",
      lines: [
        emptyLine({ id: "h", type: "hotel", title: "Hotel", netCost: R(10_000), markup: { kind: "percent", value: 500, per: "unit" } }),
        emptyLine({ id: "t", type: "transfer", title: "Transfer", netCost: R(2_000), markup: { kind: "percent", value: 1500, per: "unit" } }),
      ],
    }));
    expect(r.lines.map((l) => l.markup)).toEqual([R(500), R(300)]);
    expect(r.lines.map((l) => l.gst)).toEqual([R(25), R(15)]);
    expect(r.total).toBe(R(12_840));
  });

  it("C: ₹1,00,000 package for 2, flat ₹5,000 per person, 5% GST = ₹1,15,500 (₹57,750 each)", () => {
    const r = priceQuote(input({
      pax: { adults: 2, children: 0, infants: 0 },
      lines: [emptyLine({ id: "p", type: "other", title: "Package", netCost: R(100_000) })],
      packageMarkup: { kind: "flat", value: R(5_000), per: "person" },
    }));
    expect(r.markup).toBe(R(10_000));
    expect(r.gst).toBe(R(5_500));
    expect(r.total).toBe(R(115_500));
    expect(r.perPerson).toBe(R(57_750));
  });
});

describe("pricing engine — behaviour", () => {
  const base = () => input({
    pax: { adults: 2, children: 1, infants: 1 },
    packageMarkup: { kind: "percent", value: 1200, per: "unit" },
    lines: [
      emptyLine({ id: "h", type: "hotel", title: "Hotel", netCost: R(4_500), quantity: 4 }),
      emptyLine({ id: "s", type: "sightseeing", title: "Tour", netCost: R(900), perPerson: true }),
      emptyLine({ id: "i", type: "insurance", title: "Insurance", netCost: R(900), perPerson: true, optional: true }),
    ],
  });

  it("counts adults + children as paying travellers, not infants", () => {
    const r = priceQuote(base());
    expect(r.payingPax).toBe(3);
    expect(r.lines.find((l) => l.id === "s")!.base).toBe(R(2_700));
  });

  it("excludes optional upsells unless the customer selects them", () => {
    const without = priceQuote(base());
    const withIns = priceQuote({ ...base(), lines: base().lines.map((l) => (l.id === "i" ? { ...l, selected: true } : l)) });
    expect(without.lines.find((l) => l.id === "i")!.included).toBe(false);
    expect(withIns.total).toBeGreaterThan(without.total);
    expect(withIns.base - without.base).toBe(R(2_700));
  });

  it("applies coupons before tax and never lets line amounts drift from totals", () => {
    const r = priceQuote({ ...base(), discount: { kind: "percent", value: 1000 } });
    const inc = r.lines.filter((l) => l.included);
    expect(inc.reduce((a, l) => a + l.sell, 0)).toBe(r.sell);
    expect(inc.reduce((a, l) => a + l.gst, 0)).toBe(r.gst);
    expect(r.discount).toBe(applyBps(r.base + r.markup, 1000));
    expect(r.total).toBe(r.sell + r.gst);
  });

  it("caps a flat discount at the selling price", () => {
    const r = priceQuote({ ...base(), discount: { kind: "flat", value: R(10_000_000) } });
    expect(r.sell).toBe(0);
    expect(r.margin).toBeLessThan(0);
  });

  it("converts foreign-currency costs with the quote's frozen rate", () => {
    const r = priceQuote(input({ fx: { AED: 22.9 }, lines: [emptyLine({ id: "h", type: "hotel", title: "Dubai", netCost: 45_000, currency: "AED", quantity: 2 })] }));
    expect(r.base).toBe(2 * Math.round(45_000 * 22.9));
    expect(() => priceQuote(input({ lines: [emptyLine({ id: "x", type: "hotel", title: "No rate", netCost: 100, currency: "USD" })] }))).toThrow(/exchange rate/);
  });

  it("supports per-line GST overrides for itemised billing", () => {
    const r = priceQuote(input({
      taxBasis: "markup_only", gstRateBps: 1800, packageMarkup: { kind: "percent", value: 1000, per: "unit" },
      lines: [emptyLine({ id: "f", type: "flight", title: "Flight", netCost: R(10_000), gstRateBps: 500 }), emptyLine({ id: "h", type: "hotel", title: "Hotel", netCost: R(10_000) })],
    }));
    expect(r.lines.map((l) => l.gst)).toEqual([R(50), R(180)]);
  });

  it("rejects bad input instead of producing a wrong price", () => {
    expect(() => priceQuote(input({ lines: [emptyLine({ id: "a", type: "hotel", title: "A", netCost: 10.5 })] }))).toThrow(/integer/);
    expect(() => priceQuote(input({ lines: [emptyLine({ id: "a", type: "hotel", title: "A", netCost: -1 })] }))).toThrow(/negative/);
    expect(() => priceQuote(input({ lines: [emptyLine({ id: "a", type: "hotel", title: "A", netCost: 1, quantity: 0 })] }))).toThrow(/Quantity/);
  });

  it("keeps line totals equal to quote totals for random quotes (property check)", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let t = 0; t < 300; t++) {
      const lines = Array.from({ length: 1 + rnd(6) }, (_, i) => emptyLine({
        id: `l${i}`, type: "hotel", title: `L${i}`, netCost: rnd(5_000_000), quantity: 1 + rnd(5), perPerson: rnd(2) === 1,
        optional: rnd(4) === 0, selected: rnd(2) === 1, markup: rnd(2) ? { kind: "percent", value: rnd(3000), per: "unit" } : null,
      }));
      const r = priceQuote(input({
        lines, pax: { adults: 1 + rnd(6), children: rnd(3), infants: 0 }, markupMode: rnd(2) ? "overall" : "per_component",
        packageMarkup: rnd(2) ? { kind: "percent", value: rnd(2500), per: "unit" } : { kind: "flat", value: rnd(500_000), per: rnd(2) ? "person" : "unit" },
        taxBasis: rnd(2) ? "cost_plus_markup" : "markup_only", discount: rnd(3) === 0 ? { kind: "percent", value: rnd(1500) } : null,
      }));
      const inc = r.lines.filter((l) => l.included);
      expect(inc.reduce((a, l) => a + l.total, 0)).toBe(r.sell + r.gst);
      expect(inc.reduce((a, l) => a + l.markup, 0)).toBe(r.markup);
      expect(Number.isInteger(r.total)).toBe(true);
    }
  });
});

describe("tax rules", () => {
  it("TCS on overseas packages is a flat 2% from 1 April 2026 (Finance Act 2026)", () => {
    const r = computeTcs({ amount: R(1_020_000), on: "2026-11-15", hasPan: true });
    expect(r.tcs).toBe(R(20_400));
    expect(r.ruleId).toBe("tcs_2026");
  });
  it("FY 2025-26 used 5% up to ₹10 lakh per FY, then 20%", () => {
    expect(computeTcs({ amount: R(800_000), on: "2025-06-01", hasPan: true }).tcs).toBe(R(40_000));
    // ₹6L already billed this FY: ₹4L at 5% + ₹2L at 20%
    expect(computeTcs({ amount: R(600_000), on: "2025-06-01", hasPan: true, priorFyAmount: R(600_000) }).tcs).toBe(R(20_000 + 40_000));
  });
  it("applies the higher rate when PAN is missing", () => {
    expect(computeTcs({ amount: R(100_000), on: "2026-11-15", hasPan: false }).tcs).toBe(R(5_000));
  });
  it("resolves the most specific GST rule in force", () => {
    expect(resolveGst("package", "overseas", "2026-11-15").rateBps).toBe(500);
    expect(resolveGst("flight", "domestic", "2026-11-15")).toMatchObject({ rateBps: 1800, basis: "markup_only" });
    expect(() => resolveGst("package", "domestic", "2010-01-01")).toThrow(/No GST rule/);
  });
  it("splits GST into CGST+SGST inside a state and IGST across states", () => {
    expect(splitGst(1001, "Maharashtra", "Maharashtra")).toEqual({ cgst: 500, sgst: 501, igst: 0 });
    expect(splitGst(1001, "Maharashtra", "Goa")).toEqual({ cgst: 0, sgst: 0, igst: 1001 });
  });
  it("validates GSTIN and PAN formats", () => {
    expect(isValidGstin("27AABCS1234D1Z5")).toBe(true);
    expect(isValidGstin("27AABCS1234D1Y5")).toBe(false);
    expect(isValidPan("AABCS1234D")).toBe(true);
    expect(isValidPan("AAB1234D")).toBe(false);
  });
  it("adds TCS on top of GST inside the pricing engine for overseas quotes", () => {
    const r = priceQuote(input({
      lines: [emptyLine({ id: "p", type: "other", title: "Dubai package", netCost: R(100_000) })],
      tcs: { on: "2026-11-15", hasPan: true, priorFyAmount: 0 },
    }));
    expect(r.gst).toBe(R(5_000));
    expect(r.tcs).toBe(R(2_100));
    expect(r.total).toBe(R(107_100));
  });
});
