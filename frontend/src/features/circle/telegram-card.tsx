import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Copy, MessageCircle, MessageSquare, Send, Unlink } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { smsLink, whatsappLink } from '@/features/sos/share'
import { formatDateTime } from '@/lib/time'

import {
  circleKeys,
  disconnectTelegram,
  telegramBot,
  telegramInviteLink,
  type Contact,
} from './api'

/**
 * Telegram is the free channel that reaches anyone: the contact opens an invite once, and from
 * then on gets SOS alerts as Telegram messages.
 */
export function TelegramCard({
  contact,
  bot = telegramBot,
}: {
  contact: Contact
  bot?: string | null
}) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const disconnect = useMutation({
    mutationFn: () => disconnectTelegram(contact.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: circleKeys.all }),
  })

  let body
  if (contact.telegram_linked_at) {
    body = (
      <>
        <p className="flex items-center gap-2">
          <CircleCheck className="size-5 text-emerald-600" aria-hidden />
          <span>
            Connected{contact.telegram_username ? ` as @${contact.telegram_username}` : ''} on{' '}
            {formatDateTime(contact.telegram_linked_at)}. {contact.name} gets your SOS alerts there.
          </span>
        </p>
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={disconnect.isPending}
          onClick={() => {
            if (window.confirm(`Stop sending SOS alerts to ${contact.name} on Telegram?`)) {
              disconnect.mutate()
            }
          }}
        >
          <Unlink aria-hidden />
          Disconnect
        </Button>
      </>
    )
  } else if (!bot) {
    body = (
      <p className="text-muted-foreground text-sm">
        Telegram alerts aren't switched on for this app yet.
        {contact.email ? ` ${contact.name} gets your SOS alerts by email.` : ''}
      </p>
    )
  } else {
    const link = telegramInviteLink(bot, contact.telegram_code)
    const text = `I've added you to my trusted circle. If I ever send an SOS, you'll get my live location on Telegram. Tap to connect: ${link}`
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      } catch {
        window.prompt('Copy the invite link', link)
      }
    }
    body = (
      <>
        <p className="text-muted-foreground text-sm">
          Send {contact.name} this invite. They tap it, press Start, and from then on get your SOS
          alerts on Telegram. The invite works once.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button asChild size="touch">
            <a href={whatsappLink(text)} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden />
              WhatsApp
            </a>
          </Button>
          {contact.phone ? (
            <Button asChild size="touch" variant="secondary">
              <a href={smsLink([contact.phone], text)}>
                <MessageSquare aria-hidden />
                SMS
              </a>
            </Button>
          ) : null}
          <Button size="touch" variant="outline" onClick={copy}>
            {copied ? <CircleCheck aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy invite'}
          </Button>
        </div>
      </>
    )
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="text-primary size-5" aria-hidden />
          Telegram alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">{body}</CardContent>
    </Card>
  )
}
