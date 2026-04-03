// Vercel Edge Function — proxies getAddress.io server-side to bypass domain auth
export const config = { runtime: 'edge' }

const API_KEY = 'CkqEZqIrkEOGlQhie_NL8w48103'

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url)
  const postcode = searchParams.get('postcode')

  if (!postcode) {
    return new Response(JSON.stringify({ error: 'postcode required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const res = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(postcode.trim().toUpperCase())}?api-key=${API_KEY}&expand=true`,
      { headers: { Accept: 'application/json' } }
    )
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'lookup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
