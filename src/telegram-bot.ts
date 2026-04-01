/**
 * Telegram Bot для парсинга Pikabu
 * Наборы тегов + подписки на авторов + превью
 */

import TelegramBot from 'node-telegram-bot-api';
import {
  getSettings, getUser, createUser, updateUser, deleteUser, getAllActiveUsers,
  getTagSet, createTagSet, updateTagSet, deleteTagSet,
  addIncludeTag, removeIncludeTag, addExcludeTag, removeExcludeTag,
  addAuthorSubscription, removeAuthorSubscription, toggleAuthorSubscription, setAuthorPreviewMode,
  getSubscribersForAuthor,
  addCommunitySubscription, removeCommunitySubscription, toggleCommunitySubscription, setCommunityPreviewMode,
  getDialogState, setDialogState, clearDialogState,
  isPostSeen, addSeenPost, hasUserReceivedPost, recordUserPost,
  getDetailedStats, getPopularTags, getPopularAuthors,
  incrementUserPostsReceived, incrementGlobalPostsSent, recordParseTime, recordParseError,
  blockUser, unblockUser,
  UserData, TagSetData, AuthorSubData, CommunitySubData, PostData,
} from './storage';
import { parsePikabu, parseMultipleTags, Post as ParserPost } from './pikabu-parser';

let botInstance: TelegramBot | null = null;
let parseInterval: Timer | null = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====

export async function initBot(): Promise<TelegramBot | null> {
  const settings = await getSettings();
  if (!settings.botToken) {
    console.log('[Bot] No token configured');
    return null;
  }
  if (botInstance) return botInstance;

  try {
    botInstance = new TelegramBot(settings.botToken, { polling: true });
    setupHandlers(botInstance);
    setupAutoParsing();
    console.log('[Bot] Initialized successfully');
    return botInstance;
  } catch (error) {
    console.error('[Bot] Init error:', error);
    return null;
  }
}

// ===== ОБРАБОТЧИКИ =====

function setupHandlers(bot: TelegramBot) {

  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const existing = await getUser(chatId);

    if (existing) {
      await showMainMenu(bot, chatId, existing);
      return;
    }

    const newUser = await createUser(chatId, {
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
    });

    const text = `
🤖 *Добро пожаловать!*

Бот отслеживает посты на Pikabu по вашим тегам и авторам.

${newUser.isAdmin ? '👑 *Вы — администратор*' : ''}

Выберите действие:
    `;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(newUser.isAdmin),
    });
  });

  // /menu
  bot.onText(/\/menu/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (user) await showMainMenu(bot, msg.chat.id, user);
  });

  // /help
  bot.onText(/\/help/, async (msg) => {
    const user = await getUser(msg.chat.id);

    const text = `
📖 *Справка*

📦 *Наборы тегов:*
Создавайте наборы с тегами отбора и исключения.

👤 *Подписки на авторов:*
Подписывайтесь на авторов и получайте уведомления об их новых постах.

${user?.isAdmin ? '👑 /admin — Админ-панель\n' : ''}/menu — Главное меню
/status — Статистика
    `;

    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  // /status
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getUser(chatId);
    if (!user) return;

    if (!user.isAdmin) {
      // Обычный пользователь - только своя статистика
      const text = `
📊 *Ваша статистика*

📦 Наборов: ${user.tagSets.length}
👤 Подписок на авторов: ${user.authorSubs.length}
📤 Постов получено: ${user.postsReceived}
      `;
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return;
    }

    // Админ - детальная статистика
    const stats = await getDetailedStats();
    const authors = await getPopularAuthors();

    const text = `
👑 *Статистика админа*

👥 Пользователей: ${stats.users.total}
📦 Наборов: ${stats.tagSets.total}
👤 Подписок: ${stats.authorSubs}
📬 Постов: ${stats.posts.totalSent} (превью: ${stats.posts.previews})

🔥 *Популярные авторы:*
${authors.slice(0, 5).map(a => `@${a.author} (${a.count})`).join('\n') || '—'}
    `;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // /admin
  bot.onText(/\/admin/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (!user?.isAdmin) {
      await bot.sendMessage(msg.chat.id, '⛔ Только для админа');
      return;
    }
    await showAdminPanel(bot, msg.chat.id);
  });

  // /users
  bot.onText(/\/users/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (!user?.isAdmin) return;
    await showUsersList(bot, msg.chat.id);
  });

  // /parse
  bot.onText(/\/parse/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (!user?.isAdmin) return;

    await bot.sendMessage(msg.chat.id, '🔄 Парсинг...');
    const result = await runParsing(bot);
    await bot.sendMessage(msg.chat.id, result.error
      ? `❌ ${result.error}`
      : `✅ Новых: ${result.newPosts}, отправлено: ${result.sent}`
    );
  });

  // /delete
  bot.onText(/\/delete/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (user?.isAdmin) {
      await bot.sendMessage(msg.chat.id, '👑 Админ не может удалить аккаунт');
      return;
    }

    await bot.sendMessage(msg.chat.id, '⚠️ Удалить данные?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Да', callback_data: 'confirm_delete' }],
          [{ text: '❌ Нет', callback_data: 'cancel_delete' }],
        ],
      },
    });
  });

  // Текстовые сообщения - только для диалогов
  bot.on('text', async (msg) => {
    if (msg.text?.startsWith('/')) return;
    const dialog = await getDialogState(msg.chat.id);
    if (dialog) {
      await handleDialog(bot, msg.chat.id, dialog, msg.text || '');
    }
  });

  // Callbacks
  bot.on('callback_query', async (query) => {
    if (!query.message?.chat.id || !query.data) return;
    await handleCallback(bot, query.message.chat.id, query.data, query.message.message_id);
    await bot.answerCallbackQuery(query.id);
  });

  bot.on('polling_error', (e) => console.error('[Bot] Polling error:', e.message));
}

