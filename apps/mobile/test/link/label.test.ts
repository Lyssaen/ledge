import { describe, expect, it } from 'vitest';
import { defaultDeviceName, deviceLabel } from '../../src/link/label';

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iPad'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Android'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Appareil'],
    ['', 'Appareil']
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

const IPAD_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

describe('deviceLabel, tablets', () => {
  it('an iPad saying it is a Mac, with a touch screen, is an iPad; a Mac is not', () => {
    expect(deviceLabel(IPAD_MAC, 5)).toBe('iPad');
    expect(deviceLabel(IPAD_MAC, 0)).toBe('Appareil');
  });
  it('an Android without « Mobile » is a tablet', () => {
    expect(deviceLabel(TAB)).toBe('Android tablette');
  });
});

describe('defaultDeviceName', () => {
  it.each([
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 0, 'iPad · Safari'],
    [IPAD_MAC, 5, 'iPad · Safari'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1', 0, 'iPhone · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 0, 'Android · Chrome'],
    [TAB, 0, 'Android · Chrome'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', 0, 'Android · Firefox'],
    ['', 0, 'Appareil']
  ])('%s → %s', (ua, touch, name) => {
    expect(defaultDeviceName(ua, touch)).toBe(name);
  });
});
