/** A long session thread, close to Ledge's in weight: 1,500 items mixing messages, tool lines and code. */
import { useMemo, type JSX } from 'react';

const WORDS = 'le la les une des pour avec dans sur coque onglet groupe fenêtre terminal session agent rig dockview popout fluidité mesure rendu canvas contexte'.split(' ');
const say = (n: number, seed: number) => Array.from({ length: n }, (_, i) => WORDS[(seed * 7 + i * 13) % WORDS.length]).join(' ');

export function Thread({ seed }: { seed: number }): JSX.Element {
  const items = useMemo(() => Array.from({ length: 1500 }, (_, i) => i), []);
  return (
    <div className="thread" data-thread={seed}>
      {items.map(i => {
        const k = (i + seed) % 5;
        if (k === 0) return <div key={i} className="m-user">{say(18, i + seed)}</div>;
        if (k === 1) return <div key={i} className="tool">✓ <b>Edit</b> apps/desktop/src/shell/Workspace{i}.tsx +{i % 40} −{i % 7}</div>;
        if (k === 2) return <pre key={i} className="code">{`export function f${i}() {\n  return ${say(6, i)};\n}`}</pre>;
        return <p key={i} className="m-agent">{say(40, i + seed)}</p>;
      })}
    </div>
  );
}
