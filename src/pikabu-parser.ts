/**
 * Pikabu Parser - Uses manual cookies or HTTP auth
 * v3.2 - Fixed: cookies for ALL requests, body/videos/publishedAt restored
 */

import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;
const MAX_REQUEST_INTERVAL = 4000;

let authSession: { login: string; cookies: string; expiresAt: number } | null = null;
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function getRandomDelay(): number {
  return MIN_REQUEST_INTERVAL + Math.random() * (MAX_REQUEST_INTERVAL - MIN_REQUEST_INTERVAL);
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const required = getRandomDelay();
  if (elapsed < required) {
    await new Promise(r => setTimeout(r, required - elapsed));
  }
  lastRequestTime = Date.now();
}

export async function closeBrowser(): Promise<void> {}

export interface PikabuAuthResult {
  success: boolean;
  error?: string;
  cookies?: string;
}

export async function loginToPikabu(login: string, password: string): Promise<PikabuAuthResult> {
  console.log(`[Parser] Setting manual cookies for ${login}...`);
  if (password.includes('=') && password.includes(';')) {
    authSession = { login, cookies: password, expiresAt: Date.now() + SESSION_DURATION };
    console.log(`[Parser] Manual cookies set for ${login}`);
    return { success: true, cookies: password };
  }
  return { success: false, error: 'Введите cookies из браузера вместо пароля' };
}

export async function getAuthSession(login: string, password: string): Promise<string | null> {
  if (authSession && authSession.login === login && authSession.expiresAt > Date.now()) {
    return authSession.cookies;
  }
  const result = await loginToPikabu(login, password);
  return result.success && result.cookies ? result.cookies : null;
}

export function setAuthSession(login: string, cookies: string): void {
  authSession = { login, cookies, expiresAt: Date.now() + SESSION_DURATION };
}

export function clearAuthSession(): void {
  authSession = null;
}

export function hasAuthSession(): boolean {
  return authSession !== null && authSession.expiresAt > Date.now();
}

// Track cookie validity
let cookiesValid: boolean | null = null;
export function areCookiesValid(): boolean | null {
  return cookiesValid;
}

// Check if cookies are still working by parsing userID from page config
function checkCookiesValid(html: string): void {
  const match = html.match(/"userID"\s*:\s*(\d+)/);
  if (match) {
    const userID = parseInt(match[1], 10);
    if (userID === 0 && authSession) {
      if (cookiesValid !== false) {
        console.warn(`[Parser] ⚠️ Cookies EXPIRED! pikabu returns userID=0. 18+ content will NOT be shown.`);
        console.warn(`[Parser] ℹ️  Please update cookies in the bot (🔐 Аккаунт Pikabu → 🗑 Удалить → ➕ Добавить)`);
      }
      cookiesValid = false;
    } else if (userID > 0) {
      if (cookiesValid !== true) {
        console.log(`[Parser] ✅ Cookies valid (userID=${userID})`);
      }
      cookiesValid = true;
    }
  }

  // Also check isAdultVisible
  const adultMatch = html.match(/"isAdultVisible"\s*:\s*(\w+)/);
  if (adultMatch && adultMatch[1] === 'false' && authSession) {
    console.warn(`[Parser] ⚠️ isAdultVisible=false — 18+ posts are hidden even for logged-in user`);
    console.warn(`[Parser] ℹ️  Make sure 18+ is enabled in your Pikabu account settings`);
  }
}

export interface Post {
  id: string;
  title: string;
  link: string;
  tags: string[];
  images: string[];
  rating: number;
  author: string;
  authorName?: string;
  bodyPreview?: string;
  body?: string;
  videos?: string[];
  commentsCount: number;
  publishedAt: string;
  parsedAt: string;
  is18plus?: boolean;
}

// ===== WINDOWS-1251 DECODER =====
const WIN1251_TO_UNICODE: Record<number, string> = {};
for (let i = 0; i < 256; i++) {
  if (i < 128) { WIN1251_TO_UNICODE[i] = String.fromCharCode(i); }
  else {
    const cyrillicMap = [
      '\u0402','\u0403','\u201A','\u0453','\u201E','\u2026','\u2020','\u2021',
      '\u20AC','\u2030','\u0409','\u2039','\u040A','\u203A','\u040C','\u040B',
      '\u040F','\u0452','\u2018','\u2019','\u201C','\u201D','\u2022','\u2013',
      '\u2014','\u0098','\u2122','\u0459','\u203A','\u045A','\u045C','\u045B',
      '\u045F','\u00A0','\u040E','\u045E','\u0408','\u00A4','\u0490','\u00A6',
      '\u00A7','\u0401','\u00A9','\u0404','\u00AB','\u00AC','\u00AD','\u00AE',
      '\u0407','\u00B7','\u0406','\u0457','\u0456','\u0491','\u00B5','\u00B9',
      '\u00B2','\u00B3','\u0458','\u0455','\u00BB','\u00B4','\u045C','\u045E',
      '\u0410','\u0411','\u0412','\u0413','\u0414','\u0415','\u0416','\u0417',
      '\u0418','\u0419','\u041A','\u041B','\u041C','\u041D','\u041E','\u041F',
      '\u0420','\u0421','\u0422','\u0423','\u0424','\u0425','\u0426','\u0427',
      '\u0428','\u0429','\u042A','\u042B','\u042C','\u042D','\u042E','\u042F',
      '\u0430','\u0431','\u0432','\u0433','\u0434','\u0435','\u0436','\u0437',
      '\u0438','\u0439','\u043A','\u043B','\u043C','\u043D','\u043E','\u043F',
      '\u0440','\u0441','\u0442','\u0443','\u0444','\u0445','\u0446','\u0447',
      '\u0448','\u0449','\u044A','\u044B','\u044C','\u044D','\u044E','\u044F',
    ];
    WIN1251_TO_UNICODE[i] = cyrillicMap[i - 128] || String.fromCharCode(i);
  }
}

