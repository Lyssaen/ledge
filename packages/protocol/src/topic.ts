/** The longest topic a session carries: one line of a list row. */
export const TOPIC_MAX = 80;

/** A topic from free text: the first non-empty line, whitespace collapsed, cut to TOPIC_MAX with an ellipsis. */
export function cleanTopic(text: string): string {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? '';
  const flat = line.replace(/\s+/g, ' ');
  return flat.length > TOPIC_MAX ? `${flat.slice(0, TOPIC_MAX - 1).trimEnd()}…` : flat;
}

/** The session's title, also the terminal tab's: the bot's name and what it works on (its folder until it has a topic). */
export function sessionTitle(s: { name: string; project: string; topic?: string }): string {
  return `${s.name} · ${s.topic || s.project}`;
}
