type Frame = { key: string; ms: number; caption: string };

// The `ledge tui` demonstration: the frames are stacked in one tall image, and the player slides it up one frame at a
// time, showing the key that was pressed, a caption, a counter and a progress bar.
export function initTui(still: boolean): void {
  const root = document.querySelector<HTMLElement>('[data-tui]');
  const sprite = root?.querySelector<HTMLElement>('[data-tui-sprite]');
  const progress = root?.querySelector<HTMLElement>('[data-tui-progress]');
  const toggle = root?.querySelector<HTMLButtonElement>('[data-tui-toggle]');
  const keycap = root?.querySelector<HTMLElement>('[data-tui-key]');
  const caption = root?.querySelector<HTMLElement>('[data-tui-caption]');
  const count = root?.querySelector<HTMLElement>('[data-tui-count]');
  if (!root || !sprite || !progress || !toggle || !keycap || !caption || !count) return;
  const frames = JSON.parse(root.dataset.frames ?? '[]') as Frame[];
  const total = frames.length;
  if (total === 0) return;
  let index = 0;
  let playing = false;
  let timer: number | undefined;

  const showFrame = (): void => {
    const frame = frames[index]!;
    sprite.style.transform = `translateY(-${((index * 100) / total).toFixed(4)}%)`;
    progress.style.width = `${(((index + 1) * 100) / total).toFixed(2)}%`;
    caption.textContent = frame.caption;
    count.textContent = `${index + 1} / ${total}`;
    keycap.hidden = frame.key === '';
    keycap.textContent = frame.key;
    // Reading the width between the two class changes makes the key cap pop again for each new key.
    keycap.classList.remove('pop');
    void keycap.offsetWidth;
    if (frame.key !== '') keycap.classList.add('pop');
  };
  const showToggle = (): void => {
    toggle.classList.toggle('is-playing', playing);
    toggle.setAttribute('aria-label', (playing ? root.dataset.labelPause : root.dataset.labelPlay) ?? '');
  };
  const schedule = (): void => {
    window.clearTimeout(timer);
    if (!playing) return;
    timer = window.setTimeout(() => {
      index = (index + 1) % total;
      showFrame();
      schedule();
    }, frames[index]!.ms);
  };

  toggle.addEventListener('click', () => {
    playing = !playing;
    showToggle();
    schedule();
  });
  if (still) return;
  playing = true;
  showToggle();
  schedule();
}
