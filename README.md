# Greentek Alliance · Solar Monitor

[![CI](https://github.com/yogi1903/solar-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yogi1903/solar-dashboard/actions/workflows/ci.yml)

Customer-facing solar monitoring dashboard for residential and small-business solar plant
owners in India. Answers two questions at a glance: _"is my plant working?"_ and
_"how much am I saving?"_.

Single-page Vite + React app. Data comes from a deterministic built-in mock or the
ShineMonitor Open API (KSolare inverters), selected at boot by `VITE_DATA_SOURCE`.
Live mode is a **local demo only** — see `docs/live-mode.md` and `docs/migration-plan.md`.

## Quickstart

```bash
npm install
cp .env.example .env   # fill in ShineMonitor credentials for live mode
npm run dev            # http://localhost:3000
```

Mock mode (no credentials) works out of the box.

## Scripts

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Vite dev server on :3000 (ShineMonitor proxy) |
| `npm run build`         | Type-check + production build → `dist/`       |
| `npm run preview`       | Serve the production build                    |
| `npm run lint`          | ESLint                                        |
| `npm run typecheck`     | `tsc -b` without emitting                     |
| `npm run test`          | Vitest (run once)                             |
| `npm run test:watch`    | Vitest watch mode                             |
| `npm run test:coverage` | Vitest with v8 coverage                       |
| `npm run format`        | Prettier write                                |
| `npm run format:check`  | Prettier check (CI gate)                      |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — branch naming, Conventional Commits, the git
hooks that run locally, and what CI enforces before merge.

## Docs

- `docs/live-mode.md` — ShineMonitor endpoint mapping, auth/signing, limitations
- `docs/migration-plan.md` — production plan (FastAPI `monitoring` module)
- `docs/feature-roadmap.md` — planned features
- `docs/design-guidelines.json` / `docs/design-theme.json` — design system
