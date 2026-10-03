import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleX, FileSearch, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { verifyHash, type Verification } from '@/features/evidence/api'
import { formatBytes, hashFile } from '@/features/evidence/hash'
import { checkVerification, type Check } from '@/features/evidence/verify'
import { AnchorReceipt, HashBlock } from '@/features/evidence/parts'
import { paths } from '@/lib/paths'
import { formatDateTime } from '@/lib/time'

export function Component() {
  const { sha256 } = useParams()
  const navigate = useNavigate()
  const [hashing, setHashing] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [dragging, setDragging] = useState(false)
  const valid = !!sha256 && /^[0-9a-f]{64}$/i.test(sha256)

  const result = useQuery({
    queryKey: ['verify', sha256?.toLowerCase()],
    queryFn: async () => {
      const v = await verifyHash(sha256!.toLowerCase())
      return { v, checks: v.found ? await checkVerification(v) : [] }
    },
    enabled: valid,
    retry: false,
  })

  async function checkFile(file: File | undefined) {
    if (!file) return
    setHashing(file.name)
    try {
      navigate(paths.verify(await hashFile(file)))
    } finally {
      setHashing(null)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void checkFile(event.dataTransfer.files?.[0])
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void checkFile(event.target.files?.[0])
    event.target.value = ''
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const value = typed.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(value)) navigate(paths.verify(value))
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-8">
      <PageHeader
        title="Verify evidence"
        description="Check whether a file was sealed in the evidence ledger and that it hasn't changed since. The file is fingerprinted on your device and never uploaded."
      />

      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${
          dragging ? 'border-primary bg-accent/40' : ''
        }`}
      >
        <FileSearch className="text-primary size-8" aria-hidden />
        <span className="font-medium">Drop a file here, or choose one</span>
        <span className="text-muted-foreground text-sm">Hashed with SHA-256 in this browser</span>
        <input type="file" className="sr-only" aria-label="File to verify" onChange={onPick} />
      </label>
      {hashing ? (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Fingerprinting {hashing}…
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="grid gap-2">
        <Label htmlFor="sha">Or paste a SHA-256 fingerprint</Label>
        <div className="flex gap-2">
          <Input
            id="sha"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="64 hexadecimal characters"
            className="font-mono"
          />
          <Button type="submit" variant="outline">
            Check
          </Button>
        </div>
      </form>

      {sha256 && !valid ? (
        <Alert variant="destructive">
          <AlertDescription>That isn't a SHA-256 fingerprint.</AlertDescription>
        </Alert>
      ) : null}

      {valid && result.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Looking it up…
        </p>
      ) : null}
      {result.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{result.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {result.data && !result.data.v.found ? (
        <Alert variant="destructive">
          <CircleX aria-hidden />
          <AlertTitle>No match</AlertTitle>
          <AlertDescription>
            No sealed evidence has this fingerprint. If this is meant to be a sealed file, it has
            been changed, even by a single byte, or it was never sealed here.
          </AlertDescription>
        </Alert>
      ) : null}

      {result.data?.v.found ? <Match v={result.data.v} checks={result.data.checks} /> : null}
    </div>
  )
}

function Match({ v, checks }: { v: Extract<Verification, { found: true }>; checks: Check[] }) {
  const allOk = checks.every((c) => c.ok)
  return (
    <div className="grid gap-4">
      <Alert
        className={allOk ? 'border-emerald-600' : undefined}
        variant={allOk ? 'default' : 'destructive'}
      >
        <ShieldCheck aria-hidden />
        <AlertTitle>
          {allOk ? 'Match: this file is sealed' : 'The ledger record did not check out'}
        </AlertTitle>
        <AlertDescription>
          Registered {formatDateTime(v.registered_at)}, sealed {formatDateTime(v.sealed_at)} as
          ledger entry #{v.entry.seq}. {formatBytes(v.size_bytes)}, {v.mime_type}.
          {v.deleted_at
            ? ` The file itself was deleted by its owner on ${formatDateTime(v.deleted_at)}.`
            : ''}
        </AlertDescription>
      </Alert>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Checked in your browser</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid gap-1 text-sm">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2">
                {c.ok ? (
                  <CircleCheck
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                    aria-label="passed"
                  />
                ) : (
                  <CircleX
                    className="text-destructive mt-0.5 size-4 shrink-0"
                    aria-label="failed"
                  />
                )}
                {c.label}
              </li>
            ))}
          </ul>
          <HashBlock value={v.sha256} />
          <HashBlock label={`Ledger entry #${v.entry.seq} hash`} value={v.entry.entry_hash} />
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Anchor</CardTitle>
        </CardHeader>
        <CardContent>
          <AnchorReceipt anchor={v.anchor} sha256={v.sha256} verifyLink={false} />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        The ledger proves what was recorded, when, and that it has not changed since. It does not
        decide whether evidence is admissible; that is for the court.
      </p>
    </div>
  )
}
