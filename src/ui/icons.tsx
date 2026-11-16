import type { SVGProps } from "react";

/** Inline SVG icons: decorative by default (aria-hidden). Pass a title through the surrounding text or aria-label instead. */
type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Svg>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
  </Svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 8 4.5 4.5L14.5 8" />
  </Svg>
);
export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 9v4.5M10 6.5v.01" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5 17.5 16.5h-15L10 3.5Z" />
    <path d="M10 8.5v3.5M10 14.25v.01" />
  </Svg>
);
export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3v4M10 13v4M3 10h4M13 10h4" />
  </Svg>
);
export const InboxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 11.5 5.5 5h9l2 6.5v4h-13v-4Z" />
    <path d="M3.5 11.5h4l1 2h3l1-2h4" />
  </Svg>
);
export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="7" r="3" />
    <path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />
  </Svg>
);
export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Svg>
);
export const DotIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="3.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const RingIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="4.5" />
  </Svg>
);
export const BangIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4.5v7M10 15v.01" strokeWidth="2.25" />
  </Svg>
);
export const DashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 10h9" />
  </Svg>
);
