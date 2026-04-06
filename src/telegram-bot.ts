import TelegramBot from 'node-telegram-bot-api';
import {
  getSettings, getUser, createUser, updateUser, deleteUser, getAllActiveUsers,
  getTagSet, createTagSet, updateTagSet, deleteTagSet,
  addIncludeTag, removeIncludeTag, addExcludeTag, removeExcludeTag,
  addAuthorSubscription, removeAuthorSubscription, toggleAuthorSubscription, setAuthorPreviewMode,
  addCommunitySubscription, removeCommunitySubscription, toggleCommunitySubscription, setCommunityPreviewMode,
  getDialogState, setDialogState, clearDialogState,
  isPostSeen, addSeenPost, hasUserReceivedPost, recordUserPost,
  getDetailedStats, getPopularTags, getPopularAuthors,
  incrementUserPostsReceived, incrementGlobalPostsSent, recordParseTime, recordParseError,
  blockUser, unblockUser,
  UserData, TagSetData,
} from './storage';
import { setPikabuCredentials, getPikabuCredentials, deletePikabuCredentials, togglePikabuCredentials } from './pikabu-credentials';
import { parsePikabu, parseMultipleTags, parseMultipleAuthors, parseMultipleCommunities, parseFullPost, setAuthSession, hasAuthSession, areCookiesValid, Post } from './pikabu-parser';

let botInstance: TelegramBot | null = null;
let parseInterval: Timer | null = null;

export async function initBot(): Promise<TelegramBot | null> {
  const settings = await getSettings();
  if (!settings.botToken) return null;
  if (botInstance) return botInstance;
  botInstance = new TelegramBot(settings.botToken, { polling: true });
  setupHandlers(botInstance);
  setupAutoParsing();
  return botInstance;
}

export function stopBot(): void {
  if (parseInterval) clearInterval(parseInterval);
  if (botInstance) botInstance.stopPolling();
}

function getReplyKeyboard(isAdmin: boolean): TelegramBot.ReplyKeyboardMarkup {
  const buttons: string[][] = [['📦 Наборы', '👤 Авторы'], ['👥 Сообщества', '📊 Статистика']];
  if (isAdmin) buttons.push(['🔐 Аккаунт Pikabu', '⚙️ Админ']);
  else buttons.push(['🔐 Аккаунт Pikabu']);
  return { keyboard: buttons, resize_keyboard: true };
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function setupHandlers(bot: TelegramBot) {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const existing = await getUser(chatId);
    if (existing) { await showMainMenu(bot, chatId, existing); return; }
    const newUser = await createUser(chatId, { username: msg.from?.username, firstName: msg.from?.first_name, lastName: msg.from?.last_name });
    await bot.sendMessage(chatId, `🤖 *Добро пожаловать!*\n\nБот отслеживает посты на Pikabu.\n${newUser.isAdmin ? '👑 *Вы — администратор*\n' : ''}`, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard(newUser.isAdmin) });
  });

  bot.onText(/\/menu/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (user) await showMainMenu(bot, msg.chat.id, user);
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    if (text.startsWith('/')) return;
    
    const dialog = await getDialogState(chatId);
    if (dialog) { await handleDialog(bot, chatId, dialog, text); return; }
    
    const user = await getUser(chatId);
    if (!user) return;
    
    if (text === '📦 Наборы') await showSetsList(bot, chatId);
    else if (text === '👤 Авторы') await showAuthorsList(bot, chatId);
    else if (text === '👥 Сообщества') await showCommunitiesList(bot, chatId);
    else if (text === '📊 Статистика') await showUserStats(bot, chatId, user);
    else if (text === '🔐 Аккаунт Pikabu') await showPikabuAccount(bot, chatId, user);
    else if (text === '⚙️ Админ' && user.isAdmin) await showAdminPanel(bot, chatId);
    else if (user.isAdmin && text.startsWith('parse ')) { const tag = text.slice(6); await runParseTest(bot, chatId, tag); }
    else await showMainMenu(bot, chatId, user);
  });

  bot.on('callback_query', async (query) => {
    if (!query.message || !query.data) return;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    try { await handleCallback(bot, chatId, query.data, msgId); } catch (e) { console.error('[Bot] Callback error:', e); }
    try { await bot.answerCallbackQuery(query.id); } catch {}
  });
}

