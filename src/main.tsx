import { render } from 'preact';
import { App } from './ui/App';
import { saveNow, start } from './state/store';
import './ui/theme.css';

interface HotApi {
  ready?: (fn: (data?: unknown) => void) => void;
  snapshot?: (fn: () => unknown) => void;
  data?: unknown;
}

function boot(): void {
  start();
  render(<App />, document.getElementById('app') as HTMLElement);
}

// When the page is republished while open, the host asks it to hand over its state first. Progress
// already lives in the save, so flushing the save is all that is needed.
const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
try {
  hot?.snapshot?.(() => {
    saveNow();
    return {};
  });
} catch {
  /* the update hook is optional */
}

if (hot?.ready) hot.ready(() => boot());
else boot();
