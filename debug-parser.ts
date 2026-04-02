// Debug script to find window.data

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

async function debug() {
  const url = 'https://pikabu.ru/tag/%D1%8E%D0%BC%D0%BE%D1%80?f=new';
  
  console.log('Fetching:', url);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
  });
  
  const buffer = await response.arrayBuffer();
  const html = decodeWindows1251(buffer);
  
  // Find window.data
  console.log('\n=== Looking for window.data ===');
  const windowDataMatch = html.match(/window\.data\s*=\s*(\{[\s\S]+?\});?\s*<\/script>/);
  if (windowDataMatch) {
    console.log('Found window.data!');
    try {
      const data = JSON.parse(windowDataMatch[1]);
      console.log('Keys:', Object.keys(data));
      
      // Look for stories in the data
      if (data.stories) {
        console.log('\n=== Stories found:', data.stories.length, '===');
        for (let i = 0; i < Math.min(3, data.stories.length); i++) {
          const s = data.stories[i];
          console.log('\nStory', i + 1, ':');
          console.log('  ID:', s.id);
          console.log('  Title:', s.title);
          console.log('  Tags:', s.tags ? s.tags.slice(0, 3) : 'none');
          console.log('  Images:', s.images ? s.images.length : 0);
          if (s.images && s.images.length > 0) {
            console.log('  First image:', s.images[0]);
          }
        }
      }
    } catch (e) {
      console.log('Parse error:', e);
      console.log('First 200 chars of match:', windowDataMatch[1].substring(0, 200));
    }
  } else {
    // Try alternative patterns
    console.log('window.data not found in standard format');
    
    // Check script contents
    const scriptMatches = html.match(/<script[^>]*>[\s\S]+?<\/script>/gi) || [];
    console.log('Checking', scriptMatches.length, 'script tags...');
    
    for (let i = 0; i < scriptMatches.length; i++) {
      const script = scriptMatches[i];
      if (script.includes('window.data') || script.includes('"stories"')) {
        console.log('\nScript', i, 'contains relevant data:');
        console.log(script.substring(0, 500));
        break;
      }
    }
  }
  
  // Also try extracting from HTML attributes
  console.log('\n=== Extracting from HTML attributes ===');
  const articleMatch = html.match(/<article[^>]*data-story-id="(\d+)"[^>]*data-author-name="([^"]+)"[^>]*>/);
  if (articleMatch) {
    console.log('Story ID:', articleMatch[1]);
    console.log('Author:', articleMatch[2]);
  }
  
  // Find title link
  const titleMatch = html.match(/<a[^>]*class="[^"]*story__title[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  if (titleMatch) {
    console.log('Title link:', titleMatch[1]);
    console.log('Title text:', titleMatch[2]);
  }
  
  // Find image in story
  const imgMatch = html.match(/<img[^>]*class="[^"]*story-image[^"]*"[^>]*src="([^"]+)"/);
  if (imgMatch) {
    console.log('Story image:', imgMatch[1]);
  }
  
  // Alternative image pattern
  const imgMatch2 = html.match(/data-src="(https?:\/\/[^"]*pikabu[^"]*\.(jpg|png|gif|webp)[^"]*)"/i);
  if (imgMatch2) {
    console.log('Image via data-src:', imgMatch2[1]);
  }
}

debug().catch(console.error);
