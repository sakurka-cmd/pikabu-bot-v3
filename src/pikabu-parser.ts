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
  body?: string; // Полный текст поста
  videos?: string[]; // Ссылки на видео
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

// ===== FETCH HELPER =====

async function fetchPage(url: string): Promise<string> {
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
  return decodeWindows1251(buffer);
}

// ===== FULL POST PARSING =====

export async function parseFullPost(postId: string): Promise<Post | null> {
  try {
    const url = `https://pikabu.ru/story/_${postId}`;
    console.log(`[Parser] Fetching full post: ${url}`);
    
    const html = await fetchPage(url);
    const $ = cheerio.load(html, { decodeEntities: false });
    
    const $article = $('article[data-story-id]').first();
    if (!$article) {
      console.log(`[Parser] Full post ${postId}: article not found`);
      return null;
    }
    
    const storyId = $article.attr('data-story-id');
    const authorName = $article.attr('data-author-name') || 'Unknown';
    const author = authorName.toLowerCase();
    const rating = parseInt($article.attr('data-rating') || '0', 10);
    const commentsCount = parseInt($article.attr('data-comments') || '0', 10);
    const timestamp = parseInt($article.attr('data-timestamp') || '1', 10);
    const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
    
    const $titleLink = $article.find('a.story__title-link, a.story__title');
    const title = $titleLink.text().trim();
    const link = $titleLink.attr('href') || `https://pikabu.ru/story/_${storyId}`;
    
    if (!title) {
      console.log(`[Parser] Full post ${postId}: no title`);
      return null;
    }
    
    // Get tags
    const tags: string[] = [];
    $article.find('a[href*="/tag/"]').each((_, tagEl) => {
      const href = $(tagEl).attr('href') || '';
      const tagMatch = href.match(/\/tag\/([^/?]+)/);
      if (tagMatch) {
        const tag = decodeURIComponent(tagMatch[1]).toLowerCase().trim();
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
    });
    
    // Get ALL images from post content (no filtering)
    const images: string[] = [];
    $article.find('.story__content img, .story-block img').each((_, imgEl) => {
      const src = $(imgEl).attr('src') || $(imgEl).attr('data-src');
      if (src && !src.includes('avatar')) {
        images.push(normalizeImageUrl(src));
      }
    });
    
    // Get videos
    const videos: string[] = [];
    $article.find('iframe[src*="youtube"], video').each((_, vidEl) => {
      const src = $(vidEl).attr('src');
      if (src) videos.push(src);
    });
    
    // Get full body text
    let body = '';
    $article.find('.story__content, .story-block_type_text').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > body.length) body = text;
    });
    
    const uniqueImages = [...new Set(images)];
    
    console.log(`[Parser] Full post ${postId}: "${title.substring(0, 40)}" - ${uniqueImages.length} images, ${videos.length} videos, ${body.length} chars text`);
    
    return {
      id: storyId,
      title,
      link: link.startsWith('http') ? link : `https://pikabu.ru${link}`,
      tags,
      images: uniqueImages,
      videos,
      rating,
      author,
      authorName,
      body: body.slice(0, 4000), // Limit body to 4000 chars
      commentsCount,
      publishedAt,
      parsedAt: new Date().toISOString(),
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Parser] Full post error:`, errorMessage);
    return null;
  }
}

// ===== LIST PARSING (preview only) =====

function parseHtmlPosts($: cheerio.CheerioAPI): Post[] {
  const posts: Post[] = [];
  
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
  
  const storyId = $article.attr('data-story-id');
  if (!storyId) return null;
  
  const authorName = $article.attr('data-author-name') || 'Unknown';
  const author = authorName.toLowerCase();
  const rating = parseInt($article.attr('data-rating') || '1', 10);
  const commentsCount = parseInt($article.attr('data-comments') || '1', 10);
  const timestamp = parseInt($article.attr('data-timestamp') || '1', 10);
  const publishedAt = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
  
  const $titleLink = $article.find('a.story__title-link, a.story__title');
  const title = $titleLink.text().trim();
  const link = $titleLink.attr('href') || `https://pikabu.ru/story/_${storyId}`;
  
  if (!title) return null;
  
  const tags: string[] = [];
  $article.find('a[href*="/tag/"]').each((_, tagEl) => {
    const href = $(tagEl).attr('href') || '';
    const tagMatch = href.match(/\/tag\/([^/?]+)/);
    if (tagMatch) {
      const tag = decodeURIComponent(tagMatch[1]).toLowerCase().trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
      }
  });
  
  // Get images (preview only)
  const images: string[] = [];
  
  $article.find('img.story-image, img.story__image').each((_, imgEl) => {
    const src = $(imgEl).attr('src') || $(imgEl).attr('data-src');
    if (src && !src.includes('avatar')) {
      images.push(normalizeImageUrl(src));
    }
  });
  
  $article.find('.story__content img, .story-block img').each((_, imgEl) => {
    const src = $(imgEl).attr('src') || $(imgEl).attr('data-src');
    if (src && !src.includes('avatar')) {
      images.push(normalizeImageUrl(src));
    }
  });
  
  const uniqueImages = [...new Set(images)];
  
  console.log(`[Parser] Story ${storyId}: "${title.substring(0, 40)}" by ${authorName}, ${uniqueImages.length} images`);
  
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

