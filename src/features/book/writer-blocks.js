const normalizeBlockContent = value => String(value ?? '').replace(/\r/g, '').replace(/\u00a0/g, ' ').trimEnd();

export function readWriterCanvasBlocks(root, userId, existingBlocks = []) {
  if (!root) return [];
  const existingById = new Map(existingBlocks.filter(block => block.id).map(block => [block.id, block]));
  const blocks = [];

  for (const node of Array.from(root.childNodes || [])) {
    const id = node.nodeType === 1 ? node.getAttribute('data-block-id') : null;
    const content = normalizeBlockContent(
      node.nodeType === 3 ? node.textContent : (node.innerText || node.textContent || '')
    );
    if (!content.trim()) continue;
    const existing = id ? existingById.get(id) : null;
    blocks.push({
      id: existing ? existing.id : null,
      content,
      author_id: existing ? existing.author_id : userId,
      updated_by: existing && existing.author_id !== userId ? existing.updated_by : userId,
      ...(existing?.author_name ? { author_name: existing.author_name } : {}),
      ...(existing?.editor_name ? { editor_name: existing.editor_name } : {})
    });
  }

  if (!blocks.length) {
    const fallback = normalizeBlockContent(root.innerText || root.textContent || '').trim();
    if (fallback) {
      fallback.split(/\n\s*\n/).filter(Boolean).forEach(content => {
        blocks.push({ id: null, content: content.trimEnd(), author_id: userId, updated_by: userId });
      });
    }
  }
  return blocks;
}

export function validateWriterBlockOwnership(candidateBlocks = [], originalBlocks = [], userId) {
  const protectedBlocks = originalBlocks.filter(block => block.id && block.author_id !== userId);
  if (!protectedBlocks.length) return { valid: true, message: '' };

  const candidateById = new Map();
  for (const block of candidateBlocks) {
    if (!block.id) continue;
    if (candidateById.has(block.id)) {
      return { valid: false, message: 'Aynı paragraf iki kez algılandı. Metni kontrol edip yeniden dene.' };
    }
    candidateById.set(block.id, block);
  }

  const protectedIds = [];
  for (const block of protectedBlocks) {
    const candidate = candidateById.get(block.id);
    if (!candidate) {
      return { valid: false, message: 'Başka bir yazara ait korumalı paragraf silinmiş görünüyor. Bu değişiklik kaydedilmedi; sayfayı yenilemeden metni geri al.' };
    }
    if (normalizeBlockContent(candidate.content) !== normalizeBlockContent(block.content)) {
      return { valid: false, message: 'Başka bir yazara ait paragraf değişmiş görünüyor. Yazarın metnini korumak için bu değişiklik kaydedilmedi.' };
    }
    protectedIds.push(block.id);
  }

  const candidateProtectedOrder = candidateBlocks
    .filter(block => protectedBlocks.some(item => item.id === block.id))
    .map(block => block.id);
  if (candidateProtectedOrder.length !== protectedIds.length
    || candidateProtectedOrder.some((id, index) => id !== protectedIds[index])) {
    return { valid: false, message: 'Başka yazarlara ait paragrafların sırası değiştirilemez. Değişiklik kaydedilmedi.' };
  }
  return { valid: true, message: '' };
}


export function mergeProtectedBlocksForDraft(candidateBlocks = [], originalBlocks = [], userId) {
  const merged = candidateBlocks.map(block => {
    const original = block.id ? originalBlocks.find(item => item.id === block.id) : null;
    if (original && original.author_id !== userId) return { ...original };
    return { ...block, author_id: original?.author_id || userId, updated_by: userId };
  });
  const present = new Set(merged.filter(block => block.id).map(block => block.id));
  for (const original of originalBlocks) {
    if (original.id && original.author_id !== userId && !present.has(original.id)) merged.push({ ...original });
  }
  return merged;
}
