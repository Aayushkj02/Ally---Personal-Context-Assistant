/**
 * OWNER: SHLOK — task S5
 *
 * HTTP client for the laptop bridge: POST /parse and GET /health.
 * Transport at demo time is `adb reverse tcp:3000` or `tcp:11434` over USB.
 *
 * EVERY CALL IS OPTIONAL BY CONTRACT (docs/CONTRACTS.md §4). A dead bridge must never
 * produce a spinner, an error dialog, or a blocked UI — it falls back silently.
 */

import type { ParseResult } from '../types';
import type { ParseContext } from '../ai/parsers';

export interface BridgeClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

export class BridgeClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: BridgeClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://127.0.0.1:3000';
    this.timeoutMs = config.timeoutMs ?? 2500;
  }

  /** Checks if bridge server or Ollama is reachable. */
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Attempts to parse intent via laptop AI bridge service.
   * Returns null if bridge is offline, times out, or fails.
   */
  async parseIntent(text: string, ctx?: ParseContext): Promise<ParseResult | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, context: ctx }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as ParseResult;
      return data;
    } catch {
      return null;
    }
  }
}

export const bridgeClient = new BridgeClient();
