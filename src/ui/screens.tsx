import { useRef, useState } from 'preact/hooks';
import { NOTATIONS, formatCount, formatDuration, formatNumber } from '../core/numbers';
import type { Notation } from '../core/numbers';
import type { ArmoryView, View } from '../state/selectors';
import {
  doRedeploy,
  exportSave,
  hardReset,
  importSave,
  purchaseArmory,
  saveInfo,
  setHighContrast,
  setNotation,
  setReduceMotion,
  setSound,
  setTextScale,
  setVolume,
  view,
} from '../state/store';
import type { Screen } from '../state/store';
import { BuildingSectionPanel, fmtFor } from './components';
import { CampaignScreen } from './campaign';
import { FleetScreen } from './fleet';
import { OperationsScreen } from './operations';
import { ResearchScreen } from './research';

/* ---------- Command ---------- */

export function CommandScreen({ v }: { v: View }) {
  return (
    <>
      {v.sections.map((section, i) => (
        <BuildingSectionPanel key={section.resource} section={section} v={v} first={i === 0} />
      ))}
    </>
  );
}

/* ---------- Redeploy and Armory ---------- */

function ArmoryCard({ item, v }: { item: ArmoryView; v: View }) {
  const maxed = item.cost === null;
  return (
    <li class="armory-card">
      <h3>{item.def.name}</h3>
      <p class="muted">{item.def.description}</p>
      <p class="armory-effect">
        <span class="muted">Now </span>
        {item.current}
      </p>
      {item.next && (
        <p class="armory-effect">
          <span class="muted">Next </span>
          <span class="accent">{item.next}</span>
        </p>
      )}
      <div class="armory-foot">
        <span class="pips" aria-label={`Level ${item.level} of ${item.def.maxLevel}`}>
          {Array.from({ length: item.def.maxLevel }, (_, i) => (
            <i key={i} class={i < item.level ? 'on' : ''} />
          ))}
        </span>
        <button
          type="button"
          class="buy buy-small"
          disabled={maxed || !item.canBuy}
          onClick={() => purchaseArmory(item.def.id)}
        >
          {maxed ? 'Complete' : `${formatCount(item.cost as number, v.notation)} Medals`}
        </button>
      </div>
    </li>
  );
}

