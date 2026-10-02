# Women's Safety & Evidence Protection Platform

A web platform (React PWA on a Supabase backend) that **gets help to a woman in danger within seconds** and **makes the response accountable**. Every alert, action and piece of evidence is time-stamped, hashed and recorded in a tamper-evident ledger.

> **Status:** Phase 0 is built. The database runs on the Supabase project `women's safety`, and the frontend deploys to Vercel. Phase 1 (trusted contacts, silent SOS, live location) is next.

## Design docs

| Doc | What's inside |
|---|---|
| [01 · Product scope](docs/01-product.md) | Vision, actors, the 14 consolidated modules (M1–M14), UX principles, what a website can and cannot do |
| [02 · System architecture](docs/02-architecture.md) | Container diagram, hosting decision, tech stack, backend modules, data model, integrity ledger, escalation engine, AI, geo, security, route map, deployment |
| [03 · Workflows](docs/03-workflows.md) | Sequence and state diagrams for SOS, escalation, complaints, accountability lock, evidence, custody, journeys, fake call, wearable |
| [04 · Roadmap](docs/04-roadmap.md) | Phases P0–P9 with scope, screens and "done when" checklists, the MVP cut line, and decisions to confirm |

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite), shadcn/ui + Tailwind, React Router (dynamic routes), TanStack Query, MapLibre, PWA |
| Backend | Supabase-native: business rules, RLS and the ledger in Postgres (RPC functions), Edge Functions (TypeScript) for secrets and outside APIs, Realtime, Cron |
| Data | Supabase: Postgres + PostGIS, Storage, Auth |
| AI | Rules engine + speech-to-text + triage model (Claude API or a Hugging Face ZeroGPU Space) |
| Hosting | Vercel (frontend), Supabase (database, API, functions, files, sign-in) |

## Repository layout

```text
frontend/     React PWA: citizen app, authority console, contact live view
supabase/     SQL migrations, Edge Functions (from Phase 1), seed data, database tests
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

**Supabase project** (`fwhhgiajzrzsjeduenaj`): with the [Supabase CLI](https://supabase.com/docs/guides/local-development), `supabase link --project-ref fwhhgiajzrzsjeduenaj` then `supabase db push` applies new migrations. Locally, `supabase start` and `supabase db reset` also load `supabase/seed.sql`. To make someone staff, have them sign up, then run `select public.admin_set_role('<user id>', 'officer');` in the SQL editor.

## Deploy

**Frontend (Vercel):** in Vercel, choose **Add New → Project**, import `snehaa006/women-s-safety-`, set **Root Directory** to `frontend`, and deploy. Vite is detected automatically; `frontend/vercel.json` handles routing and caching; `frontend/.env.production` holds the public Supabase URL and key, so no environment variables are needed. Vercel deploys `main` to production and every other branch as a preview.

**Supabase Auth settings** (dashboard → Authentication), needed once:

1. **Site URL** and **Redirect URLs**: the Vercel URL (plus `http://localhost:5173` for local development).
2. Email: the built-in sender only reaches the project's team members. For the demo, turn off **Confirm email**, or add custom SMTP (for example Resend).

**First admin:** sign up in the app, then run `select public.admin_set_role('<your user id>', 'admin');` in the Supabase SQL editor.
