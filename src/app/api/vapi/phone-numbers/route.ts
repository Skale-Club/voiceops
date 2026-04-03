// GET /api/vapi/phone-numbers
// Proxies Vapi GET /phone-number to list available outbound phone numbers.
// Used by the create campaign form dropdown.

export const runtime = 'edge'

export async function GET(): Promise<Response> {
  const vapiApiKey = process.env.VAPI_API_KEY
  if (!vapiApiKey) {
    return Response.json({ error: 'VAPI_API_KEY not configured' }, { status: 500 })
  }

  try {
    const response = await fetch('https://api.vapi.ai/phone-number', {
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return Response.json(
        { error: 'Failed to fetch phone numbers from Vapi' },
        { status: response.status }
      )
    }

    const data = await response.json()
    return Response.json(data)
  } catch (err) {
    console.error('[vapi/phone-numbers] Error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
