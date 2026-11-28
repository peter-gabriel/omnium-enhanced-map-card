import { LitElement, html, css, nothing } from 'lit';
import type { CardConfig, EntityConfig, Hass, ToolbarButton } from './types';
import { buildTrack, distance, type RawPoint, type Stop, type Track } from './track';
import { fetchHistory, pointFromAttributes } from './history';
import { loadGoogleMaps, mirrorGoogleStyles, onGoogleAuthFailure } from './google-loader';
import { strings, type Strings } from './i18n';
import { isApplePhone } from './device';
import { osrmGeometry, osrmMatchParams, snapPath, type LatLng, type Matcher } from './snap';

declare const __VERSION__: string;
const VERSION = __VERSION__;
const PALETTE = ['#4285F4', '#EA4335', '#34A853', '#F9AB00', '#A142F4', '#12B5CB', '#E8710A', '#F538A0'];
const PERIODS = [
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
  { hours: 168, label: '7d' },
];
const ALL = '__all__';
/** the line gets stronger the more recent it is; number of opacity bands */
const FADE_STEPS = 6;

interface Person {
  id: string;
  name: string;
  color: string;
  gpsButton?: ToolbarButton;
}

interface ZoneInfo {
  name: string;
  icon: string;
}

class OmniumEnhancedMapCard extends LitElement {
  static properties = {
    isPanel: { type: Boolean },
    layout: {},
    _selected: { state: true },
    _hours: { state: true },
    _tracks: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _activeStop: { state: true },
    _tuning: { state: true },
    _showTuning: { state: true },
    _timelineHidden: { state: true },
    _phoneBusy: { state: true },
    _phoneMsg: { state: true },
  };

  declare isPanel: boolean;
  declare layout: string | undefined;
  declare _selected: string;
  declare _hours: number;
  declare _tracks: Record<string, Track>;
  declare _loading: boolean;
  declare _error: string | undefined;
  declare _activeStop: number | undefined;
  declare _tuning: Tuning;
  declare _showTuning: boolean;
  declare _timelineHidden: boolean;
  declare _phoneBusy: boolean;
  declare _phoneMsg: string | undefined;

  private _config!: CardConfig;
  private _hass?: Hass;
  private _persons: Person[] = [];
  private _points: Record<string, RawPoint[]> = {};
  private _lastSeen: Record<string, string> = {};
  private _map?: google.maps.Map;
  private _lines: google.maps.Polyline[] = [];
  private _stopMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
  private _personMarkers = new Map<string, google.maps.marker.AdvancedMarkerElement>();
  private _recomputeTimer?: number;
  private _cleanups: (() => void)[] = [];
  private _initStarted = false;
  private _prevButtonStates: Record<string, unknown> = {};
  /** paths actually drawn: the track path, or its road-snapped version */
  private _display: Record<string, RawPoint[]> = {};
  private _snapRun = 0;
  private _snapWarned = false;

  constructor() {
    super();
    this.isPanel = false;
    this._selected = ALL;
    this._hours = 24;
    this._tracks = {};
    this._loading = false;
    this._timelineHidden = loadTimelineHidden();
  }

  // ---------- HA card API ----------

  static getStubConfig(hass: Hass) {
    return {
      api_key: '',
      entities: Object.keys(hass.states).filter((id) => id.startsWith('person.')),
    };
  }

  setConfig(config: CardConfig) {
    const t = strings(navigator.language);
    if (!config.api_key) throw new Error(t.errApiKey);
    if (!Array.isArray(config.entities) || config.entities.length === 0) throw new Error(t.errEntities);
    this._config = config;
    this._persons = config.entities.map((e, i) => {
      const ec: EntityConfig = typeof e === 'string' ? { entity: e } : e;
      return {
        id: ec.entity,
        name: ec.name ?? '',
        color: ec.color ?? PALETTE[i % PALETTE.length],
        gpsButton: ec.gps_button && gpsToggle(ec.gps_button),
      };
    });
    this._hours = config.hours_to_show ?? 24;
    this._tuning = { ...this._defaultTuning(), ...loadTuning() };
    this._selected = this._persons[0].id;
  }

