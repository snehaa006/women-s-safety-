# 01 · Product Scope

> What we are building, for whom, and the rules that keep it simple.
> Sources: `Ideas.pdf` (I1), `Ideas-2.pdf` (I2), `Ideas-3.pdf` (I3).

---

## 1. Vision

A web platform that **gets help to a woman in danger within seconds** and **makes the response accountable**.

It rests on two pillars:

| Pillar | Promise |
|---|---|
| **Emergency response** | Silent SOS, live location, alerts to trusted people and the nearest authority, automatic escalation when nobody responds, safer routes. |
| **Evidence & accountability** | Every alert, action and piece of evidence is time-stamped, hashed and written to a tamper-evident ledger. Nothing can be quietly ignored, downgraded, altered or deleted. |

---

## 2. Actors

The core is the **two-actor model** from I3 (Citizen ↔ Authority). The other actors support it.

| Actor | Who | Uses | Account |
|---|---|---|---|
| **Citizen** | Woman or girl using the app | Citizen app (mobile-first PWA) | Self sign-up |
| **Trusted contact** | Family or friend chosen by the citizen | Secure live link `/t/:token` | None needed (optional account) |
| **Officer / responder** | Police officer, campus security guard | Authority console | Created by admin |
| **Supervisor** | Station head (SHO), security head | Console: escalations, approvals, reviews | Created by admin |
| **Oversight** | District superintendent, auditor | Cross-station reviews, anomalies, reports | Created by admin |
| **Admin** | Platform operator | Stations, users, policies, workflows | Created at setup |
| **Wearable** | Keychain, ring or pendant | Device API | Per-device key |

**Responder organizations** (police stations, campus security desks, control rooms) form a hierarchy:
*station → district → state*. The hierarchy defines who an alert escalates to.

---

## 3. Feature catalog (consolidated)

The three idea documents describe about 35 features with a lot of overlap. They are merged here into **14 modules**. Every later doc and phase refers to these IDs.

| ID | Module | What it does | Sources | Side |
|---|---|---|---|---|
| **M1** | Trusted Circle | Private group of contacts with priority order and preferred channels. | I1#14 | Citizen |
| **M2** | Silent SOS | Hold-to-trigger SOS in the app or from a wearable. Short cancel window. "I'm safe" needs a PIN. | I1#1, I2§1, I3-C§3 | Citizen |
| **M3** | Live Location | Real-time location during an SOS or journey, shared through a secure live link. | I1#3, I2§1 | Citizen, Contact |
| **M4** | Dispatch & Smart Escalation | Alerts the circle and the nearest responder. Tracks acknowledgements. Escalates when nobody responds (dead-man switch). Multi-channel delivery with offline/SMS fallback. | I1#2, I1#6, I1#7, I2§1, I2§3 | System |
| **M5** | Authority Console | Live incident board, SLA countdown matrix, supervisor escalation, patrol dispatch. | I2§6, I3-A§1 | Authority |
| **M6** | Smart Complaints & AI Triage | Report by text or voice with automatic GPS. Confidential mode. AI scores severity and category and routes the report to the local station. | I3-C§1 | Citizen |
| **M7** | Accountability Lock | AI baseline score. Officers cannot downgrade without a written justification. Overrides are logged and reviewed weekly. | I3-A§3 | Authority |
| **M8** | Call & Connect + FIR Draft | In-app call (no phone numbers exposed, every attempt timestamped). Mandatory "physical visit?" gate with reason codes. One-click FIR draft with evidence attached. | I3-A§2, I3-A§4 | Authority |
| **M9** | Evidence Vault | Capture or upload. Hashed (SHA-256), encrypted and time-stamped. Unlocked with a passkey. Shared only when the citizen chooses. Includes time-limited emergency audio. | I1#9, I1#10, I2§2, I3-C§2 | Both |
| **M10** | Chain of Custody & Procedural Workflow | Configurable procedural state machine (no skipped steps), geofence checks, two-signature evidence lock, custody hand-offs, evidence dashboard, anti-suppression replication, ledger anchoring ("blockchain"). | I1#11, I2§2, I2§3, I2§6 | Authority |
| **M11** | Safe Maps & Journeys | Unsafe-zone heatmap, nearby safe points, safest-route suggestion, active monitoring that escalates automatically on stop, deviation or disconnect. | I1#4, I1#5, I1#13, I3-C§4 | Citizen |
| **M12** | Deterrence | "Walk With Me" interactive fake call. | I3-C§5 | Citizen |
| **M13** | Wearable Device | ESP32 keychain: 1 click = fake call, 2 clicks = stealth recording, long press = SOS straight to the server. Tamper alert, low-battery mode. | I1#1, I1#8, I2§1, I3-C§3 | Device |
| **M14** | Oversight & AI Anomalies | Flags missing procedural steps, late uploads, GPS mismatches, unusual evidence access and repeated failed logins for human review. | I1#12, I2§5 | Authority |

**Cross-cutting platform capabilities** used by every module:

