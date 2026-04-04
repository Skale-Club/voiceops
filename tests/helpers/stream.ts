/**
 * SSE stream reader helper for Vitest tests.
 * Collects all newline-delimited JSON lines from a ReadableStream response body.
 * Returns an array of parsed JSON objects in the order they were emitted.
 *
 * Usage:
 *   const lines = await readSseLines(res)
 *   // lines[0] => { event: 'session', sessionId: '...' }
 *   // lines[1] => { event: 'token', text: '...' }
 *   // lines[N] => { event: 'done' }
 */
export async function readSseLines(res: Response): Promise<Record<string, unknown>[]> {
  const body = res.body
  if (!body) return []

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const lines: Record<string, unknown>[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    // Keep the last part (may be incomplete) in the buffer
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed) {
        try {
          lines.push(JSON.parse(trimmed) as Record<string, unknown>)
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  // Flush any remaining buffer content
  if (buffer.trim()) {
    try {
      lines.push(JSON.parse(buffer.trim()) as Record<string, unknown>)
    } catch {
      // Skip malformed trailing content
    }
  }

  return lines
}
