/**
 * Telegram Bot for Pikabu parsing
 * Tag sets + author subscriptions + preview
 */

import TelegramBot from 'node-telegram-bot-api';
import {
  getSettings, getUser, createUser, updateUser, deleteUser, getAllActiveUsers,
  getTagSet, createTagSet, updateTagSet, deleteTagSet,
  addIncludeTag, removeIncludeTag, addExcludeTag, removeExcludeTag,
  addAuthorSubscription, removeAuthorSubscription, toggleAuthorSubscription, setAuthorPreviewMode,
  getSubscribersForAuthor,
  getDialogState, setDialogState, clearDialogState,
  isPostSeen, addSeenPost, hasUserReceivedPost, recordUserPost,
  getDetailedStats, getPopularTags, getPopularAuthors,
  incrementUserPostsReceived, incrementGlobalPostsSent, recordParseTime, recordParseError,
  blockUser, unblockUser,
  UserData, TagSetData, AuthorSubData, PostData,
} from './storage';
import { parsePikabu, parseMultipleTags, Post as ParserPost } from './pikabu-parser';

let botInstance: TelegramBot | null = null;
let parseInterval: Timer | null = null;

// ===== INITIALIZATION =====

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

// ===== HANDLERS =====

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
🤖 *Welcome!*

Bot tracks Pikabu posts by your tags and authors.

${newUser.isAdmin ? '👑 *You are admin*' : ''}

Choose action:
    `;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: getReplyKeyboard(newUser.isAdmin),
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
📖 *Help*

📦 *Tag Sets:*
Create sets with include and exclude tags.

👤 *Author Subscriptions:*
Subscribe to authors and get notifications.

${user?.isAdmin ? '👑 /admin — Admin panel\n' : ''}/menu — Main menu
/status — Statistics
    `;

    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  // /status
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getUser(chatId);
    if (!user) return;

    if (!user.isAdmin) {
      const text = `
📊 *Your Stats*

📦 Sets: ${user.tagSets.length}
👤 Subscriptions: ${user.authorSubs.length}
📤 Posts received: ${user.postsReceived}
      `;
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return;
    }

    // Admin stats
    const stats = await getDetailedStats();
    const authors = await getPopularAuthors();

    const text = `
👑 *Admin Stats*

👥 Users: ${stats.users.total}
📦 Sets: ${stats.tagSets.total}
👤 Subs: ${stats.authorSubs}
📬 Posts: ${stats.posts.totalSent} (preview: ${stats.posts.previews})

🔥 *Top Authors:*
${authors.slice(0, 5).map(a => `@${a.author} (${a.count})`).join('\n') || '—'}
    `;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // /admin
  bot.onText(/\/admin/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (!user?.isAdmin) {
      await bot.sendMessage(msg.chat.id, '⛔ Admin only');
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

    await bot.sendMessage(msg.chat.id, '🔄 Parsing...');
    const result = await runParsing(bot);
    await bot.sendMessage(msg.chat.id, result.error
      ? `❌ ${result.error}`
      : `✅ New: ${result.newPosts}, sent: ${result.sent}`
    );
  });

  // /delete
  bot.onText(/\/delete/, async (msg) => {
    const user = await getUser(msg.chat.id);
    if (user?.isAdmin) {
      await bot.sendMessage(msg.chat.id, '👑 Admin cannot delete account');
      return;
    }

    await bot.sendMessage(msg.chat.id, '⚠️ Delete data?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Yes', callback_data: 'confirm_delete' }],
          [{ text: '❌ No', callback_data: 'cancel_delete' }],
        ],
      },
    });
  });

  // Text messages (including reply keyboard buttons)
  bot.on('text', async (msg) => {
    if (msg.text?.startsWith('/')) return;
    const chatId = msg.chat.id;
    const text = msg.text || '';

    console.log(`[Bot] Text message from ${chatId}: "${text}"`);

    // Check for dialog state first
    const dialog = await getDialogState(chatId);
    if (dialog) {
      console.log(`[Bot] Dialog state: ${dialog.state}`);
      await handleDialog(bot, chatId, dialog, text);
      return;
    }

    // Handle reply keyboard button texts
    const user = await getUser(chatId);
    if (!user) {
      console.log(`[Bot] User ${chatId} not found`);
      return;
    }

    // Map button texts to actions
    switch (text) {
      case '📦 Tag Sets':
      case 'Tag Sets':
        console.log(`[Bot] Showing Tag Sets for ${chatId}`);
        await showSetsList(bot, chatId);
        break;
      case '👤 Author Subs':
      case 'Author Subs':
        console.log(`[Bot] Showing Author Subs for ${chatId}`);
        await showAuthorsList(bot, chatId);
        break;
      case '📊 Statistics':
      case 'Statistics':
        console.log(`[Bot] Showing Statistics for ${chatId}`);
        await showMainMenu(bot, chatId, user);
        break;
      case '👑 Admin Panel':
      case 'Admin Panel':
        if (user.isAdmin) {
          console.log(`[Bot] Showing Admin Panel for ${chatId}`);
          await showAdminPanel(bot, chatId);
        }
        break;
      case '❓ Help':
      case 'Help':
        await bot.sendMessage(chatId, '📖 Use menu buttons or commands: /menu, /status, /help');
        break;
      case '◀️ Back':
      case 'Back':
        await showMainMenu(bot, chatId, user);
        break;
      default:
        console.log(`[Bot] Unknown text from ${chatId}: "${text}"`);
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

// ===== MENUS =====

function getMainMenuKeyboard(isAdmin: boolean): TelegramBot.InlineKeyboardMarkup {
  const buttons: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: '📦 Tag Sets', callback_data: 'list_sets' }],
    [{ text: '👤 Author Subs', callback_data: 'list_authors' }],
    [{ text: '📊 Statistics', callback_data: 'status' }],
  ];

  if (isAdmin) {
    buttons.push([{ text: '👑 Admin Panel', callback_data: 'admin_panel' }]);
  }

  buttons.push([{ text: '❓ Help', callback_data: 'help' }]);

  return { inline_keyboard: buttons };
}

