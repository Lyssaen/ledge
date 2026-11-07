import { useLayoutEffect, useRef, type JSX } from 'react';
import { useI18n } from '../i18n/lang';
import type { RigOutputEntry } from '../openrig/rigOutput';
import '../styles/ide.css';

const clock = (at: number): string => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** The bottom panel's Output (mockup `.term`): per command, its time and the commands joined by « && », then how it ended. */
export function OutputView({ entries }: { entries: readonly RigOutputEntry[] }): JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  // A new entry scrolls to the end only if the view was already there.
  useLayoutEffect(() => { const el = ref.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [entries]);
  const onScroll = () => { const el = ref.current; if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4; };
  return (
    <pre ref={ref} className="ide-output" onScroll={onScroll} aria-label={t.ide.output}>
      {entries.length === 0 ? <span className="ide-output-dim">{t.ide.outputEmpty}</span> : entries.map((e, i) => (
        <span key={i} className="ide-output-entry">
          <span className="ide-output-dim">{`${clock(e.at)} · ${e.commands.join(' && ')}`}</span>{'\n'}
          <span className={e.ok ? 'ide-output-ok' : 'ide-output-err'}>{e.ok ? '✓' : '✗'}</span>{e.result ? ` ${e.result}` : ''}{'\n'}
        </span>
      ))}
    </pre>
  );
}
