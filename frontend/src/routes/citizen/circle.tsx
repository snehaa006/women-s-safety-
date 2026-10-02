import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronRight, LoaderCircle, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  addContact,
  circleKeys,
  listContacts,
  MAX_CONTACTS,
  removeContact,
  reorderContacts,
  updateContact,
  type Contact,
} from '@/features/circle/api'
import { ContactForm } from '@/features/circle/contact-form'
import { paths } from '@/lib/paths'

export function Component() {
  const { contactId } = useParams()
  const contacts = useQuery({ queryKey: circleKeys.all, queryFn: listContacts })

  if (contacts.isPending) {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading your circle…
      </p>
    )
  }
  if (contacts.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{contacts.error.message}</AlertDescription>
      </Alert>
    )
  }

  if (contactId) {
    const contact = contacts.data.find((c) => c.id === contactId)
    return contact ? (
      <EditContact contact={contact} />
    ) : (
      <Alert variant="destructive">
        <AlertDescription>
          This contact no longer exists.{' '}
          <Link className="underline" to={paths.app.circle}>
            Back to your circle
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  return <CircleList contacts={contacts.data} />
}

function CircleList({ contacts }: { contacts: Contact[] }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(contacts.length === 0)
  const full = contacts.length >= MAX_CONTACTS

  const reorder = useMutation({
    mutationFn: reorderContacts,
    onSettled: () => queryClient.invalidateQueries({ queryKey: circleKeys.all }),
  })

  function move(index: number, by: -1 | 1) {
    const next = [...contacts]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    queryClient.setQueryData(circleKeys.all, next)
    reorder.mutate(next)
  }

  async function add(values: Parameters<typeof addContact>[0]) {
    await addContact(values, contacts.length + 1)
    await queryClient.invalidateQueries({ queryKey: circleKeys.all })
    setAdding(false)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Trusted circle"
        description="The people who get your SOS and live location, in this order."
        actions={
          !adding && !full ? (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add contact
            </Button>
          ) : null
        }
      />

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a trusted contact</CardTitle>
          </CardHeader>
          <CardContent>
            <ContactForm
              submitLabel="Add to circle"
              onSubmit={add}
              onCancel={contacts.length > 0 ? () => setAdding(false) : undefined}
            />
          </CardContent>
        </Card>
      ) : null}

      {contacts.length === 0 && !adding ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex items-start gap-3">
            <Users className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
            <p>Add at least two people you trust. They don't need an account.</p>
          </CardContent>
        </Card>
      ) : null}

      {contacts.length > 0 ? (
        <ol className="grid gap-2" aria-label="Trusted contacts, in alert order">
          {contacts.map((contact, index) => (
            <li key={contact.id}>
              <Card className="gap-0 py-3">
                <CardContent className="flex items-center gap-3 px-4">
                  <span
                    className="bg-primary/10 text-primary grid size-8 shrink-0 place-content-center rounded-full font-bold"
                    aria-label={`Alerted ${ordinal(index + 1)}`}
                  >
                    {index + 1}
                  </span>
                  <Link
                    to={paths.app.contact(contact.id)}
                    className="grid min-w-0 flex-1 gap-0.5 hover:underline"
                  >
                    <span className="truncate font-semibold">
                      {contact.name}
                      {contact.relationship ? (
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          · {contact.relationship}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground truncate text-sm">
                      {[contact.phone, contact.email].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${contact.name} up`}
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${contact.name} down`}
                      disabled={index === contacts.length - 1 || reorder.isPending}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      ) : null}

      {full ? (
        <p className="text-muted-foreground text-sm">
          Your circle is full ({MAX_CONTACTS} people). Remove someone to add another.
        </p>
      ) : null}
    </div>
  )
}

function EditContact({ contact }: { contact: Contact }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: () => removeContact(contact.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: circleKeys.all })
      navigate(paths.app.circle)
    },
    onError: (e) => setError(e.message),
  })

  return (
    <div className="grid gap-6">
      <PageHeader title={contact.name} description="Edit how this contact is reached." />
      <Card>
        <CardContent>
          <ContactForm
            initial={contact}
            submitLabel="Save"
            onSubmit={async (values) => {
              await updateContact(contact.id, values)
              await queryClient.invalidateQueries({ queryKey: circleKeys.all })
              navigate(paths.app.circle)
            }}
            onCancel={() => navigate(paths.app.circle)}
          />
        </CardContent>
      </Card>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        variant="outline"
        className="text-destructive justify-self-start"
        disabled={remove.isPending}
        onClick={() => {
          if (window.confirm(`Remove ${contact.name} from your circle?`)) remove.mutate()
        }}
      >
        <Trash2 aria-hidden />
        Remove from circle
      </Button>
    </div>
  )
}

function ordinal(n: number) {
  const suffix =
    n % 10 === 1 && n !== 11
      ? 'st'
      : n % 10 === 2 && n !== 12
        ? 'nd'
        : n % 10 === 3 && n !== 13
          ? 'rd'
          : 'th'
  return `${n}${suffix}`
}
