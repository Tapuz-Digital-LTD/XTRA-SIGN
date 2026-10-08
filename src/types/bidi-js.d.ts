/**
 * bidi-js ships no types. Only the functions used here are declared, rather
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
    /** The brackets and other mirrored characters at right-to-left levels, by index. Takes the levels array itself. */
    getMirroredCharactersMap(text: string, levels: Uint8Array, start?: number, end?: number): Map<number, string>
  }

  export default function bidiFactory(): BidiApi
}
