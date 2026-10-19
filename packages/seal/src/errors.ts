export type SealErrorCode = 'bad_encoding' | 'bad_key' | 'bad_seal' | 'replay' | 'gap' | 'bad_commitment';

export class SealError extends Error {
  readonly code: SealErrorCode;
  constructor(code: SealErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SealError';
    this.code = code;
  }
}