async function showMainMenu(bot: TelegramBot, chatId: number, user: UserData) {
  await bot.sendMessage(chatId, `🏠 *Главное меню*\n\n📦 Наборов: ${user.tagSets.length}\n👤 Авторов: ${user.authorSubs.length}\n👥 Сообществ: ${user.communitySubs?.length || 0}\n📤 Постов: ${user.postsReceived}`, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard(user.isAdmin || false) });
}

async function showUserStats(bot: TelegramBot, chatId: number, user: UserData) {
  const text = user.isAdmin
    ? `📊 *Статистика*\n\n📦 Наборов: ${user.tagSets.length}\n👤 Авторов: ${user.authorSubs.length}\n👥 Сообществ: ${user.communitySubs?.length || 0}\n📤 Постов получено: ${user.postsReceived}\n🔓 18+ авторизация: ${hasAuthSession() ? '✅' : '❌'}`
    : `📊 *Ваша статистика*\n\n📦 Наборов: ${user.tagSets.length}\n👤 Авторов: ${user.authorSubs.length}\n👥 Сообществ: ${user.communitySubs?.length || 0}\n📤 Постов: ${user.postsReceived}`;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard(user.isAdmin) });
}

async function showPikabuAccount(bot: TelegramBot, chatId: number, user: UserData) {
  const creds = await getPikabuCredentials(chatId);
  let text: string;
  let btns: TelegramBot.InlineKeyboardButton[][];
  if (creds) {
    text = `🔐 *Аккаунт Pikabu*\n\n👤 Логин: ${creds.username}\n📊 Статус: ${creds.isActive ? '✅ Активен' : '⏸ Отключён'}\n🔓 18+ контент: ${creds.isActive ? '✅ Доступен' : '❌ Нет'}`;
    btns = [[{ text: '🔄 Заменить cookies', callback_data: 'pikabu_replace' }], [{ text: creds.isActive ? '⏸ Отключить' : '▶️ Включить', callback_data: 'pikabu_toggle' }], [{ text: '🗑 Удалить', callback_data: 'pikabu_delete' }]];
  } else {
    text = `🔐 *Аккаунт Pikabu*\n\n❌ Аккаунт не привязан\n\n💡 *Инструкция:*\n1. Откройте pikabu.ru и войдите\n2. Нажмите *F12* → вкладка *Console*\n3. Вставьте: \`copy(document.cookie)\`\n4. Нажмите Enter — cookies скопируются\n5. Вставьте их здесь`;
    btns = [[{ text: '➕ Добавить cookies', callback_data: 'pikabu_add' }]];
  }
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

// ===== НАБОРЫ ТЕГОВ =====
async function showSetsList(bot: TelegramBot, chatId: number) {
  const user = await getUser(chatId);
  if (!user) return;
  if (user.tagSets.length === 0) {
    await bot.sendMessage(chatId, '📭 *Нет наборов*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '➕ Создать', callback_data: 'create_set' }]] } });
    return;
  }
  const btns = user.tagSets.map(ts => [{ text: `${ts.isActive ? '✅' : '⏸'} ${ts.name}`, callback_data: `set_${ts.id}` }]);
  btns.push([{ text: '➕ Создать', callback_data: 'create_set' }]);
  await bot.sendMessage(chatId, '📦 *Наборы тегов:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

async function showSetDetails(bot: TelegramBot, chatId: number, setId: number, msgId?: number) {
  const ts = await getTagSet(setId);
  if (!ts) return;
  const text = `📦 *${ts.name}*\n\n✅ Теги: ${ts.includeTags.map(t => '#' + t).join(' ') || '—'}\n🚫 Исключения: ${ts.excludeTags.map(t => '#' + t).join(' ') || '—'}`;
  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: ts.isActive ? '⏸ Выкл' : '▶️ Вкл', callback_data: `tgl_${setId}` }],
    [{ text: '✅ +Тег', callback_data: `addi_${setId}` }, { text: '🚫 +Исключ.', callback_data: `adde_${setId}` }],
    [{ text: '➖ Тег', callback_data: `remi_${setId}` }, { text: '➖ Исключ.', callback_data: `reme_${setId}` }],
    [{ text: '🗑 Удалить', callback_data: `del_${setId}` }],
  ];
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
}

// ===== АВТОРЫ =====
async function showAuthorsList(bot: TelegramBot, chatId: number) {
  const user = await getUser(chatId);
  if (!user) return;
  if (user.authorSubs.length === 0) {
    await bot.sendMessage(chatId, '📭 *Нет подписок*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '➕ Добавить', callback_data: 'add_author' }]] } });
    return;
  }
  const btns = user.authorSubs.map(s => [{ text: `${s.isActive ? '✅' : '⏸'} @${s.authorUsername}`, callback_data: `auth_${s.id}` }]);
  btns.push([{ text: '➕ Добавить', callback_data: 'add_author' }]);
  await bot.sendMessage(chatId, '👤 *Подписки на авторов:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

async function showAuthorDetails(bot: TelegramBot, chatId: number, subId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;
  const as = user.authorSubs.find(s => s.id === subId);
  if (!as) return;
  const text = `👤 *@${as.authorUsername}*\n\n✅ Активна: ${as.isActive ? 'Да' : 'Нет'}\n🖼 Превью: ${as.sendPreview ? 'Да' : 'Нет'}`;
  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: as.isActive ? '⏸ Выкл' : '▶️ Вкл', callback_data: `atgl_${subId}` }],
    [{ text: as.sendPreview ? '🖼 Превью: вкл' : '🖼 Превью: выкл', callback_data: `aprv_${subId}` }],
    [{ text: '🗑 Удалить', callback_data: `adel_${subId}` }],
    [{ text: '◀️ Назад', callback_data: 'back_authors' }],
  ];
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
}

// ===== СООБЩЕСТВА =====
async function showCommunitiesList(bot: TelegramBot, chatId: number) {
  const user = await getUser(chatId);
  if (!user) return;
  if (!user.communitySubs || user.communitySubs.length === 0) {
    await bot.sendMessage(chatId, '📭 *Нет подписок*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '➕ Добавить', callback_data: 'add_community' }]] } });
    return;
  }
  const btns = user.communitySubs.map(s => [{ text: `${s.isActive ? '✅' : '⏸'} ${s.communityTitle || s.communityName}`, callback_data: `comm_${s.id}` }]);
  btns.push([{ text: '➕ Добавить', callback_data: 'add_community' }]);
  await bot.sendMessage(chatId, '👥 *Подписки на сообщества:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

async function showCommunityDetails(bot: TelegramBot, chatId: number, subId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;
  const cs = user.communitySubs?.find(s => s.id === subId);
  if (!cs) return;
  const text = `👥 *${cs.communityTitle || cs.communityName}*\n\n✅ Активна: ${cs.isActive ? 'Да' : 'Нет'}\n🖼 Превью: ${cs.sendPreview ? 'Да' : 'Нет'}`;
  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: cs.isActive ? '⏸ Выкл' : '▶️ Вкл', callback_data: `ctgl_${subId}` }],
    [{ text: cs.sendPreview ? '🖼 Превью: вкл' : '🖼 Превью: выкл', callback_data: `cprv_${subId}` }],
    [{ text: '🗑 Удалить', callback_data: `cdel_${subId}` }],
    [{ text: '◀️ Назад', callback_data: 'back_communities' }],
  ];
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
}

// ===== АДМИН =====
async function showAdminPanel(bot: TelegramBot, chatId: number) {
  const stats = await getDetailedStats();
  const text = `⚙️ *Админ-панель*\n\n👥 Пользователей: ${stats.users.total} (активных: ${stats.users.active})\n📦 Наборов: ${stats.tagSets.total}\n📤 Постов: ${stats.posts.totalSent}\n❌ Ошибок: ${stats.parses.errors}`;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Парсинг', callback_data: 'adm_parse' }]] } });
}

// ===== ДИАЛОГИ =====
async function handleDialog(bot: TelegramBot, chatId: number, dialog: { state: string; data: any }, text: string) {
  switch (dialog.state) {
    case 'new_set':
      if (text.trim()) {
        const r = await createTagSet(chatId, text.trim());
        if (r.tagSet) { await bot.sendMessage(chatId, `✅ Создан "${r.tagSet.name}"`); await showSetDetails(bot, chatId, r.tagSet.id); }
      }
      await clearDialogState(chatId);
      break;
    case 'add_include':
      if (text.trim()) {
        await addIncludeTag(dialog.data.setId, text.trim().toLowerCase());
        await bot.sendMessage(chatId, `✅ Тег добавлен: #${text.trim().toLowerCase()}`);
        await showSetDetails(bot, chatId, dialog.data.setId);
      }
      await clearDialogState(chatId);
      break;
    case 'add_exclude':
      if (text.trim()) {
        await addExcludeTag(dialog.data.setId, text.trim().toLowerCase());
        await bot.sendMessage(chatId, `✅ Исключение добавлено: #${text.trim().toLowerCase()}`);
        await showSetDetails(bot, chatId, dialog.data.setId);
      }
      await clearDialogState(chatId);
      break;
    case 'remove_include': {
      const tag = text.trim().toLowerCase();
      await removeIncludeTag(dialog.data.setId, tag);
      await bot.sendMessage(chatId, `✅ Тег удалён: #${tag}`);
      await showSetDetails(bot, chatId, dialog.data.setId);
      await clearDialogState(chatId);
      break;
    }
    case 'remove_exclude': {
      const tag = text.trim().toLowerCase();
      await removeExcludeTag(dialog.data.setId, tag);
      await bot.sendMessage(chatId, `✅ Исключение удалено: #${tag}`);
      await showSetDetails(bot, chatId, dialog.data.setId);
      await clearDialogState(chatId);
      break;
    }
    case 'add_author':
      if (text.trim()) { await addAuthorSubscription(chatId, text.trim().replace('@', '')); await bot.sendMessage(chatId, `✅ Подписка на @${text.trim().replace('@', '')}`); await showAuthorsList(bot, chatId); }
      await clearDialogState(chatId);
      break;
    case 'add_community':
      if (text.trim()) { await addCommunitySubscription(chatId, text.trim().replace('@', '')); await bot.sendMessage(chatId, `✅ Подписка на сообщество @${text.trim().replace('@', '')}`); await showCommunitiesList(bot, chatId); }
      await clearDialogState(chatId);
      break;
    case 'pikabu_login':
      if (text.trim()) {
        await setDialogState(chatId, 'pikabu_cookies', { username: text.trim() });
        await bot.sendMessage(chatId, '🍪 Вставьте cookies из браузера:\n\n1. Откройте pikabu.ru и войдите\n2. Нажмите *F12* → *Console*\n3. Вставьте: \`copy(document.cookie)\`\n4. Нажмите Enter — cookies скопируются', { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'pikabu_cancel' }]] } });
      } else { await bot.sendMessage(chatId, '❌ Логин не может быть пустым'); await clearDialogState(chatId); }
      break;
    case 'pikabu_cookies':
      if (text.trim()) {
        await bot.sendMessage(chatId, '🔄 Сохранение...');
        const result = await setPikabuCredentials(chatId, dialog.data.username, text.trim());
        if (result.success) {
          setAuthSession(dialog.data.username, text.trim());
          await bot.sendMessage(chatId, `✅ *Аккаунт привязан!*\n\n👤 Логин: ${dialog.data.username}\n🔓 18+ контент: доступен`, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard((await getUser(chatId))?.isAdmin || false) });
        } else { await bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`); }
      } else { await bot.sendMessage(chatId, '❌ Cookies не могут быть пустыми'); }
      await clearDialogState(chatId);
      break;
    case 'pikabu_replace_cookies':
      if (text.trim()) {
        await bot.sendMessage(chatId, '🔄 Обновление cookies...');
        const result = await setPikabuCredentials(chatId, dialog.data.username, text.trim());
        if (result.success) {
          setAuthSession(dialog.data.username, text.trim());
          await bot.sendMessage(chatId, `✅ *Cookies успешно обновлены!*\n\n👤 Логин: ${dialog.data.username}\n🔓 18+ контент: доступен`, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard((await getUser(chatId))?.isAdmin || false) });
        } else { await bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`); }
      } else { await bot.sendMessage(chatId, '❌ Cookies не могут быть пустыми'); }
      await clearDialogState(chatId);
      break;
    default: await clearDialogState(chatId);
  }
}

