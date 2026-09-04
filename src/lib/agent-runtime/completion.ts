export type AgentFinalStatus = 'success' | 'error' | 'aborted' | 'skipped'

/**
 * Normalize provider completion into the channel contract. Some providers end
 * a stream cleanly when AbortSignal fires or when stepCountIs stops on a
 * tool-only step. Neither case may become a successful empty reply.
 */
export function finalizeAssistantCompletion(params: {
  text: string
  status: AgentFinalStatus
  errorDetail?: string
  signalAborted: boolean
  fallbackMessage: string
}): {
  text: string
  status: AgentFinalStatus
  errorDetail: string | undefined
  usedFallback: boolean
} {
  const hasReply = params.text.trim().length > 0
  if (params.signalAborted) {
    return {
      text: hasReply ? params.text : params.fallbackMessage,
      status: 'aborted',
      errorDetail: 'turn_timeout',
      usedFallback: !hasReply,
    }
  }
  if (hasReply) {
    return {
      text: params.text,
      status: params.status,
      errorDetail: params.errorDetail,
      usedFallback: false,
    }
  }
  return {
    text: params.fallbackMessage,
    status: params.status === 'success' ? 'error' : params.status,
    errorDetail: params.errorDetail ?? 'empty_assistant_reply',
    usedFallback: true,
  }
}
