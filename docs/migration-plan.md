# Migration Plan v2 — Solar Monitoring Dashboard → Greentek Alliance Stack

**Date:** 2026-07-24 · **Status:** revised after review against the live Alliance stack (CLAUDE.md) — supersedes v1 (2026-07-23)

## What changed from v1, and why

| v1 assumption                                         | v2 correction                                                                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "RQ worker polls ShineMonitor per plant every 15 min" | **APScheduler enqueues poll jobs → RQ workers execute.** Matches the existing webhook/reconciliation pattern; retries, queue depth, and GlitchTip visibility come free. A worker must never own a polling loop. |
| Money fields unspecified                              | **All money is `Decimal` / `NUMERIC(10,2)`** (invariant #4): `tariff_rs_per_kwh`, `est_lost_rs`. Use the `reward_engine.money()` rounding convention.                                                           |
| "react-query hooks" on the frontend                   | **Use the existing axios layer** (`src/lib/api.js`, `withCredentials` + 401→refresh retry). Do not introduce react-query unless the Alliance app already uses it (verify before porting).                       |
| Upstream URL plain HTTP                               | **HTTPS verified working** on `api.shinemonitor.com` (2026-07-24). The server-side client uses HTTPS only; also flip the solar-dashboard dev proxy to HTTPS in the interim.                                     |
| No degradation story                                  | **Routes serve last-known data from Postgres** when ShineMonitor is unreachable; UI shows staleness. The vendor API being down must never break the dashboard.                                                  |
| No rollout plan                                       | **Staged rollout** (dark-run → reconcile → admin-only → pilot), below.                                                                                                                                          |
| Testing unspecified                                   | Backend: `test_monitoring*.py` under the pinned pytest config (**do not touch `addopts`**; `-n 0` for serial runs), `black`/`isort`/`flake8` clean. Frontend: CRA/jest.                                         |

Unchanged from v1: JS frontend (CRA section, TS→JS mechanical port), table shapes, 1:1 endpoint mapping to the mock layer's function shapes, ~1.5–2 week estimate, no infra changes.

## Architecture

```
ShineMonitor API (HTTPS)
   ↑  signed calls, credentials server-side only
monitoring_client.py  ← thin signed client (port of shineClient.ts logic)
   ↑
monitoring_ingest.py  ← RQ jobs: poll_plant(pid), close_outages(pid), nightly_finalize
   ↑ enqueued by                ↓ writes (idempotent upserts)
APScheduler (15 min + 2am IST)   PostgreSQL: plants / plant_day / outage_events
                                   ↓
routes_monitoring.py  ← /api/monitoring/*  (JWT via current_identity; user → plants)
   ↓ serves DB data, fetch-through for live power with Redis TTL
CRA frontend: src/sections/monitoring/ (JS, axios via src/lib/api.js)
```

The browser never talks to ShineMonitor. Credentials move from `VITE_*` frontend
vars to `backend/.env` via `config.py` (pydantic-settings): `SHINEMONITOR_USR`,
`SHINEMONITOR_PWD`, `SHINEMONITOR_COMPANY_KEY`. Password is stored as `SHA1(pwd)`
at most; signing happens server-side.

## Backend: `monitoring` module

New files, following existing conventions: `monitoring_client.py`,
`monitoring_ingest.py`, `routes_monitoring.py` (mounted under `/api` like every
other router), `test_monitoring.py`. Models added in `models.py`.

### Tables (Alembic migration, runs on startup like the rest)

- `plants` — id, member_id → `Member`, plant SN / datalogger PN, system_kwp,
  tariff_rs_per_kwh `NUMERIC(10,2)`, install_date, discom, location, tz (default
  `Asia/Kolkata`), active flag.
- `plant_day` — PK `(plant_id, date)`: total_kwh, hourly_wh `smallint[24]`, peak_kw,
  sun_hours, finalized bool. ~150 B/plant/day.
- `outage_events` — plant_id, alarm_code, description, happen_ts timestamptz,
  disappear_ts timestamptz null (ongoing), est_lost_kwh, est_lost_rs
  `NUMERIC(10,2)`. Unique on `(plant_id, alarm_code, happen_ts)` for dedupe.

### Endpoints (all behind `current_identity`; route resolves user → their plants)

- `GET /api/monitoring/summary` — live power (fetch-through, Redis 5-min TTL per
  plant, last-known on failure), today kWh, status, `as_of` timestamp
- `GET /api/monitoring/day?date=` — hourly curve + stats + that day's outages
- `GET /api/monitoring/month?year=&month=` / `GET /api/monitoring/year?year=`
- `GET /api/monitoring/lifetime` — lifetime totals (needed by the dashboard strip)
- `PUT /api/monitoring/settings/tariff` — `Decimal`, writes an `AuditEntry`
  (invariant #1); plant registration/admin changes audit too

Every response carries `as_of` / `stale` markers so the UI can say "updated 12 min
ago" instead of implying liveness it doesn't have.

### Ingestion

- **APScheduler every 15 min** enqueues `poll_plant(plant_id)` per active plant
  (fan-out via the queue, not a loop inside a worker). Job: fetch current data +
  5-min curve, upsert `plant_day` (idempotent on PK — safe to re-run), sync open
  `outage_events` from `0x00000009` alarms.
- **Nightly finalize (2am IST, next to the existing reconciliation job):** finalizes
  the previous day, closes outages whose `disappear_ts` arrived, computes
  `est_lost_*` with `Decimal` math: expected curve window − actual, × tariff.
- **Token cache:** the ~5-day ShineMonitor token lives in Redis (key per account),
  refreshed on expiry/401-equivalent — port of the browser client's re-auth logic.
- **Backoff / circuit breaker:** per-plant consecutive-failure counter in Redis;
  after N failures, skip the plant until the next cycle and report to GlitchTip.
  One bad plant must not stall the queue for others.
- **Backfill (open question 3):** one-off idempotent RQ job per plant pulling
  month/year aggregates, same upserts as polling.

### Timezones

ShineMonitor timestamps are plant-local strings. Convert with the plant's `tz`
(currently always IST) to `timestamptz` at ingest; FY starts April and all day
boundaries are IST — same convention as the reward engine.

## Frontend port (JS)

1. Port `Home.tsx`, `PeriodPicker.tsx`, `SettingsPanel.tsx`, `report.ts` → JS into
   `src/sections/monitoring/` (mechanical, ~4 files).
2. Data via the existing axios client (`src/lib/api.js`); mock kept behind
   `REACT_APP_MONITORING_MOCK=1` until ingestion is verified.
3. Merge into Alliance shell (nav tab); keep the in-app Settings tab, tariff now
   persisted via `PUT`.
4. Port the meaningful solar-dashboard tests (data-shaping, PeriodPicker) to jest.
5. jsPDF reports + share cards stay client-side.
6. UI handles `stale` responses: "Last updated 14:05" text, never fake-live.

## Rollout (the "rock solid" part)

1. **Dark-run:** deploy the backend module with only the demo plant (pid 1207966).
   Ingestion runs; no UI. 1 week.
2. **Reconcile:** automated job compares `plant_day` totals against ShineMonitor
   month/year aggregates; investigate drift > 2%. Manual spot-check against the
   vendor portal.
3. **Admin-only UI:** ship the frontend section gated to admin role; verify all
   views against the standalone solar-dashboard (kept as reference).
4. **Pilot:** attach 2–3 real customer plants; watch GlitchTip + queue depth for a
   week.
5. **General availability:** attach remaining plants; backfill history if approved.
6. **Decommission:** archive the standalone repo's role to "reference
   implementation"; the mock layer stays in the Alliance repo as the dev fallback.

Rollback at any stage = flip the feature flag off; the module owns no data that
other modules depend on.

## Deployment checklist

- [ ] Alembic migration applied by startup (existing mechanism)
- [ ] `SHINEMONITOR_*` in `backend/.env` (+ `.env.test` uses a fake; tests never hit the real API)
- [ ] `pytest` green under the pinned xdist config; `black`/`isort`/`flake8` clean
- [ ] Idempotency proven: same poll job run twice → identical DB state (test)
- [ ] ShineMonitor-down drill: kill network in staging → dashboard serves stale data, GlitchTip quiet after breaker trips
- [ ] pg_dump backups already cover the new tables (no change)
- [ ] `plan.md` in the Alliance repo updated with status (it's the living spec)

## Effort estimate (1 developer)

| Workstream                                                      | Effort                     |
| --------------------------------------------------------------- | -------------------------- |
| TS→JS conversion + shell integration + jest ports               | 1–2 days                   |
| FastAPI module + tables + endpoints + audit                     | 2–3 days                   |
| Ingestion (client port, scheduler jobs, outage events, breaker) | 2–3 days                   |
| Dark-run + reconciliation + staged rollout                      | 3–4 days (mostly watching) |
| **Total**                                                       | **~2 weeks**               |

## Open questions for the owner

1. ShineMonitor API credentials / rate limits / docs access — who provides?
2. One plant per user at launch, or multi-plant from day one (affects `plants` UI)?
3. Historical backfill for existing customers, or start fresh?
4. ~~TS→JS confirmed?~~ **Resolved:** full JS. The vendor API contract moves
   server-side into typed Python (Pydantic), so the frontend no longer carries the
   type-risk that argued for a TS island.
