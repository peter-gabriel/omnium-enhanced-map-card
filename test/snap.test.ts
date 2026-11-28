import { describe, expect, it, vi } from 'vitest';
import { MAX_MATCH_POINTS, moveRuns, osrmGeometry, osrmMatchParams, snapPath, type Matcher } from '../src/snap';
import type { RawPoint } from '../src/track';

const HOME = { lat: 43.73, lng: 7.42 };
const MIN = 60_000;
const north = (m: number, t: number): RawPoint => ({ lat: HOME.lat + m / 111_320, lng: HOME.lng, t });
/** a fake road: the straight segment with a small sideways bend in the middle */
const bendy: Matcher = async (pts) => [
  { lat: pts[0].lat, lng: pts[0].lng },
  { lat: (pts[0].lat + pts.at(-1)!.lat) / 2, lng: HOME.lng + 0.001 },
  { lat: pts.at(-1)!.lat, lng: pts.at(-1)!.lng },
];

// stop at home (2 equal points), trip north, stop at the destination (2 equal points)
const path: RawPoint[] = [
  north(0, 0), north(0, 10 * MIN),
  north(800, 14 * MIN), north(1600, 18 * MIN),
  north(2400, 22 * MIN), north(2400, 40 * MIN),
];

describe('moveRuns', () => {
  it('splits at stops and keeps the stop points as anchors', () => {
    expect(moveRuns(path)).toEqual([[1, 4]]);
    expect(moveRuns([north(0, 0), north(100, MIN)])).toEqual([[0, 1]]);
    expect(moveRuns([north(0, 0), north(0, MIN)])).toEqual([]);
  });
});

describe('snapPath', () => {
  it('replaces trips with the road and leaves stops alone', async () => {
    const out = await snapPath(path, bendy);
    expect(out.slice(0, 2)).toEqual(path.slice(0, 2)); // home stop unchanged
    expect(out.slice(-2)).toEqual(path.slice(-2)); // destination stop unchanged
    expect(out.some((p) => p.lng === HOME.lng + 0.001)).toBe(true); // went along the road
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThanOrEqual(out[i - 1].t);
  });

  it('keeps straight lines when the match fails, errors or detours too much', async () => {
    const fail: Matcher = async () => null;
    const boom: Matcher = async () => { throw new Error('no service'); };
    const detour: Matcher = async (pts) => [pts[0], { lat: HOME.lat + 0.2, lng: HOME.lng }, pts.at(-1)!];
    for (const m of [fail, boom, detour]) expect(await snapPath(path, m)).toEqual(path);
  });

  it('splits long trips into requests of at most 100 points that share their ends', async () => {
    const long: RawPoint[] = Array.from({ length: 250 }, (_, i) => north(i * 100, i * 30_000));
    const seen: number[] = [];
    const m = vi.fn<Matcher>(async (pts) => { seen.push(pts.length); return pts.map(({ lat, lng }) => ({ lat, lng })); });
    const out = await snapPath(long, m);
    expect(Math.max(...seen)).toBeLessThanOrEqual(MAX_MATCH_POINTS);
    expect(seen.reduce((a, b) => a + b, 0) - (seen.length - 1)).toBe(250);
    expect(out[0]).toEqual(long[0]);
    expect(out.at(-1)).toEqual(long.at(-1));
  });
});

describe('OSRM helpers', () => {
  it('builds increasing timestamps in seconds and lng,lat coordinates', () => {
    const p = osrmMatchParams([north(0, 1000), north(10, 1000), north(20, 5000)], 25);
    expect(p.timestamps).toBe('1;2;5');
    expect(p.radiuses).toBe('25;25;25');
    expect(p.coordinates.split(';')[0]).toBe('7.420000,43.730000');
  });

  it('reads the geometry of all matchings, or null', () => {
    expect(osrmGeometry({ code: 'Ok', matchings: [{ geometry: { coordinates: [[1, 2], [3, 4]] } }] })).toEqual([
      { lat: 2, lng: 1 }, { lat: 4, lng: 3 },
    ]);
    expect(osrmGeometry({ code: 'NoMatch' })).toBeNull();
    expect(osrmGeometry(undefined)).toBeNull();
  });
});
