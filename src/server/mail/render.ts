import { render } from '@react-email/render'
import type { ReactElement } from 'react'

/** HTML for the mail client and a plain-text twin for the ones that ask. */
export type RenderedEmail = { subject: string; html: string; text: string }

export async function renderEmail(subject: string, element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { subject, html, text }
}
