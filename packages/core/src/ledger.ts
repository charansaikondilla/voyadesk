import { allocate, assertInt, type Minor } from "./money.js";
import { type ISODate } from "./dates.js";

/**
 * Double-entry ledger. Every business event posts one balanced transaction:
 * total debits === total credits, enforced here and covered by tests.
 * Asset-type accounts (receivable, bank, cost_of_sales) grow with debits;
 * liability/income accounts (payable, wallet, revenue, gst_output, tcs_payable) grow with credits.
 */
export type AccountCode =
  | "receivable" // money customers/agents owe us
  | "bank" // cash and gateway settlements
  | "cost_of_sales" // supplier cost of what we sold
  | "payable" // money we owe suppliers
  | "wallet" // prepaid balances we hold for agents/customers
  | "revenue" // sell value excluding taxes
  | "gst_output" // GST collected, owed to government
  | "tcs_payable"; // TCS collected, owed to government

export type PartyType = "customer" | "agent" | "supplier";

export interface LedgerEntry {
  id: string;
  txnId: string;
  date: ISODate;
  account: AccountCode;
  partyType: PartyType | null;
  partyId: string | null;
  partyName: string | null;
  debit: Minor;
  credit: Minor;
  memo: string;
  refType: string;
  refId: string;
}

export interface Leg {
  account: AccountCode;
  debit?: Minor;
  credit?: Minor;
  party?: { type: PartyType; id: string | null; name: string } | null;
}

const DEBIT_NORMAL: ReadonlySet<AccountCode> = new Set(["receivable", "bank", "cost_of_sales"]);

/** Build a balanced transaction; throws if it does not balance or a leg is malformed. */
export function buildTxn(
  legs: Leg[],
  meta: { txnId: string; date: ISODate; memo: string; refType: string; refId: string; newId: () => string },
): LedgerEntry[] {
  const kept = legs.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  let dr = 0;
  let cr = 0;
  for (const l of kept) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    assertInt(d, "debit");
    assertInt(c, "credit");
    if (d < 0 || c < 0) throw new Error("Ledger legs cannot be negative; swap debit and credit instead");
    if (d > 0 && c > 0) throw new Error("A ledger leg is either a debit or a credit, not both");
    dr += d;
    cr += c;
  }
  if (dr !== cr) throw new Error(`Unbalanced transaction for ${meta.refType} ${meta.refId}: debits ${dr} ≠ credits ${cr}`);
  if (kept.length === 0) return [];
  return kept.map((l) => ({
    id: meta.newId(),
    txnId: meta.txnId,
    date: meta.date,
    account: l.account,
    partyType: l.party?.type ?? null,
    partyId: l.party?.id ?? null,
    partyName: l.party?.name ?? null,
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    memo: meta.memo,
    refType: meta.refType,
    refId: meta.refId,
  }));
}

export interface PartyRef {
  type: PartyType;
  id: string | null;
  name: string;
}

/** Invoice raised: customer owes total; we earn revenue and owe GST/TCS to government. */
export function invoiceLegs(p: { party: PartyRef; sell: Minor; gst: Minor; tcs: Minor }): Leg[] {
  return [
    { account: "receivable", debit: p.sell + p.gst + p.tcs, party: p.party },
    { account: "revenue", credit: p.sell },
    { account: "gst_output", credit: p.gst },
    { account: "tcs_payable", credit: p.tcs },
  ];
}

/** Payment received against a receivable — from the bank/gateway or from the party's wallet. */
export function paymentLegs(p: { party: PartyRef; amount: Minor; fromWallet: boolean }): Leg[] {
  return [
    p.fromWallet ? { account: "wallet", debit: p.amount, party: p.party } : { account: "bank", debit: p.amount },
    { account: "receivable", credit: p.amount, party: p.party },
  ];
}

export function walletTopUpLegs(p: { party: PartyRef; amount: Minor }): Leg[] {
  return [
    { account: "bank", debit: p.amount },
    { account: "wallet", credit: p.amount, party: p.party },
  ];
}

/**
 * Credit note: reverses part of an invoice. The amount is split between revenue, GST and TCS
 * in the same proportions as the original invoice so the books stay consistent.
 */
export function creditNoteLegs(p: {
  party: PartyRef;
  amount: Minor;
  invoice: { sell: Minor; gst: Minor; tcs: Minor };
}): Leg[] {
  const [rev, gst, tcs] = allocate(p.amount, [p.invoice.sell, p.invoice.gst, p.invoice.tcs]);
  return [
    { account: "revenue", debit: rev ?? 0 },
    { account: "gst_output", debit: gst ?? 0 },
    { account: "tcs_payable", debit: tcs ?? 0 },
    { account: "receivable", credit: p.amount, party: p.party },
  ];
}

/** Refund of a credit balance, to the bank (cash refund) or into the party's wallet. */
export function refundLegs(p: { party: PartyRef; amount: Minor; to: "bank" | "wallet" }): Leg[] {
  return [
    { account: "receivable", debit: p.amount, party: p.party },
    p.to === "bank" ? { account: "bank", credit: p.amount } : { account: "wallet", credit: p.amount, party: p.party },
  ];
}

export function supplierBillLegs(p: { party: PartyRef; amount: Minor }): Leg[] {
  return [
    { account: "cost_of_sales", debit: p.amount },
    { account: "payable", credit: p.amount, party: p.party },
  ];
}

export function supplierPaymentLegs(p: { party: PartyRef; amount: Minor }): Leg[] {
  return [
    { account: "payable", debit: p.amount, party: p.party },
    { account: "bank", credit: p.amount },
  ];
}

/** Signed balance in the account's natural direction (positive = normal balance). */
export function accountBalance(
  entries: LedgerEntry[],
  account: AccountCode,
  party?: { type: PartyType; id: string | null },
): Minor {
  let dr = 0;
  let cr = 0;
  for (const e of entries) {
    if (e.account !== account) continue;
    if (party && (e.partyType !== party.type || e.partyId !== party.id)) continue;
    dr += e.debit;
    cr += e.credit;
  }
  return DEBIT_NORMAL.has(account) ? dr - cr : cr - dr;
}

export function trialBalance(entries: LedgerEntry[]): { debit: Minor; credit: Minor; balanced: boolean } {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    debit += e.debit;
    credit += e.credit;
  }
  return { debit, credit, balanced: debit === credit };
}

export interface StatementLine {
  date: ISODate;
  memo: string;
  refType: string;
  refId: string;
  debit: Minor;
  credit: Minor;
  balance: Minor;
}

/** Party statement for an account with a running balance (oldest first). */
export function statement(
  entries: LedgerEntry[],
  account: AccountCode,
  party: { type: PartyType; id: string | null },
): StatementLine[] {
  const rows = entries
    .filter((e) => e.account === account && e.partyType === party.type && e.partyId === party.id)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let bal = 0;
  const debitNormal = DEBIT_NORMAL.has(account);
  return rows.map((e) => {
    bal += debitNormal ? e.debit - e.credit : e.credit - e.debit;
    return { date: e.date, memo: e.memo, refType: e.refType, refId: e.refId, debit: e.debit, credit: e.credit, balance: bal };
  });
}
