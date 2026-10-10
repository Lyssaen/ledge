import { useId, useRef, type CSSProperties, type JSX } from 'react';
import type { Tool } from '@ledge/protocol';
import { MOTION, ms } from '../motion';
import { useMotionPreferences, useOsReducedMotion } from '../motionPreferences';
import { materialFor } from './material';
import { seedHash, type BotState } from './poseFor';
import { useBotMotion, useBotNod, BOT_MOTION } from './useBotMotion';
import { useI18n } from '../i18n/lang';

export interface BotProps {
  tool: Tool;
  state: BotState;
  pose: 1 | 2 | 3;
  size: number;
  /** The size the bot is drawn at on screen when a parent scales it; used only for the hop height. Defaults to `size`. */
  shownSize?: number;
  theme: 'dark' | 'light';
  /** Stable session ID, or `parent.id + ':' + helper.id` for a helper; never the display name. */
  seed: string;
  readOnly?: boolean;
  /** Connection lost / stale: keep the known expression, freeze motion, lower opacity. */
  frozen?: boolean;
  /** Effective app preference; defaults to useMotionPreferences(). The OS preference always wins. */
  reducedMotion?: boolean;
  /** Inactive layer / paused view: freeze every animation in place without the frozen styling. */
  paused?: boolean;
  /** Identity of the current approval request (e.g. its pending ID); a new value in approval plays the hand gesture once, even on mount. */
  askKey?: string;
  /** Increment to play one 650 ms nod acknowledging a received decision. */
  nodKey?: number;
  className?: string;
}

const TOOL_NAMES: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };

type Eyes = 'open' | 'wide' | 'happy' | 'error' | 'sleep';
interface Expression { eyes: Eyes; eye: string; tilt?: readonly [number, number, number]; lift?: number }

/** Approved expressions (spec section 6, mascot.css); tilt variants come from the reference controller. */
const EXPRESSIONS: Record<BotState, Expression> = {
  starting: { eyes: 'open', eye: 'starting' },
  working: { eyes: 'open', eye: 'working' },
  approval: { eyes: 'open', eye: 'approval', tilt: [-4, 3, -2], lift: -1 },
  question: { eyes: 'wide', eye: 'question', tilt: [4, -3, 6] },
  idle: { eyes: 'happy', eye: 'idle' },
  error: { eyes: 'error', eye: 'error', tilt: [-7, -6, -5], lift: 2 },
  done: { eyes: 'sleep', eye: 'done' },
  readonly: { eyes: 'open', eye: 'done' }
};

const FULL_VIEWBOX = '0 0 96 96';
const HEAD_VIEWBOX = '12 16 72 68';

const SHINE: Record<Tool, string> = {
  claude: 'M25 36Q27 28 38 28H59',
  codex: 'M25 32Q35 19 51 22',
  cursor: 'M27 41 34 24Q35 23 37 25'
};

function Shell({ tool, fill }: { tool: Tool; fill: string }) {
  if (tool === 'codex') return <ellipse className="shell" cx="48" cy="49" rx="32" ry="31" fill={fill} />;
  if (tool === 'cursor') return <path className="shell" d="M23 77 Q14 78 17 66 L30 22 Q33 12 42 20 L79 54 Q88 63 77 67 L58 71 46 83 Q40 88 36 80 L32 73Z" fill={fill} />;
  return <rect className="shell" x="15" y="22" width="66" height="56" rx="20" fill={fill} />;
}

/**
 * Session mascot: one persistent SVG whose layers (shell, pose, gaze, eyes, accessories) stay mounted
 * across theme and state changes; only attributes and CSS variables change. A halo in the state colour
 * (data-halo, drawn by bots.css) distinguishes live sessions at a glance.
 */
