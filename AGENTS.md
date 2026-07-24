# AGENTS.md — Greentek Alliance · Solar Monitor

Guidance for AI coding agents working in this repository.

## Project overview

Customer-facing **solar monitoring dashboard** ("Greentek Alliance · Solar Monitor") for
residential and small-business solar plant owners in India. The audience is non-technical;
the UI answers two questions: _"is my plant working?"_ and _"how much am I saving?"_.
Design language: mobile-first, Apple-philosophy — one hero number per card, plain language
(₹, kWh, "All good"), technical details tucked behind toggles.

It is a **single-page Vite + React app** with one route (`/`, the dashboard). Data comes
from either a deterministic built-in mock or the **ShineMonitor Open API** (KSolare
inverters), selected at boot by `VITE_DATA_SOURCE`. There is **no backend in this repo** —
live mode calls the ShineMonitor API directly from the browser via a Vite dev proxy.
This is explicitly a **local demo**; the production plan (FastAPI `monitoring` module) is
documented in `docs/migration-plan.md`.

## Tech stack

- **Build:** Vite 7, TypeScript ~5.9 (`tsc -b` before `vite build`), Node 20
- **UI:** React 19, react-router 7, Tailwind CSS 3.4, Radix primitives via shadcn/ui
  (new-york style, `components.json`), lucide-react icons, sonner toasts, recharts (available)
- **Output:** jsPDF (PDF period reports), `src/lib/shareCard.ts` (shareable summary cards)
- **Lint:** ESLint 9 flat config (`eslint.config.js`) — typescript-eslint recommended +
  react-hooks + react-refresh

## Build and run commands

```bash
npm run dev       # Vite dev server on port 3000 (proxy /shinemonitor → api.shinemonitor.com)
npm run build     # tsc -b && vite build  → dist/
npm run preview   # serve the production build
npm run lint      # eslint .
```

There is **no test framework** installed (no vitest/jest, no `test` script). "Tests" for the
live data path are one-off Node scripts (see below). Verify changes with `npm run build`
(type-check included) and `npm run lint`.

## Verification scripts (`scripts/`)

Plain `.mjs` scripts run with Node directly. They read `.env` themselves.

- `node scripts/shinemonitor-test.mjs` — auth + list plants + pull real data, direct against the API
- `node scripts/verify-plant.mjs` — verify demo plant 1207966 and its datalogger
- `node scripts/verify-live-proxy.mjs` — end-to-end check of the live path **through the Vite
  proxy** (dev server must be running on :3000)
- `node scripts/find-plant.mjs` — list plants on the configured account
- `scripts/last-run.txt` — output log of the last script run

## Data architecture (the core of this repo)

`src/lib/data.ts` is the **single entry point** for all dashboard data. Every consumer
imports from `@/lib/data`, never from `solarData`/`liveSolar` directly.

- `src/lib/solarData.ts` — deterministic mock source; defines the function shapes
  (`getDayData(date)`, `getMonthData(y,m)`, `getYearData(y)`, outage readers, formatters)
  that double as the API contract for the future backend. Also exports constants
  (`SYSTEM_KWP`, `TARIFF_RS_PER_KWH`, `fmtRs`, etc.).
- `src/lib/liveSolar.ts` — live source with identical signatures. Prefetches period data
  into module-level caches so UI reads stay **synchronous**; aggregates 5-min kW points
  into hourly means; derives grid-outage windows from ShineMonitor alarms
  (`0x00000009` "No utility fault").
- `src/lib/shineClient.ts` — browser-side ShineMonitor client: SHA1-signed auth
  (~5-day token cached in localStorage `greentek-shine-auth`), 3× retry with backoff,
  one automatic re-auth on API error.
- `src/main.tsx` awaits `initDataSource()` before first render (branded splash shown
  meanwhile). If live init fails, the app **silently falls back to the mock** for the whole
  session — detect mock mode by city "Rajkot", "Updated just now", `getCurrentKw() === null`.

### Live vs mock toggle

Set in `.env` (see `.env.example` for the schema; `.env` is git-ignored):

- `VITE_DATA_SOURCE=live` enables live mode; anything else = mock
- `VITE_SHINEMONITOR_USR` / `_PWD` / `_COMPANY_KEY` (`bnrl_frRFjEz8Mkn`) / `_PLANT_ID` (demo: `1207966`)
- **Restart the dev server after changing `.env`** — Vite reads it only at startup.
- Force re-auth: clear localStorage key `greentek-shine-auth`.
- The upstream base URL is not an env var; it is fixed in the Vite proxy in `vite.config.ts`
  (`/shinemonitor/*` → `http://api.shinemonitor.com/public/` — plain HTTP, no CORS, hence the proxy).

