/**
 * Pikabu Parser - Fixed for windows-1251 encoding
 */

import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
  commentsCount: number;
  publishedAt: string;
  parsedAt: string;
}

export interface ParseResult {
  posts: Post[];
  error: string | null;
  parsedAt: string;
}

// ===== WINDOWS-1251 DECODER =====

const WIN1251_TO_UNICODE: Record<number, string> = {};
for (let i = 0; i < 256; i++) {
  if (i < 0x80) {
    WIN1251_TO_UNICODE[i] = String.fromCharCode(i);
  }
}
// Windows-1251 specific characters (0x80-0xBF)
WIN1251_TO_UNICODE[0x80] = '\u0402';
WIN1251_TO_UNICODE[0x81] = '\u0403';
WIN1251_TO_UNICODE[0x82] = '\u201A';
WIN1251_TO_UNICODE[0x83] = '\u0453';
WIN1251_TO_UNICODE[0x84] = '\u201E';
WIN1251_TO_UNICODE[0x85] = '\u2026';
WIN1251_TO_UNICODE[0x86] = '\u2020';
WIN1251_TO_UNICODE[0x87] = '\u2021';
WIN1251_TO_UNICODE[0x88] = '\u20AC';
WIN1251_TO_UNICODE[0x89] = '\u2030';
WIN1251_TO_UNICODE[0x8A] = '\u0409';
WIN1251_TO_UNICODE[0x8B] = '\u2039';
WIN1251_TO_UNICODE[0x8C] = '\u040A';
WIN1251_TO_UNICODE[0x8D] = '\u040C';
WIN1251_TO_UNICODE[0x8E] = '\u040B';
WIN1251_TO_UNICODE[0x8F] = '\u040F';
WIN1251_TO_UNICODE[0x90] = '\u0452';
WIN1251_TO_UNICODE[0x91] = '\u2018';
WIN1251_TO_UNICODE[0x92] = '\u2019';
WIN1251_TO_UNICODE[0x93] = '\u201C';
WIN1251_TO_UNICODE[0x94] = '\u201D';
WIN1251_TO_UNICODE[0x95] = '\u2022';
WIN1251_TO_UNICODE[0x96] = '\u2013';
WIN1251_TO_UNICODE[0x97] = '\u2014';
WIN1251_TO_UNICODE[0x98] = '\u00A0';
WIN1251_TO_UNICODE[0x99] = '\u2122';
WIN1251_TO_UNICODE[0x9A] = '\u0459';
WIN1251_TO_UNICODE[0x9B] = '\u203A';
WIN1251_TO_UNICODE[0x9C] = '\u045A';
WIN1251_TO_UNICODE[0x9D] = '\u045C';
WIN1251_TO_UNICODE[0x9E] = '\u045B';
WIN1251_TO_UNICODE[0x9F] = '\u045F';
WIN1251_TO_UNICODE[0xA0] = '\u00A0';
WIN1251_TO_UNICODE[0xA1] = '\u040E';
WIN1251_TO_UNICODE[0xA2] = '\u045E';
WIN1251_TO_UNICODE[0xA3] = '\u0408';
WIN1251_TO_UNICODE[0xA4] = '\u00A4';
WIN1251_TO_UNICODE[0xA5] = '\u0490';
WIN1251_TO_UNICODE[0xA6] = '\u00A6';
WIN1251_TO_UNICODE[0xA7] = '\u00A7';
WIN1251_TO_UNICODE[0xA8] = '\u0401'; // Ё
WIN1251_TO_UNICODE[0xA9] = '\u00A9';
WIN1251_TO_UNICODE[0xAA] = '\u0404';
WIN1251_TO_UNICODE[0xAB] = '\u00AB';
WIN1251_TO_UNICODE[0xAC] = '\u00AC';
WIN1251_TO_UNICODE[0xAD] = '\u00AD';
WIN1251_TO_UNICODE[0xAE] = '\u00AE';
WIN1251_TO_UNICODE[0xAF] = '\u0407';
WIN1251_TO_UNICODE[0xB0] = '\u00B0';
WIN1251_TO_UNICODE[0xB1] = '\u00B1';
WIN1251_TO_UNICODE[0xB2] = '\u0406';
WIN1251_TO_UNICODE[0xB3] = '\u0456';
WIN1251_TO_UNICODE[0xB4] = '\u0491';
WIN1251_TO_UNICODE[0xB5] = '\u00B5';
WIN1251_TO_UNICODE[0xB6] = '\u00B6';
WIN1251_TO_UNICODE[0xB7] = '\u00B7';
WIN1251_TO_UNICODE[0xB8] = '\u0451'; // ё
WIN1251_TO_UNICODE[0xB9] = '\u2116';
WIN1251_TO_UNICODE[0xBA] = '\u0454';
WIN1251_TO_UNICODE[0xBB] = '\u00BB';
WIN1251_TO_UNICODE[0xBC] = '\u0458';
WIN1251_TO_UNICODE[0xBD] = '\u0405';
WIN1251_TO_UNICODE[0xBE] = '\u0455';
WIN1251_TO_UNICODE[0xBF] = '\u0457';

