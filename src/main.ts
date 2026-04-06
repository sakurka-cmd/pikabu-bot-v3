/**
 * Pikabu Bot v3.1
 * HTTP-based auth, no browser needed
 */

import { initDatabase, closeDatabase, startAutoSave, getSettings, updateSettings } from './storage';
import { initBot, stopBot } from './telegram-bot';

async function main() {
  console.log('🤖 Pikabu Bot v3.1');
  console.log('==================');
  console.log('[Config] Using sql.js (pure JS SQLite)');
  console.log('[Config] HTTP-based authentication (no browser)');

  const botToken = process.env.BOT_TOKEN;
  const dbPath = process.env.DATABASE_PATH || '/app/data/bot.db';

  console.log(`[Config] DATABASE_PATH: ${dbPath}`);
  console.log(`[Config] BOT_TOKEN: ${botToken ? 'configured' : 'missing'}`);

  await initDatabase();
  startAutoSave();

  if (botToken) {
    const settings = await getSettings();
    if (botToken !== settings.botToken) {
      console.log('[Config] Updating bot token from environment...');
      await updateSettings({ botToken });
    }
  }

  const bot = await initBot();
  if (!bot) {
    console.error('[Error] Bot not initialized. Check BOT_TOKEN');
    closeDatabase();
    process.exit(1);
  }

  console.log('[Bot] Started successfully!');

  const shutdown = async () => {
    console.log('\n[Bot] Shutting down...');
    stopBot();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[Fatal]', e);
  process.exit(1);
});
