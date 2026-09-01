import { getDatabase } from './database';

async function resetDemoState() {
  console.log('Resetting Demo State...');
  try {
    const db = await getDatabase();

    // Clear dynamic tables but keep profiles and schema
    await db.runAsync('DELETE FROM command_log');
    await db.runAsync('DELETE FROM device_snapshot');
    await db.runAsync('DELETE FROM context_session');
    await db.runAsync('DELETE FROM priority_preference');
    await db.runAsync('DELETE FROM temporary_override');
    await db.runAsync('DELETE FROM preference'); // Or keep profile preferences? Requirements say "preferences"

    console.log('Demo state successfully reset.');
  } catch (error) {
    console.error('Failed to reset demo state:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  resetDemoState();
}
