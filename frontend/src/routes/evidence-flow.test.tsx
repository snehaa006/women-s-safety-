import { createHash } from 'node:crypto'

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listMyComplaints } from '@/features/complaints/api'
import { fetchMemberships } from '@/features/console/api'
import {
  addEvidence,
  advanceCase,
  fetchCase,
  fetchCaseEvidence,
  fetchVaultItem,
  listVault,
  shareEvidence,
  signLock,
  verifyHash,
  type ConsoleCase,
  type ConsoleEvidence,
  type VaultItemDetail,
} from '@/features/evidence/api'
import { citizen, createFakeAuthClient, officer } from '@/test/fake-auth-client'
import { renderRoute } from '@/test/render-route'

vi.mock('@/features/evidence/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/evidence/api')>()),
  listVault: vi.fn(),
  fetchVaultItem: vi.fn(),
  addEvidence: vi.fn(async () => ({ evidenceId: 'e2', sha256: 'f'.repeat(64) })),
  shareEvidence: vi.fn(async () => {}),
  requestDeletion: vi.fn(async () => ({ delete_after: new Date().toISOString() })),
  cancelDeletion: vi.fn(async () => {}),
  verifyHash: vi.fn(),
  fetchCases: vi.fn(async () => []),
  fetchCase: vi.fn(),
  fetchCaseEvidence: vi.fn(),
  advanceCase: vi.fn(),
  signLock: vi.fn(async () => ({ capacity: 'investigating_officer', locked: false })),
}))
vi.mock('@/features/complaints/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/complaints/api')>()),
  listMyComplaints: vi.fn(),
}))
vi.mock('@/features/console/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/console/api')>()),
  fetchMemberships: vi.fn(),
}))
vi.mock('@/features/sos/geo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sos/geo')>()),
  currentFix: vi.fn(async () => null),
}))

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const FILE_SHA = sha('the original photo')
const now = new Date().toISOString()

const vaultItem = (over: Partial<VaultItemDetail> = {}): VaultItemDetail => ({
  id: 'e1',
  kind: 'photo',
  source: 'capture',
  file_name: 'metro.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 204800,
  sha256: FILE_SHA,
  status: 'sealed',
  captured_at: now,
  sealed_at: now,
  reject_reason: null,
  complaint_id: null,
  incident_id: null,
  shared_at: null,
  delete_after: null,
  created_at: now,
  storage_path: 'u/e1',
  note: null,
  sealed_seq: 42,
  complaint_reference: null,
  on_case: false,
  anchor: null,
  timeline: [
    { seq: 40, occurred_at: now, action: 'evidence.registered', payload: {} },
    { seq: 42, occurred_at: now, action: 'evidence.sealed', payload: {} },
  ],
  ...over,
})

const checklist = (done: Record<string, boolean>) => {
  const steps = (['captured', 'hashed', 'sealed', 'signed', 'custody', 'anchored'] as const).map(
    (step) => ({ step, label: step, done: done[step] ?? true }),
  )
  return { steps, missing: steps.filter((s) => !s.done).map((s) => s.label) }
}

const caseRow = {
  id: 'k1',
  reference: 'K-2026-000001',
  title: 'Stalking near the metro',
  status: 'open' as const,
  state: 'evidence_collected',
  state_label: 'Evidence collected',
  state_index: 1,
  state_count: 4,
  org_id: 'org-cp',
  org_name: 'Connaught Place Police Station',
  lead_officer: 'Inspector Mehra',
  lead_officer_id: 'officer-1',
  complaint_id: 'c1',
  complaint_reference: 'C-2026-000042',
  incident_id: null,
  evidence_count: 1,
  locked_count: 0,
  created_at: now,
  updated_at: now,
}

