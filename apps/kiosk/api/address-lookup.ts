/**
 * Vercel Edge Function — UK postcode → full address list
 * Runs on Vercel's UK edge so getAddress.io accepts the request.
 * Falls back to postcodes.io if getAddress.io is unavailable.
 */
export const config = { runtime: 'edge' }

const GETADDRESS_KEY = process.env.GETADDRESS_API_KEY || ''

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url)
  const postcode = (searchParams.get('postcode') || '').trim().toUpperCase()
  if (!postcode) {
    return json({ addresses: [], error: 'postcode required' }, 400)
  }

  // Format for getAddress.io: lowercase, no spaces (e.g. "hp79nq")
  const clean = postcode.replace(/\s/g, '').toLowerCase()

  // ── 1. getAddress.io ────────────────────────────────────────────────────────
  if (GETADDRESS_KEY) {
    try {
      const res = await fetch(
        `https://api.getaddress.io/find/${clean}?api-key=${GETADDRESS_KEY}`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (res.ok) {
        const data = await res.json() as { addresses?: string[] }
        const pc = postcode.replace(/^(\w+)(\d\w+)$/, '$1 $2').toUpperCase() // ensure space
        const addrs = (data.addresses ?? [])
          .map((a: string) => {
            const parts = a.split(',').map(p => p.trim()).filter(Boolean)
            // append formatted postcode if not already present
            if (!parts[parts.length - 1]?.toUpperCase().includes(clean.slice(0, 4).toUpperCase())) {
              parts.push(pc)
            }
            return parts.join(', ')
          })
          .filter(Boolean)
        if (addrs.length) {
          return json({ addresses: addrs, postcode: pc, source: 'getaddress' })
        }
      }
    } catch { /* fall through */ }
  }

  // ── 2. postcodes.io fallback ────────────────────────────────────────────────
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (res.ok) {
      const { result } = await res.json() as { result: Record<string, string> }
      const ward    = result.admin_ward    || ''
      const county  = result.admin_county  || result.admin_district || ''
      const pc      = result.postcode
      const area    = [ward, county].filter(Boolean).join(', ')
      return json({
        addresses: [`${area}, ${pc}`],
        postcode: pc,
        source: 'postcodes_io',
        note: 'Full addresses unavailable — enter your house number manually',
      })
    }
  } catch { /* fall through */ }

  return json({ addresses: [], error: 'Postcode not found' })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
  })
}
