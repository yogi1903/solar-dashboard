# Live Mode — ShineMonitor Open API Integration

**Date:** 2026-07-23 · **Status:** verified working in dev — build passes; proxy smoke test returns real ShineMonitor JSON (dummy creds → `err 5 ERR_SALT`, i.e. signed requests reach the API)
**Touches:** `src/lib/shineClient.ts`, `src/lib/liveSolar.ts`, `src/lib/data.ts`, `vite.config.ts`, `.env`
**Demo plant:** pid 1207966 · 4.8 kW residential · KSolare (company-key `bnrl_frRFjEz8Mkn`)

---

> ⚠️ **SECURITY — local demo only.**
> ShineMonitor credentials (`usr` / `pwd` / `company-key` / `plantid`) are compiled into the frontend bundle via `VITE_*` vars and are readable by anyone who opens DevTools; the upstream API is also plain HTTP. Acceptable for this local demo — **never deploy this build.** Production must proxy through the planned FastAPI `monitoring` module (see [migration-plan.md](migration-plan.md)): the server holds credentials, signs calls, caches the ~5-day token server-side, and maps each logged-in customer to their own plant id instead of one shared `VITE_SHINEMONITOR_PLANT_ID`.

---

## Architecture

```
Browser (PWA, mobile-first)
│
├─ src/main.tsx ──── initDataSource() awaited before first render
│                     (branded splash shown meanwhile)
│
├─ src/lib/data.ts ── dispatcher; identical function shapes in both modes
│      │
│      │  VITE_DATA_SOURCE=live AND initLive() succeeded?
│      │
│      ├─ yes → src/lib/liveSolar.ts ── prefetchFor(mode, anchor) fills module
│      │           caches; UI reads stay synchronous. 5-min kW → hourly means.
│      │        │
│      │        └─ src/lib/shineClient.ts ── SHA1-signed calls, token cache,
│      │                 retries, re-auth
│      │              │
│      │              └─ Vite dev proxy  /shinemonitor/*  →
│      │                   http://api.shinemonitor.com/public/
│      │                   (plain HTTP, no CORS → proxy required in dev)
│      │
│      └─ no ─→ src/lib/solarData.ts ── deterministic mock (automatic fallback)
```

## Environment variables (`.env`)

| Variable                        | Example            | Purpose                                                                            |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `VITE_DATA_SOURCE`              | `live`             | `live` enables the ShineMonitor source; anything else / unset = mock               |
| `VITE_SHINEMONITOR_USR`         | —                  | ShineMonitor account username                                                      |
| `VITE_SHINEMONITOR_PWD`         | —                  | Account password; leaves the browser only as `SHA1(pwd)` inside the auth signature |
| `VITE_SHINEMONITOR_COMPANY_KEY` | `bnrl_frRFjEz8Mkn` | Vendor company-key (KSolare), required by `action=auth`                            |
| `VITE_SHINEMONITOR_PLANT_ID`    | `1207966`          | Plant pid appended to every business call (`&plantid=`)                            |

Base URL is **not** an env var — fixed in `vite.config.ts` (`/shinemonitor` → `http://api.shinemonitor.com/public/`).

## Toggling mock ↔ live

- **Live:** set `VITE_DATA_SOURCE=live` + the four ShineMonitor vars in `.env`, then restart `npm run dev` (Vite reads `.env` only at startup).
- **Mock:** unset `VITE_DATA_SOURCE` (or set anything other than `live`) and restart. No other change needed — `data.ts` exposes the same function shapes either way.
- **Force re-auth:** clear localStorage key `greentek-shine-auth` (or call `clearAuth()` from `shineClient.ts`).

## Mock fallback behavior

- `initDataSource()` runs before first render; the branded splash covers the wait.
- If `initLive()` throws (API unreachable, auth rejected, bad plant id), the dispatcher logs `[data] Live init failed` and sets `liveActive = false` — the **entire UI silently serves the deterministic mock**. No per-request fallback mid-session; the decision is made once at boot.
- Detectable differences in mock mode: city reads "Rajkot", updated label reads "Updated just now", and `getCurrentKw()` returns `null` (no live "Producing now" reading).

## Data mapping (ShineMonitor → dashboard)