  set hass(hass: Hass) {
    const first = !this._hass;
    this._hass = hass;
    const watched = [...(this._config?.buttons ?? []), ...this._persons.map((p) => p.gpsButton)]
      .map((b) => b?.entity)
      .filter(Boolean)
      .flatMap((id) => [id!, id!.replace(/^binary_sensor\.(.*)_high_accuracy_mode$/, 'sensor.$1_high_accuracy_update_interval')]);
    if (first || watched.some((id) => hass.states[id] !== this._prevButtonStates[id])) {
      for (const id of watched) this._prevButtonStates[id] = hass.states[id];
      this.requestUpdate();
    }
    if (!this._map) return;
    let changed = false;
    for (const p of this._persons) {
      const st = hass.states[p.id];
      if (!st || st.last_updated === this._lastSeen[p.id]) continue;
      this._lastSeen[p.id] = st.last_updated;
      const pt = pointFromAttributes(st.attributes, Date.parse(st.last_updated));
      if (pt) {
        (this._points[p.id] ??= []).push(pt);
        changed = true;
      }
    }
    if (changed) this._scheduleRecompute();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 'full', rows: 8, min_rows: 4 };
  }

  // ---------- lifecycle ----------

  connectedCallback() {
    super.connectedCallback();
    this._cleanups.push(onGoogleAuthFailure(() => this._setError(this._t.errAuth)));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanups.forEach((fn) => fn());
    this._cleanups = [];
    window.clearTimeout(this._recomputeTimer);
  }

  protected updated() {
    if (!this._initStarted && this._hass && this._config) {
      this._initStarted = true;
      this._init().catch((e) => this._setError(String(e?.message ?? e)));
    }
  }

  private _setError(msg: string) {
    this._error = msg;
    this._loading = false;
  }

  private async _init() {
    await loadGoogleMaps(this._config.api_key, this._t.errMapsDownload);
    this._cleanups.push(mirrorGoogleStyles(this.renderRoot as ShadowRoot));
    const { Map } = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary;
    await google.maps.importLibrary('marker');

    const el = this.renderRoot.querySelector<HTMLElement>('#map')!;
    const home = this._hass!.config;
    this._map = new Map(el, {
      mapId: this._config.map_id ?? 'DEMO_MAP_ID',
      center: home ? { lat: home.latitude, lng: home.longitude } : { lat: 0, lng: 0 },
      zoom: 13,
      colorScheme: (this._hass!.themes?.darkMode ? 'DARK' : 'LIGHT') as any,
      gestureHandling: this._config.gesture_handling ?? 'greedy',
      clickableIcons: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    this._map.addListener('click', () => (this._activeStop = undefined));
    await this._loadHistory();
  }

  private async _loadHistory() {
    if (!this._hass) return;
    this._loading = true;
    this._error = undefined;
    try {
      const start = new Date(Date.now() - this._hours * 3600_000);
      this._points = await fetchHistory(this._hass, this._persons.map((p) => p.id), start);
      for (const p of this._persons) this._lastSeen[p.id] = this._hass.states[p.id]?.last_updated;
      this._recompute();
      this._fit();
    } catch (e: any) {
      this._setError(this._t.errHistory(String(e?.message ?? e)));
    } finally {
      this._loading = false;
    }
  }

  private _scheduleRecompute() {
    window.clearTimeout(this._recomputeTimer);
    this._recomputeTimer = window.setTimeout(() => this._recompute(), 1500);
  }

  private _defaultTuning(): Tuning {
    return {
      maxAccuracy: this._config.max_accuracy ?? 100,
      stopRadius: this._config.stop_radius ?? 75,
      stopMinutes: this._config.stop_minutes ?? 5,
      snapToRoads: !!this._config.snap_to_roads,
    };
  }

  private _snapEnabled(): boolean {
    return !!this._config.snap_to_roads && this._tuning.snapToRoads;
  }

  /** Calls OSRM through the configured Home Assistant action; answers are cached per browser. */
  private _matcher: Matcher = async (points) => {
    const opts = typeof this._config.snap_to_roads === 'object' ? this._config.snap_to_roads : {};
    const params = osrmMatchParams(points, opts.radius ?? 25);
    const key = snapKey(params.coordinates + '|' + params.timestamps + '|' + params.radiuses);
    const cached = snapCacheGet(key);
    if (cached !== undefined) return cached;
    const [domain, service] = (opts.service ?? 'rest_command.osrm_match').split('.');
    try {
      const res = await this._hass!.callWS<{ response?: { status?: number; content?: unknown } }>({
        type: 'call_service',
        domain,
        service,
        service_data: params,
        return_response: true,
      });
      let content = res?.response?.content;
      if (typeof content === 'string') content = JSON.parse(content);
      const road = osrmGeometry(content);
      // remember definitive answers (a match, or OSRM saying there is none), not transport errors
      if ((content as { code?: string })?.code) snapCacheSet(key, road);
      return road;
    } catch (e: any) {
      if (!this._snapWarned) console.warn('enhanced-map-card: snap_to_roads failed', e?.message ?? e);
      this._snapWarned = true;
      return null;
    }
  };

  /** Snaps the visible tracks; draws straight lines first only if that takes a while. */
  private _snapVisible() {
    if (!this._snapEnabled()) return;
    const run = ++this._snapRun;
    const persons = this._visiblePersons();
    const straightFirst = window.setTimeout(() => run === this._snapRun && this._draw(), 400);
    Promise.all(
      persons.map(async (p) => {
        const path = this._tracks[p.id]?.path;
        return [p.id, path ? await snapPath(path, this._matcher) : undefined] as const;
      }),
    ).then((done) => {
      if (run !== this._snapRun) return;
      window.clearTimeout(straightFirst);
      for (const [id, path] of done) if (path) this._display[id] = path;
      this._draw();
    });
  }

  private _setTuning(patch: Partial<Tuning> | null) {
    this._tuning = patch ? { ...this._tuning, ...patch } : this._defaultTuning();
    saveTuning(patch ? this._tuning : null);
    this._activeStop = undefined;
    this._recompute();
  }

  private _renderTuning() {
    const t = this._tuning;
    const s = this._t;
    const row = (label: string, hint: string, key: NumericTuning, min: number, max: number, step: number, unit: string) => html`
      <label>
        <span class="t-label">${label} <b>${t[key]} ${unit}</b></span>
        <input type="range" min=${min} max=${max} step=${step} .value=${String(t[key])}
          @change=${(e: Event) => this._setTuning({ [key]: Number((e.target as HTMLInputElement).value) })} />
        <span class="t-hint">${hint}</span>
      </label>`;
    return html`<div class="tuning">
      <div class="t-title">${s.mapSection}</div>
      ${row(s.stopRadius, s.stopRadiusHint, 'stopRadius', 10, 200, 5, 'm')}
      ${row(s.accuracyFilter, s.accuracyFilterHint, 'maxAccuracy', 10, 300, 10, 'm')}
      ${row(s.minStop, s.minStopHint, 'stopMinutes', 1, 30, 1, 'min')}
      ${this._config.snap_to_roads
        ? html`<label class="t-check">
              <input type="checkbox" .checked=${t.snapToRoads}
                @change=${(e: Event) => this._setTuning({ snapToRoads: (e.target as HTMLInputElement).checked })} />
              <span class="t-label">${s.snapToRoads}</span>
            </label>
            <span class="t-hint">${s.snapToRoadsHint}</span>`
        : nothing}
      <button class="t-reset" @click=${() => this._setTuning(null)}>${s.resetYaml}</button>
      ${this._renderPhoneSettings()}
    </div>`;
  }

  /** companion-app settings of the selected person's phone (sent as notification commands) */
  private _renderPhoneSettings() {
    const p = this._persons.find((x) => x.id === this._selected);
    const btn = p?.gpsButton;
    if (!p || !btn || this._isApplePhone(p)) return nothing;
    const s = this._t;
    const intervalEntity = btn.entity?.replace(/^binary_sensor\.(.*)_high_accuracy_mode$/, 'sensor.$1_high_accuracy_update_interval');
    const current = intervalEntity ? this._hass?.states[intervalEntity]?.state : undefined;
    const known = current && !['unknown', 'unavailable'].includes(current) ? Number(current) : undefined;
    const options = [10, 30, 60, 120, 180, 300];
    const sent = loadSentIntervals()[btn.action];
    // the app is slow to refresh this sensor; the last value sent wins until the phone confirms it
    const pending = sent && sent.t > (this._hass?.states[intervalEntity ?? '']?.last_updated ? Date.parse(this._hass!.states[intervalEntity!].last_updated) : 0) ? sent.sec : undefined;
    const shown = pending ?? known;
    return html`
      <div class="t-title">${s.phoneSection(this._name(p))}</div>
      <div class="t-label">${s.phoneInterval} <b>${shown !== undefined ? `${shown} s` : '?'}</b>
        ${pending !== undefined && pending !== known ? html`<span class="t-hint">${s.phonePending(String(known ?? '?'))}</span>` : nothing}
      </div>
      <div class="t-chips">
        ${options.map(
          (sec) => html`<button aria-pressed=${String(shown === sec)} ?disabled=${this._phoneBusy}
            @click=${() => this._setPhoneInterval(btn.action, sec)}>${sec < 60 ? `${sec}s` : `${sec / 60}min`}</button>`,
        )}
      </div>
      <span class="t-hint">
        ${this._phoneMsg ?? s.phoneHint}
      </span>
      <span class="t-hint">${s.phoneMinAccuracy}</span>
    `;
  }

  private async _setPhoneInterval(notify: string, seconds: number) {
    const [domain, service] = notify.split('.');
    this._phoneBusy = true;
    this._phoneMsg = this._t.phoneSending;
    try {
      await this._hass!.callService(domain, service, {
        message: 'command_high_accuracy_mode',
        data: { command: 'high_accuracy_set_update_interval', high_accuracy_update_interval: seconds },
      });
      // ask the app to resend its sensors so the new value shows up here
      await this._hass!.callService(domain, service, { message: 'command_update_sensors' });
      saveSentInterval(notify, seconds);
      this._phoneMsg = this._t.phoneSent(seconds);
    } catch (e: any) {
      this._phoneMsg = this._t.phoneFailed(String(e?.message ?? e));
    } finally {
      this._phoneBusy = false;
    }
  }

  private _recompute() {
    const from = Date.now() - this._hours * 3600_000;
    const opts = this._tuning;
    const tracks: Record<string, Track> = {};
    for (const p of this._persons) {
      tracks[p.id] = buildTrack((this._points[p.id] ?? []).filter((pt) => pt.t >= from), opts);
    }
    this._tracks = tracks;
    this._display = {};
    if (this._snapEnabled()) this._snapVisible();
    else this._draw();
  }

  // ---------- map drawing ----------

  private _visiblePersons(): Person[] {
    return this._selected === ALL ? this._persons : this._persons.filter((p) => p.id === this._selected);
  }

  private _draw() {
    const map = this._map;
    if (!map) return;
    this._lines.forEach((l) => l.setMap(null));
    this._stopMarkers.forEach((m) => (m.map = null));
    this._lines = [];
    this._stopMarkers = [];

    const single = this._selected !== ALL;
    for (const person of this._visiblePersons()) {
      const track = this._tracks[person.id];
      if (!track) continue;
      this._drawPath(this._display[person.id] ?? track.path, person.color, single);
      if (single) track.stops.forEach((s, i) => !s.ongoing && this._drawStop(s, i, person.color));
    }
    this._drawPersons();
  }

  private _drawPath(path: RawPoint[], color: string, emphasized: boolean) {
    if (path.length < 2) return;
    const map = this._map!;
    const weight = emphasized ? 5 : 3;

    // dark casing so the line stands out on the map
    this._lines.push(
      new google.maps.Polyline({ map, path, strokeColor: '#000', strokeOpacity: 0.25, strokeWeight: weight + 3, clickable: false, zIndex: 1 }),
    );

    const t0 = path[0].t;
    const span = Math.max(1, path[path.length - 1].t - t0);
    const bucketOf = (p: RawPoint) => Math.min(FADE_STEPS - 1, Math.floor(((p.t - t0) / span) * FADE_STEPS));
    let chunk: RawPoint[] = [path[0]];
    let bucket = bucketOf(path[0]);
    const flush = () => {
      if (chunk.length < 2) return;
      const opacity = 0.3 + 0.7 * ((bucket + 1) / FADE_STEPS);
      this._lines.push(
        new google.maps.Polyline({
          map,
          path: chunk,
          strokeColor: color,
          strokeOpacity: opacity * (emphasized ? 1 : 0.8),
          strokeWeight: weight,
          clickable: false,
          zIndex: 2,
          icons: emphasized
            ? [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2, strokeColor: '#fff', strokeOpacity: opacity, strokeWeight: 2 }, offset: '60px', repeat: '140px' }]
            : undefined,
        }),
      );
    };
    for (let i = 1; i < path.length; i++) {
      chunk.push(path[i]);
      const b = bucketOf(path[i]);
      if (b !== bucket) {
        flush();
        chunk = [path[i]];
        bucket = b;
      }
    }
    flush();
  }

  private _drawStop(stop: Stop, index: number, color: string) {
    const el = document.createElement('div');
    el.className = 'stop-marker' + (index === this._activeStop ? ' active' : '');
    el.style.setProperty('--c', color);
    el.textContent = formatDuration(stop.end - stop.start);
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map: this._map!,
      position: stop,
      content: el,
      title: this._zoneAt(stop)?.name ?? this._t.stop,
      zIndex: 10,
    });
    marker.addListener('click', () => this._focusStop(index, false));
    this._stopMarkers.push(marker);
  }

  private _drawPersons() {
    const map = this._map!;
    for (const person of this._persons) {
      const { pos, stop } = this._currentPosition(person.id);
      let marker = this._personMarkers.get(person.id);
      if (!pos) {
        if (marker) marker.map = null;
        continue;
      }
      if (!marker) {
        marker = new google.maps.marker.AdvancedMarkerElement({ map, zIndex: 20 });
        marker.addListener('click', () => this._select(person.id));
        this._personMarkers.set(person.id, marker);
      }
      const dim = this._selected !== ALL && this._selected !== person.id;
      marker.content = this._personBadge(person, dim, stop);
      marker.position = pos;
      marker.title = this._name(person);
      marker.map = map;
    }
  }

  /**
   * Where to show the person. HA's raw position may come from the network (poor accuracy) and land far
   * from the computed stop, so: ongoing stop > last good point > raw position.
   */
  private _currentPosition(id: string): { pos: { lat: number; lng: number } | null; stop?: Stop } {
    const st = this._hass?.states[id];
    const raw = st ? pointFromAttributes(st.attributes, 0) : null;
    const track = this._tracks[id];
    const stop = track?.stops.at(-1);
    if (stop?.ongoing) return { pos: { lat: stop.lat, lng: stop.lng }, stop };
    const imprecise = raw?.acc !== undefined && raw.acc > this._tuning.maxAccuracy;
    const last = track?.path.at(-1);
    if (imprecise && last) return { pos: last };
    return { pos: raw };
  }

  private _personBadge(person: Person, dim: boolean, stop?: Stop): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'person-wrap' + (dim ? ' dim' : '');
    wrap.style.setProperty('--c', person.color);
    const el = document.createElement('div');
    el.className = 'person-marker';
    wrap.appendChild(el);
    if (stop) {
      const pill = document.createElement('div');
      pill.className = 'person-stop';
      pill.textContent = formatDuration(stop.end - stop.start);
      pill.title = this._t.stoppedSince(this._formatTime(stop.start));
      wrap.appendChild(pill);
    }
    const pic = this._hass?.states[person.id]?.attributes.entity_picture;
    if (pic) {
      const img = document.createElement('img');
      img.src = pic;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = this._name(person).charAt(0).toUpperCase();
    }
    return wrap;
  }

  private _fit() {
    const map = this._map;
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();
    let n = 0;
    for (const person of this._visiblePersons()) {
      for (const pt of this._tracks[person.id]?.path ?? []) {
        bounds.extend(pt);
        n++;
      }
      const { pos } = this._currentPosition(person.id);
      if (pos) {
        bounds.extend(pos);
        n++;
      }
    }
    if (n === 0) return;
    const ne = bounds.getNorthEast().toJSON();
    const sw = bounds.getSouthWest().toJSON();
    // everything in one place (e.g. home all day): fitBounds would zoom all the way in
    if (distance(ne, sw) < 300) {
      map.setCenter(bounds.getCenter());
      map.setZoom(16);
    } else {
      map.fitBounds(bounds, 48);
    }
  }

  // ---------- interaction ----------

  private _select(id: string) {
    if (this._selected === id) return;
    this._selected = id;
    this._activeStop = undefined;
    this._phoneMsg = undefined;
    this._draw();
    this._fit();
    if (this._visiblePersons().some((p) => !this._display[p.id])) this._snapVisible();
  }

  /**
   * High-accuracy mode is an Android companion-app feature: the iOS app ignores the command.
   * The phone is found through the device of the button's sensor or of the person's trackers.
   */
  private _isApplePhone(p: Person): boolean {
    const trackers: string[] = this._hass?.states[p.id]?.attributes.device_trackers ?? [];
    return isApplePhone(this._hass, [p.gpsButton?.entity, p.id, ...trackers]);
  }

  private _toggleTimeline() {
    const center = this._map?.getCenter();
    this._timelineHidden = !this._timelineHidden;
    saveTimelineHidden(this._timelineHidden);
    // the map changes size; keep looking at the same place
    this.updateComplete.then(() => center && this._map?.setCenter(center));
  }

  private _selectedGpsButton(): ToolbarButton | undefined {
    const p = this._persons.find((x) => x.id === this._selected);
    if (!p?.gpsButton || this._isApplePhone(p)) return undefined;
    return { ...p.gpsButton, name: this._t.gpsButton(this._name(p)) };
  }

  private _buttonState(b: ToolbarButton): 'on' | 'off' | 'unknown' | undefined {
    // toggle without a state entity: unknown state, tapping turns it on
    if (!b.entity) return b.data_on ? 'unknown' : undefined;
    const st = this._hass?.states[b.entity]?.state;
    return st === 'on' ? 'on' : st === 'off' ? 'off' : 'unknown';
  }

  private _renderButton(b: ToolbarButton) {
    const state = this._buttonState(b);
    const label = b.name ?? b.action;
    const t = this._t;
    const title =
      state === 'on' ? t.buttonOn(label)
      : state === 'off' ? t.buttonOff(label)
      : state === 'unknown' ? t.buttonUnknown(label)
      : label;
    const icon = state === 'off' && b.icon_off ? b.icon_off : b.icon;
    return html`<button class="icon-btn ${state ? `toggle ${state}` : ''}" title=${title} aria-label=${title}
      aria-pressed=${state ? String(state === 'on') : nothing} @click=${(e: Event) => this._runButton(b, e)}>
      <ha-icon icon=${icon}></ha-icon>
    </button>`;
  }

  private async _runButton(b: ToolbarButton, e: Event) {
    const btn = e.currentTarget as HTMLElement;
    const [domain, service] = b.action.split('.');
    const state = this._buttonState(b);
    const data = state === undefined ? b.data : state === 'on' ? b.data_off : b.data_on;
    btn.classList.add('busy');
    try {
      await this._hass?.callService(domain, service, data);
      btn.classList.add('ok');
      setTimeout(() => btn.classList.remove('ok'), 1200);
    } catch (err: any) {
      this._error = this._t.actionFailed(b.action, String(err?.message ?? err));
    } finally {
      btn.classList.remove('busy');
    }
  }

  private _setHours(hours: number) {
    if (this._hours === hours) return;
    this._hours = hours;
    this._activeStop = undefined;
    this._loadHistory();
  }

  private _focusStop(index: number, pan = true) {
    this._activeStop = index;
    const stop = this._tracks[this._selected]?.stops[index];
    if (stop && pan && this._map) {
      this._map.panTo(stop);
      if ((this._map.getZoom() ?? 0) < 15) this._map.setZoom(16);
    }
    this._stopMarkers.forEach((m, i) => (m.content as HTMLElement).classList.toggle('active', i === index));
    this.updateComplete.then(() =>
      this.renderRoot.querySelector('.timeline li.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }

  // ---------- helpers ----------

  /** UI strings in the user's HA language (falls back to the browser language) */
  private get _t(): Strings {
    return strings(this._hass?.locale?.language ?? this._hass?.language ?? navigator.language);
  }

  private _name(p: Person): string {
    return p.name || this._hass?.states[p.id]?.attributes.friendly_name || p.id;
  }

  private _zoneAt(pos: { lat: number; lng: number }): ZoneInfo | undefined {
    const states = this._hass?.states ?? {};
    let best: { z: ZoneInfo; d: number } | undefined;
    for (const id in states) {
      if (!id.startsWith('zone.')) continue;
      const a = states[id].attributes;
      if (a.latitude == null || a.passive) continue;
      const d = distance(pos, { lat: a.latitude, lng: a.longitude });
      if (d <= (a.radius ?? 100) + 30 && (!best || d < best.d)) {
        best = { z: { name: a.friendly_name ?? id, icon: a.icon ?? (id === 'zone.home' ? 'mdi:home' : 'mdi:map-marker-radius') }, d };
      }
    }
    return best?.z;
  }

  private _formatTime(t: number): string {
    const lang = this._hass?.locale?.language ?? this._hass?.language ?? navigator.language;
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    return new Intl.DateTimeFormat(lang, today ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  }

  // ---------- render ----------

  render() {
    if (!this._config) return nothing;
    const height = this._config.height ?? (this.isPanel || this.layout === 'panel' ? '100%' : '450px');
    // A percentage only works when the parent has a fixed height, which HA's panel view does not give.
    // Without a cap, a long timeline stretches the card past the screen and the map frames trips out of
    // view, so a percentage height is also capped at the visible area below the HA header.
    const maxHeight = height.endsWith('%') ? 'calc(100dvh - var(--header-height, 56px))' : 'none';
    const single = this._selected !== ALL;
    const t = this._t;
    return html`
      <ha-card style="--emc-height:${height};--emc-max-height:${maxHeight}">
        <div class="toolbar">
          <div class="chips" role="group" aria-label=${t.people}>
            ${this._persons.map(
              (p) => html`<button class="chip" style="--c:${p.color}" aria-pressed=${this._selected === p.id} @click=${() => this._select(p.id)}>
                <span class="dot"></span>${this._name(p)}
              </button>`,
            )}
            ${this._persons.length > 1
              ? html`<button class="chip" aria-pressed=${!single} @click=${() => this._select(ALL)}>${t.all}</button>`
              : nothing}
          </div>
          ${(this._config.buttons ?? []).map((b) => this._renderButton(b))}
          ${this._selectedGpsButton() ? this._renderButton(this._selectedGpsButton()!) : nothing}
          ${single
            ? html`<button class="icon-btn" title=${this._timelineHidden ? t.showStops : t.hideStops}
                aria-label=${this._timelineHidden ? t.showStops : t.hideStops} aria-pressed=${!this._timelineHidden}
                @click=${() => this._toggleTimeline()}>
                <ha-icon icon=${this._timelineHidden ? 'mdi:format-list-bulleted' : 'mdi:map-legend'}></ha-icon>
              </button>`
            : nothing}
          <button class="icon-btn" title=${t.tuningTitle} aria-pressed=${!!this._showTuning} @click=${() => (this._showTuning = !this._showTuning)}>
            <ha-icon icon="mdi:tune-variant"></ha-icon>
          </button>
          <div class="periods" role="group" aria-label=${t.period}>
            ${PERIODS.map(
              (p) => html`<button aria-pressed=${this._hours === p.hours} @click=${() => this._setHours(p.hours)}>${p.label}</button>`,
            )}
          </div>
        </div>
        <div class="body">
          <div class="map-wrap">
            <div id="map"></div>
            ${this._showTuning ? this._renderTuning() : nothing}
            ${this._loading ? html`<div class="banner">${t.loading}</div>` : nothing}
            ${this._error ? html`<div class="banner error">${this._error}</div>` : nothing}
          </div>
          ${single && !this._timelineHidden ? this._renderTimeline() : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderTimeline() {
    const track = this._tracks[this._selected];
    const stops = track?.stops ?? [];
    const indexed = stops.map((s, i) => ({ s, i })).reverse();
    const moving = track && track.path.length > 0 && !stops.at(-1)?.ongoing;
    const t = this._t;
    return html`
      <aside class="timeline">
        <ol>
          ${moving ? html`<li class="moving"><ha-icon icon="mdi:navigation-variant"></ha-icon><div><div class="place">${t.moving}</div></div></li>` : nothing}
          ${indexed.map(({ s, i }) => {
            const zone = this._zoneAt(s);
            return html`<li class=${i === this._activeStop ? 'active' : ''} @click=${() => this._focusStop(i)}>
              <ha-icon icon=${zone?.icon ?? 'mdi:map-marker'}></ha-icon>
              <div>
                <div class="place">${zone?.name ?? t.stop}</div>
                <div class="when">
                  ${this._formatTime(s.start)} – ${s.ongoing ? t.now : this._formatTime(s.end)} · ${formatDuration(s.end - s.start)}
                </div>
              </div>
            </li>`;
          })}
          ${!this._loading && stops.length === 0 && !moving ? html`<li class="empty">${t.noData}</li>` : nothing}
        </ol>
      </aside>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    ha-card {
      height: var(--emc-height);
      max-height: var(--emc-max-height, none);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      container-type: inline-size;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--divider-color);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      flex: 1;
    }
    button {
      font: inherit;
      font-size: 13px;
      color: var(--primary-text-color);
      background: none;
      cursor: pointer;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border: 1px solid var(--divider-color);
      border-radius: 16px;
    }
    .chip[aria-pressed='true'] {
      border-color: var(--c, var(--primary-color));
      background: color-mix(in srgb, var(--c, var(--primary-color)) 22%, transparent);
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--c);
    }
    .periods {
      display: flex;
      border: 1px solid var(--divider-color);
      border-radius: 16px;
      overflow: hidden;
    }
    .periods button {
      border: none;
      padding: 4px 10px;
    }
    .periods button[aria-pressed='true'] {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .body {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .map-wrap {
      flex: 1;
      position: relative;
      min-width: 0;
      min-height: 240px;
    }
    #map {
      position: absolute;
      inset: 0;
    }
    .icon-btn {
      border: 1px solid var(--divider-color);
      border-radius: 50%;
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      padding: 0;
      --mdc-icon-size: 18px;
    }
    .icon-btn.toggle.on {
      background: var(--success-color, #43a047);
      border-color: var(--success-color, #43a047);
      color: #fff;
    }
    .icon-btn.toggle.off {
      color: var(--secondary-text-color);
    }
    .icon-btn.toggle.unknown {
      border-style: dashed;
    }
    .icon-btn.busy {
      opacity: 0.5;
    }
    .icon-btn.ok {
      border-color: var(--success-color, #43a047);
      color: var(--success-color, #43a047);
    }
    .icon-btn:not(.toggle)[aria-pressed='true'] {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .tuning {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 2;
      width: 260px;
      padding: 12px;
      border-radius: 12px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 13px;
    }
    .tuning label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .tuning input {
      width: 100%;
      accent-color: var(--primary-color);
    }
    .t-hint {
      font-size: 11px;
      color: var(--secondary-text-color);
    }
    .t-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--secondary-text-color);
      border-top: 1px solid var(--divider-color);
      padding-top: 10px;
    }
    .t-title:first-child {
      border-top: none;
      padding-top: 0;
    }
    .t-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .t-chips button {
      border: 1px solid var(--divider-color);
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 12px;
    }
    .t-chips button[aria-pressed='true'] {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .tuning {
      max-height: calc(100% - 20px);
      overflow-y: auto;
    }
    .t-check {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .t-check input {
      width: auto;
      margin: 0;
    }
    .t-reset {
      align-self: flex-start;
      border: 1px solid var(--divider-color);
      border-radius: 16px;
      padding: 4px 10px;
      font-size: 12px;
    }
    .banner {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 12px;
      border-radius: 8px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      font-size: 13px;
      max-width: 80%;
    }
    .banner.error {
      background: var(--error-color, #db4437);
      color: #fff;
    }
    .timeline {
      width: 260px;
      overflow-y: auto;
      border-left: 1px solid var(--divider-color);
    }
    @container (max-width: 640px) {
      .body {
        flex-direction: column;
      }
      .timeline {
        width: auto;
        max-height: 40%;
        border-left: none;
        border-top: 1px solid var(--divider-color);
      }
    }
    .timeline ol {
      list-style: none;
      margin: 0;
      padding: 4px 0;
    }
    .timeline li {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
    }
    .timeline li:hover,
    .timeline li.active {
      background: var(--secondary-background-color);
    }
    .timeline li.empty,
    .timeline li.moving {
      cursor: default;
      color: var(--secondary-text-color);
    }
    .timeline ha-icon {
      color: var(--secondary-text-color);
      --mdc-icon-size: 20px;
    }
    .place {
      font-size: 14px;
    }
    .when {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .person-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      /* anchors the circle's center on the point */
      transform: translateY(calc(100% - 17px));
    }
    .person-wrap.dim {
      opacity: 0.45;
    }
    .person-stop {
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--c);
      color: #fff;
      font: 600 11px/1.4 sans-serif;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      white-space: nowrap;
    }
    .person-marker {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 3px solid var(--c);
      background: #fff;
      color: #333;
      display: grid;
      place-items: center;
      font: 600 14px/1 sans-serif;
      overflow: hidden;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    }
    .person-marker img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .stop-marker {
      padding: 2px 7px;
      border-radius: 10px;
      background: #fff;
      color: #222;
      border: 2px solid var(--c);
      font: 600 11px/1.4 sans-serif;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      transform: translateY(50%);
      cursor: pointer;
    }
    .stop-marker.active {
      background: var(--c);
      color: #fff;
      transform: translateY(50%) scale(1.15);
    }
  `;
}

interface Tuning {
  maxAccuracy: number;
  stopRadius: number;
  stopMinutes: number;
  snapToRoads: boolean;
}
type NumericTuning = 'maxAccuracy' | 'stopRadius' | 'stopMinutes';

/**
 * Road geometry per match request, kept in this browser so each trip is matched only once.
 * Stored compactly ("lat,lng;lat,lng" with 5 decimals) and capped to the most recent entries.
 */
const SNAP_KEY = 'enhanced-map-card:snap-cache';
const SNAP_MAX_ENTRIES = 200;
let snapStore: Map<string, string | null> | undefined;
let snapSaveTimer: number | undefined;
function snapKey(text: string): string {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + text.length.toString(36);
}
function snapEntries(): Map<string, string | null> {
  if (!snapStore) {
    try {
      snapStore = new Map(JSON.parse(localStorage.getItem(SNAP_KEY) ?? '[]'));
    } catch {
      snapStore = new Map();
    }
  }
  return snapStore;
}
function snapCacheGet(key: string): LatLng[] | null | undefined {
  const store = snapEntries();
  if (!store.has(key)) return undefined;
  const v = store.get(key)!;
  return v === null ? null : v.split(';').map((p) => { const [lat, lng] = p.split(',').map(Number); return { lat, lng }; });
}
function snapCacheSet(key: string, road: LatLng[] | null) {
  const store = snapEntries();
  store.delete(key);
  store.set(key, road && road.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';'));
  while (store.size > SNAP_MAX_ENTRIES) store.delete(store.keys().next().value!);
  window.clearTimeout(snapSaveTimer);
  snapSaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify([...store]));
    } catch {
      // storage full: keep the newer half
      const keep = [...store].slice(-Math.floor(store.size / 2));
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(keep)); } catch { /* no storage */ }
    }
  }, 1000);
}

/** whether the stops list is collapsed, remembered per browser */
const TIMELINE_KEY = 'enhanced-map-card:timeline-hidden';
function loadTimelineHidden(): boolean {
  try {
    return localStorage.getItem(TIMELINE_KEY) === '1';
  } catch {
    return false;
  }
}
function saveTimelineHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(TIMELINE_KEY, '1');
    else localStorage.removeItem(TIMELINE_KEY);
  } catch {
    /* no storage: applies to this session only */
  }
}

/** settings changed in the tuning panel are saved in this browser and override the YAML */
const TUNING_KEY = 'enhanced-map-card:tuning';
function loadTuning(): Partial<Tuning> {
  try {
    return JSON.parse(localStorage.getItem(TUNING_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveTuning(t: Tuning | null) {
  try {
    if (t) localStorage.setItem(TUNING_KEY, JSON.stringify(t));
    else localStorage.removeItem(TUNING_KEY);
  } catch {
    /* no storage: applies to this session only */
  }
}

const SENT_KEY = 'enhanced-map-card:sent-intervals';
function loadSentIntervals(): Record<string, { sec: number; t: number }> {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveSentInterval(notify: string, sec: number) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ ...loadSentIntervals(), [notify]: { sec, t: Date.now() } }));
  } catch {
    /* no storage */
  }
}

function gpsToggle(g: NonNullable<EntityConfig['gps_button']>): ToolbarButton {
  const cmd = (c: string) => ({ message: 'command_high_accuracy_mode', data: { command: c } });
  return {
    icon: 'mdi:crosshairs-gps',
    icon_off: 'mdi:crosshairs-off',
    action: g.notify,
    entity: g.entity,
    data_on: cmd(g.force ? 'force_on' : 'turn_on'),
    data_off: cmd(g.force ? 'force_off' : 'turn_off'),
  };
}

function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

if (!customElements.get('omnium-enhanced-map-card')) {
  customElements.define('omnium-enhanced-map-card', OmniumEnhancedMapCard);
  ((window as any).customCards ??= []).push({
    type: 'omnium-enhanced-map-card',
    name: 'Omnium Enhanced Map Card',
    description: 'Google Maps with a clean track, stops and a timeline',
  });
  console.info(`%cOMNIUM-ENHANCED-MAP-CARD ${VERSION}`, 'color:#4285F4;font-weight:bold');
}
