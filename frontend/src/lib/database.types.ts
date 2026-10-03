export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          acked_at: string | null
          attempts: number
          channel: string
          citizen_id: string
          contact_id: string | null
          created_at: string
          id: string
          incident_id: string
          last_error: string | null
          level: number
          next_attempt_at: string
          provider_ref: string | null
          recipient_name: string
          sent_at: string | null
          share_link_id: string | null
          status: string
          template: string
          updated_at: string
        }
        Insert: {
          acked_at?: string | null
          attempts?: number
          channel: string
          citizen_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          incident_id: string
          last_error?: string | null
          level?: number
          next_attempt_at?: string
          provider_ref?: string | null
          recipient_name: string
          sent_at?: string | null
          share_link_id?: string | null
          status?: string
          template: string
          updated_at?: string
        }
        Update: {
          acked_at?: string | null
          attempts?: number
          channel?: string
          citizen_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          incident_id?: string
          last_error?: string | null
          level?: number
          next_attempt_at?: string
          provider_ref?: string | null
          recipient_name?: string
          sent_at?: string | null
          share_link_id?: string | null
          status?: string
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'alerts_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'alerts_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'trusted_contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'alerts_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'alerts_share_link_id_fkey'
            columns: ['share_link_id']
            isOneToOne: false
            referencedRelation: 'share_links'
            referencedColumns: ['id']
          },
        ]
      }
      device_events: {
        Row: {
          accuracy_m: number | null
          battery_pct: number | null
          device_id: string
          id: number
          incident_id: string | null
          lat: number | null
          lng: number | null
          nonce: string
          occurred_at: string
          owner_id: string
          payload: Json
          received_at: string
          type: string
        }
        Insert: {
          accuracy_m?: number | null
          battery_pct?: number | null
          device_id: string
          id?: never
          incident_id?: string | null
          lat?: number | null
          lng?: number | null
          nonce: string
          occurred_at: string
          owner_id: string
          payload?: Json
          received_at?: string
          type: string
        }
        Update: {
          accuracy_m?: number | null
          battery_pct?: number | null
          device_id?: string
          id?: never
          incident_id?: string | null
          lat?: number | null
          lng?: number | null
          nonce?: string
          occurred_at?: string
          owner_id?: string
          payload?: Json
          received_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'device_events_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'device_events_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'device_events_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      devices: {
        Row: {
          battery_pct: number | null
          created_at: string
          id: string
          kind: string
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string | null
          name: string
          owner_id: string
          status: string
        }
        Insert: {
          battery_pct?: number | null
          created_at?: string
          id?: string
          kind: string
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string | null
          name: string
          owner_id: string
          status?: string
        }
        Update: {
          battery_pct?: number | null
          created_at?: string
          id?: string
          kind?: string
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string | null
          name?: string
          owner_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'devices_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      escalation_policies: {
        Row: {
          id: string
          levels: Json
          org_id: string | null
          repeat_s: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          levels: Json
          org_id?: string | null
          repeat_s?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          levels?: Json
          org_id?: string | null
          repeat_s?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'escalation_policies_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'escalation_policies_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      incident_escalations: {
        Row: {
          at: string
          id: number
          incident_id: string
          level: number
          org_id: string | null
          target: string
        }
        Insert: {
          at?: string
          id?: never
          incident_id: string
          level: number
          org_id?: string | null
          target: string
        }
        Update: {
          at?: string
          id?: never
          incident_id?: string
          level?: number
          org_id?: string | null
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: 'incident_escalations_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incident_escalations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      incident_responders: {
        Row: {
          citizen_id: string
          created_at: string
          id: string
          incident_id: string
          name: string
          share_link_id: string | null
        }
        Insert: {
          citizen_id: string
          created_at?: string
          id?: string
          incident_id: string
          name: string
          share_link_id?: string | null
        }
        Update: {
          citizen_id?: string
          created_at?: string
          id?: string
          incident_id?: string
          name?: string
          share_link_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'incident_responders_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incident_responders_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incident_responders_share_link_id_fkey'
            columns: ['share_link_id']
            isOneToOne: false
            referencedRelation: 'share_links'
            referencedColumns: ['id']
          },
        ]
      }
      incidents: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          arrived_at: string | null
          assigned_org_id: string | null
          citizen_id: string
          client_id: string | null
          close_code: string | null
          close_note: string | null
          closed_by: string | null
          closed_by_citizen_at: string | null
          device_id: string | null
          dispatched_at: string | null
          escalated_at: string | null
          escalation_level: number
          eta_at: string | null
          id: string
          is_demo: boolean
          last_accuracy_m: number | null
          last_battery_pct: number | null
          last_lat: number | null
          last_lng: number | null
          last_location_at: string | null
          ledger_batch_at: string
          live_topic: string
          resolution: string | null
          resolved_at: string | null
          response_state: string
          routed_at: string | null
          source: string
          started_at: string
          status: string
          unit_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          arrived_at?: string | null
          assigned_org_id?: string | null
          citizen_id: string
          client_id?: string | null
          close_code?: string | null
          close_note?: string | null
          closed_by?: string | null
          closed_by_citizen_at?: string | null
          device_id?: string | null
          dispatched_at?: string | null
          escalated_at?: string | null
          escalation_level?: number
          eta_at?: string | null
          id?: string
          is_demo?: boolean
          last_accuracy_m?: number | null
          last_battery_pct?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          ledger_batch_at?: string
          live_topic?: string
          resolution?: string | null
          resolved_at?: string | null
          response_state?: string
          routed_at?: string | null
          source: string
          started_at?: string
          status?: string
          unit_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          arrived_at?: string | null
          assigned_org_id?: string | null
          citizen_id?: string
          client_id?: string | null
          close_code?: string | null
          close_note?: string | null
          closed_by?: string | null
          closed_by_citizen_at?: string | null
          device_id?: string | null
          dispatched_at?: string | null
          escalated_at?: string | null
          escalation_level?: number
          eta_at?: string | null
          id?: string
          is_demo?: boolean
          last_accuracy_m?: number | null
          last_battery_pct?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          ledger_batch_at?: string
          live_topic?: string
          resolution?: string | null
          resolved_at?: string | null
          response_state?: string
          routed_at?: string | null
          source?: string
          started_at?: string
          status?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'incidents_acknowledged_by_fkey'
            columns: ['acknowledged_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incidents_assigned_org_id_fkey'
            columns: ['assigned_org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incidents_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incidents_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incidents_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'incidents_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'patrol_units'
            referencedColumns: ['id']
          },
        ]
      }
      ledger_entries: {
        Row: {
          accuracy_m: number | null
          action: string
          actor_id: string | null
          actor_role: string | null
          device_id: string | null
          entry_hash: string
          id: string
          lat: number | null
          lng: number | null
          occurred_at: string
          payload: Json
          payload_hash: string
          prev_hash: string
          recorded_at: string
          seq: number
          subject_id: string | null
          subject_type: string
        }
        Insert: {
          accuracy_m?: number | null
          action: string
          actor_id?: string | null
          actor_role?: string | null
          device_id?: string | null
          entry_hash: string
          id?: string
          lat?: number | null
          lng?: number | null
          occurred_at: string
          payload?: Json
          payload_hash: string
          prev_hash: string
          recorded_at: string
          seq: number
          subject_id?: string | null
          subject_type: string
        }
        Update: {
          accuracy_m?: number | null
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          device_id?: string | null
          entry_hash?: string
          id?: string
          lat?: number | null
          lng?: number | null
          occurred_at?: string
          payload?: Json
          payload_hash?: string
          prev_hash?: string
          recorded_at?: string
          seq?: number
          subject_id?: string | null
          subject_type?: string
        }
        Relationships: []
      }
      location_pings: {
        Row: {
          accuracy_m: number | null
          at: string
          battery_pct: number | null
          citizen_id: string
          heading_deg: number | null
          id: number
          incident_id: string
          lat: number
          lng: number
          source: string
          speed_mps: number | null
        }
        Insert: {
          accuracy_m?: number | null
          at?: string
          battery_pct?: number | null
          citizen_id: string
          heading_deg?: number | null
          id?: never
          incident_id: string
          lat: number
          lng: number
          source: string
          speed_mps?: number | null
        }
        Update: {
          accuracy_m?: number | null
          at?: string
          battery_pct?: number | null
          citizen_id?: string
          heading_deg?: number | null
          id?: never
          incident_id?: string
          lat?: number
          lng?: number
          source?: string
          speed_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'location_pings_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'location_pings_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
        ]
      }
      memberships: {
        Row: {
          badge_no: string | null
          created_at: string
          on_duty: boolean
          org_id: string
          role: Database['public']['Enums']['membership_role']
          user_id: string
        }
        Insert: {
          badge_no?: string | null
          created_at?: string
          on_duty?: boolean
          org_id: string
          role?: Database['public']['Enums']['membership_role']
          user_id: string
        }
        Update: {
          badge_no?: string | null
          created_at?: string
          on_duty?: boolean
          org_id?: string
          role?: Database['public']['Enums']['membership_role']
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'memberships_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'memberships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          jurisdiction: unknown
          location: unknown
          name: string
          parent_id: string | null
          phone: string | null
          type: Database['public']['Enums']['org_type']
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          jurisdiction?: unknown
          location?: unknown
          name: string
          parent_id?: string | null
          phone?: string | null
          type: Database['public']['Enums']['org_type']
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          jurisdiction?: unknown
          location?: unknown
          name?: string
          parent_id?: string | null
          phone?: string | null
          type?: Database['public']['Enums']['org_type']
        }
        Relationships: [
          {
            foreignKeyName: 'organizations_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      patrol_units: {
        Row: {
          call_sign: string
          created_at: string
          id: string
          kind: string
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string | null
          org_id: string
          status: string
        }
        Insert: {
          call_sign: string
          created_at?: string
          id?: string
          kind?: string
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string | null
          org_id: string
          status?: string
        }
        Update: {
          call_sign?: string
          created_at?: string
          id?: string
          kind?: string
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string | null
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'patrol_units_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          locale: string
          phone: string | null
          role: Database['public']['Enums']['app_role']
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          phone?: string | null
          role?: Database['public']['Enums']['app_role']
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          phone?: string | null
          role?: Database['public']['Enums']['app_role']
          updated_at?: string
        }
        Relationships: []
      }
      safe_points: {
        Row: {
          address: string | null
          category: string
          created_at: string
          id: string
          lat: number
          lng: number
          name: string
          opening_hours: string | null
          osm_ref: string | null
          phone: string | null
          source: string
          verified: boolean
        }
        Insert: {
          address?: string | null
          category: string
          created_at?: string
          id?: string
          lat: number
          lng: number
          name: string
          opening_hours?: string | null
          osm_ref?: string | null
          phone?: string | null
          source: string
          verified?: boolean
        }
        Update: {
          address?: string | null
          category?: string
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          name?: string
          opening_hours?: string | null
          osm_ref?: string | null
          phone?: string | null
          source?: string
          verified?: boolean
        }
        Relationships: []
      }
      share_links: {
        Row: {
          audience: string
          citizen_id: string
          contact_id: string | null
          created_at: string
          expires_at: string | null
          first_viewed_at: string | null
          id: string
          incident_id: string
          recipient_name: string | null
          token: string
        }
        Insert: {
          audience?: string
          citizen_id: string
          contact_id?: string | null
          created_at?: string
          expires_at?: string | null
          first_viewed_at?: string | null
          id?: string
          incident_id: string
          recipient_name?: string | null
          token?: string
        }
        Update: {
          audience?: string
          citizen_id?: string
          contact_id?: string | null
          created_at?: string
          expires_at?: string | null
          first_viewed_at?: string | null
          id?: string
          incident_id?: string
          recipient_name?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: 'share_links_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'share_links_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'trusted_contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'share_links_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
        ]
      }
      trusted_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          owner_id: string
          phone: string | null
          priority: number
          relationship: string | null
          telegram_code: string
          telegram_linked_at: string | null
          telegram_username: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          owner_id?: string
          phone?: string | null
          priority?: number
          relationship?: string | null
          telegram_code?: string
          telegram_linked_at?: string | null
          telegram_username?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          priority?: number
          relationship?: string | null
          telegram_code?: string
          telegram_linked_at?: string | null
          telegram_username?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trusted_contacts_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_incident: { Args: { p_incident_id: string }; Returns: Json }
      admin_load_demo_incidents: { Args: never; Returns: number }
      admin_set_escalation_policy: {
        Args: { p_levels: Json; p_org_id: string; p_repeat_s: number }
        Returns: {
          id: string
          levels: Json
          org_id: string | null
          repeat_s: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'escalation_policies'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_role: {
        Args: {
          p_role: Database['public']['Enums']['app_role']
          p_user_id: string
        }
        Returns: {
          created_at: string
          full_name: string | null
          id: string
          locale: string
          phone: string | null
          role: Database['public']['Enums']['app_role']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'profiles'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_alerts: {
        Args: { p_limit?: number }
        Returns: {
          address: string
          alert_id: string
          attempts: number
          channel: string
          citizen_name: string
          citizen_phone: string
          incident_status: string
          lat: number
          level: number
          link_token: string
          lng: number
          location_at: string
          recipient_name: string
          source: string
          started_at: string
          template: string
        }[]
      }
      close_incident: {
        Args: { p_code: string; p_incident_id: string; p_note?: string }
        Returns: Json
      }
      console_board: { Args: never; Returns: Json }
      console_incident: { Args: { p_incident_id: string }; Returns: Json }
      create_sos: {
        Args: {
          p_accuracy_m?: number
          p_battery_pct?: number
          p_client_id?: string
          p_lat?: number
          p_lng?: number
          p_occurred_at?: string
        }
        Returns: Json
      }
      device_event: {
        Args: { p_body: string; p_device_id: string; p_signature: string }
        Returns: Json
      }
      disconnect_telegram: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      dispatch_unit: {
        Args: {
          p_eta_minutes: number
          p_incident_id: string
          p_unit_id: string
        }
        Returns: Json
      }
      finish_alert: {
        Args: {
          p_alert_id: string
          p_error?: string
          p_outcome: string
          p_provider_ref?: string
          p_retry?: boolean
        }
        Returns: string
      }
      incident_response: { Args: { p_incident_id: string }; Returns: Json }
      incident_timeline: {
        Args: { p_incident_id: string }
        Returns: {
          action: string
          actor_role: string
          lat: number
          lng: number
          occurred_at: string
          payload: Json
          seq: number
        }[]
      }
      ledger_verify: {
        Args: { p_from_seq?: number }
        Returns: {
          checked: number
          first_bad_seq: number
          ok: boolean
          reason: string
        }[]
      }
      link_telegram: {
        Args: { p_chat_id: number; p_code: string; p_username?: string }
        Returns: Json
      }
      mark_on_scene: { Args: { p_incident_id: string }; Returns: Json }
      nearby_safe_points: {
        Args: {
          p_lat: number
          p_lng: number
          p_per_category?: number
          p_radius_m?: number
        }
        Returns: {
          address: string
          category: string
          distance_m: number
          id: string
          lat: number
          lng: number
          name: string
          phone: string
        }[]
      }
      record_location: {
        Args: {
          p_accuracy_m?: number
          p_battery_pct?: number
          p_heading_deg?: number
          p_incident_id: string
          p_lat: number
          p_lng: number
          p_speed_mps?: number
        }
        Returns: undefined
      }
      register_device: {
        Args: { p_kind?: string; p_name: string }
        Returns: Json
      }
      reset_device_secret: { Args: { p_device_id: string }; Returns: Json }
      resolve_incident: {
        Args: { p_incident_id: string; p_pin?: string; p_resolution?: string }
        Returns: Json
      }
      respond_to_share_link: {
        Args: { p_name: string; p_token: string }
        Returns: Json
      }
      set_on_duty: {
        Args: { p_on_duty: boolean; p_org_id: string }
        Returns: undefined
      }
      set_sos_pins: {
        Args: {
          p_current_pin?: string
          p_duress_pin?: string
          p_sos_pin: string
        }
        Returns: Json
      }
      sos_pin_status: { Args: never; Returns: Json }
      unlink_telegram_chat: { Args: { p_chat_id: number }; Returns: number }
      view_share_link: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      app_role: 'citizen' | 'officer' | 'supervisor' | 'oversight' | 'admin'
      membership_role: 'officer' | 'supervisor' | 'dispatcher'
      org_type: 'police_station' | 'campus_security' | 'control_room'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ['citizen', 'officer', 'supervisor', 'oversight', 'admin'],
      membership_role: ['officer', 'supervisor', 'dispatcher'],
      org_type: ['police_station', 'campus_security', 'control_room'],
    },
  },
} as const
