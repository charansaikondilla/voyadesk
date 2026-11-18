/**
 * Ready-made automation recipes ("When → If → Then"), written from the floor of an Indian travel agency:
 * each one plugs a gap where a busy team member usually drops the ball.
 * Money values in conditions are in paise (₹3,00,000 = "30000000").
 */
import type { Role } from "../entities.js";
import type { AutomationTemplate } from "./growthTypes.js";

type Step = AutomationTemplate["automation"]["steps"][number];

const step = (s: Partial<Step> & Pick<Step, "kind">): Step => ({
  channel: "whatsapp", message: "", title: "", value: "", userId: null, dueInDays: 0, ...s,
});

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: "instant-reply",
    name: "Instant reply to every new enquiry",
    description: "The moment a website, Meta or Google lead arrives, send a warm WhatsApp so the customer knows a real person is on it.",
    category: "sales",
    why: "Form leads land at 11 pm or on a Sunday — by the time someone calls next morning the customer has already spoken to three other agents.",
    automation: {
      name: "Instant reply to every new enquiry",
      description: "WhatsApp within seconds for leads that didn't come in on WhatsApp (those already get the chat bot's reply).",
      trigger: "lead_created", days: 0,
      conditions: [{ field: "source", op: "neq", value: "whatsapp" }],
      steps: [
        step({ kind: "send_message", message: "Hi {name}! Thank you for your {destination} enquiry with {company}. {owner} from our team will call you shortly. To send you the best options, could you share your travel dates, number of travellers and a rough budget?" }),
      ],
    },
  },
  {
    key: "new-lead-not-called",
    name: "New lead still not called after a day",
    description: "If a lead is still in New after 24 hours, alert its owner and put a call at the top of their task list.",
    category: "sales",
    why: "New leads sit in 'New' because everyone assumes someone else has already called them.",
    automation: {
      name: "New lead still not called after a day",
      description: "Escalates leads nobody has touched for a day.",
      trigger: "lead_idle", days: 1,
      conditions: [{ field: "stage", op: "eq", value: "new" }],
      steps: [
        step({ kind: "notify_owner", message: "{name} ({destination}) has waited a full day without a call. Call now — every hour of delay cuts the chance of a booking." }),
        step({ kind: "create_task", title: "Call {name} — {destination} enquiry not answered for a day", dueInDays: 0 }),
      ],
    },
  },
  {
    key: "quote-follow-up",
    name: "Follow up quotes that get no answer",
    description: "Two days after a quote goes quiet, nudge the customer on WhatsApp with the link and remind the consultant to call.",
    category: "sales",
    why: "Quotes go out and nobody follows up — customers rarely say no, they simply go quiet and book with whoever calls back.",
    automation: {
      name: "Follow up quotes that get no answer",
      description: "Polite nudge plus a call task when a sent quote has had no response for 2 days.",
      trigger: "quote_idle", days: 2,
      conditions: [],
      steps: [
        step({ kind: "send_message", message: "Hi {name}, did you get a chance to look at your {destination} proposal? Rates for {date} keep moving, and I'm happy to change hotels or dates if needed. Here it is again: {link}" }),
        step({ kind: "create_task", title: "Call {name} about the {destination} quote ({amount})", dueInDays: 0 }),
      ],
    },
  },
  {
    key: "viewed-not-paid",
    name: "Customer opened the proposal but hasn't paid",
    description: "When a customer has opened the proposal but not confirmed for a day, offer to hold it and tell the consultant to call while interest is high.",
    category: "sales",
    why: "The customer opens the proposal three times at night and nobody notices that this is the moment they are ready to book.",
    automation: {
      name: "Customer opened the proposal but hasn't paid",
      description: "Hot-intent follow-up for viewed proposals.",
      trigger: "quote_idle", days: 1,
      conditions: [{ field: "status", op: "eq", value: "viewed" }],
      steps: [
        step({ kind: "send_message", message: "Hi {name}, I saw you had a look at your {destination} proposal. Shall I lock it for you? You can confirm with a small advance, or hold the price for 48 hours, right here: {link}" }),
        step({ kind: "notify_owner", message: "{name} opened the {destination} proposal ({amount}) but hasn't paid yet. Call today while they're interested." }),
      ],
    },
  },
  {
    key: "hot-high-budget",
    name: "High-budget enquiry: call within 15 minutes",
    description: "Enquiries with a budget of ₹3 lakh or more are marked hot and the owner gets an urgent call task.",
    category: "sales",
    why: "A ₹4 lakh family holiday lands in the same queue as a ₹15,000 Goa weekend and waits its turn.",
    automation: {
      name: "High-budget enquiry: call within 15 minutes",
      description: "Fast lane for big-ticket leads (budget ₹3,00,000+).",
      trigger: "lead_created", days: 0,
      conditions: [{ field: "budget", op: "gte", value: "30000000" }],
      steps: [
        step({ kind: "set_temperature", value: "hot" }),
        step({ kind: "notify_owner", message: "High-value enquiry: {name}, {destination}, budget {amount}. Call within 15 minutes." }),
        step({ kind: "create_task", title: "Call {name} now — {amount} {destination} enquiry", dueInDays: 0 }),
      ],
    },
  },
  {
    key: "owner-for-every-lead",
    name: "Every new lead gets an owner",
    description: "If a new lead has no owner (or its owner has left), share it round-robin among the sales team.",
    category: "sales",
    why: "When routing misses a destination or the consultant has left, the lead belongs to nobody — and nobody calls.",
    automation: {
      name: "Every new lead gets an owner",
      description: "Round-robin safety net for unassigned leads.",
      trigger: "lead_created", days: 0,
      conditions: [],
      steps: [step({ kind: "assign_owner", userId: null })],
    },
  },
  {
    key: "collect-after-confirmation",
    name: "Collect the balance right after confirmation",
    description: "As soon as a quote is accepted, send a payment link for whatever is still due.",
    category: "payments",
    why: "The customer says yes on the phone and the payment link goes out two days later, after the hotel has released the rooms.",
    automation: {
      name: "Collect the balance right after confirmation",
      description: "Payment link for the outstanding amount when a quote is accepted (skipped if fully paid).",
      trigger: "quote_accepted", days: 0,
      conditions: [],
      steps: [
        step({ kind: "send_payment_link", message: "Thank you for confirming your {destination} holiday, {name}! To lock the hotels and flights, please pay {amount} here: {link}" }),
      ],
    },
  },
  {
    key: "balance-before-departure",
    name: "Balance reminder 7 days before departure",
    description: "A week before travel, send a payment link for the balance and give the owner a task to confirm it's in.",
    category: "payments",
    why: "Accounts remembers the balance two days before departure, when the customer is packing and the supplier is already chasing us.",
    automation: {
      name: "Balance reminder 7 days before departure",
      description: "Pay link for the outstanding balance one week before the trip starts.",
      trigger: "trip_upcoming", days: 7,
      conditions: [],
      steps: [
        step({ kind: "send_payment_link", message: "Hi {name}, your {destination} trip starts on {date}! The balance of {amount} is due before departure — you can pay by UPI, card or EMI here: {link}" }),
        step({ kind: "create_task", title: "Confirm {name} has paid the balance before travel on {date}", dueInDays: 2 }),
      ],
    },
  },
  {
    key: "overdue-invoice",
    name: "Chase overdue payments politely",
    description: "One day after the due date, send a gentle reminder with a fresh payment link and alert the owner.",
    category: "payments",
    why: "Nobody likes asking a customer for money, so overdue balances sit quietly until the supplier deadline.",
    automation: {
      name: "Chase overdue payments politely",
      description: "Reminder with a pay link for customer invoices overdue by a day.",
      trigger: "invoice_overdue", days: 1,
      conditions: [],
      steps: [
        step({ kind: "send_payment_link", message: "Hi {name}, a gentle reminder that {amount} was due on {date}. You can pay securely by UPI, card or EMI here: {link}. Please ignore this if you've already paid." }),
        step({ kind: "notify_owner", message: "{name}'s payment of {amount} is overdue since {date}. Please call if it isn't in by tomorrow." }),
      ],
    },
  },
  {
    key: "payment-tell-ops",
    name: "Payment received → tell operations",
    description: "When money comes in, operations gets a task to confirm the services and issue vouchers — no WhatsApp forwarding needed.",
    category: "operations",
    why: "Accounts records the payment but operations only finds out when the customer calls asking for vouchers.",
    automation: {
      name: "Payment received → tell operations",
      description: "Task for the operations team on every customer payment.",
      trigger: "payment_received", days: 0,
      conditions: [],
      steps: [step({ kind: "create_task", title: "Payment of {amount} received from {name} ({destination}) — confirm services and send vouchers", dueInDays: 0 })],
    },
  },
  {
    key: "review-after-trip",
    name: "Ask for a review after the trip",
    description: "Two days after the customer is back, thank them and ask for a review while the memories are fresh.",
    category: "marketing",
    why: "Happy customers are back at work by Monday and nobody remembers to ask them for the Google review.",
    automation: {
      name: "Ask for a review after the trip",
      description: "Welcome-back message with a review request, and a tag for future campaigns.",
      trigger: "trip_completed", days: 2,
      conditions: [],
      steps: [
        step({ kind: "send_message", message: "Welcome back, {name}! We hope {destination} was everything you wished for. Could you spare 30 seconds for a review? It means a lot to a small team like ours. Share your photos and see where to next: {link}" }),
        step({ kind: "add_tag", title: "past-traveller" }),
      ],
    },
  },
  {
    key: "welcome-back-next-trip",
    name: "Welcome back: plan the next holiday",
    description: "Six weeks after a trip, invite the customer to plan their next one with a returning-traveller offer.",
    category: "marketing",
    why: "We spend lakhs on ads for strangers and never call the customers who already trust us.",
    automation: {
      name: "Welcome back: plan the next holiday",
      description: "Repeat-business nudge 45 days after the trip ends.",
      trigger: "trip_completed", days: 45,
      conditions: [],
      steps: [
        step({ kind: "send_message", message: "Hi {name}, it's been a few weeks since {destination}! Planning your next break? As a returning traveller you get ₹2,000 off with code WELCOME2000 — just reply with where you'd like to go next." }),
        step({ kind: "add_tag", title: "repeat-prospect" }),
      ],
    },
  },
  {
    key: "visa-docs-chase",
    name: "Chase missing visa documents",
    description: "When a visa file is waiting for documents, the visa executive gets a task to check and chase in two days.",
    category: "visa",
    why: "The upload link goes out, the customer forgets, and we discover the missing bank statement a week before the appointment.",
    automation: {
      name: "Chase missing visa documents",
      description: "Follow-up task when a visa case moves to 'documents pending'.",
      trigger: "visa_status_changed", days: 0,
      conditions: [{ field: "status", op: "eq", value: "docs_pending" }],
      steps: [step({ kind: "create_task", title: "Chase {name} for pending {destination} visa documents", dueInDays: 2 })],
    },
  },
  {
    key: "visa-rejected-call",
    name: "Visa rejected: call the customer today",
    description: "A rejection is bad news with a booking attached — make sure the owner calls the same day.",
    category: "visa",
    why: "The rejection update goes out automatically and the customer is left alone with the bad news and a non-refundable hotel.",
    automation: {
      name: "Visa rejected: call the customer today",
      description: "Same-day call for rejected visa cases.",
      trigger: "visa_status_changed", days: 0,
      conditions: [{ field: "status", op: "eq", value: "rejected" }],
      steps: [
        step({ kind: "notify_owner", message: "{name}'s {destination} visa was rejected. Call them today — offer a re-application or a visa-free alternative before they cancel." }),
        step({ kind: "add_tag", title: "visa-rejected" }),
      ],
    },
  },
];

/**
 * Who a recipe's task should go to when it's installed (instead of the record's owner), by step index.
 * The gallery shows "record owner"; installing picks the first active person with this role.
 */
export const TEMPLATE_ASSIGNEE_ROLES: Record<string, Record<number, Role[]>> = {
  "payment-tell-ops": { 0: ["ops", "owner", "admin"] },
};
