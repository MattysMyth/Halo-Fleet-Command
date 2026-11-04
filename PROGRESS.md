# Phase 5 progress, checkpoint 15: Phase 5 complete, reviewed, build 1.0 is live

Resume point for a new session. Read this, then the Build roadmap in the design doc.
Design doc: https://claude.ai/code/artifact/9e6a5114-35f1-4151-893d-2cf1d6a5e35f
Playable build: https://claude.ai/artifact/MjU2rxKPrbHXPP2EfZ1Pkr (build 1.0, live)
Source checkpoint (this file's home, republished after each milestone): https://claude.ai/artifact/8gZ5WqQHfWbQqqiXRECMer

## Restore

Download this artifact's `source/` files into a folder, rename `index.html.txt` to `index.html`, then:
`npm ci && npm run typecheck && npm test`. Expect 351 tests passing at checkpoint 15. Then `npm run build` makes dist/index.html.

## Phase 4 plan and status (build 0.4 is the gate)

- 4.1 Research, doctrine and Salvage: DONE. 4.2 Fleet depth (heavy cruiser, Boarding, Defend): DONE (this checkpoint).
  4.3 Theatre 2, Transfer prestige, Campaign map screen, second strike group: after that. Then review, balance, build 0.4.
- 4.3 as built (Theatre 2, Transfer, War Room, Campaign screen):
  - Data: `theatres.json` has theatre 2 "Inner Colonies" (8 sectors `t2-n1..8`, honors 3, boss `t2-n8` Carrier Resolute); theatre 1 has
    `honors: 2` and `transferShip: heavy-cruiser`. New enemies `seraph`, `cruiser`, `assault-carrier`. Eight ground positions
    (threat 340 to 750; garrison 28 to 76; `t2-n7` gives +1 Command). `warroom.json` + `warroomSchema.ts`: Joint staff (+1 doctrine slot, 4 Honors),
    Reserve fleet (+1 group, 3 then 8), Flag command (+1 Command per group per level, 2/3/5/8). `honorBonus` 3% ship damage and marine Power per Honor.
  - Save version 5 (migration 4 to 5 adds `meta.everCleared, theatre, theatresOpen, honors, honorsEarned, transfers, warroom`). `everCleared`
    survives Transfer and drives ship unlocks, strike groups (one per theatre ever cleared), marine unit/vehicle unlocks, marine targets and Patrol options.
  - `sim/transfer.ts`: `transferProblem/canTransfer/transfer/setTheatre`. Needs the active theatre's boss cleared and a Marathon fielded. A Transfer pays
    the theatre's Honors, opens the next theatre and moves the campaign there, and resets everything a Redeploy does plus Medals, Armory, cleared sectors
    and held ground. Nodes are only "open" inside the theatre being fought (`nodeStatus`); the player may switch back with `setTheatre`.
  - `sim/warroom.ts` (shop), `campaign.ts` (`defaultPatrol`, `patrolOptions` over ever-cleared sectors), `armory.ts` (doctrine slots + War Room),
    `modifiers.ts` (Honor bonus).
  - Design fix found by the balance bot: after a Transfer nothing is "cleared", so squads had no sector they could safely patrol and the fleet had
    nowhere to train. Marines and Patrol now work on any sector ever cleared (`everCleared`); captured ground still resets and can be retaken.
  - UI: Campaign screen (`ui/campaign.tsx`, `state/campaignView.ts`): theatre cards with a sector chain, Transfer panel (checklist, what is lost and kept,
    confirm), War Room shop; nav item "Campaign" (dot when a Transfer is ready); Honors chip in the readout; Sectors tab offers Patrol on earlier-cycle sectors.
  - Tuning: `tools/theatre-probe.ts [theatre] [doctrine] [--geared]` (fleet builds vs each node). Light cruisers are enough for n1 to n3, heavies from
    n4, 3 heavies with research and veteran crews for n7/n8; unresearched fleets cannot take the boss. Node scales 3.2/5.5/4.2/3/3.2/4/3.1/3.3.
    Boss needs about 15 to 16 Command with research (first Transfer gives Command 10 + sectors/2 + ground + Flag command).
  - `tools/balance-sim.ts --late 1 --hours 48 --cycles 12 [--fleetlog]`: builds cruisers, holds its run to Transfer, spends Honors on Flag command. In
    this mode the first Transfer lands at about 2h27m of play and Theatre 2 reaches n6 at about 6h; the bot is weak late (small fleets), and long
    runs inflate Medals (the sqrt formula), so treat it as a smoke test, not a pacing target.
  - Baseline (non-late) balance unchanged: 53m39, 38m07, 31m32.
- 4.2 as built:
  - Ship: `heavy-cruiser` in `ships.json` (command 6, 1.5M RP / 220k Ti, unlocks at the first theatre's boss node, same as the
    light cruiser; the Theatre 2 gate on a built Marathon moves to 4.3). Icon `heavy`; `fleet.tsx` takes icons from ship data.
  - Incidents (`src/sim/incidents.ts`, `src/state/incidentState.ts`, `marines.json` `config.incidents`, missions `boarding` and
    `defend` flagged `incident`, never offered as standing orders). State: `run.incidents[]`, `nextIncidentId`, `defendClock`
    (counter-attack timer, 900 to 1800 s once any ground is held), `contested {node: seconds}`. Save keeps all of it, sanitised.
  - Boarding: after a won ship battle with an enemy ship under 25% hull, an offer (max 4, 10 min) appears at that sector; threat,
    Salvage and hull chance scale with the enemy's Command. A squad answers with `launchIncident`; a win pays Salvage (research
    bonuses apply) and maybe a hull (`grantShip`, a frigate at a share of hull).
  - Defend: a timer spawns a counter-attack at a held position (5 min to answer). Unanswered: the garrison holds (70%) or the
    position is overrun (lose garrison x2 Personnel; its production bonus is suspended 900 s, `capturedBonus(meta, kind, contested)`).
    A lost or recalled Defend is an overrun. Positions are never lost for good; Command bonuses are unaffected.
  - Auto squads that are idle answer incidents when worst-stage odds are at least `autoMinWin` (0.8), counter-attacks first.
  - UI: Incidents panel on Operations (expiry chip, odds, "Defend/Board with <squad>"), "Contested" chip on positions, log lines
    for offers, outcomes and boardings. Store action `answerIncident`.
  - Balance (engaged bot): 53m39, 38m07, 31m32 for the three cycles (4.1: 53m39, 39m22, 31m04), so no pacing change. The overrun
    penalty is mild (Personnel plus a temporary bonus loss); revisit once Theatre 2 makes the ground game harder.
  - Tests: `tests/incidents.test.ts` (25). The e2e seed `opsinc` and a harness section check the panel, the contested chip and
    answering at three sizes.
