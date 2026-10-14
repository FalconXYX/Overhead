// src/ui/Popover.tsx — [Redesign] a button and the panel it opens (redesign spec section 2): Layers, Credits, the
// keyboard shortcuts [?] and In view. A disclosure, not a modal: the button carries aria-expanded and aria-controls,
// the panel is a labelled region that stays in the DOM (hidden) while closed, Esc closes it and returns focus to the
// button, and a press outside it closes it. Placement is CSS (layout.css, class "popover").
import { type ReactNode, useEffect, useId, useRef } from "react";

export interface PopoverProps {
  /** The button's visible content. */
  readonly label: ReactNode;
  /** The button's accessible name when its content is an icon or carries a count. */
  readonly buttonName?: string;
  /** The panel's accessible name (a region). */
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Which edge of the button the panel lines up with. */
  readonly align?: "start" | "end";
  /** Below the button (header) or above it (the control bar). */
  readonly placement?: "below" | "above";
  readonly className?: string;
  readonly buttonClassName?: string;
  /** A fixed panel id, for controls elsewhere that point at it; else a generated one. */
  readonly id?: string;
  readonly children?: ReactNode;
}

export function Popover({
  label,
  buttonName,
  title,
  open,
  onOpenChange,
  align = "end",
  placement = "below",
  className,
  buttonClassName,
  id,
  children,
}: PopoverProps) {
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A press anywhere outside the button and the panel closes it (the next popover's button included).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && e.target instanceof Node && !root.contains(e.target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc from the button or anything inside the panel closes it
    <div
      ref={rootRef}
      className={className === undefined ? "popover" : `popover ${className}`}
      onKeyDown={(e) => {
        // preventDefault: keyboard.ts then leaves this Esc alone (it would clear the selection).
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        onOpenChange(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={buttonName}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        {label}
      </button>
      <section
        id={panelId}
        aria-label={title}
        className={`popover-panel popover-panel--${align} popover-panel--${placement}`}
        hidden={!open}
      >
        {children}
      </section>
    </div>
  );
}
