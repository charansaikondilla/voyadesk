import { Link } from "react-router-dom";
import { cx } from "./ui";

/** Product name lives here — rename the product in one place. */
export const PRODUCT_NAME = "VoyaDesk";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1d5fd1" />
      <path d="M8 20l8-11 8 11-8-3z" fill="white" />
    </svg>
  );
}

export function Brand({ dark, to = "/" }: { dark?: boolean; to?: string }) {
  return (
    <Link to={to} className={cx("inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight", dark ? "text-white" : "text-ink-900")}>
      <Logo />
      {PRODUCT_NAME}
    </Link>
  );
}
