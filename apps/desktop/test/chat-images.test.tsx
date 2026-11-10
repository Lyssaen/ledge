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
/** The IDE's right panel: Ledge's chat. */
const home = () => within(screen.getByRole('complementary', { name: 'Chat Ledge' }));
async function openHome() {
  const env = await boot({ machines: [{ id: 'local', label: 'Local' }], projects: PROJECTS, sessions: [fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })] });
  const field = await home().findByRole('textbox', { name: 'Ask Ledge' });
  await waitFor(() => expect(field).toBeEnabled());
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
    // « Summarise the day » is on the page « For you » (lot 12): its question goes to the right panel's chat.
    await user.click(within(screen.getByRole('navigation', { name: 'Activity bar' })).getByRole('button', { name: /^For you/ }));
    await user.click(await screen.findByRole('button', { name: 'Page' }));
    await user.click(await screen.findByRole('button', { name: 'Summarise the day' }));
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    expect(asks(d)[0]).not.toHaveProperty('images');
    expect(chips()).toHaveLength(1);
  });
});
