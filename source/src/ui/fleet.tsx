import { useState } from 'preact/hooks';
import { formatCount, formatDuration } from '../core/numbers';
import { COMBAT, EQUIPMENT, EQUIPMENT_BY_ID, FLEET, NODE_BY_ID, SHIP_BY_ID } from '../data';
import type { Order, Priority, Row, Stance } from '../data';
import type { Unit } from '../sim/combat';
import type {
  AbilityView,
  ClassView,
  FleetView,
  GroupView,
  NodeView,
  SectorView,
  ShipView,
  View,
} from '../state/selectors';
import {
  assignShip,
  buySlip,
  cancelJob,
  decommissionShip,
  fleetTab,
  queueShip,
  refitShip,
  renameGroup,
  resumeGroup,
  scoutNode,
  scouted,
  selectGroup,
  selectedGroup,
  setBattleSpeed,
  setFleetTab,
  setGroupAuto,
  setGroupMinIntegrity,
  setGroupOrder,
  setGroupPatrol,
  setGroupPriority,
  setGroupOfficer,
  setGroupStance,
  setShipRow,
  useAbility,
} from '../state/store';
import type { FleetTab } from '../state/store';
import { fmtFor } from './components';
import { Icon } from './Icons';

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
const BAND_NAME = ['Close range', 'Medium range', 'Long range'] as const;

/* ---------- small shared pieces ---------- */

