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
          ip: string | null
          signal_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash?: string | null
          id?: string
          ip?: string | null
          signal_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string | null
          id?: string
          ip?: string | null
          signal_type?: string
          user_id?: string
        }
        Relationships: []
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
      niches: {
        Row: {
          content_style: string
          created_at: string
          enabled: boolean
          hashtags: string[]
          id: string
          keywords: string[]
          min_engagement_rate: number
          min_views: number
          name: string
          preferred_duration_seconds_max: number | null
          preferred_duration_seconds_min: number | null
          preferred_format: string
          preferred_language: string
          scoring_weights: Json
          search_queries: string[]
          slug: string
          target_platforms: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          content_style?: string
          created_at?: string
          enabled?: boolean
          hashtags?: string[]
          id?: string
          keywords?: string[]
          min_engagement_rate?: number
          min_views?: number
          name: string
          preferred_duration_seconds_max?: number | null
          preferred_duration_seconds_min?: number | null
          preferred_format?: string
          preferred_language?: string
          scoring_weights?: Json
          search_queries?: string[]
          slug: string
          target_platforms?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          content_style?: string
          created_at?: string
          enabled?: boolean
          hashtags?: string[]
          id?: string
          keywords?: string[]
          min_engagement_rate?: number
          min_views?: number
          name?: string
          preferred_duration_seconds_max?: number | null
          preferred_duration_seconds_min?: number | null
          preferred_format?: string
          preferred_language?: string
          scoring_weights?: Json
          search_queries?: string[]
          slug?: string
          target_platforms?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
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
          narration: string | null
          preset: string
          result_url: string | null
          script: string | null
          settings: Json
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
          music_track_id: string | null
          music_volume: number
          music_ducking: boolean
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
          narration?: string | null
          preset?: string
          result_url?: string | null
          script?: string | null
          settings?: Json
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
          music_track_id?: string | null
          music_volume?: number
          music_ducking?: boolean
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
          narration?: string | null
          preset?: string
          result_url?: string | null
          script?: string | null
          settings?: Json
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
          music_track_id?: string | null
          music_volume?: number
          music_ducking?: boolean
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
      renders: {
        Row: {
          aspect_ratio: string | null
          attempts: number
          cancel_requested: boolean
          checkpoint: Json
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
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
          progress: number
          project_id: string | null
          render_completed_at: string | null
          render_started_at: string | null
          resolution: string | null
          reserved_minutes: number
          billed_minutes: number | null
          credits_charged: number
          stage: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          attempts?: number
          cancel_requested?: boolean
          checkpoint?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
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
          progress?: number
          project_id?: string | null
          render_completed_at?: string | null
          render_started_at?: string | null
          resolution?: string | null
          reserved_minutes?: number
          billed_minutes?: number | null
          credits_charged?: number
          stage?: string
          status?: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string | null
          attempts?: number
          cancel_requested?: boolean
          checkpoint?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
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
          progress?: number
          project_id?: string | null
          render_completed_at?: string | null
          render_started_at?: string | null
          resolution?: string | null
          reserved_minutes?: number
          billed_minutes?: number | null
          credits_charged?: number
          stage?: string
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      scenes: {
        Row: {
          asset_source: Json
          asset_thumb_url: string | null
          asset_url: string | null
          created_at: string
          duration: number
          error: string | null
          id: string
          motion_type: string
          narration: string
          negative_prompt: string | null
          project_id: string
          scene_number: number
          search_query: string | null
          status: string
          style_override: string | null
          character_id: string | null
          voice_id: string | null
          transition: string
          updated_at: string
          user_id: string
          visual_prompt: string | null
          visual_type: string
        }
        Insert: {
          asset_source?: Json
          asset_thumb_url?: string | null
          asset_url?: string | null
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          motion_type?: string
          narration?: string
          negative_prompt?: string | null
          project_id: string
          scene_number: number
          search_query?: string | null
          status?: string
          style_override?: string | null
          character_id?: string | null
          voice_id?: string | null
          transition?: string
          updated_at?: string
          user_id: string
          visual_prompt?: string | null
          visual_type?: string
        }
        Update: {
          asset_source?: Json
          asset_thumb_url?: string | null
          asset_url?: string | null
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          motion_type?: string
          narration?: string
          negative_prompt?: string | null
          project_id?: string
          scene_number?: number
          search_query?: string | null
          status?: string
          style_override?: string | null
          character_id?: string | null
          voice_id?: string | null
          transition?: string
          updated_at?: string
          user_id?: string
          visual_prompt?: string | null
          visual_type?: string
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
      research_projects: {
        Row: {
          id: string
          user_id: string
          topic: string
          language: string
          niches: Json
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          topic: string
          language?: string
          niches?: unknown
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          topic?: string
          language?: string
          niches?: unknown
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      outlier_videos: {
        Row: {
          id: string
          user_id: string
          project_id: string
          youtube_id: string
          title: string
          channel_id: string
          channel_title: string
          channel_subs: number
          view_count: number
          published_at: string | null
          outlier_score: number
          patterns: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          youtube_id: string
          title?: string
          channel_id?: string
          channel_title?: string
          channel_subs?: number
          view_count?: number
          published_at?: string | null
          outlier_score?: number
          patterns?: unknown
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          youtube_id?: string
          title?: string
          channel_id?: string
          channel_title?: string
          channel_subs?: number
          view_count?: number
          published_at?: string | null
          outlier_score?: number
          patterns?: unknown
          created_at?: string
        }
        Relationships: []
      }
      video_ideas: {
        Row: {
          id: string
          user_id: string
          project_id: string
          title: string
          hook: string
          angle: string
          format: string
          difficulty: string
          safety_flag: string
          status: string
          project_ref: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          title: string
          hook?: string
          angle?: string
          format?: string
          difficulty?: string
          safety_flag?: string
          status?: string
          project_ref?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          title?: string
          hook?: string
          angle?: string
          format?: string
          difficulty?: string
          safety_flag?: string
          status?: string
          project_ref?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      youtube_api_cache: {
        Row: {
          cache_key: string
          user_id: string
          payload: Json
          expires_at: string
          created_at: string
        }
        Insert: {
          cache_key: string
          user_id: string
          payload: Json
          expires_at: string
          created_at?: string
        }
        Update: {
          cache_key?: string
          user_id?: string
          payload?: unknown
          expires_at?: string
          created_at?: string
        }
        Relationships: []
      }
      characters: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string
          reference_image_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string
          reference_image_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          description?: string
          reference_image_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      music_tracks: {
        Row: {
          id: string
          title: string
          artist: string
          mood: string
          provider: string
          provider_track_id: string | null
          preview_url: string | null
          download_url: string | null
          license: string
          license_url: string | null
          duration_secs: number | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          artist?: string
          mood: string
          provider?: string
          provider_track_id?: string | null
          preview_url?: string | null
          download_url?: string | null
          license?: string
          license_url?: string | null
          duration_secs?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          artist?: string
          mood?: string
          provider?: string
          provider_track_id?: string | null
          preview_url?: string | null
          download_url?: string | null
          license?: string
          license_url?: string | null
          duration_secs?: number | null
          created_at?: string
        }
        Relationships: []
      }
      asset_provenance: {
        Row: {
          id: string
          user_id: string
          project_id: string | null
          scene_id: string | null
          kind: string
          provider: string
          model: string | null
          prompt: string | null
          seed: string | null
          license: string | null
          license_url: string | null
          cost_credits: number
          asset_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id?: string | null
          scene_id?: string | null
          kind: string
          provider: string
          model?: string | null
          prompt?: string | null
          seed?: string | null
          license?: string | null
          license_url?: string | null
          cost_credits?: number
          asset_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string | null
          scene_id?: string | null
          kind?: string
          provider?: string
          model?: string | null
          prompt?: string | null
          seed?: string | null
          license?: string | null
          license_url?: string | null
          cost_credits?: number
          asset_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      thumbnails: {
        Row: {
          id: string
          user_id: string
          project_id: string
          variant: number
          aspect: string
          url: string
          final_url: string | null
          text_overlay: Json
          prompt: string | null
          provider: string | null
          model: string | null
          license: string
          selected: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          variant?: number
          aspect?: string
          url: string
          final_url?: string | null
          text_overlay?: Json
          prompt?: string | null
          provider?: string | null
          model?: string | null
          license?: string
          selected?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          variant?: number
          aspect?: string
          url?: string
          final_url?: string | null
          text_overlay?: Json
          prompt?: string | null
          provider?: string | null
          model?: string | null
          license?: string
          selected?: boolean
          created_at?: string
        }
        Relationships: []
      }
      seo_metadata: {
        Row: {
          id: string
          user_id: string
          project_id: string
          titles: Json
          selected_title: string | null
          description: string | null
          tags: string[]
          hashtags: string[]
          chapters: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          titles?: Json
          selected_title?: string | null
          description?: string | null
          tags?: string[]
          hashtags?: string[]
          chapters?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          titles?: Json
          selected_title?: string | null
          description?: string | null
          tags?: string[]
          hashtags?: string[]
          chapters?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      safety_scores: {
        Row: {
          id: string
          user_id: string
          project_id: string
          version: string
          score: number
          band: string
          dimensions: Json
          issues: Json
          ai_review: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          version: string
          score: number
          band: string
          dimensions?: Json
          issues?: Json
          ai_review?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          version?: string
          score?: number
          band?: string
          dimensions?: Json
          issues?: Json
          ai_review?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          slug: string
          name: string
          kind: string
          credits_granted: number
          interval: string
          price_usd_cents: number | null
          price_inr_paise: number | null
          stripe_price_id: string | null
          razorpay_plan_id: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          kind: string
          credits_granted: number
          interval?: string
          price_usd_cents?: number | null
          price_inr_paise?: number | null
          stripe_price_id?: string | null
          razorpay_plan_id?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          kind?: string
          credits_granted?: number
          interval?: string
          price_usd_cents?: number | null
          price_inr_paise?: number | null
          stripe_price_id?: string | null
          razorpay_plan_id?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          provider: string
          external_id: string
          plan_slug: string
          status: string
          current_period_start: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          external_id: string
          plan_slug: string
          status?: string
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          external_id?: string
          plan_slug?: string
          status?: string
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          id: string
          provider: string
          event_id: string
          type: string
          payload: Json
          processed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          provider: string
          event_id: string
          type: string
          payload?: Json
          processed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          provider?: string
          event_id?: string
          type?: string
          payload?: Json
          processed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      publish_jobs: {
        Row: {
          id: string
          user_id: string
          project_id: string
          video_job_id: string | null
          status: string
          thumbnail_id: string | null
          title: string | null
          description: string | null
          tags: string[]
          privacy: string
          made_for_kids: boolean | null
          scheduled_for: string | null
          youtube_video_id: string | null
          youtube_url: string | null
          error: string | null
          approved_by: string | null
          approved_at: string | null
          safety_score: number | null
          safety_override: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          video_job_id?: string | null
          status?: string
          thumbnail_id?: string | null
          title?: string | null
          description?: string | null
          tags?: string[]
          privacy?: string
          made_for_kids?: boolean | null
          scheduled_for?: string | null
          youtube_video_id?: string | null
          youtube_url?: string | null
          error?: string | null
          approved_by?: string | null
          approved_at?: string | null
          safety_score?: number | null
          safety_override?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          video_job_id?: string | null
          status?: string
          thumbnail_id?: string | null
          title?: string | null
          description?: string | null
          tags?: string[]
          privacy?: string
          made_for_kids?: boolean | null
          scheduled_for?: string | null
          youtube_video_id?: string | null
          youtube_url?: string | null
          error?: string | null
          approved_by?: string | null
          approved_at?: string | null
          safety_score?: number | null
          safety_override?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_credits: {
        Args: { p_user_id: string; p_delta: number; p_reason: string; p_admin_id?: string | null }
        Returns: number
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      debit_credits_for_job_once: {
        Args: { p_user_id: string; p_reason: string; p_job_id?: string | null }
        Returns: number
      }
      grant_credits_once: {
        Args: { p_user_id: string; p_amount: number; p_reason: string; p_ref_id?: string | null }
        Returns: number
      }
      debit_credits_amount_once: {
        Args: { p_user_id: string; p_amount: number; p_reason: string; p_ref_id?: string | null }
        Returns: number
      }
      finalize_render_billing: {
        Args: { p_render_id: string }
        Returns: Json
      }
      content_rights_approved: {
        Args: { _content_id: string }
        Returns: boolean
      }
      debit_credits_for_job: {
        Args: { p_user_id: string; p_reason: string; p_job_id?: string | null }
        Returns: number
      }
      log_abuse_signal: {
        Args: {
          p_user_id: string
          p_ip: string | null
          p_device_hash: string | null
          p_signal_type: string
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
      refund_credits: {
        Args: { p_user_id: string; p_reason: string; p_job_id?: string | null }
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
