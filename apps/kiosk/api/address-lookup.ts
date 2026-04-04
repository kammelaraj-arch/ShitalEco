/**
 * Vercel Edge Function — UK postcode → full address list via getAddress.io
 * Runs on Cloudflare edge (UK PoP) so getAddress.io IP block doesn't apply.
 */

export const config = { runtime: 'edge' }

const GETADDRESS_KEY = 'zp65T_VYUUiIty5baQgr-A48103'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type': 'application/json',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const postcode = (searchParams.get('postcode') ?? '').trim()
  if (!postcode) return json({ error: 'postcode required' }, 400)

  const clean = postcode.replace(/\s+/g, '').toLowerCase()

  try {
    const gaRes = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(clean)}?api-key=${GETADDRESS_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (gaRes.ok) {
      const data = await gaRes.json() as { addresses?: string[]; postcode?: string }
      const addresses = (data.addresses ?? [])
        .map((a: string) => a.split(',').map((p: string) => p.trim()).filter(Boolean).join(', '))
        .filter(Boolean)
      return json({ addresses, postcode: data.postcode || postcode.toUpperCase() })
    }
    const errBody = await gaRes.text().catch(() => '')
    return json({ error: `getAddress.io ${gaRes.status}: ${errBody.slice(0, 100)}` }, gaRes.status)
  } catch (e: unknown) {
    return json({ error: String(e).slice(0, 100) }, 500)
  }
}
