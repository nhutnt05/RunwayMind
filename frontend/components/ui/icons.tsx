// Small stroke icons (24 × 24 grid, currentColor) for dialogs and transaction states. Decorative: always aria-hidden,
// the meaning is carried by adjacent text (docs/08 §9).
import type { SVGProps } from 'react';

export function Icon({ children, className = 'h-5 w-5', ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = { className?: string };

export const AlertTriangleIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);

export const LinkChainIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Icon>
);

export const CheckCircleIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </Icon>
);

export const XCircleIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Icon>
);

export const BanIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.7 5.7 12.6 12.6" />
  </Icon>
);

export const WalletIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
    <path d="M16 14h.01" />
  </Icon>
);

export const SearchIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const NoteIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Icon>
);

export const CalendarIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </Icon>
);

export const CloseIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

/** Indeterminate spinner (static under prefers-reduced-motion, see globals.css). */
export const Spinner = ({ className = 'h-4 w-4' }: P) => (
  <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
);
