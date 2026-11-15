'use client';

import { useId } from 'react';
import { CloseIcon, NoteIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import type { ObligationItem } from '@/lib/api';

/** The obligation's off-chain note, or null when it has none (blank notes count as none). */
export function obligationNote(o: ObligationItem): string | null {
  const n = o.metadata?.notes?.trim();
  return n ? n : null;
}

function obligationName(o: ObligationItem): string {
  return o.metadata?.label ?? `Obligation #${o.id}`;
}

/** Note cell / card entry: an icon button that opens the note popup, or "—" when there is no note. */
export function NoteButton({ o, onOpen }: { o: ObligationItem; onOpen: (o: ObligationItem) => void }) {
  if (!obligationNote(o)) {
    return (
      <span className="text-slate-400" aria-label="No note">
        —
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(o)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
      aria-label={`View note for ${obligationName(o)}`}
      title="View note"
      aria-haspopup="dialog"
    >
      <NoteIcon className="h-4 w-4" />
    </button>
  );
}

/** Read-only popup with the full note. Notes are user text: rendered as plain text (React escapes it), line breaks kept. */
export function ObligationNoteDialog({ obligation, onClose }: { obligation: ObligationItem | null; onClose: () => void }) {
  const uid = useId();
  const note = obligation ? obligationNote(obligation) : null;
  return (
    <Modal open={obligation !== null} onClose={onClose} labelledBy={`${uid}-title`} describedBy={`${uid}-meta`} className="max-w-md">
      {obligation ? (
        <div data-testid="obligation-note-dialog">
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200">
              <NoteIcon />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={`${uid}-title`} className="text-base font-semibold text-slate-900">
                Note
              </h2>
              <p id={`${uid}-meta`} className="mt-0.5 truncate text-sm text-slate-600">
                {obligationName(obligation)} · <span className="font-mono text-xs">#{obligation.id}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Close note"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="px-5 pb-5">
            <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-900">
              {note ?? 'No note.'}
            </p>
            <p className="mt-2 text-xs text-slate-500">Off-chain note. An ADMIN can change it with Edit (no transaction needed).</p>
          </div>
          <div className="flex justify-end border-t border-slate-200 bg-slate-50/80 px-5 py-3">
            <button
              type="button"
              data-autofocus
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
