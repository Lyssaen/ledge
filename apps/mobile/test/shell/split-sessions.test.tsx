// Sessions' two panes on a tablet name their tab, so that upright styles.css gives the detail the board's 18 px margins
// (t-tablette.html §2; review-qa 6873dfab): the list's empty pane, the thread, « Nouvelle session » and the terminal.
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { forgetTabs } from '../../src/shell/tabs';
import { forgetLedgePane } from '../../src/state/ledgePane';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { meStub } from '../screens/app-setup';
import { setup } from '../screens/setup';

const before = globalThis.matchMedia;
afterEach(() => { globalThis.matchMedia = before; forgetLedgePane(); forgetTabs(); });

function upright(hash: string) {
  globalThis.history.replaceState(null, '', `/${hash}`);
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'WSL', undefined, { confirm: true }));
  globalThis.matchMedia = ((q: string) => ({ matches: q.includes('min-width: 768px') && !q.includes('landscape'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
  render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
  return document.querySelector('.split');
}

describe('Sessions on a tablet', () => {
  it.each(['#/sessions', '#/thread/a', '#/new', '#/terminal/a'])('%s names its tab on the panes', hash => {
    expect(upright(hash)?.getAttribute('data-split')).toBe('sessions');
  });

  it('the Rigs tab keeps the common panes', () => {
    expect(upright('#/rigs')?.getAttribute('data-split')).toBeNull();
  });
});
