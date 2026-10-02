// Generated from the Supabase project's schema (Supabase MCP generate_typescript_types, or
// `supabase gen types typescript --project-id fwhhgiajzrzsjeduenaj`). Regenerate after migrations.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
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
          citizen_id: string
          client_id: string | null
          closed_by_citizen_at: string | null
          device_id: string | null
          id: string
          last_accuracy_m: number | null
          last_battery_pct: number | null
          last_lat: number | null
          last_lng: number | null
          last_location_at: string | null
          ledger_batch_at: string
          resolution: string | null
          resolved_at: string | null
          source: string
          started_at: string
          status: string
        }
        Insert: {
          citizen_id: string
          client_id?: string | null
          closed_by_citizen_at?: string | null
          device_id?: string | null
          id?: string
          last_accuracy_m?: number | null
          last_battery_pct?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          ledger_batch_at?: string
          resolution?: string | null
          resolved_at?: string | null
          source: string
          started_at?: string
          status?: string
        }
        Update: {
          citizen_id?: string
          client_id?: string | null
          closed_by_citizen_at?: string | null
          device_id?: string | null
          id?: string
          last_accuracy_m?: number | null
          last_battery_pct?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          ledger_batch_at?: string
          resolution?: string | null
          resolved_at?: string | null
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'incidents_citizen_id_fkey'
            columns: ['citizen_id']
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
          name: string
          parent_id: string | null
          phone: string | null
          type: Database['public']['Enums']['org_type']
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          phone?: string | null
          type: Database['public']['Enums']['org_type']
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
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
      share_links: {
        Row: {
          citizen_id: string
          created_at: string
          expires_at: string | null
          first_viewed_at: string | null
          id: string
          incident_id: string
          token: string
        }
        Insert: {
          citizen_id: string
          created_at?: string
          expires_at?: string | null
          first_viewed_at?: string | null
          id?: string
          incident_id: string
          token?: string
        }
        Update: {
          citizen_id?: string
          created_at?: string
          expires_at?: string | null
          first_viewed_at?: string | null
          id?: string
          incident_id?: string
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
      create_sos: {
        Args: {
          p_accuracy_m?: number
          p_battery_pct?: number
          p_client_id?: string
          p_lat?: number
          p_lng?: number
        }
        Returns: Json
      }
      device_event: {
        Args: { p_body: string; p_device_id: string; p_signature: string }
        Returns: Json
      }
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
      set_sos_pins: {
        Args: {
          p_current_pin?: string
          p_duress_pin?: string
          p_sos_pin: string
        }
        Returns: Json
      }
      sos_pin_status: { Args: never; Returns: Json }
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

type DefaultSchema = Omit<Database, '__InternalSupabase'>['public']

export type Tables<T extends keyof DefaultSchema['Tables']> = DefaultSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Update']