// ===== MAIN PARSING FUNCTION =====

export async function parsePikabu(tag?: string): Promise<ParseResult> {
  const parsedAt = new Date().toISOString();

  try {
    const url = tag
      ? `https://pikabu.ru/tag/${encodeURIComponent(tag)}?f=new`
      : 'https://pikabu.ru/new';

    const html = await fetchPage(url);
    
    const $ = cheerio.load(html, { decodeEntities: false });
    const posts = parseHtmlPosts($);
    
    console.log(`[Parser] Parsed ${posts.length} posts`);
    return { posts, error: null, parsedAt };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Parser] Error:', errorMessage);
    return { posts: [], error: errorMessage, parsedAt };
  }
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

// ===== AUTHOR PARSING =====

export async function parseAuthorPage(authorUsername: string, fetchFull: boolean = true): Promise<Post[]> {
  try {
    const url = `https://pikabu.ru/@${encodeURIComponent(authorUsername)}?f=new`;
    console.log(`[Parser] Fetching author: ${url}`);

    const html = await fetchPage(url);
    
    const $ = cheerio.load(html, { decodeEntities: false });
    const previewPosts = parseHtmlPosts($);
    
    console.log(`[Parser] Author ${authorUsername}: ${previewPosts.length} preview posts`);
    
    // Fetch full content for each post
    const fullPosts: Post[] = [];
    for (const post of previewPosts.slice(0, 3)) { // Limit to 3 posts for performance
      console.log(`[Parser] Author ${authorUsername}: fetching full content for post ${post.id}...`);
      const fullPost = await parseFullPost(post.id);
      if (fullPost) {
        fullPosts.push(fullPost);
      }
    }
    
    console.log(`[Parser] Author ${authorUsername}: ${fullPosts.length} full posts`);
    return fullPosts;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Parser] Author ${authorUsername} error:`, errorMessage);
    return [];
  }
}

export async function parseMultipleAuthors(authors: string[]): Promise<Post[]> {
  const allPosts: Post[] = [];

  for (let i = 0; i < authors.length; i += 2) {
    const batch = authors.slice(i, i + 2);
    const results = await Promise.all(batch.map(a => parseAuthorPage(a)));

    for (const posts of results) {
      allPosts.push(...posts);
    }

    if (i + 2 < authors.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return Array.from(new Map(allPosts.map(p => [p.id, p])).values());
}

// ===== COMMUNITY PARSING =====

export async function parseCommunityPage(communityName: string, fetchFull: boolean = true): Promise<Post[]> {
  try {
    const url = `https://pikabu.ru/community/${encodeURIComponent(communityName)}?f=new`;
    console.log(`[Parser] Fetching community: ${url}`);

    const html = await fetchPage(url);
    
    const $ = cheerio.load(html, { decodeEntities: false });
    const previewPosts = parseHtmlPosts($);
    
    console.log(`[Parser] Community ${communityName}: ${previewPosts.length} preview posts`);
    
    // Fetch full content for each post
    const fullPosts: Post[] = [];
    for (const post of previewPosts.slice(0, 3)) { // Limit to 3 posts
      console.log(`[Parser] Community ${communityName}: fetching full content for post ${post.id}...`);
      const fullPost = await parseFullPost(post.id);
      if (fullPost) {
        fullPosts.push(fullPost);
      }
    }
    
    console.log(`[Parser] Community ${communityName}: ${fullPosts.length} full posts`);
    return fullPosts;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Parser] Community ${communityName} error:`, errorMessage);
    return [];
  }
}

export async function parseMultipleCommunities(communities: string[]): Promise<Post[]> {
  const allPosts: Post[] = [];

  for (let i = 0; i < communities.length; i += 2) {
    const batch = communities.slice(i, i + 2);
    const results = await Promise.all(batch.map(c => parseCommunityPage(c)));

    for (const posts of results) {
      allPosts.push(...posts);
    }

    if (i + 2 < communities.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return Array.from(new Map(allPosts.map(p => [p.id, p])).values());
}
