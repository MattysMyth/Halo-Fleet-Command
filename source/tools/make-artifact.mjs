/**
 * Turn the single-file Vite build (dist/index.html) into the page fragment the artifact host expects:
 * no doctype, html, head or body tags, just the title, stylesheet link, style, mount point and script.
 * Output: dist/artifact.html
 *
 *   npm run artifact
 */
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`make-artifact: could not find ${what} in dist/index.html`);
  return m[0];
};

const title = pick(/<title>[^<]*<\/title>/, 'the title');
const fonts = pick(/<link\s+rel="stylesheet"[^>]*fonts\.googleapis\.com[^>]*>/, 'the Google Fonts link');
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0].replace(/^<style[^>]*>/, '<style>'));
if (styles.length === 0) throw new Error('make-artifact: no inline style found');

const scriptStart = html.indexOf('<script type="module"');
if (scriptStart === -1) throw new Error('make-artifact: no inline module script found');
const scriptEnd = html.indexOf('</script>', scriptStart) + '</script>'.length;
const script = html.slice(scriptStart, scriptEnd).replace(/^<script type="module"[^>]*>/, '<script type="module">');

const fragment = [title, fonts, ...styles, '<div id="app"></div>', script].join('\n') + '\n';
fs.writeFileSync(new URL('../dist/artifact.html', import.meta.url), fragment);
console.log(`dist/artifact.html written (${(fragment.length / 1024).toFixed(1)} kB)`);
