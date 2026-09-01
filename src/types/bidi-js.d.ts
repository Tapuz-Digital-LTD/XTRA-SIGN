/**
 * bidi-js ships no types. Only the two functions used here are declared, rather
 * than a wholesale `any` — a wrong argument to the bidi pass would silently
 * mis-order text on a signed document.
 */
declare module 'bidi-js' {
  export type EmbeddingLevels = {
    levels: Uint8Array
    paragraphs: { start: number; end: number; level: number }[]
  }

  export type BidiApi = {
    getEmbeddingLevels(text: string, baseDirection?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][]
  }

  export default function bidiFactory(): BidiApi
}
