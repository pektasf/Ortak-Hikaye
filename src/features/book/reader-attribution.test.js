import test from 'node:test';
import assert from 'node:assert/strict';
import { findReaderAuthorBlock, findReaderParagraphOffset, getReaderParagraphCredits, normalizeReaderText } from './reader-attribution.js';
import { normalizeWriterPaste } from './writer-input.js';

test('normalizes line breaks, non-breaking spaces and repeated whitespace', () => {
  assert.equal(normalizeReaderText('  İlk\u00a0 satır\n\n ikinci   satır  '), 'İlk satır ikinci satır');
});

test('matches a paragraph to its saved author block', () => {
  const block = { content: 'Birinci paragraf.', author_id: 'writer-a', author_name: 'Eda' };
  assert.equal(findReaderAuthorBlock('Birinci paragraf.', [block]), block);
});

test('matches a page fragment to the original paragraph block', () => {
  const block = { content: 'Uzun bir paragrafın ilk cümlesi. İkinci cümlesi burada.', author_id: 'writer-a' };
  assert.equal(findReaderAuthorBlock('ilk cümlesi. İkinci cümlesi', [block]), block);
});

test('shows original author and a different last editor without confusing their roles', () => {
  const blocks = [{ content: 'Ortak paragraf.', author_id: 'writer-a', author_name: 'Eda', updated_by: 'writer-b', editor_name: 'Mahmut' }];
  assert.deepEqual(getReaderParagraphCredits('Ortak paragraf.', blocks), { authorName: 'Eda', editorName: 'Mahmut' });
});

test('does not invent an original author for legacy blocks', () => {
  const blocks = [{ content: 'Eski paragraf.', author_id: null, updated_by: null }];
  assert.equal(getReaderParagraphCredits('Eski paragraf.', blocks), null);
});
test('maps a page fragment offset back to the original paragraph, including line breaks', () => {
  const source = 'Birinci cümle.\n   İkinci cümle. Üçüncü cümle.';
  assert.equal(findReaderParagraphOffset('İkinci cümle.', source), source.indexOf('İkinci'));
});

test('uses the exact source offset when a page fragment is unchanged', () => {
  const source = 'Başlangıç. Devam eden cümle.';
  assert.equal(findReaderParagraphOffset('Devam eden cümle.', source), source.indexOf('Devam'));
});


test('normalizes clipboard line endings and non-breaking spaces without losing paragraphs', () => {
  assert.equal(normalizeWriterPaste('Birinci satır\r\n\r\nİkinci\u00a0paragraf'), 'Birinci satır\n\nİkinci paragraf');
});

test('keeps Turkish characters and punctuation unchanged', () => {
  assert.equal(normalizeWriterPaste('İçimdeki öykü: “Şimdi başlıyor.”'), 'İçimdeki öykü: “Şimdi başlıyor.”');
});


import { readWriterCanvasBlocks, validateWriterBlockOwnership } from './writer-blocks.js';

test('canvas reader preserves the original author metadata of existing blocks', () => {
  const paragraph = { nodeType: 1, getAttribute: name => name === 'data-block-id' ? 'block-a' : null, innerText: 'Düzenlenen paragraf.' };
  const root = { childNodes: [paragraph] };
  const existing = [{ id: 'block-a', content: 'Eski metin.', author_id: 'writer-a', updated_by: 'writer-b', author_name: 'Eda' }];
  assert.deepEqual(readWriterCanvasBlocks(root, 'writer-b', existing), [{
    id: 'block-a', content: 'Düzenlenen paragraf.', author_id: 'writer-a', updated_by: 'writer-b', author_name: 'Eda'
  }]);
});

test('new canvas paragraphs are attributed to the current writer', () => {
  const paragraph = { nodeType: 1, getAttribute: () => null, innerText: 'Yeni paragraf.' };
  assert.deepEqual(readWriterCanvasBlocks({ childNodes: [paragraph] }, 'writer-b'), [{
    id: null, content: 'Yeni paragraf.', author_id: 'writer-b', updated_by: 'writer-b'
  }]);
});

test('protected paragraphs cannot be removed, changed, or reordered during save', () => {
  const original = [
    { id: 'protected-a', content: 'Eda paragrafı.', author_id: 'writer-a' },
    { id: 'mine', content: 'Benim paragrafım.', author_id: 'writer-b' },
    { id: 'protected-c', content: 'Mahmut paragrafı.', author_id: 'writer-c' }
  ];
  assert.equal(validateWriterBlockOwnership([original[1], original[2]], original, 'writer-b').valid, false);
  assert.equal(validateWriterBlockOwnership([{ ...original[0], content: 'Değiştirildi.' }, original[1], original[2]], original, 'writer-b').valid, false);
  assert.equal(validateWriterBlockOwnership([original[2], original[1], original[0]], original, 'writer-b').valid, false);
});

test('writers can edit their own paragraphs while protected paragraphs remain intact', () => {
  const original = [
    { id: 'protected-a', content: 'Eda paragrafı.', author_id: 'writer-a' },
    { id: 'mine', content: 'Eski metin.', author_id: 'writer-b' }
  ];
  const candidate = [original[0], { ...original[1], content: 'Yeni metin.' }];
  assert.deepEqual(validateWriterBlockOwnership(candidate, original, 'writer-b'), { valid: true, message: '' });
});
