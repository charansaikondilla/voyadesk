import { actions } from "./actions.js";
import { addDays, isoDate } from "./dates.js";
import { type Entity, type Input, type Role } from "./entities.js";
import { createRow, getSettings, patchRow, type Ctx, type Store } from "./store.js";
import { DEFAULT_GST_RULES, DEFAULT_TCS_RULES } from "./tax.js";
import { seedPlus } from "./plus/index.js";

/**
 * Realistic demo agency. Everything after the master data is created THROUGH the real
 * workflows (capture → quote → send → confirm → pay), so invoices, ledger, tasks and
 * reports are exactly what the product would produce. All people and businesses are fictional.
 */
const R = (rupees: number) => Math.round(rupees * 100);

export interface SeedResult {
  ownerId: string;
  agentUserId: string;
  agentId: string;
  driverUserId: string;
}

export async function seedDemo(store: Store, base: Date, tenantId = "demo"): Promise<SeedResult> {
  const at = (daysAgo: number, hour = 11, minute = 0) => {
    const today = isoDate(base);
    const d = new Date(`${addDays(today, -daysAgo)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
    return d.getTime() > base.getTime() ? base : d;
  };
  const sys = (now: Date, role: Role = "owner", userId = "seed", agentId: string | null = null): Ctx => ({ tenantId, userId, role, agentId, now });
  const t0 = at(200);
  const mk = <C extends Parameters<typeof createRow>[1]>(c: C, input: Input<C>) => createRow(store, c, input as never, t0) as Promise<Entity<C>>;

  /* Settings */
  const st = await getSettings(store, t0);
  await patchRow(store, "settings", st.id, {
    companyName: "Saffron Trails Holidays (Demo)", legalName: "Saffron Trails Holidays Pvt Ltd", gstin: "27AABCS1234D1Z5", pan: "AABCS1234D",
    state: "Maharashtra", address: "4th Floor, Demo Business Park, Andheri East, Mumbai 400069", phone: "+91 98200 00000", email: "hello@example.com",
    website: "www.example.com", businessTypes: ["b2c", "b2b_dmc", "portal", "visa"], defaultMarkupBps: 1200,
    modules: { sales: true, itinerary: true, operations: true, finance: true, marketing: true, b2b: true, visa: true, ai: true, portals: true },
    gateways: { razorpay: true, stripe: false, paypal: false }, integrations: { whatsapp: true, meta_ads: true, ivr: false },
    onboarding: { profile: true, tax: true, team: true, masters: true, firstQuote: true, payments: false },
  }, t0);
  for (const r of DEFAULT_GST_RULES) await mk("taxRules", { appliesTo: r.appliesTo, scope: r.scope, rateBps: r.rateBps, basis: r.basis, sac: r.sac, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, note: r.note });
  for (const r of DEFAULT_TCS_RULES) await mk("tcsRules", { effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, thresholdMinor: r.thresholdMinor, rateBelowBps: r.rateBelowBps, rateAboveBps: r.rateAboveBps, noPanRateBps: r.noPanRateBps, note: r.note });

  /* Team */
  const owner = await mk("users", { name: "Aarav Mehta", email: "owner@demo.travel", role: "owner", title: "Founder" });
  const priya = await mk("users", { name: "Priya Nair", email: "priya@demo.travel", role: "sales", title: "Senior travel consultant" });
  const rohan = await mk("users", { name: "Rohan Gupta", email: "rohan@demo.travel", role: "sales", title: "Travel consultant" });
  const kabir = await mk("users", { name: "Kabir Singh", email: "ops@demo.travel", role: "ops", title: "Operations lead" });
  await mk("users", { name: "Neha Joshi", email: "accounts@demo.travel", role: "accounts", title: "Accounts" });
  const sana = await mk("users", { name: "Sana Khan", email: "visa@demo.travel", role: "visa", title: "Visa executive" });
  await mk("users", { name: "Ishaan Rao", email: "marketing@demo.travel", role: "marketing", title: "Growth marketer" });

  /* Suppliers and masters */
  const supGoa = await mk("suppliers", { name: "Sea Breeze Resorts", category: "hotel", city: "Goa", country: "India", email: "res@seabreeze.example", paymentTermsDays: 7 });
  const supGoaCab = await mk("suppliers", { name: "Coastal Cabs", category: "transfer", city: "Goa", country: "India", paymentTermsDays: 3 });
  const supDxb = await mk("suppliers", { name: "Desert Sands DMC", category: "dmc", city: "Dubai", country: "UAE", paymentTermsDays: 10 });
  const supBali = await mk("suppliers", { name: "Island Spirit DMC", category: "dmc", city: "Bali", country: "Indonesia", paymentTermsDays: 10 });
  const supKerala = await mk("suppliers", { name: "Backwater Retreats", category: "hotel", city: "Kerala", country: "India", paymentTermsDays: 7 });
  const supManali = await mk("suppliers", { name: "Pine Valley Stays", category: "hotel", city: "Manali", country: "India", paymentTermsDays: 5 });
  const supPhuket = await mk("suppliers", { name: "Andaman Coast DMC", category: "dmc", city: "Phuket", country: "Thailand", paymentTermsDays: 10 });

  const hotels: [string, string, string, number, string, string, number, string][] = [
    ["Sea Breeze Resort", "Goa", "India", 4, supGoa.id, "Deluxe Sea View", 4500, "INR"],
    ["Palm Crest Hotel", "Dubai", "UAE", 4, supDxb.id, "Superior Room", 450, "AED"],
    ["Ubud Garden Villas", "Bali", "Indonesia", 5, supBali.id, "Pool Villa", 85, "USD"],
    ["Backwater Bliss Resort", "Kerala", "India", 4, supKerala.id, "Lake View Cottage", 6500, "INR"],
    ["Pine Valley Lodge", "Manali", "India", 3, supManali.id, "Mountain View Room", 3800, "INR"],
    ["Andaman Bay Hotel", "Phuket", "Thailand", 4, supPhuket.id, "Deluxe Pool Access", 2800, "THB"],
  ];
  for (const [name, city, country, stars, supplierId, roomType, rate, currency] of hotels) {
    await mk("hotels", { name, city, country, stars, supplierId, description: `${stars}-star property in ${city}.`, rates: [
      { roomType, mealPlan: "CP", season: "regular", netPerNight: R(rate), currency },
      { roomType, mealPlan: "MAP", season: "peak", netPerNight: R(Math.round(rate * 1.35)), currency },
    ] });
  }
  const sights: [string, string, string, number, number, string, string][] = [
    ["North Goa sightseeing tour", "Goa", "India", 8, 900, "INR", supGoaCab.id], ["Sunset river cruise", "Goa", "India", 2, 1200, "INR", supGoa.id],
    ["Desert safari with BBQ dinner", "Dubai", "UAE", 6, 150, "AED", supDxb.id], ["Burj Khalifa observation deck", "Dubai", "UAE", 2, 170, "AED", supDxb.id],
    ["Ubud temples & rice terraces", "Bali", "Indonesia", 8, 30, "USD", supBali.id], ["Nusa Penida day trip", "Bali", "Indonesia", 10, 55, "USD", supBali.id],
    ["Houseboat day cruise", "Kerala", "India", 6, 3000, "INR", supKerala.id], ["Solang Valley excursion", "Manali", "India", 6, 1200, "INR", supManali.id],
    ["Phi Phi islands speedboat", "Phuket", "Thailand", 9, 1800, "THB", supPhuket.id],
  ];
  for (const [name, city, country, durationHours, cost, currency, supplierId] of sights) await mk("sightseeing", { name, city, country, durationHours, netPerPerson: R(cost), currency, supplierId });
  const transfers: [string, string, string, string, number, number, string, string][] = [
    ["Goa airport sedan", "Goa", "India", "Sedan", 3, 1800, "INR", supGoaCab.id], ["Dubai airport SUV", "Dubai", "UAE", "SUV", 5, 220, "AED", supDxb.id],
    ["Bali airport van", "Bali", "Indonesia", "Van", 6, 35, "USD", supBali.id], ["Kochi airport sedan", "Kerala", "India", "Sedan", 3, 2500, "INR", supKerala.id],
    ["Bhuntar airport Innova", "Manali", "India", "Innova", 6, 3500, "INR", supManali.id], ["Phuket airport van", "Phuket", "Thailand", "Van", 8, 1200, "THB", supPhuket.id],
  ];
  for (const [name, city, country, vehicle, capacity, cost, currency, supplierId] of transfers) await mk("transfers", { name, city, country, vehicle, capacity, netPerVehicle: R(cost), currency, supplierId });

  const day = (title: string, description: string) => ({ title, description });
  const pkgs = [
    { name: "Goa Beach Escape", destination: "Goa", country: "India", nights: 4, theme: "leisure", scope: "domestic" as const, startingPrice: R(18_500), highlights: ["Sea-view resort", "North Goa tour", "Sunset cruise"],
      days: [day("Arrive in Goa", "Airport pickup and check-in at Sea Breeze Resort."), day("North Goa tour", "Forts, beaches and Anjuna flea market."), day("Leisure day", "Beach time or optional water sports."), day("Sunset cruise", "Evening Mandovi river cruise."), day("Departure", "Breakfast and airport drop.")] },
    { name: "Dubai Delight", destination: "Dubai", country: "UAE", nights: 5, theme: "family", scope: "overseas" as const, startingPrice: R(54_900), highlights: ["Desert safari", "Burj Khalifa", "Dhow cruise"],
      days: [day("Welcome to Dubai", "Airport pickup and hotel check-in."), day("City tour & Burj Khalifa", "Old Dubai souks, then the 124th-floor deck."), day("Desert safari", "Dune bashing, camel ride and BBQ dinner."), day("Leisure / shopping", "Dubai Mall and fountain show."), day("Abu Dhabi option", "Optional day trip."), day("Departure", "Airport drop.")] },
    { name: "Bali Honeymoon", destination: "Bali", country: "Indonesia", nights: 6, theme: "honeymoon", scope: "overseas" as const, startingPrice: R(68_000), highlights: ["Private pool villa", "Nusa Penida", "Candle-light dinner"],
      days: [day("Arrive in Bali", "Private transfer to Ubud villa."), day("Ubud tour", "Temples and rice terraces."), day("Spa day", "Balinese massage."), day("Nusa Penida", "Full-day island trip."), day("Leisure", "Beach clubs in Seminyak."), day("Romantic dinner", "Candle-light dinner by the beach."), day("Departure", "Airport drop.")] },
    { name: "Kerala Backwaters", destination: "Kerala", country: "India", nights: 5, theme: "family", scope: "domestic" as const, startingPrice: R(26_900), highlights: ["Houseboat cruise", "Tea gardens", "Lake cottage"],
      days: [day("Arrive in Kochi", "Transfer to the backwater resort."), day("Houseboat cruise", "Day cruise with Kerala lunch."), day("Munnar", "Tea gardens."), day("Leisure", "Ayurvedic spa."), day("Kochi heritage", "Fort Kochi walk."), day("Departure", "Airport drop.")] },
    { name: "Manali Snow Getaway", destination: "Manali", country: "India", nights: 4, theme: "adventure", scope: "domestic" as const, startingPrice: R(16_500), highlights: ["Solang Valley", "Mall Road", "Mountain lodge"],
      days: [day("Arrive in Manali", "Transfer and check-in."), day("Solang Valley", "Snow activities."), day("Local sights", "Hadimba temple, Old Manali."), day("Leisure", "Mall Road."), day("Departure", "Transfer to Bhuntar.")] },
    { name: "Phuket Island Hopper", destination: "Phuket", country: "Thailand", nights: 5, theme: "friends", scope: "overseas" as const, startingPrice: R(42_500), highlights: ["Phi Phi islands", "Patong nightlife", "Pool-access room"],
      days: [day("Arrive in Phuket", "Hotel transfer."), day("Phi Phi islands", "Speedboat day trip."), day("Leisure", "Beach day."), day("City tour", "Big Buddha and Old Town."), day("Leisure", "Shopping."), day("Departure", "Airport drop.")] },
  ];
  const packages: Entity<"packages">[] = [];
  for (const p of pkgs) packages.push(await mk("packages", { ...p, published: true, inclusions: ["Hotel stay with breakfast", "Private airport transfers", "Sightseeing as per itinerary", "All hotel taxes"], exclusions: ["Flights", "Lunch and dinner unless mentioned", "Personal expenses"] }));

  const visaMasters: [string, string, number, number, number, string, string[]][] = [
    ["UAE", "Tourist 30 days", 4, 6500, 1000, "60 days from issue", ["Passport front & back (6+ months validity)", "Passport-size photo (white background)", "Return flight ticket", "Hotel booking"]],
    ["Singapore", "Tourist", 5, 3200, 800, "Up to 2 years (multiple entry)", ["Passport (6+ months validity)", "Photo 35×45 mm matte", "Covering letter", "Last 3 months bank statement", "Flight & hotel booking"]],
    ["Schengen", "Short stay (C)", 15, 7600, 2500, "As granted", ["Passport (3+ months beyond return)", "Two photos 35×45 mm", "Travel insurance (€30,000 cover)", "6 months bank statement", "ITR for 3 years", "Leave letter / NOC", "Day-wise itinerary"]],
    ["Indonesia", "e-Visa on arrival", 3, 3000, 500, "30 days", ["Passport (6+ months validity)", "Photo", "Return ticket"]],
    ["United Kingdom", "Standard visitor", 21, 13500, 2500, "6 months", ["Passport", "Photo", "Bank statements (6 months)", "Employment letter", "ITR for 2 years", "Accommodation details"]],
  ];
  for (const [country, visaType, processingDays, fee, serviceFee, validity, checklist] of visaMasters) await mk("visaMasters", { country, visaType, processingDays, fee: R(fee), serviceFee: R(serviceFee), validity, checklist });

  /* B2B agents, field resources, routing, marketing */
  const agentA = await mk("agents", { name: "Wanderlust Partners", contactName: "Meera Iyer", email: "meera@wanderlust.example", phone: "+91 98111 22334", city: "Pune", slab: "gold", markupBps: 700, creditLimit: R(300_000), creditDays: 15, brandName: "Wanderlust Partners" });
  await mk("agents", { name: "Coastline Travels", contactName: "Vikram Shetty", email: "vikram@coastline.example", phone: "+91 98222 33445", city: "Mangaluru", slab: "silver", markupBps: 900, creditLimit: R(100_000), creditDays: 7 });
  await mk("agents", { name: "Metro Trip Planners", contactName: "Ritu Bansal", email: "ritu@metrotrip.example", phone: "+91 98333 44556", city: "Delhi", slab: "platinum", markupBps: 500, creditLimit: R(500_000), creditDays: 30 });
  const agentUser = await mk("users", { name: "Meera Iyer", email: "agent@demo.travel", role: "agent", agentId: agentA.id, title: "Partner agent" });

  const ramesh = await mk("resources", { kind: "driver", name: "Ramesh Yadav", phone: "+91 98765 11111", city: "Goa", details: "Sedan · 9 years experience" });
  await mk("resources", { kind: "driver", name: "Imran Shaikh", phone: "+971 50 000 1111", city: "Dubai", details: "SUV" });
  const anita = await mk("resources", { kind: "guide", name: "Anita D'Souza", phone: "+91 98765 22222", city: "Goa", details: "English, Hindi, Konkani" });
  await mk("resources", { kind: "vehicle", name: "Innova Crysta GA-07-AB-1234", city: "Goa", details: "7 seater" });
  const driverUser = await mk("users", { name: "Ramesh Yadav", email: "driver@demo.travel", phone: "+91 98765 11111", role: "driver", title: "Driver", resourceId: ramesh.id });

  await mk("routingRules", { name: "Overseas holidays", service: "holiday", destination: "Dubai", assigneeIds: [priya.id] });
  await mk("routingRules", { name: "Bali honeymoons", service: "holiday", destination: "Bali", assigneeIds: [priya.id] });
  await mk("routingRules", { name: "Visa desk", service: "visa", destination: "", assigneeIds: [sana.id] });
  await mk("routingRules", { name: "Everything else", service: "any", destination: "", assigneeIds: [rohan.id, priya.id] });

  await mk("coupons", { code: "FESTIVE10", kind: "percent", value: 1000, maxUses: 100 });
  await mk("coupons", { code: "WELCOME2000", kind: "flat", value: R(2000), maxUses: 0 });
  const segPast = await mk("segments", { name: "Past travellers", description: "Customers with at least one trip", rules: [{ field: "trips", op: "gte", value: "1" }] });
  const segDubai = await mk("segments", { name: "Dubai interest", description: "Anyone who enquired about Dubai", rules: [{ field: "destination", op: "contains", value: "dubai" }] });
  await mk("campaigns", { name: "Monsoon Kerala offer", channel: "whatsapp", segmentId: segPast.id, message: "Monsoon magic in Kerala! 5N backwaters from ₹26,900. Reply YES for details." });
  const diwali = await mk("campaigns", { name: "Diwali Dubai special", channel: "whatsapp", segmentId: segDubai.id, message: "Diwali in Dubai — 5N from ₹54,900 with desert safari. Use FESTIVE10 for 10% off.", leadCount: 3 });
  await mk("landingPages", { title: "Bali Honeymoon 2027", slug: "bali-honeymoon", packageId: packages[2]!.id, headline: "Your Bali honeymoon, planned end to end", body: "Private pool villa, Nusa Penida and a candle-light dinner.", published: true, leads: 0 });
  await mk("dripSequences", { name: "New lead nurture", trigger: "new_lead", steps: [{ afterDays: 0, channel: "whatsapp", message: "Thanks for your enquiry! Here are our best packages." }, { afterDays: 2, channel: "email", message: "Still planning? Here's a curated itinerary." }, { afterDays: 5, channel: "whatsapp", message: "Prices are filling fast for your dates — want us to hold a quote?" }] });
  await mk("dripSequences", { name: "Welcome back", trigger: "trip_completed", steps: [{ afterDays: 7, channel: "whatsapp", message: "Hope you loved the trip! Share a review and get ₹2,000 off your next one." }] });

  /* History: real workflows over the last ~6 months */
  const people: [string, string, string, number, number][] = [
    ["Ananya Sharma", "Goa", "+91 99000 10001", 2, 0], ["Rahul Verma", "Dubai", "+91 99000 10002", 4, 2], ["Sneha Kulkarni", "Bali", "+91 99000 10003", 2, 0],
    ["Arjun Reddy", "Kerala", "+91 99000 10004", 3, 1], ["Kavya Menon", "Manali", "+91 99000 10005", 2, 0], ["Vivek Malhotra", "Phuket", "+91 99000 10006", 4, 0],
    ["Pooja Desai", "Goa", "+91 99000 10007", 2, 1], ["Siddharth Rao", "Dubai", "+91 99000 10008", 2, 0], ["Nisha Agarwal", "Kerala", "+91 99000 10009", 2, 2],
    ["Karan Kapoor", "Bali", "+91 99000 10010", 2, 0], ["Meghna Pillai", "Goa", "+91 99000 10011", 5, 0], ["Aditya Jain", "Dubai", "+91 99000 10012", 2, 1],
  ];
  const sources = ["website", "whatsapp", "meta_ads", "referral", "walk_in", "ivr"] as const;
  const histDays = [168, 150, 128, 112, 95, 80, 66, 52, 40, 28, 18, 9];
  for (let k = 0; k < people.length; k++) {
    const [name, dest, phone, adults, children] = people[k]!;
    const d = histDays[k]!;
    const seller = dest === "Dubai" || dest === "Bali" ? priya : rohan;
    const c = sys(at(d, 10), "sales", seller.id);
    const travel = isoDate(new Date(at(d).getTime() + 21 * 86_400_000));
    const { lead } = await actions.captureLead.run(store, c, { name, phone, email: `${name.split(" ")[0]!.toLowerCase()}@example.com`, source: sources[k % sources.length]!, destination: dest, travelDate: travel, adults, children, budget: R(40_000 * adults) });
    await actions.logActivity.run(store, sys(at(d, 10, 6 + (k % 5) * 3), "sales", seller.id), { leadId: lead.id, kind: "call", body: "Discussed hotel preferences and budget.", direction: "out", durationSec: 240 });
    const quote = await actions.createQuoteFromLead.run(store, sys(at(d, 12), "sales", seller.id), { leadId: lead.id, packageId: null });
    if (k % 4 === 1) await actions.applyCoupon.run(store, sys(at(d, 12), "sales", seller.id), { quoteId: quote.id, code: "FESTIVE10" });
    if (k % 3 === 0) {
      const ins = quote.lines.find((l) => l.optional);
      if (ins) await actions.saveQuote.run(store, sys(at(d, 12), "sales", seller.id), { quoteId: quote.id, patch: { lines: quote.lines.map((l) => (l.id === ins.id ? { ...l, selected: true } : l)) } });
    }
    await actions.sendQuote.run(store, sys(at(d, 13), "sales", seller.id), { quoteId: quote.id, channel: "whatsapp" });
    const confirmCtx = sys(at(d - 2, 16), "sales", seller.id);
    const fresh = (await store.get("quotes", quote.id))!;
    const advance = Math.round(fresh.total / 2);
    const r = await actions.acceptQuote.run(store, confirmCtx, { quoteId: quote.id, payment: { amount: advance, method: k % 2 ? "upi" : "card", gateway: "razorpay", reference: `pay_demo_${k}` } });
    // Older trips: fully paid, services confirmed, completed
    if (d > 30) {
      const pay2 = sys(at(d - 9, 15), "accounts");
      const out = r.invoice.total - r.invoice.paid;
      if (out > 0) await actions.recordPayment.run(store, pay2, { invoiceId: r.invoice.id, amount: out, method: "bank_transfer", reference: `NEFT${1000 + k}` });
    }
    for (const sv of r.services) {
      if (d > 14 || k % 2 === 0) {
        await actions.updateServiceStatus.run(store, sys(at(d - 3, 12), "ops", kabir.id), { serviceId: sv.id, status: "confirmed", confirmationNo: `CNF${(k + 1) * 100 + sv.title.length}` });
        await actions.generateVoucher.run(store, sys(at(d - 3, 12), "ops", kabir.id), { serviceId: sv.id });
      }
    }
    if (d > 45) {
      await actions.updateBookingStatus.run(store, sys(at(d - 30, 9), "ops", kabir.id), { bookingId: r.booking.id, status: "completed" });
    }
    if (d > 60) {
      for (const bill of (await store.list("supplierBills")).filter((b) => b.bookingId === r.booking.id)) {
        await actions.paySupplierBill.run(store, sys(at(d - 20, 12), "accounts"), { billId: bill.id, amount: bill.amount, method: "bank_transfer" });
      }
    }
  }

  // Upcoming Goa trip with a driver and guide assigned
  {
    const c = sys(at(6, 10), "sales", rohan.id);
    const travel = isoDate(new Date(base.getTime() + 2 * 86_400_000));
    const { lead } = await actions.captureLead.run(store, c, { name: "Farhan Qureshi", phone: "+91 99000 20001", email: "farhan@example.com", source: "repeat", destination: "Goa", travelDate: travel, nights: 3, adults: 2, budget: R(60_000) });
    const q = await actions.createQuoteFromLead.run(store, c, { leadId: lead.id });
    await actions.sendQuote.run(store, c, { quoteId: q.id, channel: "email" });
    const fresh = (await store.get("quotes", q.id))!;
    const r = await actions.acceptQuote.run(store, sys(at(5, 11), "sales", rohan.id), { quoteId: q.id, payment: { amount: fresh.total, method: "upi", gateway: "razorpay", reference: "pay_demo_goa" } });
    const opsCtx = sys(at(1, 12), "ops", kabir.id);
    for (const sv of r.services) {
      await actions.updateServiceStatus.run(store, opsCtx, { serviceId: sv.id, status: "confirmed", confirmationNo: `SB${sv.title.length}77` });
      await actions.generateVoucher.run(store, opsCtx, { serviceId: sv.id });
      if (sv.type === "transfer") await actions.assignResource.run(store, opsCtx, { serviceId: sv.id, resourceId: ramesh.id, notifiedVia: "whatsapp" });
      if (sv.type === "sightseeing") await actions.assignResource.run(store, opsCtx, { serviceId: sv.id, resourceId: anita.id, notifiedVia: "app" });
    }
  }

  // Open pipeline in every stage
  const open: [string, string, string, number, number, string, number][] = [
    ["Tanvi Bhatt", "Bali", "whatsapp", 2, 0, "honeymoon in Bali early next month, budget 1.5L", 0],
    ["Manish Tiwari", "Dubai", "meta_ads", 4, 2, "family trip", 1],
    ["Gauri Patil", "Kerala", "website", 2, 0, "anniversary trip", 3],
    ["Harsh Vardhan", "Manali", "ivr", 6, 0, "friends group", 2],
    ["Lakshmi Iyer", "Phuket", "landing_page", 2, 0, "first international trip", 4],
    ["Deepak Saini", "Goa", "walk_in", 2, 2, "school holidays", 1],
  ];
  for (let k = 0; k < open.length; k++) {
    const [name, dest, source, adults, children, notes, daysAgo] = open[k]!;
    const c = sys(at(daysAgo, 9 + k), "sales", dest === "Dubai" || dest === "Bali" ? priya.id : rohan.id);
    const travel = isoDate(new Date(base.getTime() + (20 + k * 9) * 86_400_000));
    const { lead } = await actions.captureLead.run(store, c, { name, phone: `+91 99000 3000${k}`, email: k % 2 ? "" : `${name.split(" ")[0]!.toLowerCase()}@example.com`, source: source as never, destination: dest, travelDate: travel, adults, children, budget: R(35_000 * adults), notes });
    if (k >= 1) await actions.logActivity.run(store, sys(at(daysAgo, 9 + k, 11 + k * 2), "sales", c.userId), { leadId: lead.id, kind: "whatsapp", body: "Shared sample itineraries; customer comparing options.", direction: "out" });
    if (k >= 2) {
      const q = await actions.createQuoteFromLead.run(store, c, { leadId: lead.id });
      await actions.sendQuote.run(store, c, { quoteId: q.id, channel: "whatsapp" });
      if (k === 2 || k === 4) {
        const sent = (await store.get("quotes", q.id))!;
        await patchRow(store, "quotes", q.id, { status: "viewed", views: 3 }, c.now);
        void sent;
      }
      if (k === 3) await actions.updateLeadStage.run(store, c, { leadId: lead.id, stage: "negotiation" });
    }
  }
  {
    const c = sys(at(25), "sales", rohan.id);
    const { lead } = await actions.captureLead.run(store, c, { name: "Suresh Pandey", phone: "+91 99000 40001", source: "meta_ads", destination: "Goa", adults: 2 });
    await actions.updateLeadStage.run(store, c, { leadId: lead.id, stage: "lost", lostReason: "Price — booked elsewhere" });
  }

  // B2B: agent tops up wallet and books on wallet; another booking on credit
  {
    const ac = sys(at(20, 11), "agent", agentUser.id, agentA.id);
    await actions.topUpWallet.run(store, ac, { agentId: agentA.id, amount: R(150_000), method: "bank_transfer", reference: "NEFT-WL-001" });
    const q1 = await actions.agentCreateQuote.run(store, ac, { packageId: packages[0]!.id, startDate: isoDate(new Date(at(20).getTime() + 25 * 86_400_000)), adults: 2, children: 0, contactName: "Rajiv & Asha (Wanderlust client)" });
    await actions.agentBook.run(store, ac, { quoteId: q1.id, payBy: "wallet" });
    const ac2 = sys(at(8, 11), "agent", agentUser.id, agentA.id);
    const q2 = await actions.agentCreateQuote.run(store, ac2, { packageId: packages[4]!.id, startDate: isoDate(new Date(at(8).getTime() + 30 * 86_400_000)), adults: 4, children: 0, contactName: "College group (Wanderlust)" });
    await actions.agentBook.run(store, ac2, { quoteId: q2.id, payBy: "credit" });
    await actions.agentCreateQuote.run(store, sys(at(1, 15), "agent", agentUser.id, agentA.id), { packageId: packages[1]!.id, startDate: isoDate(new Date(base.getTime() + 40 * 86_400_000)), adults: 2, children: 1, contactName: "Kapoor family (Wanderlust)" });
  }

  // Visa desk
  {
    const v1 = await actions.createVisaCase.run(store, sys(at(12), "visa", sana.id), { contactName: "Rahul Verma", phone: "+91 99000 10002", country: "UAE", applicants: ["Rahul Verma", "Smita Verma"], travelDate: isoDate(new Date(base.getTime() + 15 * 86_400_000)) });
    const vc = (await store.get("visaCases", v1.id))!;
    for (let a = 0; a < vc.applicants.length; a++) for (const d of vc.applicants[a]!.docs) await actions.markVisaDoc.run(store, sys(at(10), "visa", sana.id), { caseId: vc.id, applicantIndex: a, docName: d.name, received: true });
    const done = (await store.get("visaCases", v1.id))!;
    await patchRow(store, "visaCases", done.id, { applicants: done.applicants.map((ap, i) => ({ ...ap, passportNo: `Z${4512300 + i}`, nationality: "IND" })) }, at(9));
    await actions.advanceVisaCase.run(store, sys(at(9), "visa", sana.id), { caseId: v1.id, status: "submitted" });
    await actions.advanceVisaCase.run(store, sys(at(4), "visa", sana.id), { caseId: v1.id, status: "approved", note: "e-Visa issued" });
    await actions.createVisaCase.run(store, sys(at(3), "visa", sana.id), { contactName: "Gauri Patil", phone: "+91 99000 30002", country: "Schengen", applicants: ["Gauri Patil", "Nikhil Patil"], travelDate: isoDate(new Date(base.getTime() + 50 * 86_400_000)) });
    await actions.createVisaCase.run(store, sys(at(2), "agent", agentUser.id, agentA.id), { contactName: "Wanderlust client — Joseph", phone: "+91 98111 55667", country: "Singapore", applicants: ["Joseph Mathew"] });
  }

  // Inbox: WhatsApp bot handles a new enquiry and a booking-status question
  await actions.inboundMessage.run(store, sys(at(0, 8), "owner", owner.id), { channel: "whatsapp", from: "Ritika Saxena", phone: "+91 99000 50001", body: "Hi, 5N Dubai, 4 pax, 27 Jan, budget 2.4L. Need hotel near Dubai Mall" });
  await actions.inboundMessage.run(store, sys(at(0, 9), "owner", owner.id), { channel: "whatsapp", from: "Farhan Qureshi", phone: "+91 99000 20001", body: "What's my booking status?" });

  // Group departure and marketing results
  await mk("groupDepartures", { packageId: packages[4]!.id, name: "Manali Snow Getaway — group departure", departureDate: isoDate(new Date(base.getTime() + 45 * 86_400_000)), seats: 20, pricePerSeat: R(17_900), passengers: [
    { name: "Amit Shah", phone: "+91 99000 60001", room: "101", paid: true }, { name: "Ruchi Shah", phone: "+91 99000 60002", room: "101", paid: true },
    { name: "Dev Patel", phone: "+91 99000 60003", room: "102", paid: false },
  ] });
  await actions.sendCampaign.run(store, sys(at(15), "marketing"), { campaignId: diwali.id });
  for (const t of await store.list("tasks")) if (t.dueAt < at(3).toISOString() && !t.done) await patchRow(store, "tasks", t.id, { done: true }, base);

  await seedPlus(store, base, tenantId);

  return { ownerId: owner.id, agentUserId: agentUser.id, agentId: agentA.id, driverUserId: driverUser.id };
}
