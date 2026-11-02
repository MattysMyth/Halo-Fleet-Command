import { formatCount, formatDuration } from '../core/numbers';
import { FLEET, MARINE, MARINE_RANKS, MISSIONS, TACTIC_BY_ID } from '../data';
import type { MissionKind, Standing, TacticId } from '../data';
import type { IncidentView, MarineView, OpsView, PositionView, RunView, SquadView } from '../state/opsView';
import type { View } from '../state/selectors';
import {
  answerIncident,
  autoChoosePerks,
  dischargeMarine,
  fitSquadVehicle,
  launchSquad,
  pickPerk,
  pickTactic,
  recallSquad,
  reinforceSquad,
  renameSquad,
  resumeSquad,
  selectSquad,
  setBattleSpeed,
  setSquadAuto,
  setSquadMission,
  setSquadStanding,
  setSquadTarget,
  setSquadWant,
} from '../state/store';
import { fmtFor } from './components';
import { HullBar, Seg, pct } from './fleet';
import { Icon } from './Icons';

const MISSION_OPTIONS = MISSIONS.filter((m) => !m.incident).map((m) => ({ id: m.id as MissionKind, text: m.name.split(' ')[0], title: m.blurb }));
const STANDING_OPTIONS: { id: Standing; text: string; title: string }[] = [
  { id: 'adaptive', text: 'Adaptive', title: 'Pick the best of Aggressive, Methodical and Flank each stage' },
  { id: 'aggressive', text: 'Aggressive', title: TACTIC_BY_ID.aggressive.blurb },
  { id: 'methodical', text: 'Methodical', title: TACTIC_BY_ID.methodical.blurb },
  { id: 'flank', text: 'Flank', title: TACTIC_BY_ID.flank.blurb },
];

/* ---------- the screen ---------- */

export function OperationsScreen({ v }: { v: View }) {
  const o = v.ops;
  if (!o.unlocked || !o.selected) {
    return (
      <section class="panel">
        <p class="empty">Clear the first sector with your fleet to open Operations.</p>
      </section>
    );
  }
  return (
    <>
      <OpsHeader v={v} o={o} />
      {o.incidents.length > 0 && <IncidentsPanel o={o} s={o.selected} />}
      <SquadPanel v={v} s={o.selected} o={o} />
      {o.selected.run && <MissionPanel v={v} s={o.selected} r={o.selected.run} />}
      {!o.selected.run && o.selected.last && <ReportPanel v={v} s={o.selected} />}
      <RosterPanel v={v} s={o.selected} />
      <PositionsPanel v={v} o={o} s={o.selected} />
    </>
  );
}

/* ---------- header ---------- */

function OpsHeader({ v, o }: { v: View; o: OpsView }) {
  const n = fmtFor(v);
  return (
    <section class="panel ops-head">
      <div class="ops-head-row">
        {o.squads.length > 1 ? (
          <div class="seg group-picker" role="group" aria-label="Squad">
            {o.squads.map((q) => (
              <button key={q.squad.id} type="button" aria-pressed={o.selected?.squad.id === q.squad.id} onClick={() => selectSquad(q.squad.id)}>
                {q.squad.name.replace(' Squad', '')}
                {q.run && <span class="tab-count" title="On a mission">●</span>}
                {q.pending > 0 && <span class="tab-count" title="A promotion is waiting">!</span>}
              </button>
            ))}
          </div>
        ) : (
          <h2 class="ops-title">Operations</h2>
        )}
        <Seg
          label="Battle speed"
          value={v.fleet.battleSpeed}
          options={FLEET.battleSpeeds.map((s) => ({ id: s, text: `${s}x`, title: `Run operations at ${s}x speed` }))}
          onPick={setBattleSpeed}
        />
      </div>
      <dl class="facts ops-facts">
        <div>
          <dt>Personnel</dt>
          <dd>
            {n(o.pers.amount)} <span class="muted">/ {n(o.pers.cap)}</span>
          </dd>
        </div>
        <div>
          <dt>Intel</dt>
          <dd>
            {n(o.intel.amount)} <span class="muted">/ {n(o.intel.cap)}</span>
          </dd>
        </div>
        <div>
          <dt>Positions held</dt>
          <dd>
            {o.held} <span class="muted">of {o.positions.length}</span>
          </dd>
        </div>
        <div>
          <dt>Orbital support</dt>
          <dd>{o.support ? <span class="accent">{o.support.name} · {o.support.cost} Deut</span> : <span class="muted">No group on Support orders</span>}</dd>
        </div>
      </dl>
      {o.nextSquad && (
        <p class="muted ops-note">
          Next squad: own {o.nextSquad.need} Barracks Complex{o.nextSquad.need === 1 ? '' : 'es'} ({o.nextSquad.have} now).
        </p>
      )}
      <p class="muted ops-note">
        Missions flown: {o.totals.total} · won {o.totals.won} · lost {o.totals.lost} · marines killed {o.totals.killed}
      </p>
    </section>
  );
}

