import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(__dirname, '..');
const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const caps = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8'));
const notchCaps = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/notch.json'), 'utf8'));
const atelierCaps = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/atelier.json'), 'utf8'));
const version = (pkg: string) => JSON.parse(readFileSync(resolve(root, pkg, 'package.json'), 'utf8')).version;
const main = readFileSync(resolve(root, 'src-tauri/src/main.rs'), 'utf8');
/** The commands in `generate_handler![…]`, whatever its line breaks (`notch::set_frame` reads `set_frame`). */
const commands = (main.match(/generate_handler!\[([^\]]*)\]/)?.[1] ?? '').split(',').map((c) => c.trim().split('::').pop()).filter(Boolean);

describe('Desktop Tauri config', () => {
  it('is its own app, versioned with its package and the notch\'s web app it carries', () => {
    expect(conf.identifier).toBe('be.paradow.ledge.desktop'); expect(conf.productName).toBe('Ledge Desktop');
    expect(conf.version).toBe(version('.'));
    expect(conf.version).toBe(version('../overlay'));
    expect(conf.build.devUrl).toBe('http://localhost:1421');
  });
  it('has one undecorated (the title bar is home-made), resizable main window remembering its state', () => {
    const w = conf.app.windows[0];
    expect(w).toMatchObject({ label: 'main', decorations: false, resizable: true, width: 1280, height: 800, minWidth: 640, minHeight: 480 });
    expect(w.transparent).not.toBe(true); expect(w.alwaysOnTop).not.toBe(true);
    expect(caps.permissions).toContain('window-state:default');
    expect(main).toContain('tauri_plugin_window_state::Builder');
  });
  it('lets the home-made title bar drag, minimise, maximise and close the window', () => {
    for (const p of ['minimize', 'toggle-maximize', 'close', 'start-dragging', 'is-maximized']) expect(caps.permissions).toContain(`core:window:allow-${p}`);
  });
  it('starts hidden and shows itself after the window state is restored, unless launched minimized', () => {
    expect(conf.app.windows[0].visible).toBe(false);
    expect(main).toContain('const MINIMIZED: &str = "--minimized";');
    expect(main).toContain('tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED]))');
    expect(main.slice(main.indexOf('.setup('))).toMatch(/if !launched_minimized\(std::env::args\(\)\) \{ show_main\(app\.handle\(\)\); \}/);
    // the restored state must not show the window itself: the launch decides
    expect(main).toContain('with_state_flags(StateFlags::all() & !(StateFlags::VISIBLE | StateFlags::DECORATIONS))');
  });
  it('lets sound cues play before any click, in both windows (WebView2 defaults kept)', () => {
    const args: string = conf.app.windows[0].additionalBrowserArgs;
    // one WebView2 environment serves both windows: their flags must match, or the notch window fails to open
    expect(conf.app.windows.find((w: { label: string }) => w.label === 'notch').additionalBrowserArgs).toBe(args);
    expect(args).toContain('--autoplay-policy=no-user-gesture-required');
    // setting the property replaces wry's defaults: they must be repeated
    expect(args).toContain('--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection');
  });
  it('runs a single instance: a second launch shows the first one and hands it the island\'s --open target, the plugin registered first', () => {
    const builder = main.slice(main.indexOf('tauri::Builder::default()'));
    expect(builder.indexOf('.plugin(')).toBe(builder.indexOf('.plugin(tauri_plugin_single_instance::init('));
    expect(builder).toMatch(/tauri_plugin_single_instance::init\(\|app, args, _cwd\| \{\s*show_main\(app\);\s*if let Some\(target\) = ledge_native::desktop::open_target\(args\) \{ deliver_open\(app, target\); \}/);
    expect(commands).toContain('take_open_target');
    expect(readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8')).toMatch(/^tauri-plugin-single-instance = "2"$/m);
  });
  it('reaches only the daemon and the fonts, and updates from its own manifest, signed with our key', () => {
    expect(conf.app.security.csp).toBe("default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src ipc: http://ipc.localhost ws://127.0.0.1:47831");
    expect(Buffer.from(conf.plugins.updater.pubkey, 'base64').toString()).toMatch(/^untrusted comment: minisign public key: 763CCCF3D01336AD\n/);
    expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/Lyssaen/ledge/releases/latest/download/latest-desktop.json']);
    expect(conf.plugins.updater.windows.installMode).toBe('passive');
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(caps.permissions).toContain('updater:default'); expect(caps.permissions).toContain('process:allow-restart');
    expect(main).toContain('tauri_plugin_updater::Builder::new().build()'); expect(main).toContain('tauri_plugin_process::init()');
  });
  it('declares the notch window: borderless, transparent, on top, off the taskbar, never focused', () => {
    const w = conf.app.windows.find((x: { label: string }) => x.label === 'notch');
    expect(w).toMatchObject({ url: 'notch/index.html', transparent: true, decorations: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, focus: false, shadow: false });
  });
  it('gives the notch its own capability: shortcut, exit, monitor and events, and no updater', () => {
    expect(notchCaps.windows).toEqual(['notch']);
    for (const p of ['global-shortcut:allow-register', 'global-shortcut:allow-unregister', 'process:allow-exit', 'core:window:allow-primary-monitor', 'core:event:allow-listen']) expect(notchCaps.permissions).toContain(p);
    expect(notchCaps.permissions).not.toContain('updater:default');
  });
  it('registers the notch\'s commands beside its own', () => {
    for (const c of ['set_frame', 'set_hot_zone', 'set_outside_watch', 'focus_overlay', 'release_focus', 'list_monitors', 'set_monitor', 'open_in_ledge']) expect(commands).toContain(c);
  });
  it('declares the detached Atelier (#21): made on demand, decorated, hidden until its saved place is restored, with the same WebView2 flags', () => {
    const w = conf.app.windows.find((x: { label: string }) => x.label === 'atelier');
    expect(w).toMatchObject({ create: false, decorations: true, resizable: true, visible: false, dragDropEnabled: false });
    expect(w.additionalBrowserArgs).toBe(conf.app.windows[0].additionalBrowserArgs);
    expect(w.url).toBeUndefined();
    expect(w.alwaysOnTop).not.toBe(true); expect(w.skipTaskbar).not.toBe(true);
    // made from its declaration, in an async command (a window made in a sync command deadlocks on Windows)
    expect(commands).toContain('open_atelier');
    expect(main).toMatch(/async fn open_atelier\(app: AppHandle\)/);
    expect(main).toContain('WebviewWindowBuilder::from_config(&app, &config)');
    // remembered by the window-state plugin: only the notch is denied
    expect(main).toContain('.with_denylist(&[notch::NOTCH])');
  });
  it('gives the detached Atelier its own capability: events, focus, close and zoom; no updater, no notch', () => {
    expect(atelierCaps.windows).toEqual(['atelier']);
    for (const p of ['core:default', 'core:event:allow-listen', 'core:event:allow-unlisten', 'core:event:allow-emit-to', 'core:window:allow-close', 'core:window:allow-destroy', 'core:window:allow-set-focus', 'core:webview:allow-set-webview-zoom']) expect(atelierCaps.permissions).toContain(p);
    for (const p of ['updater:default', 'process:allow-restart', 'global-shortcut:allow-register']) expect(atelierCaps.permissions).not.toContain(p);
    // the main window comes forward when the Atelier opens a session there
    expect(caps.permissions).toContain('core:window:allow-unminimize');
  });
  it('lets HTML5 drag and drop reach the page (native file drop off, or WebView2 swallows dragover/drop)', () => {
    expect(conf.app.windows[0].dragDropEnabled).toBe(false);
  });
  it('may switch the window to full screen and ask whether it is', () => {
    expect(caps.permissions).toContain('core:window:allow-set-fullscreen');
    expect(caps.permissions).toContain('core:window:allow-is-fullscreen');
  });
  it('may unmaximise the window before full screen and maximise it back after (#18)', () => {
    for (const p of ['unmaximize', 'maximize']) expect(caps.permissions).toContain(`core:window:allow-${p}`);
  });
  it('shows toasts, zooms the WebView, and keeps the window hidden for Do not disturb (spec §9.4, §10)', () => {
    expect(caps.permissions).toContain('notification:default');
    expect(caps.permissions).toContain('core:webview:allow-set-webview-zoom');
    expect(main).toContain('.plugin(tauri_plugin_notification::init())');
    expect(main).toContain('if tray_shows_window(id) { show_main(app); }');
  });
});
