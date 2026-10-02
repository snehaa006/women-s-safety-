# 04 · Roadmap: Phases & Decisions

> We build **one feature slice at a time**. Each phase ends with something working on the deployed URLs that can be demoed.
> Module IDs (M1–M14) are defined in [01-product.md](01-product.md).

---

## 1. How we work

Every feature goes through the same five steps:

1. **Design check (about 30 min).** Re-read the relevant sections of these docs and note any change.
2. **Build the vertical slice.** Database migration → API → UI, all on one feature branch.
3. **Test.** Unit tests for rules, state machines and the ledger. API integration tests. One Playwright test for the main flow.
4. **Deploy.** Merging the PR into `main` auto-deploys.
5. **Demo and update docs.** Record a 1-minute demo and update these docs if the design changed.

The [Definition of Done](#5-definition-of-done-every-feature) at the end applies to every phase.

---

## 2. Phase map

```mermaid
flowchart LR
  P0["P0 Foundation"] --> P1["P1 Circle + SOS<br/>+ Live location"]
  P1 --> P2["P2 Authority console<br/>+ Escalation"]
  P2 --> P3["P3 Complaints + AI triage<br/>+ Accountability lock"]
  P1 --> P4["P4 Evidence vault<br/>+ Ledger + Custody"]
  P3 --> P6["P6 Call and Connect<br/>+ Dispatch gate + FIR"]
  P4 --> P6
  P1 --> P5["P5 Safe maps<br/>+ Journeys"]
  P4 --> P7["P7 Fake call<br/>+ Stealth recording"]
  P1 --> P8["P8 Wearable<br/>hardware"]
  P6 --> P9["P9 Oversight<br/>+ Hardening"]
  P4 --> P9
```

| Phase | Theme | Modules | Size |
|---|---|---|---|
| **P0** | Foundation | platform | M |
| **P1** | Trusted Circle, Silent SOS, Live Location | M1, M2, M3, M4 (contacts) | L |
| **P2** | Authority Console & Smart Escalation | M4, M5 | L |
| **P3** | Smart Complaints, AI Triage, Accountability Lock | M6, M7 | L |
| **P4** | Evidence Vault, Integrity Ledger, Chain of Custody | M9, M10 | L |
| **P5** | Safe Maps & Journey Monitoring | M11 | L |
| **P6** | Call & Connect, Dispatch Gate, FIR Draft | M8 | M |
| **P7** | Fake Call & Stealth Recording | M12, M9 | M |
| **P8** | Wearable Hardware | M13 | L (hardware) |
| **P9** | Oversight, Anti-suppression, Hardening | M14, M10 | M |

### MVP cut line

**P0–P4 is the pitch-ready core.** Using the in-app wearable simulator, it covers 9 of the 10 "highlight" features listed in Ideas-2: silent trigger, multi-channel dispatch, live GPS, offline/SMS fallback, automatic escalation, evidence hashing, procedural state machine, chain of custody, immutable timeline. Tamper detection needs the real device (P8).

P5–P9 are enhancements. **P7's fake call has no dependencies**, so it can be pulled forward any time as a quick win.

---

## 3. Phase details

### P0 · Foundation

**Goal:** a deployed skeleton that every feature builds on.

**Status (October 2026):** built and live on the Supabase project, except the hosted sign-in check, which needs one Auth setting (below).

**Built**

- **Frontend shell** (`frontend/`): Vite + React 19 + TypeScript, Tailwind v4, shadcn/ui components, React Router 8 route trees for Public, Citizen (`/app`), Console (`/console`) and Contact (`/t/:token`) with lazy-loaded screens, role guards, dynamic segments and a 404 page. Supabase Auth sign-in and sign-up, redirect by role, light and dark themes with severity tokens. Later screens are placeholders that already receive their route params. SOS controls are visibly disabled and point to 112 until Phase 1. React and Supabase ship as separately cached chunks; app code is about 27 KB gzipped.
- **Database** (`supabase/`, applied to the hosted project): `profiles`, `organizations` and `memberships` with RLS, a sign-up trigger that creates citizen profiles, `admin_set_role()` (the only way to grant staff roles, ledgered), and the hash-chained ledger enforced by Postgres triggers with `ledger_verify()`. Internals live in a `private` schema the API does not expose. Demo stations seeded. Supabase security and performance advisors are clean apart from the two deliberate admin RPCs.
- **Tests and CI:** 16 frontend tests and 15 database tests, plus a live smoke test on the hosted project inside a rolled-back transaction. GitHub Actions runs lint, formatting, type-check, tests and build on every PR.

**Needs a dashboard setting (Supabase → Authentication)**

- Built-in email only reaches the project's team members. For the demo, turn off **Confirm email**, or add custom SMTP (for example Resend).
- Set **Site URL** to the deployed frontend URL and add it to **Redirect URLs**.

**Done when**

- [ ] A citizen and an officer can sign in on the deployed URLs and land on their own home screens. A citizen opening `/console` is blocked. *(Covered by tests; the hosted check waits on the Auth settings above.)*
- [x] Tests prove the ledger works: changing any stored entry makes `ledger_verify()` fail.
- [x] CI runs lint, type-check and tests on every PR.

---

### P1 · Trusted Circle, Silent SOS, Live Location

**Goal:** the core safety promise. Press SOS, and the right people see you live within seconds.

**Status (October 2026):** part A is built and live on the Supabase project; part B is next.

**Built (part A)**

- **Database** (`20261002161421_circle_sos_devices.sql`): trusted contacts (up to 10, RLS per owner), incidents (one active per person, idempotent by client id), location pings (sealed into the ledger once a minute as a hashed batch), live links with 144-bit tokens that expire 24 h after the SOS ends, responders, SOS and duress PINs (bcrypt, five wrong tries lock for 10 minutes), and the wearable API: devices, per-device secrets, and `device_event()`, which verifies HMAC signatures, timestamps and nonces inside Postgres.
- **Citizen app:** hold-to-send SOS (1.5 s hold, 3 s cancel countdown, "Send now"), live SOS screen (streams location every 5 s, map, who's responding, send the link by WhatsApp, SMS to the circle, copy or share, call 112), "I'm safe" with PIN or duress PIN, the incident timeline from the ledger, trusted circle with alert order, Settings for name, phone and PINs, and Wearables.
- **Live link** `/t/:token` for contacts without an account: status, map, battery, call her or 112, "I'm responding", and a warning when she cancelled with the duress PIN.
- **Mock IoT:** the virtual wearable at `/app/devices/simulator` (hold 3 s for SOS, gestures, demo walk through Connaught Place, battery, heartbeat, tamper) and `tools/device-simulator.mjs`, both sending the exact requests the ESP32 will send. See [05 · Wearable protocol](05-device-protocol.md).
- **Tests:** 49 database tests and 39 frontend tests, a browser run of the virtual wearable, and a live smoke test on the hosted project inside a rolled-back transaction.

**Next (part B):** automatic alerts to the circle (a `jobs` row per contact, sent by the `notify` Edge Function by email, Web Push or Telegram; needs a provider key), the offline queue, Realtime instead of 5-second polling, and nearby safe points.

**Scope**

- **Circle (M1):** add, edit and reorder contacts. Choose channels per contact. Invite contacts who already have accounts.
- **SOS (M2):** hold-to-trigger with a 3 s cancel countdown. SOS PIN and duress PIN. "I'm safe".
- **Live location (M3):** location streaming every 5 s. Live link page `/t/:token` with a map, status and an "I'm responding" button.
- **Alerts to contacts (M4, partial):** dispatch job, then Web Push and email (plus Telegram for demos). Delivery receipts.
- **Incident timeline:** read from the ledger.
- **Offline fallback:** IndexedDB queue, Background Sync, one-tap `sms:` link.
- **Nearby safe points (basic):** OSM import for the demo city. The nearest police station and hospital appear on the SOS screen.
- **Wearable simulator:** virtual keychain at `/app/devices/simulator`. Its long press calls the real device API with HMAC.

**Screens:** `/app`, `/app/circle`, `/app/circle/:contactId`, `/app/sos/:incidentId`, `/app/incidents/:incidentId`, `/app/devices`, `/app/devices/simulator`, `/app/settings`, `/t/:token`

**Done when** *(checked items are covered by tests and the live smoke test; they still need a run on the deployed URL)*

- [ ] Holding SOS sends contacts a push or email with the live link within 5 s. The map moves as the citizen walks. *(The map moves. Sending the link is one tap for now; automatic alerts are part B.)*
- [x] A contact taps "I'm responding" and the citizen sees it within 5 s.
- [x] "I'm safe" needs the PIN. The duress PIN shows "cancelled" while the alert stays active.
- [ ] In airplane mode the SOS is queued, the SMS fallback opens prefilled, and the SOS is delivered once back online. *(Part B.)*
- [x] The simulator's long press creates an SOS exactly like the app button.
- [x] Every step appears on the incident timeline.

---

### P2 · Authority Console & Smart Escalation

**Goal:** authorities see SOS events live and act on them. Unanswered alerts climb the ladder automatically.

**Scope**

- Routing by jurisdiction (PostGIS) and a duty roster (on-duty toggle).
- **Live board:** active incidents on a map and a list, with live location, battery, GPS status, time since trigger and acknowledgement state.
- **Incident command view:** acknowledge, assign a patrol unit, ETA, mark arrival, resolve with a code.
- **Escalation engine:** the L0 → L1 → L2 policy from [02 §7](02-architecture.md#7-escalation--sla-engine-dead-man-switch), editable in `/console/admin/escalation`, with flashing red for escalated items and push to supervisors.
- Golden-hour metrics per incident.

**Screens:** `/console`, `/console/incidents/:incidentId`, `/console/map`, `/console/admin/:section`

**Done when**

- [ ] An SOS appears on the correct station's board within 5 s.
- [ ] With no acknowledgement for 2 min the supervisor is alerted. After 5 min the district control room is alerted. Any acknowledgement stops the ladder.
- [ ] The citizen sees "Officer assigned, ETA 6 min".
- [ ] Escalation timing is covered by fake-clock tests.

---

### P3 · Smart Complaints, AI Triage, Accountability Lock

**Goal:** frictionless reporting that is scored, routed and cannot be quietly downgraded.

**Scope**

- **Report screen (M6):** one screen with text or voice (live dictation), auto GPS (adjustable pin), "when did it happen", and a Confidential toggle with a plain-language explanation.
- **Triage:** rules engine (sync), then an AI adapter (async). The provider is chosen in decision D5 below.
- **Routing and SLA:** route to a station by location. Countdown matrix in `/console/complaints` sorted by time left. SLA escalation reuses the P2 engine.
- **Accountability lock (M7):** downgrade block, justification form, ledger entry, weekly review queue for supervisors.
- **Confidential mode:** pseudonymous reporter, identity stored encrypted, reveal only with consent.

**Screens:** `/app/report`, `/app/reports`, `/app/reports/:complaintId`, `/console/complaints`, `/console/complaints/:complaintId`, `/console/reviews`

**Done when**

- [ ] A Hinglish voice note such as *"ek aadmi metro se mera peecha kar raha hai"* becomes a transcript, category `stalking`, L4 and a rationale. The rules answer is instant and the AI update follows within about 30 s.
- [ ] An L5 complaint shows a 3-minute countdown. A missed SLA escalates.
- [ ] Downgrading below the AI severity is blocked until a justification is entered. The override then appears in the supervisor's review queue.
- [ ] Confidential complaints never show the citizen's name or phone number to officers.

---

### P4 · Evidence Vault, Integrity Ledger, Chain of Custody

**Goal:** evidence that is provably unaltered, cannot be suppressed, and follows procedure.

**Scope**

- **Vault (M9):** capture or upload, browser hashing, direct upload, server re-hash, "Sealed" badge, passkey unlock, envelope encryption, share to report or incident, delayed deletion.
- **Custody (M10):** cases, a workflow engine with definitions stored as data (admin screen), geofence checks, two-signature lock, custody hand-off handshake, evidence dashboard checklist (✓ captured, ✓ hashed, ✓ signed, ✓ custody, ⚠ missing step).
- **Ledger anchoring:** Merkle roots stamped with OpenTimestamps. Optional testnet contract.
- **Public verifier:** `/verify`.

**Screens:** `/app/vault`, `/app/vault/:itemId`, `/console/cases/:caseId`, `/console/cases/:caseId/evidence/:evidenceId`, `/console/admin/workflows`, `/verify`, `/verify/:sha256`

**Done when**

- [ ] An uploaded file shows "Sealed" with its hash. On `/verify`, the original matches and a copy with one changed byte does not.
- [ ] Skipping a workflow state returns the list of missing requirements.
- [ ] Locking needs both the investigating officer's and the supervisor's signature.
- [ ] The custody chain shows each hand-off with both signatures and a re-verified hash.
- [ ] Sealed items show an anchor receipt.

---

### P5 · Safe Maps & Journey Monitoring

**Scope (M11)**

- Zone reports. Hourly risk-cell job (H3, day and night).
- Heatmap and safe-point layers.
- Safest vs fastest routes (OpenRouteService alternatives plus risk scoring).
- Journeys with heartbeat checks and graded escalation. Automatic active monitoring in high-risk cells at night.

**Screens:** `/app/map`, `/app/journeys/:journeyId`, risk layer on `/console/map`

**Done when**

- [ ] The map shows day and night risk using aggregated cells only (at least *k* signals per cell).
- [ ] "Safest" avoids a seeded red zone and shows the time trade-off.
- [ ] A 3-minute stop triggers a check-in. With no answer, contacts are alerted. With no acknowledgement, an SOS is created.

---

### P6 · Call & Connect, Dispatch Gate, FIR Draft

**Scope (M8)**

- Browser-to-browser audio calls: WebRTC with signaling over our WebSocket and a TURN server (decision D8).
- Contact-attempt records.
- Gate enforcement with reason codes, plus a nearest-available-unit suggestion.
- FIR draft generator with PDF export, each version ledgered.

**Screens:** call panel and gate in `/console/complaints/:complaintId`, `/console/cases/:caseId/fir/:version`, incoming-call screen in `/app/reports/:complaintId`

**Done when**

- [ ] An officer calls the citizen in the app. Neither sees the other's number, and the attempt times are logged.
- [ ] A complaint cannot move on without a gate decision. "No visit" requires a reason code.
- [ ] One click produces a FIR draft containing the citizen's original words with their hash, the location, and evidence links with QR codes.

---

### P7 · Fake Call & Stealth Recording

**Scope (M12, M9)**

- Caller profiles and scripts, a full-screen ringing UI, interactive audio with pauses, the current street name, and a hidden SOS gesture.
- Stealth recording in 10-second chunks, each sealed on arrival, with retention settings.

**Screens:** `/app/fake-call`, `/app/fake-call/live`, recording control on `/app/sos/:incidentId` and in the wearable simulator

**Done when**

- [ ] The fake call rings within 1 s and carries a 60-second scripted conversation.
- [ ] Killing the app mid-recording keeps every completed chunk sealed in the vault.

---

### P8 · Wearable Hardware

**Scope (M13)**

- **Hardware:** an ESP32 for BLE (and Wi-Fi), an LTE Cat-1 modem with GNSS (avoid 2G-only modules such as the SIM800L, because Jio, India's largest network, has no 2G), a button, a LiPo battery with charger, a vibration motor and a tamper switch. The final parts list is decided at the start of this phase.
- **Firmware:** gesture detection, HMAC client, heartbeat, tamper events, low-battery mode, SMS fallback.
- **App:** pairing through Web Bluetooth (Android Chrome) or a pairing code. Device health screen.

**Screens:** `/app/devices`, `/app/devices/:deviceId`

**Done when**

- [ ] A long press on the physical device creates an SOS with GPS without touching the phone.
- [ ] Missed heartbeats or opening the case raises a tamper alert.
- [ ] In low-battery mode, SOS still works.

---

### P9 · Oversight, Anti-suppression, Hardening

**Scope (M14, M10)**

- Anomaly rules and an Isolation Forest, a review queue and a weekly oversight report.
- Replica store with a daily cross-check job.
- Retention jobs and a security review.
- Load test of the SOS path, accessibility audit, Hindi translation.
- Optional Capacitor native wrapper for lock-screen and background features.

**Screens:** `/console/anomalies`, `/console/anomalies/:anomalyId`, `/console/reports/weekly`

**Done when**

- [ ] A seeded "Capture → Sign → Seal" sequence (hash step missing) raises a **Missing hash** anomaly for review.
- [ ] Deleting a replica file is detected within 24 h.
- [ ] The SOS path meets its latency targets under load.

---

## 4. Decisions

D1 to D4 are decided. The rest have recommended defaults; confirm or change them when the phase that needs them starts.

| # | Decision | Recommended default | Alternative |
|---|---|---|---|
| D1 | Backend runtime | **Decided: Supabase-native.** Rules and ledger in Postgres (RPC functions + RLS), Edge Functions (TypeScript) for secrets and outside APIs, Realtime, Cron. | Cloudflare Workers + Durable Objects (kept in reserve), Python FastAPI on Render (about 1 min wake-up on free tier) |
| D2 | Database & files | **Decided: Supabase** Postgres + PostGIS + Storage (project `women's safety`) | Cloudflare R2 for evidence if storage outgrows 1 GB |
| D3 | Auth | **Decided: Supabase Auth**, roles in `profiles`, checked by RLS | n/a |
| D4 | Frontend hosting | **Decided: Vercel** (global CDN, preview URL per PR) | Cloudflare Pages, Render Static Site |
| D5 | Triage AI | **Rules engine first.** Then the Claude API (`claude-opus-5-5`, low effort, structured output) if there is an API budget, otherwise an HF ZeroGPU Space (free, quota-limited). | |
| D6 | "Blockchain" | **Hash-chained ledger + OpenTimestamps**, with an optional testnet contract for the demo | Running a blockchain node (not recommended) |
| D7 | Demo notification channels | **Web Push + email + Telegram**, then Twilio SMS/WhatsApp sandbox | MSG91 (needs DLT), Meta WhatsApp Cloud API |
| D8 | In-app calls | **WebRTC + a free TURN service** | LiveKit or Daily free tier |
| D9 | Region & law | **India**: 112, BNS legal tags, Hindi | Configure another region |
| D10 | Wearable | **Simulator in P1, real ESP32 in P8** | Start hardware in parallel |

**Open questions for the team**

1. What is the demo or submission date, and how many people are on the team? This decides whether the MVP is P0–P4 or smaller.
2. Is there a pilot partner, such as a college security desk or a police station, or is this a demo with seeded data?
3. Is there any budget for paid services (LLM API, SMS, an always-on server)?
4. Which city should the seed data use (stations, safe points, risk map)?

---

## 5. Definition of Done (every feature)

- [ ] Works on the deployed URLs in mobile Chrome and desktop Chrome.
- [ ] API covered by tests. The main flow has a Playwright test.
- [ ] Every state change writes a ledger entry and appears on the relevant timeline.
- [ ] Loading, empty and error states exist. Keyboard and screen-reader basics work. Color contrast passes.
- [ ] No secrets in git. New settings are documented in `.env.example`.
- [ ] These docs are updated, and a 1-minute demo script is recorded.
