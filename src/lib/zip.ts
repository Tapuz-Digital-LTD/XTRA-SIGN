/**
 * A ZIP of files stored as they are, built in the browser.
 *
 * PDFs are already compressed, so "store" (no deflate) costs almost nothing in
 * size and needs no library. File names are UTF-8 and say so (bit 11), which
 * Finder, Windows and every current unzip honour for Hebrew names.
 *
 * ponytail: no ZIP64 — a ZIP stops at 4 GB and 65,535 files; a campaign's
 * signed agreements are a few hundred files of a few hundred KB.
 */

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zipStore(files: { name: string; bytes: Uint8Array }[], at = new Date()): Blob {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1)
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
  const parts: BlobPart[] = []
  const central: BlobPart[] = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const crc = crc32(file.bytes)
    const size = file.bytes.length
    // The fields both headers share, from "version needed" to the name's length.
    const common = (view: DataView, at: number) => {
      view.setUint16(at, 20, true)
      view.setUint16(at + 2, 0x0800, true)
      view.setUint16(at + 4, 0, true)
      view.setUint16(at + 6, time, true)
      view.setUint16(at + 8, date, true)
      view.setUint32(at + 10, crc, true)
      view.setUint32(at + 14, size, true)
      view.setUint32(at + 18, size, true)
      view.setUint16(at + 22, name.length, true)
    }
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    common(local, 4)
    parts.push(local.buffer, name, file.bytes as BlobPart)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    common(entry, 6)
    entry.setUint32(42, offset, true)
    central.push(entry.buffer, name)
    offset += 30 + name.length + size
  }
  const centralSize = central.reduce<number>((sum, part) => sum + (part as ArrayBuffer | Uint8Array).byteLength, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}