// ===== МЕНЮ =====

function getMainMenuKeyboard(isAdmin: boolean): TelegramBot.InlineKeyboardMarkup {
  const buttons: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: '📦 Наборы тегов', callback_data: 'list_sets' }],
    [{ text: '👤 Подписки на авторов', callback_data: 'list_authors' }],
    [{ text: '👥 Подписки на сообщества', callback_data: 'list_communities' }],
    [{ text: '📊 Статистика', callback_data: 'status' }],
  ];

  if (isAdmin) {
    buttons.push([{ text: '👑 Админ-панель', callback_data: 'admin_panel' }]);
  }

  buttons.push([{ text: '❓ Помощь', callback_data: 'help' }]);

  return { inline_keyboard: buttons };
}

async function showMainMenu(bot: TelegramBot, chatId: number, user: UserData, msgId?: number) {
  const text = `
🤖 *Pikabu Pic Collector*

${user.isAdmin ? '👑 Администратор\n' : ''}📦 Наборов: ${user.tagSets.length}
👤 Подписок: ${user.authorSubs.length}
📤 Постов: ${user.postsReceived}
  `;

  const keyboard = getMainMenuKeyboard(user.isAdmin);

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: keyboard });
    } catch (e) {
      // Message too old, send new
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

// ===== НАБОРЫ ТЕГОВ =====

async function showSetsList(bot: TelegramBot, chatId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;

  if (user.tagSets.length === 0) {
    const text = '📭 Нет наборов';
    const btns = [[{ text: '➕ Создать', callback_data: 'create_set' }], [{ text: '◀️', callback_data: 'main_menu' }]];
    if (msgId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: btns } });
    }
    return;
  }

  const text = `📦 *Ваши наборы:*`;
  const btns: TelegramBot.InlineKeyboardButton[][] = user.tagSets.map(ts => [{
    text: `${ts.isActive ? '✅' : '⏸'} ${ts.name}`,
    callback_data: `set_${ts.id}`,
  }]);
  btns.push([{ text: '➕ Создать', callback_data: 'create_set' }]);
  btns.push([{ text: '◀️', callback_data: 'main_menu' }]);

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

