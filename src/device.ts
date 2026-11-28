import type { Hass } from './types';

/**
 * Whether the phone behind these entities is an Apple device. The first entity linked to a device
 * decides. High-accuracy mode is an Android companion-app feature, so the card hides its controls
 * for Apple phones.
 */
export function isApplePhone(hass: Hass | undefined, entityIds: (string | undefined)[]): boolean {
  for (const id of entityIds) {
    const deviceId = id ? hass?.entities?.[id]?.device_id : undefined;
    const device = deviceId ? hass?.devices?.[deviceId] : undefined;
    if (device) return device.manufacturer === 'Apple' || /^i(Phone|Pad)/.test(device.model ?? '');
  }
  return false;
}
