import type { Cache } from './cache'

export interface DeleteTarget {
  chat_id: number
  id: number
}

export interface DeleteResult {
  deleted: number
  errors: { chatId: number; error: string }[]
}

export interface DeleteClient {
  deleteMessagesById(chatId: number, ids: number[], params?: { revoke?: boolean }): Promise<void>
}

const CHUNK = 100 // API limit per messages.deleteMessages call

// revoke: true = delete for everyone / on all devices
export async function deleteEverywhere(
  tg: DeleteClient,
  cache: Cache,
  targets: DeleteTarget[],
): Promise<DeleteResult> {
  const byChat = new Map<number, number[]>()
  for (const t of targets) {
    let ids = byChat.get(t.chat_id)
    if (!ids) {
      ids = []
      byChat.set(t.chat_id, ids)
    }
    ids.push(t.id)
  }

  const result: DeleteResult = { deleted: 0, errors: [] }
  for (const [chatId, ids] of byChat) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      try {
        await tg.deleteMessagesById(chatId, chunk, { revoke: true })
        cache.deleteMessages(chatId, chunk)
        result.deleted += chunk.length
      } catch (e) {
        // no rights / already gone — keep going with other chats, keep rows in cache
        result.errors.push({ chatId, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  return result
}
