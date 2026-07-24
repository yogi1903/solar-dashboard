# Greentek Alliance · Solar Monitor — Feature Roadmap

**Product:** Customer-facing solar monitoring app for residential & small-business owners
**Audience:** Non-technical. They care about two things: _"is it working?"_ and _"how much am I saving?"_
**Design language:** Apple philosophy — one hero number per card, plain language, technical data tucked away
**Theme:** Greentek Alliance (cream `#f3f1ea`, deep teal `#0d201d`, gold `#c9a460`, Inter + Bricolage Grotesque)

---

## Product principles

1. Show outcomes (₹, kWh, "All good"), hide machinery (voltage, frequency, PR — installer-only)
2. Every number framed in money or plain words
3. Nothing on the default screen that can cause needless worry
4. The app doubles as a referral engine — happy customers share real numbers

---

## Phase 1 — Core dashboard ✅ BUILT

- Day / Month / Year views with fitness-app-style period pickers (calendar sheet, month grid, year list)
- Live power hero, daily power curve, savings in ₹, CO₂ avoided, trees equivalent
- Performance percentile vs similar plants (weather-normalized) with explainer tooltip
- PDF report download per period (branded A4, full breakdown)
- Settings tab: customer-editable tariff (₹/kWh, persisted), system info, support
- Technical details behind a collapsed toggle
- Lifetime totals strip + referral prompt card

## Phase 1.5 — Grid outage tracking ✅ APPROVED, next build

Source: ShineMonitor alarms — "No utility fault" (code `0x00000009`), `happen time` → `disappear time` (empty = ongoing).

