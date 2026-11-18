/** Single source for the product's feature map (website, solutions pages, in-app setup guide). */
export interface Feature {
  name: string;
  desc: string;
  /** Where the feature lives in the app */
  path: string;
}

export interface FeatureGroup {
  key: string;
  name: string;
  tagline: string;
  features: Feature[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    key: "sales", name: "Sales & CRM", tagline: "Every enquiry in one pipeline, answered in minutes.",
    features: [
      { name: "Lead management", desc: "One pipeline for website, WhatsApp, Meta Ads, IVR, walk-in and agent enquiries — with duplicate detection.", path: "/app/leads" },
      { name: "Omni-channel capture", desc: "Leads arrive from forms, WhatsApp and Meta lead ads without manual typing.", path: "/app/inbox" },
      { name: "Auto-assignment rules", desc: "Route leads by service and destination with round-robin across your team.", path: "/app/settings?tab=routing" },
      { name: "Lead scoring", desc: "Transparent hot/warm/cold score with the reason for every point.", path: "/app/leads" },
      { name: "Sales pipeline board", desc: "Drag-free stage board with values, aging alerts and conversion metrics.", path: "/app/leads" },
      { name: "Tasks & reminders", desc: "Call-within-15-minutes task on every new lead; overdue alerts on the dashboard.", path: "/app/tasks" },
      { name: "Activity timeline", desc: "Calls, WhatsApp, emails, notes, proposal views and payments on one timeline.", path: "/app/leads" },
      { name: "Customer profiles", desc: "Passport, PAN, preferences, tags, trips and lifetime spend; duplicates merged by phone and email.", path: "/app/contacts" },
      { name: "Document library", desc: "Passport copies, visas and tickets stored per customer; customers upload from their own portal.", path: "/app/contacts" },
      { name: "Call tracking", desc: "IVR and SIM call logs land on the lead with recordings; missed calls create a call-back task.", path: "/app/calls" },
      { name: "Mobile app", desc: "Installable on Android, iPhone and desktop from the browser; store builds via the included Capacitor config.", path: "/app" },
    ],
  },
  {
    key: "itinerary", name: "Itinerary & quotations", tagline: "A priced, branded proposal in about a minute.",
    features: [
      { name: "Smart itinerary builder", desc: "Start from a package or auto-suggested hotels, transfers and sightseeing; edit day by day.", path: "/app/quotes" },
      { name: "Live costing", desc: "Cost + markup + GST + TCS recalculated on every change — overall or per component, per person or per unit.", path: "/app/quotes" },
      { name: "Multi-currency", desc: "AED, USD, THB, EUR supplier rates converted at frozen quote rates.", path: "/app/quotes" },
      { name: "Upsell options", desc: "Optional add-ons (insurance, upgrades) the customer can tick on the proposal.", path: "/app/quotes" },
      { name: "Pre-send check", desc: "Blocks quotes with missing dates, zero totals or below-cost pricing; warns about gaps.", path: "/app/quotes" },
      { name: "Web proposal + PDF", desc: "Mobile proposal link with Book Now and payment, plus a printable PDF.", path: "/app/quotes" },
      { name: "View tracking", desc: "See when the customer opens the proposal; versioning on every revision.", path: "/app/quotes" },
      { name: "Coupons", desc: "Apply promo codes with validity dates and usage limits — customers can apply them on the proposal too.", path: "/app/marketing?tab=coupons" },
      { name: "Option A / B / C", desc: "Side-by-side itinerary options, each with its own price; the customer picks one.", path: "/app/quotes" },
      { name: "Photos, Word & PDF", desc: "Day-by-day photos on the proposal; download as Word or PDF.", path: "/app/quotes" },
      { name: "EMI, pay later and payment links", desc: "Advance, full payment or EMI through your gateway, or hold the price and pay later.", path: "/app/finance/links" },
    ],
  },
  {
    key: "operations", name: "Operations & bookings", tagline: "A confirmed quote becomes a booking file — no re-typing.",
    features: [
      { name: "Booking files", desc: "One file per trip with services, suppliers, invoice, payments and history.", path: "/app/bookings" },
      { name: "Supplier confirmations", desc: "Track pending → requested → confirmed with confirmation numbers.", path: "/app/operations" },
      { name: "Vouchers", desc: "One-click branded vouchers for confirmed hotels, transfers and tours.", path: "/app/bookings" },
      { name: "Driver, guide & vehicle allocation", desc: "Assign resources with automatic double-booking detection.", path: "/app/operations" },
      { name: "Ops board", desc: "Arrivals, departures and every service for the next days in one view.", path: "/app/operations" },
      { name: "Group departures", desc: "Fixed departures with seats, passenger and rooming lists.", path: "/app/operations/groups" },
      { name: "Field app", desc: "Drivers and guides see their assignments and update status from the phone.", path: "/field" },
      { name: "Cancellations", desc: "Cancel with a charge; credit note and refund are posted automatically.", path: "/app/bookings" },
      { name: "Changes with approval", desc: "Post-sale changes show cost and margin impact and apply only after approval.", path: "/app/approvals" },
      { name: "Live inventory", desc: "Hotel allotments with rooms left per night; bookings and cancellations update it instantly.", path: "/app/inventory" },
      { name: "Driver live location", desc: "Drivers share their location from the field app; ops sees it on the booking.", path: "/field" },
    ],
  },
  {
    key: "finance", name: "Finance & accounts", tagline: "GST-ready invoices and books that always balance.",
    features: [
      { name: "One-click GST invoices", desc: "SAC codes, CGST/SGST/IGST split by place of supply, generated at confirmation.", path: "/app/finance/invoices" },
      { name: "TCS on overseas packages", desc: "Effective-dated rules — 2% flat from 1 April 2026 — with no-PAN handling.", path: "/app/finance/tax" },
      { name: "Payments & partial payments", desc: "UPI, card, net banking, wallet; advances and balances with status tracking.", path: "/app/finance/payments" },
      { name: "Credit notes & refunds", desc: "Refund to bank or wallet with an audit trail.", path: "/app/finance/invoices" },
      { name: "Supplier payables", desc: "Bills per supplier per booking with due dates and payments.", path: "/app/finance/payables" },
      { name: "Double-entry ledger", desc: "Every event posts a balanced transaction; trial balance on demand.", path: "/app/finance/ledger" },
      { name: "Aging & P&L", desc: "Receivables/payables aging and profit by file, destination, staff or agent.", path: "/app/reports" },
      { name: "Payment gateways", desc: "Razorpay, Stripe and PayPal payment links with signed webhooks that record payments automatically (sandbox in the demo).", path: "/app/settings?tab=integrations" },
      { name: "TCS across several PANs", desc: "Split an overseas package's TCS between family members' PANs.", path: "/app/finance/invoices" },
    ],
  },
  {
    key: "marketing", name: "Marketing & growth", tagline: "Bring past travellers back and turn ads into bookings.",
    features: [
      { name: "Segments", desc: "Audiences by trips, spend, city, tags, destination interest or lead temperature.", path: "/app/marketing" },
      { name: "WhatsApp & email campaigns", desc: "Broadcasts to segments with audience size and message-cost estimate; delivered through your connected provider.", path: "/app/marketing" },
      { name: "Drip sequences", desc: "Plan nurture steps after a new lead, a sent quote or a completed trip (sent through your connected WhatsApp/email provider).", path: "/app/marketing?tab=drips" },
      { name: "Landing pages", desc: "Offer pages that feed leads straight into the pipeline.", path: "/app/marketing?tab=landing" },
      { name: "Meta lead sync", desc: "Signed webhook for Facebook/Instagram lead forms.", path: "/app/settings?tab=integrations" },
      { name: "Coupon engine", desc: "Seasonal and welcome codes with limits.", path: "/app/marketing?tab=coupons" },
      { name: "Campaign ROI", desc: "Leads, bookings and revenue traced back to each campaign; send at the best hour for the audience.", path: "/app/ai?tab=insights" },
    ],
  },
  {
    key: "portals", name: "Websites & portals", tagline: "Your storefront, your agents' portal, your visa tracker.",
    features: [
      { name: "Holiday storefront (B2C)", desc: "Published packages and group departures with enquiry forms that create leads.", path: "/app/portals" },
      { name: "B2B agent portal", desc: "Agents build quotes at their slab price and book on wallet or credit.", path: "/app/portals" },
      { name: "Visa status tracker", desc: "Customers check visa progress with their file number and phone.", path: "/app/portals" },
      { name: "Flight booking engine", desc: "Search, price and book flights (Amadeus adapter included; sandbox fares in the demo).", path: "/app/engines" },
      { name: "Hotel booking engine", desc: "Your contracted hotels with live rooms-left and instant confirmation.", path: "/app/engines?tab=hotels" },
      { name: "Group (series) fares", desc: "Blocked seats sold online with live seat count and passenger lists.", path: "/app/inventory?tab=series" },
      { name: "Travel insurance", desc: "Plans priced by days and age, policies issued on payment, claims from the customer portal.", path: "/app/insurance" },
      { name: "Customer login", desc: "Travellers sign in with a one-time code to see trips, vouchers, invoices, visas and documents.", path: "/app/portals" },
      { name: "Three languages", desc: "Website, proposals and portal in English, Hindi and Arabic.", path: "/app/portals" },
    ],
  },
  {
    key: "b2b", name: "B2B / DMC", tagline: "Credit control and agent pricing built in.",
    features: [
      { name: "Agent slabs & markups", desc: "Silver/gold/platinum markups applied automatically to agent quotes.", path: "/app/b2b" },
      { name: "Wallet & credit limits", desc: "Top-ups, credit limit checks and blocking overdue accounts.", path: "/app/b2b" },
      { name: "Agent ledger", desc: "Statements with running balance for every agent.", path: "/app/b2b" },
      { name: "Cost privacy", desc: "Agents never see supplier net costs — enforced on the server.", path: "/app/b2b" },
    ],
  },
  {
    key: "visa", name: "Visa desk", tagline: "From checklist to decision without the spreadsheet.",
    features: [
      { name: "Visa masters", desc: "Country checklists, fees and processing times.", path: "/app/masters?tab=visa" },
      { name: "Visa cases board", desc: "Docs pending → received → submitted → decision with auto notifications.", path: "/app/visa" },
      { name: "Passport scan", desc: "Reads the passport MRZ and verifies every check digit; warns on 6-month validity.", path: "/app/visa" },
      { name: "Customer status link", desc: "Customers see progress and exactly which documents are still missing — no login.", path: "/app/visa" },
      { name: "Secure upload link + ZIP", desc: "Applicants upload documents from their phone; download everything as one ZIP.", path: "/app/visa" },
    ],
  },
  {
    key: "ai", name: "AI & automation", tagline: "Let the system do the typing.",
    features: [
      { name: "AI quote generator", desc: "Paste \"5N Dubai, 4 pax, 27 Jan, 1.2L\" — get a scored lead and a priced draft quote.", path: "/app/ai" },
      { name: "WhatsApp & website bot", desc: "Answers enquiries and booking-status questions 24/7, suggests packages, then hands over to a person.", path: "/app/inbox" },
      { name: "AI follow-ups", desc: "Quiet leads, unopened proposals, money due and missing documents get a nudge automatically.", path: "/app/messages" },
      { name: "Email & PDF reader", desc: "Turns forwarded enquiry emails and supplier PDFs into leads, quotes and day plans.", path: "/app/ai?tab=import" },
      { name: "AI voice calls", desc: "A voice assistant calls leads, asks your questions and logs the answers.", path: "/app/calls" },
      { name: "Lead qualification", desc: "Ranks every open lead with reasons so the team calls the right people first.", path: "/app/ai" },
      { name: "Sales insights & forecast", desc: "Learned win chances, revenue forecast, rising destinations and what to launch next.", path: "/app/ai?tab=insights" },
    ],
  },
];

