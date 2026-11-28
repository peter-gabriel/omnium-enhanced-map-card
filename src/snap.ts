// Snap the moving parts of a track to roads with a map-matching service (OSRM). Pure logic: the
// service call itself is injected as a `Matcher`, so this works with any backend and is testable.
import { distance, type RawPoint } from './track';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Matches a run of points to roads. Resolves to the road geometry, or null to keep straight lines. */
export type Matcher = (points: RawPoint[]) => Promise<LatLng[] | null>;

/** OSRM's default limit of points per match request */
export const MAX_MATCH_POINTS = 100;
/** a road route longer than this × the straight-line length (+ DETOUR_SLACK_M) is treated as a bad match */
const MAX_DETOUR = 2.5;
const DETOUR_SLACK_M = 500;
/** runs shorter than this (straight-line metres) are not worth a request */
const MIN_RUN_M = 30;

const length = (pts: LatLng[]) => pts.slice(1).reduce((sum, p, i) => sum + distance(pts[i], p), 0);

/**
 * Index ranges [first, last] of the moving parts of a path. `buildTrack` draws each stop as two points at
 * the same place (arrival and departure); the path is split there and each run keeps the stop points at
 * its ends as anchors.
 */
export function moveRuns(path: RawPoint[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = 0;
  for (let i = 1; i < path.length; i++) {
    const stop = path[i].lat === path[i - 1].lat && path[i].lng === path[i - 1].lng;
    if (!stop) continue;
    if (i - 1 > start) runs.push([start, i - 1]);
    start = i;
  }
  if (path.length - 1 > start) runs.push([start, path.length - 1]);
  return runs;
}

/** Replaces each moving run of the path with its road geometry; stops and failed matches stay as they are. */
export async function snapPath(path: RawPoint[], match: Matcher): Promise<RawPoint[]> {
  const runs = moveRuns(path);
  const snapped = await Promise.all(runs.map(([a, b]) => snapRun(path.slice(a, b + 1), match)));
  const out: RawPoint[] = [];
  let next = 0;
  runs.forEach(([a, b], k) => {
    out.push(...path.slice(next, a), ...snapped[k]);
    next = b + 1;
  });
  out.push(...path.slice(next));
  return out;
}

async function snapRun(run: RawPoint[], match: Matcher): Promise<RawPoint[]> {
  const out: RawPoint[] = [];
  // consecutive chunks share their boundary point so the road geometry stays connected
  for (let s = 0; s < run.length - 1; s += MAX_MATCH_POINTS - 1) {
    const part = await snapChunk(run.slice(s, s + MAX_MATCH_POINTS), match);
    out.push(...(out.length ? part.slice(1) : part));
  }
  return out.length ? out : run;
}

async function snapChunk(chunk: RawPoint[], match: Matcher): Promise<RawPoint[]> {
  const straight = length(chunk);
  if (chunk.length < 2 || straight < MIN_RUN_M) return chunk;
  let road: LatLng[] | null;
  try {
    road = await match(chunk);
  } catch {
    road = null;
  }
  if (!road || road.length < 2 || length(road) > straight * MAX_DETOUR + DETOUR_SLACK_M) return chunk;

  // the road has no timestamps: spread the chunk's time along it by distance (used for the fading)
  const first = chunk[0];
  const last = chunk[chunk.length - 1];
  const cum = [0];
  for (let i = 1; i < road.length; i++) cum.push(cum[i - 1] + distance(road[i - 1], road[i]));
  const total = cum[cum.length - 1] || 1;
  const timed = road.map((p, i) => ({ lat: p.lat, lng: p.lng, t: first.t + ((last.t - first.t) * cum[i]) / total }));
  // keep the original ends so the road joins the stops (snapped ends can be a few metres off)
  return [first, ...timed, last];
}

/** Request parameters for OSRM's /match service (also what the rest_command template expects). */
export function osrmMatchParams(points: RawPoint[], radius = 25) {
  let prev = -Infinity;
  const timestamps = points.map((p) => {
    // OSRM needs increasing timestamps (seconds)
    prev = Math.max(Math.round(p.t / 1000), prev + 1);
    return prev;
  });
  return {
    coordinates: points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';'),
    timestamps: timestamps.join(';'),
    radiuses: points.map(() => radius).join(';'),
  };
}

/** Road geometry from an OSRM /match response (geometries=geojson), or null when nothing matched. */
export function osrmGeometry(response: unknown): LatLng[] | null {
  const r = response as { code?: string; matchings?: { geometry?: { coordinates?: [number, number][] } }[] };
  if (r?.code !== 'Ok' || !r.matchings?.length) return null;
  const coords = r.matchings.flatMap((m) => m.geometry?.coordinates ?? []);
  return coords.length >= 2 ? coords.map(([lng, lat]) => ({ lat, lng })) : null;
}