// ===== CALLBACKS =====
async function handleCallback(bot: TelegramBot, chatId: number, data: string, msgId: number) {
  const user = await getUser(chatId);
  if (!user) return;

  // Tag Sets
  if (data === 'create_set') { await setDialogState(chatId, 'new_set', {}); await bot.editMessageText('📝 Название набора:', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('set_')) { await showSetDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('tgl_')) { const ts = await getTagSet(parseInt(data.split('_')[1])); if (ts) await updateTagSet(ts.id, { isActive: !ts.isActive }); await showSetDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('addi_')) { await setDialogState(chatId, 'add_include', { setId: parseInt(data.split('_')[1]) }); await bot.editMessageText('✅ Введите тег:', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('adde_')) { await setDialogState(chatId, 'add_exclude', { setId: parseInt(data.split('_')[1]) }); await bot.editMessageText('🚫 Введите тег исключения:', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('remi_')) {
    const ts = await getTagSet(parseInt(data.split('_')[1]));
    if (ts && ts.includeTags.length > 0) {
      await setDialogState(chatId, 'remove_include', { setId: ts.id });
      await bot.editMessageText(`➖ Тег для удаления:\n\n${ts.includeTags.map(t => '#' + t).join(', ')}`, { chat_id: chatId, message_id: msgId });
    }
    return;
  }
  if (data.startsWith('reme_')) {
    const ts = await getTagSet(parseInt(data.split('_')[1]));
    if (ts && ts.excludeTags.length > 0) {
      await setDialogState(chatId, 'remove_exclude', { setId: ts.id });
      await bot.editMessageText(`➖ Исключение для удаления:\n\n${ts.excludeTags.map(t => '#' + t).join(', ')}`, { chat_id: chatId, message_id: msgId });
    }
    return;
  }
  if (data.startsWith('del_')) { await deleteTagSet(parseInt(data.split('_')[1])); await showSetsList(bot, chatId); return; }

  // Authors
  if (data === 'add_author') { await setDialogState(chatId, 'add_author', {}); await bot.editMessageText('👤 Имя автора (без @):', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('auth_')) { await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('adel_')) { const s = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1])); if (s) await removeAuthorSubscription(chatId, s.authorUsername); await showAuthorsList(bot, chatId); return; }
  if (data.startsWith('atgl_')) { const s = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1])); if (s) await toggleAuthorSubscription(chatId, s.authorUsername); await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('aprv_')) { const s = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1])); if (s) await setAuthorPreviewMode(chatId, s.authorUsername, !s.sendPreview); await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }

  // Communities
  if (data === 'add_community') { await setDialogState(chatId, 'add_community', {}); await bot.editMessageText('👥 Имя сообщества (без @):', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('comm_')) { await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('cdel_')) { await removeCommunitySubscription(parseInt(data.split('_')[1])); await showCommunitiesList(bot, chatId); return; }
  if (data.startsWith('ctgl_')) { await toggleCommunitySubscription(parseInt(data.split('_')[1])); await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('cprv_')) { const cs = user.communitySubs?.find(s => s.id === parseInt(data.split('_')[1])); if (cs) await setCommunityPreviewMode(chatId, cs.communityName, !cs.sendPreview); await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }

  // Pikabu account
  if (data === 'pikabu_cancel') { await clearDialogState(chatId); await bot.deleteMessage(chatId, msgId); return; }
  if (data === 'pikabu_add') { await setDialogState(chatId, 'pikabu_login', {}); await bot.editMessageText('👤 Введите логин Pikabu:', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'pikabu_cancel' }]] } }); return; }
  if (data === 'pikabu_replace') {
    const existingCreds = await getPikabuCredentials(chatId);
    if (!existingCreds) return;
    await setDialogState(chatId, 'pikabu_replace_cookies', { username: existingCreds.username });
    await bot.editMessageText('🔄 *Замена cookies*\n\n👤 Аккаунт: ' + existingCreds.username + '\n\n🍪 Вставьте новые cookies из браузера:\n\n1. Откройте pikabu.ru и войдите\n2. Нажмите *F12* → *Console*\n3. Вставьте: \`copy(document.cookie)\`\n4. Нажмите Enter — cookies скопируются', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'pikabu_cancel' }]] } });
    return;
  }
  if (data === 'pikabu_toggle') { await togglePikabuCredentials(chatId); await showPikabuAccount(bot, chatId, (await getUser(chatId))!); return; }
  if (data === 'pikabu_delete') { await deletePikabuCredentials(chatId); await bot.editMessageText('🗑 Аккаунт удалён', { chat_id: chatId, message_id: msgId }); return; }

  // Back navigation
  if (data === 'back_authors') { await showAuthorsList(bot, chatId); return; }
  if (data === 'back_communities') { await showCommunitiesList(bot, chatId); return; }

  // Admin
  if (!user.isAdmin) return;
  if (data === 'adm_parse') {
    await bot.editMessageText('🔄 Парсинг...', { chat_id: chatId, message_id: msgId });
    const r = await runParsing(bot);
    await bot.editMessageText(r.error ? `❌ ${r.error}` : `✅ ${r.newPosts} новых, ${r.sent} отправлено`, { chat_id: chatId, message_id: msgId });
    return;
  }
}

