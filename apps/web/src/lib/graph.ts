import { useMemo } from "react";
import { canRead, type Collection, type Entity, type Role } from "@voyadesk/core";
import { useList } from "./hooks";
import { useSession } from "./session";

/**
 * The record graph: one place that knows how customers, enquiries, quotes, bookings, invoices and payments
 * connect, so every screen can show (and link to) the rest of the journey.
 *
 *   contact ──< lead ──< quote
 *                 └──── booking ── invoice ──< payment
 *   contact ──< visaCase · call · policy · file · outbox
 */
type Row<C extends Collection> = Entity<C>;

export interface Graph {
  contacts: Row<"contacts">[];
  leads: Row<"leads">[];
  quotes: Row<"quotes">[];
  bookings: Row<"bookings">[];
  invoices: Row<"invoices">[];
  payments: Row<"payments">[];
  ready: boolean;
  can: (c: Collection) => boolean;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Loads the linked collections the signed-in role may read (others stay empty). */
export function useGraph(enabled = true): Graph {
  const { user } = useSession();
  const role = (user?.role ?? "sales") as Role;
  const can = (c: Collection) => Boolean(user) && canRead(role, c);
  const contacts = useList("contacts", enabled && can("contacts"));
  const leads = useList("leads", enabled && can("leads"));
  const quotes = useList("quotes", enabled && can("quotes"));
  const bookings = useList("bookings", enabled && can("bookings"));
  const invoices = useList("invoices", enabled && can("invoices"));
  const payments = useList("payments", enabled && can("payments"));
  const parts = [[contacts, "contacts"], [leads, "leads"], [quotes, "quotes"], [bookings, "bookings"], [invoices, "invoices"], [payments, "payments"]] as const;
  const ready = parts.every(([q, c]) => !can(c) || q.data !== undefined || q.error !== null);
  return {
    contacts: contacts.data ?? [], leads: leads.data ?? [], quotes: quotes.data ?? [], bookings: bookings.data ?? [],
    invoices: invoices.data ?? [], payments: payments.data ?? [], ready, can,
  };
}

export interface Chain {
  contact: Row<"contacts"> | null;
  lead: Row<"leads"> | null;
  quotes: Row<"quotes">[];
  booking: Row<"bookings"> | null;
  invoice: Row<"invoices"> | null;
  payments: Row<"payments">[];
}

export type Anchor = { kind: "contact" | "lead" | "quote" | "booking" | "invoice"; id: string } | { kind: "visa"; contactId: string | null; phone: string; email: string };

/** Find the contact for a record that only carries name/phone/email (bookings, quotes, visa cases). */
function contactFor(g: Graph, lead: Row<"leads"> | null, phone: string, email: string): Row<"contacts"> | null {
  if (lead?.contactId) {
    const c = g.contacts.find((x) => x.id === lead.contactId);
    if (c) return c;
  }
  const p = norm(phone), e = lc(email);
  return g.contacts.find((c) => (p && norm(c.phone) === p) || (e && lc(c.email) === e)) ?? null;
}

/** Walk from any record to the whole journey it belongs to. */
export function resolveChain(g: Graph, a: Anchor): Chain {
  let contact: Row<"contacts"> | null = null;
  let lead: Row<"leads"> | null = null;
  let booking: Row<"bookings"> | null = null;
  let invoice: Row<"invoices"> | null = null;
  let quote: Row<"quotes"> | null = null;

  switch (a.kind) {
    case "contact":
      contact = g.contacts.find((c) => c.id === a.id) ?? null;
      // Most recent enquiry stands in for "the" journey of a customer
      lead = g.leads.filter((l) => l.contactId === a.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] ?? null;
      break;
    case "lead":
      lead = g.leads.find((l) => l.id === a.id) ?? null;
      break;
    case "quote":
      quote = g.quotes.find((q) => q.id === a.id) ?? null;
      lead = quote?.leadId ? g.leads.find((l) => l.id === quote!.leadId) ?? null : null;
      booking = quote?.bookingId ? g.bookings.find((b) => b.id === quote!.bookingId) ?? null : null;
      break;
    case "booking":
      booking = g.bookings.find((b) => b.id === a.id) ?? null;
      break;
    case "invoice":
      invoice = g.invoices.find((i) => i.id === a.id) ?? null;
      booking = invoice?.bookingId ? g.bookings.find((b) => b.id === invoice!.bookingId) ?? null : null;
      if (invoice?.partyType === "customer" && invoice.partyId) contact = g.contacts.find((c) => c.id === invoice!.partyId) ?? null;
      break;
    case "visa":
      contact = (a.contactId ? g.contacts.find((c) => c.id === a.contactId) : null) ?? contactFor(g, null, a.phone, a.email);
      if (contact) lead = g.leads.filter((l) => l.contactId === contact!.id && l.service === "visa").sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] ?? null;
      break;
  }

