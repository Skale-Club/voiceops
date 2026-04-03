// src/lib/knowledge/chunk-text.ts
// Token-based text chunker using gpt-tokenizer (cl100k — same as text-embedding-3-small)
import { encode, decode } from 'gpt-tokenizer'

export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 50
): string[] {
  if (!text.trim()) return []

  const tokens = encode(text)
  if (tokens.length === 0) return []

  const chunks: string[] = []
  let i = 0
  while (i < tokens.length) {
    const chunk = tokens.slice(i, i + chunkSize)
    const decoded = decode(chunk)
    if (decoded.trim()) {
      chunks.push(decoded)
    }
    i += chunkSize - overlap
  }
  return chunks
}
