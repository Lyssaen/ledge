/** A fingerprint in groups of 4 characters, as the boards show it; `groups` keeps only the first ones. */
export const groupFingerprint = (fp: string, groups?: number): string =>
  (fp.slice(0, groups === undefined ? undefined : groups * 4).match(/.{1,4}/g) ?? []).join(' ');
