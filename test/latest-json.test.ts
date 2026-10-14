import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ESM script without types
import { latestJson } from '../scripts/latest-json.mjs';

describe('latestJson', () => {
  it('describes the Windows installer of the tag for the Tauri updater', () => {
    expect(latestJson({ tag: 'v0.3.0', notes: '- Une\n- Deux', signature: 'dW50cnVzdGVk...', exeName: 'Ledge_0.3.0_x64-setup.exe', pubDate: '2026-10-20T09:00:00.000Z' })).toEqual({
      version: '0.3.0', notes: '- Une\n- Deux', pub_date: '2026-10-20T09:00:00.000Z',
      platforms: { 'windows-x86_64': { signature: 'dW50cnVzdGVk...', url: 'https://github.com/Lyssaen/ledge/releases/download/v0.3.0/Ledge_0.3.0_x64-setup.exe' } }
    });
  });
  it('refuses a tag that is not a plain version', () => {
    expect(() => latestJson({ tag: 'v0.3', notes: '', signature: 's', exeName: 'x.exe', pubDate: '2026-10-20T09:00:00.000Z' })).toThrow(/MAJOR.MINOR.PATCH/);
  });
  it('builds the url from the exe name it is given (the Desktop asset has dots, not a space)', () => {
    const m = latestJson({ tag: 'v0.5.2', notes: '', signature: 's', exeName: 'Ledge.Desktop_0.5.2_x64-setup.exe', pubDate: '2026-10-20T09:00:00.000Z' });
    expect(m.platforms['windows-x86_64'].url).toBe('https://github.com/Lyssaen/ledge/releases/download/v0.5.2/Ledge.Desktop_0.5.2_x64-setup.exe');
  });
});
