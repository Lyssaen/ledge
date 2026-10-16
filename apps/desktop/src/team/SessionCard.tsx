import type { Session } from '@ledge/protocol';
import { needsAttention } from '../fleet/attention';
import { Avatar, StateBadge, TOOL_NAMES, useStateLabel } from '../shell/Person';

/** The mockup's card (app.js `card`): topic, person, the pending request when it needs you, then the machine. */
export function SessionCard({ session, selected, onSelect }: { session: Session; selected: boolean; onSelect: (id: string) => void }) {
  const stateLabel = useStateLabel();
  const topic = session.topic || session.project;
  const request = needsAttention(session) ? session.pending?.text ?? '' : '';
  const label = [topic, session.name, stateLabel(session), request, session.machineName].filter(Boolean).join(', ');
  return (
    <button type="button" className={`session-card${session.offline ? ' offline' : ''}${selected ? ' selected' : ''}`} data-session={session.id} data-offline={session.offline ? 'true' : undefined}
      aria-pressed={selected} aria-label={label} onClick={() => onSelect(session.id)}>
      <h3>{topic}</h3>
      <div className="card-person">
        <Avatar session={session} size={28} />
        <div className="card-identity"><div className="person-name">{session.name}</div><div className="person-tool">{TOOL_NAMES[session.tool]}</div></div>
        <StateBadge session={session} />
      </div>
      {request && <p className={`card-request ${session.state}`}>{request}</p>}
      <div className="card-foot"><i className={`dot ${session.offline ? 'offline-dot' : 'green'}`} aria-hidden="true" /><span>{session.machineName}</span></div>
    </button>
  );
}