/* ---------- incidents ---------- */

function IncidentRow({ i, s }: { i: IncidentView; s: SquadView }) {
  const inc = i.incident;
  const urgent = inc.kind === 'defend';
  const tone = i.odds ? (i.odds.worst >= 0.8 ? 'chip-good' : i.odds.worst >= 0.5 ? 'chip-amber' : 'chip-bad') : '';
  return (
    <li class={`node node-${urgent ? 'open' : 'cleared'} incident incident-${inc.kind}`} data-incident={inc.kind}>
      <div class="node-state" aria-hidden="true">
        <Icon name={urgent ? 'shield' : 'crosshair'} size={22} />
      </div>
      <div class="node-main">
        <h3>
          {i.title}
          <span class={`chip ${urgent ? 'chip-bad' : 'chip-cyan'}`} title="Time left to answer">
            {formatDuration(Math.max(0, inc.expires))}
          </span>
        </h3>
        <p class="blurb">{i.detail}</p>
      </div>
      <div class="node-actions">
        {i.odds && <span class={`chip ${tone}`}>{pct(i.odds.all)} to win</span>}
        <button type="button" class={urgent ? 'primary' : 'ghost'} disabled={i.why !== null} title={i.why ?? undefined} onClick={() => answerIncident(s.squad.id, inc.id)}>
          {urgent ? 'Defend' : 'Board'} with {s.squad.name.replace(' Squad', '')}
        </button>
      </div>
    </li>
  );
}

function IncidentsPanel({ o, s }: { o: OpsView; s: SquadView }) {
  return (
    <section class="panel" aria-label="Incidents">
      <header class="panel-head">
        <div class="head-title">
          <h2>Incidents</h2>
          <p class="muted">Boarding chances come from battles; counter-attacks come for held positions. An idle Auto squad answers when the odds are good.</p>
        </div>
        <span class="chip chip-amber">{o.incidents.length} open</span>
      </header>
      <ul class="nodes">
        {o.incidents.map((i) => (
          <IncidentRow key={i.incident.id} i={i} s={s} />
        ))}
      </ul>
    </section>
  );
}

/* ---------- squad controls ---------- */

function OddsChip({ s }: { s: SquadView }) {
  if (!s.odds) return null;
  const tone = s.odds.worst >= 0.8 ? 'chip-good' : s.odds.worst >= 0.5 ? 'chip-amber' : 'chip-bad';
  return (
    <span class={`chip ${tone}`} title={`Chance to win each stage: ${s.odds.stages.map((p) => pct(p)).join(', ')}`}>
      {pct(s.odds.all)} to clear
    </span>
  );
}

