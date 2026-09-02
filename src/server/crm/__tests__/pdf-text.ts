/**
 * Reads the text back out of a generated PDF.
 *
 * Test-only. It exists so the Hebrew assertion is about glyphs that a reader
 * can actually extract, rather than about the byte length of a file that would
 * look perfectly healthy while rendering every Hebrew character as a box.
 */
export async function extractPdfText(pdf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // `destroy` lives on the loading task, not on the document.
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    // Fonts are embedded by the renderer; never reach for the system's.
    useSystemFonts: false,
  })
  const doc = await task.promise

  let out = ''
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent()
    out += content.items.map((item) => ('str' in item ? item.str : '')).join('')
  }
  await task.destroy()
  return out
}
