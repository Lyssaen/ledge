import { describe, expect, it } from 'vitest';
import { badFolderName, baseName, homeShort, isAbsolutePath, isWindowsPath, joinPath, normalizePath, parentPath, pathCrumbs, pathKey, pathUnder, samePath } from '../src/index.js';

// Native Windows (spec 2026-11-03 §1): a project folder is `C:\Users\po\work`. One module knows both shapes, read from the
// string itself; every POSIX path behaves as before.
describe('paths', () => {
  it('normalizePath windows forms', () => {
    for (const raw of ['C:\\Users\\po\\work', 'C:/Users/po/work/', 'c:\\Users\\po\\\\work\\', ' C:\\Users\\po\\work ']) expect(normalizePath(raw)).toBe('C:\\Users\\po\\work');
    expect(normalizePath('c:')).toBe('C:\\'); expect(normalizePath('C:\\')).toBe('C:\\'); expect(normalizePath('c:/')).toBe('C:\\');
    expect(normalizePath('\\\\nas\\share\\x\\')).toBe('\\\\nas\\share\\x'); expect(normalizePath('//nas/share')).toBe('/nas/share'); expect(normalizePath('\\\\nas/share/')).toBe('\\\\nas\\share');
  });
  it('normalizePath posix unchanged', () => {
    for (const [raw, out] of [['/a//b/', '/a/b'], ['/', '/'], [' /x ', '/x'], ['rel/x/', 'rel/x'], ['//', '/'], ['//home/po/work', '/home/po/work']] as const) expect(normalizePath(raw)).toBe(out);
    expect(isWindowsPath('//home/po')).toBe(false); expect(isWindowsPath('\\\\nas\\share')).toBe(true);
  });
  it('shapes', () => {
    expect(isWindowsPath('C:\\x')).toBe(true); expect(isWindowsPath('c:/x')).toBe(true); expect(isWindowsPath('\\\\nas\\s')).toBe(true);
    expect(isWindowsPath('/home')).toBe(false); expect(isWindowsPath('rel')).toBe(false);
    expect(isAbsolutePath('/x')).toBe(true); expect(isAbsolutePath('C:\\x')).toBe(true); expect(isAbsolutePath('x')).toBe(false); expect(isAbsolutePath('C:x')).toBe(false);
  });
  it('keys: Windows ignores case and separators, POSIX is exact', () => {
    expect(pathKey('C:/Users/PO/work/')).toBe(pathKey('c:\\users\\po\\work'));
    expect(samePath('C:\\Users\\po', 'c:/users/PO')).toBe(true);
    expect(samePath('/home/Po', '/home/po')).toBe(false); expect(samePath('/home/po/', '/home/po')).toBe(true);
  });
  it('under windows', () => {
    expect(pathUnder('C:\\Users\\po\\work\\api', 'c:/users/PO/work')).toBe(true);
    expect(pathUnder('C:\\Users\\po\\workshop', 'C:\\Users\\po\\work')).toBe(false);
    expect(pathUnder('C:\\Users\\po\\work', 'C:\\Users\\po\\work')).toBe(true);
    expect(pathUnder('/home/po/work', 'C:\\Users\\po\\work')).toBe(false);
  });
  it('under windows roots', () => {
    expect(pathUnder('C:\\x\\y', 'C:\\')).toBe(true); expect(pathUnder('D:\\x', 'C:\\')).toBe(false);
    expect(pathUnder('\\\\nas\\share\\a', '\\\\NAS\\share')).toBe(true);
  });
  it('under posix unchanged', () => {
    expect(pathUnder('/w/a', '/w')).toBe(true); expect(pathUnder('/wx', '/w')).toBe(false); expect(pathUnder('/anything', '/')).toBe(true); expect(pathUnder('/W/a', '/w')).toBe(false);
  });
  it('crumbs windows', () => {
    expect(pathCrumbs('C:\\Users\\po')).toEqual([{ label: 'C:', path: 'C:\\' }, { label: 'Users', path: 'C:\\Users' }, { label: 'po', path: 'C:\\Users\\po' }]);
    expect(pathCrumbs('C:\\')).toEqual([{ label: 'C:', path: 'C:\\' }]);
    expect(pathCrumbs('/home/po')).toEqual([{ label: '/', path: '/' }, { label: 'home', path: '/home' }, { label: 'po', path: '/home/po' }]);
    expect(pathCrumbs('/')).toEqual([{ label: '/', path: '/' }]);
  });
  it('join, base, parent per shape', () => {
    expect(joinPath('C:\\Users\\po', 'work')).toBe('C:\\Users\\po\\work'); expect(joinPath('C:\\', 'x')).toBe('C:\\x');
    expect(joinPath('/home', 'po')).toBe('/home/po'); expect(joinPath('/', 'x')).toBe('/x');
    expect(baseName('C:\\Users\\po\\work')).toBe('work'); expect(baseName('C:\\')).toBe('C:\\'); expect(baseName('/w/ledge')).toBe('ledge'); expect(baseName('/w/ledge/')).toBe('ledge'); expect(baseName('/')).toBe('/');
    expect(parentPath('C:\\Users')).toBe('C:\\'); expect(parentPath('C:\\')).toBeNull(); expect(parentPath('/w')).toBe('/'); expect(parentPath('/')).toBeNull(); expect(parentPath('/w/x')).toBe('/w');
  });
  it('baseName of what is not a folder path (a model ~/… path, a relative one): its last segment, as before', () => {
    expect(baseName('~/work/paper')).toBe('paper'); expect(baseName('rel/x/')).toBe('x'); expect(baseName('')).toBe('');
  });
  it('badFolderName per shape', () => {
    for (const n of ['a:b', 'con', 'NUL.txt', 'x.', 'x ', 'a\\b', 'q?', 'Lpt1']) expect(badFolderName(n, 'C:\\w')).toBe(true);
    for (const n of ['a:b', 'con', 'x.']) expect(badFolderName(n, '/w')).toBe(false);
    for (const n of ['', '.', '..', 'a/b', 'a\0b']) { expect(badFolderName(n, '/w')).toBe(true); expect(badFolderName(n, 'C:\\w')).toBe(true); }
    expect(badFolderName('notes', 'C:\\w')).toBe(false); expect(badFolderName('console', 'C:\\w')).toBe(false);
  });
  it('homeShort', () => {
    expect(homeShort('C:\\Users\\po\\work', 'C:\\Users\\po')).toBe('~\\work'); expect(homeShort('c:\\users\\po', 'C:\\Users\\po')).toBe('~');
    expect(homeShort('/home/po/w', '/home/po')).toBe('~/w'); expect(homeShort('/srv', '/home/po')).toBe('/srv'); expect(homeShort('/home/po', '/home/po/')).toBe('~');
    expect(homeShort('/x', undefined)).toBe('/x');
  });
});
