// src/lib/knowledge/embed.ts
// OpenAI text-embedding-3-small wrapper — returns number[1536]
// OPENAI_API_KEY must be set in environment
import OpenAI from 'openai'

// Module-level client — avoids reinstantiation on hot paths
let openaiClient: OpenAI | null = null

function getClient(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

export async function embed(text: string): Promise<number[]> {
  const client = getClient()
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    encoding_format: 'float',
  })
  return response.data[0].embedding // length: 1536
}
