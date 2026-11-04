/** What paints a first screen: home, clear, the lines, then the cursor where the pane has it. */
export function paintScreen(screen: string, cursor: { x: number; y: number }): string {
  return `\x1b[H\x1b[2J${screen.replace(/\n/g, '\r\n')}\x1b[${cursor.y + 1};${cursor.x + 1}H`;
}