- **Integrity ledger & incident timeline** (I1#15, I2§4). Every important action is appended to a hash-chained log. Every timeline in the UI is a view of that log.
- **Notifications** (in-app, push, email, SMS, WhatsApp), **realtime updates**, **durable timers**, **auth and roles**.

**Out of scope for now:**

- The pitch animation video (end of I3). It is a separate deliverable.
- Integration with official government systems such as ERSS-112 dispatch or CCTNS FIR filing. We generate **drafts** that officers file in the official system.
- Native mobile apps. A Capacitor wrapper is the later path for lock-screen and background features (see §6).

---

## 4. Product principles

1. **One big action per screen.** SOS is always one press away.
2. **Fail toward safety.** Silence is a signal: a missed heartbeat or an unacknowledged alert escalates. AI may raise severity on its own; only a human with a written justification can lower it.
3. **Humans decide, AI flags.** AI scores, explains and flags. It never makes a legal decision (I2 design note).
4. **Append-only truth.** Important records are never edited or deleted. Corrections are new events. Everything is hashed into the ledger.
5. **Private by default.** Location is shared only during an active SOS or journey. Reporting can be confidential. Evidence stays with the victim until she shares it.
6. **Works on bad networks.** Small payloads, retries, an offline queue and an SMS fallback.
7. **Configurable, not hard-coded law.** Procedural workflows, SLA times, escalation ladders and legal-code mappings are data. Authorized admins edit them, and legal advisors review them (I2 design note).

---

## 5. Cleaner workflows & simple UI

### Citizen app (mobile-first)

Bottom navigation with five tabs: **Home · Map · Report · Vault · Circle**.
A persistent SOS control is reachable from every screen.

| Task | Steps |
|---|---|
| Trigger SOS | Press and hold for 2 s. A 3 s countdown allows cancelling. **1 gesture.** |
| Report an incident | Speak or type, confirm the location, submit. **1 screen.** |
| Save evidence | Record or pick a file. It is sealed automatically. **1 step.** |
| Safe route | Enter a destination, choose "Safest", start the journey. **3 taps.** |
| Fake call | Tap "Fake call" or click the wearable once. **1 step.** |

### Authority console (desktop-first)

Sidebar: **Live · Queue · Cases · Map · Reviews · Admin**.

- Every list is sorted by urgency (SLA time left), never by arrival time alone.
- Every item shows **one primary next action**:
  Acknowledge → Call → Decide on a visit → Resolve, or Convert to FIR.
- Red flashing is reserved for escalations, to avoid alarm fatigue.

### Visual language

- Severity colors:
  **L5 Critical** (red), **L4 High** (orange), **L3 Elevated** (amber), **L2 Moderate** (blue), **L1 Low** (slate).
- Calm neutral base, large touch targets (≥ 48 px), light and dark themes, WCAG 2.2 AA contrast.
- Plain status language: "Priya saw your alert 12 s ago", not "ACK_RECEIVED".
- Technical detail (hashes, signatures) sits behind a **Details** toggle.
- English first. Hindi follows (Phase 9).

---

## 6. What a website can and cannot do

This is a web app (React PWA). Some ideas in the PDFs assume a native phone app. Being honest about this early avoids surprises.

| Requirement | Browser / PWA reality | Our approach |
|---|---|---|
| SOS while the phone is locked | Web pages cannot run in the background or on the lock screen. | The wearable sends SOS **directly to the server** over LTE/Wi-Fi (M13). Later: native wrapper (Capacitor). |
| Automatic SMS fallback | Browsers cannot send SMS silently. | One-tap prefilled `sms:` link with GPS. The wearable's modem sends SMS on its own. The server sends SMS to contacts when online. |
| Bluetooth wearable | Web Bluetooth works in Chrome/Edge on Android and desktop only. Not iOS. The page must be open. | Device talks to the cloud directly. Web Bluetooth is used for pairing and the 1-click / 2-click gestures on Android. |
| Lock-screen fake-call widget | Not possible on the web. | Home-screen shortcut (PWA manifest shortcuts), the wearable's 1-click, or a timer. |
| Background location during a journey | Throttled or stopped when the tab is hidden or the screen is off. | Screen Wake Lock keeps the screen on. **Lost heartbeat itself triggers escalation** (fail-safe). |
| Biometric vault unlock | Supported through WebAuthn passkeys (Face ID / fingerprint). | Used for vault unlock and officer signatures. |
| Push notifications | Web Push works. On iOS (16.4+) only after "Add to Home Screen". | Push first, then SMS, WhatsApp and email as backups. |
| Evidence hidden from the gallery | In-app capture never touches the gallery. | Supported. |

---

## 7. Small additions recommended

These are not in the PDFs, but each one closes a real safety gap at low cost.

- **Duress PIN.** Entering it at "I'm safe" looks like a normal cancel, but the alert silently stays active and escalates.
- **SOS cancel window and false-alarm codes.** These stop accidental triggers from eroding trust with responders.
- **"Arrived safely" check-out.** Ending a journey tells the watching contacts automatically.