// Reply Keyboard (buttons at bottom of screen)
function getReplyKeyboard(isAdmin: boolean): TelegramBot.ReplyKeyboardMarkup {
  const buttons: TelegramBot.KeyboardButton[][] = [
    [{ text: '📦 Tag Sets' }, { text: '👤 Author Subs' }],
    [{ text: '📊 Statistics' }],
  ];

  if (isAdmin) {
    buttons.push([{ text: '👑 Admin Panel' }]);
  }

  buttons.push([{ text: '❓ Help' }]);

  return { keyboard: buttons, resize_keyboard: true, one_time_keyboard: false };
}

async function showMainMenu(bot: TelegramBot, chatId: number, user: UserData, msgId?: number) {
  const text = `
🤖 *Pikabu Pic Collector*

${user.isAdmin ? '👑 Admin\n' : ''}📦 Sets: ${user.tagSets.length}
👤 Subs: ${user.authorSubs.length}
📤 Posts: ${user.postsReceived}
  `;

  const inlineKeyboard = getMainMenuKeyboard(user.isAdmin);
  const replyKeyboard = getReplyKeyboard(user.isAdmin);

  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: inlineKeyboard });
    } catch (e) {
      // Message may be too old, send new with reply keyboard
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: replyKeyboard });
    }
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: replyKeyboard });
  }
}

// ===== TAG SETS =====

async function showSetsList(bot: TelegramBot, chatId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;

  if (user.tagSets.length === 0) {
    const text = '📭 No tag sets';
    const btns = [[{ text: '➕ Create', callback_data: 'create_set' }], [{ text: '◀️', callback_data: 'main_menu' }]];
    if (msgId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: btns } });
    }
    return;
  }

  const text = `📦 *Your Sets:*`;
  const btns: TelegramBot.InlineKeyboardButton[][] = user.tagSets.map(ts => [{
    text: `${ts.isActive ? '✅' : '⏸'} ${ts.name}`,
    callback_data: `set_${ts.id}`,
  }]);
  btns.push([{ text: '➕ Create', callback_data: 'create_set' }]);
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

${ts.isActive ? '✅ Active' : '⏸ Paused'}

✅ Include: ${ts.includeTags.map(t => '#' + t).join(' ') || '—'}
🚫 Exclude: ${ts.excludeTags.map(t => '#' + t).join(' ') || '—'}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: ts.isActive ? '⏸ Off' : '▶️ On', callback_data: `tgl_${setId}` }],
    [{ text: '✅ +Include', callback_data: `addi_${setId}` }, { text: '🚫 +Exclude', callback_data: `adde_${setId}` }],
    [{ text: '🗑 Delete', callback_data: `del_${setId}` }],
    [{ text: '◀️', callback_data: 'list_sets' }],
  ];

  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  } catch (e) {}
}

// ===== AUTHOR SUBSCRIPTIONS =====

