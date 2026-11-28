import { describe, expect, it } from 'vitest';
import { isApplePhone } from '../src/device';
import type { Hass } from '../src/types';

const hass = {
  states: {},
  callWS: async () => ({}) as never,
  callService: async () => undefined,
  entities: {
    'binary_sensor.pixel_high_accuracy_mode': { device_id: 'pixel' },
    'device_tracker.pixel': { device_id: 'pixel' },
    'device_tracker.iphone': { device_id: 'iphone' },
    'device_tracker.ipad_no_maker': { device_id: 'ipad' },
    'device_tracker.gps_logger': { device_id: null },
  },
  devices: {
    pixel: { manufacturer: 'Google', model: 'Pixel 9' },
    iphone: { manufacturer: 'Apple', model: 'iPhone16,2' },
    ipad: { manufacturer: null, model: 'iPad14,1' },
  },
} as unknown as Hass;

describe('isApplePhone', () => {
  it('recognizes Apple devices by manufacturer or model', () => {
    expect(isApplePhone(hass, ['device_tracker.iphone'])).toBe(true);
    expect(isApplePhone(hass, ['device_tracker.ipad_no_maker'])).toBe(true);
    expect(isApplePhone(hass, ['device_tracker.pixel'])).toBe(false);
  });

  it('uses the first entity that has a device', () => {
    expect(isApplePhone(hass, [undefined, 'device_tracker.gps_logger', 'person.x', 'device_tracker.iphone'])).toBe(true);
    expect(isApplePhone(hass, ['binary_sensor.pixel_high_accuracy_mode', 'device_tracker.iphone'])).toBe(false);
  });

  it('is false when nothing is known', () => {
    expect(isApplePhone(hass, ['person.nobody'])).toBe(false);
    expect(isApplePhone(undefined, ['device_tracker.iphone'])).toBe(false);
  });
});
