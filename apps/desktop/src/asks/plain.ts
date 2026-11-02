/**
 * An ask's Markdown body as plain text, for the folded card (three lines): the words stay, the syntax goes (« ## », « - », « ** »,
 * « ` », links' URLs, table pipes, fences, HTML tags). Lines are kept, blank runs folded to one. The unfolded card renders the
 * Markdown itself (the lead's decision, 2026-11-02).
 */
export function plainOf(markdown: string): string {
  const out: string[] = [];
  for (let line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) continue;                       // code fences (their content stays)
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;            // horizontal rules
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // table separators
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')                               // headings
      .replace(/^\s*(>\s?)+/, '')                                     // quotes
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')           // list markers, task boxes
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                       // images → their alt
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                        // links → their text
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')                             // HTML tags
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')                // bold
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1$2')        // italic *x*
      .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')           // italic _x_
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')                       // strikethrough
      .replace(/`([^`]+)`/g, '$1');                                   // inline code
    if (/\|/.test(line) && /^\s*\|.*\|\s*$/.test(line)) line = line.replace(/^\s*\||\|\s*$/g, '').split('|').map(c => c.trim()).join(' · ');
    out.push(line.trimEnd());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