async function showSetDetails(bot: TelegramBot, chatId: number, setId: number, msgId?: number) {
  const ts = await getTagSet(setId);
  if (!ts) return;

  const text = `
📦 *${ts.name}*

✅ Теги отбора: ${ts.includeTags.map(t => '#' + t).join(' ') || '—'}
🚫 Теги исключения: ${ts.excludeTags.map(t => '#' + t).join(' ') || '—'}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: ts.isActive ? '⏸ Выкл' : '▶️ Вкл', callback_data: `tgl_${setId}` }],
    [
      { text: '✅ +Тег отбора', callback_data: `addi_${setId}` },
      { text: '🚫 +Тег искл.', callback_data: `adde_${setId}` },
    ],
    [
      { text: '➖ Тег отбора', callback_data: `remi_${setId}` },
      { text: '➖ Тег искл.', callback_data: `reme_${setId}` },
    ],
    [{ text: '🗑 Удалить', callback_data: `del_${setId}` }],
    [{ text: '◀️', callback_data: 'list_sets' }],
  ];

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

// ===== ПОДПИСКИ НА АВТОРОВ =====

async function showAuthorsList(bot: TelegramBot, chatId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;

  if (user.authorSubs.length === 0) {
    const text = '📭 Нет подписок';
    const btns = [[{ text: '➕ Добавить', callback_data: 'add_author' }], [{ text: '◀️', callback_data: 'main_menu' }]];
    if (msgId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: btns } });
    }
    return;
  }

  const text = `👤 *Подписки:*`;
  const btns: TelegramBot.InlineKeyboardButton[][] = user.authorSubs.map(as => [{
    text: `${as.isActive ? '✅' : '⏸'} @${as.authorUsername}`,
    callback_data: `auth_${as.id}`,
  }]);
  btns.push([{ text: '➕ Добавить', callback_data: 'add_author' }]);
  btns.push([{ text: '◀️', callback_data: 'main_menu' }]);

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

async function showAuthorDetails(bot: TelegramBot, chatId: number, subId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;
  const as = user.authorSubs.find(s => s.id === subId);
  if (!as) return;

  const text = `
👤 *@${as.authorUsername}*

✅ Активна: ${as.isActive ? 'Да' : 'Нет'}
🖼 Превью: ${as.sendPreview ? 'Да' : 'Нет'}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: as.isActive ? '⏸ Выкл' : '▶️ Вкл', callback_data: `atgl_${subId}` }],
    [{ text: as.sendPreview ? '🖼 Превью: вкл' : '🖼 Превью: выкл', callback_data: `aprv_${subId}` }],
    [{ text: '🗑 Удалить', callback_data: `adel_${subId}` }],
    [{ text: '◀️', callback_data: 'list_authors' }],
    [{ text: '👥 Подписки на сообщества', callback_data: 'list_communities' }],
  ];

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}


// ===== ПОДПИСКИ НА СООБЩЕСТВА =====

async function showCommunitiesList(bot: TelegramBot, chatId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;

  if (!user.communitySubs || user.communitySubs.length === 0) {
    const text = '📭 Нет подписок на сообщества';
    const btns: TelegramBot.InlineKeyboardButton[][] = [
      [{ text: '➕ Добавить', callback_data: 'add_community' }],
      [{ text: '◀️', callback_data: 'main_menu' }],
    ];
    if (msgId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: btns } });
    }
    return;
  }

  const text = `👥 *Подписки на сообщества:*`;
  const btns: TelegramBot.InlineKeyboardButton[][] = user.communitySubs.map(cs => [{
    text: `${cs.isActive ? '✅' : '⏸'} @${cs.communityName}`,
    callback_data: `comm_${cs.id}`,
  }]);
  btns.push([{ text: '➕ Добавить', callback_data: 'add_community' }]);
  btns.push([{ text: '◀️', callback_data: 'main_menu' }]);

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

async function showCommunityDetails(bot: TelegramBot, chatId: number, subId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;
  const cs = user.communitySubs?.find(s => s.id === subId);
  if (!cs) return;

  const text = `
👥 *@${cs.communityName}*

✅ Активна: ${cs.isActive ? 'Да' : 'Нет'}
🖼 Превью: ${cs.sendPreview ? 'Да' : 'Нет'}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: cs.isActive ? '⏸ Выкл' : '▶️ Вкл', callback_data: `ctgl_${subId}` }],
    [{ text: cs.sendPreview ? '🖼 Превью: вкл' : '🖼 Превью: выкл', callback_data: `cprv_${subId}` }],
    [{ text: '🗑 Удалить', callback_data: `cdel_${subId}` }],
    [{ text: '◀️', callback_data: 'list_communities' }],
  ];

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

// ===== АДМИН-ПАНЕЛЬ =====

async function showAdminPanel(bot: TelegramBot, chatId: number, msgId?: number) {
  const stats = await getDetailedStats();

  const text = `
👑 *Админ-панель*

👥 Пользователей: ${stats.users.total} (активных: ${stats.users.active})
📦 Наборов: ${stats.tagSets.total} (активных: ${stats.tagSets.active})
👤 Подписок: ${stats.authorSubs}
📬 Постов: ${stats.posts.totalSent}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: '👥 Пользователи', callback_data: 'adm_users' }],
    [{ text: '🔄 Парсинг', callback_data: 'adm_parse' }],
    [{ text: '◀️', callback_data: 'main_menu' }],
  ];

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

