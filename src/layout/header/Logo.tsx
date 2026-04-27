import { FC } from "react";

export const Logo: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label="electionsBG"
  >
    <defs>
      <clipPath id="logoCardClip">
        <rect x="4" y="4" width="56" height="56" rx="14" />
      </clipPath>
    </defs>
    <rect
      x="4"
      y="4"
      width="56"
      height="56"
      rx="14"
      fill="hsl(var(--logo-card))"
    />
    <g clipPath="url(#logoCardClip)">
      <rect x="4" y="52" width="56" height="2.7" fill="#FFFFFF" />
      <rect x="4" y="54.7" width="56" height="2.7" fill="#00966E" />
      <rect x="4" y="57.4" width="56" height="2.7" fill="#D62612" />
    </g>
    <path
      d="M16 30 L27 41 L48 17"
      stroke="hsl(var(--logo-check))"
      strokeWidth="7"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);
