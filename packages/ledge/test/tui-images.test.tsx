import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ClientMessage } from '@ledge/protocol';
import type { ClipboardImage } from '../src/tui/clipboard.js';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const ALT_V = '\u001bv';
const ALT_O = '\u001bo';
const BACKSPACE = '\u007f';
const T = (s: number) => new Date(Date.parse('2026-10-09T18:00:00.000Z') + s * 1000).toISOString();

const pasted = (data = 'cGl4ZWxz'): ClipboardImage => ({ image: { mime: 'image/jpeg', data }, width: 1440, height: 900, bytes: 6 });
/** Bix is idle and replyable: chosen in the home, ↵ opens it. */
const openBix = async (tui: Awaited<ReturnType<typeof startTui>>) => {
  await tui.pick('Bix');
  await tui.press('\r');
  await until(() => tui.frame().includes('Rien encore') || tui.frame().includes('Regarde'));
};

describe('ledge tui: images in a session reply', () => {
  it('Alt+V shows a chip, stores the image on the session, and ↵ sends the reply with its id alone', async () => {
    const tui = await startTui({ readImage: async () => pasted() });
    tui.daemon.thread('bix', []);
    try {
      await openBix(tui);
      await tui.press('r');
      await tui.press(ALT_V);
      await until(() => sent(tui.daemon.received, 'attachment.put').length === 1);
      expect(sent(tui.daemon.received, 'attachment.put')[0]).toMatchObject({ id: 'bix', image: { mime: 'image/jpeg', data: 'cGl4ZWxz' } });
      await until(() => tui.frame().includes('▣ capture 1440×900 ✕'));
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      const [id] = [...tui.attachments.keys()];
      expect(sent(tui.daemon.received, 'session.reply')[0]).toEqual({ type: 'session.reply', id: 'bix', text: '', attachments: [id] });
    } finally { await tui.cleanup(); }
  });

  it('Backspace on an empty field removes the last chip', async () => {
    const tui = await startTui({ readImage: async () => pasted() });
    tui.daemon.thread('bix', []);
    try {
      await openBix(tui);
      await tui.press('r');
      await tui.press(ALT_V);
      await until(() => tui.frame().includes('▣ capture 1440×900 ✕'));
      await tui.press(BACKSPACE);
      await until(() => !tui.frame().includes('▣ capture 1440×900'));
    } finally { await tui.cleanup(); }
  });

  it('a refused image shows its reason and keeps the send blocked', async () => {
    const tui = await startTui({ readImage: async () => pasted(), refusePut: 'too_large' });
    tui.daemon.thread('bix', []);
    try {
      await openBix(tui);
      await tui.press('r');
      await tui.press(ALT_V);
      await until(() => tui.frame().includes('Image trop lourde, même réduite'));
      await tui.press('\r');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'session.reply')).toHaveLength(0);
    } finally { await tui.cleanup(); }
  });

  it('an image over the local cap is a red chip and is never sent', async () => {
    const tui = await startTui({ readImage: async () => ({ ...pasted(), bytes: 2_000_001 }) });
    tui.daemon.thread('bix', []);
    try {
      await openBix(tui);
      await tui.press('r');
      await tui.press(ALT_V);
      await until(() => tui.frame().includes('Image trop lourde, même réduite'));
      expect(sent(tui.daemon.received, 'attachment.put')).toHaveLength(0);
    } finally { await tui.cleanup(); }
  });

  it('no clipboard image says so', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', []);
    try {
      await openBix(tui);
      await tui.press('r');
      await tui.press(ALT_V);
      await until(() => tui.frame().includes("Pas d'image dans le presse-papiers"));
    } finally { await tui.cleanup(); }
  });

  it('o opens the newest image of the exchange: its bytes are fetched into a file handed to the viewer', async () => {
    const opened: Array<{ file: string; bytes: Buffer }> = [];
    const tui = await startTui({ openFile: async file => { opened.push({ file, bytes: readFileSync(file) }); } });
    const id = 'd'.repeat(64);
    const data = Buffer.from('fake png bytes').toString('base64');
    tui.attachments.set(id, { mime: 'image/png', data });
    tui.daemon.thread('bix', [{ kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Regarde', images: [{ id, mime: 'image/png', width: 1440, height: 900, bytes: 212_000, preview: false }] }]);
    try {
      await openBix(tui);
      await until(() => tui.frame().includes('▣ capture 1440×900 · 212 Ko · o ouvrir dans la visionneuse'));
      await tui.press('o');
      await until(() => opened.length === 1);
      expect(opened[0]!.file).toContain(`ledge-images/${id}.png`);
      expect(opened[0]!.bytes.toString()).toBe('fake png bytes');
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: images in Ask', () => {
  it('Alt+V then ↵ sends the chat question with the image inline', async () => {
    const tui = await startTui({ readImage: async () => pasted() });
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press(ALT_V);
      await until(() => tui.frame().includes('▣ capture 1440×900 ✕'));
      await tui.press('Et ça ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      expect(sent(tui.daemon.received, 'chat.ask')[0]).toMatchObject({ text: 'Et ça ?', images: [{ mime: 'image/jpeg', data: 'cGl4ZWxz' }] });
      expect(sent(tui.daemon.received, 'attachment.put')).toHaveLength(0);
    } finally { await tui.cleanup(); }
  });

  it('no clipboard image says so', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press(ALT_V);
      await until(() => tui.frame().includes("Pas d'image dans le presse-papiers"));
    } finally { await tui.cleanup(); }
  });

  it('Alt+O opens the newest image of the conversation', async () => {
    const opened: Buffer[] = [];
    const tui = await startTui({ openFile: async file => { opened.push(readFileSync(file)); } });
    const id = 'e'.repeat(64);
    tui.attachments.set(id, { mime: 'image/jpeg', data: Buffer.from('jpeg bytes').toString('base64') });
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      tui.daemon.push({ type: 'chat.history', turns: [{ qid: 'q1', question: 'Regarde', askedAt: new Date().toISOString(), answeredAt: new Date().toISOString(), answer: 'Vu.', steps: [], attachments: [{ id, mime: 'image/jpeg', width: 800, height: 600, bytes: 90_000, preview: false }] }] });
      await until(() => tui.frame().includes('▣ capture 800×600'));
      await tui.press(ALT_O);
      await until(() => opened.length === 1);
      expect(opened[0]!.toString()).toBe('jpeg bytes');
    } finally { await tui.cleanup(); }
  });
  it('Alt+O starts again at the newest image when a new turn arrives', async () => {
    const opened: string[] = [];
    const tui = await startTui({ openFile: async file => { opened.push(readFileSync(file).toString()); } });
    const [a, b] = ['a'.repeat(64), 'b'.repeat(64)];
    tui.attachments.set(a, { mime: 'image/jpeg', data: Buffer.from('first').toString('base64') });
    tui.attachments.set(b, { mime: 'image/jpeg', data: Buffer.from('second').toString('base64') });
    const turn = (qid: string, id: string) => ({ qid, question: 'Regarde', askedAt: new Date().toISOString(), answeredAt: new Date().toISOString(), answer: 'Vu.', steps: [], attachments: [{ id, mime: 'image/jpeg' as const, width: 800, height: 600, bytes: 90_000, preview: false }] });
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      tui.daemon.push({ type: 'chat.history', turns: [turn('q1', a)] });
      await until(() => tui.frame().includes('▣ capture 800×600'));
      await tui.press(ALT_O);
      await until(() => opened.length === 1);
      tui.daemon.push({ type: 'chat.history', turns: [turn('q1', a), turn('q2', b)] });
      await until(() => tui.frame().split('▣ capture 800×600').length === 3);
      await tui.press(ALT_O);
      await until(() => opened.length === 2);
      expect(opened).toEqual(['first', 'second']);
    } finally { await tui.cleanup(); }
  });

  it('a second Alt+V while the clipboard is being read is ignored', async () => {
    let reads = 0;
    const tui = await startTui({ readImage: async () => { reads++; await new Promise(r => setTimeout(r, 300)); return pasted(); } });
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press(ALT_V);
      await tui.press(ALT_V);
      await until(() => tui.frame().includes('▣ capture 1440×900 ✕'));
      await new Promise(r => setTimeout(r, 400));
      expect(reads).toBe(1);
      expect(tui.frame().split('▣ capture').length).toBe(2);
    } finally { await tui.cleanup(); }
  });

  it('refuses the chip that would push the question past the frame budget', async () => {
    const tui = await startTui({ readImage: async () => pasted('A'.repeat(1_500_000)) });
    try {
      // Three chips and the reason on the one line the field's chips have, beside the home's left column and Ledge's rail.
      await tui.resize(200, 24);
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      for (let n = 1; n <= 3; n++) { await tui.press(ALT_V); await until(() => tui.frame().split('▣ capture').length - 1 === n); }
      expect(tui.frame()).toContain('Image trop lourde, même réduite');
      expect(tui.frame().split('Image trop lourde').length - 1).toBe(1);
    } finally { await tui.cleanup(); }
  });

  it('the chips of a refused question come back', async () => {
    const tui = await startTui({ readImage: async () => pasted() });
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press(ALT_V);
      await until(() => tui.frame().includes('▣ capture 1440×900 ✕'));
      await tui.press('Et ça ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      await until(() => !tui.frame().includes('▣ capture 1440×900'));
      tui.daemon.push({ type: 'chat.error', qid: sent(tui.daemon.received, 'chat.ask')[0]!.qid, message: 'refused' });
      await until(() => tui.frame().includes('▣ capture 1440×900 ✕'));
    } finally { await tui.cleanup(); }
  });
});
