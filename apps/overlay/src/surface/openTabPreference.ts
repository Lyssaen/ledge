/** The launch form's "Open the terminal tab" switch, remembered; the chat card follows it too (spec 2026-10-12 §6). */
const OPEN_TAB_KEY = 'ledge.launch.openTab';
export const loadOpenTab = () => { try { return localStorage.getItem(OPEN_TAB_KEY) !== '0'; } catch { return true; } };
export const saveOpenTab = (on: boolean) => { try { localStorage.setItem(OPEN_TAB_KEY, on ? '1' : '0'); } catch { /* in-memory only */ } };
