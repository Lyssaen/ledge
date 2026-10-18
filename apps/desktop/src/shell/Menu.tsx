import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';

export interface MenuTrigger { ref: RefObject<HTMLButtonElement | null>; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; onClick(): void }
export interface MenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** aria-label of the role="menu". */
  label: string;
  /** The wrapper. */
  className: string;
  menuClassName: string;
  /** On opening, the menu opens upward (class `up`) when the button's bottom is past 55 % of the window's height. */
  flip?: boolean;
  trigger(t: MenuTrigger): ReactNode;
  /** MenuItems. */
  children: ReactNode;
}

/** Closes the menu and gives the focus back to its button. */
const CloseMenu = createContext<() => void>(() => {});

/** One menu for every « … » and « Ranger dans… »: a mousedown outside or the focus leaving closes it, Escape closes it and goes no further
 *  (captured on the window, so the global keys never see it), the arrows, Home and End move between its items. */
export function Menu({ open, onOpenChange, label, className, menuClassName, flip, trigger, children }: MenuProps): JSX.Element {
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  const close = () => { onOpenChange(false); button.current?.focus(); };
  const closeRef = useRef(close);
  closeRef.current = close;
  const changeRef = useRef(onOpenChange);
  changeRef.current = onOpenChange;

  useLayoutEffect(() => {
    if (!open || !flip) { setUp(false); return; }
    const r = button.current?.getBoundingClientRect();
    setUp(!!r && r.bottom > window.innerHeight * 0.55);
  }, [open, flip]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) changeRef.current(false); };
    const escape = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); closeRef.current(); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let to: number;
    if (e.key === 'ArrowDown') to = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') to = (at <= 0 ? items.length : at) - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    else return;
    e.preventDefault();
    items[to]!.focus();
  };

  return (
    // The focus leaving for a control outside (Tab, or a key like F that moves it) closes the menu, and stays where it went.
    <span className={className} ref={wrap} onBlur={e => { if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) changeRef.current(false); }}>
      {trigger({ ref: button, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => onOpenChange(!open) })}
      {open && (
        <CloseMenu.Provider value={() => closeRef.current()}>
          <div ref={menu} className={`${menuClassName}${up ? ' up' : ''}`} role="menu" aria-label={label} onKeyDown={onKeyDown}>{children}</div>
        </CloseMenu.Provider>
      )}
    </span>
  );
}

/** A choice: closes the menu, gives the focus back to its button, then calls onSelect. */
export function MenuItem({ onSelect, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'onClick' | 'role'> & { onSelect(): void }): JSX.Element {
  const close = useContext(CloseMenu);
  return <button type="button" {...rest} role="menuitem" onClick={() => { close(); onSelect(); }} />;
}
