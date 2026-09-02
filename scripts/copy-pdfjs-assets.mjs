// pdf.js needs its standard-font and cmap data reachable at a same-origin URL,
// so non-embedded standard-14 fonts and CID encodings render correctly. Copied
// into public/ from the installed package so a fresh `npm ci` on Vercel has
// them without committing hundreds of binaries by hand.
import { cp, mkdir } from 'node:fs/promises'
const src = 'node_modules/pdfjs-dist'
const dst = 'public/pdfjs'
await mkdir(dst, { recursive: true })
for (const dir of ['standard_fonts', 'cmaps']) {
  await cp(`${src}/${dir}`, `${dst}/${dir}`, { recursive: true })
}
console.log('copied pdf.js standard_fonts and cmaps into public/pdfjs')
