import { formatDuration } from '../core/numbers';
import type { ProjectView, BranchView } from '../state/researchView';
import { effectText } from '../state/researchView';
import type { View } from '../state/selectors';
import { adoptDoctrine, cancelProject, startProject } from '../state/store';
import { fmtFor } from './components';

function Project({ p, v }: { p: ProjectView; v: View }) {
  const n = fmtFor(v);
  const total = p.def.seconds;
  const progress = p.remaining !== null ? 1 - p.remaining / total : p.status === 'done' ? 1 : 0;
  return (
    <li class={`research research-${p.status}`} title={p.def.effects.map(effectText).join('; ')}>
      <div class="research-main">
        <h3>
          {p.def.name}
          {p.status === 'done' && <span class="chip chip-good">Done</span>}
          {p.status === 'active' && <span class="chip chip-cyan">Researching</span>}
          {p.status === 'locked' && <span class="chip">Needs earlier research</span>}
        </h3>
        <p class="blurb">{p.def.blurb}</p>
        {p.status === 'active' && (
          <div
            class="bar"
            role="progressbar"
            aria-label={`${p.def.name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <div class="research-side">
        {p.status === 'active' ? (
          <>
            <span class="muted">{formatDuration(p.remaining ?? 0)}</span>
            <button type="button" class="ghost" onClick={() => cancelProject(p.def.id)}>
              Cancel
            </button>
          </>
        ) : p.status === 'done' ? null : (
          <>
            <span class="muted">{formatDuration(total)}</span>
            <button
              type="button"
              class="buy buy-small"
              disabled={p.problem !== null}
              title={p.problem ?? undefined}
              onClick={() => startProject(p.def.id)}
            >
              {n(p.def.intel)} Intel{p.def.salvage ? ` + ${n(p.def.salvage)} Salvage` : ''}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Branch({ b, v }: { b: BranchView; v: View }) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>{b.def.name}</h2>
          <p class="muted">
            {b.def.blurb} {b.done} of {b.projects.length} done.
          </p>
        </div>
      </header>
      <ul class="research-list">
        {b.projects.map((p) => (
          <Project key={p.def.id} p={p} v={v} />
        ))}
      </ul>
    </section>
  );
}

function Doctrines({ v }: { v: View }) {
  const r = v.research;
  const n = fmtFor(v);
  return (
    <section class="panel">
      <header class="panel-head">
        <div class="head-title">
          <h2>Doctrine</h2>
          <p class="muted">
            Every doctrine trades one strength for another. The first pick in a slot is free; changing it costs {n(r.swapIntel)} Intel and
            the staff need an hour before the next change.
            {r.cooldown > 0 && <b class="accent"> Reorganising: {formatDuration(r.cooldown)} left.</b>}
          </p>
        </div>
      </header>
      <ul class="doctrines">
        {r.doctrines.map((d) => (
          <li key={d.def.id} class={`doctrine${d.slot !== null ? ' doctrine-on' : ''}`}>
            <div>
              <h3>
                {d.def.name}
                {d.slot !== null && <span class="chip chip-good">Adopted{r.slots.length > 1 ? ` in slot ${d.slot + 1}` : ''}</span>}
              </h3>
              <p class="blurb">{d.def.blurb}</p>
            </div>
            <div class="doctrine-side">
              {d.slot === null &&
                r.slots.map((s) => {
                  const problem = d.problems[s.slot];
                  const swap = s.current !== null;
                  return (
                    <button
                      key={s.slot}
                      type="button"
                      class="buy buy-small"
                      disabled={problem !== null}
                      title={problem ?? (swap ? `Replaces ${s.current?.name}` : undefined)}
                      onClick={() => adoptDoctrine(s.slot, d.def.id)}
                    >
                      {r.slots.length > 1 ? `Slot ${s.slot + 1}` : 'Adopt'}
                      {swap ? ` · ${n(r.swapIntel)} Intel` : ''}
                    </button>
                  );
                })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResearchScreen({ v }: { v: View }) {
  const r = v.research;
  const n = fmtFor(v);
  return (
    <>
      <section class="panel ops-head">
        <div class="ops-head-row">
          <h2 class="ops-title">Research</h2>
        </div>
        <dl class="facts ops-facts">
          <div>
            <dt>Research bays</dt>
            <dd>
              {r.bays.used} <span class="muted">of {r.bays.total} busy</span>
            </dd>
          </div>
          <div>
            <dt>Intel</dt>
            <dd class="accent">{n(v.ops.intel.amount)}</dd>
          </div>
          <div>
            <dt>Salvage</dt>
            <dd class="accent">{n(v.salvage.amount)}</dd>
          </div>
        </dl>
        <p class="muted ops-note">
          Intel comes from Signals Intelligence and marine missions; Salvage from won battles and Patrol. Research and doctrine reset when you
          Redeploy.
        </p>
        {r.bonuses.length > 0 && (
          <ul class="bonus-list" aria-label="Active bonuses">
            {r.bonuses.map((b) => (
              <li key={b} class="chip">
                {b}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Doctrines v={v} />
      {r.branches.map((b) => (
        <Branch key={b.def.id} b={b} v={v} />
      ))}
    </>
  );
}