export function Bot({ tool, state, pose, size, shownSize, theme, seed, readOnly = false, frozen = false, paused = false, reducedMotion, askKey, nodKey, className }: BotProps): JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  const gradientId = `bot-shell-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const prefs = useMotionPreferences();
  const osReduced = useOsReducedMotion();
  const reduced = osReduced || (reducedMotion ?? prefs.reduced);
  const simplified = size <= 20;
  const expr = EXPRESSIONS[state];
  /** Halo in the state colour (bots.css): every live state; never a finished or read-only session. */
  const halo = !readOnly && state !== 'done' && state !== 'readonly';
  const { t } = useI18n();
  const h = seedHash(seed);
  // The working hop (spec §6): the only ambient motion kept at ≤ 20 px, so the handle shows progress. Height in screen px,
  // converted to SVG units so a 12 px bot lifts 2 px and a 48 px bot 5.8 px; period 3.6–4.4 s, offset per bot like breathing.
  const hop = state === 'working' && !reduced && !readOnly && !frozen && !paused;
  // A parent that scales the SVG (the handle's resting bots) passes the on-screen size, so the units match what is seen;
  // the units follow the viewBox width (72 for the head-only drawing, 96 for the full one).
  const shown = shownSize ?? size;
  const hopPx = Math.min(7, Math.max(2, shown * 0.12));
  const hopUnits = (hopPx / shown) * (simplified ? 72 : 96);
  const hopCycle = 3600 + (h % 9) * 100;

  useBotMotion(ref, { seed, state, askKey, enabled: !reduced && !simplified && !readOnly && !frozen && !paused });
  useBotNod(ref, nodKey, !reduced && !readOnly && !frozen && !paused);

  const style = {
    '--bot-size': `${size}px`,
    '--bot-eye': `var(--bot-eye-${expr.eye})`,
    '--bot-tilt': `${expr.tilt?.[pose - 1] ?? 0}deg`,
    '--bot-lift': `${expr.lift ?? 0}px`,
    '--bot-breath': ms(4800 + (h % 17) * 100),
    '--bot-phase': `-${ms((h % 43) * 100)}`,
    '--bot-hop': `${hopUnits.toFixed(2)}px`,
    '--bot-hop-cycle': ms(hopCycle),
    '--bot-ease': MOTION.grow.ease,
    '--bot-material-ms': ms(240),
    '--bot-eye-ms': ms(260),
    '--bot-pose-ms': ms(300),
    '--bot-gaze-ms': ms(450),
    '--bot-blink-ms': ms(BOT_MOTION.blinkMs),
    '--bot-ask-ms': ms(BOT_MOTION.askMs),
    '--bot-nod-ms': ms(BOT_MOTION.nodMs)
  } as CSSProperties;

  const label = `${TOOL_NAMES[tool]} · ${t.botLabel[state]}${readOnly && state !== 'readonly' ? ` · ${t.botReadOnly}` : ''}${frozen ? ` · ${t.botNotLive}` : ''}`;

  return (
    <svg
      ref={ref}
      className={className ? `bot ${className}` : 'bot'}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={simplified ? HEAD_VIEWBOX : FULL_VIEWBOX}
      data-tool={tool}
      data-state={state}
      data-eyes={expr.eyes}
      data-pose={pose}
      data-material={materialFor(theme)}
      data-simplified={String(simplified)}
      data-readonly={String(readOnly || state === 'readonly')}
      data-halo={String(halo)}
      data-frozen={String(frozen)}
      data-paused={String(paused)}
      data-reduced={String(reduced)}
      data-hop={String(hop)}
      style={style}
    >
      <defs>
        <linearGradient id={gradientId} x1=".2" y1="0" x2=".75" y2="1" gradientUnits="objectBoundingBox">
          <stop className="shell-top" />
          <stop className="shell-bottom" offset="1" />
        </linearGradient>
      </defs>
      <ellipse className="ground" cx="48" cy="88" rx="25" ry="3" />
      <g className="hop">
      <g className="body">
        <g className="pose">
          <g className="antenna-group">
            <path className="antenna" d="M49 22V14" />
            <circle className="antenna-light" cx="49" cy="12" r="3" />
          </g>
          <g className="feet">
            <rect x="29" y="75" width="13" height="8" rx="4" />
            <rect x="54" y="75" width="13" height="8" rx="4" />
          </g>
          <Shell tool={tool} fill={`url(#${gradientId})`} />
          <path className="shine" d={SHINE[tool]} />
          <rect className="visor" x="25" y="35" width="47" height="29" rx="13" />
          <path className="reflection" d="M39 37H60Q68 37 69 44H28Q29 37 39 37" />
          <g className="gaze">
            <g className="eye-blink">
              <g className="eye-open">
                <rect x="36" y="43" width="6" height="12" rx="3" />
                <rect x="55" y="43" width="6" height="12" rx="3" />
              </g>
              <path className="eye-happy" d="M35 51Q39 43 43 51M54 51Q58 43 62 51" />
              <path className="eye-error" d="m35 45 8 3m11 0 8-3M38 54h2m16 0h2" />
              <path className="eye-sleep" d="M35 50q4 3 8 0m11 0q4 3 8 0" />
            </g>
          </g>
          <ellipse className="arm" cx="79" cy="63" rx="5" ry="8" />
        </g>
      </g>
      </g>
    </svg>
  );
}
