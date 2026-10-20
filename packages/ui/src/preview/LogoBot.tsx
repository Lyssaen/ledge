import { useId, useRef, type CSSProperties } from 'react';
import type { BotProps } from '../bots/Bot';
import { materialFor } from '../bots/material';
import { seedHash } from '../bots/poseFor';
import { useBotMotion, useBotNod, useBotVisibility, BOT_MOTION } from '../bots/useBotMotion';
import { useOsReducedMotion } from '../motionPreferences';
import { MOTION, ms } from '../motion';
import { useUiCopy } from '../i18n/copy';

// Design exploration only: deliberately separate from the shipping Bot component.
const SHELLS: Record<BotProps['tool'], string> = {
  claude: 'M24 24H72Q75 24 75 27V43H82Q84 43 84 45V52Q84 54 82 54H75V62Q75 64 73 64H70V75Q70 77 68 77H66Q64 77 64 75V64H59V75Q59 77 57 77H55Q53 77 53 75V64H43V75Q43 77 41 77H39Q37 77 37 75V64H32V75Q32 77 30 77H28Q26 77 26 75V64H23Q21 64 21 62V54H14Q12 54 12 52V45Q12 43 14 43H21V27Q21 24 24 24Z',
  codex: 'M30 25C31 13 48 10 57 20C69 14 84 23 81 37C92 46 87 62 76 65C76 80 58 86 48 77C35 85 20 78 21 66C7 61 7 45 18 38C13 28 21 20 30 25Z',
  cursor: 'M43 13Q48 10 53 13L77 27Q82 30 82 36V64Q82 69 77 72L53 85Q48 88 43 85L19 72Q14 69 14 64V36Q14 30 19 27Z',
  omp: 'M17 22H79Q83 22 83 26V48Q83 52 79 52H71V79Q71 83 67 83H58Q54 83 54 79V52H41V67Q41 71 37 71H28Q24 71 24 67V52H17Q13 52 13 48V26Q13 22 17 22Z'
};
const NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', omp: 'omp' };
const EYES = { starting: 'open', working: 'open', approval: 'open', question: 'wide', idle: 'happy', error: 'error', done: 'sleep', readonly: 'open' };

export function LogoBot({ tool, state, size, theme, seed, reducedMotion = false, frozen = false, nodKey, askKey, branded = true }: Pick<BotProps, 'tool' | 'state' | 'size' | 'theme' | 'seed' | 'reducedMotion' | 'frozen' | 'nodKey' | 'askKey'> & { branded?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const id = `logo-bot-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const osReduced = useOsReducedMotion();
  const reduced = reducedMotion || osReduced;
  const small = size <= 20;
  const readonly = state === 'readonly';
  const enabled = !small && !reduced && !frozen && !readonly;
  const h = seedHash(seed);
  const copy = useUiCopy();
  useBotVisibility(ref);
  useBotMotion(ref, { seed, state, askKey, nodKey, enabled });
  useBotNod(ref, nodKey, enabled, state, askKey);
  const style = {
    '--bot-size': `${size}px`, '--bot-eye': `var(--bot-eye-${readonly ? 'done' : state})`,
    '--bot-tilt': `${state === 'approval' ? -4 : state === 'question' ? 4 : state === 'error' ? -7 : 0}deg`,
    '--bot-lift': state === 'approval' ? '-1px' : '0px',
    '--bot-breath': ms(4800 + h % 17 * 100), '--bot-phase': `-${ms(h % 43 * 100)}`,
    '--bot-hop': `${Math.min(7, Math.max(2, size * .12)) / size * 96}px`, '--bot-hop-cycle': ms(3600 + h % 9 * 100),
    '--bot-ease': MOTION.grow.ease, '--bot-material-ms': ms(240), '--bot-eye-ms': ms(260),
    '--bot-pose-ms': ms(300), '--bot-gaze-ms': ms(450), '--bot-blink-ms': ms(BOT_MOTION.blinkMs),
    '--bot-ask-ms': ms(BOT_MOTION.askMs), '--bot-nod-ms': ms(BOT_MOTION.nodMs),
    '--bot-question-ms': ms(650), '--bot-arrival-ms': ms(BOT_MOTION.transitionMs),
    '--bot-entry-hop-ms': ms(BOT_MOTION.hopMs), '--bot-touch-ms': ms(BOT_MOTION.touchMs), '--bot-idle-ms': ms(BOT_MOTION.idleMs)
  } as CSSProperties;

  return <svg ref={ref} className="bot logo-bot" role="img" aria-label={`${NAMES[tool]} · proposition logo · ${copy.botLabel[state]}${frozen ? ` · ${copy.botNotLive}` : ''}`}
    width={size} height={size} viewBox="0 0 96 96" data-tool={tool} data-state={state} data-eyes={EYES[state]}
    data-material={materialFor(theme)} data-branded={String(branded)} data-simplified={String(small)} data-detailed={String(!small)}
    data-readonly={String(readonly)} data-halo={String(!readonly && state !== 'done')} data-frozen={String(frozen)}
    data-reduced={String(reduced)} data-hop={String(state === 'working' && !reduced && !frozen)} style={style}>
    <defs><linearGradient id={id} x1=".1" y1="0" x2=".8" y2="1" gradientUnits="objectBoundingBox">
      <stop className="shell-top" /><stop className="shell-bottom" offset="1" />
    </linearGradient></defs>
    <ellipse className="ground" cx="48" cy="90" rx="25" ry="3" />
    <g className="hop"><g className="body"><g className="arrival"><g className="signature"><g className="touch"><g className="pose">
      <path className="shell" d={SHELLS[tool]} fill={`url(#${id})`} />
      {tool === 'cursor' && <g className="logo-facets">
        <path className="cube-top" d="M43 13Q48 10 53 13L77 27Q80 29 81 32L48 49L15 32Q16 29 19 27Z" />
        <path className="cube-side" d="M48 49L81 32Q82 34 82 36V64Q82 69 77 72L53 85Q50 87 48 87Z" />
        <path className="cube-edge" d="M17 32L48 49L79 32M48 49V83" />
      </g>}
      {tool === 'claude' && <path className="shine" d="M27 28H69" />}
      <g transform={tool === 'omp' ? 'translate(0 -7)' : tool === 'claude' ? 'translate(0 -6)' : tool === 'cursor' ? 'translate(0 5)' : undefined}>
        <rect className="visor" x="25" y="35" width="47" height={tool === 'omp' ? 22 : 29} rx={tool === 'omp' ? 9 : 13} />
        <path className="reflection" d="M39 37H60Q68 37 69 44H28Q29 37 39 37" />
        <g className="gaze"><g className="eye-blink">
          <g className="eye-open"><rect x="36" y="43" width="6" height="12" rx="3" /><rect x="55" y="43" width="6" height="12" rx="3" /></g>
          <path className="eye-happy" d="M35 51Q39 43 43 51M54 51Q58 43 62 51" />
          <path className="eye-error" d="m35 45 8 3m11 0 8-3M38 54h2m16 0h2" />
          <path className="eye-sleep" d="M35 50q4 3 8 0m11 0q4 3 8 0" />
        </g></g>
      </g>
      {tool === 'claude' ? <rect className="arm" x="75" y="56" width="8" height="12" rx="2" /> : <ellipse className="arm" cx="79" cy="63" rx="5" ry="8" />}
    </g></g></g></g></g></g>
  </svg>;
}
