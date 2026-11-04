import { describe, expect, it } from 'vitest';
import { Decimal, formatCount, formatDuration, formatNumber } from '../src/core/numbers';

describe('formatNumber', () => {
  it('prints small values plainly', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(7)).toBe('7');
    expect(formatNumber(0.2)).toBe('0.20');
    expect(formatNumber(12.345)).toBe('12.35');
    expect(formatNumber(999)).toBe('999');
  });

  it('uses short suffixes in standard notation', () => {
    expect(formatNumber(1000)).toBe('1.00K');
    expect(formatNumber(1500)).toBe('1.50K');
    expect(formatNumber(2_500_000)).toBe('2.50M');
    expect(formatNumber(4e9)).toBe('4.00B');
    expect(formatNumber(new Decimal('3.21e15'))).toBe('3.21Qa');
  });

  it('carries over when rounding reaches the next tier', () => {
    expect(formatNumber(999_999)).toBe('1.00M');
    expect(formatNumber(999_996)).toBe('1.00M');
  });

  it('falls back to scientific beyond the suffix table', () => {
    expect(formatNumber(new Decimal('1.5e90'))).toBe('1.50e90');
  });

  it('supports scientific and engineering notation', () => {
    expect(formatNumber(123456, 'scientific')).toBe('1.23e5');
    expect(formatNumber(123456, 'engineering')).toBe('123.46e3');
    expect(formatNumber(9.999e5, 'scientific')).toBe('1.00e6');
  });

  it('handles negatives', () => {
    expect(formatNumber(-1500)).toBe('-1.50K');
  });
});

describe('formatCount and formatDuration', () => {
  it('groups digits for counts', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(25)).toBe('25');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(3725)).toBe('1h 02m');
    expect(formatDuration(200_000)).toBe('2d 7h');
  });
});
