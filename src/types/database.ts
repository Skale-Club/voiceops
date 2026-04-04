// Database type definitions for VoiceOps
// Auto-generated shape — replace with Supabase CLI output after applying migrations:
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

export type UserRole = 'admin' | 'member'

export type CampaignStatus = 'draft' | 'scheduled' | 'in_progress' | 'paused' | 'completed' | 'stopped'
export type CampaignContactStatus = 'pending' | 'calling' | 'completed' | 'failed' | 'no_answer'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      org_members: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          role: UserRole
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          role?: UserRole
          created_at?: string
        }
        Update: {
          role?: UserRole
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
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi'
          name: string
          encrypted_api_key: string
          key_hint: string | null
          location_id: string | null
          config: Json
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi'
          name: string
          encrypted_api_key: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          encrypted_api_key?: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          updated_at?: string
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
      tool_configs: {
        Row: {
          id: string
          organization_id: string
          integration_id: string
          tool_name: string
          action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook'
          config: Json
          fallback_message: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          integration_id: string
          tool_name: string
          action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook'
          config?: Json
          fallback_message: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          integration_id?: string
          tool_name?: string
          action_type?: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook'
          config?: Json
          fallback_message?: string
          is_active?: boolean
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
            referencedRelation: 'tool_configs'
            referencedColumns: ['id']
          }
        ]
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
      campaigns: {
        Row: {
          id: string
          organization_id: string
          name: string
          vapi_assistant_id: string
          vapi_phone_number_id: string
          vapi_campaign_id: string | null
          status: CampaignStatus
          scheduled_start_at: string | null
          calls_per_minute: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          vapi_assistant_id: string
          vapi_phone_number_id: string
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          calls_per_minute?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          calls_per_minute?: number
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
    }
    Views: Record<string, never>
    Functions: {
      get_current_org_id: {
        Args: Record<string, never>
        Returns: string | null
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
      action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook'
      integration_provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi'
    }
  }
}
