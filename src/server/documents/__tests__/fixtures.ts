import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Real document fixtures, generated rather than committed as binaries.
 *
 * The legacy .doc is produced by LibreOffice itself: hand-writing the binary
 * format is not feasible, and a fixture that is not a genuine Word 97 file
 * would not exercise the path being tested.
 */
const DIR = join(tmpdir(), 'xtra-sign-fixtures')

export const FIXTURES = {
  docx: join(DIR, 'hesken.docx'),
  doc: join(DIR, 'hesken.doc'),
  bigPdf: join(DIR, 'big.pdf'),
}

function hebrewDocx(): Buffer {
  const para = (text: string) =>
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>` +
    `<w:r><w:rPr><w:rtl/><w:sz w:val="24"/></w:rPr>` +
    `<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

  const body =
    para('הסכם ספק — חודש התיירות') +
    para('שם העסק: אטרקציות ישראל בע״מ') +
    para('ח.פ: 515123456') +
    para('איש קשר: ישראל ישראלי') +
    para('אחוז עמלה: 15%') +
    para('חתימת הספק: ______________________')

  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  }

  return zip(files)
}

/** Minimal stored (uncompressed) ZIP writer — enough for a valid .docx. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name)
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, end])
}

let table: number[] | null = null
function crc32(buf: Buffer): number {
  if (!table) {
    table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function bigPdf(pages: number): Buffer {
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(' ')
  const parts = ['%PDF-1.4\n']
  const obj = (n: number, body: string) => parts.push(`${n} 0 obj\n${body}\nendobj\n`)
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Count ${pages} /Kids [${kids}] >>`)
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 0; i < pages; i++) {
    obj(4 + i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>')
  }
  parts.push('trailer\n<< /Root 1 0 R /Size 100 >>\n%%EOF\n')
  return Buffer.from(parts.join(''))
}

export function buildFixtures(): void {
  mkdirSync(DIR, { recursive: true })

  if (!existsSync(FIXTURES.docx)) writeFileSync(FIXTURES.docx, hebrewDocx())
  if (!existsSync(FIXTURES.bigPdf)) writeFileSync(FIXTURES.bigPdf, bigPdf(60))

  if (!existsSync(FIXTURES.doc)) {
    // Only LibreOffice can produce a genuine Word 97 binary. Run it in the same
    // isolated image the app uses.
    execFileSync(
      'docker',
      [
        'run', '--rm', '--network', 'none',
        '--tmpfs', '/scratch:rw', '--tmpfs', '/tmp:rw',
        '-e', 'HOME=/scratch',
        '-v', `${DIR}:/work`,
        '--entrypoint', 'soffice',
        'xtra-sign-converter',
        '--headless', '--norestore', '--nolockcheck',
        '-env:UserInstallation=file:///scratch/p',
        '--convert-to', 'doc', '--outdir', '/work', '/work/hesken.docx',
      ],
      { stdio: 'ignore', timeout: 120_000 },
    )
  }
}
