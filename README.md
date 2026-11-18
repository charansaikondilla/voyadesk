# VoyaDesk — travel business CRM, portals and website

A clean-room travel-business platform in the style of all-in-one travel CRMs: leads, itineraries and quotes,
bookings and operations, GST/TCS accounts, B2B agents, a visa desk, marketing, a public website, a customer
storefront, a B2B partner portal and a driver/guide field app. Built from public feature descriptions and
travel-domain rules only. No third-party code, branding or data is copied.

**Live demo:** https://charansaikondilla.github.io/voyadesk/ — click **Log in**, pick a role (Owner, Sales, Ops, Accounts,
Visa, Marketing, B2B agent, Driver). No password. The demo runs fully in your browser with a sample agency; data stays on
your device (reset it in Settings → Data). Every push to `main` re-runs the type-check and tests and redeploys
(`.github/workflows/deploy-pages.yml`).

> **Rename the product** in `apps/web/src/components/Brand.tsx` (`PRODUCT_NAME`). "VoyaDesk" is a placeholder.

## Quick start

```bash
npm install
npm run verify        # strict type-check + 51 unit/API tests + production build

# A) Browser demo (no server): sample agency, data kept in your browser
npm run dev:web       # http://localhost:5173

# B) Full stack: real PostgreSQL (embedded PGlite by default)
npm run dev:api                                   # http://localhost:8080
VITE_API_URL=http://localhost:8080 npm run dev:web
```

Single-server production deploy: `npm run build`, then run `apps/api` with `WEB_DIST=apps/web/dist`. The API
serves the website and the app from the same origin.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. If unset, embedded PGlite in `apps/api/.data/pglite` |
| `JWT_SECRET` | **Required in production**, 32+ random characters |
| `WEBHOOK_SECRET` | HMAC secret your WhatsApp/lead-ads provider signs webhooks with |
| `META_VERIFY_TOKEN` | Token for the Meta webhook verification handshake |
| `CORS_ORIGIN` | Only if the web app is served from a different origin |
| `PORT`, `WEB_DIST`, `PGLITE_DIR` | Server port, built web folder, embedded DB folder |
| `SECRETS_KEY` | Encrypts each agency's integration keys (AES-256-GCM). Defaults to a key derived from `JWT_SECRET`; set it separately in production |
| `PUBLIC_API_URL` | Your API's public https address, used in webhook and call-back URLs shown in Settings → Integrations |
| `JOBS`, `JOBS_INTERVAL_MS` | Background jobs (drips, reminders, follow-ups, hold expiry, delivery). On by default, every 60 s; `JOBS=off` to disable on extra instances |

## Architecture

```
packages/core   ← ONE domain engine used by both server and browser
  pricing.ts      cost → markup (overall / per component, % or flat, per unit / person) → discount → GST → TCS
  tax.ts          dated GST & TCS rules (TCS 2% flat on overseas packages from 1 Apr 2026), CGST/SGST/IGST split
  ledger.ts       double-entry postings: every event balances; statements and trial balance
  actions.ts      38 workflows (capture lead, build/send/accept quote, confirm services, vouchers, assign drivers,
                  payments, credit notes, refunds, wallet, credit limits, visa, campaigns, WhatsApp bot…)
  reports.ts      dashboards, P&L, aging, GST/TCS, operations, visa, statements, books
  permissions.ts  role matrix, agent/driver scoping, cost redaction, deletion rules
  entities.ts     Zod schemas for 34 collections (validation messages are user-readable)
apps/api        Express + PostgreSQL; tenant isolation by row-level security; JWT auth; signed webhooks
apps/web        React + Vite + Tailwind; same API interface for demo mode and server mode
```

**How modules connect:** a confirmed quote produces, in **one transaction**, the booking file, one service per
line for operations, supplier bills (payables), a GST/TCS invoice, balanced ledger postings, an ops task, the
lead's "won" status and the customer's lifetime spend. A cancellation posts a proportional credit note and a
refund. Agent bookings check wallet, credit limit and overdue dues first.

