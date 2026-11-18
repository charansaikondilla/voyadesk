/** Helpers shared by the feature-pack modules. */
import { z } from "zod";
import { ACTION_ONLY, internals } from "../actions.js";
import { type Collection, type Entity, type Settings } from "../entities.js";
import { DomainError } from "../rules.js";
import { getSettings, type Ctx, type Store } from "../store.js";
import { ProviderNotConfigured } from "../providers.js";
import { parseDataUrl } from "../toolkit.js";

export const optStr = (max = 200) => z.string().trim().max(max).optional();
export const money = z.number().int().min(0);
export const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
export const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN")}`;

/** Collections that only change through actions (validation, money and audit rules). */
export function lockCollections(cs: Collection[]): void {
  for (const c of cs) (ACTION_ONLY as Set<Collection>).add(c);
}

/** Link inside a message: absolute when the agency has set its public app address. */
export function appLink(settings: Pick<Settings, "appUrl">, path: string): string {
  const base = settings.appUrl.trim().replace(/#.*$/, "").replace(/\/?$/, "/");
  return settings.appUrl.trim() ? `${base}#${path}` : `#${path}`;
}

export async function linkFor(store: Store, ctx: Ctx, path: string): Promise<string> {
  return appLink(await getSettings(store, ctx.now), path);
}

/** Turn a provider "not connected" error into a friendly 422 the UI can show. */
export async function withProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProviderNotConfigured) throw new DomainError(e.message, 422);
    if (e instanceof DomainError) throw e;
    throw new DomainError(`The outside service did not respond: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}

const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif|heic|heif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|text\/plain|text\/csv)$/;

/** Validate an uploaded data URL and return its decoded size. */
export function checkUpload(dataUrl: string, mime: string, maxBytes = 8_000_000): number {
  if (!ALLOWED_MIME.test(mime)) throw new DomainError("Upload a photo (JPG, PNG), PDF, Word or text file.", 422);
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new DomainError("The file could not be read. Please try again.", 422);
  if (parsed.bytes.length === 0) throw new DomainError("The file is empty.", 422);
  if (parsed.bytes.length > maxBytes) throw new DomainError(`The file is larger than ${Math.round(maxBytes / 1_000_000)} MB. Please upload a smaller copy.`, 413);
  return parsed.bytes.length;
}

export function personOf(row: { contactName?: string; name?: string; phone?: string; email?: string }) {
  return { name: row.contactName ?? row.name ?? "", phone: row.phone ?? "", email: row.email ?? "" };
}

/** Contacts are matched by phone (last 10 digits) or email. */
export async function findContact(store: Store, phone?: string | null, email?: string | null): Promise<Entity<"contacts"> | undefined> {
  const p = last10(phone);
  const e = (email ?? "").trim().toLowerCase();
  return (await store.list("contacts")).find((c) => (p.length >= 7 && last10(c.phone) === p) || (e && c.email === e));
}

export const { action, log } = internals;
