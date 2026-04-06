/**
 * Data storage using sql.js (pure JavaScript SQLite)
 * No native dependencies needed
 */

import initSqlJs, { Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ===== TYPES =====

export interface UserData {
  id: number;
  chatId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive: boolean;
  isAdmin: boolean;
  isBlocked: boolean;
  joinedAt: string;
  lastActivityAt: string;
  postsReceived: number;
  tagSets: TagSetData[];
  authorSubs: AuthorSubData[];
  communitySubs: CommunitySubData[];
}

export interface TagSetData {
  id: number;
  name: string;
  isActive: boolean;
  includeTags: string[];
  excludeTags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthorSubData {
  id: number;
  authorUsername: string;
  authorName?: string | null;
  isActive: boolean;
  sendPreview: boolean;
  createdAt: string;
}

export interface CommunitySubData {
  id: number;
  communityName: string;
  communityTitle?: string | null;
  isActive: boolean;
  sendPreview: boolean;
  createdAt: string;
}

export interface PostData {
  id: string;
  title: string;
  link: string;
  author?: string;
  authorName?: string;
  rating: number;
  images: string[];
  tags: string[];
  bodyPreview?: string;
  commentsCount: number;
  parsedAt: string;
}

export interface BotSettings {
  botToken: string | null;
  parseIntervalMinutes: number;
  maxTagSetsPerUser: number;
  maxTagsPerSet: number;
  maxAuthorSubs: number;
  isActive: boolean;
}

// ===== DATABASE =====

let db: Database | null = null;
let dbPath: string;

export async function initDatabase(): Promise<void> {
  dbPath = process.env.DATABASE_PATH || '/app/data/bot.db';

  // Ensure directory exists
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database or create new
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    console.log(`[DB] Loaded existing database from ${dbPath}`);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database');
  }

  // Create tables
  createTables();
  saveDatabase();
}

function createTables(): void {
  if (!db) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      botToken TEXT,
      parseIntervalMinutes INTEGER DEFAULT 10,
      maxTagSetsPerUser INTEGER DEFAULT 10,
      maxTagsPerSet INTEGER DEFAULT 20,
      maxAuthorSubs INTEGER DEFAULT 20,
      isActive INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT UNIQUE NOT NULL,
      username TEXT,
      firstName TEXT,
      lastName TEXT,
      isActive INTEGER DEFAULT 1,
      isAdmin INTEGER DEFAULT 0,
      isBlocked INTEGER DEFAULT 0,
      joinedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      lastActivityAt TEXT DEFAULT CURRENT_TIMESTAMP,
      postsReceived INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tagSets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      includeTags TEXT DEFAULT '[]',
      excludeTags TEXT DEFAULT '[]',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS authorSubscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      authorUsername TEXT NOT NULL,
      authorName TEXT,
      isActive INTEGER DEFAULT 1,
      sendPreview INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, authorUsername)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS communitySubscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      communityName TEXT NOT NULL,
      communityTitle TEXT,
      isActive INTEGER DEFAULT 1,
      sendPreview INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, communityName)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS seenPosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId TEXT UNIQUE NOT NULL,
      title TEXT,
      link TEXT,
      author TEXT,
      authorName TEXT,
      rating INTEGER DEFAULT 0,
      images TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      bodyPreview TEXT,
      commentsCount INTEGER DEFAULT 0,
      parsedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS userPosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      postId INTEGER NOT NULL,
      isPreview INTEGER DEFAULT 0,
      sentAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (postId) REFERENCES seenPosts(id) ON DELETE CASCADE,
      UNIQUE(userId, postId)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS dialogStates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT UNIQUE NOT NULL,
      state TEXT NOT NULL,
      data TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS globalStats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      totalUsers INTEGER DEFAULT 0,
      totalPostsSent INTEGER DEFAULT 0,
      totalPreviews INTEGER DEFAULT 0,
      totalParses INTEGER DEFAULT 0,
      parseErrors INTEGER DEFAULT 0,
      lastParseAt TEXT,
      lastError TEXT,
      lastErrorAt TEXT
    )
  `);

  // Insert default settings
  db.run(`
    INSERT OR IGNORE INTO settings (id, isActive)
    VALUES (1, 1)
  `);

  // Insert default global stats
  db.run(`
    INSERT OR IGNORE INTO globalStats (id)
    VALUES (1)
  `);

  console.log('[DB] Tables created/verified');
}

export function saveDatabase(): void {
  if (!db || !dbPath) return;

  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  } catch (e) {
    console.error('[DB] Save error:', e);
  }
}

// Auto-save every 30 seconds
let saveInterval: Timer | null = null;

export function startAutoSave(): void {
  if (saveInterval) clearInterval(saveInterval);
  saveInterval = setInterval(saveDatabase, 30000);
}

export function closeDatabase(): void {
  if (saveInterval) clearInterval(saveInterval);
  saveDatabase();
  if (db) {
    db.close();
    db = null;
  }
}

// ===== HELPER FUNCTIONS =====

function run(sql: string, params: any[] = []): any {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
  return { lastInsertRowId: (db as any).exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] };
}

function get<T = any>(sql: string, params: any[] = []): T | undefined {
  if (!db) throw new Error('Database not initialized');
  const result = db.exec(sql, params);
  if (result.length === 0 || result[0].values.length === 0) return undefined;

  const columns = result[0].columns;
  const values = result[0].values[0];

  const obj: any = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });

  return obj;
}

function all<T = any>(sql: string, params: any[] = []): T[] {
  if (!db) throw new Error('Database not initialized');
  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj: any = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// ===== SETTINGS =====

export async function getSettings(): Promise<BotSettings> {
  const settings = get<any>('SELECT * FROM settings WHERE id = 1');
  if (!settings) {
    run('INSERT INTO settings (id) VALUES (1)');
    return getSettings();
  }
  return {
    botToken: settings.botToken,
    parseIntervalMinutes: settings.parseIntervalMinutes || 10,
    maxTagSetsPerUser: settings.maxTagSetsPerUser || 10,
    maxTagsPerSet: settings.maxTagsPerSet || 20,
    maxAuthorSubs: settings.maxAuthorSubs || 20,
    isActive: !!settings.isActive,
  };
}

export async function updateSettings(updates: Partial<BotSettings>): Promise<BotSettings> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.botToken !== undefined) { fields.push('botToken = ?'); values.push(updates.botToken); }
  if (updates.parseIntervalMinutes !== undefined) { fields.push('parseIntervalMinutes = ?'); values.push(updates.parseIntervalMinutes); }
  if (updates.maxTagSetsPerUser !== undefined) { fields.push('maxTagSetsPerUser = ?'); values.push(updates.maxTagSetsPerUser); }
  if (updates.maxTagsPerSet !== undefined) { fields.push('maxTagsPerSet = ?'); values.push(updates.maxTagsPerSet); }
  if (updates.maxAuthorSubs !== undefined) { fields.push('maxAuthorSubs = ?'); values.push(updates.maxAuthorSubs); }
  if (updates.isActive !== undefined) { fields.push('isActive = ?'); values.push(updates.isActive ? 1 : 0); }

  if (fields.length > 0) {
    run(`UPDATE settings SET ${fields.join(', ')} WHERE id = 1`, values);
    saveDatabase();
  }

  return getSettings();
}

// ===== USERS =====

export async function getUser(chatId: number): Promise<UserData | null> {
  const user = get<any>('SELECT * FROM users WHERE chatId = ?', [String(chatId)]);
  if (!user) return null;

  const tagSets = all<any>('SELECT * FROM tagSets WHERE userId = ? ORDER BY createdAt ASC', [user.id]);
  const authorSubs = all<any>('SELECT * FROM authorSubscriptions WHERE userId = ? ORDER BY createdAt DESC', [user.id]);
  const communitySubs = all<any>('SELECT * FROM communitySubscriptions WHERE userId = ? ORDER BY createdAt DESC', [user.id]);

  return {
    id: user.id,
    chatId: Number(user.chatId),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: !!user.isActive,
    isAdmin: !!user.isAdmin,
    isBlocked: !!user.isBlocked,
    joinedAt: user.joinedAt,
    lastActivityAt: user.lastActivityAt,
    postsReceived: user.postsReceived || 0,
    tagSets: tagSets.map(mapTagSet),
    authorSubs: authorSubs.map(mapAuthorSub),
    communitySubs: communitySubs.map(mapCommunitySub),
  };
}

function mapTagSet(ts: any): TagSetData {
  return {
    id: ts.id,
    name: ts.name,
    isActive: !!ts.isActive,
    includeTags: JSON.parse(ts.includeTags || '[]'),
    excludeTags: JSON.parse(ts.excludeTags || '[]'),
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
  };
}

function mapAuthorSub(as: any): AuthorSubData {
  return {
    id: as.id,
    authorUsername: as.authorUsername,
    authorName: as.authorName,
    isActive: !!as.isActive,
    sendPreview: !!as.sendPreview,
    createdAt: as.createdAt,
  };
}

function mapCommunitySub(cs: any): CommunitySubData {
  return {
    id: cs.id,
    communityName: cs.communityName,
    communityTitle: cs.communityTitle,
    isActive: !!cs.isActive,
    sendPreview: !!cs.sendPreview,
    createdAt: cs.createdAt,
  };
}

export async function createUser(
  chatId: number,
  userInfo?: { username?: string; firstName?: string; lastName?: string }
): Promise<UserData> {
  const adminExists = get<any>('SELECT id FROM users WHERE isAdmin = 1');

  const result = run(
    `INSERT INTO users (chatId, username, firstName, lastName, isAdmin)
     VALUES (?, ?, ?, ?, ?)`,
    [
      String(chatId),
      userInfo?.username || null,
      userInfo?.firstName || null,
      userInfo?.lastName || null,
      adminExists ? 0 : 1,
    ]
  );

  run('UPDATE globalStats SET totalUsers = (SELECT COUNT(*) FROM users) WHERE id = 1');

  saveDatabase();
  return (await getUser(chatId))!;
}

export async function updateUser(chatId: number, updates: Partial<Omit<UserData, 'chatId' | 'tagSets' | 'authorSubs' | 'id'>>): Promise<UserData | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username); }
  if (updates.firstName !== undefined) { fields.push('firstName = ?'); values.push(updates.firstName); }
  if (updates.lastName !== undefined) { fields.push('lastName = ?'); values.push(updates.lastName); }
  if (updates.isActive !== undefined) { fields.push('isActive = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.isAdmin !== undefined) { fields.push('isAdmin = ?'); values.push(updates.isAdmin ? 1 : 0); }
  if (updates.isBlocked !== undefined) { fields.push('isBlocked = ?'); values.push(updates.isBlocked ? 1 : 0); }
  if (updates.postsReceived !== undefined) { fields.push('postsReceived = ?'); values.push(updates.postsReceived); }

  if (fields.length > 0) {
    fields.push('lastActivityAt = CURRENT_TIMESTAMP');
    values.push(String(chatId));
    run(`UPDATE users SET ${fields.join(', ')} WHERE chatId = ?`, values);
    saveDatabase();
  }

  return getUser(chatId);
}

export async function deleteUser(chatId: number): Promise<boolean> {
  try {
    run('DELETE FROM users WHERE chatId = ?', [String(chatId)]);
    run('UPDATE globalStats SET totalUsers = (SELECT COUNT(*) FROM users) WHERE id = 1');
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

export async function getAllUsers(): Promise<UserData[]> {
  const users = all<any>('SELECT * FROM users ORDER BY joinedAt DESC');
  return Promise.all(users.map(u => getUser(Number(u.chatId)))) as Promise<UserData[]>;
}

export async function getAllActiveUsers(): Promise<UserData[]> {
  const users = all<any>(
    'SELECT * FROM users WHERE isActive = 1 AND isBlocked = 0 ORDER BY joinedAt DESC'
  );
  console.log(`[DB] Found ${users.length} active users in database`);

  const result: UserData[] = [];

  for (const u of users) {
    const user = await getUser(Number(u.chatId));
    if (user) {
      user.tagSets = user.tagSets.filter(ts => ts.isActive);
      user.authorSubs = user.authorSubs.filter(as => as.isActive);
      if (user.tagSets.length > 0) {
        result.push(user);
      }
    }
  }

  console.log(`[DB] Returning ${result.length} users with active tag sets`);
  return result;
}

// ===== TAG SETS =====

export async function getTagSet(tagSetId: number): Promise<TagSetData | null> {
  const ts = get<any>('SELECT * FROM tagSets WHERE id = ?', [tagSetId]);
  if (!ts) return null;
  return mapTagSet(ts);
}

export async function createTagSet(chatId: number, name: string): Promise<{ success: boolean; tagSet?: TagSetData; error?: string }> {
  const settings = await getSettings();
  const user = await getUser(chatId);

  if (!user) return { success: false, error: 'User not found' };
  if (user.tagSets.length >= settings.maxTagSetsPerUser) {
    return { success: false, error: `Max ${settings.maxTagSetsPerUser} sets` };
  }
  if (user.tagSets.some(ts => ts.name.toLowerCase() === name.toLowerCase())) {
    return { success: false, error: 'Set already exists' };
  }

  try {
    const result = run(
      'INSERT INTO tagSets (userId, name) VALUES (?, ?)',
      [user.id, name.trim().slice(0, 50)]
    );
    saveDatabase();
    return { success: true, tagSet: await getTagSet(result.lastInsertRowId) };
  } catch {
    return { success: false, error: 'Create error' };
  }
}

export async function updateTagSet(tagSetId: number, updates: { name?: string; isActive?: boolean; includeTags?: string[]; excludeTags?: string[] }): Promise<TagSetData | null> {
  const fields: string[] = ['updatedAt = CURRENT_TIMESTAMP'];
  const values: any[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.isActive !== undefined) { fields.push('isActive = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.includeTags !== undefined) { fields.push('includeTags = ?'); values.push(JSON.stringify(updates.includeTags)); }
  if (updates.excludeTags !== undefined) { fields.push('excludeTags = ?'); values.push(JSON.stringify(updates.excludeTags)); }

  values.push(tagSetId);
  run(`UPDATE tagSets SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  return getTagSet(tagSetId);
}

