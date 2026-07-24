## Summary

<!-- What does this change and why? Keep it short. -->

## Test plan

- [ ] `npm run lint` and `npm run typecheck` pass locally
- [ ] `npm run test` passes (new logic has new tests)
- [ ] Checked in the browser (`npm run dev`) at mobile width (390 px)

## Data source impact

- [ ] No change to data layer (`src/lib/`)
- [ ] Mock source affected — verified with mock data
- [ ] Live source affected — verified with `VITE_DATA_SOURCE=live` + `node scripts/verify-live-proxy.mjs`
