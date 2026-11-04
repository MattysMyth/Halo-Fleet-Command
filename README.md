# Halo Fleet Command

An incremental (idle) game in the Halo universe: fleet management, ship combat and marine missions on top of a
requisition economy with three prestige layers. Unofficial fan project, non-commercial. All art, icons and writing are
original.

The full design lives in the design doc: https://claude.ai/code/artifact/9e6a5114-35f1-4151-893d-2cf1d6a5e35f
(the build roadmap and checklist at its end say what is done and what comes next).

## Status

| Phase | State |
| --- | --- |
| 0 Foundations | done |
| 1 Economy slice (RP buildings, offline progress, Redeploy, Armory) | done |
| 2 Fleet and ship combat (drydock, strike groups, live battles, Patrol, Titanium and Deuterium) | done (build 0.2) |
| 3 Marine missions (squads, stage missions, tactics, ground positions, field research, Personnel and Intel) | done (build 0.3) |
| 4 Campaign and depth | not started |
| 5 Endgame and polish | not started |

## Commands

```
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run typecheck
npm run balance    # headless simulation of an engaged player; flags: --clicks N --interval S --cycles N
npm run build      # typecheck + single-file build to dist/index.html
npm run artifact   # build, then write dist/artifact.html (page fragment for publishing)
```

## Layout

```
src/core    loop (fixed 10 Hz step), numbers (big-number wrapper + formatting), rng (seeded), save (storage)
src/data    JSON content: buildings, armory, economy, ships, equipment, enemies, theatres, fleet and combat constants, marines
src/sim     pure game rules: economy, armory, prestige, combat, fleet, marines, campaign, world (no UI, no DOM)
src/state   game state types, versioned save + migrations, selectors for the UI, the reactive store
src/ui      Preact screens and components, theme.css
tests       unit tests for every sim and core module
tools       balance-sim.ts (pacing), combat-probe.ts and scale-search.ts (combat balance), odds-probe.ts (squad odds), e2e/ (browser harness), make-artifact.mjs (publishing)
```

## Rules of the codebase

- Game rules live in `src/sim` as pure functions over `GameState`. The UI only reads state and calls store actions.
- Content and tunable numbers live in `src/data/*.json`. Change numbers there, then run `npm run balance`.
- Any change to the saved shape bumps `CURRENT_VERSION` in `src/state/migrations.ts` and adds a migration.
- Numbers that can exceed 1e15 use `Decimal` from `src/core/numbers.ts`, never plain JS numbers.
- Tests and typecheck must pass before a phase is called done.

## Pacing (measured by `npm run balance`)

Engaged player: first ship at about 8 minutes, Operations open at 8 minutes, whole of Theatre 1 and the first Redeploy at
about 57 minutes (44, 33 and 31 minutes for the next three). Moderate player: first Redeploy about 66 minutes. Casual
(checks in every 10 minutes): about 2 h 8 m. Marines add roughly 5 to 20% of an engaged run's Requisition with two squads.
`npm run balance -- --marines 0` plays without them; `npx tsx tools/odds-probe.ts` prints squad odds by loadout.

## Deploying to GitHub Pages

The build is one self-contained `dist/index.html`. Push the project to a GitHub repository whose default branch is `main`, then in
Settings > Pages set Source to "GitHub Actions". `.github/workflows/pages.yml` typechecks, tests, builds and publishes on every push to
`main` (or run it by hand from the Actions tab). The game appears at `https://<user>.github.io/<repo>/`. Saves are stored per site address
in the browser, so use Settings > Export save to move one between the artifact version and the Pages site.

iOS notes: `touch-action: manipulation` on every element removes double-tap zoom (pinch zoom still works), form fields are 16px on phones so
Safari does not zoom on focus, and the page can be added to the Home Screen for a full-screen app.
