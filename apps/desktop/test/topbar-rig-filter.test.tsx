import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PROJECT_COLORS, type Rig } from '@ledge/protocol';
import { rigColor } from '@ledge/ui/rigs/model';
import { LangProvider } from '../src/i18n/lang';
import { TopBar } from '../src/shell/TopBar';
import { initialNav, type ProjectFilter } from '../src/nav/state';

afterEach(() => cleanup());

const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false, seats: [], repos: [] };

function bar(project: ProjectFilter, lang: 'fr' | 'en' = 'fr') {
  const nav = { ...initialNav({ view: 'atelier', helpers: true, paused: true }), place: { kind: 'overview' as const, view: 'atelier' as const, project } };
  return render(
    <LangProvider lang={lang}>
      <TopBar nav={nav} dispatch={() => {}} session={null} helper={null} projects={null} rigs={[FACTORY]} projectIdOf={() => null} terminal={false} onTerminal={() => {}} />
    </LangProvider>
  );
}

describe('the top bar’s filter chip for rigs', () => {
  it('a rig filter shows the rig’s colour and name', () => {
    const { container } = bar('rig:local/r1');
    const chip = container.querySelector<HTMLElement>('.project-filter[data-filter="rig"]')!;
    expect(chip).toHaveTextContent('factory');
    const swatch = chip.querySelector<HTMLElement>('.side-swatch')!;
    expect(swatch.style.background).toBe(swatchColor(PROJECT_COLORS[rigColor(FACTORY)]));
  });
  it('a kernel filter reads « Noyau OpenRig » (OpenRig kernel in English)', () => {
    bar('kernel:local');
    expect(screen.getByText('Noyau OpenRig')).toBeVisible();
    cleanup();
    bar('kernel:local', 'en');
    expect(screen.getByText('OpenRig kernel')).toBeVisible();
  });
});

/** How jsdom normalises a colour set through `style.background`. */
function swatchColor(c: string): string {
  const el = document.createElement('i');
  el.style.background = c;
  return el.style.background;
}
