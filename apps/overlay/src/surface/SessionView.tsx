import { useState } from 'react';
import type { Pending, Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { relativeTime, toolName } from '../format';
import { transition } from '../motion';

const Icon = ({ d, size = 16 }: { d: string[]; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p, i) => <path key={i} d={p} />)}</svg>;
const I = { back: ['m15 18-6-6 6-6'], close: ['M18 6 6 18', 'm6 6 12 12'], ext: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'], expand: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'], check: ['M20 6 9 17l-5-5'], send: ['M22 2 11 13', 'm22 2-7 20-4-9-9-4 20-7z'], stop: ['M6 6h12v12H6z'] };
const well: React.CSSProperties = { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13, lineHeight: '20px', padding: '8px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' };
const rule = '1px solid var(--sidebar-border)';

export function measureSessionH(s: Session, reading: boolean): number {
  const ask = !s.pending ? 0 : s.pending.kind === 'question' ? 48 + (s.pending.options?.length ?? 0) * 64 + 56 : 168;
  return 56 + ask + (reading ? 480 : 240) + 100;
}

function QuestionCard({ pending, onReply }: { pending: Pending; onReply: (t: string) => void }) {
  const [choice, setChoice] = useState<number | 'other'>(0);
  const [other, setOther] = useState('');
  const opts = pending.options ?? [];
  const row = (active: boolean, pad: string): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 12, padding: pad, borderStyle: 'solid', borderWidth: 1, borderColor: active ? 'var(--sidebar-primary)' : 'var(--border)', borderRadius: 'var(--radius-lg)', backgroundColor: active ? 'var(--secondary)' : 'transparent', cursor: 'pointer', transition: transition([['border-color', 'hover'], ['background-color', 'hover']]) });
  return (
    <>
      <div style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600 }}>{pending.text}</div>
      <fieldset style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Options</legend>
        {opts.map((o, i) => (
          <label key={o} className="ledge-opt" style={row(choice === i, '10px 14px')}>
            <input type="radio" name="opt" checked={choice === i} onChange={() => setChoice(i)} /> <span style={{ fontWeight: 500 }}>{o}</span>
          </label>
        ))}
        <label className="ledge-opt" style={row(choice === 'other', '6px 14px')}>
          <input type="radio" name="opt" aria-label="Other" checked={choice === 'other'} onChange={() => setChoice('other')} />
          <input type="text" placeholder="Other…" value={other} onChange={e => { setOther(e.target.value); setChoice('other'); }} style={{ flexGrow: 1, minWidth: 0, height: 28, background: 'transparent', color: 'inherit', border: 'none', fontSize: 14 }} />
        </label>
      </fieldset>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="primary" onClick={() => onReply(choice === 'other' ? other : String(choice + 1))}>Answer</Button></div>
    </>
  );
}

export function SessionView(p: { session: Session; preview: string[]; visible: boolean; reading: boolean; draft: string; onDraft: (t: string) => void; onBack: () => void; onClose: () => void; onDecide: (d: 'accept' | 'deny') => void; onReply: (t: string) => void; onInterrupt: () => void; onKill: () => void; onFocus: () => void; onToggleReading: () => void; theme?: 'dark' | 'light'; now?: number }) {
  const { session: s, visible } = p;
  const pending = s.pending;
  // Keep the last request around so the card's content stays put while it folds away.
  const [last, setLast] = useState<Pending | undefined>(pending);
  if (pending && pending !== last) setLast(pending);
  const shown = pending ?? last;
  const isQ = shown?.kind === 'question';
  const st = botState(s);
  const sendDraft = () => { if (p.draft.trim()) p.onReply(p.draft); };
  return (
    <div data-layer="session" inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 120 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: rule }}>
        <Button variant="ghost" size="icon" aria-label="Back to sessions" onClick={p.onBack}><Icon d={I.back} /></Button>
        <Bot seed={s.id} readOnly={s.source === 'hook_only'} tool={s.tool} state={st} pose={poseFor(s.id, s.state)} size={32} theme={p.theme ?? 'dark'} paused={!visible} askKey={pending?.text} />
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name} · {s.project}</span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{toolName(s.tool)} · {relativeTime(s.startedAt, p.now)}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Reading mode" aria-pressed={p.reading} onClick={p.onToggleReading} style={{ color: p.reading ? 'var(--sidebar-primary)' : undefined }}><Icon d={I.expand} /></Button>
        <Button variant="ghost" size="icon" aria-label="Focus terminal tab" onClick={p.onFocus}><Icon d={I.ext} /></Button>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={p.onClose}><Icon d={I.close} /></Button>
      </div>

      <div data-ask inert={!pending} style={{ flexShrink: 0, maxHeight: pending ? `${260 + (pending.options?.length ?? 0) * 64}px` : '0px', opacity: pending ? 1 : 0, overflow: 'hidden', transition: pending ? transition([['max-height', 'grow'], ['opacity', 'fadeIn', 0]]) : transition([['max-height', 'cardExit'], ['opacity', 'cardExit']]) }}>
        {shown && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderBottom: rule }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge state={s.state === 'error' ? 'error' : isQ ? 'question' : 'approval'} label={s.state === 'error' ? 'Error' : isQ ? 'Question' : 'Approval needed'} />
              {s.state === 'error' && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>the terminal did not take it, try again or open the tab</span>}
            </div>
            {isQ ? <QuestionCard key={shown.text} pending={shown} onReply={p.onReply} /> : (
              <>
                <div>{s.name} wants to run</div>
                <div style={well}>{shown.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button variant="ghost" size="sm" disabled title="Scoped authorization is not confirmed by any adapter yet">Always for this session</Button>
                  <span style={{ flexGrow: 1 }} />
                  <Button variant="outline" onClick={() => p.onDecide('deny')}>Deny</Button>
                  <Button variant="primary" onClick={() => p.onDecide('accept')}><Icon d={I.check} />Approve</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px 0', flexGrow: 1, minHeight: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)' }}>Terminal · last 30 lines · read only</span>
        <pre className="mono" style={{ ...well, flexGrow: 1, minHeight: 0, margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.preview.map((l, i) => <div key={i}>{l || ' '}</div>)}</pre>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="text" placeholder={`Reply to ${s.name}…`} aria-label={`Reply to ${s.name}`} value={p.draft} onChange={e => p.onDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendDraft(); }} style={{ flexGrow: 1, minWidth: 0, height: 36, boxSizing: 'border-box', padding: '0 12px', background: 'var(--sidebar)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 14 }} />
          <Button variant="secondary" size="icon" aria-label="Send" onClick={sendDraft}><Icon d={I.send} /></Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
          <span>Enter sends to the terminal as typed</span><span style={{ flexGrow: 1 }} />
          {s.state === 'working' && <Button variant="outline" size="sm" onClick={p.onInterrupt}><Icon d={I.stop} size={14} />Interrupt <Kbd>Esc</Kbd></Button>}
          <Button variant="ghost" size="sm" onClick={p.onKill} style={{ color: 'var(--danger-text)' }}>Kill session</Button>
        </div>
      </div>
    </div>
  );
}
