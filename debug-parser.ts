// Debug script to analyze Pikabu response encoding

// Windows-1251 decoder
const WIN1251_TO_UNICODE: Record<number, string> = {};
for (let i = 0; i < 256; i++) {
  if (i < 0x80) {
    WIN1251_TO_UNICODE[i] = String.fromCharCode(i);
  }
}
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
WIN1251_TO_UNICODE[0xA8] = '\u0401';
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
WIN1251_TO_UNICODE[0xB8] = '\u0451';
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
  titleMatches.slice(0, 5).forEach((m, i) => console.log('  ' + (i+1) + '. ' + m));
  
  // Find stories pattern
  const storiesMatch = html.match(/"stories"\s*:/);
  console.log('\nHas "stories": key:', !!storiesMatch);
  
  // Find first 5 story titles if possible
  const storyTitlePattern = /\{"id":(\d+)[^}]*"title":"([^"]+)"/g;
  let match;
  let count = 0;
  console.log('\nStory titles from JSON:');
  while ((match = storyTitlePattern.exec(html)) !== null && count < 5) {
    console.log('  ' + (count + 1) + '. [' + match[1] + '] "' + match[2].substring(0, 60) + '"');
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