function SquadPanel({ v, s, o }: { v: View; s: SquadView; o: OpsView }) {
  const id = s.squad.id;
  const n = fmtFor(v);
  const onMission = s.run !== null;
  const targets = o.positions.filter((p) => p.status !== 'locked' && (s.squad.mission !== 'assault' || p.status === 'open') && (s.squad.mission !== 'hunter' || p.status === 'held'));
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>
            <RenameBox id={id} name={s.squad.name} />
          </h2>
          <p class="muted">
            {s.ready} ready{s.wounded > 0 ? `, ${s.wounded} wounded` : ''}
            {s.vacancies > 0 ? `, ${s.vacancies} vacant` : ''} · Power {n(Math.round(s.power))} · Tactics {s.tactics.toFixed(1)}
            {s.vehicle ? ` · ${s.vehicle.name}` : ''}
          </p>
        </div>
        <OddsChip s={s} />
      </header>

      <div class="orders">
        <div class="order-field">
          <span class="field-label">Mission</span>
          <Seg label="Mission" value={s.squad.mission} options={MISSION_OPTIONS} onPick={(k) => setSquadMission(id, k)} disabled={onMission} />
          <p class="muted field-note">{s.mission.blurb}</p>
        </div>
        <div class="order-field">
          <span class="field-label">Target</span>
          <select
            class="select"
            aria-label="Target sector"
            disabled={onMission}
            value={s.squad.target ?? ''}
            onChange={(e) => setSquadTarget(id, (e.currentTarget as HTMLSelectElement).value || null)}
          >
            <option value="">{s.squad.mission === 'assault' || s.squad.mission === 'hunter' ? 'Choose a position' : 'Best it can safely take'}</option>
            {targets.map((p) => (
              <option key={p.def.node} value={p.def.node}>
                {p.node.name}: {p.def.name}
                {p.status === 'held' ? ' (held)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div class="order-field">
          <span class="field-label">When nobody picks a tactic</span>
          <Seg label="Standing tactic" value={s.squad.standing} options={STANDING_OPTIONS} onPick={(t) => setSquadStanding(id, t)} />
        </div>
      </div>

      <div class="ops-actions">
        <button
          type="button"
          class={s.squad.auto ? 'primary' : 'ghost'}
          aria-pressed={s.squad.auto}
          disabled={!s.mission.auto}
          title={s.mission.auto ? 'Repeat the mission on its own, using the standing tactic. Works while you are away.' : 'This mission needs your orders'}
          onClick={() => setSquadAuto(id, !s.squad.auto)}
        >
          {s.squad.auto ? 'Auto-deploy on' : 'Auto-deploy off'}
        </button>
        {!onMission && !s.squad.auto && (
          <button type="button" class="primary" disabled={!s.canLaunch} onClick={() => launchSquad(id)}>
            Launch {s.mission.name.toLowerCase()}
          </button>
        )}
        {onMission && (
          <button type="button" class="ghost" onClick={() => recallSquad(id)}>
            Recall
          </button>
        )}
        {s.squad.stalled && (
          <button type="button" class="ghost" onClick={() => resumeSquad(id)}>
            Resume
          </button>
        )}
        <p class={`status${s.squad.stalled ? ' status-bad' : ''}`} role="status">
          {onMission ? 'On mission' : s.waiting ?? (s.launchWhy && !s.squad.auto ? s.launchWhy : s.squad.auto ? 'Ready to deploy' : 'Standing by')}
        </p>
      </div>
    </section>
  );
}

function RenameBox({ id, name }: { id: number; name: string }) {
  return (
    <input
      class="name-input"
      aria-label="Squad name"
      value={name}
      maxLength={32}
      onBlur={(e) => renameSquad(id, (e.currentTarget as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

/* ---------- a mission under way ---------- */

function StageTrack({ r }: { r: RunView }) {
  return (
    <ol class="stage-track" aria-label="Stages">
      {r.stages.map((st, i) => (
        <li key={i} class={`leg stage-${st.state}`} aria-current={st.state === 'now' ? 'step' : undefined}>
          <span class="stage-mark" aria-hidden="true">
            {st.state === 'won' ? '✓' : st.state === 'lost' ? '✕' : i + 1}
          </span>
          <span class="stage-name">{st.name}</span>
          <span class="muted stage-state">
            {st.state === 'won' ? 'Won' : st.state === 'lost' ? 'Lost' : st.state === 'now' ? 'Under way' : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

function MissionPanel({ v, s, r }: { v: View; s: SquadView; r: RunView }) {
  const n = fmtFor(v);
  const brief = r.phase === 'brief';
  const progress = r.timerTotal > 0 ? 1 - r.timer / r.timerTotal : 1;
  const attendedBy = s.squad.standing;
  return (
    <section class="panel mission" aria-label="Mission">
      <header class="panel-head">
        <div class="head-title">
          <h2>
            {r.mission.name}: {r.node.name}
          </h2>
          <p class="muted">
            Stage {r.stage + 1} of {r.stages.length}, {r.stages[r.stage]?.name} · {r.onGround} on the ground · threat {n(Math.round(r.threat))} against Power{' '}
            {n(Math.round(r.power))}
          </p>
        </div>
        <span class="chip chip-cyan">
          +{n(r.rp)} RP · +{formatCount(r.intel, v.notation)} Intel
        </span>
      </header>
      <StageTrack r={r} />
      <div class="phase">
        <div
          class="bar"
          role="progressbar"
          aria-label={brief ? 'Time to choose a tactic' : 'Stage progress'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <span class="muted">
          {brief
            ? `Choose a tactic: ${Math.ceil(r.timer)}s, then the standing order (${attendedBy}) runs the stage`
            : `${r.tactic?.name ?? 'Standing order'}${r.manual ? ' (your call, +' + Math.round(MARINE.activeBonus * 100) + '% pay)' : ''}: ${Math.ceil(r.timer)}s left`}
        </span>
      </div>
      {brief && (
        <ul class="tactics">
          {r.options.map((t) => (
            <li key={t.id}>
              <button type="button" class={`tactic tactic-${t.id}`} disabled={!t.available} onClick={() => pickTactic(s.squad.id, t.id as TacticId)}>
                <span class="tactic-name">{TACTIC_BY_ID[t.id].name}</span>
                <span class="tactic-odds">{pct(t.p)} to win</span>
                <span class="tactic-meta">
                  ~{(t.rate * r.onGround).toFixed(1)} casualties{t.deut > 0 ? ` · ${t.deut} Deut` : ''}
                </span>
                <span class="tactic-blurb">{t.note ?? TACTIC_BY_ID[t.id].blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="muted ops-note">
        Casualties so far: {r.wounded} wounded, {r.killed} killed.
        {r.garrison > 0 && ` ${r.garrison} Personnel committed as the garrison.`}
      </p>
    </section>
  );
}

function ReportPanel({ v, s }: { v: View; s: SquadView }) {
  const n = fmtFor(v);
  const last = s.last;
  if (!last) return null;
  const tone = last.outcome === 'won' ? 'chip-good' : last.outcome === 'lost' ? 'chip-bad' : '';
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>Last mission</h2>
          <p class="muted">
            {MISSIONS.find((m) => m.id === last.kind)?.name} at {last.nodeName}
          </p>
        </div>
        <span class={`chip ${tone}`}>{last.captured ? 'Position taken' : last.outcome === 'won' ? 'Success' : last.outcome === 'lost' ? 'Fell back' : 'Recalled'}</span>
      </header>
      <ul class="stage-log">
        {last.stages.map((st) => (
          <li key={st.stage} class={st.win ? 'win' : 'loss'}>
            <b>{st.name}</b>
            <span>{TACTIC_BY_ID[st.tactic].name}{st.manual ? ' (chosen)' : ''}</span>
            <span class="muted">{pct(st.p)} to win</span>
            <span>{st.win ? 'Won' : 'Lost'}</span>
            <span class="muted">
              {st.wounded} wounded, {st.killed} killed
            </span>
          </li>
        ))}
      </ul>
      <p class="muted ops-note">
        Earned {n(last.rp)} RP and {formatCount(last.intel, v.notation)} Intel · {last.wounded} wounded, {last.killed} killed.
      </p>
    </section>
  );
}

/* ---------- roster ---------- */

function MarineCard({ m, s }: { m: MarineView; s: SquadView }) {
  const id = s.squad.id;
  const onMission = s.run !== null;
  if (!m.marine || !m.unit || !m.rank) {
    return (
      <li class="marine marine-empty">
        <div class="marine-main">
          <Icon name="recruit" size={22} />
          <div class="marine-name">
            <b>Vacant</b>
            <span class="muted">Refilled with a {m.want.name} ({m.want.cost} Personnel)</span>
          </div>
        </div>
        <UnitPick m={m} s={s} />
      </li>
    );
  }
  return (
    <li class={`marine${m.ready ? '' : ' marine-hurt'}`}>
      <div class="marine-main">
        <Icon name={m.unit.medic ? 'medic' : 'ops'} size={22} />
        <div class="marine-name">
          <b>
            {m.rank.short} {m.unit.name} {m.marine.id}
          </b>
          <span class="muted">
            Power {Math.round(m.power)}
            {m.xpToNext !== null ? ` · ${m.xpToNext} XP to next rank` : ' · top rank'}
          </span>
        </div>
      </div>
      <div class="marine-state">
        {m.ready ? <span class="chip chip-good">Ready</span> : <span class="chip chip-bad">Wounded {formatDuration(m.hurt)}</span>}
        {!m.ready && <HullBar value={1 - m.hurt / MARINE.casualty.recoverySeconds} label={`${m.unit.name} recovery`} />}
      </div>
      <div class="marine-perks">
        {m.perks.map((p) => (
          <span key={p.id} class="chip chip-cyan" title={p.blurb}>
            {p.name}
          </span>
        ))}
        {m.pending > 0 &&
          m.options.map((p) => (
            <button key={p.id} type="button" class="ghost perk-pick" title={p.blurb} onClick={() => pickPerk(id, m.marine!.id, p.id)}>
              Choose {p.name}
            </button>
          ))}
      </div>
      <div class="marine-actions">
        <UnitPick m={m} s={s} />
        <button type="button" class="ghost" disabled={onMission} onClick={() => dischargeMarine(id, m.slot)} title="Send home; half the Personnel returns">
          Discharge
        </button>
      </div>
    </li>
  );
}

function UnitPick({ m, s }: { m: MarineView; s: SquadView }) {
  const unlocked = s.units.filter((u) => u.unlocked);
  if (unlocked.length < 2) return null;
  return (
    <select
      class="select select-small"
      aria-label={`Slot ${m.slot + 1} replacement`}
      value={s.squad.want[m.slot]}
      onChange={(e) => setSquadWant(s.squad.id, m.slot, (e.currentTarget as HTMLSelectElement).value)}
    >
      {unlocked.map((u) => (
        <option key={u.def.id} value={u.def.id}>
          Refill: {u.def.name} ({u.def.cost})
        </option>
      ))}
    </select>
  );
}

function RosterPanel({ v, s }: { v: View; s: SquadView }) {
  const n = fmtFor(v);
  const id = s.squad.id;
  const onMission = s.run !== null;
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>Roster</h2>
          <p class="muted">Marines earn experience, rank up and pick a perk at each promotion.</p>
        </div>
        <div class="head-actions">
          {s.pending > 0 && (
            <button type="button" class="ghost" onClick={() => autoChoosePerks(id)}>
              Pick perks for me
            </button>
          )}
          <button type="button" class="buy buy-small" disabled={s.vacancies === 0} onClick={() => reinforceSquad(id)}>
            Reinforce
          </button>
        </div>
      </header>
      <ul class="marines">
        {s.slots.map((m) => (
          <MarineCard key={m.slot} m={m} s={s} />
        ))}
      </ul>
      <h3 class="subhead">Vehicle</h3>
      <ul class="vehicles">
        <li>
          <button type="button" class={`vehicle${s.vehicle ? '' : ' current'}`} disabled={onMission} aria-pressed={!s.vehicle} onClick={() => fitSquadVehicle(id, null)}>
            <span class="vehicle-name">On foot</span>
            <span class="muted">No vehicle</span>
          </button>
        </li>
        {s.vehicles.map((c) => (
          <li key={c.def.id}>
            <button
              type="button"
              class={`vehicle${c.current ? ' current' : ''}`}
              disabled={onMission || !c.unlocked || (!c.current && !c.affordable)}
              aria-pressed={c.current}
              onClick={() => fitSquadVehicle(id, c.def.id)}
              title={c.def.blurb}
            >
              <span class="vehicle-name">
                <Icon name="vehicle" size={18} /> {c.def.name}
              </span>
              <span class="muted">
                {c.unlocked
                  ? c.current
                    ? 'Fitted'
                    : `${n(c.def.cost.rp)} RP, ${n(c.def.cost.ti)} Ti`
                  : 'Locked'}
              </span>
              <span class="muted">
                +{c.def.power} Power{c.def.flank ? ', can flank' : ''}
                {c.def.casualty < 1 ? `, ${Math.round((1 - c.def.casualty) * 100)}% fewer casualties` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- ground positions ---------- */

function PositionRow({ p, s }: { p: PositionView; s: SquadView }) {
  const id = s.squad.id;
  const busy = s.run !== null;
  const tone = p.odds ? (p.odds.worst >= 0.8 ? 'chip-good' : p.odds.worst >= 0.5 ? 'chip-amber' : 'chip-bad') : '';
  return (
    <li class={`node node-${p.status === 'held' ? 'cleared' : p.status}`}>
      <div class="node-state" aria-hidden="true">
        <Icon name={p.status === 'held' ? 'shield' : p.status === 'locked' ? 'lock' : 'crosshair'} size={22} />
      </div>
      <div class="node-main">
        <h3>
          {p.def.name}
          <span class={`chip ${p.status === 'held' ? 'chip-good' : p.status === 'open' ? 'chip-cyan' : ''}`}>
            {p.status === 'held' ? 'Held' : p.status === 'open' ? 'Open' : 'Fleet must clear the sector'}
          </span>
          {p.contested > 0 && (
            <span class="chip chip-bad" title="Overrun: the bonus is suspended until this runs out">
              Contested {formatDuration(p.contested)}
            </span>
          )}
        </h3>
        <p class="blurb">
          {p.node.name}: {p.def.blurb}
        </p>
        <p class="muted">
          Bonus {p.bonus} · garrison {p.def.garrison} Personnel · threat {Math.round(p.threat)} · trains up to{' '}
          {MARINE_RANKS[MARINE_RANKS.reduce((best, r, i) => (r.xp <= p.def.xpCap ? i : best), 0)].name}
          {p.scouted > 0 && p.status !== 'held' ? ` (scouted x${p.scouted})` : ''}
        </p>
      </div>
      <div class="node-actions">
        {p.odds && <span class={`chip ${tone}`}>{pct(p.odds.all)} assault</span>}
        {p.status !== 'locked' && (
          <button
            type="button"
            class="ghost"
            disabled={busy}
            onClick={() => {
              setSquadMission(id, 'recon');
              setSquadTarget(id, p.def.node);
            }}
          >
            Recon here
          </button>
        )}
        {p.status === 'open' && (
          <button
            type="button"
            class={p.targeted && s.squad.mission === 'assault' ? 'primary' : 'ghost'}
            disabled={busy}
            onClick={() => {
              setSquadMission(id, 'assault');
              setSquadTarget(id, p.def.node);
            }}
          >
            Assault here
          </button>
        )}
      </div>
    </li>
  );
}

function PositionsPanel({ o, s }: { v: View; o: OpsView; s: SquadView }) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>Ground positions</h2>
          <p class="muted">The fleet clears the sky; marines take the ground. A held position pays a permanent bonus, and Recon makes the assault easier this run.</p>
        </div>
        <span class="chip chip-cyan">
          {o.held}/{o.positions.length} held
        </span>
      </header>
      <ul class="nodes">
        {o.positions.map((p) => (
          <PositionRow key={p.def.node} p={p} s={s} />
        ))}
      </ul>
    </section>
  );
}
