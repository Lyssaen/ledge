/** A seat's role, `@build`, as a pill. */
export function RolePill({ role }: { role: string }) {
  return <span className="inline-flex h-[22px] flex-none items-center rounded-md border border-role/40 bg-role/10 px-1.5 font-mono text-[11px] text-role">@{role}</span>;
}

/** A team's flag. */
export function Flag({ dim = false }: { dim?: boolean }) {
  return (
    <svg className={`size-3.5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8] ${dim ? 'text-muted' : 'text-team'}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 21V4h11l-2 4 2 4H5" />
    </svg>
  );
}

/** Ledge's progress on a team: a bar and « 1/2 ». */
export function Progress({ done, given }: { done: number; given: number }) {
  const pct = given === 0 ? 0 : Math.round((done / given) * 100);
  return (
    <span className="flex flex-none items-center gap-2 text-xs text-muted">
      <span aria-hidden="true" className="h-1.5 w-[72px] overflow-hidden rounded-full bg-raised"><span className="block h-full rounded-full bg-ok" style={{ width: `${pct}%` }} /></span>
      <span>{done}/{given}</span>
    </span>
  );
}