- Each alarm = one **outage event**: start, end, downtime
- **Lost energy ≈** expected generation for that window (plant's typical curve by month/hour) − actual; **lost ₹** = lost kWh × customer tariff. Always labeled "≈"
- **Amber, not red** — a grid outage is not the plant's fault; red reserved for plant faults
- Night outage → "No production impact"

Display:

- **Day:** header pill → 🟠 "Grid outage"; hero → "Not producing — grid outage since 10:18 AM"; shaded amber band on the power curve; outage card "1 h 24 m · ≈4.9 kWh lost (≈₹43)"; multiple outages listed with total
- **Month:** summary line "3 outages · 4.2 h · ≈18 kWh lost (≈₹158)"; amber dot under affected day bars; expandable outage list
- **Year:** yearly summary line; affected months dotted; **"Grid uptime 99.2%"** trust metric (strong for small businesses — reframes solar as reliability)

Strategic value: makes "you lost ₹X to grid outages" visible → future battery/UPS upsell opening.

## Phase 2 — Engagement & retention (recommended next)

| Feature                            | Why it matters                                                                                                                      | Data needed                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Investment payback tracker**     | "₹1,09,120 recovered · 39% · break-even ≈ June 2029" progress bar. Justifies the purchase to family/CA/neighbours                   | System cost (one-time input at onboarding)                      |
| **Shareable monthly summary card** | One tap → branded image for WhatsApp status with the customer's real numbers. Every share is a referral touchpoint                  | Existing monthly data                                           |
| **Tomorrow's generation forecast** | "Tomorrow: sunny — expect ≈24 kWh." Habit-forming morning check                                                                     | Free weather API + plant's historical curve                     |
| **Cleaning / maintenance nudges**  | Dust costs 15–25% generation in India. "Generation 12% below normal — a panel cleaning may help." Service revenue hook for Greentek | Expected-vs-actual comparison (already computed for percentile) |

## Phase 2.5 — Live data integration ✅ BUILT & verified in dev (build passes; proxy returns real ShineMonitor JSON)

Source: ShineMonitor Open API (KSolare inverter line) — full reference in [live-mode.md](live-mode.md).

- Browser-side client (`src/lib/shineClient.ts`): SHA1-signed auth (~5-day token cached in localStorage), 3× retry with backoff, one re-auth on API error
- Live source (`src/lib/liveSolar.ts`): period prefetch into module caches → UI reads stay synchronous; 5-min kW aggregated to hourly means; outage windows from real `0x00000009` alarms (powers Phase 1.5 with live data)
- Dispatcher (`src/lib/data.ts`): `VITE_DATA_SOURCE=live` + successful init → live reads; **automatic fallback to the deterministic mock** if the API is unreachable
- Vite dev proxy `/shinemonitor` → `http://api.shinemonitor.com/public/` (plain HTTP, no CORS)
- Single demo plant: pid 1207966 · 4.8 kW residential

⚠️ Credentials ship in the frontend bundle — **local demo only**; see the security note in live-mode.md.

## Phase 3 — Deferred (revisit after Phase 2)

| Feature                                   | Status / blocker                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bill reconciliation**                   | Deferred per owner decision — manual entry kills it; automatic requires **BBPS integration** (see below). Revisit with an aggregator partner                                                                                                                                                                            |
| **Net-metering / export view**            | Hardware-dependent: only plants with an export meter / CT clamp on the inverter expose "energy to grid" via ShineMonitor. Ship as a _conditional_ view that appears only for metered plants                                                                                                                             |
| **Multi-site switcher**                   | For small-business owners with 2–3 plants; header switcher. Cheap to build, schedule with small-business push                                                                                                                                                                                                           |
| **Quarterly performance certificate PDF** | Formal generation/savings document for loans, insurance, property resale                                                                                                                                                                                                                                                |
| **Warranty & documents vault**            | Inverter warranty countdown, installation certificate, net-meter agreement storage                                                                                                                                                                                                                                      |
| **Live-mode production hardening**        | Required before any real deploy of Phase 2.5: move `shineClient` logic server-side into the FastAPI `monitoring` module (see migration-plan.md) — credentials leave the frontend bundle, the ~5-day token is cached server-side, and per-customer plant mapping replaces the single shared `VITE_SHINEMONITOR_PLANT_ID` |
| **WhatsApp / push alerts**                | Moved from Phase 2 per owner decision. Real-time notifications: "Grid outage started 10:18 AM" / "Grid back — you lost ≈2.1 kWh (₹18)" / "No generation today — check the MCB". Needs a messaging backend (WhatsApp Business API / push service) — build once outage events (Phase 1.5) and offline detection exist     |

---

## Technical notes

### Automatic electricity bills — BBPS

BHIM / Amazon Pay fetch bills through **BBPS (Bharat Bill Payment System)**, NPCI's national bill network. Every major DISCOM is a registered "biller."

- Customer's **consumer number (CA number)** is stored once at onboarding
- App calls the BBPS **bill-fetch API** → DISCOM returns live bill (amount, due date, units)
- Greentek can't join BBPS directly (RBI-regulated entities only), but licensed **API aggregators resell bill-fetch**: Setu (Pine Labs), Razorpay, Decentro, Eko — simple REST API, per-call fee
- Effort: partner onboarding + KYC + per-customer consumer number capture. Phase 3 project

### Net-metering data sources

1. **Inverter-side (preferred):** export meter / CT clamp wired via RS485 → ShineMonitor exposes grid export power/energy. Confirm at installation time
2. **DISCOM bill:** import/export units printed monthly → only reachable manually or via BBPS

### Historical data storage

One table (PostgreSQL + TimescaleDB recommended): **one row per plant per day** — daily total + 24-element hourly array.

| Per plant                      | Size       |
| ------------------------------ | ---------- |
| Hourly values (24 × uint16 Wh) | 48 B/day   |
| Daily total + row overhead     | ~100 B/day |
| **Per plant-day**              | **~150 B** |
| **Per plant-year**             | **~55 KB** |
| 1,000 plants / year            | ~55 MB     |
| 10,000 plants / year           | ~0.55 GB   |

Not a big-data problem — a basic managed Postgres holds a decade for tens of thousands of plants.

### Archival strategy (rollup, not deletion)

- **Hot (0–12 months):** full hourly + daily rows — powers day-level history
- **Warm (1+ years):** monthly job strips hourly arrays; **daily totals kept forever** (~4 KB/plant-year) — powers year/lifetime views
- **Cold (optional):** stripped hourly rows exported as gzipped Parquet to S3 (~₹2/GB/month) before rollup — compliance / reprocessing insurance
- Start building the archival job when live data crosses ~9 months
