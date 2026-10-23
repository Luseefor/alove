import type { SVGProps } from "react";

/** Option 03: source brackets around the Weftly initial. */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M24 10H4V90H24V80H14V20H24Z M76 10H96V90H76V80H86V20H76Z M28 36H37L42 54L47 38H53L58 54L63 36H72L62 67H54L50 54L46 67H38Z" />
    </svg>
  );
}