  if (booking && !lead && booking.leadId) lead = g.leads.find((l) => l.id === booking!.leadId) ?? null;
  if (lead && !booking && lead.bookingId) booking = g.bookings.find((b) => b.id === lead!.bookingId) ?? null;
  if (booking && !invoice && booking.invoiceId) invoice = g.invoices.find((i) => i.id === booking!.invoiceId) ?? null;
  if (!booking && quote?.bookingId) booking = g.bookings.find((b) => b.id === quote!.bookingId) ?? null;
  if (!contact) {
    const src = booking ?? quote ?? lead;
    contact = contactFor(g, lead, src?.phone ?? "", src?.email ?? "");
  }
  const quotes = lead
    ? g.quotes.filter((q) => q.leadId === lead!.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
    : quote ? [quote] : [];
  const payments = invoice ? g.payments.filter((p) => p.invoiceId === invoice!.id).sort((x, y) => (x.date < y.date ? 1 : -1)) : [];
  return { contact, lead, quotes, booking, invoice, payments };
}

export function useChain(a: Anchor | null): { chain: Chain | null; graph: Graph } {
  const graph = useGraph(a !== null);
  const key = a ? JSON.stringify(a) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chain = useMemo(() => (a && graph.ready ? resolveChain(graph, a) : null), [key, graph.ready, graph.contacts, graph.leads, graph.quotes, graph.bookings, graph.invoices, graph.payments]);
  return { chain, graph };
}

/** Everything that belongs to one customer, across all their enquiries and trips. */
export function customerRecords(g: Graph, contact: Row<"contacts">) {
  const p = norm(contact.phone), e = lc(contact.email);
  const sameParty = (phone: string, email: string) => (p !== "" && norm(phone) === p) || (e !== "" && lc(email) === e);
  const leads = g.leads.filter((l) => l.contactId === contact.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  const leadIds = new Set(leads.map((l) => l.id));
  const quotes = g.quotes.filter((q) => (q.leadId && leadIds.has(q.leadId)) || (!q.leadId && !q.agentId && sameParty(q.phone, q.email)))
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  const bookings = g.bookings.filter((b) => (b.leadId && leadIds.has(b.leadId)) || (!b.leadId && !b.agentId && sameParty(b.phone, b.email)))
    .sort((x, y) => (x.startDate < y.startDate ? 1 : -1));
  const bookingIds = new Set(bookings.map((b) => b.id));
  const invoices = g.invoices.filter((i) => (i.partyType === "customer" && i.partyId === contact.id) || (i.bookingId !== null && bookingIds.has(i.bookingId)))
    .sort((x, y) => (x.issueDate < y.issueDate ? 1 : -1));
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const payments = g.payments.filter((x) => (x.invoiceId !== null && invoiceIds.has(x.invoiceId)) || (x.partyType === "customer" && x.partyId === contact.id))
    .sort((x, y) => (x.date < y.date ? 1 : -1));
  const billed = invoices.filter((i) => i.status !== "cancelled").reduce((s, i) => s + i.total, 0);
  const due = invoices.filter((i) => i.status !== "cancelled").reduce((s, i) => s + Math.max(0, i.total - i.paid - i.credited), 0);
  const paidIn = payments.filter((x) => x.direction === "in").reduce((s, x) => s + x.amount, 0);
  return { leads, leadIds, quotes, bookings, bookingIds, invoices, payments, billed, due, paidIn, sameParty };
}
