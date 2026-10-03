import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronRight, FileUp, LoaderCircle, Lock, Trash2, Undo2 } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import { complaintKeys, listMyComplaints } from '@/features/complaints/api'
import {
  addEvidence,
  cancelDeletion,
  fetchVaultItem,
  listVault,
  requestDeletion,
  shareEvidence,
  vaultKeys,
  type UploadStage,
} from '@/features/evidence/api'
import { formatBytes } from '@/features/evidence/hash'
import { AnchorReceipt, EntryList, HashBlock, StatusBadge } from '@/features/evidence/parts'
import { currentFix } from '@/features/sos/geo'
import { paths } from '@/lib/paths'
import { fallbackInterval, useLiveChannel } from '@/lib/realtime'
import { formatDateTime } from '@/lib/time'

const STAGE: Record<UploadStage, string> = {
  hashing: 'Taking the fingerprint on this phone…',
  registering: 'Registering the fingerprint…',
  uploading: 'Uploading…',
  sealing: 'Asking the server to re-check it…',
}

/** Live updates for the owner's items (pinged on `user:<id>`). */
function useVaultLive() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const userId = auth.status === 'signed-in' ? auth.profile.id : null
  return useLiveChannel(userId ? `user:${userId}` : null, () => {
    void queryClient.invalidateQueries({ queryKey: vaultKeys.list })
  })
}

export function Component() {
  const { itemId } = useParams()
  const live = useVaultLive()
  return itemId ? <Detail id={itemId} live={live} /> : <List live={live} />
}

