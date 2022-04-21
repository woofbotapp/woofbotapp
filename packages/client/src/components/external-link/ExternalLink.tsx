import React, { ReactNode } from 'react';
import Link from '@mui/material/Link';

interface ExternalLinkProps {
  href: string;
  children?: ReactNode;
}

export default function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <Link href={href} color="inherit" rel="noopener noreferrer">
      {children}
    </Link>
  );
}

ExternalLink.defaultProps = {
  children: undefined,
};