// Russian letters (0xC0-0xFF)
for (let i = 0xC0; i <= 0xFF; i++) {
  if (i === 0xFE) {
    WIN1251_TO_UNICODE[i] = '\u044A'; // ъ
  } else {
    WIN1251_TO_UNICODE[i] = String.fromCharCode(i + 0x350);
  }
}

function decodeWindows1251(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
    } else {
      result += WIN1251_TO_UNICODE[byte] || '?';
    }
  }
  return result;
}

// ===== IMAGE FILTERING =====

function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;

  const lower = url.toLowerCase();
  
  const skipPatterns = [
    'avatar', 'userpic', 'user-pic', 'profile', 'community', 'communities',
    '_small.', '_tiny.', '/icons/', '/icon/', 'favicon', 'logo.', 'badge',
    '_32x32', '_64x64', '_48x48', '_128x128', '-32x32', '-64x64',
    '/32_', '/64_', '/128_', 'emoji', 'sticker', 'smile', 'button', 'spinner', 'loader'
  ];
  
  for (const pattern of skipPatterns) {
    if (lower.includes(pattern)) return false;
  }
  
  return lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') ||
    lower.includes('.gif') || lower.includes('.webp') || lower.includes('/image/');
}

function isContentImageUrl(url: string): boolean {
  if (!isValidImageUrl(url)) return false;
  const lower = url.toLowerCase();
  if (lower.includes('s.pikabu.ru') || lower.includes('pikabu.ru') || 
      lower.includes('imgur') || lower.includes('i.redd.it') || 
      lower.includes('postimg') || lower.includes('ibb.co') || lower.includes('/image/')) {
    return true;
  }
  return false;
}