## Page map

- **Website:** `/` home · `/features` · `/solutions/{b2c,b2b-dmc,portals,visa}` · `/pricing` · `/integrations` · `/contact` · `/login` · `/signup`
- **Back office** `/app`: dashboard (role-aware) · setup guide · inbox · tasks · leads (board/list) → lead detail ·
  quotes → quote builder · customers · AI studio · bookings → booking file · ops board · group departures ·
  drivers & guides · finance overview · invoices → invoice · payments · supplier payables · ledger & books ·
  GST & TCS · B2B agents → agent statement · visa desk → visa case · marketing (campaigns, segments, drips,
  landing pages, coupons) · website & portals · masters (packages, hotels & rates, sightseeing, transfers,
  visa masters, suppliers) · reports · settings (company, team & roles, modules, tax rules, lead routing,
  payments & integrations, data)
- **Customer-facing:** `/p/{tenant}/{token}` proposal with add-ons and payment · `/store/{tenant}` storefront →
  package page · `/visa-status/{tenant}` tracker · `/lp/{tenant}/{slug}` landing page · `/print/{invoice|voucher|quote}/{id}`
- **B2B partner portal** `/agent`: home (wallet, credit, dues) · packages → quote · quotes → book on wallet/credit · bookings · visa · statement
- **Field app** `/field`: a driver or guide's own jobs, started/completed updates and live location
- **Added in the feature pack:** `/app/calls` · `/app/engines` (flights, hotels, series fares, insurance) · `/app/inventory`
  (allotments with rooms-left grid, series fares, insurance plans, vehicle rates, rate-sheet import) · `/app/insurance`
  (policies, claims) · `/app/messages` (outbox, drafts, follow-ups) · `/app/approvals` (post-sale changes) ·
  `/app/finance/links` (payment links) · AI studio tabs (email/PDF enquiry, supplier itinerary, insights & forecast)
- **Customer side, added:** `/book/{tenant}/{flights|hotels|series|insurance}` · `/pay/{tenant}/{token}` payment page ·
  `/my/{tenant}` customer portal (one-time code sign-in) · `/visa-upload/{tenant}/{token}` · website chat ·
  English / हिन्दी / العربية

## Roles

Owner, admin, sales, ops, accounts, visa, marketing (staff); **agent** (B2B partner: own records only, never sees
supplier costs); **driver** (only their assigned jobs). Every role lands on its own home screen, and modules
switched off in Settings disappear from everyone's menu.

## Safety and correctness

- Money is integer paise everywhere; percentages are basis points; every split uses largest-remainder allocation.
- Postgres row-level security with a restricted role: a tenant's transaction cannot read another tenant's rows,
  even if an API bug tried to. This is tested.
- Ledger amounts are checked by a DB constraint; invoice numbers are unique per tenant; share tokens are unique.
- Workflow-owned fields (status, totals, numbers) can't be changed through generic edits; money records can't
  be created or deleted directly.
- Login rate-limited; scrypt password hashes; roles re-read from the database on every request; HMAC-signed webhooks.

## Tests

`npm run verify` runs 64 core tests and 15 API tests against real PostgreSQL (PGlite). They cover:

- Golden pricing cases and a 300-quote property check.
- GST/TCS slabs by date.
- Ledger balance through the full sales-to-cash flow, cancellations and refunds.
- Agent wallet and credit limits, driver double-booking, visa rules, the MRZ passport check digits and the enquiry parser.
- Tenant isolation, cost privacy and webhook signatures.
- Payment links settled from signed Razorpay webhooks (idempotent), Stripe signature checks, and refusal of browser-reported payments on live accounts.
- Option A/B pricing, hold-and-expire, hotel allotments that shrink and refill, series-fare seat limits, sandbox ticketing, insurance age limits, no TCS on stand-alone components.
- Amendments with approval (supplier bill, supplementary invoice, balanced books), multi-PAN TCS, commissions.
- Missed calls → call-back tasks, customer portal one-time codes (attempt limits, no account fishing), visa uploads, campaign attribution, ZIP/XLSX/DOCX writers, EMI maths, transport costing, itinerary reading, forecasting.

