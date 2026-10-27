/** A command or a path, wrapped so a long one never widens the page. */
export function Command({ text }: { text: string }) {
  return <pre className="my-3.5 rounded-control border border-line bg-well p-3.5 font-mono text-small leading-[1.8] break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</pre>;
}
