# packages/seal — `@ledge/seal`

End-to-end crypto between the phone and the PC: identities, the channel, pairing with commitments, fingerprints. WebCrypto
only, no dependency.

## Commands

`pnpm --filter @ledge/seal test`, `typecheck`.

## Rules

- Add no dependency: the code is small enough to be read whole, keep it so.
- A change to a key, message or pairing format breaks devices already paired: version the format, keep reading the old
  one, and tell the owner.
- Every failure path (bad signature, replay, wrong commitment, truncated message) has its test; failures are refusals,
  never silent fallbacks.
- No key, secret or plaintext in a log or an error message.