export interface BusinessType {
  key: "b2c" | "b2b-dmc" | "portals" | "visa";
  name: string;
  who: string;
  pitch: string;
  modules: string[];
  unique: string[];
  workflow: string[];
}

export const BUSINESS_TYPES: BusinessType[] = [
  {
    key: "b2c", name: "B2C travel agencies", who: "Agencies selling holidays directly to travellers.",
    pitch: "Answer every enquiry fast, send beautiful proposals, collect payments and bring customers back.",
    modules: ["Sales & CRM", "Itinerary & quotations", "Operations", "Finance", "Marketing", "Storefront"],
    unique: ["Owner dashboard with team performance", "Customer profiles with passport, PAN and preferences", "Re-engagement campaigns for past travellers", "Customer proposal page with Book Now and payment"],
    workflow: ["Lead arrives from WhatsApp, Meta Ads or website", "Auto-assigned and scored; call task created", "Quote built and sent as a link", "Customer accepts and pays an advance", "Booking file, invoice and supplier bills created", "Vouchers issued; trip runs; re-engagement drip starts"],
  },
  {
    key: "b2b-dmc", name: "B2B, DMCs & tour operators", who: "Operators selling through sub-agents and running ground services.",
    pitch: "Price by agent slab, control credit, and run hotels, transfers and guides without double bookings.",
    modules: ["Everything in B2C", "B2B agent portal", "Wallet & credit control", "Resource allocation", "Multi-currency"],
    unique: ["Agent slabs and markups", "Wallet top-ups and credit limits with automatic blocking", "Agent statements and ledgers", "Driver/guide/vehicle allocation with conflict checks", "Supplier payables by due date"],
    workflow: ["Agent builds a quote in the portal at their slab price", "Agent books on wallet or credit — limits checked", "Ops confirms suppliers and assigns drivers/guides", "Vouchers issued under your brand", "Agent ledger updated; overdue accounts blocked", "Supplier bills paid by due date"],
  },
  {
    key: "portals", name: "Travel portals", who: "Businesses selling online through B2C and B2B storefronts.",
    pitch: "Publish packages and departures, capture enquiries and connect booking engines.",
    modules: ["Storefront", "Agent portal", "Booking-engine adapters", "Coupons", "Payment gateways"],
    unique: ["Published packages and fixed departures", "Landing pages feeding the pipeline", "Adapters for flight and hotel APIs", "Coupons and promo engine"],
    workflow: ["Traveller browses packages on the storefront", "Enquiry or booking request creates a scored lead", "Quote and payment link sent", "Booking syncs to operations and finance", "Amendments and refunds via credit notes"],
  },
  {
    key: "visa", name: "Visa businesses", who: "Visa consultants and agencies with a visa desk.",
    pitch: "Checklists, passport scanning and status updates that keep customers informed.",
    modules: ["Visa desk", "Visa masters", "Customer tracker", "Finance"],
    unique: ["Country checklists, fees and processing times", "Passport MRZ scan with check-digit validation", "Submission blocked until documents are complete", "Customer status tracker by file number"],
    workflow: ["Enquiry → visa case with country checklist and fee", "Status link shared with the customer", "Documents ticked off; passport scanned", "Submitted once complete; a status update is queued at every step", "Approved or rejected with reason shared"],
  },
];

export const INTEGRATIONS: { name: string; kind: string; status: "built-in" | "adapter" }[] = [
  { name: "WhatsApp Business API", kind: "Messaging", status: "adapter" },
  { name: "Meta lead ads", kind: "Lead capture", status: "adapter" },
  { name: "Website & landing forms", kind: "Lead capture", status: "built-in" },
  { name: "Razorpay", kind: "Payments", status: "adapter" },
  { name: "Stripe", kind: "Payments", status: "adapter" },
  { name: "PayPal", kind: "Payments", status: "adapter" },
  { name: "Amadeus flights (GDS)", kind: "Booking engine", status: "adapter" },
  { name: "Hotel allotments", kind: "Booking engine", status: "built-in" },
  { name: "Exotel IVR & voice bot", kind: "Telephony", status: "adapter" },
  { name: "SMTP email", kind: "Messaging", status: "adapter" },
  { name: "Claude (AI)", kind: "AI", status: "adapter" },
  { name: "Passport MRZ reader", kind: "Visa", status: "built-in" },
  { name: "GST & TCS engine", kind: "Compliance", status: "built-in" },
  { name: "Currency rates", kind: "Finance", status: "built-in" },
];
