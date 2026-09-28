export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      abuse_signals: {
        Row: {
          created_at: string
          device_hash: string | null
          id: string
          ip: unknown
          signal_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash?: string | null
          id?: string
          ip?: unknown
          signal_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string | null
          id?: string
          ip?: unknown
          signal_type?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          provenance: string
          role: string
          tool_calls: Json
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          provenance?: string
          role: string
          tool_calls?: Json
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          provenance?: string
          role?: string
          tool_calls?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_snapshots: {
        Row: {
          channel_id: string | null
          created_at: string
          deltas: Json
          id: string
          metrics: Json
          revenue_basis: string
          revenue_usd: number | null
          snapshot_date: string
          source: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          deltas?: Json
          id?: string
          metrics?: Json
          revenue_basis?: string
          revenue_usd?: number | null
          snapshot_date?: string
          source?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          deltas?: Json
          id?: string
          metrics?: Json
          revenue_basis?: string
          revenue_usd?: number | null
          snapshot_date?: string
          source?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_snapshots_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          rate_limit_per_min: number
          revoked_at: string | null
          scopes: string[]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          rate_limit_per_min?: number
          revoked_at?: string | null
          scopes?: string[]
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          rate_limit_per_min?: number
          revoked_at?: string | null
          scopes?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          created_at: string
          estimated_cost: number
          id: string
          meta: Json
          operation: string
          project_id: string | null
          provider: string
          units: number
          user_id: string
        }
        Insert: {
          created_at?: string
          estimated_cost?: number
          id?: string
          meta?: Json
          operation: string
          project_id?: string | null
          provider: string
          units?: number
          user_id: string
        }
        Update: {
          created_at?: string
          estimated_cost?: number
          id?: string
          meta?: Json
          operation?: string
          project_id?: string | null
          provider?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          approved_at: string
          approver_id: string
          created_at: string
          id: string
          notes: string | null
          project_id: string
          publish_job_id: string | null
          scope: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          approved_at?: string
          approver_id: string
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          publish_job_id?: string | null
          scope: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          approved_at?: string
          approver_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          publish_job_id?: string | null
          scope?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: false
            referencedRelation: "publish_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "video_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_provenance: {
        Row: {
          asset_url: string | null
          cost_credits: number | null
          created_at: string
          id: string
          kind: string | null
          license: string
          license_url: string | null
          model: string | null
          project_id: string | null
          prompt: string | null
          provider: string
          scene_id: string | null
          seed: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          asset_url?: string | null
          cost_credits?: number | null
          created_at?: string
          id?: string
          kind?: string | null
          license?: string
          license_url?: string | null
          model?: string | null
          project_id?: string | null
          prompt?: string | null
          provider?: string
          scene_id?: string | null
          seed?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          asset_url?: string | null
          cost_credits?: number | null
          created_at?: string
          id?: string
          kind?: string | null
          license?: string
          license_url?: string | null
          model?: string | null
          project_id?: string | null
          prompt?: string | null
          provider?: string
          scene_id?: string | null
          seed?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          workspace_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          workspace_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          payload: Json | null
          processed_at: string | null
          provider: string | null
          type: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          provider?: string | null
          type?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          provider?: string | null
          type?: string | null
        }
        Relationships: []
      }
      brand_assets: {
        Row: {
          bytes: number | null
          content_asset_id: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          kind: string
          name: string
          storage_bucket: string
          storage_path: string
          workspace_id: string
        }
        Insert: {
          bytes?: number | null
          content_asset_id?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          kind: string
          name: string
          storage_bucket?: string
          storage_path: string
          workspace_id: string
        }
        Update: {
          bytes?: number | null
          content_asset_id?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          kind?: string
          name?: string
          storage_bucket?: string
          storage_path?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_assets_content_asset_id_fkey"
            columns: ["content_asset_id"]
            isOneToOne: false
            referencedRelation: "content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kits: {
        Row: {
          created_at: string
          font_family: string
          id: string
          logo_path: string | null
          primary_color: string
          secondary_color: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          font_family?: string
          id?: string
          logo_path?: string | null
          primary_color?: string
          secondary_color?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          font_family?: string
          id?: string
          logo_path?: string | null
          primary_color?: string
          secondary_color?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_kits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          created_at: string
          do_list: string[]
          dont_list: string[]
          id: string
          name: string
          persona: string
          sample_text: string
          tone: string
          updated_at: string
          user_id: string
          vocabulary: Json
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          do_list?: string[]
          dont_list?: string[]
          id?: string
          name: string
          persona?: string
          sample_text?: string
          tone?: string
          updated_at?: string
          user_id: string
          vocabulary?: Json
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          do_list?: string[]
          dont_list?: string[]
          id?: string
          name?: string
          persona?: string
          sample_text?: string
          tone?: string
          updated_at?: string
          user_id?: string
          vocabulary?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      captions: {
        Row: {
          created_at: string
          cues: Json
          id: string
          project_id: string
          scene_id: string | null
          style: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cues?: Json
          id?: string
          project_id: string
          scene_id?: string | null
          style?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cues?: Json
          id?: string
          project_id?: string
          scene_id?: string | null
          style?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "captions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          group_name: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_name: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          group_name?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      channel_connections: {
        Row: {
          created_at: string
          display_name: string | null
          external_channel_id: string
          health: Json
          id: string
          last_sync_at: string | null
          meta_connection_id: string | null
          platform: string
          quota: Json
          status: string
          updated_at: string
          user_id: string
          workspace_id: string | null
          youtube_connection_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          external_channel_id: string
          health?: Json
          id?: string
          last_sync_at?: string | null
          meta_connection_id?: string | null
          platform: string
          quota?: Json
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
          youtube_connection_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          external_channel_id?: string
          health?: Json
          id?: string
          last_sync_at?: string | null
          meta_connection_id?: string | null
          platform?: string
          quota?: Json
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
          youtube_connection_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_connections_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_connections_youtube_connection_id_fkey"
            columns: ["youtube_connection_id"]
            isOneToOne: false
            referencedRelation: "youtube_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_snapshots: {
        Row: {
          captured_at: string
          channel_id: string
          id: string
          metrics: Json
          subscriber_count: number | null
          user_id: string
          video_count: number | null
          view_count: number | null
        }
        Insert: {
          captured_at?: string
          channel_id: string
          id?: string
          metrics?: Json
          subscriber_count?: number | null
          user_id: string
          video_count?: number | null
          view_count?: number | null
        }
        Update: {
          captured_at?: string
          channel_id?: string
          id?: string
          metrics?: Json
          subscriber_count?: number | null
          user_id?: string
          video_count?: number | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_snapshots_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_stats: {
        Row: {
          created_at: string
          id: string
          metrics: Json | null
          snapshot_at: string
          snapshot_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metrics?: Json | null
          snapshot_at?: string
          snapshot_date?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metrics?: Json | null
          snapshot_at?: string
          snapshot_date?: string | null
          user_id?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          created_at: string
          external_channel_id: string
          handle: string | null
          id: string
          is_own: boolean
          niche_id: string | null
          platform: string
          title: string | null
          tracked: boolean
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          external_channel_id: string
          handle?: string | null
          id?: string
          is_own?: boolean
          niche_id?: string | null
          platform?: string
          title?: string | null
          tracked?: boolean
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          external_channel_id?: string
          handle?: string | null
          id?: string
          is_own?: boolean
          niche_id?: string | null
          platform?: string
          title?: string | null
          tracked?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channels_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string | null
          reference_image_url: string | null
          style: string | null
          style_notes: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          reference_image_url?: string | null
          style?: string | null
          style_notes?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          reference_image_url?: string | null
          style?: string | null
          style_notes?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_channels: {
        Row: {
          created_at: string
          handle: string
          id: string
          is_test_channel: boolean
          platform: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          handle: string
          id?: string
          is_test_channel?: boolean
          platform: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          handle?: string
          id?: string
          is_test_channel?: boolean
          platform?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          created_at: string
          id: string
          message: string
          route: string | null
          stack: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          route?: string | null
          stack?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          route?: string | null
          stack?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          author: string
          body: string
          created_at: string
          external_comment_id: string
          id: string
          is_question: boolean
          like_count: number
          metadata: Json
          platform: string
          published_at: string | null
          replied: boolean
          sentiment: string | null
          updated_at: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          author?: string
          body?: string
          created_at?: string
          external_comment_id: string
          id?: string
          is_question?: boolean
          like_count?: number
          metadata?: Json
          platform?: string
          published_at?: string | null
          replied?: boolean
          sentiment?: string | null
          updated_at?: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          external_comment_id?: string
          id?: string
          is_question?: boolean
          like_count?: number
          metadata?: Json
          platform?: string
          published_at?: string | null
          replied?: boolean
          sentiment?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_channels: {
        Row: {
          created_at: string
          external_channel_id: string
          handle: string | null
          id: string
          niche_id: string | null
          notes: string | null
          platform: string
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_channel_id: string
          handle?: string | null
          id?: string
          niche_id?: string | null
          notes?: string | null
          platform?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_channel_id?: string
          handle?: string | null
          id?: string
          niche_id?: string | null
          notes?: string | null
          platform?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_channels_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          handled: boolean
          id: string
          message: string
          name: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          email: string
          handled?: boolean
          id?: string
          message: string
          name: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          handled?: boolean
          id?: string
          message?: string
          name?: string
          subject?: string | null
        }
        Relationships: []
      }
      content_assets: {
        Row: {
          bytes: number | null
          checksum_sha256: string | null
          content_item_id: string
          created_at: string
          duration_seconds: number | null
          height: number | null
          id: string
          kind: string
          mime_type: string | null
          origin: string
          perceptual_hash: string | null
          rights_basis: string
          source_url: string | null
          storage_path: string | null
          technical_metadata: Json
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          bytes?: number | null
          checksum_sha256?: string | null
          content_item_id: string
          created_at?: string
          duration_seconds?: number | null
          height?: number | null
          id?: string
          kind: string
          mime_type?: string | null
          origin: string
          perceptual_hash?: string | null
          rights_basis?: string
          source_url?: string | null
          storage_path?: string | null
          technical_metadata?: Json
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          bytes?: number | null
          checksum_sha256?: string | null
          content_item_id?: string
          created_at?: string
          duration_seconds?: number | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          origin?: string
          perceptual_hash?: string | null
          rights_basis?: string
          source_url?: string | null
          storage_path?: string | null
          technical_metadata?: Json
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_assets_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_duplicate_flags: {
        Row: {
          confidence: number
          content_item_id: string
          created_at: string
          details: Json
          duplicate_of_id: string | null
          id: string
          match_type: string
          status: string
          user_id: string
        }
        Insert: {
          confidence?: number
          content_item_id: string
          created_at?: string
          details?: Json
          duplicate_of_id?: string | null
          id?: string
          match_type: string
          status?: string
          user_id: string
        }
        Update: {
          confidence?: number
          content_item_id?: string
          created_at?: string
          details?: Json
          duplicate_of_id?: string | null
          id?: string
          match_type?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_duplicate_flags_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_duplicate_flags_duplicate_of_id_fkey"
            columns: ["duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          canonical_url: string
          caption: string | null
          category: string | null
          comments: number | null
          created_at: string
          creator_account_id: string | null
          creator_id: string | null
          description: string | null
          discovery_date: string
          duration_seconds: number | null
          engagement_score: number | null
          followers: number | null
          freshness_score: number | null
          hashtags: string[]
          id: string
          language: string | null
          likes: number | null
          metadata_incomplete: boolean
          niche_id: string | null
          niche_relevance_score: number | null
          pipeline_stage: string
          platform: string
          platform_id: string | null
          project_id: string | null
          raw_metadata: Json
          rights_status: string
          shares: number | null
          source_kind: string
          tags: string[]
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          uploaded_at: string | null
          user_id: string
          view_velocity: number | null
          views: number | null
          viral_potential_score: number | null
        }
        Insert: {
          canonical_url: string
          caption?: string | null
          category?: string | null
          comments?: number | null
          created_at?: string
          creator_account_id?: string | null
          creator_id?: string | null
          description?: string | null
          discovery_date?: string
          duration_seconds?: number | null
          engagement_score?: number | null
          followers?: number | null
          freshness_score?: number | null
          hashtags?: string[]
          id?: string
          language?: string | null
          likes?: number | null
          metadata_incomplete?: boolean
          niche_id?: string | null
          niche_relevance_score?: number | null
          pipeline_stage?: string
          platform?: string
          platform_id?: string | null
          project_id?: string | null
          raw_metadata?: Json
          rights_status?: string
          shares?: number | null
          source_kind?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          uploaded_at?: string | null
          user_id: string
          view_velocity?: number | null
          views?: number | null
          viral_potential_score?: number | null
        }
        Update: {
          canonical_url?: string
          caption?: string | null
          category?: string | null
          comments?: number | null
          created_at?: string
          creator_account_id?: string | null
          creator_id?: string | null
          description?: string | null
          discovery_date?: string
          duration_seconds?: number | null
          engagement_score?: number | null
          followers?: number | null
          freshness_score?: number | null
          hashtags?: string[]
          id?: string
          language?: string | null
          likes?: number | null
          metadata_incomplete?: boolean
          niche_id?: string | null
          niche_relevance_score?: number | null
          pipeline_stage?: string
          platform?: string
          platform_id?: string | null
          project_id?: string | null
          raw_metadata?: Json
          rights_status?: string
          shares?: number | null
          source_kind?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          uploaded_at?: string | null
          user_id?: string
          view_velocity?: number | null
          views?: number | null
          viral_potential_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_creator_account_id_fkey"
            columns: ["creator_account_id"]
            isOneToOne: false
            referencedRelation: "creator_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_packages: {
        Row: {
          created_at: string
          formats: string[]
          id: string
          idea_id: string | null
          metadata: Json
          name: string
          project_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          formats?: string[]
          id?: string
          idea_id?: string | null
          metadata?: Json
          name?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          formats?: string[]
          id?: string
          idea_id?: string | null
          metadata?: Json
          name?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_packages_idea_fk"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "video_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_accounts: {
        Row: {
          created_at: string
          creator_id: string
          engagement_rate: number | null
          followers: number | null
          id: string
          permission_status: string
          platform: string
          platform_user_id: string | null
          profile_url: string | null
          public_contact: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          creator_id: string
          engagement_rate?: number | null
          followers?: number | null
          id?: string
          permission_status?: string
          platform: string
          platform_user_id?: string | null
          profile_url?: string | null
          public_contact?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          creator_id?: string
          engagement_rate?: number | null
          followers?: number | null
          id?: string
          permission_status?: string
          platform?: string
          platform_user_id?: string | null
          profile_url?: string | null
          public_contact?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_accounts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          created_at: string
          display_name: string
          id: string
          niche_tags: string[]
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id?: string
          niche_tags?: string[]
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          niche_tags?: string[]
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          admin_id: string | null
          created_at: string
          delta: number
          id: string
          reason: string
          ref_id: string | null
          user_id: string
        }
        Insert: {
          admin_id?: string | null
          created_at?: string
          delta: number
          id?: string
          reason: string
          ref_id?: string | null
          user_id: string
        }
        Update: {
          admin_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          ref_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      disposable_email_domains: {
        Row: {
          created_at: string
          domain: string
        }
        Insert: {
          created_at?: string
          domain: string
        }
        Update: {
          created_at?: string
          domain?: string
        }
        Relationships: []
      }
      engagement_insights: {
        Row: {
          comment_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          user_id: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          user_id: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_insights_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_arms: {
        Row: {
          arm_type: string
          created_at: string
          experiment_id: string
          id: string
          metrics: Json
          name: string
          thumbnail_id: string | null
          title_variant_id: string | null
          traffic_split: number
          updated_at: string
        }
        Insert: {
          arm_type?: string
          created_at?: string
          experiment_id: string
          id?: string
          metrics?: Json
          name?: string
          thumbnail_id?: string | null
          title_variant_id?: string | null
          traffic_split?: number
          updated_at?: string
        }
        Update: {
          arm_type?: string
          created_at?: string
          experiment_id?: string
          id?: string
          metrics?: Json
          name?: string
          thumbnail_id?: string | null
          title_variant_id?: string | null
          traffic_split?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_arms_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_arms_thumbnail_id_fkey"
            columns: ["thumbnail_id"]
            isOneToOne: false
            referencedRelation: "thumbnails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_arms_title_variant_id_fkey"
            columns: ["title_variant_id"]
            isOneToOne: false
            referencedRelation: "title_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          conclusion: Json
          created_at: string
          ended_at: string | null
          hypothesis: string
          id: string
          min_duration_hours: number
          min_sample_size: number
          name: string
          primary_metric: string
          project_id: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conclusion?: Json
          created_at?: string
          ended_at?: string | null
          hypothesis?: string
          id?: string
          min_duration_hours?: number
          min_sample_size?: number
          name: string
          primary_metric?: string
          project_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conclusion?: Json
          created_at?: string
          ended_at?: string | null
          hypothesis?: string
          id?: string
          min_duration_hours?: number
          min_sample_size?: number
          name?: string
          primary_metric?: string
          project_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      folder_items: {
        Row: {
          added_at: string
          folder_id: string
          id: string
          item_id: string
          item_type: string
        }
        Insert: {
          added_at?: string
          folder_id: string
          id?: string
          item_id: string
          item_type: string
        }
        Update: {
          added_at?: string
          folder_id?: string
          id?: string
          item_id?: string
          item_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "folder_items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      folder_rules: {
        Row: {
          created_at: string
          field: string
          folder_id: string
          id: string
          operator: string
          position: number
          value: Json
        }
        Insert: {
          created_at?: string
          field: string
          folder_id: string
          id?: string
          operator: string
          position?: number
          value?: Json
        }
        Update: {
          created_at?: string
          field?: string
          folder_id?: string
          id?: string
          operator?: string
          position?: number
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "folder_rules_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      generation_jobs: {
        Row: {
          attempt_count: number
          checkpoint: Json
          cost_actual_credits: number | null
          cost_estimate_credits: number | null
          created_at: string
          error: Json | null
          id: string
          idempotency_key: string | null
          job_type: string
          max_attempts: number
          model: string | null
          project_id: string | null
          provider: string | null
          provider_task_id: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          attempt_count?: number
          checkpoint?: Json
          cost_actual_credits?: number | null
          cost_estimate_credits?: number | null
          created_at?: string
          error?: Json | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          max_attempts?: number
          model?: string | null
          project_id?: string | null
          provider?: string | null
          provider_task_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          attempt_count?: number
          checkpoint?: Json
          cost_actual_credits?: number | null
          cost_estimate_credits?: number | null
          created_at?: string
          error?: Json | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          max_attempts?: number
          model?: string | null
          project_id?: string | null
          provider?: string | null
          provider_task_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          category: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          label: string
          last_checked_at: string | null
          provider: string
          secret_name: string | null
          settings: Json
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          label: string
          last_checked_at?: string | null
          provider: string
          secret_name?: string | null
          settings?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          label?: string
          last_checked_at?: string | null
          provider?: string
          secret_name?: string | null
          settings?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      language_quality_gates: {
        Row: {
          back_translation_evidence: string
          back_translation_passed: boolean
          golden_scripts_evidence: string
          golden_scripts_passed: boolean
          language_code: string
          native_review_evidence: string
          native_review_passed: boolean
          updated_at: string
        }
        Insert: {
          back_translation_evidence?: string
          back_translation_passed?: boolean
          golden_scripts_evidence?: string
          golden_scripts_passed?: boolean
          language_code: string
          native_review_evidence?: string
          native_review_passed?: boolean
          updated_at?: string
        }
        Update: {
          back_translation_evidence?: string
          back_translation_passed?: boolean
          golden_scripts_evidence?: string
          golden_scripts_passed?: boolean
          language_code?: string
          native_review_evidence?: string
          native_review_passed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "language_quality_gates_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: true
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
        ]
      }
      language_voices: {
        Row: {
          created_at: string
          gender: string
          id: string
          language_code: string
          name: string
          provider: string
          provider_voice_id: string | null
          selectable: boolean
          slot: number
          verified: boolean
        }
        Insert: {
          created_at?: string
          gender: string
          id?: string
          language_code: string
          name: string
          provider: string
          provider_voice_id?: string | null
          selectable?: boolean
          slot: number
          verified?: boolean
        }
        Update: {
          created_at?: string
          gender?: string
          id?: string
          language_code?: string
          name?: string
          provider?: string
          provider_voice_id?: string | null
          selectable?: boolean
          slot?: number
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "language_voices_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
        ]
      }
      languages: {
        Row: {
          caption_max_chars: number
          code: string
          created_at: string
          font_stack: string
          llm_instructions: string
          name_en: string
          name_native: string
          rtl: boolean
          status: string
        }
        Insert: {
          caption_max_chars?: number
          code: string
          created_at?: string
          font_stack?: string
          llm_instructions?: string
          name_en: string
          name_native: string
          rtl?: boolean
          status?: string
        }
        Update: {
          caption_max_chars?: number
          code?: string
          created_at?: string
          font_stack?: string
          llm_instructions?: string
          name_en?: string
          name_native?: string
          rtl?: boolean
          status?: string
        }
        Relationships: []
      }
      learning_insights: {
        Row: {
          confidence: number | null
          created_at: string
          evidence: Json
          experiment_id: string | null
          id: string
          kind: string | null
          monetization_status: string | null
          note: string | null
          payload: Json | null
          safety_score: number | null
          source: string
          status: string
          title: string | null
          topic: string
          user_id: string
          youtube_video_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence?: Json
          experiment_id?: string | null
          id?: string
          kind?: string | null
          monetization_status?: string | null
          note?: string | null
          payload?: Json | null
          safety_score?: number | null
          source?: string
          status?: string
          title?: string | null
          topic?: string
          user_id: string
          youtube_video_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence?: Json
          experiment_id?: string | null
          id?: string
          kind?: string | null
          monetization_status?: string | null
          note?: string | null
          payload?: Json | null
          safety_score?: number | null
          source?: string
          status?: string
          title?: string | null
          topic?: string
          user_id?: string
          youtube_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_insights_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          ig_user_id: string | null
          ig_username: string | null
          page_id: string
          page_name: string | null
          scope: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          ig_user_id?: string | null
          ig_username?: string | null
          page_id: string
          page_name?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          ig_user_id?: string | null
          ig_username?: string | null
          page_id?: string
          page_name?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      monetization_settings: {
        Row: {
          cpm_estimate_usd: number | null
          currency: string
          rpm_estimate_usd: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cpm_estimate_usd?: number | null
          currency?: string
          rpm_estimate_usd?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cpm_estimate_usd?: number | null
          currency?: string
          rpm_estimate_usd?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      music_tracks: {
        Row: {
          artist: string | null
          created_at: string
          download_url: string | null
          duration_secs: number | null
          id: string
          license: string | null
          license_url: string | null
          mood: string | null
          preview_url: string | null
          provider: string | null
          provider_track_id: string | null
          title: string | null
        }
        Insert: {
          artist?: string | null
          created_at?: string
          download_url?: string | null
          duration_secs?: number | null
          id?: string
          license?: string | null
          license_url?: string | null
          mood?: string | null
          preview_url?: string | null
          provider?: string | null
          provider_track_id?: string | null
          title?: string | null
        }
        Update: {
          artist?: string | null
          created_at?: string
          download_url?: string | null
          duration_secs?: number | null
          id?: string
          license?: string | null
          license_url?: string | null
          mood?: string | null
          preview_url?: string | null
          provider?: string | null
          provider_track_id?: string | null
          title?: string | null
        }
        Relationships: []
      }
      niche_snapshots: {
        Row: {
          captured_at: string
          id: string
          metrics: Json
          niche_id: string
          score: Json
          source: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          id?: string
          metrics?: Json
          niche_id: string
          score?: Json
          source?: string
          user_id: string
        }
        Update: {
          captured_at?: string
          id?: string
          metrics?: Json
          niche_id?: string
          score?: Json
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "niche_snapshots_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
        ]
      }
      niches: {
        Row: {
          active_only: boolean
          blueprint: Json
          content_style: string
          created_at: string
          enabled: boolean
          hashtags: string[]
          id: string
          keywords: string[]
          max_subs: number | null
          min_engagement_rate: number
          min_subs: number | null
          min_views: number
          name: string
          preferred_duration_seconds_max: number | null
          preferred_duration_seconds_min: number | null
          preferred_format: string
          preferred_language: string
          require_recent_activity: boolean
          scoring_weights: Json
          search_queries: string[]
          slug: string
          target_platforms: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          active_only?: boolean
          blueprint?: Json
          content_style?: string
          created_at?: string
          enabled?: boolean
          hashtags?: string[]
          id?: string
          keywords?: string[]
          max_subs?: number | null
          min_engagement_rate?: number
          min_subs?: number | null
          min_views?: number
          name: string
          preferred_duration_seconds_max?: number | null
          preferred_duration_seconds_min?: number | null
          preferred_format?: string
          preferred_language?: string
          require_recent_activity?: boolean
          scoring_weights?: Json
          search_queries?: string[]
          slug: string
          target_platforms?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          active_only?: boolean
          blueprint?: Json
          content_style?: string
          created_at?: string
          enabled?: boolean
          hashtags?: string[]
          id?: string
          keywords?: string[]
          max_subs?: number | null
          min_engagement_rate?: number
          min_subs?: number | null
          min_views?: number
          name?: string
          preferred_duration_seconds_max?: number | null
          preferred_duration_seconds_min?: number | null
          preferred_format?: string
          preferred_language?: string
          require_recent_activity?: boolean
          scoring_weights?: Json
          search_queries?: string[]
          slug?: string
          target_platforms?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedup_key: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      nps_responses: {
        Row: {
          category: string | null
          comment: string | null
          context: string
          created_at: string
          id: string
          score: number
          user_id: string
        }
        Insert: {
          category?: string | null
          comment?: string | null
          context?: string
          created_at?: string
          id?: string
          score: number
          user_id: string
        }
        Update: {
          category?: string | null
          comment?: string | null
          context?: string
          created_at?: string
          id?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      outlier_videos: {
        Row: {
          channel_id: string
          channel_subs: number
          channel_title: string | null
          created_at: string
          ctr: number | null
          id: string
          outlier_score: number
          patterns: Json | null
          project_id: string | null
          published_at: string | null
          retention: number | null
          source: string | null
          title: string | null
          user_id: string
          view_count: number | null
          youtube_id: string | null
        }
        Insert: {
          channel_id?: string
          channel_subs?: number
          channel_title?: string | null
          created_at?: string
          ctr?: number | null
          id?: string
          outlier_score?: number
          patterns?: Json | null
          project_id?: string | null
          published_at?: string | null
          retention?: number | null
          source?: string | null
          title?: string | null
          user_id: string
          view_count?: number | null
          youtube_id?: string | null
        }
        Update: {
          channel_id?: string
          channel_subs?: number
          channel_title?: string | null
          created_at?: string
          ctr?: number | null
          id?: string
          outlier_score?: number
          patterns?: Json | null
          project_id?: string | null
          published_at?: string | null
          retention?: number | null
          source?: string | null
          title?: string | null
          user_id?: string
          view_count?: number | null
          youtube_id?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          credits: number | null
          credits_granted: number
          features: Json | null
          id: string
          interval: string
          kind: string | null
          name: string
          price_cents: number | null
          price_inr_paise: number | null
          price_usd_cents: number | null
          razorpay_plan_id: string | null
          slug: string
          stripe_price_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          credits?: number | null
          credits_granted?: number
          features?: Json | null
          id?: string
          interval?: string
          kind?: string | null
          name: string
          price_cents?: number | null
          price_inr_paise?: number | null
          price_usd_cents?: number | null
          razorpay_plan_id?: string | null
          slug: string
          stripe_price_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          credits?: number | null
          credits_granted?: number
          features?: Json | null
          id?: string
          interval?: string
          kind?: string | null
          name?: string
          price_cents?: number | null
          price_inr_paise?: number | null
          price_usd_cents?: number | null
          razorpay_plan_id?: string | null
          slug?: string
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      platform_video_stats: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          metrics: Json
          platform: string
          publish_job_id: string | null
          snapshot_date: string
          user_id: string
          youtube_video_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          metrics?: Json
          platform?: string
          publish_job_id?: string | null
          snapshot_date?: string
          user_id: string
          youtube_video_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          metrics?: Json
          platform?: string
          publish_job_id?: string | null
          snapshot_date?: string
          user_id?: string
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_video_stats_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: false
            referencedRelation: "publish_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_plans: {
        Row: {
          active: boolean
          blurb: string | null
          created_at: string
          credits: number
          features: Json
          highlighted: boolean
          id: string
          name: string
          price_monthly: number
          price_monthly_inr: number | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          blurb?: string | null
          created_at?: string
          credits?: number
          features?: Json
          highlighted?: boolean
          id?: string
          name: string
          price_monthly?: number
          price_monthly_inr?: number | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          blurb?: string | null
          created_at?: string
          credits?: number
          features?: Json
          highlighted?: boolean
          id?: string
          name?: string
          price_monthly?: number
          price_monthly_inr?: number | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          credits: number
          display_name: string | null
          email: string | null
          free_credits_granted: boolean
          id: string
          plan: string
          preferred_language: string
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          email?: string | null
          free_credits_granted?: boolean
          id: string
          plan?: string
          preferred_language?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          email?: string | null
          free_credits_granted?: boolean
          id?: string
          plan?: string
          preferred_language?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      project_budgets: {
        Row: {
          created_at: string
          credit_cap: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_cap?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_cap?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          aspect_ratio: string
          audio_url: string | null
          category: string | null
          created_at: string
          creation_mode: string
          duration_minutes: number
          error: string | null
          id: string
          job_id: string | null
          language: string
          mode: string
          music_ducking: boolean
          music_track_id: string | null
          music_volume: number
          narration: string | null
          preset: string
          research_strict_mode: boolean
          result_url: string | null
          script: string | null
          settings: Json
          source_kind: string
          source_text: string | null
          source_url: string | null
          stage: string
          status: string
          step: string
          thumbnail_url: string | null
          title: string
          topic: string
          updated_at: string
          user_id: string
          visual_bible: Json
          visual_style: string
        }
        Insert: {
          aspect_ratio?: string
          audio_url?: string | null
          category?: string | null
          created_at?: string
          creation_mode?: string
          duration_minutes?: number
          error?: string | null
          id?: string
          job_id?: string | null
          language?: string
          mode?: string
          music_ducking?: boolean
          music_track_id?: string | null
          music_volume?: number
          narration?: string | null
          preset?: string
          research_strict_mode?: boolean
          result_url?: string | null
          script?: string | null
          settings?: Json
          source_kind?: string
          source_text?: string | null
          source_url?: string | null
          stage?: string
          status?: string
          step?: string
          thumbnail_url?: string | null
          title?: string
          topic?: string
          updated_at?: string
          user_id: string
          visual_bible?: Json
          visual_style?: string
        }
        Update: {
          aspect_ratio?: string
          audio_url?: string | null
          category?: string | null
          created_at?: string
          creation_mode?: string
          duration_minutes?: number
          error?: string | null
          id?: string
          job_id?: string | null
          language?: string
          mode?: string
          music_ducking?: boolean
          music_track_id?: string | null
          music_volume?: number
          narration?: string | null
          preset?: string
          research_strict_mode?: boolean
          result_url?: string | null
          script?: string | null
          settings?: Json
          source_kind?: string
          source_text?: string | null
          source_url?: string | null
          stage?: string
          status?: string
          step?: string
          thumbnail_url?: string | null
          title?: string
          topic?: string
          updated_at?: string
          user_id?: string
          visual_bible?: Json
          visual_style?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "video_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_tasks: {
        Row: {
          attempt: number
          cost_actual: number | null
          cost_estimate: number | null
          created_at: string
          error: Json | null
          id: string
          job_id: string
          latency_ms: number | null
          model: string | null
          output_ref: string | null
          provider: string
          provider_task_id: string | null
          status: string
          updated_at: string
          usage: Json
        }
        Insert: {
          attempt?: number
          cost_actual?: number | null
          cost_estimate?: number | null
          created_at?: string
          error?: Json | null
          id?: string
          job_id: string
          latency_ms?: number | null
          model?: string | null
          output_ref?: string | null
          provider: string
          provider_task_id?: string | null
          status?: string
          updated_at?: string
          usage?: Json
        }
        Update: {
          attempt?: number
          cost_actual?: number | null
          cost_estimate?: number | null
          created_at?: string
          error?: Json | null
          id?: string
          job_id?: string
          latency_ms?: number | null
          model?: string | null
          output_ref?: string | null
          provider?: string
          provider_task_id?: string | null
          status?: string
          updated_at?: string
          usage?: Json
        }
        Relationships: [
          {
            foreignKeyName: "provider_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_jobs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_channel_id: string | null
          created_at: string
          description: string | null
          error: string | null
          id: string
          idempotency_key: string
          made_for_kids: boolean | null
          meta_fb_post_id: string | null
          meta_ig_media_id: string | null
          meta_ig_permalink: string | null
          privacy: string | null
          project_id: string
          published_at: string | null
          safety_override: boolean | null
          safety_score: number | null
          scheduled_for: string | null
          status: string
          tags: string[]
          thumbnail_id: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_job_id: string | null
          workspace_id: string | null
          youtube_url: string | null
          youtube_video_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_channel_id?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string
          made_for_kids?: boolean | null
          meta_fb_post_id?: string | null
          meta_ig_media_id?: string | null
          meta_ig_permalink?: string | null
          privacy?: string | null
          project_id: string
          published_at?: string | null
          safety_override?: boolean | null
          safety_score?: number | null
          scheduled_for?: string | null
          status?: string
          tags?: string[]
          thumbnail_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_job_id?: string | null
          workspace_id?: string | null
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_channel_id?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string
          made_for_kids?: boolean | null
          meta_fb_post_id?: string | null
          meta_ig_media_id?: string | null
          meta_ig_permalink?: string | null
          privacy?: string | null
          project_id?: string
          published_at?: string | null
          safety_override?: boolean | null
          safety_score?: number | null
          scheduled_for?: string | null
          status?: string
          tags?: string[]
          thumbnail_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_job_id?: string | null
          workspace_id?: string | null
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publish_jobs_client_channel_id_fkey"
            columns: ["client_channel_id"]
            isOneToOne: false
            referencedRelation: "client_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_warnings: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          project_id: string
          publish_job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          project_id: string
          publish_job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          project_id?: string
          publish_job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_warnings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_warnings_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: false
            referencedRelation: "publish_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_create_runs: {
        Row: {
          artifacts: Json
          created_at: string
          facts: Json
          hook: string
          id: string
          project_id: string
          spend_approved: boolean
          stage_states: Json
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          artifacts?: Json
          created_at?: string
          facts?: Json
          hook?: string
          id?: string
          project_id: string
          spend_approved?: boolean
          stage_states?: Json
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          artifacts?: Json
          created_at?: string
          facts?: Json
          hook?: string
          id?: string
          project_id?: string
          spend_approved?: boolean
          stage_states?: Json
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_create_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          hit_count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          hit_count?: number
          window_start?: string
        }
        Update: {
          bucket_key?: string
          hit_count?: number
          window_start?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string | null
          created_at: string
          device_hash: string | null
          id: string
          invitee_id: string | null
          ip_prefix: string | null
          referee_id: string | null
          referrer_id: string
          rewarded_at: string | null
          status: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          device_hash?: string | null
          id?: string
          invitee_id?: string | null
          ip_prefix?: string | null
          referee_id?: string | null
          referrer_id: string
          rewarded_at?: string | null
          status?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          device_hash?: string | null
          id?: string
          invitee_id?: string | null
          ip_prefix?: string | null
          referee_id?: string | null
          referrer_id?: string
          rewarded_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      render_chapters: {
        Row: {
          attempts: number
          chapter_index: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          max_attempts: number
          output_path: string | null
          paragraphs: Json
          render_id: string
          script_text: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          chapter_index: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          max_attempts?: number
          output_path?: string | null
          paragraphs?: Json
          render_id: string
          script_text?: string
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          chapter_index?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          max_attempts?: number
          output_path?: string | null
          paragraphs?: Json
          render_id?: string
          script_text?: string
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_chapters_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
        ]
      }
      renders: {
        Row: {
          aspect_ratio: string | null
          attempts: number
          billed_minutes: number | null
          cancel_requested: boolean
          checkpoint: Json
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          credits_charged: number
          duration: number | null
          engine: string
          error: string | null
          file_size: number | null
          file_url: string | null
          format: string
          id: string
          job_id: string | null
          max_attempts: number
          meta: Json
          parent_id: string | null
          progress: number
          project_id: string | null
          render_completed_at: string | null
          render_started_at: string | null
          reserved_minutes: number
          resolution: string | null
          stage: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          attempts?: number
          billed_minutes?: number | null
          cancel_requested?: boolean
          checkpoint?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          credits_charged?: number
          duration?: number | null
          engine?: string
          error?: string | null
          file_size?: number | null
          file_url?: string | null
          format?: string
          id?: string
          job_id?: string | null
          max_attempts?: number
          meta?: Json
          parent_id?: string | null
          progress?: number
          project_id?: string | null
          render_completed_at?: string | null
          render_started_at?: string | null
          reserved_minutes?: number
          resolution?: string | null
          stage?: string
          status?: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string | null
          attempts?: number
          billed_minutes?: number | null
          cancel_requested?: boolean
          checkpoint?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          credits_charged?: number
          duration?: number | null
          engine?: string
          error?: string | null
          file_size?: number | null
          file_url?: string | null
          format?: string
          id?: string
          job_id?: string | null
          max_attempts?: number
          meta?: Json
          parent_id?: string | null
          progress?: number
          project_id?: string | null
          render_completed_at?: string | null
          render_started_at?: string | null
          reserved_minutes?: number
          resolution?: string | null
          stage?: string
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_claims: {
        Row: {
          claim: string
          created_at: string
          evidence: Json
          id: string
          review_note: string | null
          review_state: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string
          updated_at: string
          user_id: string
          verdict: string
        }
        Insert: {
          claim: string
          created_at?: string
          evidence?: Json
          id?: string
          review_note?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id: string
          updated_at?: string
          user_id: string
          verdict?: string
        }
        Update: {
          claim?: string
          created_at?: string
          evidence?: Json
          id?: string
          review_note?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string
          updated_at?: string
          user_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_claims_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "research_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      research_projects: {
        Row: {
          created_at: string
          id: string
          language: string | null
          niches: Json | null
          status: string | null
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string | null
          niches?: Json | null
          status?: string | null
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string | null
          niches?: Json | null
          status?: string | null
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      research_sources: {
        Row: {
          content: string | null
          created_at: string
          credibility: Json
          embedding: string | null
          excerpt: string
          id: string
          metadata: Json
          position: number
          project_id: string | null
          published_at: string | null
          research_project_id: string | null
          source_type: string
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          credibility?: Json
          embedding?: string | null
          excerpt?: string
          id?: string
          metadata?: Json
          position?: number
          project_id?: string | null
          published_at?: string | null
          research_project_id?: string | null
          source_type?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          credibility?: Json
          embedding?: string | null
          excerpt?: string
          id?: string
          metadata?: Json
          position?: number
          project_id?: string | null
          published_at?: string | null
          research_project_id?: string | null
          source_type?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_sources_research_project_id_fkey"
            columns: ["research_project_id"]
            isOneToOne: false
            referencedRelation: "research_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_curves: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          overall_avg: number | null
          platform: string
          points: Json
          publish_job_id: string | null
          segments: Json | null
          snapshot_date: string
          strongest_segment: string | null
          user_id: string
          weakest_segment: string | null
          youtube_video_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          overall_avg?: number | null
          platform?: string
          points?: Json
          publish_job_id?: string | null
          segments?: Json | null
          snapshot_date?: string
          strongest_segment?: string | null
          user_id: string
          weakest_segment?: string | null
          youtube_video_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          overall_avg?: number | null
          platform?: string
          points?: Json
          publish_job_id?: string | null
          segments?: Json | null
          snapshot_date?: string
          strongest_segment?: string | null
          user_id?: string
          weakest_segment?: string | null
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_curves_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: false
            referencedRelation: "publish_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          points: Json
          publish_job_id: string | null
          source: string
          user_id: string
          video_id: string | null
          weakest_scene: Json | null
          youtube_video_id: string | null
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          points?: Json
          publish_job_id?: string | null
          source?: string
          user_id: string
          video_id?: string | null
          weakest_scene?: Json | null
          youtube_video_id?: string | null
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          points?: Json
          publish_job_id?: string | null
          source?: string
          user_id?: string
          video_id?: string | null
          weakest_scene?: Json | null
          youtube_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_snapshots_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: false
            referencedRelation: "publish_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_snapshots_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_decisions: {
        Row: {
          content_item_id: string
          created_at: string
          creator_account_id: string | null
          decided_at: string
          decided_by: string | null
          evidence_notes: string
          evidence_url: string | null
          id: string
          status: string
          user_id: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          creator_account_id?: string | null
          decided_at?: string
          decided_by?: string | null
          evidence_notes?: string
          evidence_url?: string | null
          id?: string
          status: string
          user_id: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          creator_account_id?: string | null
          decided_at?: string
          decided_by?: string | null
          evidence_notes?: string
          evidence_url?: string | null
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_decisions_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rights_decisions_creator_account_id_fkey"
            columns: ["creator_account_id"]
            isOneToOne: false
            referencedRelation: "creator_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_rules: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          last_reviewed_at: string
          params: Json
          rule_key: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description: string
          id?: string
          last_reviewed_at?: string
          params?: Json
          rule_key: string
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          last_reviewed_at?: string
          params?: Json
          rule_key?: string
          version?: number
        }
        Relationships: []
      }
      safety_scores: {
        Row: {
          ai_review: Json | null
          band: string
          created_at: string
          dimensions: Json | null
          id: string
          issues: Json | null
          model: string | null
          project_id: string
          rule_version: number | null
          score: number
          suggestions: Json | null
          user_id: string
          version: string | null
        }
        Insert: {
          ai_review?: Json | null
          band?: string
          created_at?: string
          dimensions?: Json | null
          id?: string
          issues?: Json | null
          model?: string | null
          project_id: string
          rule_version?: number | null
          score?: number
          suggestions?: Json | null
          user_id: string
          version?: string | null
        }
        Update: {
          ai_review?: Json | null
          band?: string
          created_at?: string
          dimensions?: Json | null
          id?: string
          issues?: Json | null
          model?: string | null
          project_id?: string
          rule_version?: number | null
          score?: number
          suggestions?: Json | null
          user_id?: string
          version?: string | null
        }
        Relationships: []
      }
      scene_versions: {
        Row: {
          asset_url: string | null
          change_note: string | null
          created_at: string
          created_by: string | null
          id: string
          narration: string
          scene_id: string
          version_number: number
          visual_prompt: string | null
        }
        Insert: {
          asset_url?: string | null
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          narration?: string
          scene_id: string
          version_number: number
          visual_prompt?: string | null
        }
        Update: {
          asset_url?: string | null
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          narration?: string
          scene_id?: string
          version_number?: number
          visual_prompt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scene_versions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          asset_source: Json
          asset_thumb_url: string | null
          asset_url: string | null
          character_id: string | null
          created_at: string
          duration: number
          error: string | null
          id: string
          metadata: Json
          motion_type: string
          narration: string
          negative_prompt: string | null
          project_id: string
          scene_number: number
          search_query: string | null
          status: string
          style_override: string | null
          transition: string
          updated_at: string
          user_id: string
          visual_prompt: string | null
          visual_type: string
          voice_id: string | null
        }
        Insert: {
          asset_source?: Json
          asset_thumb_url?: string | null
          asset_url?: string | null
          character_id?: string | null
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          metadata?: Json
          motion_type?: string
          narration?: string
          negative_prompt?: string | null
          project_id: string
          scene_number: number
          search_query?: string | null
          status?: string
          style_override?: string | null
          transition?: string
          updated_at?: string
          user_id: string
          visual_prompt?: string | null
          visual_type?: string
          voice_id?: string | null
        }
        Update: {
          asset_source?: Json
          asset_thumb_url?: string | null
          asset_url?: string | null
          character_id?: string | null
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          metadata?: Json
          motion_type?: string
          narration?: string
          negative_prompt?: string | null
          project_id?: string
          scene_number?: number
          search_query?: string | null
          status?: string
          style_override?: string | null
          transition?: string
          updated_at?: string
          user_id?: string
          visual_prompt?: string | null
          visual_type?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      script_versions: {
        Row: {
          change_note: string | null
          created_at: string
          created_by: string | null
          full_text: string
          id: string
          script_id: string
          sections: Json
          timing: Json
          version_number: number
          word_count: number
        }
        Insert: {
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          full_text?: string
          id?: string
          script_id: string
          sections?: Json
          timing?: Json
          version_number: number
          word_count?: number
        }
        Update: {
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          full_text?: string
          id?: string
          script_id?: string
          sections?: Json
          timing?: Json
          version_number?: number
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "script_versions_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          brand_profile_id: string | null
          created_at: string
          current_version_id: string | null
          id: string
          metadata: Json
          project_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          brand_profile_id?: string | null
          created_at?: string
          current_version_id?: string | null
          id?: string
          metadata?: Json
          project_id: string
          status?: string
          title?: string
          updated_at?: string
          user_id: string
          word_count?: number
        }
        Update: {
          brand_profile_id?: string | null
          created_at?: string
          current_version_id?: string | null
          id?: string
          metadata?: Json
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "scripts_brand_profile_fk"
            columns: ["brand_profile_id"]
            isOneToOne: false
            referencedRelation: "brand_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_metadata: {
        Row: {
          chapters: Json | null
          created_at: string
          description: string | null
          hashtags: string[] | null
          id: string
          project_id: string | null
          selected_title: string | null
          status: string | null
          tags: string[] | null
          thumbnail_id: string | null
          titles: Json | null
          updated_at: string
          user_id: string
          video_job_id: string | null
        }
        Insert: {
          chapters?: Json | null
          created_at?: string
          description?: string | null
          hashtags?: string[] | null
          id?: string
          project_id?: string | null
          selected_title?: string | null
          status?: string | null
          tags?: string[] | null
          thumbnail_id?: string | null
          titles?: Json | null
          updated_at?: string
          user_id: string
          video_job_id?: string | null
        }
        Update: {
          chapters?: Json | null
          created_at?: string
          description?: string | null
          hashtags?: string[] | null
          id?: string
          project_id?: string | null
          selected_title?: string | null
          status?: string | null
          tags?: string[] | null
          thumbnail_id?: string | null
          titles?: Json | null
          updated_at?: string
          user_id?: string
          video_job_id?: string | null
        }
        Relationships: []
      }
      seo_packages: {
        Row: {
          chosen_title: string
          created_at: string
          description: string
          exported_at: string | null
          hashtags: string[]
          id: string
          project_id: string
          thumbnail_concepts: Json
          title_options: Json
          user_id: string
        }
        Insert: {
          chosen_title: string
          created_at?: string
          description?: string
          exported_at?: string | null
          hashtags?: string[]
          id?: string
          project_id: string
          thumbnail_concepts?: Json
          title_options?: Json
          user_id: string
        }
        Update: {
          chosen_title?: string
          created_at?: string
          description?: string
          exported_at?: string | null
          hashtags?: string[]
          id?: string
          project_id?: string
          thumbnail_concepts?: Json
          title_options?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_content: {
        Row: {
          key: string
          label: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          label: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          label?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          external_id: string
          id: string
          plan_slug: string | null
          provider: string
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_id: string
          id?: string
          plan_slug?: string | null
          provider: string
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_id?: string
          id?: string
          plan_slug?: string | null
          provider?: string
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      thumbnail_projects: {
        Row: {
          canvas: Json
          created_at: string
          height: number
          id: string
          name: string
          project_id: string
          status: string
          updated_at: string
          user_id: string
          width: number
        }
        Insert: {
          canvas?: Json
          created_at?: string
          height?: number
          id?: string
          name?: string
          project_id: string
          status?: string
          updated_at?: string
          user_id: string
          width?: number
        }
        Update: {
          canvas?: Json
          created_at?: string
          height?: number
          id?: string
          name?: string
          project_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "thumbnail_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      thumbnails: {
        Row: {
          aspect: string
          created_at: string
          final_url: string | null
          id: string
          image_url: string | null
          is_ai_generated: boolean
          license: string
          model: string | null
          project_id: string
          prompt: string | null
          prompt_hash: string | null
          provider: string | null
          selected: boolean | null
          text_overlay: Json | null
          url: string
          user_id: string
          variant: number
        }
        Insert: {
          aspect?: string
          created_at?: string
          final_url?: string | null
          id?: string
          image_url?: string | null
          is_ai_generated?: boolean
          license?: string
          model?: string | null
          project_id: string
          prompt?: string | null
          prompt_hash?: string | null
          provider?: string | null
          selected?: boolean | null
          text_overlay?: Json | null
          url: string
          user_id: string
          variant?: number
        }
        Update: {
          aspect?: string
          created_at?: string
          final_url?: string | null
          id?: string
          image_url?: string | null
          is_ai_generated?: boolean
          license?: string
          model?: string | null
          project_id?: string
          prompt?: string | null
          prompt_hash?: string | null
          provider?: string | null
          selected?: boolean | null
          text_overlay?: Json | null
          url?: string
          user_id?: string
          variant?: number
        }
        Relationships: []
      }
      title_variants: {
        Row: {
          created_at: string
          ctr: number | null
          experiment_id: string | null
          id: string
          impressions: number
          project_id: string
          score: Json
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ctr?: number | null
          experiment_id?: string | null
          id?: string
          impressions?: number
          project_id: string
          score?: Json
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ctr?: number | null
          experiment_id?: string | null
          id?: string
          impressions?: number
          project_id?: string
          score?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_variants_experiment_fk"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_variants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tts_cache: {
        Row: {
          audio_path: string
          byte_size: number | null
          created_at: string
          duration_seconds: number | null
          id: string
          language_code: string
          paragraph_hash: string
          provider: string
          voice_id: string
        }
        Insert: {
          audio_path: string
          byte_size?: number | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          language_code: string
          paragraph_hash: string
          provider: string
          voice_id: string
        }
        Update: {
          audio_path?: string
          byte_size?: number | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          language_code?: string
          paragraph_hash?: string
          provider?: string
          voice_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_analytics: {
        Row: {
          age_days: number | null
          created_at: string
          id: string
          metrics: Json | null
          publish_job_id: string | null
          snapshot_at: string
          snapshot_date: string | null
          user_id: string
          youtube_video_id: string | null
        }
        Insert: {
          age_days?: number | null
          created_at?: string
          id?: string
          metrics?: Json | null
          publish_job_id?: string | null
          snapshot_at?: string
          snapshot_date?: string | null
          user_id: string
          youtube_video_id?: string | null
        }
        Update: {
          age_days?: number | null
          created_at?: string
          id?: string
          metrics?: Json | null
          publish_job_id?: string | null
          snapshot_at?: string
          snapshot_date?: string | null
          user_id?: string
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      video_ideas: {
        Row: {
          angle: string | null
          created_at: string
          difficulty: string | null
          embedding: string | null
          evidence: Json
          format: string | null
          hook: string | null
          id: string
          idea_source: string
          outlier_video_id: string | null
          project_id: string | null
          project_ref: string | null
          safety_flag: string
          score: Json | null
          score_breakdown: Json
          status: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          angle?: string | null
          created_at?: string
          difficulty?: string | null
          embedding?: string | null
          evidence?: Json
          format?: string | null
          hook?: string | null
          id?: string
          idea_source?: string
          outlier_video_id?: string | null
          project_id?: string | null
          project_ref?: string | null
          safety_flag?: string
          score?: Json | null
          score_breakdown?: Json
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          angle?: string | null
          created_at?: string
          difficulty?: string | null
          embedding?: string | null
          evidence?: Json
          format?: string | null
          hook?: string | null
          id?: string
          idea_source?: string
          outlier_video_id?: string | null
          project_id?: string | null
          project_ref?: string | null
          safety_flag?: string
          score?: Json | null
          score_breakdown?: Json
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_ideas_outlier_video_id_fkey"
            columns: ["outlier_video_id"]
            isOneToOne: false
            referencedRelation: "outlier_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_ideas_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      video_jobs: {
        Row: {
          assets: Json
          audio_url: string | null
          created_at: string
          credits_used: number
          duration_seconds: number | null
          error: string | null
          format: string
          id: string
          idempotency_key: string | null
          narration: string | null
          progress: number
          render_id: string | null
          result_url: string | null
          scenes: Json
          script: string
          stage: string
          status: Database["public"]["Enums"]["job_status"]
          step: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
          voice: string
          youtube_status: string | null
          youtube_video_id: string | null
        }
        Insert: {
          assets?: Json
          audio_url?: string | null
          created_at?: string
          credits_used?: number
          duration_seconds?: number | null
          error?: string | null
          format?: string
          id?: string
          idempotency_key?: string | null
          narration?: string | null
          progress?: number
          render_id?: string | null
          result_url?: string | null
          scenes?: Json
          script: string
          stage?: string
          status?: Database["public"]["Enums"]["job_status"]
          step?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id: string
          voice?: string
          youtube_status?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          assets?: Json
          audio_url?: string | null
          created_at?: string
          credits_used?: number
          duration_seconds?: number | null
          error?: string | null
          format?: string
          id?: string
          idempotency_key?: string | null
          narration?: string | null
          progress?: number
          render_id?: string | null
          result_url?: string | null
          scenes?: Json
          script?: string
          stage?: string
          status?: Database["public"]["Enums"]["job_status"]
          step?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          voice?: string
          youtube_status?: string | null
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      video_snapshots: {
        Row: {
          captured_at: string
          comment_count: number | null
          id: string
          like_count: number | null
          metrics: Json
          user_id: string
          video_id: string
          view_count: number | null
        }
        Insert: {
          captured_at?: string
          comment_count?: number | null
          id?: string
          like_count?: number | null
          metrics?: Json
          user_id: string
          video_id: string
          view_count?: number | null
        }
        Update: {
          captured_at?: string
          comment_count?: number | null
          id?: string
          like_count?: number | null
          metrics?: Json
          user_id?: string
          video_id?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_snapshots_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          channel_id: string | null
          created_at: string
          description: string
          duration_seconds: number | null
          embedding: string | null
          external_video_id: string
          id: string
          is_own: boolean
          metrics: Json
          platform: string
          published_at: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          description?: string
          duration_seconds?: number | null
          embedding?: string | null
          external_video_id: string
          id?: string
          is_own?: boolean
          metrics?: Json
          platform?: string
          published_at?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          description?: string
          duration_seconds?: number | null
          embedding?: string | null
          external_video_id?: string
          id?: string
          is_own?: boolean
          metrics?: Json
          platform?: string
          published_at?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      voiceovers: {
        Row: {
          audio_url: string | null
          cache_key: string | null
          characters: number
          created_at: string
          duration: number | null
          id: string
          model: string | null
          project_id: string
          scene_id: string | null
          user_id: string
          voice_id: string | null
        }
        Insert: {
          audio_url?: string | null
          cache_key?: string | null
          characters?: number
          created_at?: string
          duration?: number | null
          id?: string
          model?: string | null
          project_id: string
          scene_id?: string | null
          user_id: string
          voice_id?: string | null
        }
        Update: {
          audio_url?: string | null
          cache_key?: string | null
          characters?: number
          created_at?: string
          duration?: number | null
          id?: string
          model?: string | null
          project_id?: string
          scene_id?: string | null
          user_id?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voiceovers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voiceovers_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      voices: {
        Row: {
          created_at: string
          id: string
          is_clone_legal: boolean
          language_code: string | null
          metadata: Json
          name: string
          provider: string
          provider_voice_id: string | null
          updated_at: string
          user_id: string
          verified: boolean
          voice_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_clone_legal?: boolean
          language_code?: string | null
          metadata?: Json
          name: string
          provider: string
          provider_voice_id?: string | null
          updated_at?: string
          user_id: string
          verified?: boolean
          voice_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_clone_legal?: boolean
          language_code?: string | null
          metadata?: Json
          name?: string
          provider?: string
          provider_voice_id?: string | null
          updated_at?: string
          user_id?: string
          verified?: boolean
          voice_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "voices_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
        ]
      }
      worker_heartbeats: {
        Row: {
          last_seen_at: string
          meta: Json
          worker_id: string
        }
        Insert: {
          last_seen_at?: string
          meta?: Json
          worker_id: string
        }
        Update: {
          last_seen_at?: string
          meta?: Json
          worker_id?: string
        }
        Relationships: []
      }
      workflow_job_events: {
        Row: {
          created_at: string
          data: Json
          id: string
          level: string
          message: string
          user_id: string
          workflow_job_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          level?: string
          message: string
          user_id: string
          workflow_job_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          level?: string
          message?: string
          user_id?: string
          workflow_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_job_events_workflow_job_id_fkey"
            columns: ["workflow_job_id"]
            isOneToOne: false
            referencedRelation: "workflow_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_jobs: {
        Row: {
          attempt: number
          content_item_id: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          progress: number
          project_id: string | null
          result: Json
          run_after: string
          stage: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt?: number
          content_item_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          progress?: number
          project_id?: string | null
          result?: Json
          run_after?: string
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt?: number
          content_item_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          progress?: number
          project_id?: string | null
          result?: Json
          run_after?: string
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_jobs_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          publish_job_id: string
          requested_by: string
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          publish_job_id: string
          requested_by: string
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          publish_job_id?: string
          requested_by?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_approvals_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: true
            referencedRelation: "publish_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_budgets: {
        Row: {
          alert_threshold_pct: number
          created_at: string
          monthly_credit_cap: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alert_threshold_pct?: number
          created_at?: string
          monthly_credit_cap?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          alert_threshold_pct?: number
          created_at?: string
          monthly_credit_cap?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          revoked_at: string | null
          role: string
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role?: string
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role?: string
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          plan_tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          plan_tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan_tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      youtube_api_cache: {
        Row: {
          cache_key: string | null
          created_at: string
          expires_at: string | null
          id: string
          payload: Json | null
          user_id: string | null
        }
        Insert: {
          cache_key?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Update: {
          cache_key?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      youtube_connections: {
        Row: {
          access_token: string | null
          channel_id: string | null
          channel_title: string | null
          created_at: string
          expires_at: string | null
          id: string
          refresh_token: string
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          channel_id?: string | null
          channel_title?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          refresh_token: string
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          channel_id?: string | null
          channel_title?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          refresh_token?: string
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_credits: {
        Args: {
          p_admin_id?: string
          p_delta: number
          p_reason: string
          p_user_id: string
        }
        Returns: number
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      content_rights_approved: {
        Args: { _content_id: string }
        Returns: boolean
      }
      debit_credits_amount_once: {
        Args: {
          p_amount: number
          p_reason: string
          p_ref_id?: string
          p_user_id: string
        }
        Returns: number
      }
      debit_credits_for_job: {
        Args: { p_job_id?: string; p_reason: string; p_user_id: string }
        Returns: number
      }
      debit_credits_for_job_once: {
        Args: { p_job_id?: string; p_reason: string; p_user_id: string }
        Returns: number
      }
      debit_credits_for_minutes: {
        Args: {
          p_minutes: number
          p_reason: string
          p_ref_id?: string
          p_user_id: string
        }
        Returns: number
      }
      finalize_render_billing: { Args: { p_render_id: string }; Returns: Json }
      grant_credits_once: {
        Args: {
          p_amount: number
          p_reason: string
          p_ref_id?: string
          p_user_id: string
        }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_workspace_creator: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_editor: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_owner: { Args: { p_workspace_id: string }; Returns: boolean }
      log_abuse_signal: {
        Args: {
          p_device_hash: string
          p_ip: unknown
          p_signal_type: string
          p_user_id: string
        }
        Returns: number
      }
      refund_credits: {
        Args: { p_job_id?: string; p_reason: string; p_user_id: string }
        Returns: number
      }
      refund_credits_for_minutes: {
        Args: {
          p_minutes: number
          p_reason: string
          p_ref_id?: string
          p_user_id: string
        }
        Returns: number
      }
      requeue_stale_chapters: {
        Args: { p_lease_seconds?: number }
        Returns: number
      }
      requeue_stale_renders: {
        Args: { p_lease_seconds?: number }
        Returns: number
      }
    }
    Enums: {
      account_status: "active" | "suspended"
      app_role: "admin" | "user" | "owner"
      job_status: "queued" | "running" | "completed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended"],
      app_role: ["admin", "user", "owner"],
      job_status: ["queued", "running", "completed", "failed"],
    },
  },
} as const