const consoleCase = (): ConsoleCase => ({
  ...caseRow,
  location: { lat: 28.6315, lng: 77.2167 },
  workflow: { key: 'standard', version: 1, name: 'Standard investigation' },
  states: [
    { key: 'registered', label: 'Registered', index: 0, requires: [] },
    {
      key: 'evidence_collected',
      label: 'Evidence collected',
      index: 1,
      requires: [{ kind: 'evidence_sealed', label: 'Evidence sealed', hint: '', met: true }],
    },
    {
      key: 'site_inspected',
      label: 'Site inspected',
      index: 2,
      requires: [{ kind: 'site_visit', label: 'Site visit', hint: 'Check in', met: false }],
    },
    {
      key: 'evidence_locked',
      label: 'Evidence locked',
      index: 3,
      requires: [{ kind: 'evidence_locked', label: 'Evidence locked', hint: 'Sign', met: false }],
    },
  ],
  me: { is_lead: true, is_supervisor: false },
  evidence: [
    {
      id: 'e1',
      file_name: 'metro.jpg',
      kind: 'photo',
      mime_type: 'image/jpeg',
      size_bytes: 204800,
      sha256: FILE_SHA,
      status: 'sealed',
      captured_at: now,
      sealed_at: now,
      locked_at: null,
      added_at: now,
      added_by: 'Reporter 7F3K',
      custodian: 'Inspector Mehra',
      custodian_id: 'officer-1',
      checklist: checklist({ signed: false, anchored: false }),
    },
  ],
  events: [],
  staff: [],
  timeline: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchMemberships).mockResolvedValue([
    {
      org_id: 'org-cp',
      org_name: 'Connaught Place Police Station',
      role: 'officer',
      on_duty: true,
    },
  ])
})

