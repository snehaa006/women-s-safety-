# 03 · Workflows

> Step-by-step flows for every feature. Each one lists the **rules** the backend enforces.
> Architecture details are in [02-architecture.md](02-architecture.md).

| # | Workflow | Modules |
|---|---|---|
| 1 | [SOS: trigger to resolution](#1-sos-trigger-to-resolution) | M2, M3, M4 |
| 2 | [Incident states](#2-incident-states) | M2 |
| 3 | [Escalation ladder](#3-escalation-ladder) | M4, M5 |
| 4 | [Offline SOS](#4-offline-sos) | M4 |
| 5 | [Smart complaint: intake and triage](#5-smart-complaint-intake-and-triage) | M6 |
| 6 | [Complaint lifecycle](#6-complaint-lifecycle) | M5, M8 |
| 7 | [Accountability lock](#7-accountability-lock) | M7 |
| 8 | [Evidence vault: capture, seal, share](#8-evidence-vault-capture-seal-share) | M9 |
| 9 | [Case procedural workflow](#9-case-procedural-workflow) | M10 |
| 10 | [Custody transfer](#10-custody-transfer) | M10 |
| 11 | [Journey monitoring](#11-journey-monitoring) | M11 |
| 12 | [Fake call](#12-fake-call) | M12 |
| 13 | [Wearable gestures](#13-wearable-gestures) | M13 |

---

## 1. SOS: trigger to resolution

```mermaid
sequenceDiagram
  autonumber
  actor U as Citizen
  participant App as Citizen app
  participant API as Supabase API
  participant DB as Postgres
  participant W as Cron + notify function
  actor C as Trusted contacts
  actor O as Duty officer

  U->>App: Press and hold SOS, or wearable long press
  App->>API: rpc create_sos with location and client id
  API->>DB: One transaction: incident + first location + ledger entry + dispatch job
  API-->>App: 201 incidentId and live link
  W->>DB: Pick up dispatch job
  W->>C: Push, email or SMS with live link
  W->>O: Console alert and push for the responsible station
  W->>DB: Schedule escalation check in 2 min
  loop Every 5 s while active
    App->>API: rpc record_location
    API-->>C: Live location over WebSocket
    API-->>O: Live location over WebSocket
  end
  O->>API: Acknowledge
  API->>DB: Ack + ledger entry, pending escalation becomes a no-op
  API-->>App: Officer acknowledged
  O->>API: Dispatch patrol unit with ETA
  API-->>App: Unit on the way, ETA shown
  U->>App: I'm safe + PIN
  App->>API: rpc resolve_incident
  API->>DB: Resolve + ledger entry, live link closes
```

**Rules**

- `rpc create_sos` must answer in under 500 ms. Everything slow (notifications) happens in jobs.
- The same client id never creates a second incident.
- The responsible station is the one whose jurisdiction polygon contains the location. If there is none, the nearest station.
- "I'm safe" requires the SOS PIN. The **duress PIN** shows the same "cancelled" screen, but the incident stays active and escalates silently.
- The live link shows only this incident and expires 24 h after resolution.

---

## 2. Incident states

```mermaid
stateDiagram-v2
  [*] --> Countdown: SOS pressed
  Countdown --> Cancelled: cancelled within 3 s
  Countdown --> Active: countdown ends, alerts sent
  Active --> Acknowledged: contact or officer acknowledges
  Active --> Escalated: no ack before timeout
  Escalated --> Escalated: next level
  Escalated --> Acknowledged: ack at any level
  Acknowledged --> Responding: unit dispatched
  Responding --> OnScene: unit arrived
  Active --> Resolved: I'm safe + PIN
  Acknowledged --> Resolved: resolution code
  Responding --> Resolved: resolution code
  OnScene --> Resolved: resolution code
  Resolved --> [*]
  Cancelled --> [*]
  note right of Active
    Duress PIN looks like a cancel
    but keeps the incident Active
  end note
```

**Resolution codes:** `user_safe`, `assisted_on_scene`, `transferred_to_case`, `false_alarm`, `duplicate`.
Every transition is a ledger entry, and together they form the incident timeline.

---

## 3. Escalation ladder

The same engine runs SOS escalation and complaint SLAs ([02-architecture.md §7](02-architecture.md#7-escalation--sla-engine-dead-man-switch)).

```mermaid
flowchart TD
  A["Alert created"] --> L0["L0: all trusted contacts + station duty officers"]
  L0 --> Q0{"Acknowledged within 2 min?"}
  Q0 -- Yes --> STOP["Stop escalation, record who acknowledged"]
  Q0 -- No --> L1["L1: station supervisor + SMS/WhatsApp reminder to contacts"]
  L1 --> Q1{"Acknowledged within 3 more min?"}
  Q1 -- Yes --> STOP
  Q1 -- No --> L2["L2: district control room, flashing red"]
  L2 --> Q2{"Acknowledged?"}
  Q2 -- Yes --> STOP
  Q2 -- No --> REP["Repeat L2 every 2 min + notify oversight"]
  REP --> Q2
```

**Rules**

- Timeouts and targets come from `escalation_policies`, not code.
- Every escalation step appends a ledger entry. A missed SLA is permanently visible in reviews.
- Acknowledging is one click, and the first acknowledgement stops the ladder for everyone.
- **Built in Phase 1 (contacts only):** L0 alerts the circle in the SOS transaction; a `sos.reminder` job 2 minutes later re-alerts the circle and records `sos.no_response` unless someone is responding. Phase 2 adds officers, supervisors and the policy table.

---

## 4. Offline SOS

```mermaid
flowchart TD
  T["SOS triggered"] --> N{"API reachable?"}
  N -- Yes --> OK["Normal SOS flow"]
  N -- No --> Q["Save SOS in IndexedDB + register Background Sync"]
  Q --> SMS["One-tap SMS: prefilled message + GPS link to contacts, and 112"]
  Q --> RT["Retry with backoff: 2 s, 4 s, 8 s ..."]
  RT --> N2{"Back online?"}
  N2 -- Yes --> SEND["Send queued SOS with original timestamp"]
  N2 -- No --> RT
```

**Rules**

- GPS works without data, so the SMS always carries coordinates (`https://maps.google.com/?q=lat,lng`).
- A queued SOS keeps its **original** trigger time. The ledger records both when it happened and when the server received it.
- The wearable's modem handles its own SMS fallback ([§13](#13-wearable-gestures)).
- The queued SOS keeps its client id, so sending it twice can never create two incidents. The server refuses times in the future or more than a day old.
- Until the service worker exists, the queue is sent while the app is open (on start, on the browser's `online` event, and with backoff). The SMS fallback does not depend on it.

---

## 5. Smart complaint: intake and triage

```mermaid
sequenceDiagram
  autonumber
  actor U as Citizen
  participant App as Citizen app
  participant API as Supabase API
  participant R as Rules engine
  participant W as Triage function
  participant AI as AI provider
  actor O as Station officer

  U->>App: Speak or type what happened, GPS auto-filled
  U->>App: Optional: switch on Confidential mode
  App->>API: rpc submit_complaint with text, audio and location
  API->>R: Score the text
  R-->>API: Severity floor + category hint
  API->>API: Route to station by location, start SLA timer, ledger entry with content hash
  API-->>App: Sent to Sector 21 Police Station, contact expected within 10 min
  API-->>O: New queue item with countdown
  W->>AI: Transcribe and classify
  AI-->>W: Category, severity, rationale, legal tags
  W->>API: final severity = max of rules floor and AI
  API-->>O: Severity updated, SLA tightens if higher
```

**Rules**

- The citizen sees the confirmation immediately, before the AI result arrives (I3-C§1 "Immediate action").
- The complaint text and audio are hashed at submission, so the citizen's exact words are anchored (I3-A§4).
- AI never lowers severity below the rules floor. AI never closes or rejects anything.
- **Confidential mode:** officers see a pseudonym and talk to the citizen through in-app channels only. Revealing her identity requires her consent in the app.

---

## 6. Complaint lifecycle

This covers Call & Connect, the dispatch gate and the FIR draft (I3-A§2, I3-A§4).

```mermaid
stateDiagram-v2
  [*] --> Submitted
  Submitted --> Triaged: rules + AI score
  Triaged --> Acknowledged: officer acks within SLA
  Triaged --> Escalated: SLA missed
  Escalated --> Acknowledged: ack at higher level
  Acknowledged --> Contacted: in-app call attempted
  Contacted --> VisitDispatched: gate answer is visit required
  Contacted --> NoVisit: gate answer is no visit + reason code
  VisitDispatched --> Investigating: unit on scene
  Investigating --> FIRDrafted: offence confirmed
  Investigating --> Closed: resolved, no offence
  NoVisit --> Closed: resolution recorded
  FIRDrafted --> CaseOpened: FIR filed
  CaseOpened --> [*]
  Closed --> [*]
```

**Rules**

- **Call & Connect:** an officer cannot leave `Acknowledged` without at least one logged contact attempt (start time, connect time, outcome). Calls are browser-to-browser, so neither side sees the other's phone number.
- **Dispatch gate:** after the call, the console forces the question **"Physical visit required?"**
  - **Yes:** the GIS map opens and the nearest available patrol unit is suggested and assigned.
  - **No:** the officer must pick a standard reason code, for example `citizen_safe_at_home`, `report_only`, `referred_to_cyber_cell`.
- **FIR draft:** one click fills in the citizen's original words (with their hash), time, GPS and reverse-geocoded address, suggested legal tags, and evidence links with hashes and QR codes to `/verify`. Each saved version is hashed into the ledger. The officer files the official FIR in the government system.
- Closing always requires a resolution code. Nothing is ever deleted.

---

## 7. Accountability lock

From I3-A§3: police cannot quietly register a serious threat as a minor issue.

```mermaid
flowchart TD
  A["Officer sets final severity or category"] --> B{"Lower than the AI severity?"}
  B -- No --> OK["Saved + ledger entry"]
  B -- Yes --> C["Hard block: justification required"]
  C --> D["Officer types or records a justification + picks a reason code"]
  D --> E["Override saved: AI verdict, officer verdict, justification, all in the ledger"]
  E --> F["Added to the supervisor's weekly review queue"]
  F --> G{"Supervisor decision"}
  G -- Upheld --> H["Review closed, ledger entry"]
  G -- Reversed --> I["Severity restored, officer notified, ledger entry"]
```

**Rules**

- The justification needs a minimum length, or a voice note. Picking a reason code alone is not enough.
- Each officer's override rate shows in oversight reports. An unusually high rate opens an anomaly (M14).
- Raising severity is never blocked.

---

## 8. Evidence vault: capture, seal, share

```mermaid
sequenceDiagram
  autonumber
  actor U as Citizen
  participant App as Citizen app
  participant API as Supabase API
  participant S as Storage
  participant W as Verify function
  participant L as Ledger

  U->>App: Record or pick a file
  App->>App: SHA-256 in the browser, read GPS and time
  App->>API: rpc register_evidence with hash, size, type, capturedAt, location
  API-->>App: itemId + storage path
  App->>S: Upload file to own folder
  App->>W: Verify upload
  W->>S: Read the stored file
  W->>W: Re-compute SHA-256
  alt Hash matches
    W->>L: Append evidence.sealed with hash, owner, time, place
    W-->>App: Sealed
  else Hash differs
    W->>L: Append evidence.rejected
    W-->>App: Upload failed, retry
  end
  U->>App: Attach to a report or share with the station
  App->>API: rpc share_evidence
  API->>L: Append evidence.shared to the organization
```

**Rules**

- Opening the vault needs a passkey (Face ID or fingerprint) once per session.
- Items shared with an authority can no longer be deleted. The citizen can only file a logged withdrawal request.
- Unshared items can be deleted with a passkey. They remain recoverable for 30 days and an email notice is sent, so a thief holding the phone cannot silently destroy evidence.
- Every view or download by anyone is a ledger entry.

---

## 9. Case procedural workflow

From I2§2, split into two clean levels: what happens to the **case**, and what happens to each **evidence item**.

### Case level (default "evidence handling" workflow, configurable)

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Reported
  Reported --> Assigned: investigating officer assigned
  Assigned --> SearchInitiated: officer at scene, geofence check
  SearchInitiated --> VideographyDone: scene video sealed
  VideographyDone --> EvidenceIdentified: items listed
  EvidenceIdentified --> EvidenceSeized: every item sealed
  EvidenceSeized --> Signed: officer + supervisor signatures
  Signed --> InCustody: custody chain started
  InCustody --> Submitted: submitted to court
  Submitted --> [*]
```

### Evidence item level

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Registered: hash declared
  Registered --> Sealed: server re-hash matches
  Registered --> Rejected: hash mismatch
  Sealed --> Locked: two signatures
  Locked --> InTransfer: transfer initiated
  InTransfer --> Locked: receiver accepts, hash re-verified
  Locked --> Submitted: handed to court
  Submitted --> [*]
  Rejected --> [*]
```

### Workflow definitions are data

```yaml
key: evidence-handling
version: 1
states: [reported, assigned, search_initiated, videography_done,
         evidence_identified, evidence_seized, signed, in_custody, submitted]
transitions:
  - from: assigned
    to: search_initiated
    roles: [officer]
    requires:
      geofence: { within_m: 200 }          # officer's location vs. scene
  - from: search_initiated
    to: videography_done
    requires:
      evidence: { kind: video, status: sealed, min: 1 }
  - from: evidence_seized
    to: signed
    requires:
      signatures: [investigating_officer, supervisor]   # multi-signature
```

**Rules**

- A transition is accepted only from the current state, by an allowed role, with every requirement met. Otherwise the API returns `409` and lists what is missing. **An officer cannot skip required states** (I2).
- A geofence failure is recorded as "location mismatch" and flagged for review. It is not silently ignored. Workflow config decides whether it blocks.
- Every transition is a ledger entry. Mistakes are fixed by compensating events, never edits.
- The legal applicability of each step stays configurable and subject to legal oversight (I2 design note).

---

## 10. Custody transfer

Example chain: Officer A → Evidence Locker → Forensic Lab → Officer B → Court (I2).

```mermaid
sequenceDiagram
  autonumber
  actor A as Sender, e.g. Officer A
  participant API as API
  actor B as Receiver, e.g. Forensic Lab
  participant L as Ledger

  A->>API: Initiate transfer: item, receiver, location, purpose + passkey signature
  API->>L: Append custody.initiated
  API-->>B: Transfer request in console + push
  B->>API: Accept + passkey signature
  API->>API: Re-hash stored file, compare with sealed hash
  alt Hash unchanged
    API->>L: Append custody.accepted with both signatures, hash, location, time
  else Hash changed
    API->>L: Append custody.integrity_failed
    API-->>A: Alert + anomaly opened
  end
```

Each transfer records **sender, receiver, timestamp, location, evidence hash and both digital signatures** (I2).

---

## 11. Journey monitoring

From I3-C§4: dynamic mapping, background heartbeat and automated escalation.

```mermaid
flowchart TD
  S["Start journey: destination, chosen route, watching contacts"] --> P["Ping every 15 s, every 5 s in high-risk cells at night"]
  P --> X{"Anything unusual?"}
  X -- "Off route over 150 m for 60 s" --> CK["Check-in: Are you OK? Enter PIN"]
  X -- "Stopped over 3 min, not at a safe point" --> CK
  X -- "No ping for 45 s" --> AL["Alert contacts with live link"]
  X -- "All normal" --> ARR{"Arrived?"}
  ARR -- Yes --> DONE["Notify contacts: arrived safely"]
  ARR -- No --> P
  CK --> R{"Answered within 60 s?"}
  R -- "Correct PIN" --> P
  R -- "No answer or duress PIN" --> AL
  AL --> R2{"Any contact acknowledges within 2 min?"}
  R2 -- Yes --> FOL["Contacts follow the live link"]
  R2 -- No --> SOS["Automatic SOS to responders"]
```

**Rules**

- A lost heartbeat skips the check-in, because the phone may be dead or snatched. Silence is the alarm.
- Entering a high-risk cell at night switches on active monitoring automatically (faster pings) and shows a discreet banner.
- Location is collected only while a journey is active.

---

## 12. Fake call

From I3-C§5, "Walk With Me".

```mermaid
flowchart LR
  T["Trigger: Fake call button, home-screen shortcut, wearable 1-click, or timer"] --> R["Full-screen ringing UI, caller name e.g. Dad"]
  R --> A["Answer"]
  A --> S["Scripted voice asks questions, leaves 5-10 s pauses, mentions the current street"]
  S --> E{"User action"}
  E -- "End call" --> X["Back to app"]
  E -- "Hidden SOS gesture" --> SOS["Silent SOS"]
```

**Rules**

- It must ring within 1 s of the trigger. Audio and script are cached offline.
- Voice lines come from pre-recorded clips or in-browser text-to-speech. The street name comes from reverse geocoding the current location.
- The ringing screen copies a native call screen. It vibrates on Android (the Vibration API is not available on iOS).

---

## 13. Wearable gestures

From I3-C§3 and I2§1.

| Gesture | Action | Path | Needs the phone? |
|---|---|---|---|
| 1 click | Fake call on the phone | BLE → PWA (open, Android Chrome) | Yes |
| 2 clicks | Stealth audio recording | BLE → PWA | Yes |
| Long press (3 s) | SOS with GPS | LTE/Wi-Fi → API directly, SMS fallback | **No** |
| Heartbeat (every few minutes) | Battery, signal, armed status | LTE/Wi-Fi → API | No |
| Tamper (case opened, removed, heartbeat lost) | Tamper alert to citizen and contacts | Device event, or the server notices missing heartbeats | No |

```mermaid
sequenceDiagram
  autonumber
  participant D as Wearable
  participant API as device_event RPC
  participant W as Cron + notify function
  actor C as Contacts and station
  D->>D: Long press 3 s, haptic buzz
  D->>D: Get GNSS fix, or last known position
  D->>API: POST /rest/v1/rpc/device_event, type sos with lat, lng, battery + HMAC
  API->>API: Verify signature, timestamp window, nonce
  API-->>D: 200 accepted, device buzzes twice
  API->>W: Same dispatch flow as an app SOS
  W->>C: Alerts with live link
  Note over D,API: No data network? The device sends an SMS with a GPS link to contacts
```

**Device protocol**

- Pairing assigns `device_id` plus a per-device secret.
- Each request carries the body text (with `ts` and `nonce` inside) and `HMAC-SHA256(secret, body)`.
- Requests more than 5 minutes off server time, or with a reused nonce, are rejected.
- Until the hardware exists, the **virtual wearable** (`/app/devices/simulator`) and `tools/device-simulator.mjs` send the same requests. Full spec: [05 · Wearable protocol](05-device-protocol.md).
- **Low-battery mode** stretches the heartbeat interval but always keeps the SOS path available.
