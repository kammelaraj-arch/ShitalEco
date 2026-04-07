import {
  ok,
  tryAsync,
  type Result,
  createContextLogger,
  NotFoundError,
  PAGINATION,
} from '@shital/config'
import { prisma, type Notification } from '@shital/db'
import type { NotificationPayload } from './types.js'
import { sendEmail } from './email.service.js'
import { sendWhatsApp } from './whatsapp.service.js'

const log = createContextLogger({ module: 'notification.service' })

export class NotificationService {
  async send(payload: NotificationPayload): Promise<Result<void>> {
    return tryAsync(async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          type: payload.type,
          channel: payload.channel,
          metadata: (payload.metadata ?? {}) as object,
        },
      })

      const ctxLog = createContextLogger({
        module: 'notification.service',
        userId: payload.userId,
      })

      ctxLog.info(
        { notificationId: notification.id, channel: payload.channel },
        'Notification created',
      )

      // Route to external channel if needed
      if (payload.channel === 'EMAIL') {
        const user = await prisma.user.findFirst({
          where: { id: payload.userId, deletedAt: null },
        })

        if (user !== null && user !== undefined) {
          const emailResult = await sendEmail({
            to: user.email,
            subject: payload.title,
            html: `<p>${escapeHtml(payload.body)}</p>`,
            text: payload.body,
          })

          if (!emailResult.ok) {
            ctxLog.error(
              { err: emailResult.error },
              'Failed to send notification email',
            )
          }
        }
      } else if (payload.channel === 'WHATSAPP') {
        const user = await prisma.user.findFirst({
          where: { id: payload.userId, deletedAt: null },
        })

        if (user !== null && user !== undefined && user.phone !== null && user.phone !== undefined) {
          const waResult = await sendWhatsApp({
            to: user.phone,
            text: `${payload.title}\n\n${payload.body}`,
          })

          if (!waResult.ok) {
            ctxLog.error(
              { err: waResult.error },
              'Failed to send WhatsApp notification',
            )
          }
        }
      }
    })
  }

  async markRead(notificationId: string, userId: string): Promise<Result<void>> {
    return tryAsync(async () => {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId },
      })

      if (notification === null || notification === undefined) {
        throw new NotFoundError('Notification', notificationId)
      }

      if (!notification.read) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { read: true, readAt: new Date() },
        })
      }

      log.info({ notificationId, userId }, 'Notification marked as read')
    })
  }

  async markAllRead(userId: string): Promise<Result<void>> {
    return tryAsync(async () => {
      const now = new Date()
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true, readAt: now },
      })

      log.info({ userId }, 'All notifications marked as read')
    })
  }

  async getUnread(
    userId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Result<{ items: Notification[]; nextCursor: string | null }>> {
    return tryAsync(async () => {
      const take = Math.min(limit ?? PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT)

      const items = await prisma.notification.findMany({
        where: {
          userId,
          read: false,
          ...(cursor !== undefined
            ? { id: { lt: cursor } }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
      })

      let nextCursor: string | null = null
      const hasMore = items.length > take

      if (hasMore) {
        items.pop()
        const lastItem = items[items.length - 1]
        nextCursor = lastItem !== undefined ? lastItem.id : null
      }

      return { items, nextCursor }
    })
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