export function HullBar({ value, label }: { value: number; label: string }) {
  const tone = value > 0.6 ? 'good' : value > 0.3 ? 'warn' : 'bad';
  return (
    <div
      class={`hullbar hullbar-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Seg<T extends string | number>({
  label,
  value,
  options,
  onPick,
  disabled,
}: {
  label: string;
  value: T;
  options: { id: T; text: string; title?: string }[];
  onPick: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          title={o.title}
          aria-pressed={value === o.id}
          disabled={disabled}
          onClick={() => onPick(o.id)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/* ---------- the screen ---------- */

const TABS: { id: FleetTab; label: string }[] = [
  { id: 'battle', label: 'Battle' },
  { id: 'drydock', label: 'Drydock' },
  { id: 'sector', label: 'Sectors' },
];

export function FleetScreen({ v }: { v: View }) {
  const f = v.fleet;
  const tab = fleetTab.value;
  const group = f.groups.find((g) => g.group.id === selectedGroup.value) ?? f.groups[0];
  return (
    <>
      <section class="panel fleet-head">
        <div class="tabs" role="tablist" aria-label="Fleet sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="fleet-panel"
              onClick={() => setFleetTab(t.id)}
            >
              {t.label}
              {t.id === 'drydock' && f.queue.length > 0 && <span class="tab-count">{f.queue.length}</span>}
            </button>
          ))}
        </div>
        <Seg
          label="Battle speed"
          value={f.battleSpeed}
          options={FLEET.battleSpeeds.map((s) => ({ id: s, text: `${s}x`, title: `Run fleet operations at ${s}x speed` }))}
          onPick={setBattleSpeed}
        />
      </section>

      <div id="fleet-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} class="fleet-body">
        {tab === 'battle' && group && <BattleTab v={v} f={f} g={group} />}
        {tab === 'drydock' && <DrydockTab v={v} f={f} />}
        {tab === 'sector' && group && <SectorTab v={v} f={f} g={group} />}
      </div>
    </>
  );
}

/* ---------- battle tab ---------- */

function GroupPicker({ f }: { f: FleetView }) {
  if (f.groups.length < 2) return null;
  return (
    <div class="seg group-picker" role="group" aria-label="Strike group">
      {f.groups.map((g) => (
        <button key={g.group.id} type="button" aria-pressed={selectedGroup.value === g.group.id} onClick={() => selectGroup(g.group.id)}>
          {g.group.name}
          {g.battle && <span class="live-dot" title="In battle" />}
        </button>
      ))}
    </div>
  );
}

const ORDER_INFO: Record<Order, string> = {
  campaign: 'Push the next sector. Wins pay Requisition and Titanium and open the way on.',
  patrol: 'Repeat a cleared sector for Titanium and Deuterium. Keeps working while you are away.',
  reserve: 'Stay in dock. Ships repair four times faster.',
  support: 'Hold orbit over the marines. They can call orbital strikes, and every squad fights harder.',
};

function BattleTab({ v, f, g }: { v: View; f: FleetView; g: GroupView }) {
  return (
    <>
      <GroupPicker f={f} />
      <GroupHeader g={g} ops={v.ops.unlocked} />
      <BattleView g={g} v={v} />
      <Orders g={g} />
      <Roster g={g} />
    </>
  );
}

function GroupHeader({ g, ops }: { g: GroupView; ops: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(g.group.name);
  const target = g.target;
  const status = g.battle
    ? `In battle at ${g.battleNode ? NODE_BY_ID[g.battleNode]?.name : 'the front'}`
    : g.waiting ?? (target ? `Ready to sortie to ${target.name}` : 'Idle');
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          {renaming ? (
            <form
              class="rename"
              onSubmit={(e) => {
                e.preventDefault();
                renameGroup(g.group.id, name);
                setRenaming(false);
              }}
            >
              <input aria-label="Group name" value={name} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} />
              <button type="submit" class="ghost">
                Save
              </button>
            </form>
          ) : (
            <h2>
              {g.group.name}{' '}
              <button type="button" class="link" onClick={() => { setName(g.group.name); setRenaming(true); }}>
                Rename
              </button>
            </h2>
          )}
          <p class="muted">
            {g.ships.length} ship{g.ships.length === 1 ? '' : 's'}, Command {g.command} of {g.capacity}, integrity {pct(g.integrity)}
          </p>
        </div>
        <Seg
          label="Orders"
          value={g.group.order}
          options={[
            { id: 'campaign' as Order, text: 'Campaign', title: ORDER_INFO.campaign },
            { id: 'patrol' as Order, text: 'Patrol', title: ORDER_INFO.patrol },
            { id: 'reserve' as Order, text: 'Reserve', title: ORDER_INFO.reserve },
            ...(ops || g.group.order === 'support' ? [{ id: 'support' as Order, text: 'Support', title: ORDER_INFO.support }] : []),
          ]}
          onPick={(o) => setGroupOrder(g.group.id, o)}
        />
      </header>
      <div class="status-line">
        <p class={`status${g.group.stalled ? ' status-bad' : ''}`} role="status">
          {g.group.stalled ? 'Holding position after repeated defeats.' : status}
        </p>
        {g.group.stalled && (
          <button type="button" class="primary" onClick={() => resumeGroup(g.group.id)}>
            Resume
          </button>
        )}
      </div>
      <p class="muted order-info">{ORDER_INFO[g.group.order]}</p>
    </section>
  );
}

/* ---- the schematic battle view ---- */

const VB = { w: 560, h: 300 };
const HALF_GAP = [44, 90, 136];
const COLUMN = 40;

interface Spot {
  x: number;
  y: number;
}

function layout(units: Unit[], band: number): Map<number, Spot> {
  const spots = new Map<number, Spot>();
  const mid = VB.w / 2;
  const gap = HALF_GAP[Math.max(0, Math.min(2, band))];
  const rowIndex = { front: 0, line: 1, rear: 2 } as const;

  // Player: one column per row. Enemy: columns of five.
  const player = units.filter((u) => u.side === 'player');
  const enemy = units.filter((u) => u.side === 'enemy');
  const cols = new Map<string, Unit[]>();
  for (const u of player) {
    const key = `p${rowIndex[u.row]}`;
    cols.set(key, [...(cols.get(key) ?? []), u]);
  }
  enemy.forEach((u, i) => {
    const key = `e${Math.floor(i / 5)}`;
    cols.set(key, [...(cols.get(key) ?? []), u]);
  });
  for (const [key, list] of cols) {
    const col = Number(key.slice(1));
    const x = key[0] === 'p' ? mid - gap - col * COLUMN : mid + gap + col * COLUMN;
    const spacing = Math.min(54, (VB.h - 44) / Math.max(1, list.length));
    const y0 = VB.h / 2 - (spacing * (list.length - 1)) / 2;
    list.forEach((u, i) => spots.set(u.id, { x, y: y0 + i * spacing }));
  }
  return spots;
}

const TRACER: Record<string, string> = { kinetic: 'var(--kinetic)', explosive: 'var(--explosive)', energy: 'var(--energy)' };
const TRACER_SECONDS = 1.4;

function UnitGlyph({
  u,
  spot,
  focus,
  armed,
  onPick,
}: {
  u: Unit;
  spot: Spot;
  focus: boolean;
  armed: boolean;
  onPick?: () => void;
}) {
  const size = 1 + 0.25 * Math.sqrt(u.command);
  const hull = Math.max(0, u.hull) / u.maxHull;
  const shield = u.maxShield > 0 ? Math.max(0, u.shield) / u.maxShield : 0;
  const clickable = u.side === 'enemy' && u.alive && onPick;
  return (
    <g
      class={`unit-glyph glyph-${u.side}${u.alive ? '' : ' glyph-dead'}${armed && clickable ? ' glyph-armed' : ''}`}
      style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Focus fire on ${u.name}` : undefined}
      onClick={clickable ? onPick : undefined}
      onKeyDown={
        clickable
          ? (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick?.();
              }
            }
          : undefined
      }
    >
      <title>{`${u.name}: hull ${pct(hull)}${u.maxShield > 0 ? `, shield ${pct(shield)}` : ''}`}</title>
      {/* generous hit area for taps */}
      <rect x={-22} y={-20} width={44} height={40} fill="transparent" />
      <g transform={`scale(${u.side === 'player' ? size : -size}, ${size})`}>
        <path d="M-12 -7 L12 0 L-12 7 L-7 0 Z" class="glyph-hull" />
      </g>
      {focus && u.alive && <circle r={17} class="glyph-focus" />}
      {u.maxShield > 0 && u.alive && (
        <g transform="translate(-14, 13)">
          <rect width={28} height={2.5} class="bar-back" />
          <rect width={28 * shield} height={2.5} class="bar-shield" />
        </g>
      )}
      {u.alive && (
        <g transform={`translate(-14, ${u.maxShield > 0 ? 17 : 13})`}>
          <rect width={28} height={3} class="bar-back" />
          <rect width={28 * hull} height={3} class={hull > 0.5 ? 'bar-hull' : hull > 0.25 ? 'bar-hull-warn' : 'bar-hull-bad'} />
        </g>
      )}
      {!u.alive && <path d="M-7 -7 L7 7 M7 -7 L-7 7" class="glyph-x" />}
    </g>
  );
}

