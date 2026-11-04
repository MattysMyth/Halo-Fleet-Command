import { screen, view } from '../state/store';
import { EventLog, Nav, Notice, OfflineModal, Readout, StorageBanner } from './components';
import { CurrentScreen } from './screens';

export function App() {
  const v = view.value;
  return (
    <div class="shell">
      <aside class="side">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true" />
          <div>
            <p class="brand-name">Fleet Command</p>
            <p class="brand-sub">UNSC logistics terminal</p>
          </div>
        </div>
        <Nav v={v} />
      </aside>

      <div class="center">
        <Readout v={v} />
        <main class="stage">
          <StorageBanner />
          <CurrentScreen which={screen.value} />
        </main>
      </div>

      <aside class="logcol">
        <EventLog />
      </aside>

      <OfflineModal v={v} />
      <Notice />
    </div>
  );
}
