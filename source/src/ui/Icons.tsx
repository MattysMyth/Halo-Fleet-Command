import type { ComponentChildren } from 'preact';

/** Original line icons, drawn for this project. 24 x 24 grid, 1.5 stroke. */
const GLYPHS: Record<string, ComponentChildren> = {
  depot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="1" />
      <path d="M4 12h16M9 8v4M15 8v4M7 5h10l1 3H6z" />
    </>
  ),
  hub: (
    <>
      <path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 3v6.6M4.5 7.3l5.4 3.1M19.5 7.3l-5.4 3.1" />
    </>
  ),
  charter: (
    <>
      <path d="M5 17a7 7 0 0 1 14 0" />
      <path d="M3 17h18M12 10V5.5M10.5 5.5h3M8 20h8" />
    </>
  ),
  platform: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.6" transform="rotate(-22 12 12)" />
    </>
  ),
  yard: (
    <>
      <path d="M3 20h18M5 20V6M19 20V6M5 6h14M9 6v7M15 6v4" />
      <path d="M13 10h4v2h-4zM8 13h2" />
    </>
  ),
  command: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </>
  ),
  prestige: (
    <>
      <path d="M6 11l6-6 6 6M6 17l6-6 6 6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  fleet: (
    <>
      <path d="M3 6l7 3-7 3z" />
      <path d="M3 14l7 3-7 3z" />
      <path d="M12 10l9 4-9 4z" />
    </>
  ),
  frigate: (
    <>
      <path d="M2 12l5-3.5h10L22 12l-5 3.5H7z" />
      <path d="M7 8.5v7M11 12h6" />
    </>
  ),
  cruiser: (
    <>
      <path d="M2 12l4-4.5h11l5 4.5-5 4.5H6z" />
      <path d="M6 7.5v9M10 10h5M10 14h5M17 7.5v9" />
    </>
  ),
  heavy: (
    <>
      <path d="M1.5 12l4-5h13.5l3.5 5-3.5 5H5.5z" />
      <path d="M5.5 7v10M9 9.5h8M9 12h8M9 14.5h8M19 7v10" />
    </>
  ),
  carrier: (
    <>
      <path d="M1.5 13l3-5h15l3 5-3 4H4.5z" />
      <path d="M5 11.5h13M8 14.5h8M12 8v-3" />
    </>
  ),
  flagship: (
    <>
      <path d="M1 12l4-6h14l4 6-4 6H5z" />
      <path d="M5 6v12M9 9h9M9 12h9M9 15h9M19 6v12M12 3.5v2.5" />
    </>
  ),
  outpost: (
    <>
      <path d="M4 19h16M6 19a6 6 0 0 1 12 0" />
      <path d="M12 13V5.5M10 5.5h4" />
    </>
  ),
  mine: (
    <>
      <path d="M5 15l2-5 4-2 5 1 3 4-2 4-5 2-5-1z" />
      <path d="M10 11l2 3M15 10l-1 4" />
    </>
  ),
  smelter: (
    <>
      <path d="M5 9h14l-2 10H7z" />
      <path d="M9 6c0-1.6 2.5-1.6 2.5-3.5M14 6c0-1.6 2.5-1.6 2.5-3.5" />
    </>
  ),
  harvester: (
    <>
      <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
      <path d="M9.5 3.8L12 5.5l2.5-1.7M9.5 20.2L12 18.5l2.5 1.7" />
    </>
  ),
  refinery: (
    <>
      <path d="M5 20V9l4-3 4 3v11zM9 20v-5" />
      <path d="M16 20v-8h4v8zM3 20h18" />
    </>
  ),
  skimmer: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M3 15c5 2.5 13 0.5 18-5M7 4.5l3 1.8" />
    </>
  ),
  ti: (
    <>
      <path d="M12 3l7 4v10l-7 4-7-4V7z" />
      <path d="M5 7l7 4 7-4M12 11v10" />
    </>
  ),
  deut: (
    <>
      <path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" />
      <path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.5" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    </>
  ),
  bolt: (
    <>
      <path d="M13 3L5 14h6l-1 7 8-11h-6z" />
    </>
  ),
  exit: (
    <>
      <path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" />
    </>
  ),
  recruit: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5M12 3.5V2" />
    </>
  ),
  academy: (
    <>
      <path d="M3 9l9-5 9 5-9 5z" />
      <path d="M7 11.5V16c0 1.5 2.5 3 5 3s5-1.5 5-3v-4.5M21 9v6" />
    </>
  ),
  barracks: (
    <>
      <path d="M3 20V9l5-3 5 3v11M13 20V12l4-2.5 4 2.5v8M2 20h20" />
      <path d="M7 20v-5h2v5" />
    </>
  ),
  listening: (
    <>
      <path d="M4 18a8 8 0 0 1 16 0" />
      <path d="M12 18v-5M8 18a4 4 0 0 1 8 0M12 6.5v2" />
    </>
  ),
  analysis: (
    <>
      <rect x="4" y="5" width="16" height="12" rx="1" />
      <path d="M7 14l3-3 2.5 2 4-5M9 20h6M12 17v3" />
    </>
  ),
  bureau: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 8h8M8 12h8M8 16h5" />
      <circle cx="17" cy="17" r="2.2" />
    </>
  ),
  pers: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6M15.5 14.2c3 .2 5.5 2 5.5 5.3" />
    </>
  ),
  intel: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5M11 8v3.5l2.2 1.5" />
    </>
  ),
  map: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  research: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  salvage: (
    <>
      <path d="M4 17l4-9 4 5 3-4 5 8z" />
      <path d="M3 20h18" />
    </>
  ),
  ops: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M12 8v6M9 11h6" />
    </>
  ),
  vehicle: (
    <>
      <path d="M3 15l2-5h11l3 3h2v2H3z" />
      <circle cx="8" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  medic: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  strike: (
    <>
      <path d="M12 3v7M9 7l3 3 3-3" />
      <path d="M5 21h14M8 17l4-3 4 3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name] ?? null}
    </svg>
  );
}
