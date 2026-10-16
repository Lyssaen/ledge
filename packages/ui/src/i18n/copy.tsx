import { createContext, useContext, type ReactNode } from 'react';
import type { BotState } from '../bots/poseFor';

/** The few strings the shared mascots speak (aria labels, badge labels); each app maps its own messages to it. */
export interface UiCopy { stateLabel: Record<BotState, string>; botLabel: Record<BotState, string>; botReadOnly: string; botNotLive: string; residentName: string; residentOffline: string }
const UiCopyContext = createContext<UiCopy | null>(null);
/** French, so a mascot rendered before any i18n exists still has a label. */
let resolveDefault: () => UiCopy = () => ({
  stateLabel: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' },
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' },
  botReadOnly: 'Lecture seule', botNotLive: 'Figé', residentName: 'Ledge', residentOffline: 'Ledge · connexion perdue'
});
/** `createI18n` registers its stored-language copy here: a mascot outside a provider reads the stored language, as before. */
export function setDefaultUiCopy(fn: () => UiCopy): void { resolveDefault = fn; }
export function UiCopyProvider({ copy, children }: { copy: UiCopy; children: ReactNode }) { return <UiCopyContext.Provider value={copy}>{children}</UiCopyContext.Provider>; }
export function useUiCopy(): UiCopy { return useContext(UiCopyContext) ?? resolveDefault(); }
