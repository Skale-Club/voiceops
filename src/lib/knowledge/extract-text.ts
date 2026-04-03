// src/lib/knowledge/extract-text.ts
// Dispatches to the correct extractor based on file MIME type or URL
import * as cheerio from 'cheerio'

export async function extractText(file: File): Promise<string> {
  const mimeType = file.type

  if (mimeType === 'application/pdf') {
    // unpdf wraps Mozilla PDF.js — edge-compatible
    const { extractText: extractPdfText } = await import('unpdf')
    const buffer = await file.arrayBuffer()
    const { text } = await extractPdfText(new Uint8Array(buffer), { mergePages: true })
    return text
  }

  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/csv' ||
    mimeType === 'application/csv' ||
    mimeType === ''
  ) {
    return file.text()
  }

  // Fallback: attempt to read as text
  return file.text()
}

export async function extractTextFromUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'VoiceOps-KnowledgeBot/1.0' }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }
  const html = await response.text()
  const $ = cheerio.load(html)
  // Remove non-content elements
  $('script, style, nav, header, footer, aside, [role="navigation"]').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('No extractable text content found at URL')
  return text
}
