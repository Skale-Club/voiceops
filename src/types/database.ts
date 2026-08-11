// Database type definitions for Opps
// Auto-generated shape | replace with Supabase CLI output after applying migrations:
//   npx supabase gen types typescript --local > src/types/database.ts
//
// These types match the schema defined in supabase/migrations/001_foundation.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Org roles. 'owner' tops an org; 'member' is the basic "User" tier.
// (migration 1116 — RBAC foundation)
export type UserRole = 'owner' | 'admin' | 'member'

// Platform (Skale Club / super admin) roles — sit above every org (migration 1116)
export type PlatformRole = 'platform_admin' | 'platform_member'

// Roles whose permission sets are configurable in the Roles & Permissions panel
export type ConfigurableRole = Extract<UserRole, 'admin' | 'member'>

export interface PlatformAdminRow {
  user_id: string
  role: PlatformRole
  created_at: string
}

export interface RolePermissionRow {
  id: string
  organization_id: string
  role: ConfigurableRole
  permission_key: string
  enabled: boolean
  updated_at: string
}

export interface RoleSettingsRow {
  id: string
  organization_id: string
  role: ConfigurableRole
  restrict_to_assigned: boolean
  updated_at: string
}

// Template Organizations (migration 1108)
export type OrgTemplateStatus = 'draft' | 'active' | 'archived'

// Stripe billing foundation (migration 1109) | mirrors Stripe subscription statuses
export type BillingSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'

// Resend email system (migrations 1075–1078)
export type EmailDeliveryStatus = 'delivered' | 'bounced' | 'complained' | 'failed'
export type TenantEmailIntegrationStatus = 'connected' | 'disconnected' | 'error'

export interface PlatformEmailSettingsRow {
  id: string
  api_key_encrypted: string | null
  default_from_name: string | null
  default_from_email: string | null
  default_reply_to: string | null
  provider: string
  is_active: boolean
  last_tested_at: string | null
  created_at: string
  updated_at: string
}