The browser check (`npm run build && npm run preview`, then `npm run smoke` in a second terminal; needs Chrome, or set `CHROME_PATH`) opens every page as every role in headless Chrome. It runs the
AI-quote, lead → quote → send, and customer booking/payment flows, and fails on any console error.

## Going live: connect your accounts

Everything works end to end in the demo on a built-in **sandbox** (messages "delivered", test payments, sandbox fares and
calls, all clearly labelled). On your own server each agency connects its own accounts in **Settings → Payments & integrations**.
Keys are encrypted and never shown again; until a service is connected nothing is faked — messages wait in the outbox
with a note, and payment links explain what to connect.

| Service | What it switches on | Where the code is |
| --- | --- | --- |
| WhatsApp Cloud API (Meta) | Bot replies, notifications, campaigns, drips, delivery/read receipts. Add an approved template (one `{{1}}` body variable) for messages sent outside the 24-hour window | `apps/api/src/providers.ts`, webhook `/api/v1/webhooks/{tenant}/whatsapp-cloud` |
| SMTP email | Same messages by email | `providers.ts` (nodemailer) |
| Razorpay / Stripe / PayPal | Payment links (UPI, card, net banking, EMI) and automatic reconciliation from signed webhooks | `providers.ts`, webhooks `/payments/{razorpay,stripe,paypal}` |
| Meta lead ads | Facebook/Instagram lead forms → leads | webhook `/meta-leads` |
| Amadeus | Live flight search, pricing and orders (needs traveller date of birth and gender; collected on the website) | `providers.ts` |
| Claude (Anthropic API) | AI-written follow-ups, email/PDF/itinerary reading (rules are used when not connected) | `providers.ts` |
| Exotel | IVR call logs with recordings, AI voice-bot calls (your Exotel flow) | `providers.ts`, webhook `/calls?key=…` |
| SIM call-log app | Any Android call-log app or IVR that can POST JSON `{phone, direction, status, durationSec, recordingUrl}` | webhook `/calls?key=…` |
| Inbound email | Forward enquiry emails (Mailgun/SendGrid inbound parse or similar) | webhook `/email?key=…` |

Notes:
- **Security:** on live accounts a booking is confirmed only by the gateway's signed webhook (or by staff recording a payment). The public
  proposal page can no longer report its own payment; only sandbox mode accepts simulated payments.
- **Mobile app:** the web app is installable (Android, iPhone, desktop) with an offline shell. For Play Store / App Store builds, the
  included `apps/web/capacitor.config.json` wraps the same build: `npm i -D @capacitor/cli @capacitor/android @capacitor/ios`, then
  `npx cap add android` / `ios` and `npx cap sync` after `npm run build`.
- **Passport photos** are read in the browser (Tesseract, files shipped in `public/ocr`) and checked with the MRZ check digits before saving.
- **Not built:** SMS sending, a direct PAN-verification API (PAN format is checked; plug a KYC provider into `providers.pan`),
  password-reset emails, server-side PDF rendering (browser print-to-PDF works).
- **Dependency advisories to plan for:** `zod` 3 (fix needs the zod 4 migration; request bodies are size-limited and arrays are capped
  meanwhile) and `react-router` 6 (fix in 7.x; the app only navigates to its own routes). Dev-only advisories affect the test tooling.

## Tax disclaimer

The default GST and TCS rules are dated data (Settings → Tax rules). The defaults are: tour packages 5% GST without ITC
(SAC 998555), agent service fees 18% on the fee, and TCS on overseas packages at 2% flat from 1 April 2026 (5%/20% slabs
before that). **Confirm every rate with a chartered accountant before invoicing real customers.**
