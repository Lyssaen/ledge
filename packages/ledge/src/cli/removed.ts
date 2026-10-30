/** Commands Ledge no longer has: one line, not the whole usage. */
export function removedCommand(cmd: string | undefined): string | undefined {
  if (cmd === 'task') return `ledge task a été retiré : pour une décision qui revient à l'utilisateur, ledge ask "<question>" "<options, ta recommandation>"`;
  if (cmd === 'team') return 'ledge team a été retiré';
  return undefined;
}
