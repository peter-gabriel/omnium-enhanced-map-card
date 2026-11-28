import { describe, expect, it } from 'vitest';
import { buildTrack, cleanPoints, distance, type RawPoint } from '../src/track';

const HOME = { lat: -29.7600, lng: -51.1500 };
const MIN = 60_000;
/** moves ~meters north */
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_320, lng: p.lng });
const opts = { maxAccuracy: 100, stopRadius: 75, stopMinutes: 5 };

describe('cleanPoints', () => {
  it('drops inaccurate points and GPS spikes', () => {
    const pts: RawPoint[] = [
      { ...HOME, t: 0 },
      { ...north(HOME, 20), t: 1 * MIN },
      { ...north(HOME, 5000), t: 2 * MIN }, // jumps 5 km and back
      { ...north(HOME, 30), t: 3 * MIN },
      { ...north(HOME, 40), t: 4 * MIN, acc: 500 },
    ];
    const out = cleanPoints(pts, 100);
    expect(out.map((p) => p.t)).toEqual([0, 1 * MIN, 3 * MIN]);
  });

  it('keeps a real move after a long gap', () => {
    const pts: RawPoint[] = [
      { ...HOME, t: 0 },
      { ...north(HOME, 300_000), t: 1 * MIN }, // phone woke up far away
      { ...north(HOME, 300_100), t: 2 * MIN },
    ];
    expect(cleanPoints(pts, 100)).toHaveLength(3);
  });
});

describe('buildTrack', () => {
  it('collapses noise at home into one stop and keeps the path', () => {
    const pts: RawPoint[] = [];
    // 1h at home with ±40 m noise
    for (let i = 0; i < 12; i++) pts.push({ ...north(HOME, (i % 2 ? 1 : -1) * 40), t: i * 5 * MIN });
    // walks away: 1 km in 10 min
    for (let i = 1; i <= 5; i++) pts.push({ ...north(HOME, i * 200), t: 60 * MIN + i * 2 * MIN });
    const track = buildTrack(pts, { ...opts, now: 71 * MIN });

    expect(track.stops).toHaveLength(1);
    expect(distance(track.stops[0], HOME)).toBeLessThan(20);
    expect(track.stops[0].ongoing).toBe(false);
    // 2 stop points + 5 path points instead of 17
    expect(track.path).toHaveLength(7);
  });

  it('a still last position is an ongoing stop until now', () => {
    const pts: RawPoint[] = [{ ...HOME, t: 0 }];
    const track = buildTrack(pts, { ...opts, now: 30 * MIN });
    expect(track.stops).toEqual([{ ...HOME, start: 0, end: 30 * MIN, ongoing: true }]);
  });

  it('a lone point on a highway is not a false stop', () => {
    const pts: RawPoint[] = [
      { ...HOME, t: 0 },
      { ...north(HOME, 15_000), t: 15 * MIN }, // 15 km in 15 min, few points
      { ...north(HOME, 30_000), t: 30 * MIN },
    ];
    const track = buildTrack(pts, { ...opts, now: 31 * MIN });
    expect(track.stops).toHaveLength(0);
  });
});

describe('i18n', () => {
  it('picks pt-BR, es or falls back to English', async () => {
    const { strings } = await import('../src/i18n');
    expect(strings('pt-BR').all).toBe('Todos');
    expect(strings('pt').moving).toBe('Em deslocamento');
    expect(strings('es-ES').moving).toBe('En movimiento');
    expect(strings('de').moving).toBe('On the move');
    expect(strings(undefined).moving).toBe('On the move');
  });
});

describe('route precision', () => {
  it('keeps an inaccurate point that fits a trip and drops one that is noise at a stop', () => {
    const pts: RawPoint[] = [
      { ...HOME, t: 0 },
      { ...north(HOME, 800), t: 4 * MIN, acc: 30 },
      { ...north(HOME, 1600), t: 8 * MIN, acc: 104 }, // only sample of this street, poor accuracy
      { ...north(HOME, 2400), t: 12 * MIN, acc: 40 },
      { ...north(HOME, 2410), t: 16 * MIN, acc: 10 },
      { ...north(HOME, 2900), t: 20 * MIN, acc: 150 }, // network fix while standing still
      { ...north(HOME, 2405), t: 24 * MIN, acc: 10 },
    ];
    const kept = cleanPoints(pts, 75).map((p) => p.t);
    expect(kept).toContain(8 * MIN);
    expect(kept).not.toContain(20 * MIN);
  });

  it('always drops points far beyond the accuracy limit', () => {
    const pts: RawPoint[] = [
      { ...HOME, t: 0 },
      { ...north(HOME, 500), t: 4 * MIN, acc: 400 },
      { ...north(HOME, 1000), t: 8 * MIN },
    ];
    expect(cleanPoints(pts, 75).map((p) => p.t)).toEqual([0, 8 * MIN]);
  });

  it('a slow trip with sparse samples does not turn each sample into a stop', () => {
    // one point every 4 minutes, moving ~800 m between samples
    const pts: RawPoint[] = [];
    for (let i = 0; i < 6; i++) pts.push({ ...north(HOME, i * 800), t: i * 4 * MIN, acc: 20 });
    const track = buildTrack(pts, { ...opts, stopRadius: 50, now: 21 * MIN });
    expect(track.stops.filter((s) => !s.ongoing)).toHaveLength(0);
    expect(track.path).toHaveLength(6); // every sample stays on the path
  });

  it('a single point followed by a long silence is still a stop', () => {
    const pts: RawPoint[] = [
      { ...HOME, t: 0, acc: 10 },
      { ...north(HOME, 800), t: 4 * MIN, acc: 10 },
      { ...north(HOME, 1600), t: 8 * MIN, acc: 10 }, // arrives and the phone goes quiet
      { ...north(HOME, 2400), t: 68 * MIN, acc: 10 },
      { ...north(HOME, 3200), t: 72 * MIN, acc: 10 },
    ];
    const track = buildTrack(pts, { ...opts, stopRadius: 50, now: 73 * MIN });
    const done = track.stops.filter((s) => !s.ongoing);
    expect(done).toHaveLength(1);
    expect(distance(done[0], north(HOME, 1600))).toBeLessThan(5);
  });
});
