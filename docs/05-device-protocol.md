# 05 · Wearable protocol and mock data

There is no IoT hardware yet, so the app ships a **virtual wearable**. It sends exactly what the
ESP32 keychain will send: the same events, the same signature, the same endpoint. Building the
real device later means implementing this page in firmware. Nothing on the server changes.

| Way to send events | Where | Good for |
|---|---|---|
| Virtual wearable | App → Wearables → **Open the virtual wearable** (`/app/devices/simulator`) | Demos, trying SOS end to end, filling the app with realistic data |
| Command line | `node tools/device-simulator.mjs` | Scripted demos, testing, the reference for the firmware |
| ESP32 keychain | Phase 8 | The real thing |

---

## 1. Pairing

A device belongs to one person. Pairing creates it and issues its secret:

- **Virtual wearable:** press **Pair virtual wearable**. The secret is kept in the browser
  (`localStorage`), like a real device keeps it in flash. In another browser, **Reconnect** issues
  a new secret and the old one stops working.
- **Keychain:** Wearables → **Pair a hardware keychain** shows `DEVICE_ID` and `DEVICE_SECRET`
  once, to be written into the firmware.

Under the hood these are the RPCs `register_device(p_name, p_kind)` and
`reset_device_secret(p_device_id)`. The secret is 32 random bytes as 64 hex characters, stored in
`private.device_secrets`, which the API never exposes.

---

## 2. Sending an event

```http
POST {SUPABASE_URL}/rest/v1/rpc/device_event
apikey: {SUPABASE_PUBLISHABLE_KEY}
Content-Type: application/json

{
  "p_device_id": "44a01cae-7a2a-4158-a536-513314b95e5f",
  "p_body": "{\"type\":\"sos\",\"ts\":1790950000,\"nonce\":\"9f2c41d07ab3e655\",\"lat\":28.6328,\"lng\":77.2196,\"accuracy_m\":8,\"battery_pct\":81}",
  "p_signature": "5b0c…64 hex characters…"
}
```

- Only the publishable key is sent (in `apikey`), never an `Authorization` header. The device acts
  as an anonymous caller; the signature is what proves who it is.
- `p_body` is a **string**: the exact JSON text that was signed.
- `p_signature` is `hex(HMAC-SHA256(key = the secret's 64 characters as ASCII bytes, message = p_body as UTF-8 bytes))`.

Postgres checks the signature itself (`device_event()` in
`supabase/migrations/20261002161421_circle_sos_devices.sql`), so there is no Edge Function in the
path and no cold start.

### Body fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | yes | `sos`, `location`, `heartbeat`, `gesture`, `tamper`, `battery_low` |
| `ts` | number | yes | Unix time in seconds. Must be within 5 minutes of server time (sync with NTP). |
| `nonce` | string | yes | 8 to 64 characters of `A-Z a-z 0-9 - _`. Never reuse one on the same device. |
| `lat`, `lng` | number | no | Both or neither. Decimal degrees, rounded to 6 places. |
| `accuracy_m` | number | no | GPS accuracy radius in metres. |
| `battery_pct` | number | no | 0 to 100. |
| anything else | any | no | Kept in `device_events.payload`, e.g. `clicks`, `reason`, `signal_dbm`. |

### What each event does

| Type | Gesture on the keychain | Server effect |
|---|---|---|
| `sos` | Long press (3 s) | Starts an SOS for the owner, exactly like the app button (source `simulator` or `device`), with the position as its first point and a ledger entry naming the device. If an SOS is already active, it is reused. The circle is alerted automatically, exactly as for the app button. |
| `location` | Every few seconds during an SOS | Adds a point to the owner's active SOS. Without one, it only updates the device's last position. |
| `heartbeat` | Every few minutes | Updates last seen and battery. |
| `gesture` | 1 click: fake call · 2 clicks: stealth recording | Stored. The phone acts on it from Phase 7. |
| `tamper` | Case opened or removed | Marks the device `tamper` and writes a ledger entry. The owner clears it in the app. |
| `battery_low` | Battery under 15 % | Ledger entry. |

### Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"accepted": true, "event_id": 12, "incident_id": "…" or null}` | Stored. `incident_id` is set when the event belongs to an SOS. |
| 403 | `{"message": "Bad signature"}` or `"Unknown device"` | Wrong secret, wrong device id, or the body changed after signing. Don't retry. |
| 409 | `{"message": "Replayed request: nonce already used"}` | Same nonce twice. |
| 400 | `{"message": "…"}` | Invalid body: unknown type, bad `ts` (clock more than 5 minutes off), bad nonce, `lat` without `lng`. |

**Retrying:** if a request times out, send it again with a **new nonce and timestamp**. A second
`sos` while one is active joins the same incident, so retries never create duplicates.

---

## 3. Command-line simulator

```bash
export DEVICE_ID=...        # from the app: Virtual wearable → For developers
export DEVICE_SECRET=...
node tools/device-simulator.mjs demo                 # SOS, then walk Connaught Place → Janpath
node tools/device-simulator.mjs sos --lat 28.61 --lng 77.23
node tools/device-simulator.mjs walk --start 10 --steps 20 --every 5
node tools/device-simulator.mjs heartbeat --battery 64
node tools/device-simulator.mjs gesture --clicks 2
node tools/device-simulator.mjs tamper
```

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` default to `frontend/.env.production`. Node 18 or
newer, no `npm install` needed.

The same request with `curl` and `openssl`:

```bash
BODY="{\"type\":\"heartbeat\",\"ts\":$(date +%s),\"nonce\":\"$(openssl rand -hex 8)\",\"battery_pct\":70}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$DEVICE_SECRET" -r | cut -d' ' -f1)
curl -s "$SUPABASE_URL/rest/v1/rpc/device_event" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$DEVICE_ID" --arg body "$BODY" --arg sig "$SIG" \
        '{p_device_id: $id, p_body: $body, p_signature: $sig}')"
```

---

## 4. Demo recipes

| You want to show | Do this |
|---|---|
| SOS from a wearable, live on the map | Virtual wearable → **Run demo**. Open the SOS, copy the live link and open it in another browser or phone. |
| A contact responding | On the live link, enter a name and tap **I'm responding**. The citizen's SOS screen shows it within 5 seconds. |
| Duress | Settings → set an SOS PIN and a duress PIN. During an SOS, end it with the duress PIN: the citizen's screen says "safe", the live link warns that she may not be safe. |
| Tamper and battery | Virtual wearable → **Tamper** or **Low battery**. Wearables shows the alert. |
| History and evidence | Home → **Past SOS** → the timeline, with every step numbered in the ledger. |

---

## 5. Notes for the ESP32 firmware (Phase 8)

- Keep `DEVICE_ID` and `DEVICE_SECRET` in NVS (encrypted flash); never log the secret.
- Sync time with NTP at boot and every few hours; without it, `ts` is rejected.
- HMAC-SHA256 is in mbedTLS (`mbedtls_md_hmac`). Sign the exact bytes you send as `p_body`.
- Long press: buzz once, send `sos` with the last GNSS fix right away (don't wait for a new fix),
  then send `location` every 5 to 10 seconds. If there is no data network, send the SMS fallback
  with a maps link to the stored contacts.
- Heartbeat every 5 minutes, every 30 in low-battery mode. The SOS path always stays available.
