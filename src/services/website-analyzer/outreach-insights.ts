import type { Json } from '@/types/database'

export type WebsiteInsights = Record<string, string>

export interface WebsiteInsightInput {
  url?: string | null
  services?: string[] | null
  rawEvidence?: Json | Record<string, unknown> | null
}

type Signals = {
  host: string
  isMobileResponsive?: boolean
  hasCTA?: boolean
  hasContactInfo?: boolean
  loadMs?: number
  bookingMode?: string
  bookingProvider?: string
}

function signalsFrom(input: WebsiteInsightInput): Signals {
  const evidence = input.rawEvidence && typeof input.rawEvidence === 'object' && !Array.isArray(input.rawEvidence)
    ? input.rawEvidence as Record<string, unknown>
    : {}
  const rawUrl = input.url || (typeof evidence.resolvedUrl === 'string' ? evidence.resolvedUrl : '')
  let host = ''
  try {
    host = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).hostname
      .toLowerCase()
      .replace(/^www\./, '')
  } catch {
    host = ''
  }
  return {
    host,
    isMobileResponsive: typeof evidence.isMobileResponsive === 'boolean' ? evidence.isMobileResponsive : undefined,
    hasCTA: typeof evidence.hasCTA === 'boolean' ? evidence.hasCTA : undefined,
    hasContactInfo: typeof evidence.hasContactInfo === 'boolean' ? evidence.hasContactInfo : undefined,
    loadMs: typeof evidence.loadMs === 'number' && Number.isFinite(evidence.loadMs) ? evidence.loadMs : undefined,
    bookingMode:
      evidence.booking && typeof evidence.booking === 'object' && !Array.isArray(evidence.booking) &&
      typeof (evidence.booking as Record<string, unknown>).mode === 'string'
        ? (evidence.booking as Record<string, unknown>).mode as string
        : undefined,
    bookingProvider:
      evidence.booking && typeof evidence.booking === 'object' && !Array.isArray(evidence.booking) &&
      typeof (evidence.booking as Record<string, unknown>).primaryProvider === 'string'
        ? (evidence.booking as Record<string, unknown>).primaryProvider as string
        : undefined,
  }
}

