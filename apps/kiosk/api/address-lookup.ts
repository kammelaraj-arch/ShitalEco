// Vercel Edge Function — validates UK postcode via postcodes.io (free, no API key)
// Returns suggested address lines based on postcode area data
export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url)
  const postcode = searchParams.get('postcode')

  if (!postcode) {
    return new Response(JSON.stringify({ error: 'postcode required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const clean = postcode.trim().toUpperCase().replace(/\s+/g, '')

  try {
    // 1. Validate postcode + get area info via postcodes.io (free, no key)
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`)

    if (!res.ok) {
      // Invalid postcode — return empty so UI falls back to manual entry
      return new Response(JSON.stringify({ addresses: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { result } = await res.json()

    // Format postcode with space for display (e.g. HA9 0EW)
    const formatted = result.postcode // already formatted by postcodes.io

    // Build placeholder address lines from postcode area data
    const area = result.admin_ward || result.admin_district || result.parliamentary_constituency || ''
    const city = result.admin_district || result.nuts || ''
    const county = result.admin_county || ''

    // Return a prompt to enter house number manually, with area pre-filled
    const suggestions: string[] = [
      `[Enter house/flat number], ${area ? area + ', ' : ''}${city}${county ? ', ' + county : ''}, ${formatted}`,
    ]

    return new Response(JSON.stringify({ addresses: suggestions, postcode: formatted, area, city, county, valid: true }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
    })
  } catch {
    return new Response(JSON.stringify({ addresses: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}