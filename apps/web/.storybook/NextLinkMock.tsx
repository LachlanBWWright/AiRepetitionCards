import type { AnchorHTMLAttributes, ReactNode } from "react";

export default function NextLinkMock({
  href,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly href: string;
  readonly children?: ReactNode;
}) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
