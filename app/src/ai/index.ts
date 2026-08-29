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
import type { ParseContext } from './parsers';
import { FallbackParser, OllamaParser } from './parsers';
import { IntentValidator } from './validators';

export type { IntentParser, ParseContext } from './parsers';

/** Hard ceiling on the Ollama round trip before we fall back. */
export const OLLAMA_TIMEOUT_MS = 2500;

export interface IntentEngine {
  parse(text: string, ctx?: ParseContext): Promise<ParseResult>;
}

export class DefaultIntentEngine implements IntentEngine {
  private ollamaParser: OllamaParser;
  private fallbackParser: FallbackParser;

  constructor(ollamaParser?: OllamaParser, fallbackParser?: FallbackParser) {
    this.ollamaParser = ollamaParser ?? new OllamaParser();
    this.fallbackParser = fallbackParser ?? new FallbackParser();
  }

  async parse(text: string, ctx?: ParseContext): Promise<ParseResult> {
    try {
      const isOllamaAvailable = await this.ollamaParser.isAvailable();
      if (isOllamaAvailable) {
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), OLLAMA_TIMEOUT_MS),
        );

        const ollamaPromise = this.ollamaParser.parse(text, ctx);
        const result = await Promise.race([ollamaPromise, timeoutPromise]);

        if (result) {
          return IntentValidator.validate(result);
        }
      }
    } catch {
      // Fall through silently to FallbackParser on any error
    }

    const fallbackResult = await this.fallbackParser.parse(text, ctx);
    return IntentValidator.validate(fallbackResult);
  }
}

export const intentEngine: IntentEngine = new DefaultIntentEngine();
