/**
 * Browser harness. Loads dist/index.html in headless Chromium with sample saves, walks the main
 * screens at desktop, tablet and phone sizes, screenshots them and reports console errors and
 * horizontal overflow.
 *
 * Usage: node tools/e2e/run.mjs <seeds.json> <outDir> <fontsDir>
 * Needs playwright (global install) and the fontsource packages in <fontsDir>/node_modules.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const [seedsPath, outDir, fontsDir] = process.argv.slice(2);
const seeds = JSON.parse(readFileSync(seedsPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const page_url = pathToFileURL(path.resolve('dist/index.html')).href;
const fontFile = (pkg, name) => pathToFileURL(path.join(fontsDir, 'node_modules/@fontsource', pkg, 'files', name)).href;
const fontCss = `
@font-face{font-family:'Barlow';font-weight:400;src:url(${fontFile('barlow', 'barlow-latin-400-normal.woff2')})}
@font-face{font-family:'Barlow';font-weight:500;src:url(${fontFile('barlow', 'barlow-latin-500-normal.woff2')})}
@font-face{font-family:'Barlow';font-weight:600;src:url(${fontFile('barlow', 'barlow-latin-600-normal.woff2')})}
@font-face{font-family:'Big Shoulders Stencil Display';font-weight:800;src:url(${fontFile('big-shoulders-stencil-display', 'big-shoulders-stencil-display-latin-800-normal.woff2')})}
`;

const SIZES = { desktop: { width: 1440, height: 900 }, tablet: { width: 900, height: 1100 }, phone: { width: 390, height: 844 } };
const problems = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

const startedAt = Date.now();

/** A seed's clock is stale by the time a later page opens it: keep "just saved" seeds just saved, and "away" seeds as long away as intended. */
function fresh(seedName) {
  const raw = structuredClone(seeds[seedName]);
  if (raw && typeof raw.lastSeen === 'number') raw.lastSeen += Date.now() - startedAt;
  return raw;
}

async function open(seedName, size) {
  const ctx = await browser.newContext({ viewport: SIZES[size] });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) problems.push(`[${seedName}/${size}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${seedName}/${size}] pageerror: ${e.message}`));
  await page.addInitScript(
    ([key, raw]) => {
      if (raw && !localStorage.getItem('__seeded')) {
        localStorage.setItem(key, JSON.stringify(raw));
        localStorage.setItem('__seeded', '1');
      }
    },
    ['halo-fleet-command/save', fresh(seedName)],
  );
  await page.goto(page_url);
  await page.addStyleTag({ content: fontCss });
  await page.waitForTimeout(600);
  return { ctx, page };
}

async function overflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) problems.push(`${label}: horizontal overflow (${o.sw} > ${o.cw})`);
}

async function shot(page, name, label) {
  await overflow(page, label);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}

