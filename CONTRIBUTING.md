# Contributing

How we keep `master` green and reviews quick. The short version: **small PRs, Conventional
Commits, green CI, no direct pushes to master.**

## The workflow

1. **Branch off master.** Prefix the branch by intent:
   - `feat/` new user-facing behaviour — `feat/monthly-export`
   - `fix/` bug fixes — `fix/outage-loss-rounding`
   - `chore/` tooling, deps, config — `chore/quality-tooling`
   - `docs/`, `test/`, `refactor/` for those kinds of changes

2. **Commit with Conventional Commits** (enforced by commitlint):

   ```
   feat: add yearly CO2 summary card
   fix: unwrap retried shineCall response
   chore: bump vite to 7.2.5
   docs: update live-mode endpoint table
   ```

   Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `ci`, `perf`.
   Lowercase, imperative, no trailing period. A commit that changes behaviour is never
   `style` or `chore`.

3. **Push and open a PR** (`gh pr create`). Fill in the template — especially the
   data-source impact section. One concern per PR; formatting-only changes go in their
   own commit.

4. **Merge when CI is green.** Squash-merge is the default. Branch protection on
   `master` requires the `quality` check to pass; direct pushes are blocked.
   Delete the branch after merging (GitHub does this automatically).

## What checks run, and when

Mistakes are cheapest closest to the keyboard, so the gates are layered:

| When                | What runs                                              | Catches                        |
| ------------------- | ------------------------------------------------------ | ------------------------------ |
| On save (editor)    | `.editorconfig`, Prettier (format on save)             | style drift                    |
| `git commit`        | lint-staged: Prettier + `eslint --fix` on staged files | lint/format errors             |
| commit message      | commitlint (Conventional Commits)                      | unreviewable history           |
| `git push`          | `npm run typecheck` + `npm run test`                   | type errors, logic regressions |
| PR / push to master | CI: format check → lint → typecheck → test → build     | anything that escaped locally  |
| Merge               | Branch protection: CI must be green                    | broken master                  |
| Weekly              | Dependabot PRs for npm + GitHub Actions                | stale/vulnerable deps          |

If a hook feels slow, fix the underlying slowness — do **not** bypass with
`--no-verify`. (If you truly must, say so in the PR description.)

## Tests

Vitest + React Testing Library. The data layer (`src/lib/solarData.ts`) is deterministic
and pure — test it directly, no mocks. Component tests go through the DOM
(`@testing-library`), not implementation details. New logic in `src/lib/` should come
with tests; run `npm run test:coverage` to see where the gaps are.

## Definition of done

- [ ] All gates above pass (hooks + CI green)
- [ ] New/changed logic has tests
- [ ] Live-mode path still works if `src/lib/` was touched
      (`node scripts/verify-live-proxy.mjs` with the dev server running)
- [ ] Docs updated if behaviour, commands, or conventions changed
      (`README.md`, `AGENTS.md`, `docs/`)

## Security reminders

- Never commit `.env` — real ShineMonitor credentials live there. CI and GitHub secret
  scanning are the backstop, not the primary defense.
- Never deploy a live-mode build; credentials are compiled into the bundle
  (see `docs/migration-plan.md` for the production path).
