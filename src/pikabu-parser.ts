/**
 * Pikabu Parser - Fixed for proper encoding
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

// Decode HTML entities like &#1055;&#1088;&#1080;&#1074;&#1077;&#1090; or &quot;
function decodeHtmlEntities(str: string): string {
  if (!str) return str;
  
  // Decode numeric entities (&#xHHHH; or &#NNNN;)
  str = str.replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => 
    String.fromCharCode(parseInt(hex, 16))
  );
  str = str.replace(/&#(\d+);?/g, (_, num) => 
    String.fromCharCode(parseInt(num, 10))
  );
  
  // Decode common named entities
  const entities: Record<string, string> = {
    '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&nbsp;': ' ', '&apos;': "'", '&laquo;': '«', '&raquo;': '»',
    '&mdash;': '—', '&ndash;': '–', '&hellip;': '…'
  };
  
  for (const [entity, char] of Object.entries(entities)) {
    str = str.split(entity).join(char);
  }
  
  return str;
}

// ===== IMAGE FILTERING =====

function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;

  const lower = url.toLowerCase();
  
  // Skip avatars, profiles, icons, etc.
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

    const html = await response.text();
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
    const posts = parseHtmlPosts($);
    
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
  
  // Pattern 1: window.__INITIAL_STATE__ = {...}
  let match = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:<\/script>|$)/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      if (data.stories && Array.isArray(data.stories)) {
        console.log(`[Parser] Found __INITIAL_STATE__ with ${data.stories.length} stories`);
        for (const story of data.stories) {
          const post = parseStoryJson(story);
          if (post) posts.push(post);
        }
        if (posts.length > 0) return posts;
      }
    } catch (e) {
      console.log('[Parser] Failed to parse __INITIAL_STATE__');
    }
  }
  
  // Pattern 2: Find stories array in any script
  const scriptMatches = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scriptMatches) {
    // Look for stories array
    const storiesMatch = script.match(/"stories"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (storiesMatch) {
      try {
        // Need to extract just the array, handling nested braces
        let jsonStr = storiesMatch[1];
        // Balance brackets
        let depth = 0;
        let endPos = 0;
        for (let i = 0; i < jsonStr.length; i++) {
          if (jsonStr[i] === '[') depth++;
          if (jsonStr[i] === ']') depth--;
          if (depth === 0) {
            endPos = i + 1;
            break;
          }
        }
        jsonStr = jsonStr.substring(0, endPos);
        
        const stories = JSON.parse(jsonStr);
        console.log(`[Parser] Found stories array with ${stories.length} items`);
        for (const story of stories) {
          const post = parseStoryJson(story);
          if (post) posts.push(post);
        }
        if (posts.length > 0) return posts;
      } catch (e) {
        // Continue to next pattern
      }
    }
  }
  
  // Pattern 3: Look for individual story objects with id and title
  const storyPattern = /\{"id"\s*:\s*(\d+)[^}]*"title"\s*:\s*"([^"]+)"[^}]*\}/g;
  let storyMatch;
  while ((storyMatch = storyPattern.exec(html)) !== null) {
    try {
      // Try to parse the full object
      const startIdx = storyMatch.index;
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}') depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
      const jsonStr = html.substring(startIdx, endIdx);
      const story = JSON.parse(jsonStr);
      const post = parseStoryJson(story);
      if (post) posts.push(post);
    } catch (e) {
      // Skip invalid JSON
    }
  }
  
  return posts;
}

function parseStoryJson(obj: any): Post | null {
  if (!obj || !obj.id) return null;

  // JSON.parse automatically handles \uXXXX escapes
  const title = obj.title || 'Без названия';
  
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

  console.log(`[Parser] JSON story ${obj.id}: "${title.substring(0, 40)}..." tags: [${tags.slice(0, 3).join(', ')}]`);

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

function parseHtmlPosts($: cheerio.CheerioAPI): Post[] {
  const posts: Post[] = [];
  
  const storyElements = $('article.story, .story, article, [data-story-id]').toArray();
  console.log(`[Parser] Found ${storyElements.length} HTML story elements`);
  
  for (const element of storyElements) {
    try {
      const post = parseHtmlStory($, element);
      if (post) posts.push(post);
    } catch (e) {
      // Skip invalid stories
    }
  }
  
  return posts;
}

function parseHtmlStory($: cheerio.CheerioAPI, element: any): Post | null {
  const $story = $(element);
  
  const storyId = $story.attr('data-story-id') || $story.attr('data-id') ||
    $story.find('[data-story-id]').attr('data-story-id');
  
  if (!storyId) return null;
  
  // Title - decode HTML entities
  let title = $story.find('.story__title, .story__title-link, h2, h3').first().text().trim();
  title = decodeHtmlEntities(title);
  if (!title) return null;
  
  // Link
  const link = $story.find('a[href*="/story/"]').first().attr('href') || `https://pikabu.ru/story/_${storyId}`;
  
  // Tags from URLs (most reliable)
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
  
  // Author
  const author = $story.find('.story__author, .user__nick, [class*="author"]').text().trim().toLowerCase() || 'unknown';
  
  console.log(`[Parser] HTML story ${storyId}: "${title.substring(0, 40)}..." tags: [${tags.slice(0, 3).join(', ')}]`);
  
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
