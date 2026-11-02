import { useState } from 'preact/hooks';
import { formatCount } from '../core/numbers';
import type { CampaignView, PinState, RelicView, TheatreCard, TransferView, WarRoomItemView } from '../state/campaignView';
import type { View } from '../state/selectors';
import { doTransfer, fightIn, purchaseRelic, purchaseWarroom, setScreen } from '../state/store';

const PIN_TEXT: Record<PinState, string> = {
  secured: 'Secured this cycle',
  earlier: 'Cleared in an earlier cycle: Patrol and marines can still use it',
  open: 'Next on the campaign',
  locked: 'Locked',
};

/** One theatre as a chain of sectors, nearest the front first. */
function SectorChain({ t }: { t: TheatreCard }) {
  return (
    <ol class="chain" aria-label={`${t.theatre.name} sectors`}>
      {t.pins.map(({ node, state }, i) => (
        <li key={node.id} class={`pin pin-${state}${node.boss ? ' pin-boss' : ''}`} title={`${node.name}: ${PIN_TEXT[state]}`}>
          <span class="pin-dot" aria-hidden="true" />
          <span class="pin-num">{node.boss ? 'Boss' : i + 1}</span>
          <span class="sr-only">
            {node.name}, {PIN_TEXT[state]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TheatreCardView({ t }: { t: TheatreCard }) {
  const total = t.pins.length;
  return (
    <section class={`panel theatre theatre-${t.state}`} data-theatre={t.theatre.id}>
      <header class="panel-head">
        <div class="head-title">
          <h2>
            Theatre {t.theatre.id}: {t.theatre.name}
          </h2>
          <p class="muted">{t.theatre.blurb}</p>
        </div>
        <span class={`chip ${t.state === 'active' ? 'chip-amber' : t.state === 'open' ? 'chip-cyan' : ''}`}>
          {t.state === 'active' ? 'Fighting here' : t.state === 'open' ? 'Open' : 'Not yet open'}
        </span>
      </header>
      <div class="theatre-body">
        <SectorChain t={t} />
        <dl class="facts facts-quiet">
          <div>
            <dt>Secured this cycle</dt>
            <dd>
              {t.cleared} of {total}
            </dd>
          </div>
          <div>
            <dt>Boss</dt>
            <dd>
              {t.boss.name} {t.everBeaten && <span class="chip chip-good">Beaten once</span>}
            </dd>
          </div>
          <div>
            <dt>Transfer pays</dt>
            <dd>{t.honors} Battle Honors</dd>
          </div>
        </dl>
        <div class="row">
          {t.state === 'open' && (
            <button type="button" class="ghost" onClick={() => fightIn(t.theatre.id)}>
              Fight in this theatre
            </button>
          )}
          {t.state !== 'locked' && (
            <button type="button" class="ghost" onClick={() => setScreen('fleet')}>
              Fleet orders
            </button>
          )}
          {t.state === 'locked' && <p class="muted">Defeat the boss of the theatre before it and Transfer to open this front.</p>}
        </div>
      </div>
    </section>
  );
}

function TransferPanel({ x, v }: { x: TransferView; v: View }) {
  const [confirming, setConfirming] = useState(false);
  const run = (): void => {
    doTransfer();
    setConfirming(false);
  };
  const n = (value: number) => formatCount(value, v.notation);
  return (
    <section class="panel transfer" aria-label="Transfer">
      <header class="panel-head">
        <div class="head-title">
          <h2>Transfer</h2>
          <p class="muted">
            Beat a theatre's boss and the war moves on. The fleet is reassigned to the next front with a fresh run, and the Battle Honors it earned stay
            with you for good.
          </p>
        </div>
        <span class={`chip ${x.ready ? 'chip-good' : ''}`}>{x.ready ? 'Ready' : 'Not ready'}</span>
      </header>
      <div class="transfer-body">
        <ul class="steps" aria-label="Requirements">
          {x.steps.map((s) => (
            <li key={s.label} class={s.done ? 'step-done' : ''}>
              <span class="step-mark" aria-hidden="true">
                {s.done ? '✓' : '·'}
              </span>
              {s.label}
            </li>
          ))}
        </ul>
        <dl class="facts">
          <div>
            <dt>Pays</dt>
            <dd>
              <span class="accent">{x.gain > 0 ? x.gain : x.theatre.honors} Battle Honors</span>
            </dd>
          </div>
          <div>
            <dt>Ship damage and marine Power</dt>
            <dd>
              +{Math.round(v.campaign.honorBonus * 100)}% to <span class="accent">+{Math.round(x.honorBonusAfter * 100)}%</span>
            </dd>
          </div>
          <div>
            <dt>Next front</dt>
            <dd>{x.opens ? x.opens.name : 'None: you stay here and keep earning Honors'}</dd>
          </div>
        </dl>
        <p class="muted">
          <strong>Lost:</strong> this run (buildings, stock, ships, squads, research), your {n(x.cost.medals)} unspent Service Medals, the Medal production bonus
          ({n(x.cost.medalsEarned)} earned) and {x.cost.armory} Armory {x.cost.armory === 1 ? 'level' : 'levels'}, the sectors and ground you held.
          <br />
          <strong>Kept:</strong> Battle Honors and the War Room, which ship classes and strike groups you have earned, the sectors you cleared (Patrol and
          marines can still use them), and your veteran cadre.
        </p>
        {confirming ? (
          <div class="confirm" role="alert">
            <p>
              Transfer out of {x.theatre.name}? This resets your Medals and Armory as well as the run.
            </p>
            <div class="row">
              <button type="button" class="primary" onClick={run}>
                Confirm Transfer
              </button>
              <button type="button" class="ghost" onClick={() => setConfirming(false)}>
                Keep fighting
              </button>
            </div>
          </div>
        ) : (
          <div class="row">
            <button type="button" class="primary" disabled={!x.ready} onClick={() => setConfirming(true)}>
              Transfer
            </button>
            {x.problem && <p class="muted">{x.problem}.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function RelicCard({ item, v }: { item: RelicView; v: View }) {
  const maxed = item.cost === null;
  return (
    <li class="armory-card" data-relic={item.def.id}>
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
        <span class="pips" aria-label={`Level ${item.level} of ${item.max}`}>
          {Array.from({ length: item.max }, (_, i) => (
            <i key={i} class={i < item.level ? 'on' : ''} />
          ))}
        </span>
        <button type="button" class="buy buy-small" disabled={maxed || !item.canBuy} onClick={() => purchaseRelic(item.def.id)}>
          {maxed ? 'Complete' : `${formatCount(item.cost as number, v.notation)} Salvage`}
        </button>
      </div>
      {!maxed && item.overCap && <p class="muted field-note">More than your stockpile can hold: raise storage first.</p>}
    </li>
  );
}

function WarRoomCard({ item, v }: { item: WarRoomItemView; v: View }) {
  const maxed = item.cost === null;
  return (
    <li class="armory-card" data-warroom={item.def.id}>
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
        <button type="button" class="buy buy-small" disabled={maxed || !item.canBuy} onClick={() => purchaseWarroom(item.def.id)}>
          {maxed ? 'Complete' : `${formatCount(item.cost as number, v.notation)} Honors`}
        </button>
      </div>
    </li>
  );
}

export function CampaignScreen({ v }: { v: View }) {
  const c: CampaignView = v.campaign;
  return (
    <>
      <section class="panel">
        <header class="panel-head">
          <div class="head-title">
            <h2>Campaign</h2>
            <p class="muted">The war across every theatre. Clear a front's boss, field the capital ship it needs and Transfer to take the war further in.</p>
          </div>
          <span class="chip chip-amber" title="Every Battle Honor ever earned adds to ship damage and marine Power">
            {c.honors} Honors held · +{Math.round(c.honorBonus * 100)}% damage and Power
          </span>
        </header>
      </section>
      {c.theatres.map((t) => (
        <TheatreCardView key={t.theatre.id} t={t} />
      ))}
      <TransferPanel x={c.transfer} v={v} />
      <section class="panel">
        <header class="panel-head">
          <h2>War Room</h2>
          <span class="muted">Spend Battle Honors on upgrades that survive every Transfer</span>
        </header>
        <ul class="armory">
          {c.warroom.map((item) => (
            <WarRoomCard key={item.def.id} item={item} v={v} />
          ))}
        </ul>
      </section>
      <section class="panel">
        <header class="panel-head">
          <h2>Reliquary</h2>
          <span class="muted">Relics last for good, but Salvage does not: it is lost on Redeploy and Transfer, so spend it first. You hold {formatCount(c.salvage, v.notation)} Salvage.</span>
        </header>
        <ul class="armory">
          {c.relics.map((item) => (
            <RelicCard key={item.def.id} item={item} v={v} />
          ))}
        </ul>
      </section>
    </>
  );
}
