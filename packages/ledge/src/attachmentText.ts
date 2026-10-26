/** The text form of an attached image typed into agents that have no native image input. Pure: the hook imports it too. */
export const imageBracket = (path: string): string => `[Image attached: ${path}]`;

/** The reply text followed by one bracket per image, joined by single spaces. */
export const withImages = (text: string, paths: string[]): string => [text, ...paths.map(imageBracket)].join(' ').trim();

const BRACKET = /\[Image attached: ([^\]\n]*)\]/g;

/** Takes the brackets that point into `dir` (`<64 hex>.<webp|jpg|png|gif>`) out of `text`, returning their ids in order; other brackets stay. */
export function takeImages(text: string, dir: string): { text: string; ids: string[] } {
  const prefix = dir.replace(/\/+$/, '') + '/';
  const ids: string[] = [];
  const rest = text.replace(BRACKET, (whole, path: string) => {
    if (!path.startsWith(prefix)) return whole;
    const m = /^([0-9a-f]{64})\.(?:webp|jpg|png|gif)$/.exec(path.slice(prefix.length));
    if (!m) return whole;
    ids.push(m[1]!);
    return '';
  });
  return { text: rest.replace(/ {2,}/g, ' ').trim(), ids };
}