describe('evidence vault', () => {
  it('lists sealed items and adds a file through hash, register, upload and seal', async () => {
    vi.mocked(listVault).mockResolvedValue([vaultItem()])
    renderRoute('/app/vault', createFakeAuthClient(citizen))
    expect(await screen.findByText('metro.jpg')).toBeInTheDocument()
    expect(screen.getByText('Sealed')).toBeInTheDocument()

    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' })
    await userEvent.upload(screen.getByLabelText('Add a file'), file)
    await waitFor(() => expect(addEvidence).toHaveBeenCalled())
    const args = vi.mocked(addEvidence).mock.calls[0][0]
    expect(args.file).toBe(file)
    expect(args.source).toBe('upload')
    expect(args.clientId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('shows the fingerprint and shares the item with a report', async () => {
    vi.mocked(fetchVaultItem).mockResolvedValue(vaultItem())
    vi.mocked(listMyComplaints).mockResolvedValue([
      {
        id: 'c1',
        reference: 'C-2026-000042',
        created_at: now,
      } as Awaited<ReturnType<typeof listMyComplaints>>[number],
    ])
    renderRoute('/app/vault/e1', createFakeAuthClient(citizen))
    expect(await screen.findByText(FILE_SHA)).toBeInTheDocument()
    expect(screen.getByText(/Sealed .* as ledger entry #42/)).toBeInTheDocument()
    expect(screen.getByText('Sealed: the server re-hash matched')).toBeInTheDocument()

    await userEvent.selectOptions(
      await screen.findByLabelText('Attach to report'),
      screen.getByRole('option', { name: /C-2026-000042/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(shareEvidence).toHaveBeenCalledWith('e1', 'c1'))
  })
})

describe('public verifier', () => {
  it('finds a sealed file and re-checks every hash in the browser', async () => {
    const payload = `{"mime": "image/jpeg", "size": 5, "sha256": "${FILE_SHA}"}`
    const payloadHash = sha(payload)
    const prev = '0'.repeat(64)
    const material = `42|${prev}|t|t|||||evidence.sealed|evidence|e1||||${payloadHash}`
    const entryHash = sha(material)
    const sibling = sha('another entry')
    const root = createHash('sha256')
      .update(Buffer.concat([Buffer.from(entryHash, 'hex'), Buffer.from(sibling, 'hex')]))
      .digest('hex')
    vi.mocked(verifyHash).mockResolvedValue({
      found: true,
      sha256: FILE_SHA,
      size_bytes: 5,
      mime_type: 'image/jpeg',
      registered_at: now,
      sealed_at: now,
      deleted_at: null,
      copies: 1,
      entry: {
        seq: 42,
        action: 'evidence.sealed',
        occurred_at: now,
        recorded_at: now,
        payload_text: payload,
        payload_hash: payloadHash,
        prev_hash: prev,
        entry_hash: entryHash,
        material,
      },
      anchor: {
        from_seq: 41,
        to_seq: 42,
        leaf_count: 2,
        merkle_root: root,
        created_at: now,
        ots_status: 'submitted',
        ots_calendar: 'https://a.pool.opentimestamps.org',
        submitted_at: now,
        receipt: btoa('receipt'),
        proof: [{ side: 'right', hash: sibling }],
      },
    })
    renderRoute(`/verify/${FILE_SHA}`, createFakeAuthClient())
    expect(await screen.findByText('Match: this file is sealed')).toBeInTheDocument()
    const checks = screen.getByText('Checked in your browser').closest('[data-slot="card"]')!
    expect(within(checks as HTMLElement).getAllByLabelText('passed')).toHaveLength(4)
    expect(screen.getByRole('button', { name: /Anchor receipt/ })).toBeInTheDocument()
    expect(verifyHash).toHaveBeenCalledWith(FILE_SHA)
  })

  it('hashes a dropped file locally and reports a changed copy as no match', async () => {
    vi.mocked(verifyHash).mockImplementation(async (value) => ({ found: false, sha256: value }))
    const { router } = renderRoute('/verify', createFakeAuthClient())
    const tampered = new File(['the original photO'], 'copy.jpg', { type: 'image/jpeg' })
    await userEvent.upload(await screen.findByLabelText('File to verify'), tampered)
    expect(await screen.findByText('No match')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/verify/${sha('the original photO')}`)
    expect(verifyHash).toHaveBeenCalledWith(sha('the original photO'))
  })
})

describe('cases', () => {
  it('lists the missing requirements when an officer skips a step', async () => {
    vi.mocked(fetchCase).mockResolvedValue(consoleCase())
    vi.mocked(advanceCase).mockResolvedValue({
      ok: false,
      state: 'evidence_collected',
      missing: [
        {
          state: 'site_inspected',
          state_label: 'Site inspected',
          kind: 'site_visit',
          label: 'Site visit',
          hint: 'An officer checked in within 200 m of the case location.',
        },
        {
          state: 'evidence_locked',
          state_label: 'Evidence locked',
          kind: 'evidence_locked',
          label: 'Evidence locked',
          hint: 'Every sealed item is signed by the investigating officer and a supervisor.',
        },
      ],
    })
    renderRoute('/console/cases/k1', createFakeAuthClient(officer))
    expect(await screen.findByText(/K-2026-000001/)).toBeInTheDocument()
    expect(screen.getByText('Reporter 7F3K', { exact: false })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Move the case to'), 'evidence_locked')
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(advanceCase).toHaveBeenCalledWith('k1', 'evidence_locked'))
    const alert = await screen.findByText('Not yet: these steps are missing')
    const box = alert.closest('[role="alert"]') as HTMLElement
    expect(within(box).getByText('Site visit')).toBeInTheDocument()
    expect(within(box).getByText('Evidence locked')).toBeInTheDocument()
  })

  it('lets the investigating officer sign the lock and shows the custody checklist', async () => {
    const evidence: ConsoleEvidence = {
      id: 'e1',
      case: caseRow,
      file_name: 'metro.jpg',
      kind: 'photo',
      source: 'capture',
      mime_type: 'image/jpeg',
      size_bytes: 204800,
      sha256: FILE_SHA,
      status: 'sealed',
      reject_reason: null,
      storage_path: 'u/e1',
      captured_at: now,
      location: null,
      note: null,
      registered_at: now,
      sealed_at: now,
      sealed_seq: 42,
      added_by: 'Reporter 7F3K',
      locked_at: null,
      custodian: 'Inspector Mehra',
      custodian_id: 'officer-1',
      checklist: checklist({ signed: false }),
      me: { id: 'officer-1', is_lead: true, is_supervisor: false, is_custodian: true },
      signatures: [],
      transfers: [],
      staff: [{ id: 'officer-2', name: 'Constable Rao', role: 'officer' }],
      anchor: null,
      timeline: [],
    }
    vi.mocked(fetchCaseEvidence).mockResolvedValue(evidence)
    renderRoute('/console/cases/k1/evidence/e1', createFakeAuthClient(officer))
    expect(await screen.findByText('⚠ Waiting for the supervisor')).toBeInTheDocument()
    expect(screen.getByLabelText('Evidence checklist')).toHaveTextContent('⚠ signed')

    await userEvent.click(screen.getByRole('button', { name: 'Sign as investigating officer' }))
    await waitFor(() => expect(signLock).toHaveBeenCalledWith('k1', 'e1'))
    expect(screen.getByRole('button', { name: 'Sign and hand over' })).toBeDisabled()
  })
})