- 4.1 as built:
  - Data `src/data/research.json` (config, 5 branches, 30 nodes, 5 doctrines) with `researchSchema.ts` (validator). The eight
    Phase 3 infantry nodes keep their ids under the Infantry branch. Captured tech also costs Salvage.
  - State: `run.research {done, active[]}` (bays: 1 plus the Armory "Second research bay"), `run.doctrine {picked[], cooldown}`
    (slots: 1 plus the Armory "Staff college"), `run.salvage` (capped, `FLEET.storage.salvage` 3000, storage research raises caps).
    Save version 4, migration 3 to 4 moves `marines.research` into `run.research`. Everything resets on Redeploy.
  - `src/sim/modifiers.ts`: `modsOf(state)` folds research and doctrine into one `Mods` object. `src/sim/research.ts`: start,
    cancel (full refund), step, doctrine adopt (first pick free, swap = 200 Intel and a 1 h cooldown). Salvage is paid by Campaign
    wins and Patrol (node `reward.salvage` / `patrol.salvage`).
  - Effects applied in: `shipStats(ship, mods)` / `playerUnit` (hull, armour, damage, cooldown, shield with regen), `buildSetup`
    (+ `BattleSetup.opening` for Shock and awe), `sortieCost`, `repairShips`, `stepQueue` (build speed, floor 0.25),
    campaign and Patrol rewards, `productionMultiplier`, `storageCap`/`capOf(state, resource)`, marine Power.
  - UI: Research screen (`ui/research.tsx`, `state/researchView.ts`): bonus summary, doctrine slots, five branch panels; Salvage
    pill in the readout; the old Operations research panel is gone.
  - Interpretation: "Attrition warfare: -15% campaign speed" became -15% Campaign rewards. Balance (engaged bot): research cuts
    Redeploy time about 4 to 10% (first 55m54s to 53m39s, then 43m to 39m, then 32m to 31m); Logistics corps is the speed
    doctrine (cycle 3 at 26m40s), the others matter in harder fights (revisit once Theatre 2 exists).
  - `tools/balance-sim.ts` flags: `--research 0` turns research off, `--doctrine N` adopts the Nth doctrine.

## Phases 0 to 2 (done, build 0.2)

