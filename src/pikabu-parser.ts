/**
 * Pikabu Parser - Parse from HTML attributes
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
  if (i < 0x80) WIN1251_TO_UNICODE[i] = String.fromCharCode(i);
}
for (let i = 0xC0; i <= 0xFF; i++) {
  if (i === 0xFE) {
    WIN1251_TO_UNICODE[i] = '\u044A';
  } else {
    WIN1251_TO_UNICODE[i] = String.fromCharCode(i + 0x350);
  }
}
WIN1251_TO_UNICODE[0xA8] = '\u0401';
WIN1251_TO_UNICODE[0xB8] = '\u0451';

function decodeWindows1251(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    result += WIN1251_TO_UNICODE[byte] || String.fromCharCode(byte);
  }
  return result;
}

// ===== IMAGE FILTERING =====

function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;

  const lower = url.toLowerCase();
  
  // Skip avatars and non-content images
  if (lower.includes('/avatars/')) return false;
  if (lower.includes('avatar')) return false;
  if (lower.includes('userpic')) return false;
  if (lower.includes('/icons/')) return false;
  if (lower.includes('favicon')) return false;
  if (lower.includes('community_icon')) return false;
  if (lower.includes('/communities/')) return false;
  if (lower.includes('default_avatar')) return false;
  if (lower.includes('profile')) return false;
  if (lower.includes('badge')) return false;
  if (lower.includes('_small.')) return false;
  if (lower.includes('_tiny.')) return false;
  
  // Valid patterns
  return lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') ||
    lower.includes('.gif') || lower.includes('.webp');
}

function isContentImageUrl(url: string): boolean {
  if (!isValidImageUrl(url)) return false;
  
  const lower = url.toLowerCase();
  
  // Pikabu content image servers
  if (lower.includes('pikabu.ru') && !lower.includes('/avatars/')) {
    return true;
  }
  
  // External hosts
  if (lower.includes('imgur')) return true;
  if (lower.includes('i.redd.it')) return true;
  
  return false;
}

function normalizeImageUrl(url: string): string {
  return url.replace(/\?.*$/, '');
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

    const buffer = await response.arrayBuffer();
    const html = decodeWindows1251(buffer);
    
    console.log(`[Parser] HTML length: ${html.length}`);
    
    const $ = cheerio.load(html, { decodeEntities: false });
    const posts = parseHtmlPosts($);
    
    console.log(`[Parser] Parsed ${posts.length} posts`);
    return { posts: posts.filter(p => p.images.length > 0), error: null, parsedAt };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Parser] Error:', errorMessage);
    return { posts: [], error: errorMessage, parsedAt };
  }
}

// ===== HTML PARSING =====

function parseHtmlPosts($: cheerio.CheerioAPI): Post[] {
  const posts: Post[] = [];
  
  // Find all article elements with data-story-id
  $('article[data-story-id]').each((_, element) => {
    try {
      const post = parseStoryElement($, element);
      if (post) posts.push(post);
    } catch (e) {
      // Skip invalid
    }
  });
  
  console.log(`[Parser] Found ${posts.length} articles`);
  return posts;
}

function parseStoryElement($: cheerio.CheerioAPI, element: any): Post | null {
  const $article = $(element);
  
  // Get story ID from data attribute
  const storyId = $article.attr('data-story-id');
  if (!storyId) return null;
  
  // Get author from data attribute
  const authorName = $article.attr('data-author-name') || 'Unknown';
  const author = authorName.toLowerCase();
  
  // Get rating from data attribute
  const rating = parseInt($article.attr('data-rating') || '0', 10);
  
  // Get comments count
  const commentsCount = parseInt($article.attr('data-comments') || '0', 10);
  
  // Get timestamp
  const timestamp = parseInt($article.attr('data-timestamp') || '0', 10);
  const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
  
  // Get title from link
  const $titleLink = $article.find('a.story__title-link, a.story__title');
  const title = $titleLink.text().trim();
  const link = $titleLink.attr('href') || `https://pikabu.ru/story/_${storyId}`;
  
  if (!title) return null;
  
  // Get tags from tag links
  const tags: string[] = [];
  $article.find('a[href*="/tag/"]').each((_, tagEl) => {
    const href = $(tagEl).attr('href') || '';
    const tagMatch = href.match(/\/tag\/([^/?]+)/);
    if (tagMatch) {
      const tag = decodeURIComponent(tagMatch[1]).toLowerCase().trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  });
  
  // Get images - look for story images, skip avatars
  const images: string[] = [];
  
  // Helper to check if image is in avatar/author area
  const isAvatarArea = ($img: cheerio.Cheerio<any>): boolean => {
    const parentClasses = $img.parents().map((_, el) => $(el).attr('class') || '').get().join(' ').toLowerCase();
    return parentClasses.includes('avatar') ||
           parentClasses.includes('author') ||
           parentClasses.includes('user__') ||
           parentClasses.includes('profile') ||
           parentClasses.includes('story__user') ||
           parentClasses.includes('community') ||
           parentClasses.includes('story__tools');
  };
  
  // Helper to check if image is too small (likely icon)
  const isSmallImage = ($img: cheerio.Cheerio<any>): boolean => {
    const width = parseInt($img.attr('width') || '0');
    const height = parseInt($img.attr('height') || '0');
    return (width > 0 && width < 100) || (height > 0 && height < 100);
  };
  
  // Method 1: story-image class
  $article.find('img.story-image, img.story__image').each((_, imgEl) => {
    const $img = $(imgEl);
    if (isAvatarArea($img) || isSmallImage($img)) return;
    const src = $img.attr('src') || $img.attr('data-src');
    if (src && isContentImageUrl(src)) {
      images.push(normalizeImageUrl(src));
    }
  });
  
  // Method 2: any image in story content area
  $article.find('.story__content img, .story-block img').each((_, imgEl) => {
    const $img = $(imgEl);
    if (isAvatarArea($img) || isSmallImage($img)) return;
    const src = $img.attr('src') || $img.attr('data-src');
    if (src && isContentImageUrl(src)) {
      images.push(normalizeImageUrl(src));
    }
  });
  
  // Method 3: data-src on any element (but skip avatars)
  $article.find('[data-src]').each((_, el) => {
    const $el = $(el);
    if (isAvatarArea($el)) return;
    const src = $el.attr('data-src');
    if (src && isContentImageUrl(src)) {
      images.push(normalizeImageUrl(src));
    }
  });
  
  // Dedupe images
  const uniqueImages = [...new Set(images)];
  
  console.log(`[Parser] Story ${storyId}: "${title.substring(0, 40)}" by ${authorName}, ${uniqueImages.length} images, tags: [${tags.slice(0, 3).join(', ')}]`);
  
  return {
    id: storyId,
    title,
    link: link.startsWith('http') ? link : `https://pikabu.ru${link}`,
    tags,
    images: uniqueImages,
    rating,
    author,
    authorName,
    commentsCount,
    publishedAt,
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
