import { describe, expect, it } from 'vitest';
import type { OperationReason } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { replyFailure } from '../../src/screens/Reply';
import type { Op } from '../../src/state/operations';

const refused = (reason: OperationReason): Op => ({ op: 'o', message: { type: 'session.reply', op: 'o', id: 'a', text: 'x' } as Op['message'], phase: 'rejected', reason, at: '2026-10-26T08:00:00.000Z' });

describe('why a reply with images did not go', () => {
  it('an image the PC no longer has is said so, and is not an unreachable PC', () => {
    expect(replyFailure(refused('attachment_missing')).body).toBe(copy.thread.composer.imageGone);
    expect(copy.thread.composer.imageGone).toBe('Une image n’est plus disponible : retirez-la et recollez-la. Votre brouillon est conservé.');
  });
  it('an agent that cannot take images now gives the dialog wording', () => {
    expect(replyFailure(refused('attachments_not_accepted')).body).toBe(copy.images.dialog);
  });
});
