import type { RouteObject } from 'react-router'

import { PlaceholderPage } from '@/components/placeholder-page'
import { STAFF_ROLES } from '@/lib/roles'

import { RequireRole } from './guards'
import { CitizenLayout } from './layouts/citizen-layout'
import { ConsoleLayout } from './layouts/console-layout'
import { ContactLayout } from './layouts/contact-layout'
import { PublicLayout } from './layouts/public-layout'
import { RouteError } from './route-error'

/*
 * One route tree per audience. Each area has its own layout and role guard, and its screens are
 * lazy-loaded, so citizens never download console code. Screens a later phase builds use
 * PlaceholderPage, which already receives the dynamic params (:incidentId, :caseId, ...).
 */
export const routes: RouteObject[] = [
  {
    ErrorBoundary: RouteError,
    children: [
      {
        Component: PublicLayout,
        children: [
          { index: true, lazy: () => import('@/routes/public/landing') },
          { path: 'login', lazy: () => import('@/routes/public/login') },
          { path: 'signup', lazy: () => import('@/routes/public/signup') },
          {
            path: 'verify/:sha256?',
            element: (
              <PlaceholderPage
                title="Verify evidence"
                phase="P4"
                module="M10"
                description="Drop a file to check it against the ledger. It is hashed on your device and never uploaded."
              />
            ),
          },
        ],
      },
      {
        path: 't/:token',
        Component: ContactLayout,
        children: [
          {
            index: true,
            element: (
              <PlaceholderPage
                title="Live safety link"
                phase="P1"
                module="M3"
                description="A trusted contact sees live location and status here, and can say they're responding."
              />
            ),
          },
        ],
      },
      {
        path: 'app',
        element: (
          <RequireRole roles={['citizen']}>
            <CitizenLayout />
          </RequireRole>
        ),
        children: [
          { index: true, lazy: () => import('@/routes/citizen/home') },
          {
            path: 'sos/:incidentId',
            element: (
              <PlaceholderPage
                title="SOS active"
                phase="P1"
                module="M2"
                description="Who has seen the alert, live map, nearby safe points, and I'm safe."
              />
            ),
          },
          {
            path: 'incidents/:incidentId',
            element: (
              <PlaceholderPage
                title="Incident timeline"
                phase="P1"
                module="M2"
                description="Every step of a past incident, read from the ledger."
              />
            ),
          },
          {
            path: 'map',
            element: (
              <PlaceholderPage
                title="Safety map"
                phase="P5"
                module="M11"
                description="Risk heatmap, safe points and the safest route."
              />
            ),
          },
          {
            path: 'report',
            element: (
              <PlaceholderPage
                title="Report an incident"
                phase="P3"
                module="M6"
                description="Speak or type what happened. Your location is filled in."
              />
            ),
          },
          {
            path: 'reports/:complaintId?',
            element: (
              <PlaceholderPage
                title="My reports"
                phase="P3"
                module="M6"
                description="Status, timeline and in-app calls for each report."
              />
            ),
          },
          {
            path: 'vault/:itemId?',
            element: (
              <PlaceholderPage
                title="Evidence vault"
                phase="P4"
                module="M9"
                description="Recordings and files, sealed with a fingerprint and shared only when you choose."
              />
            ),
          },
          {
            path: 'circle/:contactId?',
            element: (
              <PlaceholderPage
                title="Trusted circle"
                phase="P1"
                module="M1"
                description="The people who get your SOS, in the order they're alerted."
              />
            ),
          },
          {
            path: 'settings',
            element: (
              <PlaceholderPage
                title="Settings"
                phase="P1"
                description="SOS PIN, duress PIN, passkeys, privacy and notifications."
              />
            ),
          },
        ],
      },
      {
        path: 'console',
        element: (
          <RequireRole roles={STAFF_ROLES}>
            <ConsoleLayout />
          </RequireRole>
        ),
        children: [
          { index: true, lazy: () => import('@/routes/console/live') },
          {
            path: 'incidents/:incidentId',
            element: (
              <PlaceholderPage
                title="Incident"
                phase="P2"
                module="M5"
                description="Live map, timeline, acknowledge, dispatch and resolve."
              />
            ),
          },
          {
            path: 'complaints/:complaintId?',
            element: (
              <PlaceholderPage
                title="Complaints"
                phase="P3"
                module="M6"
                description="Triage queue sorted by time left, and the complaint workbench."
              />
            ),
          },
          {
            path: 'cases/:caseId?',
            element: (
              <PlaceholderPage
                title="Cases"
                phase="P4"
                module="M10"
                description="Procedural workflow and evidence checklist for each case."
              />
            ),
          },
          {
            path: 'cases/:caseId/evidence/:evidenceId',
            element: (
              <PlaceholderPage
                title="Evidence item"
                phase="P4"
                module="M10"
                description="Hash, signatures and the full chain of custody."
              />
            ),
          },
          {
            path: 'map',
            element: (
              <PlaceholderPage
                title="Map"
                phase="P2"
                module="M5"
                description="Incidents, patrol units and the risk layer."
              />
            ),
          },
          {
            path: 'reviews',
            element: (
              <PlaceholderPage
                title="Reviews"
                phase="P3"
                module="M7"
                description="Severity overrides waiting for supervisor review."
              />
            ),
          },
          {
            path: 'admin/:section',
            element: (
              <RequireRole roles={['admin']}>
                <PlaceholderPage
                  title="Administration"
                  phase="P2"
                  description="Stations, members, escalation policies, workflows and legal tags."
                />
              </RequireRole>
            ),
          },
        ],
      },
      { path: '*', lazy: () => import('@/routes/public/not-found') },
    ],
  },
]
