import type { IntentParser, ParseContext } from './index';
import type { ParseResult } from '../../types';
import { bridgeClient, BridgeClient } from '../../services/bridgeClient';
import { IntentValidator } from '../validators/IntentValidator';

export class OllamaParser implements IntentParser {
  readonly name = 'ollama' as const;
  private client: BridgeClient;

  constructor(client: BridgeClient = bridgeClient) {
    this.client = client;
  }

  async isAvailable(): Promise<boolean> {
    return this.client.checkHealth();
  }

  async parse(text: string, ctx?: ParseContext): Promise<ParseResult | null> {
    const rawResult = await this.client.parseIntent(text, ctx);
    if (!rawResult) {
      return null;
    }

    if (rawResult.kind === 'intent') {
      rawResult.intent.source = 'ollama';
    }

    const validated = IntentValidator.validate(rawResult);
    return validated;
  }
}