Economy, prestige, drydock, strike groups, seeded combat engine, offline Patrol, Titanium and Deuterium chains. Details are in
the design doc's build log. Combat and fleet numbers are unchanged in Phase 3.

## Phase 3 as built (marine missions)

- Data: `src/data/marines.json` (units, vehicles, ranks and perks, tactics, three mission kinds, eight ground positions with
  `xpCap`, eight field research nodes, config) and `marineSchema.ts` (validator).
- Economy: Personnel (recruit, academy, barracks) and Intel (listening, analysis, bureau) chains, capped stores (2000 and 50000),
  save version 3 with migration 2 to 3. Capture bonuses feed `productionMultiplier(state, resource)`.
- Sim `src/sim/marines.ts`: squads of six slots, one vehicle, ranks (Pvt/Cpl/Sgt/GySgt at 0/8/24/60 XP) and two perks per
  promotion, stage-by-stage missions (win chance 1/(1+(T/P)^2.2)), tactics (Aggressive, Methodical, Flank, Orbital), a 12 s
  brief for attended stages (hand-picked tactics pay +50%), wounds (90 s) and KIA, auto squads for Patrol and Recon, assaults
  that pay a Personnel garrison at launch and capture positions (kept across Redeploy), Recon that lowers assault threat,
  Support orders on a strike group (+10% Power and orbital strikes paid in Deuterium), field research, offline progress that
  steps the real sim.
- State and UI: `state/opsView.ts`, store actions, `ui/operations.tsx` (squad panel, mission view with tactic cards, roster,
  ground positions, field research), Operations nav item, Personnel and Intel pills, offline report with marines.
- Tools: `tools/balance-sim.ts` plays marines (planner takes positions easiest first: Recon twice, then Assault), `tools/odds-probe.ts`,
  `tools/e2e` has Operations seeds (a mid-run roster, a fresh Operations, an offline return).
- Measured (engaged bot, two squads): first Redeploy 57 min, then 44, 33, 31 min; moderate 66 min; casual 2 h 8 m. Marines pay
  5 to 20% of earnings. Squads 3 and 4 (5 and 15 Barracks) are for longer runs and do not pay back inside a 1 hour run.
- Independent review (separate agent) found 7 issues, all fixed with regression tests: prototype-name ids (`constructor`) crashed
  the loop (lookup maps now have no prototype); orbital Deuterium was handed back on save after the strike landed; no per-sector
  XP cap (now `xpCap` per position: easy ground cannot make veterans); fleet support was read at roll time and not fixed when the
  tactic was picked; auto squads were judged with wounded marines counted; two squads could assault one position and one
  garrison was lost (now one assault per position, garrison refunded to a squad that does not take it); hostile saves could
  hold duplicate squad ids, an auto assault, squads without Barracks, captured uncleared ground or an absurd marine id counter.
- Browser harness: no console errors, no horizontal overflow at desktop, tablet and phone. It also caught two real bugs, a CSS class
  clash (`.stage`) that broke the whole Fleet layout and a roster class clash on phones; the readout is static on phones now
  that it carries four stock pills.

## Not done yet

1. Verify build 0.4: independent review by a separate agent, fix findings, publish `npm run artifact` to the playable artifact and a final source
   checkpoint, update the design doc (tick Phase 4, add the 4.3 and 0.4 entries).
2. Known soft spots: Theatre 2 ground positions are hard for the current marine kit (Phase 5 adds ODST and Spartans); the late bot is weak; Medals
   inflate in long runs; only two theatres exist (3 to 5 are Phase 5).

## Decisions worth keeping

- Missions in progress are not saved: on load a squad is idle and an assault's garrison is refunded (also the unspent orbital Deuterium).
- Ranks are capped by the ground they are earned on (`xpCap`: Corporal on the first sector, Gunnery Sergeant from the sixth).
- Squads come from Barracks Complexes (0, 1, 5, 15), not Pelican wings. Operations opens when t1-n1 falls and gives 6 Personnel.
- Deviations from the design doc: Corpsman unlocks at t1-n6; Kit is replaced by research and vehicles; ODST, Spartans, Defend,
  Boarding, Rescue, Hunter strike and Quarantine wait for Phase 4/5; positions persist across Redeploy with a one-time garrison and
  no counter-attacks yet; Intel has a Phase 3 sink (field research, reset on Redeploy).
- Known and accepted: wounds heal during a long mission (a wounded marine usually misses one stage), x4 battle speed pays 4x online.

## Review fixes (checkpoint 10)
- Captured ground after a Transfer now survives reload (filter uses `everCleared`).
- Unopened-theatre nodes are stripped from saved `cleared`/`everCleared`.
- War Room levels are trimmed on load to what `honorsEarned` can pay for.
- In-flight incident missions are re-added to saved incidents.
- Build 0.4 published to the playable artifact.

