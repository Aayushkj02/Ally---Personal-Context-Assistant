/**
 * OWNER: SHLOK — task S5
 *
 * PUBLIC SURFACE of the intent engine. The rest of the app imports ONLY this file.
 *
 * Selection rule (FLOW.md §3): try Ollama with a hard 2.5s timeout; on timeout,
 * transport error, or schema-invalid output, fall through to the deterministic
 * on-device parser SILENTLY. The user sees no error — only the `source` chip.
 *
 * CONTRACT: this returns a validated ParseResult and nothing else. The AI never
 * touches an Android API (ADR-006, docs/CONTRACTS.md §1).
 */

import type { ParseResult } from '../types';
import { notImplemented } from '../utils/notImplemented';
import type { ParseContext } from './parsers';

export type { IntentParser, ParseContext } from './parsers';

/** Hard ceiling on the Ollama round trip before we fall back. */
export const OLLAMA_TIMEOUT_MS = 2500;

export interface IntentEngine {
  parse(text: string, ctx?: ParseContext): Promise<ParseResult>;
}

export const intentEngine: IntentEngine = {
  async parse(): Promise<ParseResult> {
    return notImplemented('intentEngine.parse — Shlok, task S5');
  },
};
