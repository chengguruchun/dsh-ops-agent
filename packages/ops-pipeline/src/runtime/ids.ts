/** Stable ID helpers for Observation / Evidence / Decision / Action / Result / Verification. */

let seq = 0;

export type IdKind =
  | 'obs'
  | 'ev'
  | 'dec'
  | 'act'
  | 'res'
  | 'ver'
  | 'trace'
  | 'gap';

export function newRuntimeId(kind: IdKind, now = Date.now()): string {
  seq += 1;
  return `${kind}_${now.toString(36)}_${seq.toString(36)}`;
}

export function resetRuntimeIdSeqForTests(): void {
  seq = 0;
}
