import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** scrypt password hash: "scrypt$<salt>$<hash>" (both base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface TokenClaims {
  sub: string; // user id
  tid: string; // tenant id
  exp: number; // unix seconds
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** HS256 JSON Web Token. Role is NOT stored in the token: it is re-read from the database on every request. */
export function signToken(claims: Omit<TokenClaims, "exp">, secret: string, ttlSeconds = 60 * 60 * 12): string {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenClaims;
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
    if (typeof claims.sub !== "string" || typeof claims.tid !== "string") return null;
    return claims;
  } catch {
    return null;
  }
}

export function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.replace(/^sha256=/, "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Small fixed-window limiter for login attempts (per process; use Redis for multi-instance). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    h.count += 1;
    return h.count <= this.max;
  }
}
