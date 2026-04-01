// Debug script to analyze Pikabu response encoding

// Windows-1251 decoder
const WIN1251_TO_UNICODE: Record<number, string> = {};
for (let i = 0; i < 256; i++) {
  if (i < 0x80) {
    WIN1251_TO_UNICODE[i] = String.fromCharCode(i);
  }
}
WIN1251_TO_UNICODE[0x80] = 'Ђ';
WIN1251_TO_UNICODE[0x81] = 'Ѓ';
WIN1251_TO_UNICODE[0x82] = '‚';
WIN1251_TO_UNICODE[0x83] = 'ѓ';
WIN1251_TO_UNICODE[0x84] = '„';
WIN1251_TO_UNICODE[0x85] = '…';
WIN1251_TO_UNICODE[0x86] = '†';
WIN1251_TO_UNICODE[0x87] = '‡';
WIN1251_TO_UNICODE[0x88] = '€';
WIN1251_TO_UNICODE[0x89] = '‰';
WIN1251_TO_UNICODE[0x8A] = 'Љ';
WIN1251_TO_UNICODE[0x8B] = '‹';
WIN1251_TO_UNICODE[0x8C] = 'Њ';
WIN1251_TO_UNICODE[0x8D] = 'Ќ';
WIN1251_TO_UNICODE[0x8E] = 'Ћ';
WIN1251_TO_UNICODE[0x8F] = 'Џ';
WIN1251_TO_UNICODE[0x90] = 'ђ';
WIN1251_TO_UNICODE[0x91] = '''; 
WIN1251_TO_UNICODE[0x92] = ''';
WIN1251_TO_UNICODE[0x93] = '"';
WIN1251_TO_UNICODE[0x94] = '"';
WIN1251_TO_UNICODE[0x95] = '•';
WIN1251_TO_UNICODE[0x96] = '–';
WIN1251_TO_UNICODE[0x97] = '—';
WIN1251_TO_UNICODE[0x98] = ' ';
WIN1251_TO_UNICODE[0x99] = '™';
WIN1251_TO_UNICODE[0x9A] = 'љ';
WIN1251_TO_UNICODE[0x9B] = '›';
WIN1251_TO_UNICODE[0x9C] = 'њ';
WIN1251_TO_UNICODE[0x9D] = 'ќ';
WIN1251_TO_UNICODE[0x9E] = 'ћ';
WIN1251_TO_UNICODE[0x9F] = 'џ';
WIN1251_TO_UNICODE[0xA0] = ' ';
WIN1251_TO_UNICODE[0xA1] = 'Ў';
WIN1251_TO_UNICODE[0xA2] = 'ў';
WIN1251_TO_UNICODE[0xA3] = 'Ј';
WIN1251_TO_UNICODE[0xA4] = '¤';
WIN1251_TO_UNICODE[0xA5] = 'Ґ';
WIN1251_TO_UNICODE[0xA6] = '¦';
WIN1251_TO_UNICODE[0xA7] = '§';
WIN1251_TO_UNICODE[0xA8] = 'Ё';
WIN1251_TO_UNICODE[0xA9] = '©';
WIN1251_TO_UNICODE[0xAA] = 'Є';
WIN1251_TO_UNICODE[0xAB] = '«';
WIN1251_TO_UNICODE[0xAC] = '¬';
WIN1251_TO_UNICODE[0xAD] = '\u00AD';
WIN1251_TO_UNICODE[0xAE] = '®';
WIN1251_TO_UNICODE[0xAF] = 'Ї';
WIN1251_TO_UNICODE[0xB0] = '°';
WIN1251_TO_UNICODE[0xB1] = '±';
WIN1251_TO_UNICODE[0xB2] = 'І';
WIN1251_TO_UNICODE[0xB3] = 'і';
WIN1251_TO_UNICODE[0xB4] = 'ґ';
WIN1251_TO_UNICODE[0xB5] = 'µ';
WIN1251_TO_UNICODE[0xB6] = '¶';
WIN1251_TO_UNICODE[0xB7] = '·';
WIN1251_TO_UNICODE[0xB8] = 'ё';
WIN1251_TO_UNICODE[0xB9] = '№';
WIN1251_TO_UNICODE[0xBA] = 'є';
WIN1251_TO_UNICODE[0xBB] = '»';
WIN1251_TO_UNICODE[0xBC] = 'ј';
WIN1251_TO_UNICODE[0xBD] = 'Ѕ';
WIN1251_TO_UNICODE[0xBE] = 'ѕ';
WIN1251_TO_UNICODE[0xBF] = 'ї';
// Russian letters
for (let i = 0xC0; i <= 0xFF; i++) {
  if (i === 0xFE) {
    WIN1251_TO_UNICODE[i] = 'ъ';
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
  
  console.log('Status:', response.status);
  console.log('Content-Type:', response.headers.get('content-type'));
  
  const buffer = await response.arrayBuffer();
  console.log('Buffer size:', buffer.byteLength);
  
  // Decode as windows-1251
  const html = decodeWindows1251(buffer);
  
  // Check page title
  const pageTitleMatch = html.match(/<title>([^<]+)<\/title>/);
  console.log('\nPage title:', pageTitleMatch ? pageTitleMatch[1] : 'not found');
  
  // Find title patterns in JSON
  const titleMatches = html.match(/"title"\s*:\s*"[^"]+"/g) || [];
  console.log('\nFound title fields:', titleMatches.length);
  titleMatches.slice(0, 5).forEach((m, i) => console.log(`  ${i+1}. ${m}`));
  
  // Find stories pattern
  const storiesMatch = html.match(/"stories"\s*:/);
  console.log('\nHas "stories": key:', !!storiesMatch);
  
  // Find first 5 story titles if possible
  const storyTitlePattern = /\{"id":(\d+)[^}]*"title":"([^"]+)"/g;
  let match;
  let count = 0;
  console.log('\nStory titles from JSON:');
  while ((match = storyTitlePattern.exec(html)) !== null && count < 5) {
    console.log(`  ${count + 1}. [${match[1]}] "${match[2].substring(0, 60)}"`);
    count++;
  }
  
  // Try JSON.parse on a story object
  const storyObjMatch = html.match(/\{"id":\d+[^}]*"title":"[^"]+"[^}]*\}/);
  if (storyObjMatch) {
    try {
      // Find complete object
      let startIdx = storyObjMatch.index!;
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      const jsonStr = html.substring(startIdx, endIdx);
      const obj = JSON.parse(jsonStr);
      console.log('\nParsed story object:');
      console.log('  ID:', obj.id);
      console.log('  Title:', obj.title);
      console.log('  Tags:', obj.tags?.slice(0, 3));
      console.log('  Images:', obj.images?.length || 0);
    } catch (e) {
      console.log('\nFailed to parse story object:', e);
    }
  }
}

debug().catch(console.error);
