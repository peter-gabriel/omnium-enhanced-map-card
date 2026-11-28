import { describe, expect, it } from 'vitest';
import { dayRange, fromInputValue, isPastRange, isValidRange, MAX_RANGE_DAYS, toInputValue } from '../src/range';

const NOW = new Date(2026, 10, 28, 14, 30).getTime(); // 28 Nov 2026 14:30, local time
const H = 3_600_000;

describe('datetime-local values', () => {
  it('round-trips local time to the minute', () => {
    expect(toInputValue(NOW)).toBe('2026-11-28T14:30');
    expect(fromInputValue('2026-11-28T14:30')).toBe(NOW);
    expect(fromInputValue(toInputValue(NOW - 5 * H))).toBe(NOW - 5 * H);
  });

  it('rejects malformed values', () => {
    expect(fromInputValue('')).toBeNaN();
    expect(fromInputValue('28/11/2026 14:30')).toBeNaN();
  });
});

describe('isValidRange', () => {
  it('needs start before end, a limited length and a start in the past', () => {
    expect(isValidRange({ start: NOW - 2 * H, end: NOW - H }, NOW)).toBe(true);
    expect(isValidRange({ start: NOW - H, end: NOW - 2 * H }, NOW)).toBe(false);
    expect(isValidRange({ start: NOW - (MAX_RANGE_DAYS + 1) * 24 * H, end: NOW }, NOW)).toBe(false);
    expect(isValidRange({ start: NOW + H, end: NOW + 2 * H }, NOW)).toBe(false);
    expect(isValidRange({ start: NaN, end: NOW }, NOW)).toBe(false);
  });
});

describe('dayRange', () => {
  it('today runs from midnight until now', () => {
    expect(dayRange(0, NOW)).toEqual({ start: new Date(2026, 10, 28).getTime(), end: NOW });
  });

  it('yesterday is the whole previous local day', () => {
    const r = dayRange(1, NOW);
    expect(r.start).toBe(new Date(2026, 10, 27).getTime());
    expect(r.end).toBe(new Date(2026, 10, 28).getTime() - 1);
  });
});

describe('isPastRange', () => {
  it('is past only when the window ended before now', () => {
    expect(isPastRange(undefined, NOW)).toBe(false);
    expect(isPastRange({ start: NOW - 2 * H, end: NOW }, NOW)).toBe(false);
    expect(isPastRange(dayRange(1, NOW), NOW)).toBe(true);
  });
});
