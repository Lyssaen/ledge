import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage } from '@ledge/protocol';
import { setCodecForTests } from '@ledge/ui/images';
import { boot, closeDaemons, PROJECTS } from './helpers';

beforeEach(() => {
  localStorage.clear();
  setCodecForTests({ async decode() { return { width: 800, height: 600, async draw() { return { async encode(mime: 'image/webp' | 'image/jpeg') { return new Blob([new Uint8Array(1000)], { type: mime }); } }; } }; } });
});
afterEach(async () => { setCodecForTests(null); cleanup(); await closeDaemons(); });

const asks = (d: { received: ClientMessage[] }) => d.received.filter((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask');
const chips = () => [...document.querySelectorAll('[data-chip]')];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
async function openHome() {
  const env = await boot({ home: true, machines: [{ id: 'local', label: 'Local' }], projects: PROJECTS, sessions: [fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })] });
  await screen.findByRole('region', { name: 'The point' });
  const field = home().getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.paste(field, { clipboardData: { files: [new File([new Uint8Array(8)], 's.png', { type: 'image/png' })], items: [], types: ['Files'], getData: () => '' } });
  await waitFor(() => expect(chips()).toHaveLength(1));
  return env;
}

describe('images in Ledge’s chat', () => {
  it('the composer’s Send carries the chips as images, then clears them', async () => {
    const { d, user } = await openHome();
    await user.click(home().getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    expect(asks(d)[0]).toMatchObject({ text: '', images: [{ mime: 'image/webp' }] });
    expect(chips()).toHaveLength(0);
  });
  it('« Summarise the day » sends no image and leaves the chip', async () => {
    const { d, user } = await openHome();
    await user.click(screen.getByRole('button', { name: 'Summarise the day' }));
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    expect(asks(d)[0]).not.toHaveProperty('images');
    expect(chips()).toHaveLength(1);
  });
});