export async function deleteTagSet(tagSetId: number): Promise<boolean> {
  try {
    run('DELETE FROM tagSets WHERE id = ?', [tagSetId]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

// ===== TAGS =====

export async function addIncludeTag(tagSetId: number, tag: string): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const ts = await getTagSet(tagSetId);

  if (!ts) return { success: false, error: 'Set not found' };

  const normalized = tag.toLowerCase().trim();
  if (ts.includeTags.includes(normalized)) return { success: false, error: 'Tag already added' };
  if (ts.includeTags.length >= settings.maxTagsPerSet) {
    return { success: false, error: `Max ${settings.maxTagsPerSet} tags` };
  }

  await updateTagSet(tagSetId, { includeTags: [...ts.includeTags, normalized] });
  return { success: true };
}

export async function removeIncludeTag(tagSetId: number, tag: string): Promise<boolean> {
  const ts = await getTagSet(tagSetId);
  if (!ts) return false;

  const normalized = tag.toLowerCase().trim();
  await updateTagSet(tagSetId, { includeTags: ts.includeTags.filter(t => t !== normalized) });
  return true;
}

export async function addExcludeTag(tagSetId: number, tag: string): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const ts = await getTagSet(tagSetId);

  if (!ts) return { success: false, error: 'Set not found' };

  const normalized = tag.toLowerCase().trim();
  if (ts.excludeTags.includes(normalized)) return { success: false, error: 'Tag already added' };
  if (ts.excludeTags.length >= settings.maxTagsPerSet) {
    return { success: false, error: `Max ${settings.maxTagsPerSet} tags` };
  }

  await updateTagSet(tagSetId, { excludeTags: [...ts.excludeTags, normalized] });
  return { success: true };
}

export async function removeExcludeTag(tagSetId: number, tag: string): Promise<boolean> {
  const ts = await getTagSet(tagSetId);
  if (!ts) return false;

  const normalized = tag.toLowerCase().trim();
  await updateTagSet(tagSetId, { excludeTags: ts.excludeTags.filter(t => t !== normalized) });
  return true;
}

// ===== AUTHOR SUBSCRIPTIONS =====

export async function addAuthorSubscription(
  chatId: number,
  authorUsername: string,
  authorName?: string
): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const user = await getUser(chatId);

  if (!user) return { success: false, error: 'User not found' };

  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  if (user.authorSubs.length >= settings.maxAuthorSubs) {
    return { success: false, error: `Max ${settings.maxAuthorSubs} subscriptions` };
  }

  if (user.authorSubs.some(s => s.authorUsername.toLowerCase() === normalized)) {
    return { success: false, error: 'Already subscribed' };
  }

  try {
    run(
      'INSERT INTO authorSubscriptions (userId, authorUsername, authorName) VALUES (?, ?, ?)',
      [user.id, normalized, authorName || null]
    );
    saveDatabase();
    return { success: true };
  } catch {
    return { success: false, error: 'Subscription error' };
  }
}

