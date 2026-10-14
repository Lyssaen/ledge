import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RequestDetail } from '../src/screens/RequestDetail';
import { mobileStore } from '../src/state/store';

beforeEach(() => { localStorage.clear(); mobileStore.reset(); mobileStore.setLink('connecting'); });
const show = () => render(<RequestDetail sessionId="s" pendingId="p" onReconnect={() => {}} />);

describe('RequestDetail with no matching request', () => {
  it('shows a neutral loading state while the first snapshot is awaited', () => {
    show();
    expect(screen.getByText('Chargement de la demande…')).toBeInTheDocument();
    expect(screen.queryByText(/n’attend plus/)).toBeNull();
  });
  it('says the request is gone once a snapshot without it has arrived', () => {
    show();
    act(() => mobileStore.apply({ type: 'snapshot', sessions: [] }));
    expect(screen.getByText('Cette demande n’attend plus de décision.')).toBeInTheDocument();
  });
  it('does not assert it was handled when offline on a stale cache', () => {
    show();
    act(() => { mobileStore.apply({ type: 'snapshot', sessions: [] }); mobileStore.setLink('offline'); });
    expect(screen.queryByText('Cette demande n’attend plus de décision.')).toBeNull();
    expect(screen.getByText(/dernier état connu/)).toBeInTheDocument();
  });
});