export function PrestigeScreen({ v }: { v: View }) {
  const n = fmtFor(v);
  const [confirming, setConfirming] = useState(false);
  const r = v.redeploy;

  const redeployNow = (): void => {
    doRedeploy();
    setConfirming(false);
  };

  return (
    <>
      <section class="panel redeploy">
        <header class="panel-head">
          <h2>Redeploy</h2>
          <span class="chip chip-amber">
            {formatCount(v.medals, v.notation)} Medals held ({formatCount(v.medalsEarned, v.notation)} earned)
          </span>
        </header>
        <div class="redeploy-body">
          <p class="rd-intro">
            Stand the sector down and redeploy with a service record. Buildings, stock and your ships are stood
            down. Service Medals, the Armory, sectors you have secured and your veteran cadre stay.
          </p>

          <div class="gauge rd-gauge">
            <div
              class="bar bar-wide"
              role="progressbar"
              aria-label="Requisition earned this run toward the Redeploy trigger"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(r.progress * 100)}
            >
              <i style={{ width: `${r.progress * 100}%` }} />
            </div>
            <p class="gauge-text">
              {n(v.earned)} of {n(r.trigger)} RP earned this run
              {!r.ready && <span class="muted"> ({n(r.remaining)} to go)</span>}
            </p>
          </div>

          <div class="rd-pay">
            {r.ready ? (
              <div class="payout">
                <p class="payout-gain">
                  +{formatCount(r.gain, v.notation)} <span>Service Medals</span>
                </p>
                <dl class="facts">
                  <div>
                    <dt>Production bonus</dt>
                    <dd>
                      x{v.multiplier.toFixed(2)} to <span class="accent">x{r.multiplierAfter.toFixed(2)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>This run so far</dt>
                    <dd>{formatDuration(v.runSeconds)}</dd>
                  </div>
                  {r.medalsPerHour !== null && (
                    <div>
                      <dt>Pace</dt>
                      <dd>{r.medalsPerHour.toFixed(1)} Medals per hour</dd>
                    </div>
                  )}
                </dl>
                <p class="muted">
                  Waiting pays more Medals, but slowly: four times the earnings pays twice the Medals.
                </p>
              </div>
            ) : (
              <div class="payout payout-idle">
                <p class="muted">Reach the trigger to see what a Redeploy would pay.</p>
              </div>
            )}
          </div>

          <div class="rd-action">
            {confirming ? (
              <div class="confirm" role="alert">
                <p>Reset this run and bank {formatCount(r.gain, v.notation)} Medals?</p>
                <div class="row">
                  <button type="button" class="primary" onClick={redeployNow}>
                    Confirm Redeploy
                  </button>
                  <button type="button" class="ghost" onClick={() => setConfirming(false)}>
                    Keep playing
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" class="primary" disabled={!r.ready} onClick={() => setConfirming(true)}>
                Redeploy
              </button>
            )}
          </div>

          <dl class="facts facts-quiet rd-stats">
            <div>
              <dt>Redeploys</dt>
              <dd>{formatCount(r.count, v.notation)}</dd>
            </div>
            <div>
              <dt>Last run</dt>
              <dd>{r.lastRunSeconds === null ? 'None yet' : formatDuration(r.lastRunSeconds)}</dd>
            </div>
            <div>
              <dt>Fastest run</dt>
              <dd>{r.bestRunSeconds === null ? 'None yet' : formatDuration(r.bestRunSeconds)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Armory</h2>
          <span class="muted">Spend Service Medals on permanent upgrades</span>
        </header>
        <ul class="armory">
          {v.armory.map((item) => (
            <ArmoryCard key={item.def.id} item={item} v={v} />
          ))}
        </ul>
      </section>
    </>
  );
}

/* ---------- Settings ---------- */

const NOTATION_LABEL: Record<Notation, string> = {
  standard: 'Standard (1.50K, 2.50M)',
  scientific: 'Scientific (1.50e3)',
  engineering: 'Engineering (150.00e3)',
};

export function SettingsScreen({ v }: { v: View }) {
  const [exported, setExported] = useState('');
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const exportBox = useRef<HTMLTextAreaElement>(null);
  const info = saveInfo.value;

  const doExport = (): void => {
    setExported(exportSave());
    setMessage(null);
  };

  const copy = async (): Promise<void> => {
    const box = exportBox.current;
    try {
      await navigator.clipboard.writeText(exported);
      setMessage({ text: 'Copied to the clipboard.', ok: true });
    } catch {
      box?.focus();
      box?.select();
      setMessage({ text: 'Copying was blocked here. The text is selected, so press Ctrl+C or long-press to copy.', ok: true });
    }
  };

  const doImport = (): void => {
    if (importSave(importText)) {
      setMessage({ text: 'Save imported.', ok: true });
      setImportText('');
      setExported('');
    } else {
      setMessage({ text: 'That text is not a Fleet Command save. Paste the full export, starting with HFC1.', ok: false });
    }
  };

  return (
    <>
      <section class="panel">
        <header class="panel-head">
          <h2>Display</h2>
        </header>
        <div class="form">
          <label for="notation">Number format</label>
          <select id="notation" value={v.notation} onChange={(e) => setNotation(e.currentTarget.value as Notation)}>
            {NOTATIONS.map((o) => (
              <option key={o} value={o}>
                {NOTATION_LABEL[o]}
              </option>
            ))}
          </select>
          <p class="muted">Example: {formatNumber(1234567, v.notation)}</p>
          <label for="text-scale">Interface size</label>
          <select id="text-scale" value={String(v.display.textScale)} onChange={(e) => setTextScale(Number(e.currentTarget.value))}>
            <option value="1">Standard</option>
            <option value="1.15">Large</option>
            <option value="1.3">Extra large</option>
          </select>
          <label class="check">
            <input type="checkbox" checked={v.display.highContrast} onChange={(e) => setHighContrast(e.currentTarget.checked)} />
            High contrast
          </label>
          <label class="check">
            <input type="checkbox" checked={v.display.reduceMotion} onChange={(e) => setReduceMotion(e.currentTarget.checked)} />
            Reduce motion (stops animation in battles and bars)
          </label>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Sound</h2>
          <span class="muted">Short synthesised cues. Off until you turn them on.</span>
        </header>
        <div class="form">
          <label class="check">
            <input type="checkbox" checked={v.display.sound} onChange={(e) => setSound(e.currentTarget.checked)} />
            Play sound cues for victories, defeats, discoveries and Transfers
          </label>
          <label for="volume">Volume</label>
          <input
            id="volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={v.display.volume}
            disabled={!v.display.sound}
            onChange={(e) => setVolume(Number(e.currentTarget.value))}
          />
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Save</h2>
          <span class="muted">
            {info.at ? `Saved ${new Date(info.at).toLocaleTimeString()}` : 'Not saved yet'}
            {info.persistent ? '' : ' (memory only)'}
          </span>
        </header>
        <div class="form">
          <p class="muted">
            The game saves to this browser every 30 seconds. Export a save to back it up or move it to another device.
          </p>
          <div class="row">
            <button type="button" class="ghost" onClick={doExport}>
              Export save
            </button>
            {exported && (
              <button type="button" class="ghost" onClick={copy}>
                Copy
              </button>
            )}
          </div>
          {exported && (
            <>
              <label for="export-text">Your save</label>
              <textarea id="export-text" ref={exportBox} readOnly rows={4} value={exported} onFocus={(e) => e.currentTarget.select()} />
            </>
          )}
          <label for="import-text">Import a save</label>
          <textarea
            id="import-text"
            rows={3}
            placeholder="Paste an exported save here"
            value={importText}
            onInput={(e) => setImportText(e.currentTarget.value)}
          />
          <div class="row">
            <button type="button" class="ghost" disabled={importText.trim() === ''} onClick={doImport}>
              Import save
            </button>
          </div>
          {message && (
            <p class={message.ok ? 'note-ok' : 'note-bad'} role="status">
              {message.text}
            </p>
          )}
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Start over</h2>
        </header>
        <div class="form">
          <p class="muted">Erases all progress, Medals and Armory upgrades. This cannot be undone.</p>
          {confirmReset ? (
            <div class="row">
              <button
                type="button"
                class="danger"
                onClick={() => {
                  hardReset();
                  setConfirmReset(false);
                  setExported('');
                  setMessage(null);
                }}
              >
                Erase everything
              </button>
              <button type="button" class="ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div class="row">
              <button type="button" class="ghost" onClick={() => setConfirmReset(true)}>
                Reset game
              </button>
            </div>
          )}
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>About</h2>
        </header>
        <div class="form">
          <p>Halo Fleet Command, build 1.0: economy, fleet combat, marine missions, five theatres, Transfer, the War Room, Relics and officers.</p>
          <p class="muted">
            Unofficial fan project, made for fun and not for sale. Halo and related names belong to their owners. All art,
            icons and writing here are original.
          </p>
          <p class="muted">Lifetime requisition: {formatNumber(v.lifetimeEarned, v.notation)} RP</p>
        </div>
      </section>
    </>
  );
}

export function CurrentScreen({ which }: { which: Screen }) {
  const v = view.value;
  if (which === 'fleet' && v.fleet.unlocked) return <FleetScreen v={v} />;
  if (which === 'operations' && v.ops.unlocked) return <OperationsScreen v={v} />;
  if (which === 'research' && v.research.unlocked) return <ResearchScreen v={v} />;
  if (which === 'campaign' && v.campaign.unlocked) return <CampaignScreen v={v} />;
  if (which === 'prestige') return <PrestigeScreen v={v} />;
  if (which === 'settings') return <SettingsScreen v={v} />;
  return <CommandScreen v={v} />;
}
