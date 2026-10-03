import { Outlet, type RouteObject } from 'react-router'

import { STAFF_ROLES } from '@/lib/roles'

import { RequireRole } from './guards'
import { CitizenLayout } from './layouts/citizen-layout'
import { ConsoleLayout } from './layouts/console-layout'
import { ContactLayout } from './layouts/contact-layout'
import { PublicLayout } from './layouts/public-layout'
import { RouteError } from './route-error'

/*
 * One route tree per audience. Each area has its own layout and role guard, and its screens are
 * lazy-loaded, so citizens never download console code.
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
          { path: 'verify/:sha256?', lazy: () => import('@/routes/public/verify') },
        ],
      },
      {
        path: 't/:token',
        Component: ContactLayout,
        children: [{ index: true, lazy: () => import('@/routes/contact/live') }],
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
          { path: 'sos/:incidentId', lazy: () => import('@/routes/citizen/sos') },
          { path: 'incidents/:incidentId', lazy: () => import('@/routes/citizen/incident') },
          { path: 'map', lazy: () => import('@/routes/citizen/map') },
          { path: 'journeys/:journeyId', lazy: () => import('@/routes/citizen/journey') },
          { path: 'report', lazy: () => import('@/routes/citizen/report') },
          { path: 'reports/:complaintId?', lazy: () => import('@/routes/citizen/reports') },
          { path: 'vault/:itemId?', lazy: () => import('@/routes/citizen/vault') },
          { path: 'circle/:contactId?', lazy: () => import('@/routes/citizen/circle') },
          { path: 'settings', lazy: () => import('@/routes/citizen/settings') },
          { path: 'devices', lazy: () => import('@/routes/citizen/devices') },
          { path: 'devices/simulator', lazy: () => import('@/routes/citizen/simulator') },
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
          { path: 'incidents/:incidentId', lazy: () => import('@/routes/console/incident') },
          { path: 'complaints/:complaintId?', lazy: () => import('@/routes/console/complaints') },
          { path: 'cases/:caseId?', lazy: () => import('@/routes/console/cases') },
          {
            path: 'cases/:caseId/evidence/:evidenceId',
            lazy: () => import('@/routes/console/evidence'),
          },
          { path: 'map', lazy: () => import('@/routes/console/map') },
          { path: 'reviews', lazy: () => import('@/routes/console/reviews') },
          {
            path: 'admin/:section',
            element: (
              <RequireRole roles={['admin']}>
                <Outlet />
              </RequireRole>
            ),
            children: [{ index: true, lazy: () => import('@/routes/console/admin') }],
          },
        ],
      },
      { path: '*', lazy: () => import('@/routes/public/not-found') },
    ],
  },
]
