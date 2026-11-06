/** Pseudo-terminals: Tauri's when the page runs in the POC app, a fake one in a plain browser (a quick check of the
 *  layout and the measuring code, never a result). */
export interface Pty { write(data: string): void; resize(cols: number, rows: number): void; close(): void }
export type Kind = 'flood' | 'steady' | 'shell';

export const inTauri = (): boolean => '__TAURI_INTERNALS__' in window;

/** What each kind runs on Windows. flood: as fast as it can print; steady: an agent-like pace; shell: an idle cmd. */
const PROGRAMS: Record<Kind, { program: string; args: string[] }> = {
  flood: { program: 'powershell.exe', args: ['-NoProfile', '-Command', "$i=0; while($true){ $i++; Write-Output (\"$i \" + ('lorem ipsum dolor sit amet ' * 4)) }"] },
  steady: { program: 'powershell.exe', args: ['-NoProfile', '-Command', "$i=0; while($true){ $i++; Write-Output (\"[$i] \" + (Get-Date -Format o) + ' Read apps/desktop/src/App.tsx · Edit +12 -3'); Start-Sleep -Milliseconds 15 }"] },
  shell: { program: 'cmd.exe', args: [] },
};

export async function openPty(kind: Kind, cols: number, rows: number, onData: (d: Uint8Array) => void): Promise<Pty> {
  if (!inTauri()) return fakePty(kind, onData);
  const { invoke, Channel } = await import('@tauri-apps/api/core');
  const data = new Channel<ArrayBuffer>();
  data.onmessage = buf => onData(new Uint8Array(buf));
  const exit = new Channel<number | null>();
  const { program, args } = PROGRAMS[kind];
  const id = await invoke<number>('pty_open', { program, args, cols, rows, onData: data, onExit: exit });
  return {
    write: d => { void invoke('pty_write', { id, data: d }); },
    resize: (c, r) => { void invoke('pty_resize', { id, cols: c, rows: r }); },
    close: () => { void invoke('pty_close', { id }); },
  };
}

function fakePty(kind: Kind, onData: (d: Uint8Array) => void): Pty {
  const enc = new TextEncoder();
  let n = 0, timer: number | undefined;
  if (kind === 'flood') timer = window.setInterval(() => { let s = ''; for (let i = 0; i < 40; i++) s += `${++n} lorem ipsum dolor sit amet lorem ipsum dolor sit amet\r\n`; onData(enc.encode(s)); }, 4);
  if (kind === 'steady') timer = window.setInterval(() => onData(enc.encode(`[${++n}] ${new Date().toISOString()} Read apps/desktop/src/App.tsx\r\n`)), 15);
  if (kind === 'shell') setTimeout(() => onData(enc.encode('C:\\Users\\poc>')), 10);
  return { write: d => setTimeout(() => onData(enc.encode(d === '\x7f' || d === '\b' ? '\b \b' : d)), 1), resize: () => {}, close: () => clearInterval(timer) };
}
