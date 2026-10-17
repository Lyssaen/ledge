export interface DocumentReference { path: string; anchor?: string; line?: number; column?: number }

/** A WSL Markdown path, optionally pointing at a source line or heading. */
export function parseDocumentReference(raw: string): DocumentReference | null {
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|file:|\\\\|[a-z]:[\\/])/i.test(raw)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (/#L(?:0|[+-])/i.test(decoded)) return null;
  const match = /^(.*?\.(?:md|markdown))(?::([1-9]\d*)(?::([1-9]\d*))?|#(?:L([1-9]\d*)|([\p{L}\p{N}_-]+)))?$/iu.exec(decoded);
  if (!match || !match[1] || match[1].includes('\0')) return null;
  const [, path, line, column, fragmentLine, anchor] = match;
  return { path, ...(line || fragmentLine ? { line: Number(line ?? fragmentLine) } : {}),
    ...(column ? { column: Number(column) } : {}), ...(anchor ? { anchor } : {}) };
}

/** Only unambiguous, space-free paths are detected in prose. Delimited Markdown links handle paths with spaces. */
export function findDocumentReferences(text: string): Array<{ start: number; end: number; reference: DocumentReference }> {
  const found: Array<{ start: number; end: number; reference: DocumentReference }> = [];
  const re = /(?:^|[\s([{'"`])((?:~\/|\.{1,2}\/|\/)?[^\s<>`'"()[\]{},;!?]+?\.(?:md|markdown)(?::[1-9]\d*(?::[1-9]\d*)?|#(?:L[1-9]\d*|[\p{L}\p{N}_-]+))?)(?=$|[\s.),;!?\]}'"`])/giu;
  for (const m of text.matchAll(re)) {
    const path = m[1]!;
    const reference = parseDocumentReference(path);
    if (reference) found.push({ start: m.index! + m[0].length - path.length, end: m.index! + m[0].length, reference });
  }
  return found;
}
