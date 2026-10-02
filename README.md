# Women's Safety & Evidence Protection Platform

A web platform (React PWA on a Supabase backend) that **gets help to a woman in danger within seconds** and **makes the response accountable**. Every alert, action and piece of evidence is time-stamped, hashed and recorded in a tamper-evident ledger.

> **Status:** Phase 0 in progress. The frontend shell and the database foundation are built and tested. The backend runtime (decision D1 in the roadmap) is still open.

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
| Backend | Postgres rules and SQL migrations. Service layer: Python FastAPI or TypeScript Edge Functions (decision D1). |
| Data | Supabase: Postgres + PostGIS, Storage, Auth |
| AI | Rules engine + speech-to-text + triage model (Claude API or a Hugging Face ZeroGPU Space) |
| Hosting | Supabase (database, files, sign-in). Backend runtime: Render or Supabase Edge Functions (decision D1). |

## Repository layout

```text
frontend/     React PWA: citizen app, authority console, contact live view
supabase/     SQL migrations, seed data and database tests
docs/         Design docs (the source of truth)
.github/      CI: frontend checks and database tests on every PR
```

Planned: a backend service (decision D1), `ai-service/` for the AI model, and `firmware/` for the ESP32 wearable (Phase 8).

## Run it locally

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # add your Supabase URL and publishable key
npm run dev                  # http://localhost:5173
npm test                     # unit and routing tests
```

Without Supabase keys the app still runs. Sign-in shows a "not set up" notice.

**Database tests** need any Postgres 16+ you can connect to as a superuser:

```bash
cd supabase/tests
npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

**Supabase project:** with the [Supabase CLI](https://supabase.com/docs/guides/local-development), `supabase link --project-ref <ref>` then `supabase db push` applies the migrations. Locally, `supabase start` and `supabase db reset` also load `supabase/seed.sql`. To make someone staff, have them sign up, then run `select public.admin_set_role('<user id>', 'officer');` in the SQL editor.
