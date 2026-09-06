import type { SVGProps } from 'react';

type IconName = 'today' | 'journey' | 'calendar' | 'journal' | 'back' | 'check' | 'light';
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    today: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
      </>
    ),
    journey: (
      <>
        <path d="M6 3h12v18l-6-4-6 4V3Z" />
        <path d="M9 7h6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2" />
      </>
    ),
    journal: (
      <>
        <path d="M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Zm0 0v15" />
      </>
    ),
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    light: (
      <>
        <path d="M5 16h14c-1 4-4 5-7 5s-6-1-7-5Z" />
        <path d="M12 3c-4 4-3 7 0 9 3-2 4-5 0-9Z" />
        <path d="M12 13v3M3 9l2 1m14 0 2-1M7 3l1 2m8 0 1-2" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
