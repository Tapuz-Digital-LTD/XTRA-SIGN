/**
 * The document, as page images.
 *
 * Not an embedded PDF: the field editor needs fixed pixel geometry to place
 * fields, and an image cannot execute whatever a hostile document was carrying.
 * Each page is fetched from an authorized route, so no storage URL is exposed.
 */
export function DocumentPreview({
  documentId,
  pageCount,
}: {
  documentId: string
  pageCount: number
}) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)

  return (
    <div className="flex flex-col gap-4">
      {pages.map((page) => (
        // Deliberately a plain <img>, not next/image: the optimizer fetches the
        // source itself and this route requires the viewer's session cookie, so
        // optimization would either fail or need the page made reachable
        // without authorization. Neither is acceptable for a private document.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={page}
          src={`/api/documents/${documentId}/pages/${page}`}
          alt={`עמוד ${page} מתוך ${pageCount}`}
          // Intrinsic size reserves the space before the image lands, so the
          // page does not jump as each one loads.
          width={1240}
          height={1754}
          loading={page === 1 ? 'eager' : 'lazy'}
          className="h-auto w-full rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow)]"
        />
      ))}
    </div>
  )
}
