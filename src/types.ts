export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export interface Hass {
  states: Record<string, HassEntity>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  language?: string;
  locale?: { language: string };
  themes?: { darkMode?: boolean };
  config?: { latitude: number; longitude: number };
  /** frontend copies of the entity and device registries (HA 2023.3+) */
  entities?: Record<string, { device_id?: string | null }>;
  devices?: Record<string, { manufacturer?: string | null; model?: string | null }>;
}

export interface EntityConfig {
  entity: string;
  name?: string;
  color?: string;
  /** high-accuracy GPS button for this person's phone (shown while the person is selected) */
  gps_button?: {
    /** companion app notify service, e.g. notify.mobile_app_my_phone */
    notify: string;
    /** the app's "High accuracy mode" binary_sensor (optional; without it the state is unknown) */
    entity?: string;
    /** use force_on/force_off, which override the constraints configured in the app */
    force?: boolean;
  };
}

export interface CardConfig {
  type: string;
  api_key: string;
  /** Google Cloud Map ID (for custom styles; defaults to DEMO_MAP_ID) */
  map_id?: string;
  entities: (string | EntityConfig)[];
  hours_to_show?: number;
  max_accuracy?: number;
  stop_radius?: number;
  stop_minutes?: number;
  height?: string;
  gesture_handling?: 'greedy' | 'cooperative' | 'auto' | 'none';
  /** icon-only buttons in the card toolbar */
  buttons?: ToolbarButton[];
  /**
   * Draw trips along the streets with OSRM map matching, called through a Home Assistant action that
   * returns the OSRM response (see README). `true` uses `rest_command.osrm_match`.
   */
  snap_to_roads?: boolean | { service?: string; radius?: number };
}

export interface ToolbarButton {
  icon: string;
  /** icon while `entity` is off */
  icon_off?: string;
  /** tooltip text */
  name?: string;
  /** action as domain.service, e.g. notify.mobile_app_x */
  action: string;
  /** action data (plain button) */
  data?: Record<string, unknown>;
  /** toggle button: entity that tells whether it is on (state "on") */
  entity?: string;
  data_on?: Record<string, unknown>;
  data_off?: Record<string, unknown>;
}