export async function removeAuthorSubscription(chatId: number, authorUsername: string): Promise<boolean> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');
  const user = await getUser(chatId);
  if (!user) return false;

  try {
    run('DELETE FROM authorSubscriptions WHERE userId = ? AND authorUsername = ?', [user.id, normalized]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

export async function toggleAuthorSubscription(chatId: number, authorUsername: string): Promise<boolean> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');
  const user = await getUser(chatId);
  if (!user) return false;

  const sub = user.authorSubs.find(s => s.authorUsername.toLowerCase() === normalized);
  if (!sub) return false;

  try {
    run('UPDATE authorSubscriptions SET isActive = ? WHERE id = ?', [sub.isActive ? 0 : 1, sub.id]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

export async function setAuthorPreviewMode(chatId: number, authorUsername: string, sendPreview: boolean): Promise<boolean> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');
  const user = await getUser(chatId);
  if (!user) return false;

  try {
    run('UPDATE authorSubscriptions SET sendPreview = ? WHERE userId = ? AND authorUsername = ?', [sendPreview ? 1 : 0, user.id, normalized]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

export async function getSubscribersForAuthor(authorUsername: string): Promise<UserData[]> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  const subs = all<any>(
    'SELECT userId FROM authorSubscriptions WHERE authorUsername = ? AND isActive = 1',
    [normalized]
  );

  const result: UserData[] = [];
  for (const sub of subs) {
    const user = await getUserById(sub.userId);
    if (user && !user.isBlocked) {
      result.push(user);
    }
  }

  return result;
}

async function getUserById(id: number): Promise<UserData | null> {
  const user = get<any>('SELECT chatId FROM users WHERE id = ?', [id]);
  if (!user) return null;
  return getUser(Number(user.chatId));
}

// ===== COMMUNITY SUBSCRIPTIONS =====

export async function addCommunitySubscription(
  chatId: number,
  communityName: string,
  communityTitle?: string
): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const user = await getUser(chatId);

  if (!user) return { success: false, error: 'User not found' };

  const normalized = communityName.toLowerCase().replace(/^@/, '');

  if (user.communitySubs.length >= settings.maxAuthorSubs) {
    return { success: false, error: 'Max subscriptions reached' };
  }

  if (user.communitySubs.some(s => s.communityName.toLowerCase() === normalized)) {
    return { success: false, error: 'Already subscribed' };
  }

  try {
    run(
      'INSERT INTO communitySubscriptions (userId, communityName, communityTitle) VALUES (?, ?, ?)',
      [user.id, normalized, communityTitle || null]
    );
    saveDatabase();
    return { success: true };
  } catch {
    return { success: false, error: 'Database error' };
  }
}

export async function removeCommunitySubscription(subId: number): Promise<void> {
  run('DELETE FROM communitySubscriptions WHERE id = ?', [subId]);
  saveDatabase();
}

export async function toggleCommunitySubscription(subId: number): Promise<void> {
  const sub = get<any>('SELECT isActive FROM communitySubscriptions WHERE id = ?', [subId]);
  if (sub) {
    run('UPDATE communitySubscriptions SET isActive = ? WHERE id = ?', [sub.isActive ? 0 : 1, subId]);
    saveDatabase();
  }
}

export async function setCommunityPreviewMode(chatId: number, communityName: string, sendPreview: boolean): Promise<boolean> {
  const normalized = communityName.toLowerCase();
  const user = await getUser(chatId);
  if (!user) return false;

  try {
    run('UPDATE communitySubscriptions SET sendPreview = ? WHERE userId = ? AND communityName = ?', [sendPreview ? 1 : 0, user.id, normalized]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

export async function getSubscribersForCommunity(communityName: string): Promise<UserData[]> {
  const normalized = communityName.toLowerCase();

  const subs = all<any>(
    'SELECT userId FROM communitySubscriptions WHERE communityName = ? AND isActive = 1',
    [normalized]
  );

  const result: UserData[] = [];
  for (const sub of subs) {
    const user = await getUserById(sub.userId);
    if (user && !user.isBlocked) {
      result.push(user);
    }
  }

  return result;
}

// ===== POSTS =====

export async function isPostSeen(postId: string): Promise<boolean> {
  const post = get<any>('SELECT id FROM seenPosts WHERE postId = ?', [postId]);
  return !!post;
}

export async function addSeenPost(post: PostData): Promise<number> {
  try {
    const result = run(
      `INSERT INTO seenPosts (postId, title, link, author, authorName, rating, images, tags, bodyPreview, commentsCount, parsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        post.id,
        post.title?.slice(0, 500) || null,
        post.link,
        post.author || null,
        post.authorName || null,
        post.rating,
        JSON.stringify(post.images),
        JSON.stringify(post.tags),
        post.bodyPreview?.slice(0, 500) || null,
        post.commentsCount,
        post.parsedAt,
      ]
    );
    saveDatabase();
    return result.lastInsertRowId;
  } catch {
    const existing = get<any>('SELECT id FROM seenPosts WHERE postId = ?', [post.id]);
    return existing?.id || 0;
  }
}

export async function getSeenPost(postId: string): Promise<PostData | null> {
  const post = get<any>('SELECT * FROM seenPosts WHERE postId = ?', [postId]);
  if (!post) return null;

  return {
    id: post.postId,
    title: post.title || '',
    link: post.link || '',
    author: post.author || undefined,
    authorName: post.authorName || undefined,
    rating: post.rating,
    images: post.images ? JSON.parse(post.images) : [],
    tags: post.tags ? JSON.parse(post.tags) : [],
    bodyPreview: post.bodyPreview || undefined,
    commentsCount: post.commentsCount,
    parsedAt: post.parsedAt,
  };
}

export async function hasUserReceivedPost(chatId: number, postId: string): Promise<boolean> {
  const user = get<any>('SELECT id FROM users WHERE chatId = ?', [String(chatId)]);
  if (!user) return false;

  const post = get<any>('SELECT id FROM seenPosts WHERE postId = ?', [postId]);
  if (!post) return false;

  const userPost = get<any>(
    'SELECT id FROM userPosts WHERE userId = ? AND postId = ?',
    [user.id, post.id]
  );

  return !!userPost;
}

export async function recordUserPost(chatId: number, postId: number, isPreview: boolean = false): Promise<void> {
  const user = get<any>('SELECT id FROM users WHERE chatId = ?', [String(chatId)]);
  if (!user) return;

  try {
    run(
      'INSERT INTO userPosts (userId, postId, isPreview) VALUES (?, ?, ?)',
      [user.id, postId, isPreview ? 1 : 0]
    );
    saveDatabase();
  } catch { }
}

// ===== DIALOGS =====

export async function getDialogState(chatId: number): Promise<{ state: string; data: any } | null> {
  const state = get<any>('SELECT * FROM dialogStates WHERE chatId = ?', [String(chatId)]);
  if (!state) return null;
  return { state: state.state, data: state.data ? JSON.parse(state.data) : null };
}

export async function setDialogState(chatId: number, state: string, data?: any): Promise<void> {
  run(
    `INSERT INTO dialogStates (chatId, state, data) VALUES (?, ?, ?)
     ON CONFLICT(chatId) DO UPDATE SET state = excluded.state, data = excluded.data`,
    [String(chatId), state, data ? JSON.stringify(data) : null]
  );
  saveDatabase();
}

export async function clearDialogState(chatId: number): Promise<void> {
  run('DELETE FROM dialogStates WHERE chatId = ?', [String(chatId)]);
  saveDatabase();
}

// ===== STATS =====

export async function incrementUserPostsReceived(chatId: number): Promise<void> {
  run('UPDATE users SET postsReceived = postsReceived + 1 WHERE chatId = ?', [String(chatId)]);
  saveDatabase();
}

export async function incrementGlobalPostsSent(count: number = 1, isPreview: boolean = false): Promise<void> {
  if (isPreview) {
    run('UPDATE globalStats SET totalPostsSent = totalPostsSent + ?, totalPreviews = totalPreviews + ? WHERE id = 1', [count, count]);
  } else {
    run('UPDATE globalStats SET totalPostsSent = totalPostsSent + ? WHERE id = 1', [count]);
  }
  saveDatabase();
}

export async function recordParseTime(): Promise<void> {
  run('UPDATE globalStats SET totalParses = totalParses + 1, lastParseAt = CURRENT_TIMESTAMP WHERE id = 1');
  saveDatabase();
}

export async function recordParseError(error: string): Promise<void> {
  run('UPDATE globalStats SET parseErrors = parseErrors + 1, lastError = ?, lastErrorAt = CURRENT_TIMESTAMP WHERE id = 1', [error]);
  saveDatabase();
}

// ===== ADMIN =====

export async function blockUser(chatId: number): Promise<boolean> {
  try {
    run('UPDATE users SET isBlocked = 1, isActive = 0 WHERE chatId = ?', [String(chatId)]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

export async function unblockUser(chatId: number): Promise<boolean> {
  try {
    run('UPDATE users SET isBlocked = 0, isActive = 1 WHERE chatId = ?', [String(chatId)]);
    saveDatabase();
    return true;
  } catch {
    return false;
  }
}

// ===== DETAILED STATS =====

export async function getDetailedStats() {
  const stats = get<any>('SELECT * FROM globalStats WHERE id = 1');

  const allUsers = all<any>('SELECT id FROM users');
  const activeUsers = all<any>('SELECT id FROM users WHERE isActive = 1 AND isBlocked = 0');
  const blockedUsers = all<any>('SELECT id FROM users WHERE isBlocked = 1');
  const allTagSetsList = all<any>('SELECT id FROM tagSets');
  const activeTagSetsList = all<any>('SELECT id FROM tagSets WHERE isActive = 1');
  const allTagSetsData = all<any>('SELECT includeTags, excludeTags FROM tagSets');
  const authorSubs = all<any>('SELECT id FROM authorSubscriptions WHERE isActive = 1');
  const todayPosts = all<any>("SELECT id FROM userPosts WHERE date(sentAt) = date('now')");
  const weekPosts = all<any>("SELECT id FROM userPosts WHERE sentAt >= datetime('now', '-7 days')");

  let totalIncludeTags = 0;
  let totalExcludeTags = 0;

  for (const ts of allTagSetsData) {
    totalIncludeTags += (JSON.parse(ts.includeTags || '[]') as string[]).length;
    totalExcludeTags += (JSON.parse(ts.excludeTags || '[]') as string[]).length;
  }

  return {
    users: { total: allUsers.length, active: activeUsers.length, blocked: blockedUsers.length },
    tagSets: { total: allTagSetsList.length, active: activeTagSetsList.length },
    tags: { include: totalIncludeTags, exclude: totalExcludeTags },
    authorSubs: authorSubs.length,
    posts: {
      totalSent: stats?.totalPostsSent || 0,
      previews: stats?.totalPreviews || 0,
      today: todayPosts.length,
      thisWeek: weekPosts.length,
    },
    parses: {
      total: stats?.totalParses || 0,
      errors: stats?.parseErrors || 0,
      lastAt: stats?.lastParseAt || null,
    },
  };
}

export async function getPopularTags(): Promise<{ tag: string; count: number }[]> {
  const tagSets = all<any>('SELECT includeTags FROM tagSets');

  const tagCounts = new Map<string, number>();

  for (const ts of tagSets) {
    const tags = JSON.parse(ts.includeTags || '[]') as string[];
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export async function getPopularAuthors(): Promise<{ author: string; count: number }[]> {
  const subs = all<any>('SELECT authorUsername FROM authorSubscriptions');

  const authorCounts = new Map<string, number>();

  for (const s of subs) {
    authorCounts.set(s.authorUsername, (authorCounts.get(s.authorUsername) || 0) + 1);
  }

  return Array.from(authorCounts.entries())
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}
