import DecimalClass from 'break_infinity.js';

export const Decimal = DecimalClass;
export type Decimal = DecimalClass;
export type DecimalSource = Decimal | number | string;

/** Coerce anything numeric into a Decimal (Decimals are immutable, so sharing is safe). */
export const D = (v: DecimalSource): Decimal => (v instanceof Decimal ? v : new Decimal(v));

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export type Notation = 'standard' | 'scientific' | 'engineering';
export const NOTATIONS: readonly Notation[] = ['standard', 'scientific', 'engineering'];

const SUFFIXES = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg',
];

/**
 * Format a number for display.
 *  - below 1,000 it prints plainly (integers without decimals)
 *  - above that it follows the chosen notation; standard falls back to scientific past 1e66
 */
export function formatNumber(value: DecimalSource, notation: Notation = 'standard', places = 2): string {
  const v = D(value);
  if (Number.isNaN(v.mantissa) || Number.isNaN(v.exponent)) return 'NaN';
  if (v.lt(0)) return '-' + formatNumber(v.neg(), notation, places);
  if (v.eq(0)) return '0';

  if (v.lt(1000)) {
    const n = v.toNumber();
    if (Number.isInteger(n)) return String(n);
    if (n < 0.01) return n.toExponential(1);
    return n.toFixed(places);
  }

  const exp = v.exponent;
  const mant = v.mantissa;

  if (notation === 'standard') {
    let tier = Math.floor(exp / 3);
    if (tier < SUFFIXES.length) {
      let scaled = mant * 10 ** (exp - tier * 3);
      let rounded = Number(scaled.toFixed(places));
      if (rounded >= 1000) {
        tier += 1;
        scaled = mant * 10 ** (exp - tier * 3);
        rounded = Number(scaled.toFixed(places));
        if (tier >= SUFFIXES.length) return scientific(mant, exp, places);
      }
      return `${rounded.toFixed(places)}${SUFFIXES[tier]}`;
    }
    return scientific(mant, exp, places);
  }

  if (notation === 'engineering') {
    const e3 = Math.floor(exp / 3) * 3;
    const scaled = mant * 10 ** (exp - e3);
    const rounded = Number(scaled.toFixed(places));
    if (rounded >= 1000) return `${(rounded / 1000).toFixed(places)}e${e3 + 3}`;
    return `${rounded.toFixed(places)}e${e3}`;
  }

  return scientific(mant, exp, places);
}

function scientific(mant: number, exp: number, places: number): string {
  const rounded = Number(mant.toFixed(places));
  if (rounded >= 10) return `${(rounded / 10).toFixed(places)}e${exp + 1}`;
  return `${rounded.toFixed(places)}e${exp}`;
}

/** Whole-number counts (owned buildings, medals): thousands separators, no suffixes below 1e6. */
export function formatCount(n: number | Decimal, notation: Notation = 'standard'): string {
  const v = D(n);
  if (v.lt(1e6)) return Math.floor(v.toNumber()).toLocaleString('en-US');
  return formatNumber(v, notation, 2);
}

/** 3725 -> "1h 02m", 59 -> "59s", 200000 -> "2d 7h". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(s / 3600);
  if (s < 86400) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(s / 86400);
  return `${d}d ${h % 24}h`;
}

export function formatPercent(fraction: number, places = 0): string {
  return `${(fraction * 100).toFixed(places)}%`;
}
