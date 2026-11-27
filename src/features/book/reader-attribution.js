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