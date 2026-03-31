// Debug script to analyze Pikabu response
const fs = require('fs');

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
  
  // First 100 bytes in hex
  const bytes = new Uint8Array(buffer.slice(0, 100));
  console.log('First 100 bytes (hex):', Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
  
  // Decode as UTF-8
  const decoder = new TextDecoder('utf-8');
  const html = decoder.decode(buffer);
  
  // Save to file
  fs.writeFileSync('/tmp/pikabu-response.html', html);
  console.log('Saved to /tmp/pikabu-response.html');
  
  // Find title patterns
  const titleMatches = html.match(/"title"\s*:\s*"[^"]+"/g) || [];
  console.log('\nFound title fields:', titleMatches.length);
  titleMatches.slice(0, 3).forEach((m, i) => console.log(`  ${i+1}. ${m}`));
  
  // Find stories pattern
  const storiesMatch = html.match(/"stories"\s*:/);
  console.log('\nHas "stories": key:', !!storiesMatch);
  
  // Find first 3 story titles if possible
  const storyTitlePattern = /\{"id":\d+[^}]*"title":"([^"]+)"/g;
  let match;
  let count = 0;
  console.log('\nStory titles:');
  while ((match = storyTitlePattern.exec(html)) !== null && count < 3) {
    console.log(`  ${count + 1}. ${match[1].substring(0, 60)}`);
    count++;
  }
  
  // Check for __INITIAL_STATE__
  const stateMatch = html.match(/__INITIAL_STATE__/);
  console.log('\nHas __INITIAL_STATE__:', !!stateMatch);
  
  // Check charset
  const charsetMatch = html.match(/charset=["']?([^"'\s>]+)/i);
  console.log('Charset:', charsetMatch ? charsetMatch[1] : 'not found');
}

debug().catch(console.error);
