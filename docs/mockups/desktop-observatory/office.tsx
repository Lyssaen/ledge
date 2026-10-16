import React from 'react';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';

/** Furniture is decorative; only bots, project signs and Ledge are interactive. */
export function Plant({className='',style}:{className?:string;style?:React.CSSProperties}){
 return <span className={`office-plant ${className}`} style={style} aria-hidden="true"><i/><i/><i/><i/><b/></span>;
}
export function OfficeWall(){
 return <div className="office-wall" aria-hidden="true"><div className="wall-sign"><span>LEDGE</span><small>MAKE ROOM FOR IDEAS</small></div><div className="office-window"><i/><i/><i/><i/></div><div className="wall-shelf"><span className="shelf-books"><i/><i/><i/><i/></span><Plant/><div className="wall-clock"><i/><b/></div></div></div>;
}
type Note={task:string;state:BotState;offline?:boolean;side:'left'|'right';more?:number};
type Sheet={id:string;task:string;state:BotState;offline?:boolean;slot:'t'|'b';x:number;note?:Note};
const marks=(state:BotState,offline?:boolean)=><>{!offline&&(state==='approval'||state==='question')&&<b className="sheet-flag"/>}{!offline&&state==='done'&&<i className="sheet-stamp">✓</i>}</>;
/** What lies on a project table: one sheet per seated agent, set in front of its place. A sub-agent is a sticky
 * note laid next to its parent's sheet, in the free gap of the same row (to the right when there is room). */
export function TableTop({sheets,length}:{sheets:Sheet[];length:number}){
 const W=84,NOTE=52;
 const noteLeft=(s:Sheet)=>{const row=sheets.filter(o=>o.slot===s.slot).map(o=>o.x).sort((a,b)=>a-b);const i=row.indexOf(s.x);
  const right=(i<row.length-1?row[i+1]-W/2:length-6)-(s.x+W/2);const left=(s.x-W/2)-(i>0?row[i-1]+W/2:6);
  return right>=NOTE+4?s.x+W/2+2:left>=NOTE+4?s.x-W/2-NOTE-2:s.x+W/2-NOTE+8};
 return <div className="table-top">
  {sheets.map(s=><React.Fragment key={s.id}><div style={{left:s.x-W/2}} className={`task-sheet sheet-${s.slot} ${s.offline?'sheet-offline':`sheet-${s.state}`}`}><p>{s.task}</p>{marks(s.state,s.offline)}</div>
   {s.note&&<div style={{left:noteLeft(s)}} className={`sheet-note note-${s.slot} ${s.note.offline?'sheet-offline':`sheet-${s.note.state}`}`}><p>{s.note.task}</p>{marks(s.note.state,s.note.offline)}{!!s.note.more&&<em className="note-more">+{s.note.more}</em>}</div>}</React.Fragment>)}
 </div>;
}