function List({ live }: { live: boolean }) {
  const queryClient = useQueryClient()
  const items = useQuery({
    queryKey: vaultKeys.list,
    queryFn: listVault,
    // Items waiting for their server check refresh quickly.
    refetchInterval: (q) =>
      q.state.data?.some((i) => i.status === 'registered') ? 3000 : fallbackInterval(live),
  })
  const [stage, setStage] = useState<UploadStage | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const add = useMutation({
    mutationFn: async ({ file, source }: { file: File; source: 'upload' | 'capture' }) => {
      const fix = await currentFix(2000)
      return addEvidence({
        file,
        source,
        clientId: crypto.randomUUID(),
        location: fix,
        onStage: setStage,
      })
    },
    onSettled: () => {
      setStage(null)
      void queryClient.invalidateQueries({ queryKey: vaultKeys.list })
    },
  })

  function picked(source: 'upload' | 'capture') {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) add.mutate({ file, source })
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Evidence vault"
        description="Photos, videos, audio and documents. Each file gets a fingerprint on this phone; the server seals it only if the stored copy matches."
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => cameraInput.current?.click()} disabled={add.isPending}>
          <Camera aria-hidden /> Take a photo or video
        </Button>
        <Button
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={add.isPending}
        >
          <FileUp aria-hidden /> Add a file
        </Button>
        <input
          ref={cameraInput}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          className="hidden"
          aria-label="Take a photo or video"
          onChange={picked('capture')}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf"
          className="hidden"
          aria-label="Add a file"
          onChange={picked('upload')}
        />
      </div>
      {stage ? (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> {STAGE[stage]}
        </p>
      ) : null}
      {add.isError ? (
        <Alert variant="destructive">
          <AlertTitle>That file wasn't added</AlertTitle>
          <AlertDescription>{add.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {items.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : items.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{items.error.message}</AlertDescription>
        </Alert>
      ) : items.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Your vault is empty. Files you add stay private until you share them with a report.
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.data.map((item) => (
            <li key={item.id}>
              <Link
                to={paths.app.vaultItem(item.id)}
                className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-3"
              >
                <StatusBadge status={item.status} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{item.file_name}</span>
                  <span className="text-muted-foreground text-sm">
                    {formatBytes(item.size_bytes)} · {formatDateTime(item.created_at)}
                    {item.shared_at ? ' · shared' : ''}
                    {item.delete_after ? ' · deletion pending' : ''}
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Detail({ id, live }: { id: string; live: boolean }) {
  const queryClient = useQueryClient()
  const item = useQuery({
    queryKey: vaultKeys.one(id),
    queryFn: () => fetchVaultItem(id),
    refetchInterval: (q) => (q.state.data?.status === 'registered' ? 3000 : fallbackInterval(live)),
  })
  const reports = useQuery({ queryKey: complaintKeys.mine, queryFn: listMyComplaints })
  const [reportId, setReportId] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: vaultKeys.list })
  const share = useMutation({
    mutationFn: () => shareEvidence(id, reportId),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: () => requestDeletion(id), onSettled: refresh })
  const keep = useMutation({ mutationFn: () => cancelDeletion(id), onSettled: refresh })

  if (item.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    )
  }
  if (item.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't open this item</AlertTitle>
        <AlertDescription>
          {item.error.message}{' '}
          <Link to={paths.app.vault} className="underline">
            Back to the vault
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  const e = item.data
  const shared = !!e.shared_at || e.on_case

  return (
    <div className="grid gap-5">
      <Link to={paths.app.vault} className="text-muted-foreground w-fit text-sm">
        ← Evidence vault
      </Link>
      <header className="grid gap-2">
        <h1 className="text-2xl font-bold break-all">{e.file_name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={e.status} />
          <span className="text-muted-foreground">
            {formatBytes(e.size_bytes)} · added {formatDateTime(e.created_at)}
          </span>
        </div>
      </header>

      {e.status === 'registered' ? (
        <Alert>
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          <AlertTitle>Checking the stored copy</AlertTitle>
          <AlertDescription>
            The server is re-computing the fingerprint. It is sealed only if it matches.
          </AlertDescription>
        </Alert>
      ) : null}
      {e.status === 'rejected' ? (
        <Alert variant="destructive">
          <AlertTitle>Not sealed</AlertTitle>
          <AlertDescription>{e.reject_reason}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="text-primary size-5" aria-hidden /> Fingerprint
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <HashBlock value={e.sha256} />
          {e.sealed_at ? (
            <p className="text-sm">
              Sealed {formatDateTime(e.sealed_at)} as ledger entry #{e.sealed_seq}. Anyone with the
              original file can check it on the verifier; a copy with even one changed byte won't
              match.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {e.status === 'sealed' ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Anchor receipt</CardTitle>
          </CardHeader>
          <CardContent>
            <AnchorReceipt anchor={e.anchor} sha256={e.sha256} />
          </CardContent>
        </Card>
      ) : null}

      {e.status === 'sealed' ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Share with the police</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {e.shared_at ? (
              <p>
                Shared {formatDateTime(e.shared_at)}
                {e.complaint_reference ? (
                  <>
                    {' '}
                    with report{' '}
                    <Link to={paths.app.complaint(e.complaint_id!)} className="underline">
                      {e.complaint_reference}
                    </Link>
                  </>
                ) : null}
                . Shared evidence can't be deleted.
              </p>
            ) : (reports.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">
                File a report first; then you can attach this to it.{' '}
                <Link to={paths.app.report} className="underline">
                  New report
                </Link>
              </p>
            ) : (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (reportId) share.mutate()
                }}
              >
                <div className="grid gap-1">
                  <Label htmlFor="share-report">Attach to report</Label>
                  <select
                    id="share-report"
                    className="border-input bg-background h-9 rounded-md border px-2"
                    value={reportId}
                    onChange={(event) => setReportId(event.target.value)}
                  >
                    <option value="">Choose a report</option>
                    {reports.data!.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.reference} · {formatDateTime(r.created_at)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={!reportId || share.isPending}>
                  Share
                </Button>
              </form>
            )}
            {share.isError ? <p className="text-destructive">{share.error.message}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {!shared && e.status !== 'deleted' ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Delete</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {e.delete_after ? (
              <>
                <p>
                  This file will be deleted on {formatDateTime(e.delete_after)}. Its fingerprint
                  stays in the ledger.
                </p>
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => keep.mutate()}
                  disabled={keep.isPending}
                >
                  <Undo2 aria-hidden /> Keep it
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Deletion waits 30 days so it can't be done in a hurry or by someone else holding
                  your phone.
                </p>
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  <Trash2 aria-hidden /> Delete in 30 days
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <EntryList entries={e.timeline} />
        </CardContent>
      </Card>
    </div>
  )
}