async function showUsersList(bot: TelegramBot, chatId: number, page: number = 0, msgId?: number) {
  const users = await getAllActiveUsers();
  const pageSize = 10;
  const totalPages = Math.ceil(users.length / pageSize);
  const slice = users.slice(page * pageSize, (page + 1) * pageSize);

  const text = `👥 *Пользователи* (стр. ${page + 1}/${totalPages || 1})`;
  const btns: TelegramBot.InlineKeyboardButton[][] = slice.map(u => [{
    text: `${u.isAdmin ? '👑 ' : ''}${u.username || u.firstName || u.chatId}`,
    callback_data: `adm_u_${u.chatId}`,
  }]);

  const nav: TelegramBot.InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `adm_us_${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: '▶️', callback_data: `adm_us_${page + 1}` });
  if (nav.length > 0) btns.push(nav);
  btns.push([{ text: '◀️', callback_data: 'admin_panel' }]);

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

async function showUserDetails(bot: TelegramBot, chatId: number, targetId: number, msgId?: number) {
  const user = await getUser(targetId);
  if (!user) return;

  const text = `
👤 *Пользователь*

ID: ${user.chatId}
Username: @${user.username || '—'}
Имя: ${user.firstName || '—'}
📦 Наборов: ${user.tagSets.length}
👤 Подписок: ${user.authorSubs.length}
📤 Постов: ${user.postsReceived}
Заблокирован: ${user.isBlocked ? 'Да' : 'Нет'}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: user.isBlocked ? '🔓 Разблокировать' : '🔒 Заблокировать', callback_data: user.isBlocked ? `adm_ub_${targetId}` : `adm_b_${targetId}` }],
    [{ text: '◀️', callback_data: 'adm_users' }],
  ];

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    } catch (e) {}
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }
}

// ===== ДИАЛОГИ =====

