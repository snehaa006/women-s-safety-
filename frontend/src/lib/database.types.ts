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
      case_events: {
        Row: {
          accuracy_m: number | null
          author_id: string
          body: string | null
          case_id: string
          created_at: string
          distance_m: number | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          within_geofence: boolean | null
        }
        Insert: {
          accuracy_m?: number | null
          author_id: string
          body?: string | null
          case_id: string
          created_at?: string
          distance_m?: number | null
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          within_geofence?: boolean | null
        }
        Update: {
          accuracy_m?: number | null
          author_id?: string
          body?: string | null
          case_id?: string
          created_at?: string
          distance_m?: number | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          within_geofence?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: 'case_events_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'case_events_case_id_fkey'
            columns: ['case_id']
            isOneToOne: false
            referencedRelation: 'cases'
            referencedColumns: ['id']
          },
        ]
      }
      case_evidence: {
        Row: {
          added_at: string
          added_by: string | null
          case_id: string
          custodian_id: string | null
          evidence_id: string
          locked_at: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          case_id: string
          custodian_id?: string | null
          evidence_id: string
          locked_at?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          case_id?: string
          custodian_id?: string | null
          evidence_id?: string
          locked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'case_evidence_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'case_evidence_case_id_fkey'
            columns: ['case_id']
            isOneToOne: false
            referencedRelation: 'cases'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'case_evidence_custodian_id_fkey'
            columns: ['custodian_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'case_evidence_evidence_id_fkey'
            columns: ['evidence_id']
            isOneToOne: false
            referencedRelation: 'evidence_items'
            referencedColumns: ['id']
          },
        ]
      }
      cases: {
        Row: {
          complaint_id: string | null
          created_at: string
          created_by: string | null
          id: string
          incident_id: string | null
          lat: number | null
          lead_officer_id: string
          lng: number | null
          org_id: string
          reference: string
          state: string
          status: string
          title: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          complaint_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id?: string | null
          lat?: number | null
          lead_officer_id: string
          lng?: number | null
          org_id: string
          reference: string
          state: string
          status?: string
          title: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          complaint_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id?: string | null
          lat?: number | null
          lead_officer_id?: string
          lng?: number | null
          org_id?: string
          reference?: string
          state?: string
          status?: string
          title?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cases_complaint_id_fkey'
            columns: ['complaint_id']
            isOneToOne: false
            referencedRelation: 'complaints'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cases_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cases_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cases_lead_officer_id_fkey'
            columns: ['lead_officer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cases_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cases_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflow_definitions'
            referencedColumns: ['id']
          },
        ]
      }
      complaint_sla: {
        Row: {
          ack_s: number
          severity: number
        }
        Insert: {
          ack_s: number
          severity: number
        }
        Update: {
          ack_s?: number
          severity?: number
        }
        Relationships: []
      }
      complaints: {
        Row: {
          accuracy_m: number | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          ai: Json | null
          alias: string
          assigned_org_id: string | null
          baseline_severity: number
          category: string
          citizen_id: string
          client_id: string | null
          confidential: boolean
          created_at: string
          description: string
          escalated_at: string | null
          escalation_level: number
          id: string
          identity_shared_at: string | null
          incident_id: string | null
          input_mode: string
          is_demo: boolean
          lat: number | null
          lng: number | null
          occurred_at: string | null
          outcome_note: string | null
          reference: string
          resolved_at: string | null
          routed_how: string | null
          rules: Json
          severity: number
          sla_due_at: string
          status: string
          triage_attempts: number
          triage_claimed_at: string | null
          triage_state: string
          updated_at: string
        }
        Insert: {
          accuracy_m?: number | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          ai?: Json | null
          alias: string
          assigned_org_id?: string | null
          baseline_severity: number
          category: string
          citizen_id: string
          client_id?: string | null
          confidential?: boolean
          created_at?: string
          description: string
          escalated_at?: string | null
          escalation_level?: number
          id?: string
          identity_shared_at?: string | null
          incident_id?: string | null
          input_mode?: string
          is_demo?: boolean
          lat?: number | null
          lng?: number | null
          occurred_at?: string | null
          outcome_note?: string | null
          reference: string
          resolved_at?: string | null
          routed_how?: string | null
          rules: Json
          severity: number
          sla_due_at: string
          status?: string
          triage_attempts?: number
          triage_claimed_at?: string | null
          triage_state?: string
          updated_at?: string
        }
        Update: {
          accuracy_m?: number | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          ai?: Json | null
          alias?: string
          assigned_org_id?: string | null
          baseline_severity?: number
          category?: string
          citizen_id?: string
          client_id?: string | null
          confidential?: boolean
          created_at?: string
          description?: string
          escalated_at?: string | null
          escalation_level?: number
          id?: string
          identity_shared_at?: string | null
          incident_id?: string | null
          input_mode?: string
          is_demo?: boolean
          lat?: number | null
          lng?: number | null
          occurred_at?: string | null
          outcome_note?: string | null
          reference?: string
          resolved_at?: string | null
          routed_how?: string | null
          rules?: Json
          severity?: number
          sla_due_at?: string
          status?: string
          triage_attempts?: number
          triage_claimed_at?: string | null
          triage_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'complaints_acknowledged_by_fkey'
            columns: ['acknowledged_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'complaints_assigned_org_id_fkey'
            columns: ['assigned_org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'complaints_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'complaints_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
        ]
      }
      custody_transfers: {
        Row: {
          accepted_at: string | null
          case_id: string
          completed_at: string | null
          evidence_id: string
          from_user: string
          id: string
          initiated_at: string
          reason: string
          rehash_ok: boolean | null
          rehash_sha256: string | null
          status: string
          to_user: string
        }
        Insert: {
          accepted_at?: string | null
          case_id: string
          completed_at?: string | null
          evidence_id: string
          from_user: string
          id?: string
          initiated_at?: string
          reason: string
          rehash_ok?: boolean | null
          rehash_sha256?: string | null
          status?: string
          to_user: string
        }
        Update: {
          accepted_at?: string | null
          case_id?: string
          completed_at?: string | null
          evidence_id?: string
          from_user?: string
          id?: string
          initiated_at?: string
          reason?: string
          rehash_ok?: boolean | null
          rehash_sha256?: string | null
          status?: string
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: 'custody_transfers_case_id_evidence_id_fkey'
            columns: ['case_id', 'evidence_id']
            isOneToOne: false
            referencedRelation: 'case_evidence'
            referencedColumns: ['case_id', 'evidence_id']
          },
          {
            foreignKeyName: 'custody_transfers_from_user_fkey'
            columns: ['from_user']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'custody_transfers_to_user_fkey'
            columns: ['to_user']
            isOneToOne: false
            referencedRelation: 'profiles'
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
      evidence_items: {
        Row: {
          accuracy_m: number | null
          captured_at: string | null
          client_id: string | null
          complaint_id: string | null
          created_at: string
          delete_after: string | null
          deleted_at: string | null
          file_name: string
          id: string
          incident_id: string | null
          kind: string
          lat: number | null
          lng: number | null
          mime_type: string
          note: string | null
          owner_id: string
          reject_reason: string | null
          sealed_at: string | null
          sealed_seq: number | null
          sha256: string
          shared_at: string | null
          size_bytes: number
          source: string
          status: string
          storage_path: string
          updated_at: string
          uploaded_at: string | null
        }
        Insert: {
          accuracy_m?: number | null
          captured_at?: string | null
          client_id?: string | null
          complaint_id?: string | null
          created_at?: string
          delete_after?: string | null
          deleted_at?: string | null
          file_name: string
          id?: string
          incident_id?: string | null
          kind?: string
          lat?: number | null
          lng?: number | null
          mime_type: string
          note?: string | null
          owner_id: string
          reject_reason?: string | null
          sealed_at?: string | null
          sealed_seq?: number | null
          sha256: string
          shared_at?: string | null
          size_bytes: number
          source?: string
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_at?: string | null
        }
        Update: {
          accuracy_m?: number | null
          captured_at?: string | null
          client_id?: string | null
          complaint_id?: string | null
          created_at?: string
          delete_after?: string | null
          deleted_at?: string | null
          file_name?: string
          id?: string
          incident_id?: string | null
          kind?: string
          lat?: number | null
          lng?: number | null
          mime_type?: string
          note?: string | null
          owner_id?: string
          reject_reason?: string | null
          sealed_at?: string | null
          sealed_seq?: number | null
          sha256?: string
          shared_at?: string | null
          size_bytes?: number
          source?: string
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'evidence_items_complaint_id_fkey'
            columns: ['complaint_id']
            isOneToOne: false
            referencedRelation: 'complaints'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'evidence_items_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'evidence_items_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      evidence_signatures: {
        Row: {
          capacity: string
          case_id: string
          evidence_id: string
          id: string
          key_fingerprint: string
          material: string
          payload_sha256: string
          purpose: string
          signature: string
          signed_at: string
          signer_id: string
          transfer_id: string | null
        }
        Insert: {
          capacity: string
          case_id: string
          evidence_id: string
          id?: string
          key_fingerprint: string
          material: string
          payload_sha256: string
          purpose: string
          signature: string
          signed_at?: string
          signer_id: string
          transfer_id?: string | null
        }
        Update: {
          capacity?: string
          case_id?: string
          evidence_id?: string
          id?: string
          key_fingerprint?: string
          material?: string
          payload_sha256?: string
          purpose?: string
          signature?: string
          signed_at?: string
          signer_id?: string
          transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'evidence_signatures_case_id_evidence_id_fkey'
            columns: ['case_id', 'evidence_id']
            isOneToOne: false
            referencedRelation: 'case_evidence'
            referencedColumns: ['case_id', 'evidence_id']
          },
          {
            foreignKeyName: 'evidence_signatures_signer_id_fkey'
            columns: ['signer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'evidence_signatures_transfer_id_fkey'
            columns: ['transfer_id']
            isOneToOne: false
            referencedRelation: 'custody_transfers'
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
      journey_points: {
        Row: {
          accuracy_m: number | null
          at: string
          id: number
          journey_id: string
          lat: number
          lng: number
        }
        Insert: {
          accuracy_m?: number | null
          at?: string
          id?: never
          journey_id: string
          lat: number
          lng: number
        }
        Update: {
          accuracy_m?: number | null
          at?: string
          id?: never
          journey_id?: string
          lat?: number
          lng?: number
        }
        Relationships: [
          {
            foreignKeyName: 'journey_points_journey_id_fkey'
            columns: ['journey_id']
            isOneToOne: false
            referencedRelation: 'journeys'
            referencedColumns: ['id']
          },
        ]
      }
      journeys: {
        Row: {
          check_in_due_at: string | null
          check_in_reason: string | null
          citizen_id: string
          client_id: string | null
          created_at: string
          dest_lat: number
          dest_lng: number
          dest_name: string | null
          ended_at: string | null
          escalation_reason: string | null
          expected_arrival_at: string | null
          id: string
          incident_id: string | null
          last_accuracy_m: number | null
          last_lat: number | null
          last_lng: number | null
          last_moved_at: string | null
          last_ping_at: string | null
          monitoring: string
          moved_lat: number | null
          moved_lng: number | null
          off_route_m: number | null
          off_route_since: string | null
          route: unknown
          route_label: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          check_in_due_at?: string | null
          check_in_reason?: string | null
          citizen_id: string
          client_id?: string | null
          created_at?: string
          dest_lat: number
          dest_lng: number
          dest_name?: string | null
          ended_at?: string | null
          escalation_reason?: string | null
          expected_arrival_at?: string | null
          id?: string
          incident_id?: string | null
          last_accuracy_m?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_moved_at?: string | null
          last_ping_at?: string | null
          monitoring?: string
          moved_lat?: number | null
          moved_lng?: number | null
          off_route_m?: number | null
          off_route_since?: string | null
          route?: unknown
          route_label?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          check_in_due_at?: string | null
          check_in_reason?: string | null
          citizen_id?: string
          client_id?: string | null
          created_at?: string
          dest_lat?: number
          dest_lng?: number
          dest_name?: string | null
          ended_at?: string | null
          escalation_reason?: string | null
          expected_arrival_at?: string | null
          id?: string
          incident_id?: string | null
          last_accuracy_m?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_moved_at?: string | null
          last_ping_at?: string | null
          monitoring?: string
          moved_lat?: number | null
          moved_lng?: number | null
          off_route_m?: number | null
          off_route_since?: string | null
          route?: unknown
          route_label?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'journeys_citizen_id_fkey'
            columns: ['citizen_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'journeys_incident_id_fkey'
            columns: ['incident_id']
            isOneToOne: false
            referencedRelation: 'incidents'
            referencedColumns: ['id']
          },
        ]
      }
      ledger_anchors: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          from_seq: number
          id: string
          last_error: string | null
          leaf_count: number
          merkle_root: string
          ots_calendar: string | null
          ots_receipt: string | null
          ots_status: string
          submitted_at: string | null
          to_seq: number
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          from_seq: number
          id?: string
          last_error?: string | null
          leaf_count: number
          merkle_root: string
          ots_calendar?: string | null
          ots_receipt?: string | null
          ots_status?: string
          submitted_at?: string | null
          to_seq: number
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          from_seq?: number
          id?: string
          last_error?: string | null
          leaf_count?: number
          merkle_root?: string
          ots_calendar?: string | null
          ots_receipt?: string | null
          ots_status?: string
          submitted_at?: string | null
          to_seq?: number
        }
        Relationships: []
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
      risk_cells: {
        Row: {
          cell_x: number
          cell_y: number
          computed_at: string
          factors: Json
          level: string
          period: string
          score: number
          signals: number
        }
        Insert: {
          cell_x: number
          cell_y: number
          computed_at: string
          factors?: Json
          level: string
          period: string
          score: number
          signals: number
        }
        Update: {
          cell_x?: number
          cell_y?: number
          computed_at?: string
          factors?: Json
          level?: string
          period?: string
          score?: number
          signals?: number
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
      severity_overrides: {
        Row: {
          baseline_severity: number
          complaint_id: string
          created_at: string
          from_severity: number
          id: string
          justification: string
          officer_id: string
          org_id: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          to_severity: number
        }
        Insert: {
          baseline_severity: number
          complaint_id: string
          created_at?: string
          from_severity: number
          id?: string
          justification: string
          officer_id: string
          org_id?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          to_severity: number
        }
        Update: {
          baseline_severity?: number
          complaint_id?: string
          created_at?: string
          from_severity?: number
          id?: string
          justification?: string
          officer_id?: string
          org_id?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          to_severity?: number
        }
        Relationships: [
          {
            foreignKeyName: 'severity_overrides_complaint_id_fkey'
            columns: ['complaint_id']
            isOneToOne: false
            referencedRelation: 'complaints'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'severity_overrides_officer_id_fkey'
            columns: ['officer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'severity_overrides_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'severity_overrides_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
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
      workflow_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key: string
          name: string
          states: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          name: string
          states: Json
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          name?: string
          states?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      zone_reports: {
        Row: {
          at_night: boolean
          created_at: string
          id: string
          is_demo: boolean
          kind: string
          lat: number
          lng: number
          note: string | null
          reporter_id: string | null
        }
        Insert: {
          at_night: boolean
          created_at?: string
          id?: string
          is_demo?: boolean
          kind: string
          lat: number
          lng: number
          note?: string | null
          reporter_id?: string | null
        }
        Update: {
          at_night?: boolean
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string
          lat?: number
          lng?: number
          note?: string | null
          reporter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'zone_reports_reporter_id_fkey'
            columns: ['reporter_id']
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
      acknowledge_complaint: { Args: { p_complaint_id: string }; Returns: Json }
      acknowledge_incident: { Args: { p_incident_id: string }; Returns: Json }
      add_case_note: {
        Args: { p_body: string; p_case_id: string; p_kind: string }
        Returns: Json
      }
      admin_load_demo_complaints: { Args: never; Returns: number }
      admin_load_demo_incidents: { Args: never; Returns: number }
      admin_save_workflow: {
        Args: { p_key: string; p_name: string; p_states: Json }
        Returns: Json
      }
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
      advance_case: {
        Args: { p_case_id: string; p_to_state: string }
        Returns: Json
      }
      cancel_evidence_deletion: {
        Args: { p_evidence_id: string }
        Returns: undefined
      }
      case_checkin: {
        Args: {
          p_accuracy_m?: number
          p_case_id: string
          p_lat: number
          p_lng: number
        }
        Returns: Json
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
      claim_anchors: {
        Args: { p_limit?: number }
        Returns: {
          anchor_id: string
          merkle_root: string
        }[]
      }
      claim_evidence_checks: {
        Args: { p_limit?: number }
        Returns: {
          check_id: string
          evidence_id: string
          purpose: string
          sha256: string
          size_bytes: number
          storage_path: string
        }[]
      }
      claim_triage: {
        Args: { p_limit?: number }
        Returns: {
          complaint_id: string
          created_at: string
          description: string
          occurred_at: string
          rules: Json
        }[]
      }
      close_incident: {
        Args: { p_code: string; p_incident_id: string; p_note?: string }
        Returns: Json
      }
      complaint_timeline: {
        Args: { p_complaint_id: string }
        Returns: {
          action: string
          occurred_at: string
          payload: Json
          seq: number
        }[]
      }
      confirm_evidence_upload: {
        Args: { p_evidence_id: string }
        Returns: Json
      }
      console_board: { Args: never; Returns: Json }
      console_case: { Args: { p_case_id: string }; Returns: Json }
      console_cases: { Args: never; Returns: Json }
      console_complaint: { Args: { p_complaint_id: string }; Returns: Json }
      console_complaints: { Args: never; Returns: Json }
      console_evidence: {
        Args: { p_case_id: string; p_evidence_id: string }
        Returns: Json
      }
      console_incident: { Args: { p_incident_id: string }; Returns: Json }
      console_reviews: { Args: never; Returns: Json }
      console_workflows: { Args: never; Returns: Json }
      create_complaint: {
        Args: {
          p_accuracy_m?: number
          p_client_id?: string
          p_confidential?: boolean
          p_description: string
          p_incident_id?: string
          p_input_mode?: string
          p_lat?: number
          p_lng?: number
          p_occurred_at?: string
        }
        Returns: Json
      }
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
      end_journey: {
        Args: { p_arrived?: boolean; p_journey_id: string }
        Returns: Json
      }
      evidence_timeline: {
        Args: { p_evidence_id: string }
        Returns: {
          action: string
          occurred_at: string
          payload: Json
          seq: number
        }[]
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
      finish_anchor: {
        Args: {
          p_anchor_id: string
          p_calendar?: string
          p_error?: string
          p_receipt?: string
        }
        Returns: undefined
      }
      finish_evidence_check: {
        Args: {
          p_check_id: string
          p_error?: string
          p_retry?: boolean
          p_sha256?: string
          p_size_bytes?: number
        }
        Returns: Json
      }
      finish_triage: {
        Args: {
          p_complaint_id: string
          p_error?: string
          p_outcome: string
          p_result?: Json
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
      journey_check_in: {
        Args: { p_journey_id: string; p_pin?: string }
        Returns: Json
      }
      journey_ping: {
        Args: {
          p_accuracy_m?: number
          p_journey_id: string
          p_lat: number
          p_lng: number
        }
        Returns: Json
      }
      journey_view: { Args: { p_journey_id: string }; Returns: Json }
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
      open_case: {
        Args: {
          p_complaint_id?: string
          p_incident_id?: string
          p_title: string
          p_workflow_key?: string
        }
        Returns: Json
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
      register_evidence: {
        Args: {
          p_accuracy_m?: number
          p_captured_at?: string
          p_case_id?: string
          p_client_id?: string
          p_file_name: string
          p_kind?: string
          p_lat?: number
          p_lng?: number
          p_mime_type: string
          p_note?: string
          p_sha256: string
          p_size_bytes: number
          p_source?: string
        }
        Returns: Json
      }
      report_zone: {
        Args: {
          p_at_night?: boolean
          p_kind: string
          p_lat: number
          p_lng: number
          p_note?: string
        }
        Returns: Json
      }
      request_evidence_deletion: {
        Args: { p_evidence_id: string }
        Returns: Json
      }
      reset_device_secret: { Args: { p_device_id: string }; Returns: Json }
      resolve_incident: {
        Args: { p_incident_id: string; p_pin?: string; p_resolution?: string }
        Returns: Json
      }
      respond_custody_transfer: {
        Args: { p_decision: string; p_transfer_id: string }
        Returns: Json
      }
      respond_to_share_link: {
        Args: { p_name: string; p_token: string }
        Returns: Json
      }
      review_override: {
        Args: { p_decision: string; p_note?: string; p_override_id: string }
        Returns: Json
      }
      risk_map: { Args: { p_period?: string }; Returns: Json }
      score_routes: { Args: { p_at?: string; p_routes: Json }; Returns: Json }
      set_complaint_severity: {
        Args: {
          p_complaint_id: string
          p_justification?: string
          p_severity: number
        }
        Returns: Json
      }
      set_complaint_status: {
        Args: { p_complaint_id: string; p_note?: string; p_status: string }
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
      share_complaint_identity: {
        Args: { p_complaint_id: string }
        Returns: undefined
      }
      share_evidence: {
        Args: {
          p_complaint_id?: string
          p_evidence_id: string
          p_incident_id?: string
        }
        Returns: Json
      }
      sign_evidence_lock: {
        Args: { p_case_id: string; p_evidence_id: string }
        Returns: Json
      }
      sos_pin_status: { Args: never; Returns: Json }
      start_custody_transfer: {
        Args: {
          p_case_id: string
          p_evidence_id: string
          p_reason: string
          p_to_user: string
        }
        Returns: Json
      }
      start_journey: {
        Args: {
          p_client_id?: string
          p_dest_lat: number
          p_dest_lng: number
          p_dest_name?: string
          p_expected_minutes?: number
          p_lat?: number
          p_lng?: number
          p_route?: Json
          p_route_label?: string
        }
        Returns: Json
      }
      triage_preview: { Args: { p_text: string }; Returns: Json }
      unlink_telegram_chat: { Args: { p_chat_id: number }; Returns: number }
      vault_item: { Args: { p_evidence_id: string }; Returns: Json }
      verify_evidence: { Args: { p_sha256: string }; Returns: Json }
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
