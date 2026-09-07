import { shareImageOf } from '@/server/projects/share'

/**
 * The campaign's uploaded share picture, public by design: this is what a
 * chat app or a crawler fetches for the link preview. Only the picture a
 * campaign chose to publish is reachable here; nothing else is served.
 */
export async function GET(_request: Request, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return new Response(null, { status: 404 })
  const image = await shareImageOf(groupId)
  if (!image) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(image.bytes), {
    headers: { 'Content-Type': image.type, 'Cache-Control': 'public, max-age=300, s-maxage=3600', 'Content-Length': String(image.bytes.length) },
  })
}
