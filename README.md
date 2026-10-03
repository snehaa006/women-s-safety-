# Women's Safety & Evidence Protection Platform

A web platform (React PWA on a Supabase backend) that **gets help to a woman in danger within seconds** and **makes the response accountable**. Every alert, action and piece of evidence is time-stamped, hashed and recorded in a tamper-evident ledger.

> **Status:** Phase 1 is built: trusted circle, hold-to-send SOS, live location, a live link for contacts, SOS and duress PINs, the incident timeline, a **virtual wearable** that stands in for the IoT keychain, **automatic alerts to the circle** (email and Telegram, with a reminder when nobody responds), **live updates over Supabase Realtime**, an **offline SOS queue** with SMS fallback, and **nearby police stations and hospitals**. The database runs on the Supabase project `women's safety`; the frontend deploys to Vercel. Next: Phase 2, the authority console and escalation.

## Design docs

| Doc | What's inside |
|---|---|
| [01 · Product scope](docs/01-product.md) | Vision, actors, the 14 consolidated modules (M1–M14), UX principles, what a website can and cannot do |
| [02 · System architecture](docs/02-architecture.md) | Container diagram, hosting decision, tech stack, backend modules, data model, integrity ledger, escalation engine, AI, geo, security, route map, deployment |
| [03 · Workflows](docs/03-workflows.md) | Sequence and state diagrams for SOS, escalation, complaints, accountability lock, evidence, custody, journeys, fake call, wearable |
| [04 · Roadmap](docs/04-roadmap.md) | Phases P0–P9 with scope, screens and "done when" checklists, the MVP cut line, and decisions to confirm |
| [05 · Wearable protocol](docs/05-device-protocol.md) | The device API, signing, event types, the virtual wearable and command-line simulator, demo recipes, firmware notes |

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite), shadcn/ui + Tailwind, React Router (dynamic routes), TanStack Query, MapLibre, PWA |
| Backend | Supabase-native: business rules, RLS and the ledger in Postgres (RPC functions), Edge Functions (TypeScript) for secrets and outside APIs, Realtime, Cron |
| Data | Supabase: Postgres + PostGIS, Storage, Auth |
| AI | Rules engine + speech-to-text + triage model (Gemini API or a Hugging Face ZeroGPU Space) |
| Hosting | Vercel (frontend), Supabase (database, API, functions, files, sign-in) |

## Repository layout

```text
frontend/     React PWA: citizen app, authority console, contact live view
supabase/     SQL migrations, seed data, database tests, Edge Functions (notify, telegram-webhook)
tools/        device-simulator.mjs: the wearable from the command line
docs/         Design docs (the source of truth)
.github/      CI: frontend checks and database tests on every PR
```

Planned: `firmware/` for the ESP32 wearable (Phase 8).

## Run it locally

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # public URL and key of the shared Supabase project
npm run dev                  # http://localhost:5173
npm test                     # unit and routing tests
```

Without the env file the app still runs; sign-in shows a "not set up" notice.

**Database tests** need any Postgres 16+ you can connect to as a superuser:

```bash
cd supabase/tests
npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

**Edge Function logic** (messages, channels, the Telegram bot) is plain TypeScript with Node tests:
`node --test supabase/functions/tests/*.test.ts` (Node 22, no install).

**Supabase project** (`fwhhgiajzrzsjeduenaj`): with the [Supabase CLI](https://supabase.com/docs/guides/local-development), `supabase link --project-ref fwhhgiajzrzsjeduenaj` then `supabase db push` applies new migrations. Locally, `supabase start` and `supabase db reset` also load `supabase/seed.sql`. To make someone staff, have them sign up, then run `select public.admin_set_role('<user id>', 'officer');` in the SQL editor.

## Mock data: the virtual wearable

There is no IoT hardware yet. In the app, open **Wearables → Open the virtual wearable**
(`/app/devices/simulator`) and pair it. It has the keychain's single button (hold 3 seconds for
SOS; one or two clicks are gestures), a **Run demo** that sends an SOS and then walks a route
through Connaught Place, New Delhi, plus battery, heartbeat and tamper events. Every event is
HMAC-signed and goes to the same endpoint the ESP32 will call, so the rest of the app can't tell
the difference.