function BattleView({ g, v }: { g: GroupView; v: View }) {
  const [armed, setArmed] = useState(false);
  const b = g.battle;
  const sum = g.summary;
  if (!b || !sum) return <IdleBattle g={g} v={v} />;

  const spots = layout(b.units, b.band);
  const focusId = sum.focus?.target ?? -1;
  const pFrac = sum.player.start > 0 ? sum.player.left / sum.player.start : 0;
  const eFrac = sum.enemy.start > 0 ? sum.enemy.left / sum.enemy.start : 0;
  const name = g.battleNode ? NODE_BY_ID[g.battleNode]?.name : 'the front';

  const pick = (id: number): void => {
    useAbility(g.group.id, 'focus', id);
    setArmed(false);
  };
  const onAbility = (a: AbilityView): void => {
    if (a.id === 'focus') {
      setArmed(!armed);
      return;
    }
    useAbility(g.group.id, a.id);
  };

  return (
    <section class="panel battle" aria-label={`Battle at ${name}`}>
      <header class="battle-bar">
        <div class="battle-meta">
          <span class="chip chip-cyan">{BAND_NAME[sum.band]}</span>
          <span class="muted">{sum.control === 'player' ? 'You hold the range' : 'The enemy holds the range'}</span>
          <span class="muted">T+{formatDuration(sum.time)}</span>
        </div>
        <div class="forces">
          <ForceBar label="Your fleet" frac={pFrac} breakAt={sum.breakAt} left={sum.player.left} start={sum.player.start} side="player" />
          <ForceBar label="Enemy" frac={eFrac} breakAt={sum.breakAt} left={sum.enemy.left} start={sum.enemy.start} side="enemy" />
        </div>
      </header>

      <svg class="battle-svg" viewBox={`0 0 ${VB.w} ${VB.h}`} role="img" aria-label={`${name}: ${BAND_NAME[sum.band]}`} preserveAspectRatio="xMidYMid meet">
        <line x1={VB.w / 2} y1={10} x2={VB.w / 2} y2={VB.h - 10} class="battle-mid" />
        {b.recent
          .filter((s) => b.time - s.t < TRACER_SECONDS)
          .map((s, i) => {
            const a = spots.get(s.from);
            const t = spots.get(s.to);
            if (!a || !t) return null;
            const age = (b.time - s.t) / TRACER_SECONDS;
            return (
              <line
                key={`${s.t}-${s.from}-${s.to}-${s.weapon}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={t.x}
                y2={t.y}
                class={s.hits > 0 ? 'tracer' : 'tracer tracer-miss'}
                style={{ stroke: TRACER[s.type] ?? 'var(--fg)', opacity: Math.max(0.08, 0.9 - age) }}
              />
            );
          })}
        {b.units.map((u) => {
          const spot = spots.get(u.id);
          if (!spot) return null;
          return <UnitGlyph key={u.id} u={u} spot={spot} focus={u.id === focusId} armed={armed} onPick={() => pick(u.id)} />;
        })}
      </svg>
      {armed && (
        <p class="armed-note" role="status">
          Pick an enemy ship to focus fire on.
        </p>
      )}
      {sum.outcome && <p class="armed-note">Battle over: {sum.outcome}.</p>}

      <div class="abilities" role="group" aria-label="Commander abilities">
        {g.abilities.map((a) => (
          <button
            key={a.id}
            type="button"
            class={`ability${a.active ? ' ability-on' : ''}${armed && a.id === 'focus' ? ' ability-armed' : ''}`}
            disabled={!a.usable && !(a.id === 'focus' && armed)}
            aria-pressed={a.id === 'focus' ? armed : a.active}
            title={a.blurb}
            onClick={() => onAbility(a)}
          >
            <Icon name={ABILITY_ICON[a.id]} size={20} />
            <span class="ability-name">{a.id === 'focus' && armed ? 'Pick a target' : a.name}</span>
            <span class="ability-cost">
              {a.active
                ? 'Active'
                : a.cooldown > 0
                  ? `${Math.ceil(a.cooldown)}s`
                  : `${a.cost} Deut`}
            </span>
          </button>
        ))}
        <label class="auto-toggle">
          <input type="checkbox" checked={g.group.autoAbilities} onChange={(e) => setGroupAuto(g.group.id, e.currentTarget.checked)} />
          <span>Auto commander</span>
        </label>
      </div>
    </section>
  );
}

const ABILITY_ICON: Record<AbilityView['id'], string> = {
  focus: 'crosshair',
  evasive: 'shield',
  overcharge: 'bolt',
  retreat: 'exit',
};

function ForceBar({
  label,
  frac,
  breakAt,
  left,
  start,
  side,
}: {
  label: string;
  frac: number;
  breakAt: number;
  left: number;
  start: number;
  side: 'player' | 'enemy';
}) {
  return (
    <div class="force">
      <span class="force-label">
        {label} <b>{left}</b>/{start}
      </span>
      <div
        class={`force-bar force-${side}`}
        role="progressbar"
        aria-label={`${label} Command remaining`}
        aria-valuemin={0}
        aria-valuemax={start}
        aria-valuenow={left}
      >
        <i style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
        <u style={{ left: `${breakAt * 100}%` }} title="The fleet breaks here" />
      </div>
    </div>
  );
}

function IdleBattle({ g, v }: { g: GroupView; v: View }) {
  const n = fmtFor(v);
  const last = g.last;
  const r = last?.result;
  const outcomeText = r
    ? r.outcome === 'victory'
      ? 'Victory'
      : r.outcome === 'defeat'
        ? 'Defeat'
        : r.outcome === 'retreat'
          ? 'Withdrew'
          : 'Stalemate'
    : null;
  return (
    <section class="panel battle battle-idle" aria-label="Battle">
      <div class="idle-body">
        <div class="idle-art" aria-hidden="true">
          <Icon name="fleet" size={44} />
        </div>
        <div>
          <h3>{g.group.order === 'reserve' ? 'In dock' : g.group.order === 'support' ? 'On support duty' : g.waiting ?? 'Preparing to sortie'}</h3>
          <p class="muted">
            {g.target
              ? `Next target: ${g.target.name}. A sortie costs ${g.sortieCost} Deuterium.`
              : 'Set orders for this group to send it out.'}
          </p>
          {g.rest > 0 && !g.group.stalled && <p class="muted">Rearming for {Math.ceil(g.rest)}s.</p>}
        </div>
      </div>
      {last && r && (
        <div class={`last-result last-${r.outcome}`}>
          <h4>
            Last sortie: {outcomeText} at {last.nodeName}
          </h4>
          <p class="muted">
            {formatDuration(r.seconds)}
            {r.rp.gt(0) && <> · +{n(r.rp)} RP</>}
            {r.ti > 0 && <> · +{n(r.ti)} Ti</>}
            {r.deut > 0 && <> · +{n(r.deut)} Deut</>}
            {r.salvage > 0 && <> · +{n(r.salvage)} Salvage</>}
            {r.firstClear && <> · first clear bonus</>}
            {r.crippled > 0 && <> · {r.crippled} crippled</>}
          </p>
        </div>
      )}
    </section>
  );
}

/* ---- orders ---- */

const STANCE_OPTIONS = (['standoff', 'standard', 'closein'] as Stance[]).map((s) => ({
  id: s,
  text: COMBAT.stance[s].name,
  title: `Fight at ${COMBAT.stance[s].band} range when your fleet holds the range`,
}));

const PRIORITY_OPTIONS: { id: Priority; text: string; title: string }[] = [
  { id: 'weakest', text: 'Weakest', title: 'Finish damaged ships first' },
  { id: 'strongest', text: 'Strongest', title: 'Go for the biggest threat' },
  { id: 'shields', text: 'Shields', title: 'Strip shields first' },
  { id: 'carriers', text: 'Carriers', title: 'Hit carriers and support ships first' },
];

function Orders({ g }: { g: GroupView }) {
  const id = g.group.id;
  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Standing orders</h2>
        <span class="muted">Apply to the next sortie</span>
      </header>
      <div class="orders">
        <div class="order-field">
          <span class="field-label">Stance</span>
          <Seg label="Stance" value={g.group.stance} options={STANCE_OPTIONS} onPick={(s) => setGroupStance(id, s)} />
        </div>
        <div class="order-field">
          <span class="field-label">Target priority</span>
          <Seg label="Target priority" value={g.group.priority} options={PRIORITY_OPTIONS} onPick={(p) => setGroupPriority(id, p)} />
        </div>
        <div class="order-field">
          <span class="field-label">Officer</span>
          <select
            class="select"
            aria-label="Officer leading this group"
            data-officer-select
            value={g.group.officer ?? ''}
            onChange={(e) => setGroupOfficer(id, (e.currentTarget as HTMLSelectElement).value || null)}
          >
            <option value="">None</option>
            {g.officers.map((o) => (
              <option key={o.def.id} value={o.def.id} disabled={!o.available}>
                {o.available ? `${o.def.name}, ${o.def.title}: ${o.effect}${o.elsewhere ? ` (now with ${o.elsewhere})` : ''}` : `${o.def.title}: clear ${o.unlockName}`}
              </option>
            ))}
          </select>
          {g.officer && <p class="muted field-note">{g.officer.blurb}</p>}
        </div>
        <div class="order-field">
          <span class="field-label">Sortie when repaired to</span>
          <Seg
            label="Minimum integrity to sortie"
            value={g.group.minIntegrity}
            options={FLEET.integrityPresets.map((p) => ({ id: p, text: pct(p) }))}
            onPick={(p) => setGroupMinIntegrity(id, p)}
          />
        </div>
      </div>
    </section>
  );
}

/* ---- roster ---- */

const ROW_OPTIONS: { id: Row; text: string; title: string }[] = [
  { id: 'front', text: 'Front', title: 'Draws the most fire' },
  { id: 'line', text: 'Line', title: 'Takes a share of the fire' },
  { id: 'rear', text: 'Rear', title: 'Draws the least fire' },
];

function Roster({ g }: { g: GroupView }) {
  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Ships</h2>
        <span class="muted">Front-row ships draw the most fire</span>
      </header>
      {g.ships.length === 0 ? (
        <p class="empty">No ships in this group. Build some at the drydock.</p>
      ) : (
        <ul class="roster">
          {g.ships.map((s) => (
            <li key={s.ship.id} class={`roster-row${s.crippled ? ' roster-crippled' : ''}`}>
              <div class="roster-main">
                <Icon name={SHIP_BY_ID[s.ship.classId]?.icon ?? 'frigate'} size={22} />
                <div class="roster-name">
                  <b>{s.name}</b>
                  <span class="muted">
                    {s.rank.name}
                    {s.xpToNext !== null ? ` · ${s.xpToNext} to next rank` : ''}
                  </span>
                </div>
              </div>
              <div class="roster-hull">
                <HullBar value={s.hull} label={`${s.name} hull`} />
                <span class="muted">{s.crippled ? 'Crippled' : pct(s.hull)}</span>
              </div>
              <Seg label={`${s.name} row`} value={s.ship.row} options={ROW_OPTIONS} onPick={(r) => setShipRow(s.ship.id, r)} disabled={g.battle !== null} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- drydock tab ---------- */

function DrydockTab({ v, f }: { v: View; f: FleetView }) {
  const n = fmtFor(v);
  return (
    <>
      <section class="panel">
        <header class="panel-head">
          <h2>Slipways</h2>
          <span class="muted">
            {Math.min(f.slips, f.queue.length)} of {f.slips} building · queue {f.queue.length}/{f.queueLimit}
          </span>
        </header>
        {f.queue.length === 0 ? (
          <p class="empty">The slips are empty. Lay down a hull below.</p>
        ) : (
          <ul class="queue">
            {f.queue.map((j) => (
              <li key={j.index} class={j.working ? '' : 'queue-wait'}>
                <span class="queue-name">{j.name}</span>
                <div
                  class="bar"
                  role="progressbar"
                  aria-label={`${j.name} construction`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((1 - j.remaining / j.total) * 100)}
                >
                  <i style={{ width: `${(j.working ? 1 - j.remaining / j.total : 0) * 100}%` }} />
                </div>
                <span class="muted queue-time">{j.working ? formatDuration(j.remaining) : 'Waiting for a slip'}</span>
                <button type="button" class="ghost" onClick={() => cancelJob(j.index)}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="slip-buy">
          {f.slipCost === null ? (
            <span class="muted">Every slip is built.</span>
          ) : (
            <button type="button" class="buy buy-small" disabled={!f.canBuySlip} onClick={buySlip}>
              Build slip {f.slips + 1}: {n(f.slipCost)} RP
            </button>
          )}
          <span class="muted">Each slip builds one ship at a time. Cancelling refunds everything.</span>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Ship designs</h2>
          <span class="muted">Paid up front in Requisition and Titanium-A</span>
        </header>
        <ul class="classes">
          {f.classes.map((c) => (
            <ClassCard key={c.def.id} c={c} v={v} />
          ))}
        </ul>
      </section>

      <FleetList v={v} f={f} />
    </>
  );
}

function ClassCard({ c, v }: { c: ClassView; v: View }) {
  const n = fmtFor(v);
  const d = c.def;
  const unlockNode = d.unlock.kind === 'node' ? NODE_BY_ID[d.unlock.node] : undefined;
  return (
    <li class={`class-card${c.unlocked ? '' : ' class-locked'}`}>
      <div class="class-icon">
        <Icon name={c.unlocked ? d.icon : 'lock'} size={30} />
      </div>
      <div class="class-main">
        <h3>
          {d.name} <span class="muted class-canon">{d.canon}</span>
        </h3>
        <p class="blurb">{d.role}</p>
        {c.unlocked ? (
          <dl class="class-stats">
            <div>
              <dt>Command</dt>
              <dd>{d.command}</dd>
            </div>
            <div>
              <dt>Hull</dt>
              <dd>{formatCount(d.hull, v.notation)}</dd>
            </div>
            <div>
              <dt>Armour</dt>
              <dd>{d.armour}</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{d.speed.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Slots</dt>
              <dd>
                {d.slots.weapon}W {d.slots.defence}D {d.slots.utility}U
              </dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>{formatDuration(d.buildSeconds)}</dd>
            </div>
          </dl>
        ) : (
          <p class="muted">{unlockNode ? `Clear ${unlockNode.name} to unlock this design.` : 'Locked.'}</p>
        )}
        {c.unlocked && (
          <p class="muted">
            Owned {c.owned}
            {c.queued > 0 ? `, ${c.queued} in the queue` : ''}
          </p>
        )}
      </div>
      {c.unlocked && (
        <button type="button" class="buy" disabled={!c.canQueue} onClick={() => queueShip(d.id)} title={c.reason ?? undefined}>
          <span class="buy-label">Build</span>
          <span class={`buy-cost${c.afford.rp ? '' : ' short'}`}>{n(d.cost.rp)} RP</span>
          <span class={`buy-gain${c.afford.ti ? '' : ' short'}`}>{n(d.cost.ti)} Ti</span>
        </button>
      )}
    </li>
  );
}

function FleetList({ v, f }: { v: View; f: FleetView }) {
  const all: ShipView[] = [...f.groups.flatMap((g) => g.ships), ...f.hangar];
  const busy = (groupId: number): boolean => f.groups.find((g) => g.group.id === groupId)?.battle != null;
  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Fleet roster</h2>
        <span class="muted">
          {all.length} ship{all.length === 1 ? '' : 's'}
          {f.cadreXp > 0 ? ` · veteran cadre: new crews start with ${f.cadreXp} XP` : ''}
        </span>
      </header>
      {all.length === 0 ? (
        <p class="empty">No ships yet.</p>
      ) : (
        <ul class="ship-cards">
          {all.map((s) => (
            <ShipCard key={s.ship.id} s={s} f={f} locked={busy(s.ship.group)} v={v} />
          ))}
        </ul>
      )}
    </section>
  );
}

const SLOT_LABEL = { weapon: 'Weapon', defence: 'Defence', utility: 'Utility' } as const;

function ShipCard({ s, f, locked, v }: { s: ShipView; f: FleetView; locked: boolean; v: View }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const n = fmtFor(v);
  const groupId = s.ship.group;
  const where = groupId === 0 ? 'Hangar' : (f.groups.find((g) => g.group.id === groupId)?.group.name ?? 'Group');
  const refund = Math.floor(s.ship.classId ? (f.classes.find((c) => c.def.id === s.ship.classId)?.def.cost.ti ?? 0) * 0.5 : 0);
  return (
    <li class={`ship-card${s.crippled ? ' ship-crippled' : ''}`}>
      <div class="ship-line">
        <Icon name={SHIP_BY_ID[s.ship.classId]?.icon ?? 'frigate'} size={22} />
        <div class="ship-id">
          <b>{s.name}</b>
          <span class="muted">
            {s.rank.name} · {where}
          </span>
        </div>
        <div class="ship-hull">
          <HullBar value={s.hull} label={`${s.name} hull`} />
          <span class="muted">{s.crippled ? 'Crippled' : pct(s.hull)}</span>
        </div>
        <button type="button" class="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Refit'}
        </button>
      </div>
      {open && (
        <div class="ship-detail">
          <dl class="class-stats">
            <div>
              <dt>Hull</dt>
              <dd>{n(s.maxHull)}</dd>
            </div>
            <div>
              <dt>Armour</dt>
              <dd>{s.armour.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Damage</dt>
              <dd>x{s.damageMult.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Point defence</dt>
              <dd>{s.pd}</dd>
            </div>
          </dl>
          {locked && <p class="muted">This ship's group is in battle. Refits wait for it to dock.</p>}
          <div class="slots">
            {(['weapon', 'defence', 'utility'] as const).map((slot) =>
              s.loadout[slot].map((equipId, i) => (
                <label key={`${slot}${i}`} class="slot">
                  <span class="field-label">
                    {SLOT_LABEL[slot]} {s.loadout[slot].length > 1 ? i + 1 : ''}
                  </span>
                  <select
                    value={equipId}
                    disabled={locked}
                    title={EQUIPMENT_BY_ID[equipId]?.blurb}
                    onChange={(e) => refitShip(s.ship.id, slot, i, e.currentTarget.value)}
                  >
                    {EQUIPMENT.filter((e) => e.slot === slot).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
              )),
            )}
          </div>
          <p class="muted slot-note">{EQUIPMENT_BY_ID[s.loadout.weapon[0]]?.blurb}</p>
          <div class="ship-actions">
            <label class="slot">
              <span class="field-label">Assigned to</span>
              <select
                value={groupId}
                disabled={locked}
                onChange={(e) => assignShip(s.ship.id, Number(e.currentTarget.value))}
              >
                <option value={0}>Hangar</option>
                {f.groups.map((g) => (
                  <option key={g.group.id} value={g.group.id}>
                    {g.group.name}
                  </option>
                ))}
              </select>
            </label>
            {confirm ? (
              <div class="row">
                <button
                  type="button"
                  class="danger"
                  onClick={() => {
                    decommissionShip(s.ship.id);
                    setConfirm(false);
                  }}
                >
                  Scrap for {n(refund)} Ti
                </button>
                <button type="button" class="ghost" onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" class="ghost" disabled={locked} onClick={() => setConfirm(true)}>
                Decommission
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------- sectors tab ---------- */

function SectorTab({ v, f, g }: { v: View; f: FleetView; g: GroupView }) {
  return (
    <>
      <GroupPicker f={f} />
      {f.theatres.map((t) => (
        <TheatrePanel key={t.theatre.id} t={t} g={g} v={v} />
      ))}
      <section class="panel">
        <header class="panel-head">
          <h2>Service record</h2>
        </header>
        <dl class="facts record">
          <div>
            <dt>Battles fought</dt>
            <dd>{formatCount(f.battles.total, v.notation)}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd>{formatCount(f.battles.won, v.notation)}</dd>
          </div>
          <div>
            <dt>Lost</dt>
            <dd>{formatCount(f.battles.lost, v.notation)}</dd>
          </div>
          <div>
            <dt>Veteran cadre</dt>
            <dd>{f.cadreXp} XP</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

function TheatrePanel({ t, g, v }: { t: SectorView; g: GroupView; v: View }) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>{t.theatre.name}</h2>
          <p class="muted">{t.theatre.blurb}</p>
        </div>
        <span class="chip chip-cyan">
          {t.cleared}/{t.total} secured · production x{t.multiplier.toFixed(2)}
        </span>
      </header>
      <ul class="nodes">
        {t.nodes.map((n) => (
          <NodeRow key={n.def.id} n={n} g={g} v={v} />
        ))}
      </ul>
    </section>
  );
}

function NodeRow({ n, g, v }: { n: NodeView; g: GroupView; v: View }) {
  const num = fmtFor(v);
  const key = `${g.group.id}:${n.def.id}`;
  const scout = scouted.value[key];
  const locked = n.status === 'locked';
  const earlier = locked && n.patrol;
  const patrolling = g.group.order === 'patrol' && g.group.patrolNode === n.def.id;
  return (
    <li class={`node node-${earlier ? 'open' : n.status}`}>
      <div class="node-state" aria-hidden="true">
        {n.status === 'cleared' ? <Icon name="crosshair" size={22} /> : locked ? <Icon name="lock" size={22} /> : <Icon name="fleet" size={22} />}
      </div>
      <div class="node-main">
        <h3>
          {n.def.name}
          {n.def.boss && <span class="chip chip-amber">Boss</span>}
          <span class={`chip ${n.status === 'cleared' ? 'chip-good' : n.status === 'open' ? 'chip-cyan' : ''}`}>
            {n.status === 'cleared' ? `Secured x${n.clears}` : n.status === 'open' ? 'Next' : n.patrol ? 'Cleared earlier' : 'Locked'}
          </span>
        </h3>
        <p class="blurb">{n.def.blurb}</p>
        <p class="muted node-enemies">{n.enemies.map((e) => `${e.count} ${e.name}${e.count > 1 ? 's' : ''}`).join(', ')}</p>
        <p class="muted node-rewards">
          {n.status === 'cleared' ? 'Campaign' : n.reward.firstClear ? 'First clear' : 'Campaign'}: {num(n.reward.rp)} RP, {num(n.reward.ti)} Ti · Patrol:{' '}
          {num(n.def.patrol.ti)} Ti, {num(n.def.patrol.deut)} Deut
          {n.unlocks.length > 0 && ` · Unlocks ${n.unlocks.join(', ')}`}
        </p>
      </div>
      <div class="node-actions">
        {scout && <span class="scout">{pct(scout.winRate)} win</span>}
        {!locked && (
          <button type="button" class="ghost" disabled={g.ships.length === 0} onClick={() => scoutNode(g.group.id, n.def.id)}>
            Scout
          </button>
        )}
        {n.patrol && (
          <button
            type="button"
            class={patrolling ? 'primary' : 'ghost'}
            aria-pressed={patrolling}
            onClick={() => {
              setGroupPatrol(g.group.id, n.def.id);
              setGroupOrder(g.group.id, 'patrol');
            }}
          >
            {patrolling ? 'Patrolling' : 'Patrol here'}
          </button>
        )}
      </div>
    </li>
  );
}
