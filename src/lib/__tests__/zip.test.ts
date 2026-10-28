import { describe, expect, it } from 'vitest'
import { crc32, zipStore } from '../zip'

/** Reads a stored ZIP back through its central directory — what an unzip tool does. */
function readBack(zip: Uint8Array): { name: string; bytes: Uint8Array; utf8: boolean }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.byteLength - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const flags = view.getUint16(at + 8, true)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength))
    expect(view.getUint32(local, true)).toBe(0x04034b50)
    const data = local + 30 + view.getUint16(local + 26, true)
    const bytes = zip.subarray(data, data + size)
    expect(crc32(bytes)).toBe(crc)
    out.push({ name, bytes, utf8: (flags & 0x0800) !== 0 })
    at += 46 + nameLength
  }
  return out
}

describe('zipStore', () => {
  it('crc32 is the standard one', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('every file comes back byte for byte, Hebrew names flagged as UTF-8', async () => {
    const files = [
      { name: 'יקב כהנוב.pdf', bytes: new TextEncoder().encode('%PDF-1.7 one') },
      { name: 'צימר ״הגליל״-צפון.pdf', bytes: new Uint8Array([0, 1, 2, 255]) },
      { name: 'empty.pdf', bytes: new Uint8Array() },
    ]
    const zip = new Uint8Array(await zipStore(files, new Date('2026-10-28T10:00:00Z')).arrayBuffer())
    const back = readBack(zip)
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name))
    back.forEach((f, i) => expect([...f.bytes]).toEqual([...files[i].bytes]))
    expect(back.every((f) => f.utf8)).toBe(true)
  })
})