async function showAuthorsList(bot: TelegramBot, chatId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;

  if (user.authorSubs.length === 0) {
    const text = '📭 No author subscriptions';
    const btns = [[{ text: '➕ Subscribe', callback_data: 'add_author' }], [{ text: '◀️', callback_data: 'main_menu' }]];
    if (msgId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: btns } });
    }
    return;
  }

  const text = `👤 *Author Subscriptions:*`;
  const btns: TelegramBot.InlineKeyboardButton[][] = user.authorSubs.map(as => [{
    text: `${as.isActive ? '✅' : '⏸'} @${as.authorUsername}${as.sendPreview ? ' 📝' : ' 🖼'}`,
    callback_data: `auth_${as.id}`,
  }]);
  btns.push([{ text: '➕ Subscribe', callback_data: 'add_author' }]);
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

  const sub = user.authorSubs.find(s => s.id === subId);
  if (!sub) return;

  const text = `
👤 *@${sub.authorUsername}*

${sub.isActive ? '✅ Active' : '⏸ Paused'}
📝 Mode: ${sub.sendPreview ? 'Preview' : 'Full post'}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: sub.isActive ? '⏸ Off' : '▶️ On', callback_data: `tgla_${sub.authorUsername}` }],
    [{ text: sub.sendPreview ? '🖼 Full' : '📝 Preview', callback_data: `prev_${sub.authorUsername}` }],
    [{ text: '🗑 Unsubscribe', callback_data: `unsub_${sub.authorUsername}` }],
    [{ text: '◀️', callback_data: 'list_authors' }],
  ];

  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  } catch (e) {}
}

// ===== ADMIN PANEL =====

async function showAdminPanel(bot: TelegramBot, chatId: number, msgId?: number) {
  const stats = await getDetailedStats();

  const text = `
👑 *Admin Panel*

👥 Users: ${stats.users.total}
📦 Sets: ${stats.tagSets.total}
👤 Subs: ${stats.authorSubs}
📬 Posts: ${stats.posts.totalSent}
  `;

  const btns = [
    [{ text: '👥 Users', callback_data: 'adm_users' }],
    [{ text: '📊 Statistics', callback_data: 'adm_stats' }],
    [{ text: '🔥 Authors', callback_data: 'adm_authors' }],
    [{ text: '🔄 Parsing', callback_data: 'adm_parse' }],
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
  const { getAllUsers } = await import('./storage');
  const users = await getAllUsers();
  const perPage = 5;
  const pages = Math.ceil(users.length / perPage);
  const slice = users.slice(page * perPage, (page + 1) * perPage);

  const text = `👥 *Users* (${users.length})`;

  const btns: TelegramBot.InlineKeyboardButton[][] = slice.map(u => [{
    text: `${u.isBlocked ? '🚫' : u.isActive ? '✅' : '⏸'} ${u.firstName || u.username || u.chatId}${u.isAdmin ? ' 👑' : ''}`,
    callback_data: `adm_u_${u.chatId}`,
  }]);

  const nav: TelegramBot.InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `adm_us_${page - 1}` });
  nav.push({ text: '🔙', callback_data: 'admin_panel' });
  if (page < pages - 1) nav.push({ text: '▶️', callback_data: `adm_us_${page + 1}` });
  btns.push(nav);

  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  } catch (e) {}
}

async function showUserDetails(bot: TelegramBot, chatId: number, targetId: number, msgId?: number) {
  const user = await getUser(targetId);
  if (!user) return;

  const text = `
👤 *${user.firstName || user.username || targetId}*

🆔 \`${user.chatId}\`
👤 @${user.username || '—'}
📊 ${user.isBlocked ? '🚫 Blocked' : user.isActive ? '✅ Active' : '⏸'}
📦 Sets: ${user.tagSets.length}
👤 Subs: ${user.authorSubs.length}
📤 Posts: ${user.postsReceived}
  `;

  const btns: TelegramBot.InlineKeyboardButton[][] = [];

  if (!user.isAdmin) {
    btns.push([{
      text: user.isBlocked ? '✅ Unblock' : '🚫 Block',
      callback_data: user.isBlocked ? `adm_ub_${targetId}` : `adm_b_${targetId}`,
    }]);
  }

  btns.push([{ text: '◀️', callback_data: 'adm_users' }]);

  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  } catch (e) {}
}

