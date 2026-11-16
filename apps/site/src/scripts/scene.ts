type Step = { ms: number; caption: string };

// « Vos agents se parlent »: every line of both terminals is in the page with the steps at which it shows. Playing the
// scene is moving from step to step and showing the lines of that step; a line that appears slides in (`.ln`).
export function initScene(still: boolean): void {
  const root = document.querySelector<HTMLElement>('[data-scene]');
  const toggle = root?.querySelector<HTMLButtonElement>('[data-scene-toggle]');
  const replay = root?.querySelector<HTMLButtonElement>('[data-scene-replay]');
  const caption = root?.querySelector<HTMLElement>('[data-scene-caption]');
  if (!root || !toggle || !replay || !caption) return;
  const steps = JSON.parse(root.dataset.steps ?? '[]') as Step[];
  if (steps.length === 0) return;
  const lines = Array.from(root.querySelectorAll<HTMLElement>('[data-from]')).map(element => ({
    element,
    from: Number(element.dataset.from),
    until: element.dataset.until === undefined ? Infinity : Number(element.dataset.until)
  }));
  // The page is built at the last step, the end of the story.
  let step = steps.length - 1;
  let playing = false;
  let timer: number | undefined;

  const show = (): void => {
    for (const line of lines) line.element.hidden = step < line.from || step > line.until;
    caption.textContent = steps[step]!.caption;
    toggle.textContent = (playing ? toggle.dataset.labelPause : toggle.dataset.labelPlay) ?? '';
  };
  const schedule = (): void => {
    window.clearTimeout(timer);
    if (!playing) return;
    timer = window.setTimeout(() => {
      step = (step + 1) % steps.length;
      show();
      schedule();
    }, steps[step]!.ms);
  };
  const play = (fromStart: boolean): void => {
    playing = true;
    if (fromStart) step = 0;
    show();
    schedule();
  };

  toggle.addEventListener('click', () => {
    if (!playing) return play(false);
    playing = false;
    show();
    schedule();
  });
  replay.addEventListener('click', () => play(true));
  if (!still) play(true);
}
