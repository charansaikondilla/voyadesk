const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  (globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto.getRandomValues(bytes);
  return bytes;
}

/** Random, URL-safe identifier. */
export function randomToken(length = 22): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}

/** Entity id such as "lead_7hQx2kP9mN4c". */
export function newId(prefix: string): string {
  return `${prefix}_${randomToken(14)}`;
}

/** Human document number such as "INV/2026-27/0007". */
export function docNumber(prefix: string, seq: number, period?: string): string {
  const n = String(seq).padStart(4, "0");
  return period ? `${prefix}/${period}/${n}` : `${prefix}-${n}`;
}