/** Click after centring the element, so the sticky readout cannot sit on top of it. */
const clickCentered = async (loc, label = 'click') => {
  await loc.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  try {
    await loc.click({ timeout: 4000 });
  } catch (e) {
    const why = /intercepts pointer events/.test(e.message) ? e.message.split('\n').filter((l) => /intercepts/.test(l)).pop().replace(/\x1b\[\d+m/g, '').trim() : e.message.split('\n')[0];
    problems.push(`${label}: ${why}`);
    await loc.click({ force: true }).catch(() => {});
  }
};

const toTop = (page) => page.evaluate(() => window.scrollTo(0, 0));
const navTo = async (page, name) => {
  await toTop(page);
  await page.getByRole('button', { name: new RegExp('^' + name) }).first().click();
};

for (const size of Object.keys(SIZES)) {
  // fresh game: only the Command screen, no fleet nav
  {
    const { ctx, page } = await open('fresh', size);
    const fleetNav = await page.getByRole('button', { name: 'Fleet', exact: true }).count();
    if (fleetNav !== 0) problems.push(`fresh/${size}: Fleet nav visible before unlock`);
    await shot(page, `${size}-fresh-command`, `fresh/${size}/command`);
    await ctx.close();
  }
  // accessibility settings: biggest text and high contrast must still fit the screen
  {
    const { ctx, page } = await open('fleet', size);
    await navTo(page, 'Settings');
    await page.waitForTimeout(200);
    await page.selectOption('#text-scale', '1.3');
    await page.getByLabel('High contrast').check();
    await page.getByLabel(/Reduce motion/).check();
    await page.waitForTimeout(200);
    const attrs = await page.evaluate(() => [document.documentElement.dataset.scale, document.documentElement.dataset.contrast, document.documentElement.dataset.motion].join('/'));
    if (attrs !== '1.3/high/reduce') problems.push(`settings/${size}: display attributes were ${attrs}`);
    await shot(page, `${size}-settings-a11y`, `settings/${size}/large text`);
    for (const name of ['Command', 'Fleet', 'Operations', 'Campaign']) {
      await navTo(page, name);
      await page.waitForTimeout(250);
      await overflow(page, `${name}/${size}/large text`);
    }
    await ctx.close();
  }
  // seeded fleet game
  {
    const { ctx, page } = await open('fleet', size);
    await shot(page, `${size}-fleet-command`, `fleet/${size}/command`);
    await navTo(page, 'Fleet');
    await page.waitForTimeout(300);
    await shot(page, `${size}-fleet-battle-idle`, `fleet/${size}/battle-idle`);
    if ((await page.locator('[data-officer-select]').count()) !== 1) problems.push(`fleet/${size}: officer select missing`);
    // let a sortie start and run for a bit
    await page.waitForSelector('.battle-svg', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, `${size}-fleet-battle-live`, `fleet/${size}/battle-live`);
    // the battle panel alone, so the fixed phone tab bar does not cover it in the full-page shot
    await page.locator('section.battle').first().screenshot({ path: path.join(outDir, `${size}-battle-panel.png`) });
    await toTop(page);
    await page.getByRole('tab', { name: /Drydock/ }).click();
    await page.waitForTimeout(200);
    await shot(page, `${size}-fleet-drydock`, `fleet/${size}/drydock`);
    await clickCentered(page.getByRole('button', { name: 'Refit' }).first(), `fleet/${size}/refit click`);
    await shot(page, `${size}-fleet-refit`, `fleet/${size}/refit`);
    await toTop(page);
    await page.getByRole('tab', { name: 'Sectors' }).click();
    await page.waitForTimeout(200);
    await clickCentered(page.getByRole('button', { name: 'Scout' }).first(), `fleet/${size}/scout click`);
    await shot(page, `${size}-fleet-sectors`, `fleet/${size}/sectors`);
    await navTo(page, 'Redeploy');
    await shot(page, `${size}-prestige`, `fleet/${size}/prestige`);
    await ctx.close();
  }
  // returning after two hours with a patrol group
  {
    const { ctx, page } = await open('away', size);
    const dialog = await page.getByRole('dialog').count();
    if (dialog !== 1) problems.push(`away/${size}: offline dialog missing`);
    await shot(page, `${size}-away-modal`, `away/${size}/modal`);
    await ctx.close();
  }
}

// Operations: marines, missions, positions, research
for (const size of Object.keys(SIZES)) {
  {
    const { ctx, page } = await open('opsfresh', size);
    await navTo(page, 'Operations');
    await page.waitForTimeout(300);
    await shot(page, `${size}-ops-fresh`, `opsfresh/${size}/operations`);
    await ctx.close();
  }
  {
    // Campaign: the theatre map, buying from the War Room, and a Transfer
    const { ctx, page } = await open('transfer', size);
    await navTo(page, 'Campaign');
    await page.waitForTimeout(400);
    await shot(page, `${size}-campaign`, `transfer/${size}/campaign`);
    const theatres = await page.locator('[data-theatre]').count();
    if (theatres !== 5) problems.push(`campaign/${size}: expected 5 theatres, saw ${theatres}`);
    const relics = await page.locator('[data-relic]').count();
    if (relics !== 6) problems.push(`campaign/${size}: expected 6 relics, saw ${relics}`);
    const buyWar = page.locator('[data-warroom="flag-command"] button');
    await clickCentered(buyWar, `campaign/${size}/war room click`);
    await page.waitForTimeout(200);
    const flagPips = await page.locator('[data-warroom="flag-command"] .pips i.on').count();
    if (flagPips !== 1) problems.push(`campaign/${size}: buying Flag command did not light a pip (${flagPips})`);
    await clickCentered(page.getByRole('button', { name: /^Transfer$/ }).first(), `campaign/${size}/transfer click`);
    await page.waitForTimeout(200);
    await shot(page, `${size}-campaign-confirm`, `transfer/${size}/confirm`);
    await clickCentered(page.getByRole('button', { name: /^Confirm Transfer/ }).first(), `campaign/${size}/confirm click`);
    await page.waitForTimeout(400);
    const active = await page.locator('[data-theatre="2"].theatre-active').count();
    if (active !== 1) problems.push(`campaign/${size}: Theatre 2 is not the active theatre after Transfer`);
    await shot(page, `${size}-campaign-after`, `transfer/${size}/after`);
    await navTo(page, 'Fleet');
    await page.getByRole('tab', { name: 'Sectors' }).click();
    await page.waitForTimeout(300);
    await shot(page, `${size}-sectors-after`, `transfer/${size}/sectors-after`);
    if ((await page.getByRole('button', { name: /Patrol here/ }).count()) === 0) problems.push(`transfer/${size}: no Patrol offered on sectors cleared in the earlier cycle`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('opsinc', size);
    await navTo(page, 'Operations');
    await page.waitForTimeout(400);
    await shot(page, `${size}-ops-incidents`, `opsinc/${size}/incidents`);
    const rows = await page.locator('[data-incident]').count();
    if (rows !== 2) problems.push(`opsinc/${size}: expected 2 incidents, saw ${rows}`);
    if ((await page.locator('.chip-bad', { hasText: /Contested/ }).count()) !== 1) problems.push(`opsinc/${size}: no contested chip on the overrun position`);
    const defend = page.locator('[data-incident="defend"] button').first();
    await clickCentered(defend, `opsinc/${size}/defend click`);
    await page.waitForTimeout(500);
    const left = await page.locator('[data-incident]').count();
    if (left !== 1) problems.push(`opsinc/${size}: answering the counter-attack left ${left} incidents`);
    await shot(page, `${size}-ops-incident-answered`, `opsinc/${size}/answered`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('ops', size);
    await shot(page, `${size}-ops-command`, `ops/${size}/command`);
    await navTo(page, 'Operations');
    await page.waitForTimeout(400);
    await shot(page, `${size}-ops-main`, `ops/${size}/operations`);
    // live missions are not saved, so launch the attended assault and expect its brief with tactic cards
    await clickCentered(page.getByRole('button', { name: /^Launch assault/ }).first(), `ops/${size}/launch click`);
    await page.waitForTimeout(500);
    await shot(page, `${size}-ops-briefing`, `ops/${size}/briefing`);
    const cards = await page.locator('.tactics .tactic').count();
    if (cards === 0) problems.push(`ops/${size}: no tactic cards while briefing`);
    const first = page.locator('.tactics .tactic:not([disabled])').first();
    if (await first.count()) await first.click().catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, `${size}-ops-chosen`, `ops/${size}/tactic-chosen`);
    // the second squad
    const tabs = page.locator('.group-picker button[aria-label], .group-picker button[aria-pressed]');
    if ((await tabs.count()) > 1) {
      await tabs.nth(1).click().catch(() => {});
      await page.waitForTimeout(300);
      await shot(page, `${size}-ops-squad2`, `ops/${size}/squad2`);
    }
    await navTo(page, 'Fleet');
    await page.waitForTimeout(300);
    await shot(page, `${size}-ops-fleet`, `ops/${size}/fleet`);
    // the Research screen: start a project and adopt a doctrine
    await navTo(page, 'Research');
    await page.waitForTimeout(300);
    await shot(page, `${size}-research`, `ops/${size}/research`);
    // the seed has a project under way and one bay: cancel it, then start another
    await clickCentered(page.getByRole('button', { name: /^Cancel/ }).first(), `research/${size}/cancel click`);
    await page.waitForTimeout(200);
    const before = await page.locator('.research-active').count();
    await clickCentered(page.locator('.research-available button.buy:not([disabled])').first(), `research/${size}/start click`);
    await page.waitForTimeout(300);
    const after = await page.locator('.research-active').count();
    if (after !== before + 1) problems.push(`research/${size}: starting a project did not show it as active (${before} -> ${after})`);
    await clickCentered(page.getByRole('button', { name: /^Adopt/ }).first(), `research/${size}/adopt click`);
    await page.waitForTimeout(300);
    if ((await page.locator('.doctrine-on').count()) !== 1) problems.push(`research/${size}: no adopted doctrine shown`);
    await shot(page, `${size}-research-after`, `ops/${size}/research-after`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('opsaway', size);
    const dialog = await page.getByRole('dialog').count();
    if (dialog !== 1) problems.push(`opsaway/${size}: offline dialog missing`);
    await shot(page, `${size}-ops-away`, `opsaway/${size}/modal`);
    await ctx.close();
  }
}

// a big fleet at desktop for the layout of many ships, with an ability click
{
  const { ctx, page } = await open('big', 'desktop');
  await navTo(page, 'Fleet');
  await page.waitForTimeout(7000);
  const focus = page.getByRole('button', { name: /Focus Fire|Pick a target/ }).first();
  if (await focus.count()) {
    await focus.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await shot(page, 'desktop-big-battle', 'big/desktop/battle');
  await ctx.close();
}

await browser.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'no problems found');