## Phase 5 plan
- 5.1 Marine elite (done, checkpoint 11): ODST (cost 3, unlocks with t2-n2 ever cleared) and Spartan (cost 6, t2-n6) are data-only units;
  Hunter strike is a 3-stage non-auto mission on held ground (threat x1.2, stages 1.0/1.3/1.6) paying Salvage = sector campaign Salvage x
  `config.hunter.salvageShare` (0.5). Odds probe: 2 Spartans + 2 ODST + rank 3 + research take Theatre 2 ground at 0.4-0.8 per assault.
  New tests in tests/elite.test.ts. Save format unchanged (v5).
- 5.2 Theatres 3 to 5, carrier and flagship (done, checkpoint 12): Reach Approaches (4 Honors, boss Unyielding), Flood Frontier (5, Gravemind's
  hulk), The Ark (6, Dreadnought of Truth); six new enemies (battlecruiser, sentinel, infested-cruiser, enforcer, flood-hulk, supercarrier);
  Carrier (Command 10, unlocks t2-n8) and Flagship (Command 20, unlocks t3-n8); T2 now needs a heavy to Transfer, T3 a carrier, T4 a flagship.
  New fleet config: `lateTheatreCommand` (+6 group Command per theatre beyond the second) and `theatreStorage` (Titanium and Salvage caps
  scale by theatres opened, via `Mods.vault`, also applied on load). Node scales were fitted with `tools/theatre-tune.ts <theatre> <from%>
  <to%> ship:n,...` (geared reference fleet, win rate falling across the theatre). Balance bot cannot reach theatres 3+ (it is weak late), so
  pacing past Theatre 2 is by arithmetic only: needs a human playtest. Salvage has no sink beyond research, so late Salvage is cosmetic until 5.3.
- 5.3a Relics and officers (done, checkpoint 13): Reliquary on the Campaign screen: six Relics (5 levels each) bought with Salvage, kept through
  Redeploy and Transfer, folded into `modsOf` by `sim/relics.ts` (save v6, meta.relics). Officers (`officers.json`, `sim/officers.ts`): seven
  (the last is the Smart AI core Echo) unlocked by everCleared sectors, one per strike group (`Group.officer`), applied through `groupMods` in
  battle setup, patrol estimates, sortie cost and repair. Select on the Fleet screen's Standing orders. Reclamation was folded into Relics.
- 5.3b Sound and accessibility (done, checkpoint 14): `core/sound.ts` synthesised cues (off by default), settings sound/volume/reduceMotion/
  highContrast/textScale saved in `settings` (no version bump, defaults fill in), `applyDisplay()` in the store sets `data-scale/contrast/motion` on
  <html>, CSS at the end of theme.css (zoom for text size, token overrides for contrast). Known: at Extra large on a phone the resource chips in
  the readout are cramped.
- Left for 1.0: independent review of Phase 5 and fixes, About text to build 1.0, `npm run artifact`, publish to the playable artifact, design doc
  log entry and ticking Phase 5. Rescue and Quarantine missions are cut from 1.0.

## Phase 5 review fixes (checkpoint 15)
- Command trim on load was disabled for every save (`progress` lacked theatre fields, capacity was NaN). Fixed; capacity now uses `theatresOpen` so farming an earlier front never shrinks a group.
- An officer could lead two groups at once by moving mid-battle: `assignOfficer` now refuses while either group is in battle.
- Slipspace drive description corrected (it boosts Campaign Requisition and Titanium, not Salvage). Reliquary says Salvage is lost on Redeploy/Transfer and flags levels above the stockpile cap.
- Not fixed, noted: Extra large text on a phone crowds the readout chips; the heavy cruiser's 220k Ti exceeds the base 200k cap (needs depots/Cartographer, predates Phase 5); pacing past Theatre 2 is untested by the bot; Rescue and Quarantine missions are cut.

## Ideas for after 1.0
Rescue and Quarantine missions, a Salvage sink that scales into Theatres 4-5, Ti storage warning for the heavy cruiser, a long-run bot that can play Theatres 3-5, playtest-driven balance of Theatres 3-5.

## GitHub Pages (post 1.0)
`.github/workflows/pages.yml` and `.gitignore` added; `vite.config.ts` has `base: './'`; index.html has Apple web-app and theme-color meta;
theme.css ends with a touch section (`touch-action: manipulation`, 16px fields on phones). README has the deploy steps.
