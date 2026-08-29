/**
 * OWNER: SHARED (created Phase 0/1 scaffold — do not change the signature)
 *
 * Scaffold marker. Every Phase 1 placeholder throws through this so an unimplemented
 * path fails loudly and immediately rather than returning a silent wrong answer.
 * Delete each call as the real implementation lands.
 */
export function notImplemented(what: string): never {
  throw new Error(`[Ally] ${what} is not implemented yet.`);
}
