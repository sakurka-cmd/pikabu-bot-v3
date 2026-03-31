/**
 * Pikabu Parser
 * Extracts posts with images, authors and previews
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
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const posts: Post[] = [];

    const storyElements = $('article.story, .story').toArray();

    console.log(`[Parser] Found ${storyElements.length} story elements`);

    for (const element of storyElements) {
      try {
        const post = parseStoryElement($, element);
        if (post && post.images.length > 0) {
          posts.push(post);
        }
      } catch (e) {
        console.error('[Parser] Error parsing story element:', e);
      }
    }

    if (posts.length === 0) {
      const jsonPosts = parseFromJsonData($);
      posts.push(...jsonPosts.filter(p => p.images.length > 0));
    }

    console.log(`[Parser] Parsed ${posts.length} posts with images`);

    return { posts, error: null, parsedAt };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Parser] Error:', errorMessage);

    return { posts: [], error: errorMessage, parsedAt };
  }
}

function parseStoryElement($: cheerio.CheerioAPI, element: any): Post | null {
  const $story = $(element);

  const storyId = $story.attr('data-story-id') ||
    $story.attr('data-id') ||
    extractIdFromUrl($story.find('a.story__title-link').attr('href') || '');

  if (!storyId) return null;

  const title = $story.find('.story__title-link').text().trim() ||
    $story.find('a[class*="title"]').text().trim() ||
    $story.find('h2, h3').first().text().trim();

  if (!title) return null;

  const link = $story.find('.story__title-link').attr('href') ||
    $story.find('a[class*="title"]').attr('href') ||
    `https://pikabu.ru/story/_${storyId}`;

  // Tags
  const tags: string[] = [];
  $story.find('.story__tag, .tags__tag, a[class*="tag"]').each((_, tagEl) => {
    const tag = $(tagEl).text().trim().toLowerCase();
    if (tag) tags.push(tag);
  });

  // Images
  const images: string[] = [];

  $story.find('.story__content img, .story-image img, img[class*="image"]').each((_, imgEl) => {
    const src = $(imgEl).attr('data-src') ||
      $(imgEl).attr('src') ||
      $(imgEl).attr('data-source');
    if (src && isValidImageUrl(src)) {
      images.push(normalizeImageUrl(src));
    }
  });

  const dataImages = $story.attr('data-images');
  if (dataImages) {
    try {
      const parsed = JSON.parse(dataImages);
      if (Array.isArray(parsed)) {
        images.push(...parsed.filter(isValidImageUrl).map(normalizeImageUrl));
      }
    } catch { }
  }

  // Rating
  const ratingText = $story.find('.story__rating-count, .rating__count, [class*="rating"]').text().trim();
  const rating = parseFloat(ratingText) || 0;

  // Author
  const $author = $story.find('.story__author, .user__nick, [class*="author"], a[data-user-id]');
  const author = $author.text().trim().replace('@', '') ||
    $author.attr('href')?.split('/').pop() ||
    'Unknown';
  const authorName = $author.attr('title') || $author.text().trim() || undefined;

  // Preview text
  let bodyPreview = '';
  $story.find('.story__content, .story-block_type_text, div[class*="content"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > bodyPreview.length && text.length < 1000) {
      bodyPreview = text;
    }
  });

  // Comments
  const commentsText = $story.find('.story__comments-count, [class*="comments"]').text().trim();
  const commentsCount = parseInt(commentsText) || 0;

  // Date
  const datetime = $story.find('.story__datetime, time, [class*="date"]').attr('datetime') ||
    $story.find('.story__datetime, time, [class*="date"]').attr('title') ||
    new Date().toISOString();

  return {
    id: storyId,
    title,
    link: link.startsWith('http') ? link : `https://pikabu.ru${link}`,
    tags,
    images: [...new Set(images)],
    rating,
    author: author.toLowerCase().replace('@', ''),
    authorName,
    bodyPreview: bodyPreview.slice(0, 500) || undefined,
    commentsCount,
    publishedAt: datetime,
    parsedAt: new Date().toISOString(),
  };
}

function parseFromJsonData($: cheerio.CheerioAPI): Post[] {
  const posts: Post[] = [];

  $('script').each((_, scriptEl) => {
    const content = $(scriptEl).html() || '';

    const matches = content.match(/"stories"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (matches) {
      try {
        const stories = JSON.parse(matches[1]);
        for (const story of stories) {
          const post = parseStoryObject(story);
          if (post) posts.push(post);
        }
      } catch (e) {
        console.error('[Parser] Error parsing JSON stories:', e);
      }
    }
  });

  return posts;
}

function parseStoryObject(obj: any): Post | null {
  if (!obj || !obj.id) return null;

  const images: string[] = [];

  if (obj.images && Array.isArray(obj.images)) {
    images.push(...obj.images.map((img: any) =>
      typeof img === 'string' ? img : img.link || img.url || img.src
    ).filter(Boolean));
  }

  if (obj.image && typeof obj.image === 'string') {
    images.push(obj.image);
  }

  if (obj.previewImage && typeof obj.previewImage === 'string') {
    images.push(obj.previewImage);
  }

  if (obj.video_gif && typeof obj.video_gif === 'string') {
    images.push(obj.video_gif);
  }

  return {
    id: String(obj.id),
    title: obj.title || 'Без названия',
    link: `https://pikabu.ru/story/${obj.story_link || obj.id}`,
    tags: (obj.tags || []).map((t: any) =>
      typeof t === 'string' ? t.toLowerCase() : (t.name || t.tag || '').toLowerCase()
    ).filter(Boolean),
    images: images.filter(isValidImageUrl).map(normalizeImageUrl),
    rating: obj.rating || 0,
    author: (obj.author_login || obj.author || 'Unknown').toLowerCase(),
    authorName: obj.author_name || obj.author_login || undefined,
    bodyPreview: obj.body?.slice(0, 500) || undefined,
    commentsCount: obj.comments_count || obj.commentsCount || 0,
    publishedAt: obj.timestamp || obj.created_at || new Date().toISOString(),
    parsedAt: new Date().toISOString(),
  };
}

function extractIdFromUrl(url: string): string {
  const match = url.match(/\/story\/[^_]+_(\d+)/);
  return match ? match[1] : '';
}

function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;

  const lower = url.toLowerCase();
  return lower.includes('.jpg') ||
    lower.includes('.jpeg') ||
    lower.includes('.png') ||
    lower.includes('.gif') ||
    lower.includes('.webp') ||
    lower.includes('/image/') ||
    lower.includes('pikabu.ru') ||
    lower.includes('imgur') ||
    lower.includes('i.redd.it');
}

function normalizeImageUrl(url: string): string {
  return url
    .replace(/\/preview\//g, '/')
    .replace(/_preview/g, '')
    .replace(/\?.*$/, '');
}

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
