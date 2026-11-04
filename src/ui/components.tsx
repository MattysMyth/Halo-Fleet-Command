import { useEffect, useRef } from 'preact/hooks';
import { formatCount, formatDuration, formatNumber } from '../core/numbers';
import type { DecimalSource } from '../core/numbers';
import type { BuildingSection, BuildingView, StockView, View } from '../state/selectors';
import {
  buyBuilding,
  dismissOffline,
  driveClick,
  logEntries,
  notice,
  offlineReport,
  saveInfo,
  setBuyMode,
  setScreen,
  screen,
} from '../state/store';
import type { Screen } from '../state/store';
import type { BuyMode } from '../state/types';
import { Icon } from './Icons';

/** Number formatter bound to the player's chosen notation. */
export const fmtFor =
  (v: View) =>
  (x: DecimalSource): string =>
    formatNumber(x, v.notation);

/* ---------- navigation ---------- */

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'command', label: 'Command', icon: 'command' },
  { id: 'fleet', label: 'Fleet', icon: 'fleet' },
  { id: 'operations', label: 'Operations', icon: 'ops' },
  { id: 'research', label: 'Research', icon: 'research' },
  { id: 'campaign', label: 'Campaign', icon: 'map' },
  { id: 'prestige', label: 'Redeploy', icon: 'prestige' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function Nav({ v }: { v: View }) {
  const stalled = v.fleet.groups.some((g) => g.group.stalled);
  const opsStalled = v.ops.squads.some((q) => q.squad.stalled);
  const opsPerks = v.ops.squads.some((q) => q.pending > 0);
  return (
    <nav class="nav" aria-label="Screens">
      {NAV.filter((item) => (item.id !== 'fleet' || v.fleet.unlocked) && (item.id !== 'operations' || v.ops.unlocked) && (item.id !== 'research' || v.research.unlocked) && (item.id !== 'campaign' || v.campaign.unlocked)).map((item) => (
        <button
          key={item.id}
          type="button"
          class="nav-item"
          aria-current={screen.value === item.id ? 'page' : undefined}
          onClick={() => setScreen(item.id)}
        >
          <Icon name={item.icon} size={22} />
          <span>{item.label}</span>
          {item.id === 'prestige' && v.redeploy.ready && <span class="nav-dot" title="Redeploy is ready" />}
          {item.id === 'campaign' && v.campaign.transfer.ready && <span class="nav-dot" title="A Transfer is ready" />}
          {item.id === 'fleet' && stalled && <span class="nav-dot nav-dot-warn" title="A strike group needs orders" />}
          {item.id === 'operations' && (opsStalled || opsPerks) && (
            <span class="nav-dot nav-dot-warn" title={opsStalled ? 'A squad needs orders' : 'A promotion is waiting'} />
          )}
        </button>
      ))}
    </nav>
  );
}

/* ---------- readout ---------- */

export function Readout({ v }: { v: View }) {
  const n = fmtFor(v);
  return (
    <section class="readout" aria-label="Requisition">
      <div class="readout-main">
        <span class="readout-label">Requisition</span>
        <p class="readout-value">{n(v.rp)}</p>
        <div class="readout-line">
          <span class="readout-rate">+{n(v.rps)} per second</span>
          {v.medalsEarned > 0 && (
            <span class="chip chip-amber" title={`${v.medalsEarned} Service Medals earned`}>
              Medal bonus x{v.multiplier.toFixed(2)}
            </span>
          )}
          {v.campaign.honorsEarned > 0 && (
            <span class="chip chip-amber" title={`${v.campaign.honorsEarned} Battle Honors earned: ship damage and marine Power`}>
              Honors +{Math.round(v.campaign.honorBonus * 100)}%
            </span>
          )}
          {v.sectorMultiplier > 1 && (
            <span class="chip chip-cyan" title="Production bonus from sectors under control">
              Sectors x{v.sectorMultiplier.toFixed(2)}
            </span>
          )}
        </div>
        {v.showStocks && (
          <div class="stocks" aria-label="Fleet supplies">
            <StockPill label="Titanium-A" icon="ti" stock={v.ti} v={v} />
            <StockPill label="Deuterium" icon="deut" stock={v.deut} v={v} />
            {v.ops.unlocked && <StockPill label="Personnel" icon="pers" stock={v.ops.pers} v={v} />}
            {v.ops.unlocked && <StockPill label="Intel" icon="intel" stock={v.ops.intel} v={v} />}
            {(v.salvage.amount.gt(0) || v.research.unlocked) && <StockPill label="Salvage" icon="salvage" stock={v.salvage} v={v} />}
          </div>
        )}
      </div>
      <button type="button" class="drive" onClick={driveClick}>
        <span class="drive-title">Requisition drive</span>
        <span class="drive-gain">+{n(v.driveYield)} RP</span>
      </button>
    </section>
  );
}

function StockPill({ label, icon, stock, v }: { label: string; icon: string; stock: StockView; v: View }) {
  const n = fmtFor(v);
  const full = stock.fill >= 0.999;
  return (
    <div
      class={`stock${full ? ' stock-full' : ''}`}
      title={`${label}: ${n(stock.amount)} of ${n(stock.cap)} stored`}
      role="group"
      aria-label={`${label}: ${n(stock.amount)} of ${n(stock.cap)}`}
    >
      <Icon name={icon} size={18} />
      <span class="stock-name">{label}</span>
      <b class="stock-amount">{n(stock.amount)}</b>
      <span class="stock-rate">{stock.perSecond.gt(0) ? `+${n(stock.perSecond)}/s` : ''}</span>
      <span class="stock-cap" aria-hidden="true">
        <i style={{ width: `${stock.fill * 100}%` }} />
      </span>
    </div>
  );
}

/* ---------- buildings ---------- */

const MODES: BuyMode[] = [1, 10, 100, 'max'];

export function BuyModes({ v }: { v: View }) {
  return (
    <div class="seg" role="group" aria-label="Buy amount">
      {MODES.map((m) => (
        <button key={String(m)} type="button" aria-pressed={v.buyMode === m} onClick={() => setBuyMode(m)}>
          {m === 'max' ? 'Max' : `x${m}`}
        </button>
      ))}
    </div>
  );
}

const UNIT_LABEL = { rp: '', ti: ' Ti', deut: ' Deut', pers: ' Pers', intel: ' Intel' } as const;

export function BuildingRow({ b, v }: { b: BuildingView; v: View }) {
  const n = fmtFor(v);
  if (!b.unlocked) {
    if (!b.teaser) return null;
    return (
      <li class="unit unit-locked">
        <div class="unit-icon">
          <Icon name="lock" size={26} />
        </div>
        <div class="unit-main">
          <h3>{b.def.name}</h3>
          <p class="muted">Locked. {b.unlockText} to open this line.</p>
        </div>
      </li>
    );
  }

  const unit = UNIT_LABEL[b.resource];
  const m = b.milestone;
  const fill = m.next === null ? 1 : (b.owned - m.previous) / (m.next - m.previous);
  return (
    <li class="unit">
      <div class="unit-icon">
        <Icon name={b.def.icon} size={28} />
      </div>
      <div class="unit-main">
        <h3>
          {b.def.name}
          {b.autobuy && <span class="chip chip-cyan">Auto</span>}
        </h3>
        <p class="blurb">{b.def.blurb}</p>
        <div class="milestone">
          <div
            class="bar"
            role="progressbar"
            aria-label={`${b.def.name} milestone progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fill * 100)}
          >
            <i style={{ width: `${fill * 100}%` }} />
          </div>
          <span class="milestone-text">
            {m.next === null ? 'All doublings reached' : `Doubles at ${m.next} (${b.owned} owned)`}
          </span>
        </div>
      </div>
      <dl class="unit-stats">
        <div>
          <dt>Owned</dt>
          <dd>{formatCount(b.owned, v.notation)}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>
            {n(b.output)}
            {unit}/s
          </dd>
        </div>
      </dl>
      <button type="button" class="buy" disabled={!b.canAfford} onClick={() => buyBuilding(b.def.id)}>
        <span class="buy-label">Buy {b.labelCount}</span>
        <span class="buy-cost">{n(b.cost)} RP</span>
        <span class="buy-gain">
          +{n(b.gain)}
          {unit}/s
        </span>
      </button>
    </li>
  );
}

export function BuildingSectionPanel({ section, v, first }: { section: BuildingSection; v: View; first: boolean }) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>{section.title}</h2>
          <p class="muted">{section.blurb}</p>
        </div>
        {first && <BuyModes v={v} />}
      </header>
      <ul class="units">
        {section.buildings.map((b) => (
          <BuildingRow key={b.def.id} b={b} v={v} />
        ))}
      </ul>
    </section>
  );
}

/* ---------- log ---------- */

export function EventLog() {
  const entries = logEntries.value;
  return (
    <section class="panel log" aria-label="Dispatches">
      <header class="panel-head">
        <h2>Dispatches</h2>
      </header>
      <ol class="log-list">
        {entries.map((e) => (
          <li key={e.id} class={`log-${e.kind}`}>
            <time>T+{e.at}</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- dialogs and banners ---------- */

export function OfflineModal({ v }: { v: View }) {
  const report = offlineReport.value;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!report) return;
    button.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissOffline();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report]);
  if (!report) return null;

  const n = fmtFor(v);
  const capped = report.awaySeconds > report.appliedSeconds;
  return (
    <div class="scrim">
      <div class="panel dialog" role="dialog" aria-modal="true" aria-labelledby="offline-title">
        <h2 id="offline-title">Welcome back, Commander</h2>
        <p class="muted">Your logistics staff kept the convoys moving while you were away.</p>
        <dl class="facts">
          <div>
            <dt>Time away</dt>
            <dd>{formatDuration(report.awaySeconds)}</dd>
          </div>
          <div>
            <dt>Time counted</dt>
            <dd>
              {formatDuration(report.appliedSeconds)}
              {capped && <span class="muted"> (cap {formatDuration(report.capSeconds)})</span>}
            </dd>
          </div>
          <div>
            <dt>Output while away</dt>
            <dd>{Math.round(report.efficiency * 100)}% of normal</dd>
          </div>
          <div>
            <dt>Requisition earned</dt>
            <dd class="accent">{n(report.gained)} RP</dd>
          </div>
          {report.ti.gt(0) && (
            <div>
              <dt>Titanium-A mined</dt>
              <dd class="accent">{n(report.ti)}</dd>
            </div>
          )}
          {report.deut.gt(0) && (
            <div>
              <dt>Deuterium refined</dt>
              <dd class="accent">{n(report.deut)}</dd>
            </div>
          )}
          {report.fleet.launched > 0 && (
            <div>
              <dt>Ships launched</dt>
              <dd>{report.fleet.launched}</dd>
            </div>
          )}
          {report.bought > 0 && (
            <div>
              <dt>Bought by autobuyers</dt>
              <dd>{formatCount(report.bought, v.notation)} buildings</dd>
            </div>
          )}
        </dl>
        {report.marines.missions > 0 && (
          <div class="patrols">
            <h3>Marine reports</h3>
            <ul>
              <li>
                Squads flew {report.marines.missions} mission{report.marines.missions === 1 ? '' : 's'} and won {report.marines.won}
                <span class="muted">
                  {' '}
                  (+{n(report.marines.rp)} RP, +{formatCount(report.marines.intel, v.notation)} Intel
                  {report.marines.killed > 0 ? `, ${report.marines.killed} killed` : ''})
                </span>
              </li>
              {report.marines.captured > 0 && <li>{report.marines.captured} position{report.marines.captured === 1 ? '' : 's'} taken.</li>}
              
            </ul>
          </div>
        )}
        {report.research.length > 0 && (
          <div class="patrols">
            <h3>Research</h3>
            <ul>
              <li>Finished while you were away: {report.research.join(', ')}.</li>
            </ul>
          </div>
        )}
        {report.fleet.patrols.length > 0 && (
          <div class="patrols">
            <h3>Patrol reports</h3>
            <ul>
              {report.fleet.patrols.map((p) => (
                <li key={p.group}>
                  <b>{p.name}</b> fought {p.battles} battle{p.battles === 1 ? '' : 's'} at {p.nodeName} and won {p.wins}
                  <span class="muted">
                    {' '}
                    (+{n(p.ti)} Ti, +{n(p.deut)} Deut{p.salvage > 0 ? `, +${n(p.salvage)} Salvage` : ''})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button ref={button} type="button" class="primary" onClick={dismissOffline}>
          Resume
        </button>
      </div>
    </div>
  );
}

export function StorageBanner() {
  const info = saveInfo.value;
  if (info.persistent && info.ok) return null;
  return (
    <p class="banner" role="status">
      This browser is not letting the game save. Progress will be lost when you close the page. Open Settings and
      export your save to keep it.
    </p>
  );
}

/** A brief message about an action that did not go through. */
export function Notice() {
  const text = notice.value;
  if (!text) return null;
  return (
    <p class="toast" role="status">
      {text}
    </p>
  );
}