async function showAdminStats(bot: TelegramBot, chatId: number, msgId?: number) {
  const stats = await getDetailedStats();
  const tags = await getPopularTags();
  const authors = await getPopularAuthors();

  const text = `
📊 *Detailed Stats*

👥 Users: ${stats.users.total} (active: ${stats.users.active})
📦 Sets: ${stats.tagSets.total}
👤 Subs: ${stats.authorSubs}
📬 Posts: ${stats.posts.totalSent} (preview: ${stats.posts.previews})

🔥 *Top Tags:*
${tags.slice(0, 5).map(t => `#${t.tag} (${t.count})`).join(', ')}

🔥 *Top Authors:*
${authors.slice(0, 5).map(a => `@${a.author} (${a.count})`).join(', ')}
  `;

  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'admin_panel' }]] } });
  } catch (e) {}
}

async function showAdminAuthors(bot: TelegramBot, chatId: number, msgId?: number) {
  const authors = await getPopularAuthors();

  const text = `
🔥 *Popular Authors*

${authors.length > 0
    ? authors.map((a, i) => `${i + 1}. @${a.author} — ${a.count} subscribers`).join('\n')
    : 'No subscriptions yet'}
  `;

  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'admin_panel' }]] } });
  } catch (e) {}
}

// ===== CALLBACK HANDLER =====

async function handleCallback(bot: TelegramBot, chatId: number, data: string, msgId?: number) {
  const user = await getUser(chatId);

  // Main menu
  if (data === 'main_menu') {
    if (user) await showMainMenu(bot, chatId, user, msgId);
    return;
  }

  // Tag Sets
  if (data === 'list_sets') {
    await showSetsList(bot, chatId, msgId);
    return;
  }

  if (data === 'create_set') {
    await setDialogState(chatId, 'new_set', {});
    try {
      await bot.editMessageText('📝 Set name:', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'list_sets' }]] },
      });
    } catch (e) {}
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
    await setDialogState(chatId, 'add_inc', { setId: parseInt(data.split('_')[1]) });
    try {
      await bot.editMessageText('✅ Include tag:', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: `set_${data.split('_')[1]}` }]] },
      });
    } catch (e) {}
    return;
  }

  if (data.startsWith('adde_')) {
    await setDialogState(chatId, 'add_exc', { setId: parseInt(data.split('_')[1]) });
    try {
      await bot.editMessageText('🚫 Exclude tag:', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: `set_${data.split('_')[1]}` }]] },
      });
    } catch (e) {}
    return;
  }

  if (data.startsWith('del_')) {
    const setId = parseInt(data.split('_')[1]);
    try {
      await bot.editMessageText('⚠️ Delete?', {
        chat_id: chatId, message_id: msgId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅', callback_data: `cdel_${setId}` }, { text: '❌', callback_data: `set_${setId}` }],
          ],
        },
      });
    } catch (e) {}
    return;
  }

  if (data.startsWith('cdel_')) {
    await deleteTagSet(parseInt(data.split('_')[1]));
    await showSetsList(bot, chatId, msgId);
    return;
  }

  // Author Subscriptions
  if (data === 'list_authors') {
    await showAuthorsList(bot, chatId, msgId);
    return;
  }

  if (data === 'add_author') {
    await setDialogState(chatId, 'new_author', {});
    try {
      await bot.editMessageText('👤 Author username (without @):', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌', callback_data: 'list_authors' }]] },
      });
    } catch (e) {}
    return;
  }

  if (data.startsWith('auth_')) {
    await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId);
    return;
  }

  if (data.startsWith('tgla_')) {
    const author = data.split('_')[1];
    await toggleAuthorSubscription(chatId, author);
    await showAuthorsList(bot, chatId, msgId);
    return;
  }

  if (data.startsWith('prev_')) {
    const author = data.split('_')[1];
    const u = await getUser(chatId);
    const sub = u?.authorSubs.find(s => s.authorUsername === author);
    if (sub) await setAuthorPreviewMode(chatId, author, !sub.sendPreview);
    await showAuthorsList(bot, chatId, msgId);
    return;
  }

  if (data.startsWith('unsub_')) {
    await removeAuthorSubscription(chatId, data.split('_')[1]);
    await showAuthorsList(bot, chatId, msgId);
    return;
  }

  // Statistics
  if (data === 'status') {
    const u = await getUser(chatId);
    if (u) await showMainMenu(bot, chatId, u, msgId);
    return;
  }

  // Help
  if (data === 'help') {
    try {
      await bot.editMessageText('📖 Use menu buttons', {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'main_menu' }]] },
      });
    } catch (e) {}
    return;
  }

  // Delete
  if (data === 'confirm_delete') {
    await deleteUser(chatId);
    try {
      await bot.editMessageText('🗑 Deleted', { chat_id: chatId, message_id: msgId });
    } catch (e) {}
    return;
  }

  if (data === 'cancel_delete') {
    const u = await getUser(chatId);
    if (u) await showMainMenu(bot, chatId, u, msgId);
    return;
  }

  // Admin Panel
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

  if (data === 'adm_stats') {
    await showAdminStats(bot, chatId, msgId);
    return;
  }

  if (data === 'adm_authors') {
    await showAdminAuthors(bot, chatId, msgId);
    return;
  }

  if (data === 'adm_parse') {
    try {
      await bot.editMessageText('🔄 Parsing...', { chat_id: chatId, message_id: msgId });
    } catch (e) {}
    const result = await runParsing(bot);
    try {
      await bot.editMessageText(result.error ? `❌ ${result.error}` : `✅ ${result.newPosts} / ${result.sent}`, {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '◀️', callback_data: 'admin_panel' }]] },
      });
    } catch (e) {}
    return;
  }
}

// ===== DIALOG HANDLER =====

async function handleDialog(bot: TelegramBot, chatId: number, dialog: { state: string; data: any }, text: string) {
  const trimmed = text.trim();

  // Create set
  if (dialog.state === 'new_set') {
    if (trimmed.length < 2 || trimmed.length > 50) {
      await bot.sendMessage(chatId, '❌ 2-50 characters');
      return;
    }

    const result = await createTagSet(chatId, trimmed);

    if (!result.success) {
      await bot.sendMessage(chatId, `❌ ${result.error}`);
      return;
    }

    await clearDialogState(chatId);
    await bot.sendMessage(chatId, `✅ Created "${result.tagSet!.name}"`);
    await showSetDetails(bot, chatId, result.tagSet!.id);
    return;
  }

  // Add include tag
  if (dialog.state === 'add_inc') {
    const setId = dialog.data?.setId;
    if (!setId) return;

    const result = await addIncludeTag(setId, trimmed);

    await clearDialogState(chatId);
    await bot.sendMessage(chatId, result.success ? `✅ Added #${trimmed.toLowerCase()}` : `❌ ${result.error}`);
    await showSetDetails(bot, chatId, setId);
    return;
  }

  // Add exclude tag
  if (dialog.state === 'add_exc') {
    const setId = dialog.data?.setId;
    if (!setId) return;

    const result = await addExcludeTag(setId, trimmed);

    await clearDialogState(chatId);
    await bot.sendMessage(chatId, result.success ? `🚫 Added #${trimmed.toLowerCase()}` : `❌ ${result.error}`);
    await showSetDetails(bot, chatId, setId);
    return;
  }

  // Subscribe to author
  if (dialog.state === 'new_author') {
    const normalized = trimmed.toLowerCase().replace(/^@/, '');

    if (normalized.length < 2) {
      await bot.sendMessage(chatId, '❌ Min 2 characters');
      return;
    }

    const result = await addAuthorSubscription(chatId, normalized);

    await clearDialogState(chatId);
    await bot.sendMessage(chatId, result.success ? `✅ Subscribed to @${normalized}` : `❌ ${result.error}`);
    await showAuthorsList(bot, chatId);
    return;
  }
}

