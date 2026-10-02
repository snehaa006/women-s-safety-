# Women's Safety & Evidence Protection Platform

A web platform (React PWA + Python API) that **gets help to a woman in danger within seconds** and **makes the response accountable**. Every alert, action and piece of evidence is time-stamped, hashed and recorded in a tamper-evident ledger.

> **Status:** design phase. The architecture and build plan are below. No application code yet. We build one feature at a time, starting with Phase 0.

## Design docs

| Doc | What's inside |
|---|---|
| [01 · Product scope](docs/01-product.md) | Vision, actors, the 14 consolidated modules (M1–M14), UX principles, what a website can and cannot do |
| [02 · System architecture](docs/02-architecture.md) | Container diagram, hosting decision, tech stack, backend modules, data model, integrity ledger, escalation engine, AI, geo, security, route map, deployment |
| [03 · Workflows](docs/03-workflows.md) | Sequence and state diagrams for SOS, escalation, complaints, accountability lock, evidence, custody, journeys, fake call, wearable |
| [04 · Roadmap](docs/04-roadmap.md) | Phases P0–P9 with scope, screens and "done when" checklists, the MVP cut line, and decisions to confirm |

## Planned stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite), shadcn/ui + Tailwind, React Router (dynamic routes), TanStack Query, MapLibre, PWA |
| Backend | Python, FastAPI, SQLAlchemy + Alembic, Postgres-backed job queue, WebSockets |
| Data | Supabase: Postgres + PostGIS, Storage, Auth |
| AI | Rules engine + speech-to-text + triage model (Claude API or a Hugging Face ZeroGPU Space) |
| Hosting | Render (API and static frontend), Supabase |

## Planned repository layout

```text
frontend/     React PWA: citizen app, authority console, contact live view
backend/      FastAPI modular monolith + in-process job worker
ai-service/   Optional model service (Hugging Face ZeroGPU Space)
firmware/     ESP32 wearable (Phase 8)
docs/         Design docs (this folder is the source of truth)
```
