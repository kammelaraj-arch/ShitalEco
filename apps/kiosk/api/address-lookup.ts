/**
 * Vercel Serverless Function — UK postcode → address list via getAddress.io
 */

export const config = { maxDuration: 10 }

const GETADDRESS_KEY = process.env.GETADDRESS_API_KEY || 'kSZi9RxDcUCLhU4A6ShTBg48103'
const GETADDRESS_DTOKEN = 'dtoken_hEDzcyiWMr1qCTSk0cxR1UiFKYfoDY3s3jc_aRAgJJVRVewqW--9F41eyhADhPZyqh-3OOe5ZYGHNFnjs4KY_iVR5xK-A2gNuc0ZtCh7-SsYFN8AOt_vA0vsvz8x4TIJyq2f8fAByc6oAs5CE3Sp6vsCjrSOJT7FQoFJmCVQZ_I8uG3viS1QgAAqS9-N2Maf10ujT9HiQxfrUXm_iqXInw'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const raw: string = (req.query?.postcode ?? '').toString().trim()
  if (!raw) return res.status(400).json({ addresses: [], error: 'postcode required' })

  const clean = raw.replace(/\s+/g, '').toLowerCase()
  const debug: string[] = []

  // ── Try with main API key ─────────────────────────────────────────────────
  for (const [label, key] of [['api_key', GETADDRESS_KEY], ['dtoken', GETADDRESS_DTOKEN]]) {
    try {
      const gaRes = await fetch(
        `https://api.getaddress.io/find/${encodeURIComponent(clean)}?api-key=${key}`,
        { signal: AbortSignal.timeout(6000) }
      )
      debug.push(`${label}:${gaRes.status}`)
      if (gaRes.ok) {
        const data = await gaRes.json() as { addresses?: string[]; postcode?: string }
        const pc = data.postcode || raw.toUpperCase()
        const addrs = (data.addresses ?? [])
          .map((a: string) => a.split(',').map((p: string) => p.trim()).filter(Boolean).join(', '))
          .filter(Boolean)
        if (addrs.length > 0) {
          return res.json({ addresses: addrs, postcode: pc, source: label, count: addrs.length, debug })
        }
      }
    } catch (e: unknown) {
      debug.push(`${label}:error:${String(e).slice(0, 40)}`)
    }
  }

  // ── postcodes.io fallback ─────────────────────────────────────────────────
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
        debug,
      })
    }
  } catch { /* fall through */ }

  return res.status(404).json({ addresses: [], error: 'Postcode not found', debug })
}