// Platform tracking config (migration 1240): GTM + Facebook Pixel, super admin only
export interface PlatformTrackingConfigRow {
  id: string
  gtm_container_id: string | null
  facebook_pixel_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TenantEmailIntegrationRow {
  id: string
  org_id: string
  api_key_encrypted: string | null
  key_hint: string | null
  default_from_name: string | null
  default_from_email: string | null
  default_reply_to: string | null
  provider: string
  status: TenantEmailIntegrationStatus
  last_tested_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

// migration 1248: per-org HTML email signature library
export interface EmailSignatureRow {
  id: string
  org_id: string
  name: string
  document: Record<string, unknown>
  html_snapshot: string | null
  plain_text_snapshot: string | null
  is_default: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface InboundEmailRouteRow {
  id: string
  org_id: string
  route_address: string
  is_active: boolean
  created_at: string
}

export type NotificationType = 'new_conversation' | 'missed_call' | 'flow_failed' | 'new_message' | 'incoming_call'

export type CampaignStatus = 'draft' | 'scheduled' | 'in_progress' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
export type CampaignContactStatus = 'pending' | 'calling' | 'completed' | 'failed' | 'no_answer'
// migration 1090: multi-channel campaigns
export type CampaignChannel = 'calls' | 'sms' | 'email' | 'whatsapp'
export type CampaignType = 'one_time' | 'flow'
export type CampaignRecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'unsubscribed'

export type ConversationChannel =
  | 'widget'
  | 'messenger'
  | 'instagram'
  | 'sms'
  | 'voice'
  | 'whatsapp'
  | 'telegram'
  | 'manual'
  | 'ghl_sms'
  | 'ghl_whatsapp'
export type MetaChannelType = 'messenger' | 'instagram'

// v2.0 (Phase 33) | agent runtime enums
export type AgentChannel = 'web_widget' | 'whatsapp' | 'messenger' | 'instagram' | 'manychat' | 'telegram' | 'sms' | 'zernio' | 'workflow'
export type AgentInvocationStatus = 'success' | 'error' | 'aborted' | 'skipped' | 'denied' | 'running'
export type AgentInvocationMode = 'production' | 'playground'

// v2.1 | contacts (CRM) source enum
export type ContactSource = 'manual' | 'whatsapp' | 'sms' | 'instagram' | 'facebook' | 'messenger' | 'csv_import' | 'ghl_sync' | 'api' | 'voice_call'
export type ContactIdentityStatus =
  | 'channel_only'
  | 'identified'
  | 'verified'
  | 'merge_conflict'
  | 'archived_duplicate'

export type CrmLifecycleStage = 'prospect' | 'lead' | 'opportunity' | 'customer' | 'lost' | 'archived'
export type CrmEngagementStatus =
  | 'not_contacted'
  | 'contacted'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'engaged'
  | 'interested'
  | 'needs_follow_up'
  | 'not_interested'
  | 'unsubscribed'
export type CrmIntentLevel = 'none' | 'low' | 'medium' | 'high'
export type CrmQualificationStatus = 'unqualified' | 'needs_review' | 'qualified'
// Email verification (migration 1264) — contacts.email_status / accounts.email_status.
// Mirrors src/lib/email-verification/types.ts's EmailStatus; kept as a self-contained
// union here (rather than importing) to match this file's existing enum convention.
export type EmailStatus = 'ok' | 'catch_all' | 'unknown' | 'disposable' | 'invalid' | 'bounced'
export type EmailRisk = 'low' | 'medium' | 'high'
// Prospects full system (migration 1158) — recommended outreach channel for a record
export type CrmRecommendedChannel = 'email' | 'sms' | 'whatsapp' | 'call' | 'visit' | 'linkedin'
// Engagement timeline event types (migration 1158 — prospect_engagement_events)
export type ProspectEventType =
  | 'imported'
  | 'contacted'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'unsubscribed'
  | 'visit'
  | 'note'
  | 'status_changed'
  | 'converted'
// Import source / run status (migration 1158 — prospect_sources)
export type ProspectSourceStatus = 'pending' | 'running' | 'completed' | 'failed'
// Polymorphic prospect record kind (migration 1158 — conversions + engagement events)
export type ProspectEntityType = 'contact' | 'account'

// v3.0 Phase 108 — channel identity providers (CID-09 D-01 wide enum)
export type ChannelProvider =
  | 'whatsapp'
  | 'evolution'
  | 'telegram'
  | 'instagram'
  | 'messenger'
  | 'facebook'
  | 'webchat'
  | 'vapi'
  | 'zernio'

// v2.4 � accounts (CRM Companies) source enum (SEED-016)
export type AccountSource = 'manual' | 'auto_from_contact_company' | 'csv_import' | 'ghl_sync'

// v2.4 � custom_field_definitions (Custom Fields System) � SEED-017
export type CustomFieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'email'
  | 'phone'
  | 'currency'

export type CustomFieldEntity = 'contact' | 'opportunity' | 'account'

// v2.5 — tasks & notes (v2.5 Tasks & Notes CRM System)
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type CrmEntityType = 'contact' | 'account' | 'opportunity'

// Projects Module (migration 1040)
export type ProjectTaskStep = 'backlog' | 'todo' | 'doing' | 'done'
export type ProjectDependencyRule = 'after_done' | 'after_delivered' | 'after_approved'
export type ProjectValidationStatus = 'not_required' | 'needs_review' | 'approved' | 'changes_requested' | 'rejected'
export type ProjectExecutionStatus = 'not_started' | 'in_progress' | 'delivered' | 'failed' | 'cancelled'
export type ProjectRunStatus = 'running' | 'paused' | 'delivered' | 'failed' | 'cancelled'
export type ProjectExecutorType = 'human' | 'ai' | 'system' | 'automation'
export type ProjectRunEnvironment = 'manual' | 'gsd' | 'claude_code' | 'codex' | 'ide' | 'other'
export type ProjectViewType = 'board' | 'list' | 'calendar' | 'timeline'
export type ProjectViewScope = 'personal' | 'project'
export type ProjectMcpArea = 'general_xphere' | 'projects'
export type ProjectActorType = 'human' | 'ai_agent' | 'system'
export type ProjectAuditStatus = 'success' | 'failed' | 'blocked'

export interface ProjectRow {
  id: string
  org_id: string
  name: string
  description: string | null
  color: string | null
  account_id: string | null
  source_opportunity_id: string | null
  primary_contact_id: string | null
  space_id: string | null
  position: number
  archived_at: string | null
  deleted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectSpaceRow {
  id: string
  org_id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Agent groups (folders) — `agent_groups` table (migration 1160). Not in the
 *  generated Database type; the groups server actions cast via `db(): any`. */
export interface AgentGroupRow {
  id: string
  org_id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMemberRow {
  id: string
  org_id: string
  project_id: string
  user_id: string
  role: string | null
  is_owner: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectContactRow {
  id: string
  org_id: string
  project_id: string
  contact_id: string
  role: string | null
  is_primary: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectTaskRow {
  id: string
  org_id: string
  project_id: string
  parent_task_id: string | null
  name: string
  description: string | null
  step: ProjectTaskStep
  responsible_id: string | null
  assignee_id: string | null
  priority: TaskPriority
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  deliverable: string | null
  completed: boolean
  completed_at: string | null
  ai_context: string | null
  expected_deliverable: string | null
  validation_criteria: string | null
  ai_view_enabled: boolean
  needs_validation: boolean
  execution_status: ProjectExecutionStatus
  validation_status: ProjectValidationStatus
  last_agent_update: string | null
  last_human_review: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  deleted_at: string | null
}

export interface ProjectLabelRow {
  id: string
  org_id: string
  project_id: string
  name: string
  color: string
  created_at: string
}

export interface ProjectTaskCommentRow {
  id: string
  org_id: string
  task_id: string
  author: string
  author_type: ProjectActorType
  content: string
  created_at: string
}

export interface ProjectSavedViewRow {
  id: string
  org_id: string
  project_id: string
  owner_id: string | null
  name: string
  view_type: ProjectViewType
  scope: ProjectViewScope
  filters: Record<string, unknown>
  sorting: Record<string, unknown>
  is_default: boolean
  created_at: string
  updated_at: string
}

// pipeline_saved_views (migration 1203) — personal filter views for Pipeline module
export interface PipelineSavedViewRow {
  id: string
  org_id: string
  pipeline_id: string | null
  owner_id: string | null
  name: string
  filters: Record<string, unknown>
  sorting: Record<string, unknown>
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface ProjectExecutionRunRow {
  id: string
  org_id: string
  task_id: string
  executor_name: string | null
  executor_type: ProjectExecutorType
  environment: ProjectRunEnvironment
  start_time: string | null
  end_time: string | null
  duration_minutes: number | null
  status: ProjectRunStatus
  needs_validation: boolean
  result: string | null
  notes: string | null
  created_at: string
}

// v2.4 � contact_imports (Import Pipeline) � SEED-018
export type ContactImportStatus =
  | 'uploading'
  | 'parsing'
  | 'previewing'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type ContactImportDedupStrategy =
  | 'skip_existing'
  | 'update_existing'
  | 'create_duplicate'

// v2.1 | call system (SEED-007)
export type CallRoutingMode = 'phone_forward' | 'sip' | 'browser'
export type CallDirection = 'inbound' | 'outbound'

// v2.x | call routing chains (simultaneous-ring + ordered fallback)
// 'team' rings every org member everywhere they answer (softphone/PWA + their
// configured forward number); it needs neither user_id nor number.
// v3.5 | 'member' rings ONE member everywhere they answer; 'destination'
// references a call_destinations row (personal or shared). Legacy raw types
// (browser/pwa/cell/sip/forward) keep resolving for back-compat.
export type CallRoutingTargetType =
  | 'browser'
  | 'pwa'
  | 'cell'
  | 'sip'
  | 'forward'
  | 'team'
  | 'member'
  | 'destination'

export interface CallRoutingTarget {
  type: CallRoutingTargetType
  /** Resolves a Voice SDK client identity / SIP username for browser|pwa|sip|member. */
  user_id?: string
  /** Explicit E.164 number for cell|forward (legacy raw targets). */
  number?: string
  /** call_destinations row for type='destination'. */
  destination_id?: string
}

// v3.5 | call destinations registry (phase 3)
export type CallDestinationKind = 'personal' | 'shared'

export interface CallRoutingStage {
  enabled: boolean
  timeout_seconds: number
  targets: CallRoutingTarget[]
}

// v2.1 - sales pipeline (SEED-008)
export type OpportunityStatus = 'open' | 'won' | 'lost'
export type OpportunityActivityType =
  | 'note'
  | 'call'
  | 'whatsapp'
  | 'sms'
  | 'instagram'
  | 'stage_change'
  | 'email'
  | 'created'
  | 'won'
  | 'lost'

export interface Database {
  public: {
    Tables: {
      api_keys: {
        Row: {
          id: string
          org_id: string
          name: string
          key_hash: string
          key_prefix: string
          scopes: string[]
          created_by: string | null
          last_used_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          key_hash: string
          key_prefix: string
          scopes?: string[]
          created_by?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          key_hash?: string
          key_prefix?: string
          scopes?: string[]
          created_by?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      lead_ingestions: {
        Row: {
          id: string
          org_id: string
          source_product: string
          source_tenant_ref: string
          external_event_id: string
          schema_version: string
          contact_id: string
          occurred_at: string
          received_at: string
          payload: Json
          payload_hash: string
          workflow_dispatch_id: string | null
        }
        Insert: {
          id?: string
          org_id: string
          source_product: string
          source_tenant_ref: string
          external_event_id: string
          schema_version: string
          contact_id: string
          occurred_at: string
          received_at?: string
          payload: Json
          payload_hash: string
          workflow_dispatch_id?: string | null
        }
        Update: {
          workflow_dispatch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'lead_ingestions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lead_ingestions_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          is_active: boolean
          widget_token: string
          widget_display_name: string | null
          widget_avatar_url: string | null
          widget_primary_color: string | null
          widget_welcome_message: string | null
          widget_greeting_enabled: boolean
          widget_greeting_message: string | null
          widget_greeting_delay_seconds: number
          widget_url_mode: string
          widget_url_rules: string[]
          widget_position: string
          widget_offset_x: number
          widget_offset_y: number
          daily_cost_cap_usd_override: number | null
          daily_cost_cap_enabled: boolean
          delegation_visibility: string
          logo_url: string | null
          accent_color: string | null
          brand_name: string | null
          default_currency: string
          /** Migration 1105: company control panel fields */
          legal_name: string | null
          tax_id: string | null
          address_line1: string | null
          address_line2: string | null
          address_city: string | null
          address_state: string | null
          address_postal_code: string | null
          address_country: string | null
          timezone: string
          settings: Json
          trial_ends_at: string | null
          plan_override: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          is_active?: boolean
          widget_token?: string
          widget_display_name?: string | null
          widget_avatar_url?: string | null
          widget_primary_color?: string | null
          widget_welcome_message?: string | null
          widget_greeting_enabled?: boolean
          widget_greeting_message?: string | null
          widget_greeting_delay_seconds?: number
          widget_url_mode?: string
          widget_url_rules?: string[]
          widget_position?: string
          widget_offset_x?: number
          widget_offset_y?: number
          daily_cost_cap_usd_override?: number | null
          daily_cost_cap_enabled?: boolean
          delegation_visibility?: string
          logo_url?: string | null
          accent_color?: string | null
          brand_name?: string | null
          default_currency?: string
          legal_name?: string | null
          tax_id?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_city?: string | null
          address_state?: string | null
          address_postal_code?: string | null
          address_country?: string | null
          timezone?: string
          settings?: Json
          trial_ends_at?: string | null
          plan_override?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          is_active?: boolean
          widget_token?: string
          widget_display_name?: string | null
          widget_avatar_url?: string | null
          widget_primary_color?: string | null
          widget_welcome_message?: string | null
          widget_greeting_enabled?: boolean
          widget_greeting_message?: string | null
          widget_greeting_delay_seconds?: number
          widget_url_mode?: string
          widget_url_rules?: string[]
          widget_position?: string
          widget_offset_x?: number
          widget_offset_y?: number
          daily_cost_cap_usd_override?: number | null
          daily_cost_cap_enabled?: boolean
          delegation_visibility?: string
          logo_url?: string | null
          accent_color?: string | null
          brand_name?: string | null
          default_currency?: string
          legal_name?: string | null
          tax_id?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_city?: string | null
          address_state?: string | null
          address_postal_code?: string | null
          address_country?: string | null
          timezone?: string
          settings?: Json
          trial_ends_at?: string | null
          plan_override?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribes: {
        Row: {
          id: string
          org_id: string
          email: string
          contact_id: string | null
          unsubscribed_at: string
          source: string
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          contact_id?: string | null
          unsubscribed_at?: string
          source?: string
        }
        Update: {
          email?: string
          contact_id?: string | null
          source?: string
        }
        Relationships: []
      }
      copilot_credit_balances: {
        Row: {
          org_id: string
          included_balance_usd: number
          topup_balance_usd: number
          included_allowance_usd: number
          period_end: string | null
          updated_at: string
        }
        Insert: {
          org_id: string
          included_balance_usd?: number
          topup_balance_usd?: number
          included_allowance_usd?: number
          period_end?: string | null
          updated_at?: string
        }
        Update: {
          org_id?: string
          included_balance_usd?: number
          topup_balance_usd?: number
          included_allowance_usd?: number
          period_end?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      copilot_credit_ledger: {
        Row: {
          id: string
          org_id: string
          kind: string
          amount_usd: number
          balance_after: number
          copilot_run_id: string | null
          stripe_ref: string | null
          note: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          kind: string
          amount_usd: number
          balance_after: number
          copilot_run_id?: string | null
          stripe_ref?: string | null
          note?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          kind?: string
          amount_usd?: number
          balance_after?: number
          copilot_run_id?: string | null
          stripe_ref?: string | null
          note?: string | null
          reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      billing_customers: {
        Row: {
          id: string
          org_id: string
          stripe_customer_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          stripe_customer_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          stripe_customer_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_subscriptions: {
        Row: {
          id: string
          org_id: string
          stripe_subscription_id: string
          stripe_customer_id: string
          stripe_price_id: string | null
          status: BillingSubscriptionStatus
          cancel_at_period_end: boolean
          current_period_start: string | null
          current_period_end: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          stripe_subscription_id: string
          stripe_customer_id: string
          stripe_price_id?: string | null
          status?: BillingSubscriptionStatus
          cancel_at_period_end?: boolean
          current_period_start?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          stripe_price_id?: string | null
          status?: BillingSubscriptionStatus
          cancel_at_period_end?: boolean
          current_period_start?: string | null
          current_period_end?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          id: string
          stripe_event_id: string
          type: string
          received_at: string
          processed_at: string | null
        }
        Insert: {
          id?: string
          stripe_event_id: string
          type: string
          received_at?: string
          processed_at?: string | null
        }
        Update: {
          processed_at?: string | null
        }
        Relationships: []
      }
      org_templates: {
        Row: {
          id: string
          owner_org_id: string
          source_org_id: string | null
          name: string
          industry: string | null
          description: string | null
          status: OrgTemplateStatus
          asset_groups: string[]
          snapshot: Json
          snapshot_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_org_id: string
          source_org_id?: string | null
          name: string
          industry?: string | null
          description?: string | null
          status?: OrgTemplateStatus
          asset_groups?: string[]
          snapshot?: Json
          snapshot_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          industry?: string | null
          description?: string | null
          status?: OrgTemplateStatus
          asset_groups?: string[]
          snapshot?: Json
          snapshot_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      org_template_installs: {
        Row: {
          id: string
          owner_org_id: string
          template_id: string | null
          template_name: string | null
          target_org_id: string | null
          target_org_name: string | null
          asset_groups: string[]
          summary: Json
          installed_by: string | null
          installed_at: string
        }
        Insert: {
          id?: string
          owner_org_id: string
          template_id?: string | null
          template_name?: string | null
          target_org_id?: string | null
          target_org_name?: string | null
          asset_groups?: string[]
          summary?: Json
          installed_by?: string | null
          installed_at?: string
        }
        Update: {
          template_name?: string | null
          target_org_id?: string | null
          target_org_name?: string | null
          summary?: Json
        }
        Relationships: []
      }
      org_custom_roles: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'org_custom_roles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      custom_role_permissions: {
        Row: {
          id: string
          custom_role_id: string
          permission_key: string
          enabled: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          custom_role_id: string
          permission_key: string
          enabled?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'custom_role_permissions_custom_role_id_fkey'
            columns: ['custom_role_id']
            isOneToOne: false
            referencedRelation: 'org_custom_roles'
            referencedColumns: ['id']
          }
        ]
      }
      org_members: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          role: UserRole
          custom_role_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          role?: UserRole
          custom_role_id?: string | null
          created_at?: string
        }
        Update: {
          role?: UserRole
          custom_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'org_members_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      platform_admins: {
        Row: { user_id: string; role: PlatformRole; created_at: string }
        Insert: { user_id: string; role?: PlatformRole; created_at?: string }
        Update: { user_id?: string; role?: PlatformRole; created_at?: string }
        Relationships: []
      }
      role_permissions: {
        Row: {
          id: string
          organization_id: string
          role: ConfigurableRole
          permission_key: string
          enabled: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          role: ConfigurableRole
          permission_key: string
          enabled?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          role?: ConfigurableRole
          permission_key?: string
          enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      role_settings: {
        Row: {
          id: string
          organization_id: string
          role: ConfigurableRole
          restrict_to_assigned: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          role: ConfigurableRole
          restrict_to_assigned?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          role?: ConfigurableRole
          restrict_to_assigned?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      org_invites: {
        Row: {
          id: string
          org_id: string
          email: string
          role: UserRole
          custom_role_id: string | null
          invited_by: string | null
          invited_at: string
          accepted_at: string | null
          expires_at: string | null
          token: string
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          role?: UserRole
          custom_role_id?: string | null
          invited_by?: string | null
          invited_at?: string
          accepted_at?: string | null
          expires_at?: string | null
          token: string
        }
        Update: {
          id?: string
          org_id?: string
          email?: string
          role?: UserRole
          custom_role_id?: string | null
          invited_by?: string | null
          invited_at?: string
          accepted_at?: string | null
          expires_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: 'org_invites_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      user_active_org: {
        Row: {
          user_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          user_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_active_org_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      assistant_mappings: {
        Row: {
          id: string
          organization_id: string
          vapi_assistant_id: string
          name: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          vapi_assistant_id: string
          name?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          vapi_assistant_id?: string
          name?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'assistant_mappings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      integrations: {
        Row: {
          id: string
          organization_id: string
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram' | 'resend' | 'zernio' | 'xkedule' | 'medusa'
          name: string
          encrypted_api_key: string
          key_hint: string | null
          location_id: string | null
          config: Json
          is_active: boolean
          manychat_channel_id: string | null
          created_at: string
          updated_at: string
          health_status: 'connected' | 'degraded' | 'disconnected' | 'unknown'
          last_checked_at: string | null
          last_error: string | null
          failure_count: number
        }
        Insert: {
          id?: string
          organization_id: string
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram' | 'resend' | 'zernio' | 'xkedule' | 'medusa'
          name: string
          encrypted_api_key: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          manychat_channel_id?: string | null
          created_at?: string
          updated_at?: string
          health_status?: 'connected' | 'degraded' | 'disconnected' | 'unknown'
          last_checked_at?: string | null
          last_error?: string | null
          failure_count?: number
        }
        Update: {
          name?: string
          encrypted_api_key?: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          manychat_channel_id?: string | null
          updated_at?: string
          health_status?: 'connected' | 'degraded' | 'disconnected' | 'unknown'
          last_checked_at?: string | null
          last_error?: string | null
          failure_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'integrations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      twilio_phone_numbers: {
        Row: {
          id: string
          organization_id: string
          e164: string
          phone_sid: string | null
          friendly_name: string
          capability_sms: boolean
          capability_mms: boolean
          capability_voice: boolean
          default_routing_mode: 'browser' | 'sip' | 'forward' | null
          forward_to_number: string | null
          is_default: boolean
          is_active: boolean
          notes: string | null
          vapi_assistant_id: string | null
          responsible_user_id: string | null
          business_purpose: string | null
          inbox_label: string | null
          chat_routing: Json
          workflow_settings: Json
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          e164: string
          phone_sid?: string | null
          friendly_name: string
          capability_sms?: boolean
          capability_mms?: boolean
          capability_voice?: boolean
          default_routing_mode?: 'browser' | 'sip' | 'forward' | null
          forward_to_number?: string | null
          is_default?: boolean
          is_active?: boolean
          notes?: string | null
          vapi_assistant_id?: string | null
          responsible_user_id?: string | null
          business_purpose?: string | null
          inbox_label?: string | null
          chat_routing?: Json
          workflow_settings?: Json
          archived_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          e164?: string
          phone_sid?: string | null
          friendly_name?: string
          capability_sms?: boolean
          capability_mms?: boolean
          capability_voice?: boolean
          default_routing_mode?: 'browser' | 'sip' | 'forward' | null
          forward_to_number?: string | null
          is_default?: boolean
          is_active?: boolean
          notes?: string | null
          vapi_assistant_id?: string | null
          responsible_user_id?: string | null
          business_purpose?: string | null
          inbox_label?: string | null
          chat_routing?: Json
          workflow_settings?: Json
          archived_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'twilio_phone_numbers_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      _legacy_tool_configs: {
        Row: {
          id: string
          organization_id: string
          integration_id: string | null
          tool_name: string
          action_type: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_whatsapp_template' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note' | 'send_tenant_email' | 'send_platform_email' | 'xkedule_get_services' | 'xkedule_check_availability' | 'xkedule_create_booking' | 'xkedule_cancel_booking' | 'xkedule_reschedule_booking' | 'xkedule_quote' | 'xkedule_lookup_customer' | 'xkedule_business_info' | 'send_zernio_dm' | 'medusa_search_products' | 'medusa_get_product' | 'medusa_get_cart' | 'medusa_add_to_cart' | 'medusa_update_cart_item' | 'medusa_wishlist_add' | 'medusa_wishlist_remove' | 'medusa_wishlist_list' | 'medusa_get_order_status'
          config: Json
          fallback_message: string
          is_active: boolean
          folder_id: string | null
          labels: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          integration_id?: string | null
          tool_name: string
          action_type: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_whatsapp_template' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note' | 'send_tenant_email' | 'send_platform_email'
          config?: Json
          fallback_message: string
          is_active?: boolean
          folder_id?: string | null
          labels?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          integration_id?: string | null
          tool_name?: string
          action_type?: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_whatsapp_template' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note' | 'xkedule_get_services' | 'xkedule_check_availability' | 'xkedule_create_booking'
          config?: Json
          fallback_message?: string
          is_active?: boolean
          folder_id?: string | null
          labels?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tool_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_configs_integration_id_fkey'
            columns: ['integration_id']
            isOneToOne: false
            referencedRelation: 'integrations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_configs_folder_id_fkey'
            columns: ['folder_id']
            isOneToOne: false
            referencedRelation: 'tool_folders'
            referencedColumns: ['id']
          }
        ]
      }
      tool_folders: {
        Row: {
          id: string
          org_id: string
          name: string
          parent_id: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          parent_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tool_folders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_folders_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'tool_folders'
            referencedColumns: ['id']
          }
        ]
      }
      action_logs: {
        Row: {
          id: string
          organization_id: string
          tool_config_id: string | null
          vapi_call_id: string
          tool_name: string
          status: 'success' | 'error' | 'timeout'
          execution_ms: number
          request_payload: Json
          response_payload: Json
          error_detail: string | null
          created_at: string
          // v2.0 (Phase 33, migration 037 | OBS-02 additive): NULL = legacy v1.x action
          agent_invocation_id: string | null
          trace_id: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          tool_config_id?: string | null
          vapi_call_id: string
          tool_name: string
          status: 'success' | 'error' | 'timeout'
          execution_ms: number
          request_payload?: Json
          response_payload?: Json
          error_detail?: string | null
          created_at?: string
          agent_invocation_id?: string | null
          trace_id?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'action_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'action_logs_tool_config_id_fkey'
            columns: ['tool_config_id']
            isOneToOne: false
            referencedRelation: '_legacy_tool_configs'
            referencedColumns: ['id']
          }
        ]
      }
      // ----------------------------------------------------------------------
      // v2.0 (Phase 33) | agent runtime tables (migrations 034-038)
      // ----------------------------------------------------------------------
      agents: {
        Row: {
          id: string
          organization_id: string
          name: string
          slug: string
          description: string | null
          system_prompt: string
          model: string
          fallback_message: string
          max_history: number
          kb_scope: string[] | null
          channel_overrides: Json
          allowed_channels: AgentChannel[]
          is_active: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          active_prompt_version_id: string | null
          temperature: number | null
          max_tokens: number | null
          group_id: string | null
          position: number
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          slug: string
          description?: string | null
          system_prompt: string
          model?: string
          fallback_message?: string
          max_history?: number
          kb_scope?: string[] | null
          channel_overrides?: Json
          allowed_channels?: AgentChannel[]
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          active_prompt_version_id?: string | null
          temperature?: number | null
          max_tokens?: number | null
          group_id?: string | null
          position?: number
        }
        Update: {
          name?: string
          slug?: string
          description?: string | null
          system_prompt?: string
          model?: string
          fallback_message?: string
          max_history?: number
          kb_scope?: string[] | null
          channel_overrides?: Json
          allowed_channels?: AgentChannel[]
          is_active?: boolean
          updated_by?: string | null
          updated_at?: string
          active_prompt_version_id?: string | null
          temperature?: number | null
          max_tokens?: number | null
          group_id?: string | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: 'agents_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agents_active_prompt_version_id_fkey'
            columns: ['active_prompt_version_id']
            isOneToOne: false
            referencedRelation: 'agent_prompt_versions'
            referencedColumns: ['id']
          }
        ]
      }
      agent_tools: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          tool_config_id: string | null
          workflow_id: string | null
          allowed_channels: AgentChannel[] | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          tool_config_id?: string | null
          workflow_id?: string | null
          allowed_channels?: AgentChannel[] | null
          created_at?: string
        }
        Update: {
          tool_config_id?: string | null
          workflow_id?: string | null
          allowed_channels?: AgentChannel[] | null
        }
        Relationships: [
          {
            foreignKeyName: 'agent_tools_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_tools_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_tools_tool_config_id_fkey'
            columns: ['tool_config_id']
            isOneToOne: false
            referencedRelation: '_legacy_tool_configs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_tools_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          }
        ]
      }
      agent_partners: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          partner_agent_id: string
          invocation_description: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          partner_agent_id: string
          invocation_description: string
          created_at?: string
        }
        Update: {
          invocation_description?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_partners_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_partners_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_partners_partner_agent_id_fkey'
            columns: ['partner_agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      agent_prompt_versions: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          version: number
          system_prompt: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          version: number
          system_prompt: string
          created_by?: string | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'agent_prompt_versions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_prompt_versions_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      agent_channel_defaults: {
        Row: {
          id: string
          organization_id: string
          channel: AgentChannel
          agent_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel: AgentChannel
          agent_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_channel_defaults_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_channel_defaults_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      // Q7 — Project 2: agent quality feedback signals
      agent_feedback: {
        Row: {
          id: string
          org_id: string
          invocation_id: string | null
          conversation_id: string | null
          message_id: string | null
          signal: Database['public']['Enums']['agent_feedback_signal']
          note: string | null
          submitted_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          invocation_id?: string | null
          conversation_id?: string | null
          message_id?: string | null
          signal: Database['public']['Enums']['agent_feedback_signal']
          note?: string | null
          submitted_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          invocation_id?: string | null
          conversation_id?: string | null
          message_id?: string | null
          signal?: Database['public']['Enums']['agent_feedback_signal']
          note?: string | null
          submitted_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_feedback_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_feedback_invocation_id_fkey'
            columns: ['invocation_id']
            isOneToOne: false
            referencedRelation: 'agent_invocations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_feedback_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
        ]
      }
      agent_invocations: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          parent_invocation_id: string | null
          trace_id: string
          channel: AgentChannel
          conversation_id: string | null
          session_id: string | null
          depth: number
          status: AgentInvocationStatus
          mode: AgentInvocationMode
          user_message: string | null
          assistant_reply: string | null
          tool_calls: Json
          partner_calls: Json
          tokens_in: number | null
          tokens_out: number | null
          cost_usd: number | null
          model: string | null
          duration_ms: number | null
          error_detail: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          parent_invocation_id?: string | null
          trace_id: string
          channel: AgentChannel
          conversation_id?: string | null
          session_id?: string | null
          depth?: number
          status: AgentInvocationStatus
          mode?: AgentInvocationMode
          user_message?: string | null
          assistant_reply?: string | null
          tool_calls?: Json
          partner_calls?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          cost_usd?: number | null
          model?: string | null
          duration_ms?: number | null
          error_detail?: string | null
          created_at?: string
        }
        Update: {
          status?: AgentInvocationStatus
          assistant_reply?: string | null
          tool_calls?: Json
          partner_calls?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          cost_usd?: number | null
          model?: string | null
          duration_ms?: number | null
          error_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'agent_invocations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_invocations_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_invocations_parent_invocation_id_fkey'
            columns: ['parent_invocation_id']
            isOneToOne: false
            referencedRelation: 'agent_invocations'
            referencedColumns: ['id']
          }
        ]
      }
      tool_idempotency_keys: {
        Row: {
          id: string
          organization_id: string
          agent_invocation_id: string | null
          idempotency_key: string
          tool_name: string
          request_hash: string
          response: Json
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_invocation_id?: string | null
          idempotency_key: string
          tool_name: string
          request_hash: string
          response: Json
          created_at?: string
          expires_at?: string
        }
        Update: {
          response?: Json
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tool_idempotency_keys_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_idempotency_keys_agent_invocation_id_fkey'
            columns: ['agent_invocation_id']
            isOneToOne: false
            referencedRelation: 'agent_invocations'
            referencedColumns: ['id']
          }
        ]
      }
      agent_model_pricing: {
        Row: {
          model: string
          source: string
          input_per_1m_usd: number
          output_per_1m_usd: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          model: string
          source: string
          input_per_1m_usd: number
          output_per_1m_usd: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          source?: string
          input_per_1m_usd?: number
          output_per_1m_usd?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_channels: {
        Row: {
          id: string
          org_id: string
          location_id: string
          display_name: string | null
          encrypted_api_key: string
          webhook_secret: string
          is_active: boolean
          agent_id: string | null
          automation_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          location_id: string
          display_name?: string | null
          encrypted_api_key: string
          webhook_secret: string
          is_active?: boolean
          agent_id?: string | null
          automation_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          encrypted_api_key?: string
          webhook_secret?: string
          is_active?: boolean
          agent_id?: string | null
          automation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ghl_channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      ghl_events: {
        Row: {
          id: string
          org_id: string
          location_id: string
          contact_id: string | null
          conversation_id: string | null
          message_type: string | null
          direction: string | null
          body: string | null
          phone: string | null
          first_name: string | null
          last_name: string | null
          email: string | null
          raw_payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          location_id: string
          contact_id?: string | null
          conversation_id?: string | null
          message_type?: string | null
          direction?: string | null
          body?: string | null
          phone?: string | null
          first_name?: string | null
          last_name?: string | null
          email?: string | null
          raw_payload?: Json
          created_at?: string
        }
        Update: {
          body?: string | null
          direction?: string | null
          raw_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'ghl_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      ghl_reengagement_sent: {
        Row: {
          id: string
          org_id: string
          location_id: string
          ghl_contact_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          org_id: string
          location_id: string
          ghl_contact_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          location_id?: string
          ghl_contact_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ghl_reengagement_sent_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      automation_schedules: {
        Row: {
          id: string
          automation_key: string
          is_active: boolean
          next_run_at: string
          interval_minutes: number
          last_run_at: string | null
          last_run_status: 'success' | 'error' | 'skipped' | null
          last_run_result: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          automation_key: string
          is_active?: boolean
          next_run_at: string
          interval_minutes: number
          last_run_at?: string | null
          last_run_status?: 'success' | 'error' | 'skipped' | null
          last_run_result?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          automation_key?: string
          is_active?: boolean
          next_run_at?: string
          interval_minutes?: number
          last_run_at?: string | null
          last_run_status?: 'success' | 'error' | 'skipped' | null
          last_run_result?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          id: string
          organization_id: string
          vapi_call_id: string
          assistant_id: string | null
          call_type: string | null
          status: string | null
          ended_reason: string | null
          started_at: string | null
          ended_at: string | null
          duration_seconds: number | null
          cost: number | null
          customer_number: string | null
          customer_name: string | null
          summary: string | null
          transcript: string | null
          transcript_turns: Json
          recording_url: string | null
          success_evaluation: string | null
          structured_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          vapi_call_id: string
          assistant_id?: string | null
          call_type?: string | null
          status?: string | null
          ended_reason?: string | null
          started_at?: string | null
          ended_at?: string | null
          cost?: number | null
          customer_number?: string | null
          customer_name?: string | null
          summary?: string | null
          transcript?: string | null
          transcript_turns?: Json
          recording_url?: string | null
          success_evaluation?: string | null
          structured_data?: Json | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'calls_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      knowledge_sources: {
        Row: {
          id: string
          organization_id: string
          name: string
          source_type: 'pdf' | 'text' | 'csv' | 'url'
          source_url: string | null
          status: 'processing' | 'ready' | 'error'
          error_detail: string | null
          chunk_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          source_type: 'pdf' | 'text' | 'csv' | 'url'
          source_url?: string | null
          status?: 'processing' | 'ready' | 'error'
          error_detail?: string | null
          chunk_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          status?: 'processing' | 'ready' | 'error'
          error_detail?: string | null
          chunk_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_sources_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      global_knowledge_config: {
        Row: {
          id: 'primary'
          source_mode: 'manual' | 'notion'
          updated_at: string
        }
        Insert: {
          id?: 'primary'
          source_mode?: 'manual' | 'notion'
          updated_at?: string
        }
        Update: {
          source_mode?: 'manual' | 'notion'
          updated_at?: string
        }
        Relationships: []
      }
      global_knowledge_notion_connections: {
        Row: {
          id: string
          workspace_id: string
          workspace_name: string | null
          workspace_icon: string | null
          bot_id: string
          owner_user_id: string | null
          encrypted_access_token: string
          encrypted_refresh_token: string | null
          token_expires_at: string | null
          status: 'connected' | 'syncing' | 'error' | 'revoked' | 'disconnected'
          error_detail: string | null
          last_synced_at: string | null
          last_reconciled_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          workspace_name?: string | null
          workspace_icon?: string | null
          bot_id: string
          owner_user_id?: string | null
          encrypted_access_token: string
          encrypted_refresh_token?: string | null
          token_expires_at?: string | null
          status?: 'connected' | 'syncing' | 'error' | 'revoked' | 'disconnected'
          error_detail?: string | null
          last_synced_at?: string | null
          last_reconciled_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['global_knowledge_notion_connections']['Insert']>
        Relationships: []
      }
      global_knowledge_notion_roots: {
        Row: {
          id: string
          connection_id: string
          notion_page_id: string
          title: string
          platform: 'meta' | 'google' | 'global'
          status: 'pending' | 'syncing' | 'active' | 'error' | 'disconnected'
          error_detail: string | null
          last_full_sync_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          connection_id: string
          notion_page_id: string
          title: string
          platform: 'meta' | 'google' | 'global'
          status?: 'pending' | 'syncing' | 'active' | 'error' | 'disconnected'
          error_detail?: string | null
          last_full_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['global_knowledge_notion_roots']['Insert']>
        Relationships: []
      }
      global_knowledge_sources: {
        Row: {
          id: string
          platform: 'meta' | 'google' | 'global'
          name: string
          source_type: 'pdf' | 'text' | 'csv' | 'notion_page'
          source_url: string | null
          storage_bucket: string | null
          status: 'processing' | 'ready' | 'error'
          error_detail: string | null
          chunk_count: number
          external_id: string | null
          content_hash: string | null
          external_last_edited_at: string | null
          active_revision_id: string | null
          last_synced_at: string | null
          is_active: boolean
          notion_root_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          platform: 'meta' | 'google' | 'global'
          name: string
          source_type: 'pdf' | 'text' | 'csv' | 'notion_page'
          source_url?: string | null
          storage_bucket?: string | null
          status?: 'processing' | 'ready' | 'error'
          error_detail?: string | null
          chunk_count?: number
          external_id?: string | null
          content_hash?: string | null
          external_last_edited_at?: string | null
          active_revision_id?: string | null
          last_synced_at?: string | null
          is_active?: boolean
          notion_root_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          platform?: 'meta' | 'google' | 'global'
          name?: string
          status?: 'processing' | 'ready' | 'error'
          error_detail?: string | null
          chunk_count?: number
          source_url?: string | null
          storage_bucket?: string | null
          external_id?: string | null
          content_hash?: string | null
          external_last_edited_at?: string | null
          active_revision_id?: string | null
          last_synced_at?: string | null
          is_active?: boolean
          notion_root_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      global_knowledge_sync_jobs: {
        Row: {
          id: string
          event_id: string | null
          connection_id: string
          root_id: string | null
          notion_page_id: string | null
          job_type: 'initial' | 'page_upsert' | 'page_delete' | 'reconcile'
          status: 'queued' | 'processing' | 'succeeded' | 'failed'
          attempts: number
          next_attempt_at: string
          error_detail: string | null
          payload: Json
          created_at: string
          started_at: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          event_id?: string | null
          connection_id: string
          root_id?: string | null
          notion_page_id?: string | null
          job_type: 'initial' | 'page_upsert' | 'page_delete' | 'reconcile'
          status?: 'queued' | 'processing' | 'succeeded' | 'failed'
          attempts?: number
          next_attempt_at?: string
          error_detail?: string | null
          payload?: Json
          created_at?: string
          started_at?: string | null
          completed_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['global_knowledge_sync_jobs']['Insert']>
        Relationships: []
      }
      documents: {
        Row: {
          id: number
          content: string
          metadata: Json
          embedding: number[] | null
          knowledge_source_id: string | null
          created_at: string
        }
        Insert: {
          id?: number
          content: string
          metadata?: Json
          embedding?: number[] | null
          knowledge_source_id?: string | null
          created_at?: string
        }
        Update: {
          embedding?: number[] | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'documents_knowledge_source_id_fkey'
            columns: ['knowledge_source_id']
            isOneToOne: false
            referencedRelation: 'knowledge_sources'
            referencedColumns: ['id']
          }
        ]
      }
      evolution_instances: {
        Row: {
          id: string
          org_id: string
          instance_name: string
          base_url: string
          token_encrypted: string
          webhook_secret_encrypted: string | null
          status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
          phone_number: string | null
          connected_at: string | null
          last_error: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          instance_name: string
          base_url: string
          token_encrypted: string
          webhook_secret_encrypted?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
          phone_number?: string | null
          connected_at?: string | null
          last_error?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          instance_name?: string
          base_url?: string
          token_encrypted?: string
          webhook_secret_encrypted?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
          phone_number?: string | null
          connected_at?: string | null
          last_error?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'evolution_instances_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      commerce_event_receipts: {
        Row: {
          id: string
          org_id: string
          event_id: string
          type: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          event_id: string
          type: string
          payload: Json
          created_at?: string
        }
        Update: {
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'commerce_event_receipts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      conversations: {
        Row: {
          id: string
          org_id: string
          widget_token: string
          session_key: string | null
          status: string
          last_active_at: string
          created_at: string
          updated_at: string
          last_message_at: string | null
          first_page_url: string | null
          visitor_name: string | null
          visitor_phone: string | null
          visitor_email: string | null
          last_message: string | null
          memory: Record<string, unknown>
          channel: string
          channel_metadata: Json
          last_inbound_at: string | null
          bot_status: string
          assigned_user_id: string | null
          agent_id: string | null
          contact_id: string | null
          evolution_instance_id: string | null
          pinned: boolean
          priority: string
          starred: boolean
          wait_until: string | null
          phone_number_id: string | null
          show_operator_name_prefix: boolean
        }
        Insert: {
          id?: string
          org_id: string
          widget_token: string
          session_key?: string | null
          status?: string
          last_active_at?: string
          created_at?: string
          updated_at?: string
          last_message_at?: string | null
          first_page_url?: string | null
          visitor_name?: string | null
          visitor_phone?: string | null
          visitor_email?: string | null
          last_message?: string | null
          memory?: Record<string, unknown>
          channel?: string
          channel_metadata?: Json
          last_inbound_at?: string | null
          bot_status?: string
          assigned_user_id?: string | null
          agent_id?: string | null
          contact_id?: string | null
          evolution_instance_id?: string | null
          pinned?: boolean
          priority?: string
          starred?: boolean
          wait_until?: string | null
          phone_number_id?: string | null
          show_operator_name_prefix?: boolean
        }
        Update: {
          status?: string
          last_active_at?: string
          updated_at?: string
          last_message_at?: string | null
          visitor_name?: string | null
          visitor_phone?: string | null
          visitor_email?: string | null
          last_message?: string | null
          memory?: Record<string, unknown>
          channel?: string
          channel_metadata?: Json
          last_inbound_at?: string | null
          bot_status?: string
          assigned_user_id?: string | null
          agent_id?: string | null
          contact_id?: string | null
          evolution_instance_id?: string | null
          pinned?: boolean
          priority?: string
          starred?: boolean
          wait_until?: string | null
          phone_number_id?: string | null
          show_operator_name_prefix?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversations_phone_number_id_fkey'
            columns: ['phone_number_id']
            isOneToOne: false
            referencedRelation: 'twilio_phone_numbers'
            referencedColumns: ['id']
          }
        ]
      }
      inbox_saved_views: {
        Row: {
          id: string
          org_id: string
          user_id: string
          name: string
          filters: Record<string, unknown>
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          name: string
          filters?: Record<string, unknown>
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          name?: string
          filters?: Record<string, unknown>
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inbox_saved_views_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbox_saved_views_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_messages: {
        Row: {
          id: string
          conversation_id: string
          org_id: string
          role: string
          content: string
          created_at: string
          metadata: Record<string, unknown> | null
          message_type: string
          channel: string | null
          email_subject: string | null
          email_from: string | null
          email_to: string | null
          email_cc: string | null
          email_message_id: string | null
          email_delivery_status: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          org_id: string
          role: string
          content: string
          created_at?: string
          metadata?: Record<string, unknown> | null
          message_type?: string
          channel?: string | null
          email_subject?: string | null
          email_from?: string | null
          email_to?: string | null
          email_cc?: string | null
          email_message_id?: string | null
          email_delivery_status?: string | null
        }
        Update: {
          role?: string
          content?: string
          metadata?: Record<string, unknown> | null
          message_type?: string
          channel?: string | null
          email_subject?: string | null
          email_from?: string | null
          email_to?: string | null
          email_cc?: string | null
          email_message_id?: string | null
          email_delivery_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversation_messages_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      contacts: {
        Row: {
          id: string
          org_id: string
          first_name: string | null
          last_name: string | null
          name: string | null
          phone: string | null
          phone_e164: string | null
          email: string | null
          email_normalized: string | null
          identity_status: ContactIdentityStatus
          merged_into_contact_id: string | null
          company: string | null
          notes: string | null
          tags: string[]
          custom_fields: Record<string, unknown>
          source: ContactSource
          lifecycle_stage: CrmLifecycleStage
          engagement_status: CrmEngagementStatus
          intent_level: CrmIntentLevel
          qualification_status: CrmQualificationStatus
          source_type: string | null
          source_id: string | null
          source_payload: Json
          external_id: string | null
          account_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          /** Migration 1085: DND — true when any channel is blocked */
          dnd_enabled: boolean
          /** Migration 1085: DND — blocked channel keys, e.g. ['sms','email','all'] */
          dnd_channels: string[]
          dnd_note: string | null
          dnd_set_at: string | null
          dnd_set_by: string | null
          /** Migration 1100: WhatsApp opt-in for Meta Cloud campaigns */
          whatsapp_opt_in: boolean
          whatsapp_opted_at: string | null
          /** Migration 1104: public URL of the contact's avatar in the 'avatars' storage bucket */
          avatar_url: string | null
          /** Migration 1117: RBAC seal — user this contact is assigned to (NULL = unassigned) */
          assigned_to: string | null
          /** Migration 1158: prospects full system — lead score + engagement summary */
          score: number
          recommended_channel: CrmRecommendedChannel | null
          last_contacted_at: string | null
          last_replied_at: string | null
          last_visit_at: string | null
          /** Migration 1264: email verification cache (millionverifier/neverbounce/bounce) */
          email_status: EmailStatus | null
          email_verified_at: string | null
          email_verification_provider: string | null
          email_risk: EmailRisk | null
        }
        Insert: {
          id?: string
          org_id: string
          first_name?: string | null
          last_name?: string | null
          name?: string | null
          phone?: string | null
          email?: string | null
          identity_status?: ContactIdentityStatus
          merged_into_contact_id?: string | null
          company?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          source?: ContactSource
          lifecycle_stage?: CrmLifecycleStage
          engagement_status?: CrmEngagementStatus
          intent_level?: CrmIntentLevel
          qualification_status?: CrmQualificationStatus
          source_type?: string | null
          source_id?: string | null
          source_payload?: Json
          external_id?: string | null
          account_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          dnd_enabled?: boolean
          dnd_channels?: string[]
          dnd_note?: string | null
          dnd_set_at?: string | null
          dnd_set_by?: string | null
          whatsapp_opt_in?: boolean
          whatsapp_opted_at?: string | null
          avatar_url?: string | null
          assigned_to?: string | null
          score?: number
          recommended_channel?: CrmRecommendedChannel | null
          last_contacted_at?: string | null
          last_replied_at?: string | null
          last_visit_at?: string | null
        }
        Update: {
          first_name?: string | null
          last_name?: string | null
          name?: string | null
          phone?: string | null
          email?: string | null
          identity_status?: ContactIdentityStatus
          merged_into_contact_id?: string | null
          company?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          source?: ContactSource
          lifecycle_stage?: CrmLifecycleStage
          engagement_status?: CrmEngagementStatus
          intent_level?: CrmIntentLevel
          qualification_status?: CrmQualificationStatus
          source_type?: string | null
          source_id?: string | null
          source_payload?: Json
          external_id?: string | null
          account_id?: string | null
          updated_at?: string
          dnd_enabled?: boolean
          dnd_channels?: string[]
          dnd_note?: string | null
          dnd_set_at?: string | null
          dnd_set_by?: string | null
          whatsapp_opt_in?: boolean
          whatsapp_opted_at?: string | null
          avatar_url?: string | null
          assigned_to?: string | null
          score?: number
          recommended_channel?: CrmRecommendedChannel | null
          last_contacted_at?: string | null
          last_replied_at?: string | null
          last_visit_at?: string | null
          email_status?: EmailStatus | null
          email_verified_at?: string | null
          email_verification_provider?: string | null
          email_risk?: EmailRisk | null
        }
        Relationships: [
          {
            foreignKeyName: 'contacts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contacts_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contacts_merged_into_contact_id_fkey'
            columns: ['merged_into_contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      contact_channel_identities: {
        Row: {
          id: string
          org_id: string
          contact_id: string
          provider: ChannelProvider
          external_id: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          contact_id: string
          provider: ChannelProvider
          external_id: string
          created_at?: string
        }
        Update: {
          provider?: ChannelProvider
          external_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contact_channel_identities_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_channel_identities_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      contact_duplicate_audit: {
        Row: {
          cluster_id: string
          org_id: string
          match_type: 'phone' | 'email'
          normalized_value: string
          contact_ids: string[]
          cluster_size: number
          detected_at: string
        }
        Insert: {
          cluster_id?: string
          org_id: string
          match_type: 'phone' | 'email'
          normalized_value: string
          contact_ids: string[]
          cluster_size: number
          detected_at?: string
        }
        Update: {
          match_type?: 'phone' | 'email'
          normalized_value?: string
          contact_ids?: string[]
          cluster_size?: number
          detected_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contact_duplicate_audit_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      contact_merge_exclusions: {
        Row: {
          org_id: string
          contact_id_a: string
          contact_id_b: string
          excluded_by: string | null
          excluded_at: string
          reason: string | null
        }
        Insert: {
          org_id: string
          contact_id_a: string
          contact_id_b: string
          excluded_by?: string | null
          excluded_at?: string
          reason?: string | null
        }
        Update: {
          excluded_by?: string | null
          excluded_at?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'contact_merge_exclusions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_merge_exclusions_contact_id_a_fkey'
            columns: ['contact_id_a']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_merge_exclusions_contact_id_b_fkey'
            columns: ['contact_id_b']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_merge_exclusions_excluded_by_fkey'
            columns: ['excluded_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      contact_merge_log: {
        Row: {
          id: string
          org_id: string
          survivor_id: string
          archived_id: string
          merged_by: string | null
          merged_at: string
          strategy: 'manual' | 'auto' | 'import-dedup'
          cluster_id: string | null
          affected_rows: Json | null
        }
        Insert: {
          id?: string
          org_id: string
          survivor_id: string
          archived_id: string
          merged_by?: string | null
          merged_at?: string
          strategy: 'manual' | 'auto' | 'import-dedup'
          cluster_id?: string | null
          affected_rows?: Json | null
        }
        Update: {
          merged_by?: string | null
          merged_at?: string
          strategy?: 'manual' | 'auto' | 'import-dedup'
          cluster_id?: string | null
          affected_rows?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'contact_merge_log_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_merge_log_cluster_id_fkey'
            columns: ['cluster_id']
            isOneToOne: false
            referencedRelation: 'contact_duplicate_audit'
            referencedColumns: ['cluster_id']
          },
          {
            foreignKeyName: 'contact_merge_log_merged_by_fkey'
            columns: ['merged_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      accounts: {
        Row: {
          id: string
          org_id: string
          name: string
          domain: string | null
          website: string | null
          industry: string | null
          size: string | null
          phone: string | null
          address: string | null
          notes: string | null
          avatar_url: string | null
          tags: string[]
          custom_fields: Record<string, unknown>
          external_id: string | null
          source: AccountSource
          lifecycle_stage: CrmLifecycleStage
          engagement_status: CrmEngagementStatus
          intent_level: CrmIntentLevel
          qualification_status: CrmQualificationStatus
          source_type: string | null
          source_id: string | null
          source_payload: Json
          assigned_to: string | null
          /** Migration 1158: prospects full system — lead score + engagement summary */
          score: number
          recommended_channel: CrmRecommendedChannel | null
          last_contacted_at: string | null
          last_replied_at: string | null
          last_visit_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          /** Migration 1264: email verification cache (millionverifier/neverbounce/bounce) — companies keep their scraped address in custom_fields.email, only the verification STATUS gets a real column */
          email_status: EmailStatus | null
          email_verified_at: string | null
          email_verification_provider: string | null
          email_risk: EmailRisk | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          domain?: string | null
          website?: string | null
          industry?: string | null
          size?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          avatar_url?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          external_id?: string | null
          source?: AccountSource
          lifecycle_stage?: CrmLifecycleStage
          engagement_status?: CrmEngagementStatus
          intent_level?: CrmIntentLevel
          qualification_status?: CrmQualificationStatus
          source_type?: string | null
          source_id?: string | null
          source_payload?: Json
          assigned_to?: string | null
          score?: number
          recommended_channel?: CrmRecommendedChannel | null
          last_contacted_at?: string | null
          last_replied_at?: string | null
          last_visit_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          domain?: string | null
          website?: string | null
          industry?: string | null
          size?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          avatar_url?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          external_id?: string | null
          source?: AccountSource
          lifecycle_stage?: CrmLifecycleStage
          engagement_status?: CrmEngagementStatus
          intent_level?: CrmIntentLevel
          qualification_status?: CrmQualificationStatus
          source_type?: string | null
          source_id?: string | null
          source_payload?: Json
          assigned_to?: string | null
          score?: number
          recommended_channel?: CrmRecommendedChannel | null
          last_contacted_at?: string | null
          last_replied_at?: string | null
          last_visit_at?: string | null
          updated_at?: string
          email_status?: EmailStatus | null
          email_verified_at?: string | null
          email_verification_provider?: string | null
          email_risk?: EmailRisk | null
        }
        Relationships: [
          {
            foreignKeyName: 'accounts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      // Unified read-only view over prospect-stage contacts + accounts
      // (migration 1247). See supabase/migrations/1247_prospect_rows_view.sql.
      prospect_rows: {
        Row: {
          id: string
          org_id: string
          kind: 'person' | 'company'
          name: string | null
          email: string | null
          phone: string | null
          company: string | null
          website: string | null
          domain: string | null
          city: string | null
          tags: string[]
          source: string
          source_type: string | null
          source_id: string | null
          engagement_status: CrmEngagementStatus
          intent_level: CrmIntentLevel
          qualification_status: CrmQualificationStatus
          recommended_channel: CrmRecommendedChannel | null
          score: number
          last_contacted_at: string | null
          last_replied_at: string | null
          /** Migration 1265: email verification columns exposed on the unified view */
          email_status: EmailStatus | null
          email_verified_at: string | null
          email_verification_provider: string | null
          email_risk: EmailRisk | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      // ----- Prospects full system (migration 1158) ---------------------------
      prospect_lists: {
        Row: {
          id: string
          org_id: string
          name: string
          description: string | null
          color: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          description?: string | null
          color?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          color?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'prospect_lists_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      prospect_list_members: {
        Row: {
          id: string
          org_id: string
          list_id: string
          contact_id: string | null
          account_id: string | null
          added_by: string | null
          added_at: string
        }
        Insert: {
          id?: string
          org_id: string
          list_id: string
          contact_id?: string | null
          account_id?: string | null
          added_by?: string | null
          added_at?: string
        }
        Update: {
          list_id?: string
          contact_id?: string | null
          account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'prospect_list_members_list_id_fkey'
            columns: ['list_id']
            isOneToOne: false
            referencedRelation: 'prospect_lists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'prospect_list_members_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'prospect_list_members_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          }
        ]
      }
      prospect_sources: {
        Row: {
          id: string
          org_id: string
          source_type: string
          source_key: string | null
          label: string | null
          external_run_id: string | null
          status: ProspectSourceStatus
          total_count: number
          imported_count: number
          metadata: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          source_type: string
          source_key?: string | null
          label?: string | null
          external_run_id?: string | null
          status?: ProspectSourceStatus
          total_count?: number
          imported_count?: number
          metadata?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          source_type?: string
          source_key?: string | null
          label?: string | null
          external_run_id?: string | null
          status?: ProspectSourceStatus
          total_count?: number
          imported_count?: number
          metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'prospect_sources_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      prospect_audiences: {
        Row: {
          id: string
          org_id: string
          name: string
          description: string | null
          definition: Json
          synced_platforms: string[]
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          description?: string | null
          definition?: Json
          synced_platforms?: string[]
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          definition?: Json
          synced_platforms?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'prospect_audiences_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      prospect_conversions: {
        Row: {
          id: string
          org_id: string
          entity_type: ProspectEntityType
          entity_id: string
          from_stage: string
          to_stage: string
          converted_by: string | null
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          entity_type: ProspectEntityType
          entity_id: string
          from_stage: string
          to_stage: string
          converted_by?: string | null
          payload?: Json
          created_at?: string
        }
        Update: {
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'prospect_conversions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      prospect_engagement_events: {
        Row: {
          id: string
          org_id: string
          entity_type: ProspectEntityType
          entity_id: string
          event_type: ProspectEventType
          channel: string | null
          source_platform: string | null
          occurred_at: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          entity_type: ProspectEntityType
          entity_id: string
          event_type: ProspectEventType
          channel?: string | null
          source_platform?: string | null
          occurred_at?: string
          payload?: Json
          created_at?: string
        }
        Update: {
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'prospect_engagement_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      custom_field_definitions: {
        Row: {
          id: string
          org_id: string
          entity: CustomFieldEntity
          key: string
          label: string
          type: CustomFieldType
          required: boolean
          unique_per_org: boolean
          position: number
          group_name: string | null
          help_text: string | null
          default_value: unknown | null
          options: unknown | null
          validation: unknown | null
          visible_in_list: boolean
          filterable: boolean
          archived: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          entity: CustomFieldEntity
          key: string
          label: string
          type: CustomFieldType
          required?: boolean
          unique_per_org?: boolean
          position?: number
          group_name?: string | null
          help_text?: string | null
          default_value?: unknown | null
          options?: unknown | null
          validation?: unknown | null
          visible_in_list?: boolean
          filterable?: boolean
          archived?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          label?: string
          type?: CustomFieldType
          required?: boolean
          unique_per_org?: boolean
          position?: number
          group_name?: string | null
          help_text?: string | null
          default_value?: unknown | null
          options?: unknown | null
          validation?: unknown | null
          visible_in_list?: boolean
          filterable?: boolean
          archived?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'custom_field_definitions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'custom_field_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      contact_imports: {
        Row: {
          id: string
          org_id: string
          storage_path: string
          filename: string
          size_bytes: number
          mime_type: string | null
          status: ContactImportStatus
          status_message: string | null
          error_summary: string | null
          mapping: Record<string, string | null>
          dedup_strategy: ContactImportDedupStrategy
          dedup_keys: string[] | null
          default_tags: string[] | null
          default_source: string | null
          default_assigned_to: string | null
          total_rows: number
          processed_rows: number
          inserted_rows: number
          updated_rows: number
          skipped_rows: number
          error_rows: number
          progress_percent: number
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          storage_path: string
          filename: string
          size_bytes: number
          mime_type?: string | null
          status?: ContactImportStatus
          status_message?: string | null
          error_summary?: string | null
          mapping?: Record<string, string | null>
          dedup_strategy?: ContactImportDedupStrategy
          dedup_keys?: string[] | null
          default_tags?: string[] | null
          default_source?: string | null
          default_assigned_to?: string | null
          total_rows?: number
          processed_rows?: number
          inserted_rows?: number
          updated_rows?: number
          skipped_rows?: number
          error_rows?: number
          // progress_percent OMITTED � GENERATED ALWAYS, never writable
          started_at?: string | null
          finished_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          storage_path?: string
          filename?: string
          size_bytes?: number
          mime_type?: string | null
          status?: ContactImportStatus
          status_message?: string | null
          error_summary?: string | null
          mapping?: Record<string, string | null>
          dedup_strategy?: ContactImportDedupStrategy
          dedup_keys?: string[] | null
          default_tags?: string[] | null
          default_source?: string | null
          default_assigned_to?: string | null
          total_rows?: number
          processed_rows?: number
          inserted_rows?: number
          updated_rows?: number
          skipped_rows?: number
          error_rows?: number
          // progress_percent OMITTED � GENERATED ALWAYS, never writable
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contact_imports_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_imports_default_assigned_to_fkey'
            columns: ['default_assigned_to']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_imports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      contact_import_errors: {
        Row: {
          id: string
          import_id: string
          row_number: number
          raw_row: Record<string, unknown>
          field: string | null
          message: string
          created_at: string
        }
        Insert: {
          id?: string
          import_id: string
          row_number: number
          raw_row: Record<string, unknown>
          field?: string | null
          message: string
          created_at?: string
        }
        Update: {
          // errors are append-only; only message is realistically updatable
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contact_import_errors_import_id_fkey'
            columns: ['import_id']
            isOneToOne: false
            referencedRelation: 'contact_imports'
            referencedColumns: ['id']
          }
        ]
      }
      unified_calls: {
        Row: {
          id: string
          call_type: 'ai' | 'human'
          org_id: string
          external_id: string
          counterpart_number: string | null
          counterpart_name: string | null
          contact_id: string | null
          direction: 'inbound' | 'outbound'
          duration_seconds: number | null
          status: string | null
          substatus: string | null
          recording_url: string | null
          recording_duration: number | null
          transcript: string | null
          notes: string | null
          cost: number | null
          assistant_id: string | null
          routing_mode: string | null
          started_at: string | null
          ended_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      tags: {
        Row: {
          id: string
          org_id: string
          name: string
          slug: string
          color: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          slug: string
          color?: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          name?: string
          slug?: string
          color?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tags_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          tag_id: string
          tagged_at: string
          tagged_by: string | null
        }
        Insert: {
          contact_id: string
          tag_id: string
          tagged_at?: string
          tagged_by?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'contact_tags_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_tags_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'tags'
            referencedColumns: ['id']
          }
        ]
      }
      contact_verifications: {
        Row: {
          id: string
          org_id: string
          contact_id: string
          identifier_type: 'phone' | 'email'
          identifier_value: string
          method: 'manual' | 'sms_reply' | 'email_click' | 'oauth'
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          contact_id: string
          identifier_type: 'phone' | 'email'
          identifier_value: string
          method?: 'manual' | 'sms_reply' | 'email_click' | 'oauth'
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          contact_id?: string
          identifier_type?: 'phone' | 'email'
          identifier_value?: string
          method?: 'manual' | 'sms_reply' | 'email_click' | 'oauth'
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: []
      }
      opportunity_tags: {
        Row: {
          opportunity_id: string
          tag_id: string
          tagged_at: string
          tagged_by: string | null
        }
        Insert: {
          opportunity_id: string
          tag_id: string
          tagged_at?: string
          tagged_by?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'opportunity_tags_opportunity_id_fkey'
            columns: ['opportunity_id']
            isOneToOne: false
            referencedRelation: 'opportunities'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_tags_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'tags'
            referencedColumns: ['id']
          }
        ]
      }
      call_settings: {
        Row: {
          id: string
          org_id: string
          user_id: string
          routing_mode: CallRoutingMode
          phone_forward: string | null
          sip_username: string | null
          sip_password_encrypted: string | null
          twilio_client_identity: string | null
          record_calls: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          routing_mode?: CallRoutingMode
          phone_forward?: string | null
          sip_username?: string | null
          sip_password_encrypted?: string | null
          twilio_client_identity?: string | null
          record_calls?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          routing_mode?: CallRoutingMode
          phone_forward?: string | null
          sip_username?: string | null
          sip_password_encrypted?: string | null
          twilio_client_identity?: string | null
          record_calls?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'call_settings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      call_routing_chains: {
        Row: {
          id: string
          org_id: string
          is_active: boolean
          stages: CallRoutingStage[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          is_active?: boolean
          stages?: CallRoutingStage[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          is_active?: boolean
          stages?: CallRoutingStage[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'call_routing_chains_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      call_destinations: {
        Row: {
          id: string
          org_id: string
          kind: CallDestinationKind
          user_id: string | null
          name: string
          number: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          kind: CallDestinationKind
          user_id?: string | null
          name: string
          number?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          kind?: CallDestinationKind
          user_id?: string | null
          name?: string
          number?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'call_destinations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      call_logs: {
        Row: {
          id: string
          org_id: string
          contact_id: string | null
          opportunity_id: string | null
          call_sid: string
          direction: CallDirection
          routing_mode: CallRoutingMode | null
          from_number: string | null
          to_number: string | null
          status: string | null
          duration_seconds: number | null
          recording_url: string | null
          recording_duration: number | null
          started_at: string | null
          ended_at: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          phone_number_id: string | null
        }
        Insert: {
          id?: string
          org_id: string
          contact_id?: string | null
          opportunity_id?: string | null
          call_sid: string
          direction: CallDirection
          routing_mode?: CallRoutingMode | null
          from_number?: string | null
          to_number?: string | null
          status?: string | null
          duration_seconds?: number | null
          recording_url?: string | null
          recording_duration?: number | null
          started_at?: string | null
          ended_at?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          phone_number_id?: string | null
        }
        Update: {
          contact_id?: string | null
          opportunity_id?: string | null
          routing_mode?: CallRoutingMode | null
          from_number?: string | null
          to_number?: string | null
          status?: string | null
          duration_seconds?: number | null
          recording_url?: string | null
          recording_duration?: number | null
          started_at?: string | null
          ended_at?: string | null
          notes?: string | null
          phone_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'call_logs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'call_logs_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'call_logs_phone_number_id_fkey'
            columns: ['phone_number_id']
            isOneToOne: false
            referencedRelation: 'twilio_phone_numbers'
            referencedColumns: ['id']
          }
        ]
      }
      pipelines: {
        Row: {
          id: string
          org_id: string
          name: string
          is_default: boolean
          position: number
          card_fields: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          is_default?: boolean
          position?: number
          card_fields?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          is_default?: boolean
          position?: number
          card_fields?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pipelines_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      pipeline_stages: {
        Row: {
          id: string
          pipeline_id: string
          org_id: string
          name: string
          position: number
          color: string
          is_won: boolean
          is_lost: boolean
          created_at: string
        }
        Insert: {
          id?: string
          pipeline_id: string
          org_id: string
          name: string
          position: number
          color?: string
          is_won?: boolean
          is_lost?: boolean
          created_at?: string
        }
        Update: {
          name?: string
          position?: number
          color?: string
          is_won?: boolean
          is_lost?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'pipeline_stages_pipeline_id_fkey'
            columns: ['pipeline_id']
            isOneToOne: false
            referencedRelation: 'pipelines'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pipeline_stages_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          org_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          org_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'push_subscriptions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      opportunities: {
        Row: {
          id: string
          org_id: string
          contact_id: string | null
          account_id: string | null
          pipeline_id: string
          stage_id: string
          title: string
          value: number
          currency: string
          status: OpportunityStatus
          expected_close_date: string | null
          assigned_to: string | null
          position: number
          custom_fields: Record<string, unknown>
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          contact_id?: string | null
          account_id?: string | null
          pipeline_id: string
          stage_id: string
          title: string
          value?: number
          currency?: string
          status?: OpportunityStatus
          expected_close_date?: string | null
          assigned_to?: string | null
          position?: number
          custom_fields?: Record<string, unknown>
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          account_id?: string | null
          pipeline_id?: string
          stage_id?: string
          title?: string
          value?: number
          currency?: string
          status?: OpportunityStatus
          expected_close_date?: string | null
          assigned_to?: string | null
          position?: number
          custom_fields?: Record<string, unknown>
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'opportunities_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_pipeline_id_fkey'
            columns: ['pipeline_id']
            isOneToOne: false
            referencedRelation: 'pipelines'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_stage_id_fkey'
            columns: ['stage_id']
            isOneToOne: false
            referencedRelation: 'pipeline_stages'
            referencedColumns: ['id']
          }
        ]
      }
      opportunity_contacts: {
        Row: {
          id: string
          org_id: string
          opportunity_id: string
          contact_id: string
          is_primary: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          opportunity_id: string
          contact_id: string
          is_primary?: boolean
          created_at?: string
        }
        Update: {
          org_id?: string
          opportunity_id?: string
          contact_id?: string
          is_primary?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'opportunity_contacts_opportunity_id_fkey'
            columns: ['opportunity_id']
            isOneToOne: false
            referencedRelation: 'opportunities'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_contacts_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      opportunity_activities: {
        Row: {
          id: string
          org_id: string
          opportunity_id: string
          type: OpportunityActivityType
          content: string | null
          call_log_id: string | null
          conversation_id: string | null
          metadata: Record<string, unknown> | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          opportunity_id: string
          type: OpportunityActivityType
          content?: string | null
          call_log_id?: string | null
          conversation_id?: string | null
          metadata?: Record<string, unknown> | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          type?: OpportunityActivityType
          content?: string | null
          metadata?: Record<string, unknown> | null
        }
        Relationships: [
          {
            foreignKeyName: 'opportunity_activities_opportunity_id_fkey'
            columns: ['opportunity_id']
            isOneToOne: false
            referencedRelation: 'opportunities'
            referencedColumns: ['id']
          }
        ]
      }
      campaigns: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          channel: CampaignChannel
          campaign_type: CampaignType
          vapi_assistant_id: string | null
          vapi_phone_number_id: string | null
          vapi_campaign_id: string | null
          status: CampaignStatus
          scheduled_start_at: string | null
          started_at: string | null
          completed_at: string | null
          calls_per_minute: number
          landing_page_url: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign_tag: string | null
          utm_content: string | null
          utm_term: string | null
          audience_filter: Json
          template_config: Json
          metrics: Json
          created_by: string | null
          // migration 1091: sms_body
          sms_body: string | null
          // migration 1100: WhatsApp Cloud template
          whatsapp_template_id: string | null
          whatsapp_variable_mapping: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          channel?: CampaignChannel
          campaign_type?: CampaignType
          vapi_assistant_id?: string | null
          vapi_phone_number_id?: string | null
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          started_at?: string | null
          completed_at?: string | null
          calls_per_minute?: number
          landing_page_url?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign_tag?: string | null
          utm_content?: string | null
          utm_term?: string | null
          audience_filter?: Json
          template_config?: Json
          metrics?: Json
          created_by?: string | null
          sms_body?: string | null
          whatsapp_template_id?: string | null
          whatsapp_variable_mapping?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          channel?: CampaignChannel
          campaign_type?: CampaignType
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          started_at?: string | null
          completed_at?: string | null
          calls_per_minute?: number
          landing_page_url?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign_tag?: string | null
          utm_content?: string | null
          utm_term?: string | null
          audience_filter?: Json
          template_config?: Json
          metrics?: Json
          created_by?: string | null
          sms_body?: string | null
          whatsapp_template_id?: string | null
          whatsapp_variable_mapping?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaigns_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_recipients: {
        Row: {
          id: string
          campaign_id: string
          contact_id: string | null
          status: CampaignRecipientStatus
          sent_at: string | null
          result: Json
          error_message: string | null
          // migration 1100: WhatsApp Cloud tracking
          wamid: string | null
          cost_usd: number | null
          message_type: 'marketing' | 'utility' | 'authentication' | 'service' | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          contact_id?: string | null
          status?: CampaignRecipientStatus
          sent_at?: string | null
          result?: Json
          error_message?: string | null
          wamid?: string | null
          cost_usd?: number | null
          message_type?: 'marketing' | 'utility' | 'authentication' | 'service' | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: CampaignRecipientStatus
          sent_at?: string | null
          result?: Json
          error_message?: string | null
          wamid?: string | null
          cost_usd?: number | null
          message_type?: 'marketing' | 'utility' | 'authentication' | 'service' | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_recipients_campaign_id_fkey'
            columns: ['campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_recipients_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_contacts: {
        Row: {
          id: string
          campaign_id: string
          organization_id: string
          name: string | null
          phone: string
          custom_data: Json
          status: CampaignContactStatus
          vapi_call_id: string | null
          error_detail: string | null
          called_at: string | null
          completed_at: string | null
          retry_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          organization_id: string
          name?: string | null
          phone: string
          custom_data?: Json
          status?: CampaignContactStatus
          vapi_call_id?: string | null
          error_detail?: string | null
          called_at?: string | null
          completed_at?: string | null
          retry_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: CampaignContactStatus
          vapi_call_id?: string | null
          error_detail?: string | null
          called_at?: string | null
          completed_at?: string | null
          retry_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_contacts_campaign_id_fkey'
            columns: ['campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_contacts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      bookings: {
        Row: {
          id: string
          org_id: string
          event_type_id: string
          booker_name: string
          booker_email: string
          booker_phone: string | null
          booker_timezone: string
          start_at: string
          end_at: string
          notes: string | null
          status: 'confirmed' | 'cancelled' | 'no_show' | 'showed'
          linked_contact_id: string | null
          cancel_token: string
          created_at: string
          updated_at: string
          location_kind: string | null
          location_data: Json
          meeting_url: string | null
          meeting_phone: string | null
          google_event_id: string | null
          external_source: string | null
          external_id: string | null
          external_updated_at: string | null
          organizer_user_id: string | null
          price: number | null
          currency: string | null
          external_staff_id: number | null
          external_staff_name: string | null
        }
        Insert: {
          id?: string
          org_id: string
          event_type_id: string
          booker_name: string
          booker_email: string
          booker_phone?: string | null
          booker_timezone?: string
          start_at: string
          end_at: string
          notes?: string | null
          status?: 'confirmed' | 'cancelled' | 'no_show' | 'showed'
          linked_contact_id?: string | null
          cancel_token?: string
          created_at?: string
          updated_at?: string
          location_kind?: string | null
          location_data?: Json
          meeting_url?: string | null
          meeting_phone?: string | null
          google_event_id?: string | null
          external_source?: string | null
          external_id?: string | null
          external_updated_at?: string | null
          organizer_user_id?: string | null
          price?: number | null
          currency?: string | null
          external_staff_id?: number | null
          external_staff_name?: string | null
        }
        Update: {
          booker_name?: string
          booker_email?: string
          booker_phone?: string | null
          booker_timezone?: string
          start_at?: string
          end_at?: string
          notes?: string | null
          status?: 'confirmed' | 'cancelled' | 'no_show' | 'showed'
          linked_contact_id?: string | null
          updated_at?: string
          location_kind?: string | null
          location_data?: Json
          meeting_url?: string | null
          meeting_phone?: string | null
          google_event_id?: string | null
          external_source?: string | null
          external_id?: string | null
          external_updated_at?: string | null
          organizer_user_id?: string | null
          price?: number | null
          currency?: string | null
          external_staff_id?: number | null
          external_staff_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'bookings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_organizer_user_id_fkey'
            columns: ['organizer_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_event_type_id_fkey'
            columns: ['event_type_id']
            isOneToOne: false
            referencedRelation: 'event_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_linked_contact_id_fkey'
            columns: ['linked_contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      email_sections: {
        Row: {
          id: string
          org_id: string
          name: string
          type: string
          html_content: string
          is_global: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          type?: string
          html_content?: string
          is_global?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          type?: string
          html_content?: string
          is_global?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_sections_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      email_template_sections: {
        Row: {
          id: string
          template_id: string
          section_id: string | null
          type: string
          name: string
          html_content: string
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          template_id: string
          section_id?: string | null
          type?: string
          name: string
          html_content?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          template_id?: string
          section_id?: string | null
          type?: string
          name?: string
          html_content?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_template_sections_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'email_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_template_sections_section_id_fkey'
            columns: ['section_id']
            isOneToOne: false
            referencedRelation: 'email_sections'
            referencedColumns: ['id']
          }
        ]
      }
      email_templates: {
        Row: {
          id: string
          org_id: string
          name: string
          subject_line: string
          preview_text: string
          ai_prompt: string | null
          status: string
          tags: string[]
          // block-based builder columns (migration 1097)
          description: string | null
          document: Json
          html_snapshot: string | null
          plain_text_snapshot: string | null
          // folder linkage (migration 1228, Phase 117 / UFE-06)
          folder_id: string | null
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          subject_line?: string
          preview_text?: string
          ai_prompt?: string | null
          status?: string
          tags?: string[]
          description?: string | null
          document?: Json
          html_snapshot?: string | null
          plain_text_snapshot?: string | null
          folder_id?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          subject_line?: string
          preview_text?: string
          ai_prompt?: string | null
          status?: string
          tags?: string[]
          description?: string | null
          document?: Json
          html_snapshot?: string | null
          plain_text_snapshot?: string | null
          folder_id?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_templates_folder_id_fkey'
            columns: ['folder_id']
            isOneToOne: false
            referencedRelation: 'folders'
            referencedColumns: ['id']
          }
        ]
      }
      email_section_templates: {
        Row: {
          id: string
          org_id: string
          name: string
          section_type: string
          document: Json
          folder_id: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          section_type: string
          document?: Json
          folder_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          section_type?: string
          document?: Json
          folder_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reusable_email_blocks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reusable_email_blocks_folder_id_fkey'
            columns: ['folder_id']
            isOneToOne: false
            referencedRelation: 'folders'
            referencedColumns: ['id']
          }
        ]
      }
      email_signatures: {
        Row: {
          id: string
          org_id: string
          name: string
          document: Json
          html_snapshot: string | null
          plain_text_snapshot: string | null
          is_default: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          document?: Json
          html_snapshot?: string | null
          plain_text_snapshot?: string | null
          is_default?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          document?: Json
          html_snapshot?: string | null
          plain_text_snapshot?: string | null
          is_default?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_signatures_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      event_dispatches: {
        Row: {
          id: string
          org_id: string
          event_type: string
          source_table: string
          source_id: string
          workflow_ids: string[]
          payload: Json
          parent_id: string | null
          depth: number
          dispatched_at: string
        }
        Insert: {
          id?: string
          org_id: string
          event_type: string
          source_table: string
          source_id: string
          workflow_ids?: string[]
          payload?: Json
          parent_id?: string | null
          depth?: number
          dispatched_at?: string
        }
        Update: {
          workflow_ids?: string[]
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'event_dispatches_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      scheduled_workflow_ticks: {
        Row: {
          workflow_id: string
          booking_id: string
          event_type: string
          fired_minute: string
          dispatched_at: string
        }
        Insert: {
          workflow_id: string
          booking_id: string
          event_type: string
          fired_minute: string
          dispatched_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'scheduled_workflow_ticks_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scheduled_workflow_ticks_booking_id_fkey'
            columns: ['booking_id']
            isOneToOne: false
            referencedRelation: 'bookings'
            referencedColumns: ['id']
          }
        ]
      }
      calendar_tick_watermark: {
        Row: {
          event_type: string
          scanned_to: string
          updated_at: string
        }
        Insert: {
          event_type: string
          scanned_to?: string
          updated_at?: string
        }
        Update: {
          event_type?: string
          scanned_to?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_types: {
        Row: {
          id: string
          org_id: string
          user_id: string
          title: string
          slug: string
          description: string | null
          duration_minutes: number
          color: string
          location_type: 'video' | 'phone' | 'in_person'
          location_value: string | null
          active: boolean
          allowed_location_kinds: string[]
          default_store_location_id: string | null
          booking_type: 'personal' | 'round_robin'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          title: string
          slug: string
          description?: string | null
          duration_minutes?: number
          color?: string
          location_type?: 'video' | 'phone' | 'in_person'
          location_value?: string | null
          active?: boolean
          allowed_location_kinds?: string[]
          default_store_location_id?: string | null
          booking_type?: 'personal' | 'round_robin'
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          slug?: string
          description?: string | null
          duration_minutes?: number
          color?: string
          location_type?: 'video' | 'phone' | 'in_person'
          location_value?: string | null
          active?: boolean
          allowed_location_kinds?: string[]
          default_store_location_id?: string | null
          booking_type?: 'personal' | 'round_robin'
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_types_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_types_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      calendar_profiles: {
        Row: {
          user_id: string
          org_id: string
          slug: string
          timezone: string
          sync_mode: string
          default_location_type: string
          conflict_calendar_ids: string[]
          look_busy_mode: 'off' | 'hide_percent' | 'max_per_day'
          look_busy_percent: number | null
          look_busy_max_per_day: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          org_id: string
          slug: string
          timezone?: string
          sync_mode?: string
          default_location_type?: string
          conflict_calendar_ids?: string[]
          look_busy_mode?: 'off' | 'hide_percent' | 'max_per_day'
          look_busy_percent?: number | null
          look_busy_max_per_day?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          slug?: string
          timezone?: string
          sync_mode?: string
          default_location_type?: string
          conflict_calendar_ids?: string[]
          look_busy_mode?: 'off' | 'hide_percent' | 'max_per_day'
          look_busy_percent?: number | null
          look_busy_max_per_day?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'scheduling_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scheduling_profiles_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      user_availability: {
        Row: {
          id: string
          org_id: string
          user_id: string
          day_of_week: number
          start_time: string
          end_time: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          day_of_week: number
          start_time: string
          end_time: string
          created_at?: string
        }
        Update: {
          day_of_week?: number
          start_time?: string
          end_time?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_availability_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_availability_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      seo_config: {
        Row: {
          id: string
          site_title: string
          title_template: string
          description: string
          og_image_url: string | null
          keywords: string[]
          updated_at: string
        }
        Insert: {
          id?: string
          site_title?: string
          title_template?: string
          description?: string
          og_image_url?: string | null
          keywords?: string[]
          updated_at?: string
        }
        Update: {
          site_title?: string
          title_template?: string
          description?: string
          og_image_url?: string | null
          keywords?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      landing_config: {
        Row: {
          id: string
          cta_image_url: string | null
          scroll_images: string[]
          updated_at: string
        }
        Insert: {
          id?: string
          cta_image_url?: string | null
          scroll_images?: string[]
          updated_at?: string
        }
        Update: {
          cta_image_url?: string | null
          scroll_images?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          encrypted_value: string
          hint: string | null
          updated_at: string
        }
        Insert: {
          key: string
          encrypted_value: string
          hint?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          encrypted_value?: string
          hint?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_email_settings: {
        Row: {
          id: string
          api_key_encrypted: string | null
          default_from_name: string | null
          default_from_email: string | null
          default_reply_to: string | null
          provider: string
          is_active: boolean
          last_tested_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          api_key_encrypted?: string | null
          default_from_name?: string | null
          default_from_email?: string | null
          default_reply_to?: string | null
          provider?: string
          is_active?: boolean
          last_tested_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          default_from_name?: string | null
          default_from_email?: string | null
          default_reply_to?: string | null
          provider?: string
          is_active?: boolean
          last_tested_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_tracking_config: {
        Row: {
          id: string
          gtm_container_id: string | null
          facebook_pixel_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          gtm_container_id?: string | null
          facebook_pixel_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          gtm_container_id?: string | null
          facebook_pixel_id?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      tenant_email_integrations: {
        Row: {
          id: string
          org_id: string
          api_key_encrypted: string | null
          key_hint: string | null
          default_from_name: string | null
          default_from_email: string | null
          default_reply_to: string | null
          provider: string
          status: 'connected' | 'disconnected' | 'error'
          last_tested_at: string | null
          last_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          api_key_encrypted?: string | null
          key_hint?: string | null
          default_from_name?: string | null
          default_from_email?: string | null
          default_reply_to?: string | null
          provider?: string
          status?: 'connected' | 'disconnected' | 'error'
          last_tested_at?: string | null
          last_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          key_hint?: string | null
          default_from_name?: string | null
          default_from_email?: string | null
          default_reply_to?: string | null
          provider?: string
          status?: 'connected' | 'disconnected' | 'error'
          last_tested_at?: string | null
          last_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_email_integrations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      inbound_email_routes: {
        Row: {
          id: string
          org_id: string
          route_address: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          route_address: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          route_address?: string
          is_active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'inbound_email_routes_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      google_business_profiles: {
        Row: {
          id: string
          org_id: string
          place_id: string
          business_name: string | null
          address: string | null
          serpapi_key_encrypted: string
          scrape_interval_hours: number
          last_scraped_at: string | null
          last_scrape_status: string | null
          last_scrape_error: string | null
          total_reviews_count: number | null
          average_rating: number | null
          is_active: boolean
          widget_token: string
          widget_settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          place_id: string
          business_name?: string | null
          address?: string | null
          serpapi_key_encrypted: string
          scrape_interval_hours?: number
          last_scraped_at?: string | null
          last_scrape_status?: string | null
          last_scrape_error?: string | null
          total_reviews_count?: number | null
          average_rating?: number | null
          is_active?: boolean
          widget_token?: string
          widget_settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          place_id?: string
          business_name?: string | null
          address?: string | null
          serpapi_key_encrypted?: string
          scrape_interval_hours?: number
          last_scraped_at?: string | null
          last_scrape_status?: string | null
          last_scrape_error?: string | null
          total_reviews_count?: number | null
          average_rating?: number | null
          is_active?: boolean
          widget_token?: string
          widget_settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'google_business_profiles_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      google_reviews: {
        Row: {
          id: string
          org_id: string
          profile_id: string
          review_id: string
          reviewer_name: string | null
          reviewer_photo_url: string | null
          reviewer_profile_url: string | null
          rating: number
          text: string | null
          date_text: string | null
          date_iso: string | null
          is_local_guide: boolean
          local_guide_reviews_count: number | null
          helpful_count: number
          owner_response: string | null
          owner_response_date: string | null
          is_removed: boolean
          first_seen_at: string
          last_seen_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          profile_id: string
          review_id: string
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          reviewer_profile_url?: string | null
          rating: number
          text?: string | null
          date_text?: string | null
          date_iso?: string | null
          is_local_guide?: boolean
          local_guide_reviews_count?: number | null
          helpful_count?: number
          owner_response?: string | null
          owner_response_date?: string | null
          is_removed?: boolean
          first_seen_at?: string
          last_seen_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          reviewer_profile_url?: string | null
          rating?: number
          text?: string | null
          date_text?: string | null
          date_iso?: string | null
          is_local_guide?: boolean
          local_guide_reviews_count?: number | null
          helpful_count?: number
          owner_response?: string | null
          owner_response_date?: string | null
          is_removed?: boolean
          last_seen_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'google_reviews_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'google_business_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'google_reviews_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      google_review_photos: {
        Row: {
          id: string
          org_id: string
          review_id: string
          position: number
          original_url: string
          hetzner_url: string | null
          width: number | null
          height: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          review_id: string
          position?: number
          original_url: string
          hetzner_url?: string | null
          width?: number | null
          height?: number | null
          created_at?: string
        }
        Update: {
          position?: number
          original_url?: string
          hetzner_url?: string | null
          width?: number | null
          height?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'google_review_photos_review_id_fkey'
            columns: ['review_id']
            isOneToOne: false
            referencedRelation: 'google_reviews'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'google_review_photos_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      meta_channels: {
        Row: {
          id: string
          org_id: string
          channel_type: MetaChannelType
          page_id: string
          page_name: string | null
          ig_account_id: string | null
          ig_username: string | null
          encrypted_page_access_token: string
          token_expires_at: string | null
          is_active: boolean
          webhook_verified: boolean
          last_synced_at: string | null
          connection_error: string | null
          automation_id: string | null
          config: Json
          created_at: string
          updated_at: string
          // v2.0 (Phase 33, migration 039 | CHAN-06): NULL = legacy tool_config_id dispatch
          agent_id: string | null
          // migration 094: provider abstraction ('direct' | 'manychat')
          provider: string
        }
        Insert: {
          id?: string
          org_id: string
          channel_type: MetaChannelType
          page_id: string
          page_name?: string | null
          ig_account_id?: string | null
          ig_username?: string | null
          encrypted_page_access_token: string
          token_expires_at?: string | null
          is_active?: boolean
          webhook_verified?: boolean
          last_synced_at?: string | null
          connection_error?: string | null
          automation_id?: string | null
          config?: Json
          created_at?: string
          updated_at?: string
          agent_id?: string | null
          provider?: string
        }
        Update: {
          channel_type?: MetaChannelType
          page_name?: string | null
          ig_account_id?: string | null
          ig_username?: string | null
          encrypted_page_access_token?: string
          token_expires_at?: string | null
          is_active?: boolean
          webhook_verified?: boolean
          last_synced_at?: string | null
          connection_error?: string | null
          automation_id?: string | null
          config?: Json
          updated_at?: string
          agent_id?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meta_channels_automation_id_fkey'
            columns: ['automation_id']
            isOneToOne: false
            referencedRelation: '_legacy_tool_configs'
            referencedColumns: ['id']
          }
        ]
      }
      manychat_channels: {
        Row: {
          id: string
          org_id: string
          channel_name: string
          encrypted_api_key: string
          key_hint: string | null
          webhook_secret: string
          is_active: boolean
          config: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id?: string       // set by RLS via get_current_org_id() | do not pass manually
          channel_name: string
          encrypted_api_key: string
          key_hint?: string | null
          webhook_secret: string
          is_active?: boolean
          config?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          channel_name?: string
          encrypted_api_key?: string
          key_hint?: string | null
          webhook_secret?: string
          is_active?: boolean
          config?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      manychat_rules: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          event_type: string
          condition: Json
          tool_config_id: string
          is_active: boolean
          priority: number
          created_at: string
          updated_at: string
          // v2.0 (Phase 33, migration 039 | CHAN-06): NULL = legacy tool_config_id dispatch
          agent_id: string | null
        }
        Insert: {
          id?: string
          org_id?: string       // set by RLS via get_current_org_id() | do not pass manually
          channel_id: string
          event_type: string
          condition?: Json
          tool_config_id: string
          is_active?: boolean
          priority?: number
          created_at?: string
          updated_at?: string
          agent_id?: string | null
        }
        Update: {
          channel_id?: string
          event_type?: string
          condition?: Json
          tool_config_id?: string
          is_active?: boolean
          priority?: number
          updated_at?: string
          agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_rules_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_rules_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'manychat_channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_rules_tool_config_id_fkey'
            columns: ['tool_config_id']
            isOneToOne: false
            referencedRelation: '_legacy_tool_configs'
            referencedColumns: ['id']
          }
        ]
      }
      manychat_events: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          event_type: string
          event_payload: Json
          matched_rule_id: string | null
          status: 'matched' | 'unmatched' | 'error'
          action_log_id: string | null
          // Migration 1249: run that handled the event (action_log_id is legacy-only)
          workflow_run_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          event_type: string
          event_payload: Json
          matched_rule_id?: string | null
          status: 'matched' | 'unmatched' | 'error'
          action_log_id?: string | null
          workflow_run_id?: string | null
          created_at?: string
        }
        Update: {
          // Service-role dispatcher only | authenticated client has no UPDATE policy.
          // Append-only contract enforced at the SQL layer; this widening exists so
          // src/lib/manychat/dispatch-event.ts can flip status + link FKs after match.
          status?: 'matched' | 'unmatched' | 'error'
          action_log_id?: string | null
          workflow_run_id?: string | null
          matched_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'manychat_channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_matched_rule_id_fkey'
            columns: ['matched_rule_id']
            isOneToOne: false
            referencedRelation: 'manychat_rules'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_action_log_id_fkey'
            columns: ['action_log_id']
            isOneToOne: false
            referencedRelation: 'action_logs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_workflow_run_id_fkey'
            columns: ['workflow_run_id']
            isOneToOne: false
            referencedRelation: 'workflow_runs'
            referencedColumns: ['id']
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          org_id: string
          title: string
          description: string | null
          due_date: string | null
          priority: TaskPriority
          status: TaskStatus
          assigned_to: string | null
          entity_type: CrmEntityType | null
          entity_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title: string
          description?: string | null
          due_date?: string | null
          priority?: TaskPriority
          status?: TaskStatus
          assigned_to?: string | null
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          due_date?: string | null
          priority?: TaskPriority
          status?: TaskStatus
          assigned_to?: string | null
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      tenant_locations: {
        Row: {
          id: string
          org_id: string
          name: string
          address_line_1: string
          address_line_2: string | null
          city: string
          state: string | null
          postal_code: string | null
          country: string
          latitude: number | null
          longitude: number | null
          phone: string | null
          business_hours: Json
          notes: string | null
          is_default: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          address_line_1: string
          address_line_2?: string | null
          city: string
          state?: string | null
          postal_code?: string | null
          country?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string | null
          business_hours?: Json
          notes?: string | null
          is_default?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          address_line_1?: string
          address_line_2?: string | null
          city?: string
          state?: string | null
          postal_code?: string | null
          country?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string | null
          business_hours?: Json
          notes?: string | null
          is_default?: boolean
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_locations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      notes: {
        Row: {
          id: string
          org_id: string
          title: string | null
          content: string
          pinned: boolean
          entity_type: CrmEntityType | null
          entity_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title?: string | null
          content: string
          pinned?: boolean
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string | null
          content?: string
          pinned?: boolean
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notes_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          org_id: string
          user_id: string
          type: NotificationType
          payload: Json
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          type: NotificationType
          payload?: Json
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflows: {
        Row: {
          id: string
          org_id: string
          name: string
          slug: string
          description: string | null
          is_active: boolean
          current_version_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          kind: 'flow' | 'tool'
          tool_name: string | null
          trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
          trigger_config: Record<string, unknown>
          health_blocked: boolean
          health_blocked_reason: string | null
          legacy_tool_config_id: string | null
          folder_id: string | null
          position: number
          archived_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          slug: string
          description?: string | null
          is_active?: boolean
          current_version_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          kind?: 'flow' | 'tool'
          tool_name?: string | null
          trigger_type?: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
          trigger_config?: Record<string, unknown>
          health_blocked?: boolean
          health_blocked_reason?: string | null
          legacy_tool_config_id?: string | null
          folder_id?: string | null
          position?: number
          archived_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          slug?: string
          description?: string | null
          is_active?: boolean
          current_version_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          kind?: 'flow' | 'tool'
          tool_name?: string | null
          trigger_type?: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
          trigger_config?: Record<string, unknown>
          health_blocked?: boolean
          health_blocked_reason?: string | null
          legacy_tool_config_id?: string | null
          folder_id?: string | null
          position?: number
          archived_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflows_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflows_current_version_id_fkey'
            columns: ['current_version_id']
            isOneToOne: false
            referencedRelation: 'workflow_versions'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_versions: {
        Row: {
          id: string
          workflow_id: string
          version_number: number
          definition: Record<string, unknown>
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workflow_id: string
          version_number: number
          definition?: Record<string, unknown>
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workflow_id?: string
          version_number?: number
          definition?: Record<string, unknown>
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_versions_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_triggers: {
        Row: {
          id: string
          org_id: string
          workflow_id: string
          event_type: string
          filter: Record<string, unknown>
          schedule_cron: string | null
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workflow_id: string
          event_type: string
          filter?: Record<string, unknown>
          schedule_cron?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          workflow_id?: string
          event_type?: string
          filter?: Record<string, unknown>
          schedule_cron?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      zernio_whatsapp_templates: {
        Row: {
          id: string
          org_id: string
          integration_id: string
          zernio_account_id: string
          name: string
          category: string
          language: string
          status: string
          components: unknown | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          integration_id: string
          zernio_account_id: string
          name: string
          category: string
          language: string
          status?: string
          components?: unknown | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          integration_id?: string
          zernio_account_id?: string
          name?: string
          category?: string
          language?: string
          status?: string
          components?: unknown | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'zernio_whatsapp_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'zernio_whatsapp_templates_integration_id_fkey'
            columns: ['integration_id']
            isOneToOne: false
            referencedRelation: 'integrations'
            referencedColumns: ['id']
          }
        ]
      }
      zernio_webhook_events: {
        Row: {
          id: string
          organization_id: string
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'zernio_webhook_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_runs: {
        Row: {
          id: string
          org_id: string
          workflow_id: string
          workflow_version_id: string | null
          trigger_type: string
          trigger_payload: Record<string, unknown>
          status: string
          state: Record<string, unknown>
          started_at: string | null
          ended_at: string | null
          error: string | null
          created_by: string | null
          created_at: string
          // Migration 1249: run-log for kind='tool' workflow executions
          kind: 'flow' | 'tool'
          tool_name: string | null
          vapi_call_id: string | null
          execution_ms: number | null
        }
        Insert: {
          id?: string
          org_id: string
          workflow_id: string
          workflow_version_id?: string | null
          trigger_type?: string
          trigger_payload?: Record<string, unknown>
          status?: string
          state?: Record<string, unknown>
          started_at?: string | null
          ended_at?: string | null
          error?: string | null
          created_by?: string | null
          created_at?: string
          kind?: 'flow' | 'tool'
          tool_name?: string | null
          vapi_call_id?: string | null
          execution_ms?: number | null
        }
        Update: {
          id?: string
          org_id?: string
          workflow_id?: string
          workflow_version_id?: string | null
          trigger_type?: string
          trigger_payload?: Record<string, unknown>
          status?: string
          state?: Record<string, unknown>
          started_at?: string | null
          ended_at?: string | null
          error?: string | null
          created_by?: string | null
          created_at?: string
          kind?: 'flow' | 'tool'
          tool_name?: string | null
          vapi_call_id?: string | null
          execution_ms?: number | null
        }
        Relationships: []
      }
      // Migration 1249: unified tool-execution log surface.
      // workflow_runs (kind='tool') UNION legacy action_logs, projected into
      // the legacy action_logs shape + workflow_id/source. security_invoker view.
      workflow_tool_logs: {
        Row: {
          id: string
          organization_id: string
          tool_config_id: string | null
          workflow_id: string | null
          vapi_call_id: string
          tool_name: string
          status: 'success' | 'error' | 'timeout'
          execution_ms: number
          request_payload: Json
          response_payload: Json
          error_detail: string | null
          agent_invocation_id: string | null
          trace_id: string | null
          created_at: string
          source: 'run' | 'legacy'
        }
        Insert: never
        Update: never
        Relationships: []
      }
      workflow_authoring_runs: {
        Row: {
          id: string
          org_id: string
          user_id: string | null
          conversation_id: string | null
          outcome: 'created' | 'edited' | 'validation_failed' | 'error'
          workflow_id: string | null
          validation_error_count: number
          error_types: string[]
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id?: string | null
          conversation_id?: string | null
          outcome: 'created' | 'edited' | 'validation_failed' | 'error'
          workflow_id?: string | null
          validation_error_count?: number
          error_types?: string[]
          created_at?: string
        }
        Update: {
          outcome?: 'created' | 'edited' | 'validation_failed' | 'error'
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_authoring_runs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_run_steps: {
        Row: {
          id: string
          run_id: string
          step_id: string
          node_id: string
          node_type: string
          status: string
          input: Record<string, unknown>
          output: Record<string, unknown>
          error: string | null
          started_at: string | null
          ended_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          step_id: string
          node_id: string
          node_type: string
          status?: string
          input?: Record<string, unknown>
          output?: Record<string, unknown>
          error?: string | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          step_id?: string
          node_id?: string
          node_type?: string
          status?: string
          input?: Record<string, unknown>
          output?: Record<string, unknown>
          error?: string | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      workflow_waits: {
        Row: {
          id: string
          run_id: string
          event_filter: Record<string, unknown>
          timeout_at: string | null
          satisfied_at: string | null
          created_at: string
          org_id: string | null
          node_id: string | null
          event_type: string | null
          contact_id: string | null
          timed_out_at: string | null
        }
        Insert: {
          id?: string
          run_id: string
          event_filter?: Record<string, unknown>
          timeout_at?: string | null
          satisfied_at?: string | null
          created_at?: string
          org_id?: string | null
          node_id?: string | null
          event_type?: string | null
          contact_id?: string | null
          timed_out_at?: string | null
        }
        Update: {
          id?: string
          run_id?: string
          event_filter?: Record<string, unknown>
          timeout_at?: string | null
          satisfied_at?: string | null
          created_at?: string
          org_id?: string | null
          node_id?: string | null
          event_type?: string | null
          contact_id?: string | null
          timed_out_at?: string | null
        }
        Relationships: []
      }
      copilot_conversations: {
        Row: {
          id: string
          org_id: string
          title: string
          visibility: string
          started_at: string
          ended_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title?: string
          visibility?: string
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          title?: string
          visibility?: string
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      copilot_messages: {
        Row: {
          id: string
          conversation_id: string
          role: string
          parts: Record<string, unknown>[]
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: string
          parts?: Record<string, unknown>[]
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          role?: string
          parts?: Record<string, unknown>[]
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Relationships: []
      }
      copilot_runs: {
        Row: {
          id: string
          org_id: string
          conversation_id: string
          provider: string
          model: string
          input_tokens: number
          output_tokens: number
          estimated_cost_usd: number
          status: string
          error: string | null
          started_at: string
          ended_at: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          conversation_id: string
          provider: string
          model: string
          input_tokens?: number
          output_tokens?: number
          estimated_cost_usd?: number
          status?: string
          error?: string | null
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          conversation_id?: string
          provider?: string
          model?: string
          input_tokens?: number
          output_tokens?: number
          estimated_cost_usd?: number
          status?: string
          error?: string | null
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      copilot_tool_calls: {
        Row: {
          id: string
          run_id: string
          tool_name: string
          input: Record<string, unknown>
          output: Record<string, unknown> | null
          error: string | null
          status: string
          duration_ms: number
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          tool_name: string
          input?: Record<string, unknown>
          output?: Record<string, unknown> | null
          error?: string | null
          status?: string
          duration_ms?: number
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          tool_name?: string
          input?: Record<string, unknown>
          output?: Record<string, unknown> | null
          error?: string | null
          status?: string
          duration_ms?: number
          created_at?: string
        }
        Relationships: []
      }
      whatsapp_providers: {
        Row: {
          id: string
          org_id: string
          provider: 'evolution' | 'zapi' | 'wapi'
          display_name: string
          phone_number: string | null
          status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'error'
          is_active: boolean
          config_encrypted: string
          webhook_secret_encrypted: string | null
          last_error: string | null
          connected_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider: 'evolution' | 'zapi' | 'wapi'
          display_name?: string
          phone_number?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'error'
          is_active?: boolean
          config_encrypted: string
          webhook_secret_encrypted?: string | null
          last_error?: string | null
          connected_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string
          phone_number?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'error'
          is_active?: boolean
          config_encrypted?: string
          webhook_secret_encrypted?: string | null
          last_error?: string | null
          connected_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_providers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      whatsapp_cloud_accounts: {
        Row: {
          id: string
          org_id: string
          display_name: string
          waba_id: string
          phone_number_id: string
          phone_number_e164: string | null
          access_token_encrypted: string
          app_secret_encrypted: string | null
          webhook_verify_token_encrypted: string | null
          status: 'connected' | 'disconnected' | 'error'
          is_active: boolean
          last_synced_at: string | null
          last_error: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          display_name: string
          waba_id: string
          phone_number_id: string
          phone_number_e164?: string | null
          access_token_encrypted: string
          app_secret_encrypted?: string | null
          webhook_verify_token_encrypted?: string | null
          status?: 'connected' | 'disconnected' | 'error'
          is_active?: boolean
          last_synced_at?: string | null
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string
          waba_id?: string
          phone_number_id?: string
          phone_number_e164?: string | null
          access_token_encrypted?: string
          app_secret_encrypted?: string | null
          webhook_verify_token_encrypted?: string | null
          status?: 'connected' | 'disconnected' | 'error'
          is_active?: boolean
          last_synced_at?: string | null
          last_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_cloud_accounts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      whatsapp_templates: {
        Row: {
          id: string
          org_id: string
          cloud_account_id: string
          meta_template_id: string
          name: string
          language: string
          category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
          status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
          components: Json
          body_variable_count: number
          header_variable_count: number
          synced_at: string
        }
        Insert: {
          id?: string
          org_id: string
          cloud_account_id: string
          meta_template_id: string
          name: string
          language: string
          category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
          status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
          components: Json
          body_variable_count?: number
          header_variable_count?: number
          synced_at?: string
        }
        Update: {
          meta_template_id?: string
          name?: string
          language?: string
          category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
          status?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
          components?: Json
          body_variable_count?: number
          header_variable_count?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_templates_cloud_account_id_fkey'
            columns: ['cloud_account_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_cloud_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      integration_health_checks: {
        Row: {
          id: string
          integration_id: string
          organization_id: string
          status: 'connected' | 'degraded' | 'disconnected'
          latency_ms: number | null
          error: string | null
          checked_at: string
        }
        Insert: {
          id?: string
          integration_id: string
          organization_id: string
          status: 'connected' | 'degraded' | 'disconnected'
          latency_ms?: number | null
          error?: string | null
          checked_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'integration_health_checks_integration_id_fkey'
            columns: ['integration_id']
            isOneToOne: false
            referencedRelation: 'integrations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'integration_health_checks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          user_id: string
          read_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          read_at?: string
        }
        Update: {
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_reads_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_labels: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string
          position?: number
          created_at?: string
        }
        Update: {
          name?: string
          color?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_labels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_label_assignments: {
        Row: {
          conversation_id: string
          label_id: string
          created_at: string
        }
        Insert: {
          conversation_id: string
          label_id: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'conversation_label_assignments_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversation_label_assignments_label_id_fkey'
            columns: ['label_id']
            isOneToOne: false
            referencedRelation: 'conversation_labels'
            referencedColumns: ['id']
          }
        ]
      }
      folders: {
        Row: {
          id: string
          org_id: string
          entity_type: string
          name: string
          color: string | null
          icon: string | null
          parent_id: string | null
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          entity_type: string
          name: string
          color?: string | null
          icon?: string | null
          parent_id?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          entity_type?: string
          name?: string
          color?: string | null
          icon?: string | null
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'folders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'folders_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'folders'
            referencedColumns: ['id']
          }
        ]
      }
      message_templates: {
        Row: {
          id: string
          org_id: string
          name: string
          body: string
          channel_overrides: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          body?: string
          channel_overrides?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          body?: string
          channel_overrides?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'message_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_folders: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string | null
          icon: string | null
          parent_id: string | null
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string | null
          icon?: string | null
          parent_id?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          color?: string | null
          icon?: string | null
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_folders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      scheduled_opportunity_ticks: {
        Row: {
          id: string
          org_id: string
          workflow_id: string
          opportunity_id: string
          event_type: string
          fire_at: string
          fired: boolean
          fired_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workflow_id: string
          opportunity_id: string
          event_type: string
          fire_at: string
          fired?: boolean
          fired_at?: string | null
          created_at?: string
        }
        Update: {
          fired?: boolean
          fired_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'scheduled_opportunity_ticks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scheduled_opportunity_ticks_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          }
        ]
      }
      telegram_bots: {
        Row: {
          id: string
          org_id: string
          bot_token_encrypted: string
          bot_username: string | null
          bot_name: string | null
          notification_chat_ids: string[]
          automation_enabled: boolean
          agent_id: string | null
          is_active: boolean
          webhook_set: boolean
          last_error: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          bot_token_encrypted: string
          bot_username?: string | null
          bot_name?: string | null
          notification_chat_ids?: string[]
          automation_enabled?: boolean
          agent_id?: string | null
          is_active?: boolean
          webhook_set?: boolean
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          bot_token_encrypted?: string
          bot_username?: string | null
          bot_name?: string | null
          notification_chat_ids?: string[]
          automation_enabled?: boolean
          agent_id?: string | null
          is_active?: boolean
          webhook_set?: boolean
          last_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'telegram_bots_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'telegram_bots_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      // ─── Analytics Module (migration 1046) ──────────────────────────────────
      analytics_setups: {
        Row: {
          id: string
          organization_id: string
          script_token: string
          primary_website_url: string | null
          verification_state: 'not_started' | 'pending' | 'verified' | 'failed' | 'no_events_yet'
          verified_at: string | null
          gtm_container_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          script_token?: string
          primary_website_url?: string | null
          verification_state?: 'not_started' | 'pending' | 'verified' | 'failed' | 'no_events_yet'
          verified_at?: string | null
          gtm_container_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          primary_website_url?: string | null
          verification_state?: 'not_started' | 'pending' | 'verified' | 'failed' | 'no_events_yet'
          verified_at?: string | null
          gtm_container_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      analytics_visitors: {
        Row: {
          id: string
          organization_id: string
          visitor_key: string
          first_seen_at: string
          last_seen_at: string
          session_count: number
          page_view_count: number
          is_identified: boolean
          contact_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          visitor_key: string
          first_seen_at?: string
          last_seen_at?: string
          session_count?: number
          page_view_count?: number
          is_identified?: boolean
          contact_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          last_seen_at?: string
          session_count?: number
          page_view_count?: number
          is_identified?: boolean
          contact_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      analytics_sessions: {
        Row: {
          id: string
          organization_id: string
          visitor_id: string
          session_key: string
          started_at: string
          ended_at: string | null
          page_view_count: number
          duration_seconds: number | null
          landing_page: string | null
          exit_page: string | null
          referrer: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_term: string | null
          utm_content: string | null
          country_code: string | null
          country_name: string | null
          city: string | null
          device_type: 'desktop' | 'mobile' | 'tablet' | 'unknown' | null
          browser: string | null
          os: string | null
          is_converted: boolean
          fbc: string | null
          fbp: string | null
          fbclid: string | null
          client_ip_address: string | null
          client_user_agent: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          visitor_id: string
          session_key: string
          started_at?: string
          ended_at?: string | null
          page_view_count?: number
          duration_seconds?: number | null
          landing_page?: string | null
          exit_page?: string | null
          referrer?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          country_code?: string | null
          country_name?: string | null
          city?: string | null
          device_type?: 'desktop' | 'mobile' | 'tablet' | 'unknown' | null
          browser?: string | null
          os?: string | null
          is_converted?: boolean
          fbc?: string | null
          fbp?: string | null
          fbclid?: string | null
          client_ip_address?: string | null
          client_user_agent?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          ended_at?: string | null
          page_view_count?: number
          duration_seconds?: number | null
          exit_page?: string | null
          is_converted?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      analytics_pageviews: {
        Row: {
          id: string
          organization_id: string
          session_id: string
          visitor_id: string
          url: string
          path: string
          title: string | null
          referrer: string | null
          duration_seconds: number | null
          occurred_at: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          session_id: string
          visitor_id: string
          url: string
          path: string
          title?: string | null
          referrer?: string | null
          duration_seconds?: number | null
          occurred_at?: string
          created_at?: string
        }
        Update: {
          duration_seconds?: number | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          id: string
          organization_id: string
          session_id: string | null
          visitor_id: string | null
          event_type: 'form_submit' | 'phone_click' | 'sms_click' | 'call_started' | 'chat_started' | 'booking_started' | 'booking_completed' | 'contact_created' | 'opportunity_created' | 'deal_won' | 'custom_conversion'
          event_name: string | null
          url: string | null
          metadata: Json
          contact_id: string | null
          opportunity_id: string | null
          occurred_at: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          session_id?: string | null
          visitor_id?: string | null
          event_type: 'form_submit' | 'phone_click' | 'sms_click' | 'call_started' | 'chat_started' | 'booking_started' | 'booking_completed' | 'contact_created' | 'opportunity_created' | 'deal_won' | 'custom_conversion'
          event_name?: string | null
          url?: string | null
          metadata?: Json
          contact_id?: string | null
          opportunity_id?: string | null
          occurred_at?: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      analytics_attributions: {
        Row: {
          id: string
          organization_id: string
          visitor_id: string
          touch_type: 'first' | 'last'
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_term: string | null
          utm_content: string | null
          landing_page: string | null
          referrer: string | null
          session_id: string | null
          occurred_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          visitor_id: string
          touch_type: 'first' | 'last'
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          landing_page?: string | null
          referrer?: string | null
          session_id?: string | null
          occurred_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          landing_page?: string | null
          referrer?: string | null
          session_id?: string | null
          occurred_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      // Migration 1068 — AI Logs and Observability System
      event_logs: {
        Row: {
          id: string
          org_id: string | null
          event_type: string
          source: string
          severity: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
          status: 'ok' | 'failed' | 'retried' | 'skipped'
          correlation_id: string | null
          actor_type: string | null
          actor_id: string | null
          payload: Json
          error_message: string | null
          error_stack: string | null
          duration_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          event_type: string
          source: string
          severity?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
          status?: 'ok' | 'failed' | 'retried' | 'skipped'
          correlation_id?: string | null
          actor_type?: string | null
          actor_id?: string | null
          payload?: Json
          error_message?: string | null
          error_stack?: string | null
          duration_ms?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          event_type?: string
          source?: string
          severity?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
          status?: 'ok' | 'failed' | 'retried' | 'skipped'
          correlation_id?: string | null
          actor_type?: string | null
          actor_id?: string | null
          payload?: Json
          error_message?: string | null
          error_stack?: string | null
          duration_ms?: number | null
          created_at?: string
        }
        Relationships: []
      }
      ads_connections: {
        Row: {
          ad_account_id: string
          ad_account_name: string | null
          ad_objective: string
          connection_error: string | null
          created_at: string
          encrypted_access_token: string
          id: string
          meta_app_scoped_user_id: string | null
          org_id: string
          platform: string
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          ad_account_name?: string | null
          ad_objective?: string
          connection_error?: string | null
          created_at?: string
          encrypted_access_token: string
          id?: string
          meta_app_scoped_user_id?: string | null
          org_id: string
          platform: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          ad_account_name?: string | null
          ad_objective?: string
          connection_error?: string | null
          created_at?: string
          encrypted_access_token?: string
          id?: string
          meta_app_scoped_user_id?: string | null
          org_id?: string
          platform?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_executions: {
        Row: {
          after_value: string | null
          before_value: string | null
          campaign_id: string | null
          campaign_name: string | null
          created_at: string
          description: string | null
          executed_at: string
          executed_by_ai: boolean
          id: string
          journey_id: string
          org_id: string
          plan_id: string | null
          platform: string | null
          title: string
          type: string
        }
        Insert: {
          after_value?: string | null
          before_value?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          description?: string | null
          executed_at?: string
          executed_by_ai?: boolean
          id?: string
          journey_id: string
          org_id: string
          plan_id?: string | null
          platform?: string | null
          title: string
          type: string
        }
        Update: {
          after_value?: string | null
          before_value?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          description?: string | null
          executed_at?: string
          executed_by_ai?: boolean
          id?: string
          journey_id?: string
          org_id?: string
          plan_id?: string | null
          platform?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_executions_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "ads_journey"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_executions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_executions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ads_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_journey: {
        Row: {
          created_at: string
          current_phase: string | null
          id: string
          org_id: string
          started_at: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_phase?: string | null
          id?: string
          org_id: string
          started_at?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_phase?: string | null
          id?: string
          org_id?: string
          started_at?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_journey_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_memories: {
        Row: {
          campaign_id: string | null
          campaign_name: string | null
          confidence: number
          content: string
          created_at: string
          id: string
          journey_id: string
          metadata: Json
          org_id: string
          platform: string | null
          proposed: boolean
          source: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_name?: string | null
          confidence?: number
          content: string
          created_at?: string
          id?: string
          journey_id: string
          metadata?: Json
          org_id: string
          platform?: string | null
          proposed?: boolean
          source: string
          status?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          campaign_name?: string | null
          confidence?: number
          content?: string
          created_at?: string
          id?: string
          journey_id?: string
          metadata?: Json
          org_id?: string
          platform?: string | null
          proposed?: boolean
          source?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_memories_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "ads_journey"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_memories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_audience_config: {
        Row: {
          id: string
          org_id: string
          meta_business_id: string | null
          meta_ad_account_id: string
          ads_connection_id: string | null
          custom_audience_id: string | null
          audience_name: string | null
          audience_kind: 'xcraper_master' | 'prospect_segment'
          source_definition: Json
          sync_enabled: boolean
          terms_accepted_at: string | null
          terms_accepted_by: string | null
          consent_basis: 'USER_PROVIDED_ONLY' | 'PARTNER_PROVIDED_ONLY' | 'BOTH_USER_AND_PARTNER_PROVIDED'
          operational_status: 'draft' | 'ready' | 'dirty' | 'syncing' | 'synced' | 'paused' | 'misconfigured' | 'error'
          dirty_at: string | null
          dirty_reason: string | null
          next_sync_at: string | null
          sync_claim_id: string | null
          sync_claimed_at: string | null
          last_synced_at: string | null
          last_sync_stats: { sent?: number; removed?: number; error_count?: number } | null
          last_error_code: string | null
          last_error_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          meta_business_id?: string | null
          meta_ad_account_id: string
          ads_connection_id?: string | null
          custom_audience_id?: string | null
          audience_name?: string | null
          audience_kind?: 'xcraper_master' | 'prospect_segment'
          source_definition?: Json
          sync_enabled?: boolean
          terms_accepted_at?: string | null
          terms_accepted_by?: string | null
          consent_basis?: 'USER_PROVIDED_ONLY' | 'PARTNER_PROVIDED_ONLY' | 'BOTH_USER_AND_PARTNER_PROVIDED'
          operational_status?: 'draft' | 'ready' | 'dirty' | 'syncing' | 'synced' | 'paused' | 'misconfigured' | 'error'
          dirty_at?: string | null
          dirty_reason?: string | null
          next_sync_at?: string | null
          sync_claim_id?: string | null
          sync_claimed_at?: string | null
          last_synced_at?: string | null
          last_sync_stats?: { sent?: number; removed?: number; error_count?: number } | null
          last_error_code?: string | null
          last_error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          meta_business_id?: string | null
          meta_ad_account_id?: string
          ads_connection_id?: string | null
          custom_audience_id?: string | null
          audience_name?: string | null
          audience_kind?: 'xcraper_master' | 'prospect_segment'
          source_definition?: Json
          sync_enabled?: boolean
          terms_accepted_at?: string | null
          terms_accepted_by?: string | null
          consent_basis?: 'USER_PROVIDED_ONLY' | 'PARTNER_PROVIDED_ONLY' | 'BOTH_USER_AND_PARTNER_PROVIDED'
          operational_status?: 'draft' | 'ready' | 'dirty' | 'syncing' | 'synced' | 'paused' | 'misconfigured' | 'error'
          dirty_at?: string | null
          dirty_reason?: string | null
          next_sync_at?: string | null
          sync_claim_id?: string | null
          sync_claimed_at?: string | null
          last_synced_at?: string | null
          last_sync_stats?: { sent?: number; removed?: number; error_count?: number } | null
          last_error_code?: string | null
          last_error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_audience_config_ads_connection_id_fkey'
            columns: ['ads_connection_id']
            isOneToOne: false
            referencedRelation: 'ads_connections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meta_audience_config_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      meta_audience_memberships: {
        Row: {
          id: string
          org_id: string
          audience_config_id: string
          entity_type: 'contact' | 'account'
          entity_id: string
          submitted_email_hash: string | null
          submitted_phone_hash: string | null
          eligibility_fingerprint: string
          last_synced_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          audience_config_id: string
          entity_type: 'contact' | 'account'
          entity_id: string
          submitted_email_hash?: string | null
          submitted_phone_hash?: string | null
          eligibility_fingerprint: string
          last_synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          audience_config_id?: string
          entity_type?: 'contact' | 'account'
          entity_id?: string
          submitted_email_hash?: string | null
          submitted_phone_hash?: string | null
          eligibility_fingerprint?: string
          last_synced_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_audience_memberships_config_fkey'
            columns: ['org_id', 'audience_config_id']
            isOneToOne: false
            referencedRelation: 'meta_audience_config'
            referencedColumns: ['org_id', 'id']
          },
          {
            foreignKeyName: 'meta_audience_memberships_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      meta_audience_sync_runs: {
        Row: {
          id: string
          org_id: string
          audience_config_id: string
          trigger_source: 'manual' | 'scheduled' | 'ingestion' | 'retry'
          dry_run: boolean
          status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
          claim_id: string
          target_count: number
          add_count: number
          remove_count: number
          unchanged_count: number
          invalid_count: number
          suppressed_count: number
          retry_count: number
          next_retry_at: string | null
          error_code: string | null
          error_message: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          audience_config_id: string
          trigger_source?: 'manual' | 'scheduled' | 'ingestion' | 'retry'
          dry_run?: boolean
          status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
          claim_id?: string
          target_count?: number
          add_count?: number
          remove_count?: number
          unchanged_count?: number
          invalid_count?: number
          suppressed_count?: number
          retry_count?: number
          next_retry_at?: string | null
          error_code?: string | null
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          audience_config_id?: string
          trigger_source?: 'manual' | 'scheduled' | 'ingestion' | 'retry'
          dry_run?: boolean
          status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
          claim_id?: string
          target_count?: number
          add_count?: number
          remove_count?: number
          unchanged_count?: number
          invalid_count?: number
          suppressed_count?: number
          retry_count?: number
          next_retry_at?: string | null
          error_code?: string | null
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_audience_sync_runs_config_fkey'
            columns: ['org_id', 'audience_config_id']
            isOneToOne: false
            referencedRelation: 'meta_audience_config'
            referencedColumns: ['org_id', 'id']
          },
          {
            foreignKeyName: 'meta_audience_sync_runs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      meta_capi_config: {
        Row: {
          id: string
          org_id: string
          meta_ad_account_id: string | null
          dataset_id: string | null
          pixel_id: string | null
          encrypted_capi_token: string | null
          test_event_code: string | null
          enabled: boolean
          browser_pixel_enabled: boolean
          default_currency: string
          event_map: Record<string, { enabled?: boolean; stage_name?: string; value_source?: string }>
          last_status: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          meta_ad_account_id?: string | null
          dataset_id?: string | null
          pixel_id?: string | null
          encrypted_capi_token?: string | null
          test_event_code?: string | null
          enabled?: boolean
          browser_pixel_enabled?: boolean
          default_currency?: string
          event_map?: Record<string, { enabled?: boolean; stage_name?: string; value_source?: string }>
          last_status?: Record<string, unknown> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          meta_ad_account_id?: string | null
          dataset_id?: string | null
          pixel_id?: string | null
          encrypted_capi_token?: string | null
          test_event_code?: string | null
          enabled?: boolean
          browser_pixel_enabled?: boolean
          default_currency?: string
          event_map?: Record<string, { enabled?: boolean; stage_name?: string; value_source?: string }>
          last_status?: Record<string, unknown> | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_capi_config_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      meta_capi_events: {
        Row: {
          id: string
          org_id: string
          event_name: string
          event_id: string
          event_time: string
          action_source: string
          source_table: string | null
          source_id: string | null
          payload: Record<string, unknown>
          status: 'pending' | 'sent' | 'failed' | 'dead'
          attempts: number
          next_attempt_at: string
          last_error: string | null
          fb_trace_id: string | null
          sent_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          event_name: string
          event_id: string
          event_time?: string
          action_source?: string
          source_table?: string | null
          source_id?: string | null
          payload: Record<string, unknown>
          status?: 'pending' | 'sent' | 'failed' | 'dead'
          attempts?: number
          next_attempt_at?: string
          last_error?: string | null
          fb_trace_id?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          event_time?: string
          action_source?: string
          payload?: Record<string, unknown>
          status?: 'pending' | 'sent' | 'failed' | 'dead'
          attempts?: number
          next_attempt_at?: string
          last_error?: string | null
          fb_trace_id?: string | null
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_capi_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      debit_copilot_credits: {
        Args: { p_org_id: string; p_amount_usd: number; p_run_id?: string | null; p_reason?: string | null }
        Returns: Json
      }
      credit_copilot_credits: {
        Args: {
          p_org_id: string
          p_amount_usd: number
          p_kind: string
          p_ref?: string | null
          p_note?: string | null
        }
        Returns: number
      }
      reset_copilot_credits: {
        Args: { p_org_id: string; p_included_usd: number; p_period_end?: string | null }
        Returns: number
      }
      transition_booking_status: {
        Args: {
          p_booking_id: string
          p_org_id: string
          p_new_status: string
          p_allowed_from: string[]
        }
        Returns: Json
      }
      get_ads_attribution: {
        Args: { p_from: string; p_platform?: string; p_to: string }
        Returns: {
          identified_contacts: number
          opportunities: number
          revenue: number
          sessions: number
          utm_campaign: string
          utm_medium: string
          utm_source: string
        }[]
      }
      _is_cluster_fully_excluded: {
        Args: {
          p_org_id: string
          p_contact_ids: string[]
        }
        Returns: boolean
      }
      get_current_org_id: {
        Args: Record<string, never>
        Returns: string | null
      }
      inbox_entries: {
        Args: {
          p_user: string
          p_status?: string | null
          p_assigned?: string | null
          p_channels?: string[] | null
          p_starred?: boolean
          p_verified?: boolean
          p_priority?: string | null
          p_bot_status?: string | null
          p_phone_number_id?: string | null
          p_pinned?: boolean | null
          p_limit?: number
          p_offset?: number
        }
        Returns: Array<{
          representative_conversation_id: string
          contact_id: string | null
          representative_channel: string | null
          channels: string[] | null
          pinned: boolean
          activity_at: string | null
          is_unread: boolean
        }>
      }
      inbox_unread_count: {
        Args: Record<string, never>
        Returns: number
      }
      inbox_entries_count: {
        Args: {
          p_user: string
          p_status?: string | null
          p_assigned?: string | null
          p_channels?: string[] | null
          p_starred?: boolean
          p_verified?: boolean
          p_priority?: string | null
          p_bot_status?: string | null
          p_phone_number_id?: string | null
          p_pinned?: boolean | null
        }
        Returns: number
      }
      merge_contacts: {
        Args: {
          survivor_id: string
          archived_id: string
        }
        Returns: undefined
      }
      refresh_contact_duplicate_audit: {
        Args: Record<string, never>
        Returns: undefined
      }
      get_org_member_profiles: {
        Args: {
          p_org_id: string
          p_page?: number
          p_per_page?: number
        }
        Returns: Array<{
          id: string
          user_id: string
          role: string
          joined_at: string
          email: string | null
          phone: string | null
          full_name: string | null
          total_count: number
        }>
      }
      activate_global_knowledge_revision: {
        Args: {
          p_source_id: string
          p_revision_id: string
          p_content_hash: string
          p_chunk_count: number
          p_external_last_edited_at?: string | null
        }
        Returns: undefined
      }
      broadcast_global_knowledge_webhook_verification: {
        Args: {
          p_verification_token: string
        }
        Returns: undefined
      }
      claim_global_knowledge_sync_job: {
        Args: Record<string, never>
        Returns: Array<Database['public']['Tables']['global_knowledge_sync_jobs']['Row']>
      }
      complete_global_knowledge_root_sync: {
        Args: {
          p_root_id: string
          p_seen_external_ids: string[]
        }
        Returns: undefined
      }
      match_global_knowledge: {
        Args: {
          query_embedding: number[]
          platform_filter?: string | null
          match_count?: number
        }
        Returns: Array<{
          id: number
          content: string
          metadata: Json
          similarity: number
        }>
      }
      match_documents: {
        Args: {
          query_embedding: number[]
          filter?: Json
        }
        Returns: Array<{
          id: number
          content: string
          metadata: Json
          similarity: number
        }>
      }
    }
    Enums: {
      user_role: UserRole
      action_type: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_whatsapp_template' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note' | 'send_tenant_email' | 'send_platform_email' | 'xkedule_get_services' | 'xkedule_check_availability' | 'xkedule_create_booking' | 'xkedule_cancel_booking' | 'xkedule_reschedule_booking' | 'xkedule_quote' | 'xkedule_lookup_customer' | 'xkedule_business_info' | 'send_zernio_dm' | 'medusa_search_products' | 'medusa_get_product' | 'medusa_get_cart' | 'medusa_add_to_cart' | 'medusa_update_cart_item' | 'medusa_wishlist_add' | 'medusa_wishlist_remove' | 'medusa_wishlist_list' | 'medusa_get_order_status'
      integration_provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram' | 'resend' | 'zernio' | 'xkedule' | 'medusa'
      // v2.0 (Phase 33) | agent runtime enums (migrations 034, 037)
      agent_channel: AgentChannel
      agent_invocation_status: AgentInvocationStatus
      agent_invocation_mode: AgentInvocationMode
      // Q7 — Project 2: quality feedback signal enum (migration 1162)
      agent_feedback_signal: 'thumbs_up' | 'thumbs_down' | 'handoff' | 'idk'
      // v2.5 � tasks & notes enums
      task_priority: TaskPriority
      task_status: TaskStatus
      crm_entity_type: CrmEntityType
    }
  }
}
