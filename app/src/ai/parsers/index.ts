/**
 * OWNER: SHLOK — tasks S2 (Ollama client), S3 (fallback parser)
 *
 * Every parser implements the SAME interface, so `src/ai/index.ts` can swap between
 * them without the rest of the app noticing (FLOW.md §3).
 */

import type { ParseResult } from '../../types';

export interface ParseContext {
  /** The activity currently active, if any — disambiguates "let them through for 20 min". */
  activeActivity?: 'study' | 'sleep';
  /** Injected clock, so time-relative parsing ("wake me at 7") is testable. */
  now?: number;
}

export interface IntentParser {
  readonly name: 'ollama' | 'fallback';
  /** Ollama checks the bridge; the fallback parser always returns true. */
  isAvailable(): Promise<boolean>;
  parse(text: string, ctx?: ParseContext): Promise<ParseResult | null>;
}

export { FallbackParser } from './FallbackParser';
export { OllamaParser } from './OllamaParser';