// ===== PARSING =====

async function setupAutoParsing() {
  const settings = await getSettings();

  if (parseInterval) clearInterval(parseInterval);

  parseInterval = setInterval(async () => {
    if (botInstance && settings.isActive) {
      console.log('[Bot] Scheduled parsing...');
      await runParsing(botInstance);
    }
  }, settings.parseIntervalMinutes * 60 * 1000);
}

export async function runParsing(bot: TelegramBot): Promise<{ newPosts: number; sent: number; error?: string }> {
  const users = await getAllActiveUsers();

  // Collect all tags
  const allTags = new Set<string>();
  for (const u of users) {
    for (const ts of u.tagSets) {
      if (ts.isActive) ts.includeTags.forEach(t => allTags.add(t));
    }
  }

  if (allTags.size === 0) {
    return { newPosts: 0, sent: 0, error: 'No tags' };
  }

  let posts: ParserPost[];

  try {
    posts = await parseMultipleTags(Array.from(allTags));
    await recordParseTime();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    await recordParseError(msg);
    return { newPosts: 0, sent: 0, error: msg };
  }

  let newPosts = 0;
  let sent = 0;

  for (const post of posts) {
    if (await isPostSeen(post.id)) continue;

    newPosts++;

    // Save post
    const dbPostId = await addSeenPost({
      id: post.id,
      title: post.title,
      link: post.link,
      author: post.author,
      authorName: post.authorName,
      rating: post.rating,
      images: post.images,
      tags: post.tags,
      bodyPreview: post.bodyPreview,
      commentsCount: post.commentsCount,
      parsedAt: post.parsedAt,
    });

    // Process by tag sets
    for (const user of users) {
      if (await hasUserReceivedPost(user.chatId, post.id)) continue;

      for (const ts of user.tagSets) {
        if (!ts.isActive) continue;

        // Check exclusions
        const hasExclude = post.tags.some(pt =>
          ts.excludeTags.some(et =>
            pt.toLowerCase().includes(et.toLowerCase()) || et.toLowerCase().includes(pt.toLowerCase())
          )
        );

        if (hasExclude) continue;

        // Check inclusions
        const hasInclude = post.tags.some(pt =>
          ts.includeTags.some(it =>
            pt.toLowerCase().includes(it.toLowerCase()) || it.toLowerCase().includes(pt.toLowerCase())
          )
        );

        if (hasInclude) {
          try {
            await sendFullPost(bot, user.chatId, post, ts.name);
            await recordUserPost(user.chatId, dbPostId, false);
            await incrementUserPostsReceived(user.chatId);
            sent++;
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            console.error(`[Bot] Send error:`, e);
          }
          break;
        }
      }
    }

    // Process by author subscriptions
    if (post.author) {
      const subscribers = await getSubscribersForAuthor(post.author);

      for (const sub of subscribers) {
        const subData = sub.authorSubs.find(s => s.authorUsername === post.author?.toLowerCase());
        if (!subData || !subData.isActive) continue;
        if (await hasUserReceivedPost(sub.chatId, post.id)) continue;

        try {
          if (subData.sendPreview) {
            await sendPreviewPost(bot, sub.chatId, post);
          } else {
            await sendFullPost(bot, sub.chatId, post);
          }

          await recordUserPost(sub.chatId, dbPostId, subData.sendPreview);
          await incrementUserPostsReceived(sub.chatId);
          sent++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error(`[Bot] Send error to ${sub.chatId}:`, e);
        }
      }
    }
  }

  await incrementGlobalPostsSent(sent);
  return { newPosts, sent };
}

