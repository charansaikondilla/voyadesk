/**
 * Per-agency integration keys (Razorpay, WhatsApp, SMTP, Claude…). Stored encrypted (AES-256-GCM) in their own
 * table that the restricted app role cannot read, never returned to the browser — the UI only sees "connected".
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { type Db } from "./db.js";

export const SERVICES = {
  sandbox: { label: "Sandbox (test) mode", fields: ["enabled"] },
  whatsapp: { label: "WhatsApp Cloud API", fields: ["phoneNumberId", "accessToken", "appSecret", "verifyToken", "templateName", "templateLang"] },
  email: { label: "Email (SMTP)", fields: ["host", "port", "user", "pass", "from"] },
  razorpay: { label: "Razorpay", fields: ["keyId", "keySecret", "webhookSecret"] },
  stripe: { label: "Stripe", fields: ["secretKey", "webhookSecret"] },
  paypal: { label: "PayPal", fields: ["clientId", "clientSecret", "webhookId", "mode"] },
  gateway: { label: "Default payment gateway", fields: ["provider"] },
  meta: { label: "Meta lead ads", fields: ["pageAccessToken", "appSecret", "verifyToken"] },
  amadeus: { label: "Amadeus flights", fields: ["clientId", "clientSecret", "mode"] },
  anthropic: { label: "Claude (AI)", fields: ["apiKey", "model"] },
  exotel: { label: "Exotel calls / voice bot", fields: ["sid", "apiKey", "apiToken", "callerId", "flowUrl", "subdomain"] },
  calls: { label: "Call-log webhook key", fields: ["key"] },
} as const;
export type Service = keyof typeof SERVICES;
export type Secrets = Partial<Record<Service, Record<string, string>>>;

export class SecretBox {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHash("sha256").update(`voyadesk-secrets:${secret}`).digest();
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
  }
  open(sealed: string): string {
    const [iv, tag, data] = sealed.split(".");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv!, "base64"));
    d.setAuthTag(Buffer.from(tag!, "base64"));
    return Buffer.concat([d.update(Buffer.from(data!, "base64")), d.final()]).toString("utf8");
  }
}

export class TenantSecrets {
  private cache = new Map<string, { at: number; value: Secrets }>();
  constructor(private db: Db, private box: SecretBox) {}

  async get(tenantId: string): Promise<Secrets> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const r = await this.db.query<{ service: string; value: string }>("SELECT service, value FROM tenant_secrets WHERE tenant_id = $1", [tenantId]);
    const out: Secrets = {};
    for (const row of r.rows) {
      try {
        out[row.service as Service] = JSON.parse(this.box.open(row.value)) as Record<string, string>;
      } catch {
        /* a key that can't be decrypted (rotated secret) is treated as not set */
      }
    }
    this.cache.set(tenantId, { at: Date.now(), value: out });
    return out;
  }

  async set(tenantId: string, service: Service, values: Record<string, string>): Promise<void> {
    const allowed = new Set<string>(SERVICES[service].fields);
    const clean = Object.fromEntries(Object.entries(values).filter(([k, v]) => allowed.has(k) && typeof v === "string" && v.trim() !== "").map(([k, v]) => [k, v.trim()]));
    const sealed = this.box.seal(JSON.stringify(clean));
    await this.db.query(
      "INSERT INTO tenant_secrets (tenant_id, service, value, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (tenant_id, service) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [tenantId, service, sealed],
    );
    this.cache.delete(tenantId);
  }

  async remove(tenantId: string, service: Service): Promise<void> {
    await this.db.query("DELETE FROM tenant_secrets WHERE tenant_id = $1 AND service = $2", [tenantId, service]);
    this.cache.delete(tenantId);
  }

  /** What the settings page may see: which services are connected, never the values. */
  async status(tenantId: string): Promise<Record<string, { connected: boolean; fields: string[] }>> {
    const s = await this.get(tenantId);
    return Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, { connected: Boolean(s[k as Service] && Object.keys(s[k as Service]!).length), fields: [...v.fields] }]));
  }
}
