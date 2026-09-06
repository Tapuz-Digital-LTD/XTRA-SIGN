'use client'

import Link from 'next/link'
import { track } from './track'

/** The signpost: a link that says it was clicked before it goes. */
export function CtaLink({
  formId,
  href,
  className,
  children,
  ...rest
}: {
  formId: string
  href: string
  className?: string
  children: React.ReactNode
  'aria-label'?: string
}) {
  return (
    <Link href={href} className={className} onClick={() => track(formId, 'join_cta_clicked')} {...rest}>
      {children}
    </Link>
  )
}