function normalizeImageUrl(url: string): string {
  return url.replace(/\/preview\//g, '/').replace(/_preview/g, '').replace(/\?.*$/, '');
}

// ===== MAIN PARSING FUNCTION =====

export async function parsePikabu(tag?: string): Promise<ParseResult> {
  const parsedAt = new Date().toISOString();

  try {
    const url = tag
      ? `https://pikabu.ru/tag/${encodeURIComponent(tag)}?f=new`
      : 'https://pikabu.ru/new';

    console.log(`[Parser] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get array buffer and decode as windows-1251
    const buffer = await response.arrayBuffer();
    const html = decodeWindows1251(buffer);
    
    console.log(`[Parser] HTML length: ${html.length}`);
    
    // Try to extract JSON data from the page
    const jsonPosts = extractJsonData(html);
    
    if (jsonPosts.length > 0) {
      console.log(`[Parser] Extracted ${jsonPosts.length} posts from JSON`);
      const postsWithImages = jsonPosts.filter(p => p.images.length > 0);
      console.log(`[Parser] ${postsWithImages.length} posts have images`);
      return { posts: postsWithImages, error: null, parsedAt };
    }
    
    // Fallback to HTML parsing
    console.log(`[Parser] No JSON found, trying HTML parsing`);
    const $ = cheerio.load(html, { decodeEntities: false });
    const posts = parseHtmlPosts($, html);
    
    console.log(`[Parser] Parsed ${posts.length} posts from HTML`);
    return { posts: posts.filter(p => p.images.length > 0), error: null, parsedAt };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Parser] Error:', errorMessage);
    return { posts: [], error: errorMessage, parsedAt };
  }
}

// ===== JSON EXTRACTION =====

function extractJsonData(html: string): Post[] {
  const posts: Post[] = [];
  
  // Pattern: Find stories array in script content
  const scriptRegex = /<script[^>]*>\s*(?:window\.__INITIAL_STATE__\s*=\s*)?(\{[\s\S]*?"stories"[\s\S]*?\})\s*<\/script>/gi;
  let match;
  
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const jsonStr = match[1];
      const data = JSON.parse(jsonStr);
      
      if (data.stories && Array.isArray(data.stories)) {
        console.log(`[Parser] Found ${data.stories.length} stories in script`);
        for (const story of data.stories) {
          const post = parseStoryJson(story);
          if (post) posts.push(post);
        }
        if (posts.length > 0) return posts;
      }
    } catch (e) {
      // Continue to next match
    }
  }
  
  // Alternative: look for stories array directly
  const storiesRegex = /"stories"\s*:\s*(\[[\s\S]*?\](?:\s*[,}]|\s*$))/g;
  while ((match = storiesRegex.exec(html)) !== null) {
    try {
      let jsonStr = match[1];
      let depth = 0;
      let endPos = 0;
      for (let i = 0; i < jsonStr.length; i++) {
        if (jsonStr[i] === '[') depth++;
        else if (jsonStr[i] === ']') {
          depth--;
          if (depth === 0) {
            endPos = i + 1;
            break;
          }
        }
      }
      jsonStr = jsonStr.substring(0, endPos);
      
      const stories = JSON.parse(jsonStr);
      console.log(`[Parser] Found ${stories.length} stories in array`);
      for (const story of stories) {
        const post = parseStoryJson(story);
        if (post) posts.push(post);
      }
      if (posts.length > 0) return posts;
    } catch (e) {
      // Continue
    }
  }
  
  return posts;
}

function parseStoryJson(obj: any): Post | null {
  if (!obj || !obj.id) return null;

  const title = obj.title || 'Без названия';
  
  console.log(`[Parser] JSON story ${obj.id}: "${title.substring(0, 40)}"`);
  
  // Extract images
  const images: string[] = [];
  
  if (obj.images && Array.isArray(obj.images)) {
    for (const img of obj.images) {
      const url = typeof img === 'string' ? img : img.link || img.url || img.src;
      if (url && isContentImageUrl(url)) {
        images.push(normalizeImageUrl(url));
      }
    }
  }
  
  if (obj.blocks && Array.isArray(obj.blocks)) {
    for (const block of obj.blocks) {
      if (block.type === 'image' && block.data?.link) {
        if (isContentImageUrl(block.data.link)) {
          images.push(block.data.link);
        }
      }
    }
  }
  
  if (obj.image && typeof obj.image === 'string' && isContentImageUrl(obj.image)) {
    images.push(obj.image);
  }

  // Extract tags
  let tags: string[] = [];
  if (obj.tags && Array.isArray(obj.tags)) {
    tags = obj.tags.map((t: any) => {
      const tag = typeof t === 'string' ? t : (t.name || t.tag || t.title || '');
      return tag.toLowerCase().trim();
    }).filter((t: string) => t && t.length > 0);
  }

  return {
    id: String(obj.id),
    title,
    link: `https://pikabu.ru/story/${obj.story_link || obj.story_link_id || obj.id}`,
    tags,
    images: [...new Set(images)],
    rating: obj.rating || obj.up_votes || 0,
    author: (obj.author_login || obj.author || obj.user?.login || 'Unknown').toLowerCase(),
    authorName: obj.author_name || obj.author_login || obj.user?.name || undefined,
    bodyPreview: (obj.body || obj.text || obj.preview_text)?.slice(0, 500) || undefined,
    commentsCount: obj.comments_count || obj.commentsCount || obj.comments || 0,
    publishedAt: obj.timestamp || obj.created_at || obj.date || new Date().toISOString(),
    parsedAt: new Date().toISOString(),
  };
}

// ===== HTML PARSING (fallback) =====

function parseHtmlPosts($: cheerio.CheerioAPI, rawHtml: string): Post[] {
  const posts: Post[] = [];
  
  const storyElements = $('article.story, .story, article, [data-story-id]').toArray();
  console.log(`[Parser] Found ${storyElements.length} HTML story elements`);
  
  for (const element of storyElements) {
    try {
      const post = parseHtmlStory($, element, rawHtml);
      if (post) posts.push(post);
    } catch (e) {
      // Skip invalid stories
    }
  }
  
  return posts;
}

function parseHtmlStory($: cheerio.CheerioAPI, element: any, rawHtml: string): Post | null {
  const $story = $(element);
  
  const storyId = $story.attr('data-story-id') || $story.attr('data-id') ||
    $story.find('[data-story-id]').attr('data-story-id');
  
  if (!storyId) return null;
  
  // Try to find story data in raw HTML by ID
  const storyJsonMatch = rawHtml.match(new RegExp(`\\{"id"\\s*:\\s*${storyId}[\\s\\S]{0,50}?"title"[\\s\\S]{0,2000}?\\}`));
  if (storyJsonMatch) {
    try {
      let startIdx = storyJsonMatch.index!;
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < rawHtml.length; i++) {
        if (rawHtml[i] === '{') depth++;
        else if (rawHtml[i] === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      const jsonStr = rawHtml.substring(startIdx, endIdx);
      const storyData = JSON.parse(jsonStr);
      const post = parseStoryJson(storyData);
      if (post) return post;
    } catch (e) {
      // Fall through to HTML parsing
    }
  }
  
  // Fallback: extract from HTML
  let title = $story.find('.story__title, .story__title-link, h2, h3').first().text().trim();
  if (!title) return null;
  
  const link = $story.find('a[href*="/story/"]').first().attr('href') || `https://pikabu.ru/story/_${storyId}`;
  
  // Tags from URLs
  const tags: string[] = [];
  $story.find('a[href*="/tag/"]').each((_, tagEl) => {
    const href = $(tagEl).attr('href') || '';
    const tagMatch = href.match(/\/tag\/([^/?]+)/);
    if (tagMatch) {
      const tag = decodeURIComponent(tagMatch[1]).toLowerCase().trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  });
  
  // Images
  const images: string[] = [];
  const $contentArea = $story.find('.story__content, .story-block, .story__body').first();
  const $searchArea = $contentArea.length > 0 ? $contentArea : $story;
  
  $searchArea.find('img').each((_, imgEl) => {
    const $img = $(imgEl);
    const parentClass = ($img.parent().attr('class') || '').toLowerCase();
    if (parentClass.includes('avatar') || parentClass.includes('user') || parentClass.includes('community')) {
      return;
    }
    
    const src = $img.attr('data-src') || $img.attr('src') || $img.attr('data-source');
    if (src && isContentImageUrl(src)) {
      images.push(normalizeImageUrl(src));
    }
  });
  
  const author = $story.find('.story__author, .user__nick, [class*="author"]').text().trim().toLowerCase() || 'unknown';
  
  console.log(`[Parser] HTML story ${storyId}: "${title.substring(0, 40)}" tags: [${tags.slice(0, 3).join(', ')}]`);
  
  return {
    id: storyId,
    title,
    link: link.startsWith('http') ? link : `https://pikabu.ru${link}`,
    tags,
    images: [...new Set(images)],
    rating: 0,
    author: author.replace('@', ''),
    commentsCount: 0,
    publishedAt: new Date().toISOString(),
    parsedAt: new Date().toISOString(),
  };
}

// ===== EXPORT =====

export async function parseMultipleTags(tags: string[]): Promise<Post[]> {
  const allPosts: Post[] = [];

  for (let i = 0; i < tags.length; i += 3) {
    const batch = tags.slice(i, i + 3);
    const results = await Promise.all(batch.map(t => parsePikabu(t)));

    for (const result of results) {
      if (result.posts) allPosts.push(...result.posts);
    }

    if (i + 3 < tags.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return Array.from(new Map(allPosts.map(p => [p.id, p])).values());
}
