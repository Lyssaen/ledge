// The new strings the « Conversation » tab needs, French first (the source of truth), English alongside. The builder moves
// them to apps/desktop/src/i18n/{fr,en}.ts under `session.conversation`; everything else is the app's existing copy.
import type { Lang } from '../../../apps/desktop/src/i18n/lang';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const CONVERSATION = {
  fr: {
    // Entry points in the thread: the card's link, the conversation header's pill.
    follow: 'suivre la conversation',
    followTitle: (b: string) => `Suivre la conversation avec ${b} à côté du fil`,
    followBeside: 'Suivre à côté',
    openBeside: 'Ouvert à côté',
    // The tab and its head.
    tab: (b: string) => `Conversation · ${b}`,
    tabNew: (b: string, k: number) => `Conversation · ${b}, ${plural(k, '1 nouveau message', `${k} nouveaux messages`)}`,
    log: (a: string, b: string) => `Conversation entre ${a} et ${b}`,
    count: (k: number) => plural(k, '1 message', `${k} messages`),
    // A bubble.
    kicker: (from: string, to: string) => `Message de ${from} à ${to}`,
    readBy: (who: string) => `Lu par ${who}`,
    deliveredTo: (who: string) => `Remis à ${who}, pas encore lu`,
    inThread: 'dans le fil',
    inThreadTitle: (a: string) => `Montrer dans le fil de ${a}`,
    // Live: the reader scrolled up when a message came.
    fresh: (k: number) => plural(k, '1 nouveau message', `${k} nouveaux messages`),
    // States.
    oneSided: (b: string, a: string) => `${b} n’est pas une session que Ledge suit sur cette machine. La conversation est lue dans le fil de ${a} seulement : les messages de ${b} apparaissent quand ${a} les reçoit, et Ledge ne sait pas si ceux de ${a} ont été lus.`,
    oneSidedLead: 'Vue d’un seul côté',
    empty: (a: string, b: string) => `Aucun message entre ${a} et ${b} pour l’instant.`,
    emptyHint: 'Ils s’afficheront ici, en direct, dès que l’un écrira à l’autre.',
    loadingPeer: (b: string) => `Lecture du fil de ${b}…`
  },
  en: {
    follow: 'follow the conversation',
    followTitle: (b: string) => `Follow the conversation with ${b} beside the thread`,
    followBeside: 'Follow beside',
    openBeside: 'Open beside',
    tab: (b: string) => `Conversation · ${b}`,
    tabNew: (b: string, k: number) => `Conversation · ${b}, ${plural(k, '1 new message', `${k} new messages`)}`,
    log: (a: string, b: string) => `Conversation between ${a} and ${b}`,
    count: (k: number) => plural(k, '1 message', `${k} messages`),
    kicker: (from: string, to: string) => `Message from ${from} to ${to}`,
    readBy: (who: string) => `Read by ${who}`,
    deliveredTo: (who: string) => `Delivered to ${who}, not read yet`,
    inThread: 'in the thread',
    inThreadTitle: (a: string) => `Show it in ${a}'s thread`,
    fresh: (k: number) => plural(k, '1 new message', `${k} new messages`),
    oneSided: (b: string, a: string) => `${b} is not a session Ledge follows on this machine. The conversation is read from ${a}'s thread only: ${b}'s messages show once ${a} receives them, and Ledge cannot tell whether ${a}'s were read.`,
    oneSidedLead: 'Seen from one side',
    empty: (a: string, b: string) => `No messages between ${a} and ${b} yet.`,
    emptyHint: 'They will show here, live, as soon as one writes to the other.',
    loadingPeer: (b: string) => `Reading ${b}'s thread…`
  }
} satisfies Record<Lang, unknown>;

export type ConversationCopy = (typeof CONVERSATION)['fr'];
export const conversationCopy = (lang: Lang): ConversationCopy => CONVERSATION[lang];
