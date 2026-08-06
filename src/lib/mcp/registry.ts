// Central tool registry | all McpToolDef arrays are concatenated here and
// the main /api/mcp endpoint pulls from this single list.

import type { McpToolDef } from './tool-types'
import { projectsTools } from './tools/projects'
import { analyticsTools } from './tools/analytics'
import { contactsTools } from './tools/contacts'
import { opportunitiesTools } from './tools/opportunities'
import { conversationsTools } from './tools/conversations'
import { tasksTools } from './tools/tasks'
// Phase 109 — P0 coverage
import { accountsTools } from './tools/accounts'
import { tagsTools } from './tools/tags'
import { pipelinesTools } from './tools/pipelines'
import { customFieldsTools } from './tools/custom-fields'
import { aiCallsTools } from './tools/ai-calls'
import { callsTools } from './tools/calls'
import { conversationLabelsTools } from './tools/conversation-labels'
import { eventTypesTools } from './tools/event-types'
import { notesTools } from './tools/notes'
import { notificationsTools } from './tools/notifications'
import { knowledgeTools } from './tools/knowledge'
import { workflowsTools } from './tools/workflows'
import { agentsTools } from './tools/agents'
import { bookingsTools } from './tools/bookings'
import { adsTools } from './tools/ads'
import { organizationsTools } from './tools/organizations'
import { prospectsTools } from './tools/prospects'
import { prospectSendMessageTools } from './tools/prospect-send-message'
import { emailVerificationTools } from './tools/email-verification'

export const ALL_MCP_TOOLS: McpToolDef[] = [
  ...projectsTools,
  ...analyticsTools,
  ...contactsTools,
  ...opportunitiesTools,
  ...conversationsTools,
  ...tasksTools,
  ...accountsTools,
  ...tagsTools,
  ...pipelinesTools,
  ...customFieldsTools,
  ...aiCallsTools,
  ...callsTools,
  ...conversationLabelsTools,
  ...eventTypesTools,
  ...notesTools,
  ...notificationsTools,
  ...knowledgeTools,
  ...workflowsTools,
  ...agentsTools,
  ...bookingsTools,
  ...adsTools,
  ...organizationsTools,
  ...prospectsTools,
  ...prospectSendMessageTools,
  ...emailVerificationTools,
]

const TOOLS_BY_NAME = new Map(ALL_MCP_TOOLS.map((t) => [t.name, t]))

export function findTool(name: string): McpToolDef | undefined {
  return TOOLS_BY_NAME.get(name)
}
