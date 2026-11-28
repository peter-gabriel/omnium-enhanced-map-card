# Omnium Enhanced Map Card

A Home Assistant Lovelace card that shows where people have been on **Google Maps**: a clean track instead of a cloud of dots.

![Omnium Enhanced Map Card: a day of one person's track with stops and the timeline](https://raw.githubusercontent.com/peter-gabriel/omnium-enhanced-map-card/main/docs/screenshot.png)

*Screenshots use fictional people and places.*

- **GPS noise filtered:** points with a high `gps_accuracy` and jumps that go and come back are dropped.
- **Stops instead of dots:** time spent in one place becomes a single marker with its duration (e.g. `2h07`). The name of the HA zone is used when there is one.
- **One person at a time:** a colored chip per person at the top, plus "All".
- **Timeline:** shown next to the map, or below it on narrow screens. Clicking a stop pans the map to it. A toolbar button hides it to see the map full size; the choice is remembered per browser.
- **Readable direction:** older parts of the track fade out, and arrows show the direction of travel.
- **Live updates:** new positions are added without reloading the map. Every map creation counts as one Google map load.
- **High-accuracy GPS control:** one button per person turns the Android companion app's high-accuracy mode on or off. The card also sets the update interval for it (see [High-accuracy mode](#high-accuracy-mode)).
- **Localized:** Brazilian Portuguese, Spanish and English, following your HA user language. Anything else falls back to English.

## Installation

The card is not in the default store yet, so you add it by its GitHub link. Updates then arrive with each new release.

### Marketplace (newer Home Assistant versions)

1. Open **Marketplace** in the sidebar and click **Add from link** (top right).
2. Paste `https://github.com/peter-gabriel/omnium-enhanced-map-card` and click **Add**.
3. Search for **Omnium Enhanced Map Card**, open it and click **Install**.
4. Reload the browser when asked.

The Marketplace adds the dashboard resource for you.

### HACS

1. In HACS → ⋮ → **Custom repositories**, add `https://github.com/peter-gabriel/omnium-enhanced-map-card` with the type **Dashboard**.
2. Search for **Omnium Enhanced Map Card**, download it, and reload the browser.

HACS adds the dashboard resource for you.

### Manual

1. Download `omnium-enhanced-map-card.js` from the [latest release](https://github.com/peter-gabriel/omnium-enhanced-map-card/releases/latest).
2. Copy it to `/config/www/`.
3. Add it under **Settings → Dashboards → ⋮ → Resources** as `/local/omnium-enhanced-map-card.js`, with the type *JavaScript module*.

If you switch from a manual install to the Marketplace or HACS, delete the old `/local/omnium-enhanced-map-card.js` resource. Otherwise the card is loaded twice.

## Configuration

```yaml
type: custom:omnium-enhanced-map-card
api_key: YOUR_KEY             # Maps JavaScript API key (required)
map_id: YOUR_MAP_ID           # optional; DEMO_MAP_ID is used when omitted
entities:                     # person.* or device_tracker.* entities (required)
  - person.alice
  - entity: person.bob
    name: Bob
    color: '#EA4335'
    gps_button:               # optional, see "High-accuracy mode"
      notify: notify.mobile_app_bobs_phone
      entity: binary_sensor.bobs_phone_high_accuracy_mode
hours_to_show: 24             # initial period; the toolbar offers 6h / 24h / 3d / 7d
max_accuracy: 75              # m: less accurate points are only used if they fit the route
stop_radius: 50               # m: radius treated as "the same place"
stop_minutes: 5               # min: minimum time for a stop
height: 100%                  # default 450px; use 100% in a panel view
gesture_handling: greedy      # greedy | cooperative | auto | none
```

| Option | Default | Description |
| --- | --- | --- |
| `api_key` | — | Google Maps JavaScript API key. |
| `map_id` | `DEMO_MAP_ID` | Map ID from Google Cloud, for custom map styles. |
| `entities` | — | List of entity ids, or objects with `entity`, `name`, `color` and `gps_button`. |
| `hours_to_show` | `24` | Hours of history loaded at start. |
| `max_accuracy` | `100` | Points with `gps_accuracy` above this (m) are only used when they fit the route between accurate points (see below). Above 4× this value they are always ignored. |
| `stop_radius` | `75` | Movements within this radius (m) count as staying in place. |
| `stop_minutes` | `5` | Minimum minutes in place to show a stop. |
| `height` | `450px` | Card height. Use `100%` in a panel view. |
| `gesture_handling` | `greedy` | Google Maps gesture handling. |
| `buttons` | — | Extra icon-only buttons that call any action (see below). |

The values that work best depend on your phones. A 50 m radius with a 75 m accuracy filter usually keeps a whole stay at home as one stop. Smaller values break it into many short stops.

### How the track is cleaned

- **Inaccurate points:** while moving, phones often report fixes with 80–200 m accuracy, and such a fix may be the only sample of a street. A point less accurate than `max_accuracy` is kept when it fits between the accurate points before and after it. It is dropped when it "goes out and comes back", which is the typical network fix while someone stands still. It is also dropped when it is more than 4× `max_accuracy`.
- **Spikes:** a jump that would need more than 70 m/s in both directions is removed.
- **Stops:** points that stay within `stop_radius` for at least `stop_minutes` become one stop. A single point only counts as a stop when the phone then stayed silent for much longer than its usual reporting interval. Otherwise a slow trip with one sample every few minutes would turn every sample into a stop.

### Track settings in the card

The **settings button** (sliders icon) in the toolbar opens a panel where you can change three values live:

- stop radius;
- accuracy filter;
- minimum stop time.

Changes are saved in that browser only and override the YAML. **Restore YAML defaults** goes back to the configured values.

![Settings panel with the map settings and the phone's high-accuracy interval](https://raw.githubusercontent.com/peter-gabriel/omnium-enhanced-map-card/main/docs/settings.png)

### Extra toolbar buttons

```yaml
buttons:
  - icon: mdi:bell
    name: Ping phone
    action: notify.mobile_app_alices_phone
    data: { message: Where are you? }
  - icon: mdi:lightbulb          # toggle: green while `entity` is on
    icon_off: mdi:lightbulb-off
    action: light.toggle
    entity: light.porch
    data_on: { entity_id: light.porch }
    data_off: { entity_id: light.porch }
```

## High-accuracy mode

The Android Home Assistant companion app normally reports location only every few minutes, or when it detects significant movement. This saves battery, but the track gets coarse: corners are cut and short trips can be missed.

**High-accuracy mode** makes the app keep the GPS on and report a position at a fixed interval (for example every 30 s). The track becomes much more detailed, at the cost of more battery use. While it is on, the app shows a persistent "High accuracy mode" notification. The mode is Android-only; the iOS app has no equivalent. For people whose phone is an Apple device in Home Assistant, the card hides the GPS button and the phone settings, even if `gps_button` is configured.

The card controls the mode by sending [notification commands](https://companion.home-assistant.io/docs/notifications/notification-commands/) to the phone through its `notify.mobile_app_*` service:

| What | Message | `data` |
| --- | --- | --- |
| Turn on / off | `command_high_accuracy_mode` | `command: turn_on` / `turn_off` (or `force_on` / `force_off`) |
| Set the interval | `command_high_accuracy_mode` | `command: high_accuracy_set_update_interval`, `high_accuracy_update_interval: <seconds>` |
| Refresh sensors | `command_update_sensors` | — |

### Setting it up

1. **On the phone**, make sure the *Background location* sensor is enabled. You can find it in the companion app under *Settings → Companion app → Manage sensors*. Also give the app *"Allow all the time"* location access and turn off battery optimization for it.
2. **In Home Assistant**, open the phone's device page and enable two sensors, which are disabled by default:
   - `binary_sensor.<phone>_high_accuracy_mode`;
   - `sensor.<phone>_high_accuracy_update_interval`.

   Then open the app once, so that it reports their values.
3. **In the card**, add `gps_button` to the person:

   ```yaml
   entities:
     - entity: person.alice
       gps_button:
         notify: notify.mobile_app_alices_phone
         entity: binary_sensor.alices_phone_high_accuracy_mode
         force: false   # true uses force_on/force_off, overriding the app's own conditions
   ```

### Using it from the card

- **Toggle:** select the person and a GPS button appears in the toolbar. It shows the current state:
  - green: on;
  - grey: off;
  - dashed outline: unknown, usually because the sensor is not enabled yet or has not reported.

  Tap it to switch the mode. The button is hidden in the "All" view.
- **Interval:** with the person selected, open the settings panel. The **"&lt;name&gt;'s phone"** section has quick choices from 10 s to 5 min. Tapping one sends the interval to the phone and asks the app to refresh its sensors.
  - Lower values give a more detailed track and use more battery.
  - The interval only matters while high-accuracy mode is on.

  The app is often slow to update its interval sensor. Until it does, the panel shows the last value you sent with a "sent" note.
- **Minimum accuracy:** the app's own minimum accuracy cannot be changed remotely. The companion app has no command for it. Set it on the phone under *Manage sensors → Background location*. The card's **Accuracy filter** is separate: it only decides which points the map uses.

**Tip:** the app can also turn high-accuracy mode on by itself when you enter a zone, or when it connects to a Bluetooth device such as a car. Find these options in the same *Background location* screen.

## Google Cloud setup

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/), enable billing, and enable the **Maps JavaScript API**.
2. Create an API key and restrict it:
   - **Application restriction → Websites:**
     - `http://homeassistant.local:8123/*`;
     - your external URL, e.g. `https://your-ha.example.com/*`.
   - **API restriction:** Maps JavaScript API only.
3. Optionally, create a **Map ID** (type JavaScript, vector) to use custom map styles.
4. Set a **budget alert** and a daily quota for map loads.

Google bills Dynamic Maps per *map load*, which happens each time the card creates a map. Position updates do not create new loads. Personal use usually stays well within the monthly free tier, but check the current pricing.

## Development

```bash
npm install
npm test          # GPS filter, stop detection and i18n tests
npm run build     # outputs dist/omnium-enhanced-map-card.js
```

### Quick dev loop

```bash
npm run dev
```

This rebuilds on every change and serves the file at `http://<your-machine-ip>:5180/omnium-enhanced-map-card.js`. Add that URL as a resource on a test dashboard, then refresh HA after each change.

### Adding a language

UI strings live in [`src/i18n.ts`](src/i18n.ts). Add a dictionary of type `Strings` and map its language prefix in `strings()`.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branching model (git flow), the pull request flow and how releases are made.

## License

[MIT](LICENSE)
