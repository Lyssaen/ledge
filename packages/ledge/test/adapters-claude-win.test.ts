import { afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Captured on Windows through ConPTY (spike). The adapter reads the platform when it loads: this file loads it as on
// Windows, where Claude Code draws its cursor and input prompt as '>' (on Linux only '❯' is the cursor).
const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
Object.defineProperty(process, 'platform', { value: 'win32' });
afterAll(() => { Object.defineProperty(process, 'platform', real); });
const { claudeAdapter } = await import('../src/adapters/claude.js');
const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');

describe('claude adapter on Windows glyphs', () => {
  it('detects the workspace trust dialog with a > cursor', () => {
    expect(claudeAdapter.detectPrompt(fx('win-claude-trust'))).toEqual({
      kind: 'permission', text: 'Trust this folder? C:\\Users\\guill\\AppData\\Local\\Temp\\ledge-spike\\work', options: ['No, exit', 'Yes, I trust this folder']
    });
    const p = { kind: 'permission' as const, text: 'Trust this folder?', source: 'pane' as const };
    expect(claudeAdapter.keysFor('accept', p, fx('win-claude-trust'))).toEqual([{ keys: ['Down', 'Enter'] }]);
  });
  it('sees the > input box at rest, no dialog, and the box out of the preview', () => {
    expect(claudeAdapter.detectPrompt(fx('win-claude-idle'))).toBeNull();
    expect(claudeAdapter.atRest!(fx('win-claude-idle'))).toBe(true);
    expect(claudeAdapter.previewLines!(fx('win-claude-idle')).some(l => l.startsWith('> '))).toBe(false);
  });
});
describe('claude adapter on a Windows file-creation dialog', () => {
  it('reads it once the rows ConPTY flagged as wrapped stay apart', () => {
    expect(claudeAdapter.detectPrompt(fx('win-claude-create'))).toMatchObject({ kind: 'permission', text: 'Create file probe.txt' });
  });
});