function decodeWindows1251(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (const byte of bytes) {
    result += WIN1251_TO_UNICODE[byte] || '?';
  }
  return result;
}

async function fetchPage(url: string): Promise<string> {
  await waitForRateLimit();
  
  let cookieString = 'is_adult=1; adult_mode=1;';
  if (authSession) {
    cookieString = authSession.cookies;
    if (!authSession.cookies.includes('is_adult')) cookieString += '; is_adult=1';
    if (!authSession.cookies.includes('adult_mode')) cookieString += '; adult_mode=1';
  }

  const response = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      'Cookie': cookieString,
      'Referer': 'https://pikabu.ru/',
    },
  });
  
  if (!response.ok) {
    if (response.status === 429) {
      console.log('[Parser] Got 429, waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
      throw new Error('HTTP 429: Rate limited');
    }
    if (response.status === 401 || response.status === 403) {
      if (authSession) console.warn('[Parser] 401/403 - cookies may be expired!');
    }
    throw new Error(`HTTP ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  const html = decodeWindows1251(buffer);
  
  // Validate cookies on every request (lightweight regex check)
  if (authSession && (html.includes('"userID"'))) {
    checkCookiesValid(html);
  }
  
  return html;
}

function extractImages($: cheerio.CheerioAPI, $article: cheerio.Cheerio<any>): string[] {
  const images: string[] = [];
  $article.find('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (!src) return;

    const imgClass = $(el).attr('class') || '';
    const srcLower = src.toLowerCase();

    // 1. Only accept images with class "story-image" or "story__image" — these are real post images
    if (imgClass !== 'story-image__image' && !imgClass.includes('story-image') && !imgClass.includes('story__image')) {
      return;
    }

    // 2. Still skip anything avatar-like just in case
    if (srcLower.includes('avatar')) return;

    // 3. Skip data URIs
    if (srcLower.startsWith('data:')) return;

    // 4. Use data-large-image if available (higher quality), otherwise src
    const largeImg = $(el).attr('data-large-image');
    let imgUrl = largeImg || src;
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
    if (imgUrl.startsWith('/')) imgUrl = 'https://pikabu.ru' + imgUrl;
    images.push(imgUrl.replace(/\?.*$/, ''));
  });
  return [...new Set(images)];
}

function extractTags($: cheerio.CheerioAPI, $article: cheerio.Cheerio<any>): string[] {
  const tags: string[] = [];
  $article.find('a[href*="/tag/"]').each((_, el) => {
    const match = ($(el).attr('href') || '').match(/\/tag\/([^/?]+)/);
    if (match) tags.push(decodeURIComponent(match[1]).toLowerCase());
  });
  return tags;
}

export async function parseFullPost(postId: string): Promise<Post | null> {
  try {
    const url = `https://pikabu.ru/story/_${postId}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const $article = $('article[data-story-id]').first();
    if (!$article.length) return null;

    const storyId = $article.attr('data-story-id') || postId;
    const authorName = $article.attr('data-author-name') || 'Unknown';
    const title = $article.find('a.story__title-link').text().trim();
    if (!title) return null;

    const timestamp = parseInt($article.attr('data-timestamp') || '0', 10);
    const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
    const is18plus = $article.hasClass('story--adult') || $article.find('.story__rating-group_adult').length > 0 || false;

    const tags = extractTags($, $article);

    let body = '';
    $article.find('.story__content, .story-block_type_text').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > body.length) body = text;
    });

    const videos: string[] = [];
    $article.find('iframe[src*="youtube"], video, iframe[src*="vk.com"]').each((_, vidEl) => {
      const src = $(vidEl).attr('src');
      if (src) videos.push(src);
    });

    return {
      id: storyId, title,
      link: `https://pikabu.ru/story/_${storyId}`,
      tags, images: extractImages($, $article),
      videos,
      body: body.slice(0, 4000),
      bodyPreview: body.slice(0, 200),
      rating: parseInt($article.attr('data-rating') || '0', 10),
      author: authorName.toLowerCase(), authorName,
      commentsCount: parseInt($article.attr('data-comments') || '0', 10),
      publishedAt,
      parsedAt: new Date().toISOString(),
      is18plus,
    };
  } catch { return null; }
}

