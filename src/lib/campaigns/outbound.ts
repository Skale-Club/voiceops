// src/lib/campaigns/outbound.ts
// Vapi outbound call client — used by campaign engine to fire individual POST /call requests.
// Edge-compatible (fetch only, no Node.js APIs).

export interface OutboundCallParams {
  contactId: string       // campaign_contacts.id — roundtripped in webhook metadata
  campaignId: string      // campaigns.id — for correlation logging
  phone: string           // E.164 format: +15551234567
  name: string | null     // customer name (optional)
  assistantId: string     // Vapi assistant UUID
  phoneNumberId: string   // Vapi phone number UUID (required for outbound)
  customData?: Record<string, string>  // passed as variableValues to assistant
}

export interface OutboundCallResult {
  vapiCallId: string
}

export async function createOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult> {
  const { contactId, campaignId, phone, name, assistantId, phoneNumberId, customData } = params

  const vapiApiKey = process.env.VAPI_API_KEY
  if (!vapiApiKey) throw new Error('VAPI_API_KEY environment variable is not set')

  const payload = {
    assistantId,
    phoneNumberId,
    customer: {
      number: phone,
      ...(name ? { name } : {}),
    },
    metadata: {
      campaign_contact_id: contactId,
      campaign_id: campaignId,
    },
    ...(customData && Object.keys(customData).length > 0
      ? { assistantOverrides: { variableValues: customData } }
      : {}),
  }

  const response = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${vapiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error')
    throw new Error(`Vapi POST /call failed (${response.status}): ${errorText}`)
  }

  const data = await response.json() as { id?: string }
  if (!data.id) throw new Error('Vapi POST /call response missing call id')

  return { vapiCallId: data.id }
}