From a terminal, the same thing (keys from the simulator's "For developers" panel):

```bash
DEVICE_ID=... DEVICE_SECRET=... node tools/device-simulator.mjs demo
```

Details and demo recipes: [docs/05-device-protocol.md](docs/05-device-protocol.md).

## Alerts: email and Telegram

An SOS queues one alert per contact and channel in the database; Postgres calls the `notify`
Edge Function, which sends them. Without keys it records each alert as "not sent: not set up
yet" (visible on the SOS screen and timeline), so nothing fails silently. To switch channels on,
add **Edge Function secrets** in the Supabase dashboard (Edge Functions → Secrets). Never commit
them.

| Secret | Channel | Notes |
|---|---|---|
| `RESEND_API_KEY` | Email via [Resend](https://resend.com) | Without a verified domain, Resend only delivers to your own address. |
| `EMAIL_FROM` | Email | Optional. Default `Women's Safety <onboarding@resend.dev>`; use an address on your verified domain. |
| `TELEGRAM_BOT_TOKEN` | Telegram | From [@BotFather](https://t.me/BotFather). Free, reaches anyone with Telegram. |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram | Any long random string; Telegram sends it back on every update. |
| `SITE_URL` | Links in messages | Optional. Default `https://frontend-pi-lime-66.vercel.app`. |

Then, for Telegram, point the bot at the webhook once:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url=https://fwhhgiajzrzsjeduenaj.supabase.co/functions/v1/telegram-webhook \
  -d secret_token=$TELEGRAM_WEBHOOK_SECRET
```

and set `VITE_TELEGRAM_BOT=<bot username>` in Vercel (or `frontend/.env.production`) so each
contact's page shows a **Telegram invite** to send them. A contact opens it once and taps Start;
`/stop` in the bot unsubscribes them.

## AI triage (optional)

Every complaint is scored instantly by the rules engine in Postgres. The `triage` Edge Function
adds an AI review with Google Gemini when you add `GEMINI_API_KEY` (from
[Google AI Studio](https://aistudio.google.com/apikey)) as an **Edge Function secret**
(optionally `TRIAGE_MODEL`, default `gemini-flash-latest`). The model can only raise severity, never
lower it below the rules. Without the key, reports show "Scored by the rules" and nothing else
changes.

## Demo console

The hosted project has a demo district: the New Delhi District Control Room, four police
stations with jurisdiction polygons, a campus security desk and six patrol units. Staff accounts
are created with [`supabase/demo/staff.sql`](supabase/demo/staff.sql); the password is passed on
the command line and never committed:

```bash
psql "$DATABASE_URL" -v password='choose-a-password' -f supabase/demo/staff.sql
```

| Account | Role |
|---|---|
| `admin@demo.safety.test` | Administrator: escalation policies, demo incidents |
| `supervisor@demo.safety.test` | Supervisor, district control room |
| `control@demo.safety.test` | Dispatcher, district control room |
| `officer.cp@demo.safety.test` | Officer, Connaught Place Police Station |

Sign in at `/login`, then use **Load demo incidents** on the live board and **Load demo
complaints** on `/console/complaints` (admins and supervisors) to start SOS alerts and reports at
different escalation stages. A citizen SOS from central
New Delhi (or the virtual wearable's demo walk) is routed to the station that covers it.

## Deploy

**Frontend (Vercel):** in Vercel, choose **Add New → Project**, import `snehaa006/women-s-safety-`, set **Root Directory** to `frontend`, and deploy. Vite is detected automatically; `frontend/vercel.json` handles routing and caching; `frontend/.env.production` holds the public Supabase URL and key, so no environment variables are needed. Vercel deploys `main` to production and every other branch as a preview.

**Supabase Auth settings** (dashboard → Authentication), needed once:

1. **Site URL** and **Redirect URLs**: the Vercel URL (plus `http://localhost:5173` for local development).
2. Email: the built-in sender only reaches the project's team members. For the demo, turn off **Confirm email**, or add custom SMTP (for example Resend).

**First admin:** sign up in the app, then run `select public.admin_set_role('<your user id>', 'admin');` in the Supabase SQL editor.
