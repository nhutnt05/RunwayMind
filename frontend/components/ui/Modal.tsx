'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  /** Called when the user asks to close (Esc, backdrop click, close button). Ignored while `dismissible` is false. */
  onClose: () => void;
  /** false while an action is in flight that must not be interrupted (e.g. a wallet prompt is open). */
  dismissible?: boolean;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Accessible modal on the native `<dialog>` element: `showModal()` gives a focus trap, an inert page behind it, Esc
 * handling and focus return to the opener for free (docs/08 §9). The `[data-autofocus]` element inside receives focus.
 * Backdrop (blur) and enter animation live in app/globals.css (`.rm-modal`) and respect prefers-reduced-motion.
 */
export function Modal({ open, onClose, dismissible = true, labelledBy, describedBy, children, className = '' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  closeRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // React does not render the `autofocus` attribute; content marks its initial focus with `data-autofocus`.
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Esc fires `cancel`: keep the dialog under React's control (it decides via onClose → open=false).
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissibleRef.current) closeRef.current();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal="true"
      className={`rm-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl ${className}`}
      onClick={(e) => {
        // A click on the dialog element itself (not its content) is a click on the backdrop.
        if (e.target === e.currentTarget && dismissibleRef.current) closeRef.current();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
