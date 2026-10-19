import { beforeEach, describe, expect, it } from 'vitest';
import { installedNotes, keepNotes, releaseUrl, RELEASES_URL, skipsVersions, takeWhatsNew } from '../src/update/notes';

beforeEach(() => localStorage.clear());

describe('release notes kept across the update (#26)', () => {
  it('the notes kept at install are the installed version’s, and only its', () => {
    keepNotes('0.9.0', '## Nouveautés\n- Atelier');
    expect(installedNotes('0.9.0')).toBe('## Nouveautés\n- Atelier');
    expect(installedNotes('0.9.1')).toBeNull();
    expect(installedNotes(null)).toBeNull();
  });

  it('empty notes (the dry run) are never kept', () => {
    keepNotes('0.9.0', '  \n');
    expect(installedNotes('0.9.0')).toBeNull();
  });

  it('the first launch on a new version shows its notes once', () => {
    localStorage.setItem('desktop.update.seen', '0.8.1');
    localStorage.setItem('desktop.update.from', '0.8.1');
    keepNotes('0.9.0', '- Atelier détachable');
    expect(takeWhatsNew('0.9.0')).toEqual({ version: '0.9.0', notes: '- Atelier détachable', from: '0.8.1', skipped: false });
    expect(takeWhatsNew('0.9.0')).toBeNull();
    expect(localStorage.getItem('desktop.update.seen')).toBe('0.9.0');
  });

  it('a first install shows nothing, it only remembers the version', () => {
    keepNotes('0.9.0', '- Atelier');
    expect(takeWhatsNew('0.9.0')).toBeNull();
    expect(localStorage.getItem('desktop.update.seen')).toBe('0.9.0');
  });

  it('an update from a version that did not remember what it saw still counts (the `from` noted at install)', () => {
    localStorage.setItem('desktop.update.from', '0.7.0');
    keepNotes('0.9.0', '- Atelier');
    expect(takeWhatsNew('0.9.0')).toEqual({ version: '0.9.0', notes: '- Atelier', from: '0.7.0', skipped: true });
  });

  it('a new version without notes shows nothing, and is still seen', () => {
    localStorage.setItem('desktop.update.seen', '0.8.1');
    expect(takeWhatsNew('0.9.0')).toBeNull();
    expect(localStorage.getItem('desktop.update.seen')).toBe('0.9.0');
  });

  it('an unknown version (browser, tests) shows nothing and remembers nothing', () => {
    expect(takeWhatsNew(null)).toBeNull();
    expect(localStorage.getItem('desktop.update.seen')).toBeNull();
  });
});

describe('skipped versions', () => {
  it.each([
    ['0.8.1', '0.8.2', false], ['0.8.1', '0.9.0', false], ['0.9.3', '1.0.0', false],
    ['0.8.1', '0.8.3', true], ['0.7.0', '0.9.0', true], ['0.8.0', '0.9.1', true], ['0.9.0', '1.1.0', true], ['0.9.0', '2.0.0', true]
  ])('%s → %s skips: %s', (from, to, skipped) => expect(skipsVersions(from, to)).toBe(skipped));

  it('an unreadable version skips nothing', () => expect(skipsVersions('dev', '0.9.0')).toBe(false));
});

it('the release links', () => {
  expect(RELEASES_URL).toBe('https://github.com/Lyssaen/ledge/releases');
  expect(releaseUrl('0.9.0')).toBe('https://github.com/Lyssaen/ledge/releases/tag/v0.9.0');
});