Full endpoint mapping, auth/signing details, and known limitations: `docs/live-mode.md`.
Read it before touching anything under `src/lib/`. Two non-obvious rules from it:

- The vendor's endpoint name `queryPlantActiveOuputPowerOneDay` is misspelled ("Ouput") in
  the real API — **do not "fix" it**.
- Outage loss is estimated from the _expected_ clear-day curve only; always label it "≈";
  use amber (not red) for grid outages — a grid outage is not the plant's fault.

## Code organization

```
src/
  main.tsx            Entry: splash screen, initDataSource(), then render
  App.tsx             Routes (only "/" → Home) + sonner Toaster
  pages/Home.tsx      The entire dashboard (~880 lines): day/month/year views,
                      hero power, curves, savings, outages, PDF/share, settings
  components/
    PeriodPicker.tsx  Fitness-app-style day/month/year period pickers
    SettingsPanel.tsx Settings tab (tariff ₹/kWh, persisted in localStorage `greentek-tariff`)
    ui/               Stock shadcn/ui components (scaffolded; the app itself only uses sonner)
  lib/                data.ts (dispatcher), solarData.ts (mock), liveSolar.ts (live),
                      shineClient.ts (API client), report.ts (jsPDF), shareCard.ts, utils.ts (cn)
  hooks/use-mobile.ts Mobile breakpoint hook
  sections/, types/   Empty scaffold directories from the template
docs/                 feature-roadmap.md, live-mode.md, migration-plan.md,
                      design-guidelines.json, design-theme.json
scripts/              Node verification scripts (see above)
hero-mockup.html      Standalone design mockup (reference only, not part of the app)
```

Imports use the `@/` alias → `./src` (configured in both `vite.config.ts` and
`tsconfig.app.json`; also the shadcn aliases in `components.json`).

## Code style and conventions

- **Design system is authoritative** — `docs/design-guidelines.json` (spec, `--gt-*` tokens)
  and `docs/design-theme.json` (implemented, `--brand-*` tokens; same palette, two names).
  Palette: parchment `#f3f1ea`, ink `#0d201d`, teal `#237a6e`/`#16b8a8`, champagne/gold
  `#c9a460`/`#8a6826`. Fonts: Bricolage Grotesque (headings/KPI numerals), Inter (body).
- `Home.tsx` currently styles with its own brand hex constants + inline styles rather than
  the shadcn theme; match the surrounding approach in whatever file you edit.
- Product rules (from `docs/design-guidelines.json` key_rules): no emoji icons (lucide-react),
  `data-testid` (kebab-case) on all interactive elements, tabular-nums for ₹ and counts,
  sonner for toasts, named exports for components, default exports for pages.
- Mobile-first: baseline width 390 px, tap targets ≥44 px, tables become stacked cards
  below 768 px, reduced-motion support, no `transition: all`.
- Comments in the codebase are terse and explain _why_ (e.g. ramp math in the curve
  builder) — keep that style.

## Security considerations

- **Never commit `.env`** — it contains real ShineMonitor credentials. `.gitignore` covers
  it; `.env.example` is the safe template.
- **Live mode is a local demo only — never deploy a live-mode build.** ShineMonitor
  credentials are compiled into the frontend bundle via `VITE_*` vars (readable in DevTools)
  and the upstream API is plain HTTP. Production must move signing/credentials server-side
  into the planned FastAPI `monitoring` module (`docs/migration-plan.md`).
- The KSolare `company-key` (`bnrl_frRFjEz8Mkn`) is public (extracted from the vendor's
  portal source); the account `usr`/`pwd` are the secrets.
- Passwords leave the browser only as `SHA1(pwd)` inside the auth signature.

## Deployment

There is no deployment pipeline in this repo. `npm run build` emits a static `dist/`
(`base: './'` so it works from any subpath). Per `docs/migration-plan.md`, this app is
intended to be **migrated into the larger Greentek Alliance stack** (TS→JS conversion,
moved to a `/monitoring` section of a CRA app, FastAPI/Postgres backend with scheduled
ShineMonitor ingestion) before any real production use. That migration is proposed, not
started — treat this repo as the standalone reference implementation.