// ===== AUTO PARSING =====
function setupAutoParsing() {
  if (parseInterval) clearInterval(parseInterval);
  parseInterval = setInterval(async () => { if (botInstance) await runParsing(botInstance); }, 10 * 60 * 1000);
  console.log('[Bot] Auto parsing: 10 min interval');
}

// ===== FULL PARSING CYCLE (tags + authors + communities) =====
async function runParsing(bot: TelegramBot): Promise<{ newPosts: number; sent: number; error?: string }> {
  console.log('[Parser] Starting parse cycle...');

  const users = await getAllActiveUsers();
  if (users.length === 0) return { newPosts: 0, sent: 0 };
  console.log(`[Parser] Processing ${users.length} users`);

  // Restore auth session from saved credentials
  const creds = await getPikabuCredentials(0);
  if (creds && creds.isActive) {
    setAuthSession(creds.username, creds.cookies);
    console.log(`[Parser] Using auth session for ${creds.username}`);
  }

  // Check if cookies are valid, warn admin if expired
  const cookieStatus = areCookiesValid();
  if (creds && creds.isActive && cookieStatus === false) {
    console.log('[Parser] ⚠️ Cookies expired, notifying admin...');
    for (const user of users) {
      if (user.isAdmin) {
        try {
          await bot.sendMessage(user.chatId, '⚠️ *Cookies Pikabu протухли!*\n\n18+ контент НЕ отображается.\n\nДля исправления:\n1. Откройте pikabu.ru и войдите\n2. Убедитесь что 18+ включён в настройках\n3. Нажмите *F12* → *Console*\n4. Вставьте: \`copy(document.cookie)\`\n5. Нажмите Enter\n6. В боте: 🔐 Аккаунт Pikabu → 🔄 Заменить cookies', { parse_mode: 'Markdown' });
        } catch {}
      }
    }
  }

  // Collect all active tags, authors, communities
  const allTags = new Set<string>();
  const allAuthors = new Set<string>();
  const allCommunities = new Set<string>();

  for (const user of users) {
    for (const ts of user.tagSets) {
      if (ts.isActive) ts.includeTags.forEach(t => allTags.add(t));
    }
    for (const as of user.authorSubs) {
      if (as.isActive) allAuthors.add(as.authorUsername);
    }
    if (user.communitySubs) {
      for (const cs of user.communitySubs) {
        if (cs.isActive) allCommunities.add(cs.communityName);
      }
    }
  }

  console.log(`[Parser] Tags: ${allTags.size}, Authors: ${allAuthors.size}, Communities: ${allCommunities.size}`);

  let posts: Post[] = [];

  // Parse by tags
  if (allTags.size > 0) {
    console.log(`[Parser] Parsing ${allTags.size} tags...`);
    const result = await parseMultipleTags([...allTags]);
    posts.push(...result.posts);
    if (result.errors.length > 0) result.errors.forEach(e => console.error(`[Parser] ${e}`));
    console.log(`[Parser] Tag posts: ${result.posts.length}`);
  }

  // Parse by authors
  if (allAuthors.size > 0) {
    console.log(`[Parser] Parsing ${allAuthors.size} authors...`);
    const result = await parseMultipleAuthors([...allAuthors]);
    posts.push(...result.posts);
    if (result.errors.length > 0) result.errors.forEach(e => console.error(`[Parser] ${e}`));
    console.log(`[Parser] Author posts: ${result.posts.length}`);
  }

  // Parse by communities
  if (allCommunities.size > 0) {
    console.log(`[Parser] Parsing ${allCommunities.size} communities...`);
    const result = await parseMultipleCommunities([...allCommunities]);
    posts.push(...result.posts);
    if (result.errors.length > 0) result.errors.forEach(e => console.error(`[Parser] ${e}`));
    console.log(`[Parser] Community posts: ${result.posts.length}`);
  }

  // Dedupe
  posts = Array.from(new Map(posts.map(p => [p.id, p])).values());
  console.log(`[Parser] Total unique posts: ${posts.length}`);

  let newPosts = 0;
  let sent = 0;

  for (const post of posts) {
    if (await isPostSeen(post.id)) continue;

    const dbPostId = await addSeenPost(post);
    newPosts++;

    for (const user of users) {
      if (user.isBlocked) continue;
      let sentToUser = false;

      // === Check tag sets (fuzzy matching) ===
      for (const ts of user.tagSets) {
        if (!ts.isActive || ts.includeTags.length === 0) continue;

        // Check exclusions (fuzzy)
        const hasExclude = ts.excludeTags.some(et =>
          post.tags.some(pt => pt.toLowerCase().includes(et.toLowerCase()) || et.toLowerCase().includes(pt.toLowerCase()))
        );
        if (hasExclude) continue;

        // Check inclusions - ALL include tags must match (AND logic, fuzzy)
        const hasInclude = ts.includeTags.every(it => {
          const itLower = it.toLowerCase();
          return post.tags.some(pt => pt.toLowerCase().includes(itLower) || itLower.includes(pt.toLowerCase()));
        });

        if (hasInclude) {
          const alreadySent = await hasUserReceivedPost(user.chatId, String(dbPostId));
          if (alreadySent) continue;
          try {
            await sendFullPost(bot, user.chatId, post, ts.name);
            await recordUserPost(user.chatId, dbPostId, false);
            await incrementUserPostsReceived(user.chatId);
            await incrementGlobalPostsSent();
            sent++;
            sentToUser = true;
            await new Promise(r => setTimeout(r, 300));
          } catch (e) { console.error('[Bot] Send error:', e); }
          break;
        }
      }

      if (sentToUser) continue;

      // === Check author subscriptions ===
      for (const as of user.authorSubs) {
        if (!as.isActive) continue;
        if (post.author.toLowerCase() === as.authorUsername.toLowerCase()) {
          const alreadySent = await hasUserReceivedPost(user.chatId, String(dbPostId));
          if (alreadySent) continue;
          try {
            await sendFullPost(bot, user.chatId, post, undefined, `@${as.authorUsername}`);
            await recordUserPost(user.chatId, dbPostId, as.sendPreview);
            await incrementUserPostsReceived(user.chatId);
            await incrementGlobalPostsSent();
            sent++;
            sentToUser = true;
            await new Promise(r => setTimeout(r, 300));
          } catch (e) { console.error('[Bot] Send error:', e); }
          break;
        }
      }

      if (sentToUser) continue;

      // === Check community subscriptions ===
      if (user.communitySubs) {
        for (const cs of user.communitySubs) {
          if (!cs.isActive) continue;
          const postHasCommunity = post.link.toLowerCase().includes(`/community/${cs.communityName.toLowerCase()}`) ||
            post.tags.some(t => t.toLowerCase() === cs.communityName.toLowerCase());
          if (postHasCommunity) {
            const alreadySent = await hasUserReceivedPost(user.chatId, String(dbPostId));
            if (alreadySent) continue;
            try {
              await sendFullPost(bot, user.chatId, post, undefined, undefined, cs.communityName);
              await recordUserPost(user.chatId, dbPostId, cs.sendPreview);
              await incrementUserPostsReceived(user.chatId);
              await incrementGlobalPostsSent();
              sent++;
              await new Promise(r => setTimeout(r, 300));
            } catch (e) { console.error('[Bot] Send error:', e); }
            break;
          }
        }
      }
    }
  }

  await recordParseTime();
  console.log(`[Parser] Done: ${newPosts} new, ${sent} sent`);
  return { newPosts, sent };
}

