// What the bot does with a message. Pure logic: the caller supplies the database calls.

export type TelegramUpdate = {
  message?: {
    chat?: { id?: number; type?: string }
    from?: { username?: string; first_name?: string }
    text?: string
  }
}

export type Linker = {
  link: (
    code: string,
    chatId: number,
    username: string | null,
  ) => Promise<{ status: 'linked' | 'unknown_code'; owner_name?: string | null }>
  unlink: (chatId: number) => Promise<number>
}

/** The bot's reply for an update, or null to stay quiet (group chats, stickers, ...). */
export async function handleUpdate(
  update: TelegramUpdate,
  db: Linker,
): Promise<{ chatId: number; text: string } | null> {
  const message = update.message
  const chatId = message?.chat?.id
  if (!message || typeof chatId !== 'number' || message.chat?.type !== 'private') return null
  const text = (message.text ?? '').trim()

  const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?$/.exec(text)
  if (start) {
    const code = start[1]
    if (!code) {
      return {
        chatId,
        text:
          "Hi! This bot sends SOS alerts from someone's trusted circle. To join, open the " +
          'invite link they sent you.',
      }
    }
    const result = await db.link(code, chatId, message.from?.username ?? null)
    if (result.status === 'unknown_code') {
      return {
        chatId,
        text: 'This invite has already been used or is no longer valid. Ask for a new link.',
      }
    }
    const who = result.owner_name ?? 'Your contact'
    return {
      chatId,
      text:
        `You're now in ${who}'s trusted circle. If ${who} sends an SOS, you'll get a message ` +
        'here with her live location. Send /stop to leave.',
    }
  }

  if (/^\/stop(?:@\w+)?$/.test(text)) {
    const count = await db.unlink(chatId)
    return {
      chatId,
      text:
        count > 0
          ? "Done. You won't get SOS alerts here any more."
          : "You weren't getting alerts here.",
    }
  }

  return {
    chatId,
    text: 'This bot only sends SOS alerts. Send /stop to stop receiving them.',
  }
}