function isHost(host: string, domains: string[]): boolean {
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Build factual, low-pressure website observations for cold email.
 *
 * The output is deliberately deterministic: it only describes evidence the
 * analyzer measured, never invents a compliment, and always stays at two short
 * sentences. Internal keys are English/BCP-47 even when rendered copy is not.
 */
export function buildWebsiteInsights(input: WebsiteInsightInput): WebsiteInsights {
  const signals = signalsFrom(input)

  if (signals.bookingMode === 'third_party' && signals.bookingProvider) {
    return {
      en: `I noticed your website sends clients to ${signals.bookingProvider} to schedule. Bringing the branded site and booking flow together could make the journey more consistent.`,
      'pt-BR': `Notei que seu site envia os clientes para ${signals.bookingProvider} para agendar. Unir o site personalizado e o agendamento pode deixar essa jornada mais consistente.`,
      pt: `Notei que o seu site envia os clientes para ${signals.bookingProvider} para marcar. Unir o site personalizado e a marcação pode tornar essa jornada mais consistente.`,
      es: `Noté que el sitio envía a los clientes a ${signals.bookingProvider} para reservar. Unir el sitio personalizado y las reservas podría hacer que la experiencia sea más consistente.`,
    }
  }

  if (isHost(signals.host, ['google.com', 'facebook.com', 'instagram.com', 'yelp.com'])) {
    return {
      en: 'I noticed your business currently relies on a directory or social profile rather than a dedicated website. A simple branded page could make services and booking easier to find.',
      'pt-BR': 'Notei que sua empresa hoje depende de um perfil em diretório ou rede social, em vez de um site próprio. Uma página simples e personalizada pode facilitar a descoberta dos serviços e o agendamento.',
      pt: 'Notei que a sua empresa depende hoje de um perfil num diretório ou rede social, em vez de um site próprio. Uma página simples e personalizada pode facilitar a descoberta dos serviços e a marcação.',
      es: 'Noté que el negocio depende actualmente de un perfil en un directorio o red social, en lugar de un sitio propio. Una página sencilla y personalizada podría facilitar encontrar los servicios y reservar.',
    }
  }

  if (isHost(signals.host, ['booksy.com', 'square.site', 'vagaro.com', 'fresha.com'])) {
    return {
      en: 'I noticed your main web presence runs through a booking platform. A lightweight branded page could strengthen the first impression before clients book.',
      'pt-BR': 'Notei que sua principal presença online funciona por uma plataforma de agendamento. Uma página leve e personalizada pode fortalecer a primeira impressão antes da reserva.',
      pt: 'Notei que a sua principal presença online funciona através de uma plataforma de marcações. Uma página leve e personalizada pode reforçar a primeira impressão antes da marcação.',
      es: 'Noté que la presencia principal del negocio funciona mediante una plataforma de reservas. Una página ligera y personalizada podría mejorar la primera impresión antes de reservar.',
    }
  }

  if (signals.isMobileResponsive === false) {
    return {
      en: 'I noticed the site is not fully optimized for smaller screens. A clearer mobile booking path could help turn more visits into appointments.',
      'pt-BR': 'Notei que o site ainda não está totalmente otimizado para telas menores. Um caminho de agendamento mais claro no celular pode transformar mais visitas em horários marcados.',
      pt: 'Notei que o site ainda não está totalmente otimizado para ecrãs menores. Um percurso de marcação mais claro no telemóvel pode transformar mais visitas em marcações.',
      es: 'Noté que el sitio todavía no está totalmente optimizado para pantallas pequeñas. Un proceso de reserva más claro en móvil podría convertir más visitas en citas.',
    }
  }

  if (signals.hasCTA === false) {
    return {
      en: 'I noticed the site does not make the next booking step immediately clear. A more direct call to action could turn more visits into appointments.',
      'pt-BR': 'Notei que o site não deixa o próximo passo para agendar imediatamente claro. Uma chamada mais direta pode transformar mais visitas em horários marcados.',
      pt: 'Notei que o site não torna imediatamente claro o próximo passo para marcar. Uma chamada mais direta pode transformar mais visitas em marcações.',
      es: 'Noté que el sitio no deja claro de inmediato el siguiente paso para reservar. Una llamada a la acción más directa podría convertir más visitas en citas.',
    }
  }

  if (signals.loadMs !== undefined && signals.loadMs > 4_000) {
    const seconds = Math.min(9.9, signals.loadMs / 1_000).toFixed(1)
    return {
      en: `I noticed the site took about ${seconds} seconds to load during our check. A faster first screen could reduce drop-off before clients reach booking.`,
      'pt-BR': `Notei que o site levou cerca de ${seconds} segundos para carregar em nossa análise. Uma primeira tela mais rápida pode reduzir desistências antes do agendamento.`,
      pt: `Notei que o site demorou cerca de ${seconds} segundos a carregar na nossa análise. Um primeiro ecrã mais rápido pode reduzir desistências antes da marcação.`,
      es: `Noté que el sitio tardó cerca de ${seconds} segundos en cargar durante nuestro análisis. Una primera pantalla más rápida podría reducir abandonos antes de la reserva.`,
    }
  }

  if (signals.hasContactInfo === false) {
    return {
      en: 'I noticed contact details are not easy to spot on the site. Making the booking path visible earlier could help more visitors take the next step.',
      'pt-BR': 'Notei que os dados de contato não aparecem facilmente no site. Mostrar o caminho de agendamento mais cedo pode ajudar mais visitantes a avançar.',
      pt: 'Notei que os dados de contacto não são fáceis de encontrar no site. Mostrar o percurso de marcação mais cedo pode ajudar mais visitantes a avançar.',
      es: 'Noté que los datos de contacto no son fáciles de encontrar en el sitio. Mostrar antes el proceso de reserva podría ayudar a que más visitantes avancen.',
    }
  }

  return {
    en: 'I noticed the site already gives visitors a solid overview of the business. A focused campaign page could make the path from discovery to booking even shorter.',
    'pt-BR': 'Notei que o site já oferece uma boa visão geral da empresa. Uma página focada na campanha pode encurtar ainda mais o caminho entre descoberta e agendamento.',
    pt: 'Notei que o site já oferece uma boa visão geral da empresa. Uma página focada na campanha pode encurtar ainda mais o percurso entre descoberta e marcação.',
    es: 'Noté que el sitio ya ofrece una buena visión general del negocio. Una página enfocada en la campaña podría acortar aún más el camino entre descubrimiento y reserva.',
  }
}

export function hasWebsiteInsights(value: unknown): value is WebsiteInsights {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).some(item => typeof item === 'string' && item.trim()))
}
