import { copy } from '../copy';

/**
 * Where the board's « Vérifier et autoriser » stands. Lot 5 has no device check (WebAuthn), so the PC answers any
 * accept of a high-impact request with `confirm_required`: the phone never offers it, and says where it is done.
 * Not a button: there is nothing to tap.
 */
export function RiskConfirm() {
  return (
    <p className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-dashed border-line px-4 py-2.5 text-center text-[13px] leading-[1.4] font-medium text-muted">
      <svg className="size-4 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      {copy.decide.onPc}
    </p>
  );
}
