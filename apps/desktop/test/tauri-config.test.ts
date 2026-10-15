import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(__dirname, '..');
const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const caps = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8'));
const island = JSON.parse(readFileSync(resolve(root, '../overlay/src-tauri/tauri.conf.json'), 'utf8'));
const main = readFileSync(resolve(root, 'src-tauri/src/main.rs'), 'utf8');

describe('Desktop Tauri config', () => {
  it('is its own app, versioned with the island', () => {
    expect(conf.identifier).toBe('be.paradow.ledge.desktop'); expect(conf.productName).toBe('Ledge Desktop');
    expect(conf.version).toBe(island.version);
    expect(conf.build.devUrl).toBe('http://localhost:1421');
  });
  it('has one decorated, resizable main window remembering its state', () => {
    const w = conf.app.windows[0];
    expect(w).toMatchObject({ label: 'main', decorations: true, resizable: true, width: 1280, height: 800, minWidth: 640, minHeight: 480 });
    expect(w.transparent).not.toBe(true); expect(w.alwaysOnTop).not.toBe(true);
    expect(caps.permissions).toContain('window-state:default');
    expect(main).toContain('tauri_plugin_window_state::Builder');
  });
  it('starts hidden and shows itself after the window state is restored, unless launched minimized', () => {
    expect(conf.app.windows[0].visible).toBe(false);
    expect(main).toContain('const MINIMIZED: &str = "--minimized";');
    expect(main).toContain('tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED]))');
    expect(main.slice(main.indexOf('.setup('))).toMatch(/if !launched_minimized\(std::env::args\(\)\) \{ show_main\(app\.handle\(\)\); \}/);
    // the restored state must not show the window itself: the launch decides
    expect(main).toContain('with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)');
  });
  it('runs a single instance: a second launch shows the first one, the plugin registered first', () => {
    const builder = main.slice(main.indexOf('tauri::Builder::default()'));
    expect(builder.indexOf('.plugin(')).toBe(builder.indexOf('.plugin(tauri_plugin_single_instance::init('));
    expect(builder).toMatch(/tauri_plugin_single_instance::init\(\|app, _args, _cwd\| show_main\(app\)\)/);
    expect(readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8')).toMatch(/^tauri-plugin-single-instance = "2"$/m);
  });
  it('shares the island CSP and the updater key, with its own manifest', () => {
    expect(conf.app.security.csp).toBe(island.app.security.csp);
    expect(conf.plugins.updater.pubkey).toBe(island.plugins.updater.pubkey);
    expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/Lyssaen/ledge/releases/latest/download/latest-desktop.json']);
    expect(conf.plugins.updater.windows.installMode).toBe('passive');
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(caps.permissions).toContain('updater:default'); expect(caps.permissions).toContain('process:allow-restart');
    expect(main).toContain('tauri_plugin_updater::Builder::new().build()'); expect(main).toContain('tauri_plugin_process::init()');
  });
  it('shows toasts, zooms the WebView, and keeps the window hidden for Do not disturb (spec §9.4, §10)', () => {
    expect(caps.permissions).toContain('notification:default');
    expect(caps.permissions).toContain('core:webview:allow-set-webview-zoom');
    expect(main).toContain('.plugin(tauri_plugin_notification::init())');
    expect(main).toContain('if tray_shows_window(id) { show_main(app); }');
  });
});
