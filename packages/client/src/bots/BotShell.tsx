import type { JSX } from 'react';
import type { Tool } from '@ledge/protocol';

/** The mascot's body, one silhouette per tool; `fill` is a paint (colour or gradient url). */
export function BotShell({ tool, fill }: { tool: Tool; fill: string }): JSX.Element {
  if (tool === 'codex') return <ellipse className="shell" cx="48" cy="49" rx="32" ry="31" fill={fill} />;
  if (tool === 'cursor') return <path className="shell" d="M23 77 Q14 78 17 66 L30 22 Q33 12 42 20 L79 54 Q88 63 77 67 L58 71 46 83 Q40 88 36 80 L32 73Z" fill={fill} />;
  return <rect className="shell" x="15" y="22" width="66" height="56" rx="20" fill={fill} />;
}
