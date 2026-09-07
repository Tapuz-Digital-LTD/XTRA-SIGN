import { COMPARISON_ROWS, goalLabel } from '@/lib/campaigns'

/**
 * "מה ההבדל בין האפשרויות?" — a text button under the two goal cards that
 * opens the comparison in place. Native <details>: no state, works in the
 * dialog's own scroll at every width.
 */
export function CampaignComparison() {
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-base text-brand underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
        מה ההבדל בין האפשרויות?
      </summary>
      <div className="mt-2 overflow-hidden rounded-xl border border-line">
        <table className="w-full table-fixed text-sm sm:text-base">
          <thead>
            <tr className="bg-bg">
              <th scope="col" className="w-[28%] px-3 py-2" />
              <th scope="col" className="px-3 py-2 text-start font-semibold text-fg">{goalLabel('inquiries')}</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-fg">{goalLabel('signing')}</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label} className="border-t border-line align-top">
                <th scope="row" className="break-words px-3 py-2 text-start font-medium text-fg">{row.label}</th>
                <td className="break-words px-3 py-2 text-muted">{row.inquiries}</td>
                <td className="break-words px-3 py-2 text-muted">{row.signing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
