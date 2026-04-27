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
import { parsePikabu, parseMultipleTags, parseMultipleAuthors, parseMultipleCommunities, parseFullPost, Post } from './pikabu-parser';

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
  const buttons: string[][] = [
    ['\u{1F5BC}\uFE0F \u041A\u0430\u0440\u0442\u0438\u043D\u043A\u0438', '\u{1F4F0} \u041F\u043E\u0441\u0442\u044B'],
    ['\u{1F464} \u0410\u0432\u0442\u043E\u0440\u044B', '\u{1F465} \u0421\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u0430'],
    ['\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430'],
  ];
  if (isAdmin) buttons.push(['\u2699\uFE0F \u0410\u0434\u043C\u0438\u043D']);
  return { keyboard: buttons, resize_keyboard: true };
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()\\`])/g, '\\$1');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== TAG MATCHING HELPERS =====
function matchTags(post: Post, ts: TagSetData): boolean {
  if (ts.includeTags.length === 0) return false;
  const hasExclude = ts.excludeTags.some(et =>
    post.tags.some(pt => pt.toLowerCase().includes(et.toLowerCase()) || et.toLowerCase().includes(pt.toLowerCase()))
  );
  if (hasExclude) return false;
  const hasInclude = ts.includeTags.every(it => {
    const itLower = it.toLowerCase();
    return post.tags.some(pt => pt.toLowerCase().includes(itLower) || itLower.includes(pt.toLowerCase()));
  });
  return hasInclude;
}

// ===== SET CALLBACK HELPERS =====
// Callback format: s_{type}_{action}_{id}
// type: 'img' (images) or 'pst' (posts)
function makeSC(type: string, action: string, id?: number): string {
  return id !== undefined ? `s_${type}_${action}_${id}` : `s_${type}_${action}`;
}

function setupHandlers(bot: TelegramBot) {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const existing = await getUser(chatId);
    if (existing) { await showMainMenu(bot, chatId, existing); return; }
    const newUser = await createUser(chatId, { username: msg.from?.username, firstName: msg.from?.first_name, lastName: msg.from?.last_name });
    await bot.sendMessage(chatId, '\u{1F916} *\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C!*\n\n\u0411\u043E\u0442 \u043E\u0442\u0441\u043B\u0435\u0436\u0438\u0432\u0430\u0435\u0442 \u043F\u043E\u0441\u0442\u044B \u043D\u0430 Pikabu.\n\u{1F5BC}\uFE0F \u041A\u0430\u0440\u0442\u0438\u043D\u043A\u0438 \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F \u043F\u043E \u0442\u0435\u0433\u0430\u043C\n\u{1F4F0} \u041F\u043E\u0441\u0442\u044B \u2014 \u043F\u043E\u043B\u043D\u044B\u0435 \u043F\u043E\u0441\u0442\u044B \u043F\u043E \u0442\u0435\u0433\u0430\u043C' + (newUser.isAdmin ? '\n\u{1F451} *\u0412\u044B \u2014 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440*' : ''), { parse_mode: 'Markdown', reply_markup: getReplyKeyboard(newUser.isAdmin) });
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

    if (text === '\u{1F5BC}\uFE0F \u041A\u0430\u0440\u0442\u0438\u043D\u043A\u0438') await showSetsList(bot, chatId, 'images');
    else if (text === '\u{1F4F0} \u041F\u043E\u0441\u0442\u044B') await showSetsList(bot, chatId, 'posts');
    else if (text === '\u{1F464} \u0410\u0432\u0442\u043E\u0440\u044B') await showAuthorsList(bot, chatId);
    else if (text === '\u{1F465} \u0421\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u0430') await showCommunitiesList(bot, chatId);
    else if (text === '\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430') await showUserStats(bot, chatId, user);
    else if (text === '\u2699\uFE0F \u0410\u0434\u043C\u0438\u043D' && user.isAdmin) await showAdminPanel(bot, chatId);
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
  const imgCount = user.tagSets.filter(ts => ts.type === 'images').length;
  const pstCount = user.tagSets.filter(ts => ts.type === 'posts').length;
  const text = '\u{1F3E0} *\u0413\u043B\u0430\u0432\u043D\u043E\u0435 \u043C\u0435\u043D\u044E*\n\n\u{1F5BC}\uFE0F \u041D\u0430\u0431\u043E\u0440\u043E\u0432 \u043A\u0430\u0440\u0442\u0438\u043D\u043E\u043A: ' + imgCount + '\n\u{1F4F0} \u041D\u0430\u0431\u043E\u0440\u043E\u0432 \u043F\u043E\u0441\u0442\u043E\u0432: ' + pstCount + '\n\u{1F464} \u0410\u0432\u0442\u043E\u0440\u043E\u0432: ' + user.authorSubs.length + '\n\u{1F465} \u0421\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432: ' + (user.communitySubs?.length || 0) + '\n\u{1F4E4} \u041F\u043E\u0441\u0442\u043E\u0432: ' + user.postsReceived;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard(user.isAdmin || false) });
}

async function showUserStats(bot: TelegramBot, chatId: number, user: UserData) {
  const imgCount = user.tagSets.filter(ts => ts.type === 'images').length;
  const pstCount = user.tagSets.filter(ts => ts.type === 'posts').length;
  const text = '\u{1F4CA} *\u0412\u0430\u0448\u0430 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430*\n\n\u{1F5BC}\uFE0F \u041D\u0430\u0431\u043E\u0440\u043E\u0432 \u043A\u0430\u0440\u0442\u0438\u043D\u043E\u043A: ' + imgCount + '\n\u{1F4F0} \u041D\u0430\u0431\u043E\u0440\u043E\u0432 \u043F\u043E\u0441\u0442\u043E\u0432: ' + pstCount + '\n\u{1F464} \u0410\u0432\u0442\u043E\u0440\u043E\u0432: ' + user.authorSubs.length + '\n\u{1F465} \u0421\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432: ' + (user.communitySubs?.length || 0) + '\n\u{1F4E4} \u041F\u043E\u0441\u0442\u043E\u0432: ' + user.postsReceived;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: getReplyKeyboard(user.isAdmin) });
}

// ===== TAG SETS (images + posts) =====
async function showSetsList(bot: TelegramBot, chatId: number, setType: 'images' | 'posts') {
  const user = await getUser(chatId);
  if (!user) return;
  const sets = user.tagSets.filter(ts => ts.type === setType);
  const isImg = setType === 'images';
  const title = isImg ? '\u{1F5BC}\uFE0F *\u041D\u0430\u0431\u043E\u0440\u044B \u043A\u0430\u0440\u0442\u0438\u043D\u043E\u043A:*' : '\u{1F4F0} *\u041D\u0430\u0431\u043E\u0440\u044B \u043F\u043E\u0441\u0442\u043E\u0432:*';
  const prefix = isImg ? 'img' : 'pst';

  if (sets.length === 0) {
    await bot.sendMessage(chatId, '\u{1F4ED} *\u041D\u0435\u0442 \u043D\u0430\u0431\u043E\u0440\u043E\u0432*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '\u2795 \u0421\u043E\u0437\u0434\u0430\u0442\u044C', callback_data: makeSC(prefix, 'create') }]] } });
    return;
  }
  const btns = sets.map(ts => [{ text: (ts.isActive ? '\u2705' : '\u23F8') + ' ' + ts.name, callback_data: makeSC(prefix, 'det', ts.id) }]);
  btns.push([{ text: '\u2795 \u0421\u043E\u0437\u0434\u0430\u0442\u044C', callback_data: makeSC(prefix, 'create') }]);
  await bot.sendMessage(chatId, title, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

async function showSetDetails(bot: TelegramBot, chatId: number, setId: number, setType: 'images' | 'posts', msgId?: number) {
  const ts = await getTagSet(setId);
  if (!ts) return;
  const prefix = ts.type === 'images' ? 'img' : 'pst';
  const typeIcon = ts.type === 'images' ? '\u{1F5BC}\uFE0F' : '\u{1F4F0}';
  const text = typeIcon + ' *' + ts.name + '*\n\n\u2705 \u0422\u0435\u0433\u0438: ' + (ts.includeTags.map(t => '#' + t).join(' ') || '\u2014') + '\n\u{1F6AB} \u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F: ' + (ts.excludeTags.map(t => '#' + t).join(' ') || '\u2014');
  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: ts.isActive ? '\u23F8 \u0412\u044B\u043A\u043B' : '\u25B6\uFE0F \u0412\u043A\u043B', callback_data: makeSC(prefix, 'tgl', ts.id) }],
    [{ text: '\u2705 +\u0422\u0435\u0433', callback_data: makeSC(prefix, 'addi', ts.id) }, { text: '\u{1F6AB} +\u0418\u0441\u043A\u043B.', callback_data: makeSC(prefix, 'adde', ts.id) }],
    [{ text: '\u2796 \u0422\u0435\u0433', callback_data: makeSC(prefix, 'remi', ts.id) }, { text: '\u2796 \u0418\u0441\u043A\u043B.', callback_data: makeSC(prefix, 'reme', ts.id) }],
    [{ text: '\u{1F5D1} \u0423\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: makeSC(prefix, 'del', ts.id) }],
    [{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: makeSC(prefix, 'back') }],
  ];
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
}

// ===== \u0410\u0412\u0422\u041E\u0420\u042B =====
async function showAuthorsList(bot: TelegramBot, chatId: number) {
  const user = await getUser(chatId);
  if (!user) return;
  if (user.authorSubs.length === 0) {
    await bot.sendMessage(chatId, '\u{1F4ED} *\u041D\u0435\u0442 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '\u2795 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', callback_data: 'add_author' }]] } });
    return;
  }
  const btns = user.authorSubs.map(s => [{ text: (s.isActive ? '\u2705' : '\u23F8') + ' @' + s.authorUsername, callback_data: 'auth_' + s.id }]);
  btns.push([{ text: '\u2795 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', callback_data: 'add_author' }]);
  await bot.sendMessage(chatId, '\u{1F464} *\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438 \u043D\u0430 \u0430\u0432\u0442\u043E\u0440\u043E\u0432:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

async function showAuthorDetails(bot: TelegramBot, chatId: number, subId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;
  const as = user.authorSubs.find(s => s.id === subId);
  if (!as) return;
  const previewIcon = as.sendPreview ? '\u{1F441}\uFE0F' : '\u{1F4DD}';
  const previewLabel = as.sendPreview ? '\u041F\u0440\u0435\u0432\u044C\u044E (Instant View)' : '\u041F\u043E\u043B\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442';
  const text = '\u{1F464} *@' + as.authorUsername + '*\n\n\u2705 \u0410\u043A\u0442\u0438\u0432\u043D\u0430: ' + (as.isActive ? '\u0414\u0430' : '\u041D\u0435\u0442') + '\n' + previewIcon + ' \u0420\u0435\u0436\u0438\u043C: ' + previewLabel;
  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: as.isActive ? '\u23F8 \u0412\u044B\u043A\u043B' : '\u25B6\uFE0F \u0412\u043A\u043B', callback_data: 'atgl_' + subId }],
    [{ text: (as.sendPreview ? '\u{1F4DD} \u041F\u043E\u043B\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442' : '\u{1F441}\uFE0F \u041F\u0440\u0435\u0432\u044C\u044E (IV)'), callback_data: 'aprev_' + subId }],
    [{ text: '\u{1F5D1} \u0423\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: 'adel_' + subId }],
    [{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: 'back_authors' }],
  ];
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
}

// ===== \u0421\u041E\u041E\u0411\u0429\u0415\u0421\u0422\u0412\u0410 =====
async function showCommunitiesList(bot: TelegramBot, chatId: number) {
  const user = await getUser(chatId);
  if (!user) return;
  if (!user.communitySubs || user.communitySubs.length === 0) {
    await bot.sendMessage(chatId, '\u{1F4ED} *\u041D\u0435\u0442 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '\u2795 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', callback_data: 'add_community' }]] } });
    return;
  }
  const btns = user.communitySubs.map(s => [{ text: (s.isActive ? '\u2705' : '\u23F8') + ' ' + (s.communityTitle || s.communityName), callback_data: 'comm_' + s.id }]);
  btns.push([{ text: '\u2795 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', callback_data: 'add_community' }]);
  await bot.sendMessage(chatId, '\u{1F465} *\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438 \u043D\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u0430:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

async function showCommunityDetails(bot: TelegramBot, chatId: number, subId: number, msgId?: number) {
  const user = await getUser(chatId);
  if (!user) return;
  const cs = user.communitySubs?.find(s => s.id === subId);
  if (!cs) return;
  const previewIcon = cs.sendPreview ? '\u{1F441}\uFE0F' : '\u{1F4DD}';
  const previewLabel = cs.sendPreview ? '\u041F\u0440\u0435\u0432\u044C\u044E (Instant View)' : '\u041F\u043E\u043B\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442';
  const text = '\u{1F465} *' + (cs.communityTitle || cs.communityName) + '*\n\n\u2705 \u0410\u043A\u0442\u0438\u0432\u043D\u0430: ' + (cs.isActive ? '\u0414\u0430' : '\u041D\u0435\u0442') + '\n' + previewIcon + ' \u0420\u0435\u0436\u0438\u043C: ' + previewLabel;
  const btns: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: cs.isActive ? '\u23F8 \u0412\u044B\u043A\u043B' : '\u25B6\uFE0F \u0412\u043A\u043B', callback_data: 'ctgl_' + subId }],
    [{ text: (cs.sendPreview ? '\u{1F4DD} \u041F\u043E\u043B\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442' : '\u{1F441}\uFE0F \u041F\u0440\u0435\u0432\u044C\u044E (IV)'), callback_data: 'cprev_' + subId }],
    [{ text: '\u{1F5D1} \u0423\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: 'cdel_' + subId }],
    [{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: 'back_communities' }],
  ];
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
  catch { await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } }); }
}

// ===== \u0410\u0414\u041C\u0418\u041D =====
async function showAdminPanel(bot: TelegramBot, chatId: number) {
  const stats = await getDetailedStats();
  const text = '\u2699\uFE0F *\u0410\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C*\n\n\u{1F465} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439: ' + stats.users.total + ' (\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445: ' + stats.users.active + ')\n\u{1F4E6} \u041D\u0430\u0431\u043E\u0440\u043E\u0432: ' + stats.tagSets.total + '\n\u{1F4E4} \u041F\u043E\u0441\u0442\u043E\u0432: ' + stats.posts.totalSent + '\u274C \u041E\u0448\u0438\u0431\u043E\u043A: ' + stats.parses.errors;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '\u{1F504} \u041F\u0430\u0440\u0441\u0438\u043D\u0433', callback_data: 'adm_parse' }]] } });
}

// ===== \u0414\u0418\u0410\u041B\u041E\u0413\u0418 =====
async function handleDialog(bot: TelegramBot, chatId: number, dialog: { state: string; data: any }, text: string) {
  switch (dialog.state) {
    case 'new_set': {
      const setType = (dialog.data.setType || 'images') as 'images' | 'posts';
      if (text.trim()) {
        const r = await createTagSet(chatId, text.trim(), setType);
        if (r.tagSet) {
          await bot.sendMessage(chatId, '\u2705 \u0421\u043E\u0437\u0434\u0430\u043D "' + r.tagSet.name + '"');
          await showSetDetails(bot, chatId, r.tagSet.id, setType);
        } else if (r.error) {
          await bot.sendMessage(chatId, '\u274C ' + r.error);
        }
      }
      await clearDialogState(chatId);
      break;
    }
    case 'add_include':
      if (text.trim()) {
        await addIncludeTag(dialog.data.setId, text.trim().toLowerCase());
        await bot.sendMessage(chatId, '\u2705 \u0422\u0435\u0433 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D: #' + text.trim().toLowerCase());
        await showSetDetails(bot, chatId, dialog.data.setId, dialog.data.setType || 'images');
      }
      await clearDialogState(chatId);
      break;
    case 'add_exclude':
      if (text.trim()) {
        await addExcludeTag(dialog.data.setId, text.trim().toLowerCase());
        await bot.sendMessage(chatId, '\u2705 \u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E: #' + text.trim().toLowerCase());
        await showSetDetails(bot, chatId, dialog.data.setId, dialog.data.setType || 'images');
      }
      await clearDialogState(chatId);
      break;
    case 'remove_include': {
      const tag = text.trim().toLowerCase();
      await removeIncludeTag(dialog.data.setId, tag);
      await bot.sendMessage(chatId, '\u2705 \u0422\u0435\u0433 \u0443\u0434\u0430\u043B\u0451\u043D: #' + tag);
      await showSetDetails(bot, chatId, dialog.data.setId, dialog.data.setType || 'images');
      await clearDialogState(chatId);
      break;
    }
    case 'remove_exclude': {
      const tag = text.trim().toLowerCase();
      await removeExcludeTag(dialog.data.setId, tag);
      await bot.sendMessage(chatId, '\u2705 \u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E: #' + tag);
      await showSetDetails(bot, chatId, dialog.data.setId, dialog.data.setType || 'images');
      await clearDialogState(chatId);
      break;
    }
    case 'add_author':
      if (text.trim()) { await addAuthorSubscription(chatId, text.trim().replace('@', '')); await bot.sendMessage(chatId, '\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u043D\u0430 @' + text.trim().replace('@', '')); await showAuthorsList(bot, chatId); }
      await clearDialogState(chatId);
      break;
    case 'add_community':
      if (text.trim()) { await addCommunitySubscription(chatId, text.trim().replace('@', '')); await bot.sendMessage(chatId, '\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u043D\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u043E @' + text.trim().replace('@', '')); await showCommunitiesList(bot, chatId); }
      await clearDialogState(chatId);
      break;
    default: await clearDialogState(chatId);
  }
}

// ===== CALLBACKS =====
async function handleCallback(bot: TelegramBot, chatId: number, data: string, msgId: number) {
  const user = await getUser(chatId);
  if (!user) return;

  // Image set callbacks (s_img_*)
  if (data === 's_img_create') { await setDialogState(chatId, 'new_set', { setType: 'images' }); await bot.editMessageText('\u{1F5BC}\uFE0F \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u0430\u0431\u043E\u0440\u0430:', { chat_id: chatId, message_id: msgId }); return; }
  if (data === 's_img_back') { await showSetsList(bot, chatId, 'images'); return; }

  // Post set callbacks (s_pst_*)
  if (data === 's_pst_create') { await setDialogState(chatId, 'new_set', { setType: 'posts' }); await bot.editMessageText('\u{1F4F0} \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u0430\u0431\u043E\u0440\u0430:', { chat_id: chatId, message_id: msgId }); return; }
  if (data === 's_pst_back') { await showSetsList(bot, chatId, 'posts'); return; }

  // Generic set callbacks: s_{img|pst}_{action}_{id}
  const setMatch = data.match(/^s_(img|pst)_(tgl|addi|adde|remi|reme|del|det)_(\d+)$/);
  if (setMatch) {
    const setType = setMatch[1] as 'images' | 'posts';
    const action = setMatch[2];
    const setId = parseInt(setMatch[3]);

    if (action === 'det') { await showSetDetails(bot, chatId, setId, setType, msgId); return; }
    if (action === 'tgl') { const ts = await getTagSet(setId); if (ts) await updateTagSet(ts.id, { isActive: !ts.isActive }); await showSetDetails(bot, chatId, setId, setType, msgId); return; }
    if (action === 'del') { await deleteTagSet(setId); await showSetsList(bot, chatId, setType); return; }
    if (action === 'addi') { await setDialogState(chatId, 'add_include', { setId, setType }); await bot.editMessageText('\u2705 \u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u0433:', { chat_id: chatId, message_id: msgId }); return; }
    if (action === 'adde') { await setDialogState(chatId, 'add_exclude', { setId, setType }); await bot.editMessageText('\u{1F6AB} \u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u0433 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F:', { chat_id: chatId, message_id: msgId }); return; }
    if (action === 'remi') {
      const ts = await getTagSet(setId);
      if (ts && ts.includeTags.length > 0) {
        await setDialogState(chatId, 'remove_include', { setId, setType });
        await bot.editMessageText('\u2796 \u0422\u0435\u0433 \u0434\u043B\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F:\n\n' + ts.includeTags.map(t => '#' + t).join(', '), { chat_id: chatId, message_id: msgId });
      }
      return;
    }
    if (action === 'reme') {
      const ts = await getTagSet(setId);
      if (ts && ts.excludeTags.length > 0) {
        await setDialogState(chatId, 'remove_exclude', { setId, setType });
        await bot.editMessageText('\u2796 \u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F:\n\n' + ts.excludeTags.map(t => '#' + t).join(', '), { chat_id: chatId, message_id: msgId });
      }
      return;
    }
  }

  // Authors
  if (data === 'add_author') { await setDialogState(chatId, 'add_author', {}); await bot.editMessageText('\u{1F464} \u0418\u043C\u044F \u0430\u0432\u0442\u043E\u0440\u0430 (\u0431\u0435\u0437 @):', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('auth_')) { await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('adel_')) { const s = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1])); if (s) await removeAuthorSubscription(chatId, s.authorUsername); await showAuthorsList(bot, chatId); return; }
  if (data.startsWith('atgl_')) { const s = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1])); if (s) await toggleAuthorSubscription(chatId, s.authorUsername); await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('aprev_')) { const s = user.authorSubs.find(s => s.id === parseInt(data.split('_')[1])); if (s) await setAuthorPreviewMode(chatId, s.authorUsername, !s.sendPreview); await showAuthorDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }

  // Communities
  if (data === 'add_community') { await setDialogState(chatId, 'add_community', {}); await bot.editMessageText('\u{1F465} \u0418\u043C\u044F \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u0430 (\u0431\u0435\u0437 @):', { chat_id: chatId, message_id: msgId }); return; }
  if (data.startsWith('comm_')) { await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('cdel_')) { await removeCommunitySubscription(parseInt(data.split('_')[1])); await showCommunitiesList(bot, chatId); return; }
  if (data.startsWith('ctgl_')) { await toggleCommunitySubscription(parseInt(data.split('_')[1])); await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }
  if (data.startsWith('cprev_')) { const cs = user.communitySubs?.find(s => s.id === parseInt(data.split('_')[1])); if (cs) await setCommunityPreviewMode(chatId, cs.communityName, !cs.sendPreview); await showCommunityDetails(bot, chatId, parseInt(data.split('_')[1]), msgId); return; }

  // Back navigation
  if (data === 'back_authors') { await showAuthorsList(bot, chatId); return; }
  if (data === 'back_communities') { await showCommunitiesList(bot, chatId); return; }

  // Admin
  if (!user.isAdmin) return;
  if (data === 'adm_parse') {
    await bot.editMessageText('\u{1F504} \u041F\u0430\u0440\u0441\u0438\u043D\u0433...', { chat_id: chatId, message_id: msgId });
    const r = await runParsing(bot);
    await bot.editMessageText(r.error ? '\u274C ' + r.error : '\u2705 ' + r.newPosts + ' \u043D\u043E\u0432\u044B\u0445, ' + r.sent + ' \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E', { chat_id: chatId, message_id: msgId });
    return;
  }
}

// ===== AUTO PARSING =====
function setupAutoParsing() {
  if (parseInterval) clearInterval(parseInterval);
  parseInterval = setInterval(async () => { if (botInstance) await runParsing(botInstance); }, 10 * 60 * 1000);
  console.log('[Bot] Auto parsing: 10 min interval');
}

// ===== FULL PARSING CYCLE =====
async function runParsing(bot: TelegramBot): Promise<{ newPosts: number; sent: number; error?: string }> {
  console.log('[Parser] Starting parse cycle...');

  const users = await getAllActiveUsers();
  if (users.length === 0) return { newPosts: 0, sent: 0 };
  console.log('[Parser] Processing ' + users.length + ' users');

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

  console.log('[Parser] Tags: ' + allTags.size + ', Authors: ' + allAuthors.size + ', Communities: ' + allCommunities.size);

  let posts: Post[] = [];

  // Parse by tags
  if (allTags.size > 0) {
    console.log('[Parser] Parsing ' + allTags.size + ' tags...');
    const result = await parseMultipleTags([...allTags]);
    posts.push(...result.posts);
    if (result.errors.length > 0) result.errors.forEach(e => console.error('[Parser] ' + e));
    console.log('[Parser] Tag posts: ' + result.posts.length);
  }

  // Parse by authors
  if (allAuthors.size > 0) {
    console.log('[Parser] Parsing ' + allAuthors.size + ' authors...');
    const result = await parseMultipleAuthors([...allAuthors]);
    posts.push(...result.posts);
    if (result.errors.length > 0) result.errors.forEach(e => console.error('[Parser] ' + e));
    console.log('[Parser] Author posts: ' + result.posts.length);
  }

  // Parse by communities
  if (allCommunities.size > 0) {
    console.log('[Parser] Parsing ' + allCommunities.size + ' communities...');
    const result = await parseMultipleCommunities([...allCommunities]);
    posts.push(...result.posts);
    if (result.errors.length > 0) result.errors.forEach(e => console.error('[Parser] ' + e));
    console.log('[Parser] Community posts: ' + result.posts.length);
  }

  // Dedupe
  posts = Array.from(new Map(posts.map(p => [p.id, p])).values());
  console.log('[Parser] Total unique posts: ' + posts.length);

  let newPosts = 0;
  let sent = 0;

  for (const post of posts) {
    if (await isPostSeen(post.id)) continue;

    const dbPostId = await addSeenPost(post);
    newPosts++;

    for (const user of users) {
      if (user.isBlocked) continue;
      let sentToUser = false;

      // === 1. IMAGE TAG SETS ===
      for (const ts of user.tagSets) {
        if (ts.type !== 'images' || !ts.isActive) continue;
        if (!matchTags(post, ts)) continue;
        if (post.images.length === 0) continue; // Skip posts without images

        const alreadySent = await hasUserReceivedPost(user.chatId, post.id);
        if (alreadySent) continue;
        try {
          await sendImagesOnly(bot, user.chatId, post, ts.name);
          await recordUserPost(user.chatId, dbPostId, false);
          await incrementUserPostsReceived(user.chatId);
          await incrementGlobalPostsSent();
          sent++;
          sentToUser = true;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { console.error('[Bot] Send error:', e); }
        break;
      }

      if (sentToUser) continue;

      // === 2. POST TAG SETS ===
      for (const ts of user.tagSets) {
        if (ts.type !== 'posts' || !ts.isActive) continue;
        if (!matchTags(post, ts)) continue;

        const alreadySent = await hasUserReceivedPost(user.chatId, post.id);
        if (alreadySent) continue;
        try {
          await sendPostWithSpoiler(bot, user.chatId, post, ts.name);
          await recordUserPost(user.chatId, dbPostId, false);
          await incrementUserPostsReceived(user.chatId);
          await incrementGlobalPostsSent();
          sent++;
          sentToUser = true;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { console.error('[Bot] Send error:', e); }
        break;
      }

      if (sentToUser) continue;

      // === 3. AUTHOR SUBSCRIPTIONS (preview or full post) ===
      for (const as of user.authorSubs) {
        if (!as.isActive) continue;
        if (post.author.toLowerCase() !== as.authorUsername.toLowerCase()) continue;

        const alreadySent = await hasUserReceivedPost(user.chatId, post.id);
        if (alreadySent) continue;
        try {
          if (as.sendPreview) {
            await sendPostPreview(bot, user.chatId, post, '\u0410\u0432\u0442\u043E\u0440: @' + as.authorUsername);
          } else {
            await sendPostWithSpoiler(bot, user.chatId, post, undefined, '\u0410\u0432\u0442\u043E\u0440: @' + as.authorUsername);
          }
          await recordUserPost(user.chatId, dbPostId, as.sendPreview);
          await incrementUserPostsReceived(user.chatId);
          await incrementGlobalPostsSent();
          sent++;
          sentToUser = true;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { console.error('[Bot] Send error:', e); }
        break;
      }

      if (sentToUser) continue;

      // === 4. COMMUNITY SUBSCRIPTIONS (preview or full post) ===
      if (user.communitySubs) {
        for (const cs of user.communitySubs) {
          if (!cs.isActive) continue;
          const postHasCommunity = post.link.toLowerCase().includes('/community/' + cs.communityName.toLowerCase()) ||
            post.tags.some(t => t.toLowerCase() === cs.communityName.toLowerCase());
          if (!postHasCommunity) continue;

          const alreadySent = await hasUserReceivedPost(user.chatId, post.id);
          if (alreadySent) continue;
          try {
            if (cs.sendPreview) {
              await sendPostPreview(bot, user.chatId, post, undefined, cs.communityTitle || cs.communityName);
            } else {
              await sendPostWithSpoiler(bot, user.chatId, post, undefined, undefined, cs.communityTitle || cs.communityName);
            }
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

  await recordParseTime();
  console.log('[Parser] Done: ' + newPosts + ' new, ' + sent + ' sent');
  return { newPosts, sent };
}

// ===== SEND IMAGES ONLY (for image tag sets) =====
async function sendImagesOnly(bot: TelegramBot, chatId: number, post: Post, setName?: string) {
  if (post.images.length === 0) return;

  let text = '<b>\u{1F4CC} ' + escapeHtml(post.title) + '</b>';
  text += '\n\n\u{1F3A8} ' + post.tags.slice(0, 5).map(t => '#' + escapeHtml(t)).join(' ');
  text += '\n\u{1F464} @' + escapeHtml(post.author);
  if (setName) text += '\n\u{1F4E6} ' + escapeHtml(setName);
  text += '\n\n\u{1F517} <a href="' + post.link + '">\u0421\u0441\u044B\u043B\u043A\u0430</a>';
  if (post.is18plus) text += '\n\u{1F51E} 18+';

  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });

  for (const imgUrl of post.images.slice(0, 10)) {
    try {
      await bot.sendPhoto(chatId, imgUrl);
      await new Promise(r => setTimeout(r, 200));
    } catch {
      try { await bot.sendMessage(chatId, '\u{1F5BC}\uFE0F ' + imgUrl); } catch {}
    }
  }
}

// ===== SEND POST PREVIEW (Instant View mode) =====
async function sendPostPreview(bot: TelegramBot, chatId: number, post: Post, authorLabel?: string, communityLabel?: string) {
  let text = '<b>' + escapeHtml(post.title) + '</b>';
  text += '\n\n';
  text += escapeHtml(post.bodyPreview || post.body || '').slice(0, 200);
  if ((post.body || post.bodyPreview || '').length > 200) text += '...';
  text += '\n\n\u{1F3A8} ' + post.tags.slice(0, 5).map(t => '#' + escapeHtml(t)).join(' ');
  text += '\n\u{1F464} @' + escapeHtml(post.author);
  if (authorLabel) text += '\n' + escapeHtml(authorLabel);
  if (communityLabel) text += '\n' + escapeHtml(communityLabel);
  text += '\n\u{1F517} <a href="' + post.link + '">\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u043E\u0441\u0442</a>';
  if (post.is18plus) text += '\n\u{1F51E} 18+';

  // disable_web_page_preview: false — чтобы Telegram показал Instant View
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: false });
}

// ===== SEND FULL POST WITH SPOILER (for post sets, authors, communities) =====
async function sendPostWithSpoiler(bot: TelegramBot, chatId: number, post: Post, setName?: string, authorLabel?: string, communityLabel?: string, showLinkPreview: boolean = false) {
  let text = '<b>\u{1F4CC} ' + escapeHtml(post.title) + '</b>';
  text += '\n\n\u{1F3A8} ' + post.tags.slice(0, 5).map(t => '#' + escapeHtml(t)).join(' ');
  text += '\n\u{1F464} @' + escapeHtml(post.author);
  text += '\n\u{1F517} <a href="' + post.link + '">\u0421\u0441\u044B\u043B\u043A\u0430</a>';
  if (setName) text += '\n\u{1F4E6} ' + escapeHtml(setName);
  if (authorLabel) text += '\n\u{1F464} ' + escapeHtml(authorLabel);
  if (communityLabel) text += '\n\u{1F465} ' + escapeHtml(communityLabel);

  // Body with spoiler for long text
  const body = post.body || post.bodyPreview || '';
  if (body.length > 0) {
    text += '\n\n\u{1F4DD} ';
    if (body.length > 300) {
      text += '<tg-spoiler>' + escapeHtml(body) + '</tg-spoiler>';
    } else {
      text += escapeHtml(body);
    }
  }

  // Videos
  if (post.videos && post.videos.length > 0) {
    text += '\n\n\u{1F3AC} \u0412\u0438\u0434\u0435\u043E: ' + post.videos.length + ' \u0448\u0442.';
  }

  if (post.is18plus) {
    text += '\n\u{1F51E} 18+';
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: !showLinkPreview });

  // Send images
  for (const imgUrl of post.images.slice(0, 10)) {
    try {
      await bot.sendPhoto(chatId, imgUrl);
      await new Promise(r => setTimeout(r, 200));
    } catch {
      try { await bot.sendMessage(chatId, '\u{1F5BC}\uFE0F ' + imgUrl); } catch {}
    }
  }
}

async function runParseTest(bot: TelegramBot, chatId: number, tag: string) {
  await bot.sendMessage(chatId, '\u{1F504} \u041F\u0430\u0440\u0441\u0438\u043D\u0433 \u0442\u0435\u0433\u0430 #' + tag + '...');
  const result = await parsePikabu(tag);
  if (result.error) { await bot.sendMessage(chatId, '\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ' + result.error); return; }
  await bot.sendMessage(chatId, '\u2705 \u041D\u0430\u0439\u0434\u0435\u043D\u043E ' + result.posts.length + ' \u043F\u043E\u0441\u0442\u043E\u0432');
  for (const post of result.posts.slice(0, 3)) {
    await sendPostWithSpoiler(bot, chatId, post);
  }
}