async function handleDialog(bot: TelegramBot, chatId: number, dialog: { state: string; data: any }, text: string) {
  switch (dialog.state) {
    case 'new_set':
      if (text.trim()) {
        const result = await createTagSet(chatId, text.trim());
        if (result.tagSet) {
          await bot.sendMessage(chatId, `✅ Создан "${result.tagSet.name}"`);
          await showSetDetails(bot, chatId, result.tagSet.id);
        }
      }
      await clearDialogState(chatId);
      break;

    case 'add_include':
      if (text.trim()) {
        await addIncludeTag(dialog.data.setId, text.trim().toLowerCase());
        await bot.sendMessage(chatId, `✅ Тег отбора добавлен: #${text.trim().toLowerCase()}`);
        await showSetDetails(bot, chatId, dialog.data.setId);
      }
      await clearDialogState(chatId);
      break;

    case 'add_exclude':
      if (text.trim()) {
        await addExcludeTag(dialog.data.setId, text.trim().toLowerCase());
        await bot.sendMessage(chatId, `✅ Тег исключения добавлен: #${text.trim().toLowerCase()}`);
        await showSetDetails(bot, chatId, dialog.data.setId);
      }
      await clearDialogState(chatId);
      break;

    case 'remove_include': {
      await removeIncludeTag(dialog.data.setId, text.trim().toLowerCase());
      await showSetDetails(bot, chatId, dialog.data.setId);
      await clearDialogState(chatId);
      break;
    }

    case 'remove_exclude': {
      await removeExcludeTag(dialog.data.setId, text.trim().toLowerCase());
      await showSetDetails(bot, chatId, dialog.data.setId);
      await clearDialogState(chatId);
      break;
    }

    
    case 'add_community':
      if (text.trim()) {
        const community = text.trim().replace('@', '').toLowerCase();
        const result = await addCommunitySubscription(chatId, community);
        if (result.success) {
          await bot.sendMessage(chatId, `✅ Подписка на сообщество @${community}`);
        } else {
          await bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`);
        }
        await showCommunitiesList(bot, chatId);
      }
      await clearDialogState(chatId);
      break;

    case 'add_author':
      if (text.trim()) {
        const author = text.trim().replace('@', '').toLowerCase();
        await addAuthorSubscription(chatId, author);
        await bot.sendMessage(chatId, `✅ Подписка на @${author}`);
        await showAuthorsList(bot, chatId);
      }
      await clearDialogState(chatId);
      break;

    default:
      await clearDialogState(chatId);
  }
}

// ===== CALLBACKS =====

async function handleCallback(bot: TelegramBot, chatId: number, data: string, msgId: number) {
  const user = await getUser(chatId);
  if (!user) return;

  // Main menu
  if (data === 'main_menu') {
    await showMainMenu(bot, chatId, user, msgId);
    return;
  }

  // Tag Sets
  if (data === 'list_sets') {
    await showSetsList(bot, chatId, msgId);
    return;
  }

  if (data === 'create_set') {
    await setDialogState(chatId, 'new_set', {});
    await bot.editMessageText('📝 Название набора:', {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'list_sets' }]] },
    });
    return;
  }

  if (data.startsWith('set_')) {
    await showSetDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('tgl_')) {
    const ts = await getTagSet(parseInt(data.split('_')[1]));
    if (ts) await updateTagSet(ts.id, { isActive: !ts.isActive });
    await showSetDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('addi_')) {
    await setDialogState(chatId, 'add_include', { setId: parseInt(data.split('_')[1]) });
    await bot.editMessageText('✅ Тег отбора:', {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: `set_${data.split('_')[1]}` }]] },
    });
    return;
  }

  if (data.startsWith('adde_')) {
    await setDialogState(chatId, 'add_exclude', { setId: parseInt(data.split('_')[1]) });
    await bot.editMessageText('🚫 Тег исключения:', {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: `set_${data.split('_')[1]}` }]] },
    });
    return;
  }

  if (data.startsWith('remi_')) {
    const ts = await getTagSet(parseInt(data.split('_')[1]));
    if (ts && ts.includeTags.length > 0) {
      await setDialogState(chatId, 'remove_include', { setId: ts.id });
      await bot.editMessageText(`➖ Тег отбора для удаления:\n${ts.includeTags.map(t => '#' + t).join(', ')}`, {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: `set_${ts.id}` }]] },
      });
    }
    return;
  }

  if (data.startsWith('reme_')) {
    const ts = await getTagSet(parseInt(data.split('_')[1]));
    if (ts && ts.excludeTags.length > 0) {
      await setDialogState(chatId, 'remove_exclude', { setId: ts.id });
      await bot.editMessageText(`➖ Тег исключения для удаления:\n${ts.excludeTags.map(t => '#' + t).join(', ')}`, {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: `set_${ts.id}` }]] },
      });
    }
    return;
  }

  if (data.startsWith('del_')) {
    await deleteTagSet(parseInt(data.split('_')[1]));
    await showSetsList(bot, chatId, msgId);
    return;
  }

  // Author subscriptions
  if (data === 'list_authors') {
    await showAuthorsList(bot, chatId, msgId);
    return;
  }

  if (data === 'add_author') {
    await setDialogState(chatId, 'add_author', {});
    await bot.editMessageText('👤 Имя автора (без @):', {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'list_authors' }]] },
    });
    return;
  }

  if (data.startsWith('auth_')) {
    await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('atgl_')) {
    await toggleAuthorSubscription(parseInt(data.split('_')[1]));
    await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('aprv_')) {
    const sub = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1]));
    if (sub) await setAuthorPreviewMode(chatId, sub.authorUsername, !sub.sendPreview);
    await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  
  // Community subscriptions
  if (data === 'list_communities') {
    await showCommunitiesList(bot, chatId, msgId);
    return;
  }

  if (data === 'add_community') {
    await setDialogState(chatId, 'add_community', {});
    await bot.editMessageText('👥 Имя сообщества (без @):', {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'list_communities' }]] },
    });
    return;
  }

  if (data.startsWith('comm_')) {
    await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('ctgl_')) {
    await toggleCommunitySubscription(parseInt(data.split('_')[1]));
    await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('cprv_')) {
    const sub = user.communitySubs?.find(s => s.id === parseInt(data.split('_')[1]));
    if (sub) await setCommunityPreviewMode(chatId, sub.communityName, !sub.sendPreview);
    await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('cdel_')) {
    await removeCommunitySubscription(parseInt(data.split('_')[1]));
    await showCommunitiesList(bot, chatId, msgId);
    return;
  }

  if (data.startsWith('adel_')) {
    await removeAuthorSubscription(parseInt(data.split('_')[1]));
    await showAuthorsList(bot, chatId, msgId);
    return;
  }

  // Status
  if (data === 'status') {
    if (!user.isAdmin) {
      const text = `
📊 *Ваша статистика*

📦 Наборов: ${user.tagSets.length}
👤 Подписок: ${user.authorSubs.length}
📤 Постов: ${user.postsReceived}
      `;
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'main_menu' }]] } });
      return;
    }

    const stats = await getDetailedStats();
    const text = `
👑 *Статистика*

👥 Пользователей: ${stats.users.total}
📦 Наборов: ${stats.tagSets.total}
👤 Подписок: ${stats.authorSubs}
📬 Постов: ${stats.posts.totalSent}
    `;
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'main_menu' }]] } });
    return;
  }

  // Help
  if (data === 'help') {
    await bot.editMessageText('📖 Используйте кнопки меню', {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'main_menu' }]] },
    });
    return;
  }

  // Delete
  if (data === 'confirm_delete') {
    await deleteUser(chatId);
    await bot.editMessageText('🗑 Удалено', { chat_id: chatId, message_id: msgId });
    return;
  }

  if (data === 'cancel_delete') {
    await showMainMenu(bot, chatId, user, msgId);
    return;
  }

  // Admin
  if (!user?.isAdmin) return;

  if (data === 'admin_panel') {
    await showAdminPanel(bot, chatId, msgId);
    return;
  }

  if (data === 'adm_users' || data.startsWith('adm_us_')) {
    const page = data.includes('_us_') ? parseInt(data.split('_')[2]) : 0;
    await showUsersList(bot, chatId, page, msgId);
    return;
  }

  if (data.startsWith('adm_u_')) {
    await showUserDetails(bot, chatId, parseInt(data.split('_')[2]), msgId);
    return;
  }

  if (data.startsWith('adm_b_')) {
    await blockUser(parseInt(data.split('_')[2]));
    await showUserDetails(bot, chatId, parseInt(data.split('_')[2]), msgId);
    return;
  }

  if (data.startsWith('adm_ub_')) {
    await unblockUser(parseInt(data.split('_')[2]));
    await showUserDetails(bot, chatId, parseInt(data.split('_')[2]), msgId);
    return;
  }

  if (data === 'adm_parse') {
    await bot.editMessageText('🔄 Парсинг...', { chat_id: chatId, message_id: msgId });
    const result = await runParsing(bot);
    await bot.editMessageText(result.error ? `❌ ${result.error}` : `✅ Новых: ${result.newPosts}, отправлено: ${result.sent}`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'admin_panel' }]] } });
    return;
  }
}

// ===== ПАРСИНГ =====

function setupAutoParsing() {
  if (parseInterval) clearInterval(parseInterval);

  // Parse every 5 minutes
  parseInterval = setInterval(async () => {
    if (botInstance) {
      console.log('[Parsing] Auto parse started');
      await runParsing(botInstance);
    }
  }, 5 * 60 * 1000);

  console.log('[Bot] Auto parsing scheduled (5 min interval)');
}

async function runParsing(bot: TelegramBot): Promise<{ newPosts: number; sent: number; error?: string }> {
  const users = await getAllActiveUsers();
  if (users.length === 0) {
    return { newPosts: 0, sent: 0 };
  }

  const allTags = new Set<string>();
  const allAuthors = new Set<string>();

  for (const u of users) {
    for (const ts of u.tagSets) {
      if (ts.isActive) {
        ts.includeTags.forEach(t => allTags.add(t));
        console.log(`[Parsing] User ${u.chatId}, Set "${ts.name}": include tags [${ts.includeTags.join(', ')}]`);
      }
    }
    for (const as of u.authorSubs) {
      if (as.isActive) allAuthors.add(as.authorUsername);
    }
  }

  console.log(`[Parsing] Active users: ${users.length}`);
  console.log(`[Parsing] Total tags to parse: ${allTags.size} -> [${Array.from(allTags).join(', ')}]`);

  let posts: ParserPost[] = [];
  if (allTags.size > 0) {
    posts = await parseMultipleTags(Array.from(allTags));
  }

  console.log(`[Parsing] Fetched ${posts.length} posts`);

  let newPosts = 0;
  let sent = 0;

  for (const post of posts) {
    if (await isPostSeen(post.id)) continue;
    const dbPostId = await addSeenPost(post);
    newPosts++;

    for (const user of users) {
      if (user.isBlocked) continue;
      if (await hasUserReceivedPost(user.chatId, dbPostId)) continue;

      // Check tag sets
      for (const ts of user.tagSets) {
        if (!ts.isActive) continue;

        // Check exclusions
        const hasExclude = post.tags.some(pt =>
          ts.excludeTags.some(et =>
            pt.toLowerCase().includes(et.toLowerCase()) || et.toLowerCase().includes(pt.toLowerCase())
          )
        );

        if (hasExclude) {
          console.log(`[Parsing] Post ${post.id} excluded for set "${ts.name}"`);
          continue;
        }

        // Check inclusions - ALL include tags must match (AND logic)
        const matchedTags: string[] = [];
        const hasInclude = ts.includeTags.every(includeTag => {
          const includeTagLower = includeTag.toLowerCase();
          const found = post.tags.some(postTag => {
            const postTagLower = postTag.toLowerCase();
            return postTagLower.includes(includeTagLower) || includeTagLower.includes(postTagLower);
          });
          if (found) matchedTags.push(includeTag);
          return found;
        });

        if (hasInclude) {
          console.log(`[Parsing] MATCH! All include tags found: [${matchedTags.join(', ')}]`);
        }

        console.log(`[Parsing] Post ${post.id} tags: [${post.tags.map(t => `"${t}"`).join(',')}], Set "${ts.name}" include: [${ts.includeTags.map(t => `"${t}"`).join(',')}], matched: [${matchedTags.join(', ')}], result: ${hasInclude}`);

        if (hasInclude) {
          try {
            console.log(`[Parsing] Sending post ${post.id} to user ${user.chatId}`);
            await sendFullPost(bot, user.chatId, post, ts.name);
            await recordUserPost(user.chatId, dbPostId, false);
            await incrementUserPostsReceived(user.chatId);
            await incrementGlobalPostsSent();
            sent++;
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            console.error(`[Bot] Send error:`, e);
          }
          break;
        }
      }
    }
  }

  // Process by author subscriptions
  for (const author of allAuthors) {
    // For now, author-based parsing would require additional implementation
    // This is a placeholder for future enhancement
  }

  await recordParseTime();
  console.log(`[Parsing] Done: ${newPosts} new posts, ${sent} sent`);

  return { newPosts, sent };
}

async function sendFullPost(bot: TelegramBot, chatId: number, post: ParserPost, setName?: string) {
  let text = '';
  text += `📌 *${escapeMarkdown(post.title)}*\n`;
  text += `\n🏷 ${post.tags.slice(0, 5).map(t => '#' + escapeMarkdown(t)).join(' ')}`;
  text += `\n👤 @${escapeMarkdown(post.author)}`;
  text += `\n🔗 [Ссылка](${post.link})`;
  if (setName) text += `\n📦 Набор: ${escapeMarkdown(setName)}`;

  if (post.images.length === 0) {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    return;
  }

  // Send text first
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });

  // Send images
  for (const imgUrl of post.images.slice(0, 5)) {
    try {
      await bot.sendPhoto(chatId, imgUrl);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      // Try as URL
      try {
        await bot.sendMessage(chatId, imgUrl);
      } catch {}
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export { botInstance };

export function stopBot() {
  if (parseInterval) {
    clearInterval(parseInterval);
    parseInterval = null;
  }
  if (botInstance) {
    botInstance.stopPolling();
    botInstance = null;
  }
  console.log("[Bot] Stopped");
}

