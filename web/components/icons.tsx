import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const I = {
  Lock: (p: P) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>,
  Grid: (p: P) => <Svg {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></Svg>,
  Check: (p: P) => <Svg {...p}><path d="M5 12l5 5L20 7" /></Svg>,
  CheckSquare: (p: P) => <Svg {...p}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Svg>,
  Chart: (p: P) => <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>,
  Home: (p: P) => <Svg {...p}><path d="M3 11l9-8 9 8v10H3z" /><path d="M9 21v-6h6v6" /></Svg>,
  Target: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Svg>,
  List: (p: P) => <Svg {...p}><path d="M3 5h10M7 12h12M5 19h8" /></Svg>,
  Lanes: (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18" /></Svg>,
  Wallet: (p: P) => <Svg {...p}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M16 14h2M3 10h18" /></Svg>,
  Users: (p: P) => <Svg {...p}><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6" /><path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6" /></Svg>,
  Sliders: (p: P) => <Svg {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>,
  Card: (p: P) => <Svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></Svg>,
  Help: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17.5v.01" /></Svg>,
  Chevron: (p: P) => <Svg {...p}><path d="M7 10l5 5 5-5" /></Svg>,
  ChevronRight: (p: P) => <Svg {...p}><path d="M10 7l5 5-5 5" /></Svg>,
  Plus: (p: P) => <Svg {...p} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></Svg>,
  Search: (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Svg>,
  Eye: (p: P) => <Svg {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>,
  Diamond: (p: P) => <Svg {...p}><path d="M12 3l9 9-9 9-9-9z" /></Svg>,
  File: (p: P) => <Svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></Svg>,
  FilePlus: (p: P) => <Svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M12 12v6M9 15h6" /></Svg>,
  Clip: (p: P) => <Svg {...p}><path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8" /></Svg>,
  Upload: (p: P) => <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></Svg>,
  Download: (p: P) => <Svg {...p}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></Svg>,
  External: (p: P) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>,
  Reset: (p: P) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Svg>,
  Trash: (p: P) => <Svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Svg>,
  X: (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  Menu: (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>,
  Link: (p: P) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>,
  Up: (p: P) => <Svg {...p} strokeWidth={2.5}><path d="M6 15l6-6 6 6" /></Svg>,
  Printer: (p: P) => <Svg {...p}><path d="M6 9V3h12v6M6 18H4v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6h-2" /><rect x="6" y="14" width="12" height="7" /></Svg>,
  Shield: (p: P) => <Svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></Svg>,
  Logout: (p: P) => <Svg {...p}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4" /></Svg>,
  User: (p: P) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></Svg>,
  Gift: (p: P) => <Svg {...p}><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M5 12v9h14v-9M12 8a3 3 0 1 1 3-3c0 3-3 3-3 3zM12 8a3 3 0 1 0-3-3c0 3 3 3 3 3z" /></Svg>,
  Pencil: (p: P) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /></Svg>,
};

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.27 }}>
      <I.Lock size={size * 0.53} strokeWidth={2.2} />
    </span>
  );
}
