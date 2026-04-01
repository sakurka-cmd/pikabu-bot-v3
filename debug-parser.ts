// Debug script to analyze Pikabu HTML structure

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
// Add other windows-1251 chars
WIN1251_TO_UNICODE[0xA8] = '\u0401'; // Ё
WIN1251_TO_UNICODE[0xB8] = '\u0451'; // ё

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
  
  console.log('HTML length:', html.length);
  
  // Check page title
  const pageTitleMatch = html.match(/<title>([^<]+)<\/title>/);
  console.log('\n=== Page title ===');
  console.log(pageTitleMatch ? pageTitleMatch[1] : 'not found');
  
  // Look for script tags with JSON
  console.log('\n=== Script tags ===');
  const scriptMatches = html.match(/<script[^>]*>[\s\S]{100,}?</script>/gi) || [];
  console.log('Found script tags:', scriptMatches.length);
  
  // Check for common data patterns
  console.log('\n=== Data patterns ===');
  
  // Pattern 1: data-story-id
  const storyIdMatches = html.match(/data-story-id="(\d+)"/g) || [];
  console.log('data-story-id attributes:', storyIdMatches.length);
  if (storyIdMatches.length > 0) {
    console.log('  First 3:', storyIdMatches.slice(0, 3));
  }
  
  // Pattern 2: story__title class
  const titleClassMatches = html.match(/class="[^"]*story__title[^"]*"/gi) || [];
  console.log('story__title classes:', titleClassMatches.length);
  
  // Pattern 3: Look for article tags
  const articleMatches = html.match(/<article[^>]*>/gi) || [];
  console.log('article tags:', articleMatches.length);
  
  // Pattern 4: Any JSON-like structures
  const jsonLikeMatches = html.match(/\{[^{}]*"[a-z_]+"\s*:\s*[^}]+\}/gi) || [];
  console.log('JSON-like objects:', jsonLikeMatches.length);
  
  // Pattern 5: Look for specific Pikabu data
  const pikabuDataPatterns = [
    'APP_STATE',
    'INITIAL_STATE', 
    '__STATE__',
    'window.data',
    'preloadData',
    '"data":',
    '"items":',
    '"posts":'
  ];
  
  console.log('\n=== Pikabu data patterns ===');
  for (const pattern of pikabuDataPatterns) {
    const found = html.includes(pattern);
    console.log(pattern + ':', found ? 'FOUND' : 'not found');
  }
  
  // Extract first story title from HTML
  console.log('\n=== First story from HTML ===');
  const storyTitleMatch = html.match(/<a[^>]*class="[^"]*story__title[^"]*"[^>]*>([^<]+)<\/a>/i);
  if (storyTitleMatch) {
    console.log('Title:', storyTitleMatch[1].trim().substring(0, 60));
  }
  
  // Look for story data in a different format
  const storyDataMatch = html.match(/data-story="([^"]+)"/);
  if (storyDataMatch) {
    console.log('data-story attribute found, length:', storyDataMatch[1].length);
    try {
      const decoded = JSON.parse(storyDataMatch[1].replace(/&quot;/g, '"'));
      console.log('Parsed story data:', Object.keys(decoded));
    } catch (e) {
      console.log('Could not parse data-story');
    }
  }
  
  // Check for embedded JSON in data attributes
  const dataAttrMatches = html.match(/data-[a-z-]+="\{[^"]+\}"/gi) || [];
  console.log('\nData attributes with JSON:', dataAttrMatches.length);
  if (dataAttrMatches.length > 0) {
    console.log('First:', dataAttrMatches[0].substring(0, 100));
  }
  
  // Look for the actual story content structure
  console.log('\n=== Story HTML structure ===');
  const storyBlockMatch = html.match(/<article[^>]*data-story-id="\d+"[^>]*>[\s\S]{0,500}/);
  if (storyBlockMatch) {
    console.log('First article (500 chars):', storyBlockMatch[0].substring(0, 500));
  }
}

debug().catch(console.error);
