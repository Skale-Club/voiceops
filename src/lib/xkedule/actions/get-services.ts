// src/lib/xkedule/actions/get-services.ts
// GET /api/v1/catalog/v2 — bookable services (normalized starting price,
// duration, whether the shop must confirm) AND which staff member can perform
// each one, formatted for an AI agent.
//
// Reads v2, not v1, on purpose: v1 returns the staff roster but not their
// abilities, so an agent could see "Jade" and "Skin Fade" in the same list and
// confidently offer Jade for a fade she does not do — the booking then fails in
// front of the customer. v2's `staff[].serviceIds` (empty = unrestricted) is
// what makes "who can do this?" answerable.
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface CatalogV2Service {
  id: number
  name: string
  description?: string | null
  durationMinutes?: number
  pricingType?: string
  priceFrom?: number | null
  requiresConfirmation?: boolean
}

interface CatalogV2Staff {
  id: number
  name: string
  serviceIds: number[]
  unrestricted: boolean
}

interface CatalogV2Response {
  currency?: string
  services: CatalogV2Service[]
  staff: CatalogV2Staff[]
}

export async function getXkeduleServices(
  _params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const data = await xkeduleFetchJson<CatalogV2Response>('/api/v1/catalog/v2', 'GET', null, credentials)

  if (!data.services || data.services.length === 0) {
    return 'No services available.'
  }

  const staff = data.staff ?? []
  const canPerform = (member: CatalogV2Staff, serviceId: number): boolean =>
    member.unrestricted || member.serviceIds.includes(serviceId)

  const summary = data.services
    .map((s) => {
      const price = s.priceFrom != null ? ` | From $${s.priceFrom}` : ''
      const dur = s.durationMinutes ? ` | ${s.durationMinutes}min` : ''
      const confirm = s.requiresConfirmation ? ' | Needs shop confirmation' : ''
      const performers = staff.filter((m) => canPerform(m, s.id)).map((m) => m.name)
      // Only worth stating when it is a real restriction — "everyone" is noise
      // the model would otherwise repeat back to the customer.
      const by =
        performers.length > 0 && performers.length < staff.length
          ? ` | Only: ${performers.join(', ')}`
          : ''
      return `ID: ${s.id} | ${s.name}${price}${dur}${confirm}${by}`
    })
    .join('\n')

  const roster = staff.length
    ? `\nStaff: ${staff.map((m) => `${m.name} (ID ${m.id})`).join(', ')}`
    : ''

  return `Available services:\n${summary}${roster}`
}