export async function parsePikabu(tag?: string): Promise<{ posts: Post[]; error: string | null }> {
  try {
    const url = tag ? `https://pikabu.ru/tag/${encodeURIComponent(tag)}?f=new` : 'https://pikabu.ru/new';
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const posts: Post[] = [];

    $('article[data-story-id]').each((_, el) => {
      const $a = $(el);
      const storyId = $a.attr('data-story-id');
      if (!storyId) return;
      const title = $a.find('a.story__title-link').text().trim();
      if (!title) return;

      const timestamp = parseInt($a.attr('data-timestamp') || '0', 10);
      const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
      const is18plus = $a.hasClass('story--adult') || false;

      let bodyPreview = '';
      $a.find('.story__content .story-block_type_text, .story__description').each((_, descEl) => {
        const text = $(descEl).text().trim();
        if (text.length > bodyPreview.length) bodyPreview = text;
      });

      posts.push({
        id: storyId, title,
        link: `https://pikabu.ru/story/_${storyId}`,
        tags: extractTags($, $a),
        images: extractImages($, $a),
        rating: parseInt($a.attr('data-rating') || '0', 10),
        author: ($a.attr('data-author-name') || 'Unknown').toLowerCase(),
        authorName: $a.attr('data-author-name') || 'Unknown',
        bodyPreview: bodyPreview.slice(0, 200),
        commentsCount: parseInt($a.attr('data-comments') || '0', 10),
        publishedAt,
        parsedAt: new Date().toISOString(),
        is18plus,
      });
    });

    return { posts, error: null };
  } catch (e) {
    return { posts: [], error: e instanceof Error ? e.message : 'Parse error' };
  }
}

export async function parseMultipleTags(tags: string[]): Promise<{ posts: Post[]; errors: string[] }> {
  const allPosts: Post[] = [];
  const errors: string[] = [];

  for (const tag of tags) {
    const result = await parsePikabu(tag);
    if (result.error) errors.push(`Tag ${tag}: ${result.error}`);
    else allPosts.push(...result.posts);
    await new Promise(r => setTimeout(r, 2000));
  }

  const seen = new Set<string>();
  return {
    posts: allPosts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }),
    errors,
  };
}

export async function parseMultipleAuthors(authors: string[]): Promise<{ posts: Post[]; errors: string[] }> {
  const allPosts: Post[] = [];
  const errors: string[] = [];

  for (const author of authors) {
    try {
      const url = `https://pikabu.ru/@${author}?f=new`;
      const html = await fetchPage(url);
      const $ = cheerio.load(html);

      $('article[data-story-id]').each((_, el) => {
        const $a = $(el);
        const storyId = $a.attr('data-story-id');
        if (!storyId) return;
        const title = $a.find('a.story__title-link').text().trim();
        if (!title) return;

        const timestamp = parseInt($a.attr('data-timestamp') || '0', 10);
        const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();

        allPosts.push({
          id: storyId, title,
          link: `https://pikabu.ru/story/_${storyId}`,
          tags: extractTags($, $a),
          images: extractImages($, $a),
          rating: parseInt($a.attr('data-rating') || '0', 10),
          author: author.toLowerCase(), authorName: author,
          commentsCount: parseInt($a.attr('data-comments') || '0', 10),
          publishedAt,
          parsedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      errors.push(`Author ${author}: ${e instanceof Error ? e.message : 'Error'}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const seen = new Set<string>();
  return {
    posts: allPosts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }),
    errors,
  };
}

export async function parseMultipleCommunities(communities: string[]): Promise<{ posts: Post[]; errors: string[] }> {
  const allPosts: Post[] = [];
  const errors: string[] = [];

  for (const community of communities) {
    try {
      const url = `https://pikabu.ru/community/${community}?f=new`;
      const html = await fetchPage(url);
      const $ = cheerio.load(html);

      $('article[data-story-id]').each((_, el) => {
        const $a = $(el);
        const storyId = $a.attr('data-story-id');
        if (!storyId) return;
        const title = $a.find('a.story__title-link').text().trim();
        if (!title) return;

        const timestamp = parseInt($a.attr('data-timestamp') || '0', 10);
        const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();

        allPosts.push({
          id: storyId, title,
          link: `https://pikabu.ru/story/_${storyId}`,
          tags: extractTags($, $a),
          images: extractImages($, $a),
          rating: parseInt($a.attr('data-rating') || '0', 10),
          author: ($a.attr('data-author-name') || 'Unknown').toLowerCase(),
          authorName: $a.attr('data-author-name') || 'Unknown',
          commentsCount: parseInt($a.attr('data-comments') || '0', 10),
          publishedAt,
          parsedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      errors.push(`Community ${community}: ${e instanceof Error ? e.message : 'Error'}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const seen = new Set<string>();
  return {
    posts: allPosts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }),
    errors,
  };
}
