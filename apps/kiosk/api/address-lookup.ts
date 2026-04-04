/**
 * Vercel Serverless Function — UK postcode → full address list
 * Standard Node.js runtime (no 'edge') so Vercel routes to region near user.
 * For UK kiosk users → routes to London (lhr1) → UK IP → getAddress.io accepts.
 */

export const config = { maxDuration: 10 }

const GETADDRESS_KEY = process.env.GETADDRESS_API_KEY || 'kSZi9RxDcUCLhU4A6ShTBg48103'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const raw: string = (req.query?.postcode ?? '').toString().trim()
  if (!raw) return res.status(400).json({ addresses: [], error: 'postcode required' })

  const clean = raw.replace(/\s+/g, '').toLowerCase()

  // ── 1. getAddress.io — full street-level addresses ───────────────────────────
  try {
    const gaRes = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(clean)}?api-key=${GETADDRESS_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (gaRes.ok) {
      const data = await gaRes.json() as { addresses?: string[]; postcode?: string }
      const pc = data.postcode || raw.toUpperCase()
      const addrs = (data.addresses ?? [])
        .map((a: string) =>
          a.split(',').map((p: string) => p.trim()).filter(Boolean).join(', ')
        )
        .filter(Boolean)
      if (addrs.length > 0) {
        return res.json({ addresses: addrs, postcode: pc, source: 'getaddress', count: addrs.length })
      }
    }
  } catch { /* fall through */ }

  // ── 2. postcodes.io fallback (locality only) ─────────────────────────────────
  try {
    const pcRes = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (pcRes.ok) {
      const { result } = await pcRes.json() as { result: Record<string, string> }
      const area   = result.admin_ward || result.parish || result.admin_district || ''
      const county = result.admin_county || result.admin_district || ''
      const pc     = result.postcode
      return res.json({
        addresses: [[area, county, pc].filter(Boolean).join(', ')],
        postcode: pc,
        source: 'postcodes_io',
      })
    }
  } catch { /* fall through */ }

  return res.status(404).json({ addresses: [], error: 'Postcode not found' })
}