// ===== SEND FULL POST (text + images + videos) =====
async function sendFullPost(bot: TelegramBot, chatId: number, post: Post, setName?: string, authorName?: string, communityName?: string) {
  let text = '';
  text += `📌 *${escapeMarkdown(post.title)}*\n`;
  text += `\n🏷 ${post.tags.slice(0, 5).map(t => '#' + escapeMarkdown(t)).join(' ')}`;
  text += `\n👤 @${escapeMarkdown(post.author)}`;
  text += `\n🔗 [Ссылка](${post.link})`;
  if (setName) text += `\n📦 Набор: ${escapeMarkdown(setName)}`;
  if (authorName) text += `\n👤 Автор: ${escapeMarkdown(authorName)}`;
  if (communityName) text += `\n👥 Сообщество: ${escapeMarkdown(communityName)}`;

  // Body preview
  if (post.bodyPreview && post.bodyPreview.length > 0) {
    text += `\n\n📝 ${escapeMarkdown(post.bodyPreview)}${post.bodyPreview.length >= 200 ? '...' : ''}`;
  }

  // Videos indicator
  if (post.videos && post.videos.length > 0) {
    text += `\n🎬 Видео: ${post.videos.length} шт.`;
  }

  // 18+ marker
  if (post.is18plus) {
    text += `\n🔞 18+`;
  }

  // If no images and no body, just send text
  if (post.images.length === 0 && (!post.body || post.body.length === 0)) {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    return;
  }

  // Send text first
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });

  // Send images (up to 10)
  for (const imgUrl of post.images.slice(0, 10)) {
    try {
      await bot.sendPhoto(chatId, imgUrl);
      await new Promise(r => setTimeout(r, 200));
    } catch {
      // If image fails, send as URL
      try { await bot.sendMessage(chatId, `🖼 ${imgUrl}`); } catch {}
    }
  }
}

async function runParseTest(bot: TelegramBot, chatId: number, tag: string) {
  await bot.sendMessage(chatId, `🔄 Парсинг тега #${tag}...`);
  const result = await parsePikabu(tag);
  if (result.error) { await bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`); return; }
  await bot.sendMessage(chatId, `✅ Найдено ${result.posts.length} постов`);
  for (const post of result.posts.slice(0, 3)) {
    await sendFullPost(bot, chatId, post);
  }
}
