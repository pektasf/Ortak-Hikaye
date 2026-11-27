import test from 'node:test';
import assert from 'node:assert/strict';
import { findReaderAuthorBlock, getReaderParagraphCredits, normalizeReaderText } from './reader-attribution.js';

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