| Endpoint (`action=`)                                                               | Returns                                                            | Dashboard feature                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `auth`                                                                             | token + secret (~5-day expiry)                                     | All other calls; cached in localStorage `greentek-shine-auth`                                             |
| `queryPlantInfo`                                                                   | name, status, nominalPower, install date, city, tariff, CO₂ factor | System info, status label, plant city, lifetime baseline, Settings tariff seed                            |
| `queryPlantCurrentData` (`par=ENERGY_TODAY,ENERGY_MONTH,ENERGY_YEAR,ENERGY_TOTAL`) | cumulative kWh                                                     | Lifetime totals strip                                                                                     |
| `queryPlantActiveOuputPowerOneDay` (`&date=`)                                      | 288 × 5-min kW points/day                                          | Day power curve (aggregated to hourly means), "Producing now" kW, peak kW / peak time, last-updated label |
| `queryPlantEnergyMonthPerDay` (`&date=YYYY-MM`)                                    | daily kWh                                                          | Month view bars, best day, month totals                                                                   |
| `queryPlantEnergyYearPerMonth` (`&date=YYYY`)                                      | monthly kWh                                                        | Year view bars, best month, year totals                                                                   |
| `queryPlantWarning` (paged, `pagesize=100` — API cap)                              | alarm list with `gts`/`cts`                                        | Grid outage detection (Phase 1.5)                                                                         |

Note: `queryPlantActiveOuputPowerOneDay` (sic — "Ouput") is the vendor's actual spelling; do not "fix" it.

## Auth & signing

- **Auth:** `sign = SHA1(salt + SHA1(pwd) + "&action=auth&usr=…&company-key=…")` → `{token, secret, expire}`. Cached in localStorage with a 1-min safety margin; expiry capped at 5 days (`min(expire, 432000)`).
- **Business calls:** `sign = SHA1(salt + secret + token + actionParams)` plus `&token=` in the query string.
- **Resilience:** network failures retried 3× with linear backoff (1.2 s × attempt); any API-level error clears the token and re-auths **once**, then surfaces the error.

## Outage detection

- **Source:** `queryPlantWarning`, paged at the API's 100-row cap (up to 6 pages = 600 most recent warnings). Only code `0x00000009` ("No utility fault") counts as a grid outage; other warnings are ignored.
- **Window:** `gts` (happen time) → `cts` (clear time); empty `cts` = ongoing. A `cts` that is not after `gts` is treated as ongoing (defensive).
- **Merge:** events on the same day less than **10 minutes apart** merge into one window — debounces grid flicker.
- **Ongoing events:** only meaningful today (end = now); a _past_ event missing `cts` is estimated at 30 minutes.
- **Loss estimate:** `lost kWh ≈ ∫ expectedClearCurve(date) over [start, end]` — the **analytic clear-day curve only**; actual generation during the window is _not_ subtracted (datalogger gaps make "actual" unreliable mid-outage). `lost ₹ = lost kWh × tariff`, always labeled "≈". Amber, not red — a grid outage is not the plant's fault.
- **"No production impact":** loss is rounded to 0.1 kWh. Night outages (expected curve = 0) and very short outages (sub-minute → expected energy in the window rounds to 0.0) both estimate ≈0, so the UI shows "No production impact" instead of a meaningless ₹0 figure.
- **Year uptime:** `(1 − daylightOutageHours / (elapsedDays × 13)) × 100` — assumes 13 daylight hours/day; only daylight overlap counts.

## Known limitations

- **Percentile is a placeholder** — deterministic hash (`58 + hash % 37`), not real fleet benchmarking; same in both modes.
- **Tomorrow's forecast is an estimate** — `getTomorrowForecast` is the mock heuristic in both modes; no weather API wired yet.
- **Cleaning nudge uses the analytic expected curve** — last 7 cached days' actual kWh vs `typicalDayKwh`; fires below 88% of expected. Not weather-adjusted, so a cloudy week can false-trigger.
- **Outage loss uses the expected-only curve** — actual generation during the window is not subtracted, so a cloudy-day outage slightly _overestimates_ loss.
- **History depth:** warning fetch capped at 600 rows; day curves are 5-min granularity (hourly means shown in UI; no sub-hourly resolution).
- **One plant, one account** — no multi-plant switching in live mode (see Phase 3 multi-site switcher).
