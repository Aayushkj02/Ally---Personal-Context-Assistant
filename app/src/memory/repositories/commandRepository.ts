import { getDatabase } from '../database';
import type { CommandLog, ActionExecution, CapabilityValue } from '../../types';

function encodeValue(val: CapabilityValue | null): string | null {
  return val === null ? null : JSON.stringify(val);
}

function decodeValue(val: string | null): CapabilityValue | null {
  return val === null ? null : JSON.parse(val);
}

export const commandRepository = {
  async createCommand(log: CommandLog): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO command_log (id, rawText, intentJson, confidence, source, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [log.id, log.rawText, log.intentJson, log.confidence, log.source, log.createdAt]
    );
  },

  async getRecentCommands(limit: number = 20): Promise<CommandLog[]> {
    const db = await getDatabase();
    return await db.getAllAsync<CommandLog>(
      'SELECT * FROM command_log ORDER BY createdAt DESC LIMIT ?',
      [limit]
    );
  },

  async createAction(action: ActionExecution): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO action_execution (id, commandId, capability, status, reason, beforeValue, afterValue) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        action.id,
        action.commandId,
        action.capability,
        action.status,
        action.reason,
        encodeValue(action.beforeValue),
        encodeValue(action.afterValue)
      ]
    );
  },

  async getActionsByCommand(commandId: string): Promise<ActionExecution[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM action_execution WHERE commandId = ?',
      [commandId]
    );
    return rows.map(row => ({
      ...row,
      beforeValue: decodeValue(row.beforeValue),
      afterValue: decodeValue(row.afterValue)
    }));
  }
};
