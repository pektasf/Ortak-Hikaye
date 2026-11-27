export function normalizeReaderText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findReaderAuthorBlock(paragraph, blocks = []) {
  const target = normalizeReaderText(paragraph);
  if (!target) return null;
  const candidates = blocks.map(block => ({ block, text: normalizeReaderText(block.content) })).filter(item => item.text);
  return candidates.find(item => item.text === target)?.block
    || candidates.find(item => item.text.includes(target))?.block
    || null;
}

export function getReaderParagraphCredits(paragraph, blocks = []) {
  const block = findReaderAuthorBlock(paragraph, blocks);
  if (!block) return null;
  const authorName = block.author_id ? (block.author_name || 'Yazar') : null;
  const editorName = block.updated_by && block.updated_by !== block.author_id ? (block.editor_name || 'Yazar') : null;
  if (!authorName && !editorName) return null;
  return { authorName, editorName };
}
export function findReaderParagraphOffset(paragraph, blockContent) {
  const raw = String(blockContent ?? '');
  const target = normalizeReaderText(paragraph);
  if (!target) return 0;
  const exact = raw.indexOf(String(paragraph ?? ''));
  if (exact >= 0) return exact;
  let normalized = '';
  const rawOffsets = [];
  let whitespaceStart = null;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (/\s/.test(character)) {
      if (normalized && whitespaceStart === null) whitespaceStart = index;
      continue;
    }
    if (whitespaceStart !== null) { normalized += ' '; rawOffsets.push(whitespaceStart); whitespaceStart = null; }
    normalized += character;
    rawOffsets.push(index);
  }
  const start = normalized.indexOf(target);
  return start >= 0 ? (rawOffsets[start] ?? 0) : 0;
}