// ===== SEND POSTS =====

async function sendFullPost(bot: TelegramBot, chatId: number, post: ParserPost, setName?: string): Promise<void> {
  const tags = post.tags.slice(0, 10).map(t => `#${t}`).join(' ');
  const header = setName ? `📦 ${setName}\n\n` : '';
  const caption = `${header}<b>${escapeHtml(post.title)}</b>\n\n${tags}\n\n🔗 <a href="${post.link}">Open</a> | 👤 @${post.author} | ⭐ ${post.rating}`;

  if (post.images.length === 1) {
    await bot.sendPhoto(chatId, post.images[0], { caption, parse_mode: 'HTML' });
  } else if (post.images.length > 1) {
    await bot.sendMediaGroup(chatId, post.images.slice(0, 10).map((img, i) => ({
      type: 'photo' as const,
      media: img,
      caption: i === 0 ? caption : undefined,
      parse_mode: 'HTML' as const,
    })));
  }
}

async function sendPreviewPost(bot: TelegramBot, chatId: number, post: ParserPost): Promise<void> {
  const preview = post.bodyPreview?.slice(0, 200) || '';
  const caption = `<b>${escapeHtml(post.title)}</b>\n\n${preview}${preview.length >= 200 ? '...' : ''}\n\n👤 @${post.author} | ⭐ ${post.rating} | 💬 ${post.commentsCount}\n\n🔗 <a href="${post.link}">Open</a>`;

  const image = post.images[0];

  if (image) {
    await bot.sendPhoto(chatId, image, { caption, parse_mode: 'HTML' });
  } else {
    await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', disable_web_page_preview: false });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== EXPORT =====

export function getBot() { return botInstance; }
export function isBotReady() { return !!botInstance; }

export function stopBot() {
  if (parseInterval) clearInterval(parseInterval);
  if (botInstance) { botInstance.stopPolling(); botInstance = null; }
}

export async function restartBot(newToken?: string) {
  stopBot();
  if (newToken) {
    await updateSettings({ botToken: newToken });
  }
  return (await initBot()) !== null;
}
