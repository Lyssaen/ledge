/** Joins the class names that are set. */
export const cls = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');
