# Migration Plan — Solar Monitoring Dashboard → Greentek Alliance Stack

**Date:** 2026-07-23 · **Status:** proposed, awaiting approval

## Compatibility summary

| Layer               | Compatibility | Notes                                                        |
| ------------------- | ------------- | ------------------------------------------------------------ |
| Design system       | ~100%         | Same palette (`--brand-*` = `--gt-*`), fonts, radii, shadows |
| UI components       | ~80%          | JSX/logic reusable; TS → JS conversion needed                |
| PDF reports (jsPDF) | 100%          | Client-side, portable as-is                                  |
| Mock data layer     | 0%            | Replaced by API; its function shapes become the API contract |
| Routing / shell     | ~40%          | Merges into Alliance nav (glass topbar + role-aware tabs)    |
| Backend             | new module    | Fits FastAPI/Postgres/RQ/APScheduler patterns                |

## Decisions

1. **TS → JS** — Alliance stack is explicitly JS-not-TS. Mechanical conversion of ~4 files (strip types; no redesign).
2. **Vite → CRA section** — no second build system. Dashboard becomes `/monitoring` inside the Alliance React app; bottom tab merges into Alliance nav; `@/` alias preserved via CRACO.
3. **Mock → API** — `getDayData(date)` / `getMonthData(y,m)` / `getYearData(y)` map 1:1 to REST endpoints; UI swaps function calls for react-query hooks. Keep the mock as a dev fallback until ingestion is live.

## Backend: new `monitoring` module (FastAPI)

### Tables (Alembic migration)

- `plants` — user_id → plant SN / datalogger PN, system_kwp, tariff_rs_per_kwh, install_date, discom, location
- `plant_day` — PK (plant_id, date): total_kwh, hourly_wh smallint[24], peak_kw, sun_hours (~150 B/plant/day; ~55 KB/plant/year)
- `outage_events` — plant_id, alarm_code, description, happen_ts, disappear_ts (null = ongoing), est_lost_kwh, est_lost_rs

### Endpoints

- `GET /api/monitoring/summary` — live power, today, status, percentile
- `GET /api/monitoring/day?date=` — hourly curve + day stats + that day's outages
- `GET /api/monitoring/month?year=&month=` — daily totals + outages
- `GET /api/monitoring/year?year=` — monthly totals + outages + uptime %
- `PUT /api/monitoring/settings/tariff` — per-customer tariff (replaces localStorage)

### Ingestion (existing patterns)

- RQ worker polls ShineMonitor per plant every 15 min: hourly kWh, live power, alarm list ("No utility fault" `0x00000009` → outage_events)
- APScheduler nightly reconciliation finalizes the day (same pattern as existing nightly jobs)
- Redis: live-power cache (15-min TTL) + rate limiting
- Auth: existing JWT (HttpOnly cookie / Bearer); routes resolve user → plants

### Outage loss estimation (server-side)

lost_kwh ≈ expected_curve(month, hour) × outage_hours − actual_kwh; lost_rs = lost_kwh × tariff. Night outage → 0. Stored on the event at close (disappear_ts set).

## Frontend port order

1. Convert `Home.tsx`, `PeriodPicker.tsx`, `SettingsPanel.tsx`, `report.ts` → JS; move to `src/sections/monitoring/`
2. react-query hooks → new endpoints; mock layer kept behind `REACT_APP_MONITORING_MOCK=1`
3. Merge into Alliance shell: monitoring tab in bottom nav / sidebar; keep in-app Settings tab for tariff (now persisted via PUT)
4. Apply guidelines during port: data-testids, sonner toasts, tabular-nums, 12px buttons, gt-shadows, teal focus rings
5. Keep jsPDF reports client-side

## Infra

No changes: same Docker Compose services (+ worker load), same Caddy routing, same Lightsail box; GlitchTip auto-covers the new module. pg_dump backups cover the new tables.

## Effort estimate (1 developer)

| Workstream                             | Effort                        |
| -------------------------------------- | ----------------------------- |
| TS→JS conversion + shell integration   | 1–2 days                      |
| FastAPI module + tables + endpoints    | 2–3 days                      |
| ShineMonitor ingestion + outage events | 2–3 days (API-docs dependent) |
| Auth wiring + QA + deploy              | 1 day                         |
| **Total**                              | **~1.5–2 weeks**              |

## Open questions for the owner

1. ShineMonitor API credentials / rate limits / docs access — who provides?
2. One plant per user at launch, or multi-plant from day one (affects `plants` table UI)?
3. Historical backfill: import past ShineMonitor history for existing customers at migration, or start fresh?
4. TS→JS confirmed, or allow a TS island inside the JS codebase? (Recommend full JS per stack guidelines.)
