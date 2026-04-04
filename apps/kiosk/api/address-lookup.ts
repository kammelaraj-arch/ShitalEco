/**
 * Vercel Serverless Function — UK postcode → full address list via getAddress.io
 */

export const config = { maxDuration: 10 }

const GETADDRESS_KEY = process.env.GETADDRESS_API_KEY || 'zp65T_VYUUiIty5baQgr-A48103'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const raw: string = (req.query?.postcode ?? '').toString().trim()
  if (!raw) return res.status(400).json({ error: 'postcode required' })

  const clean = raw.replace(/\s+/g, '').toLowerCase()

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
      return res.json({ addresses, postcode: data.postcode || raw.toUpperCase() })
    }
    const errBody = await gaRes.text().catch(() => '')
    return res.status(gaRes.status).json({ error: `getAddress.io: ${gaRes.status} ${errBody.slice(0, 100)}` })
  } catch (e: unknown) {
    return res.status(500).json({ error: String(e).slice(0, 100) })
  }
}
