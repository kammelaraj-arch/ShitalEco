import { z } from 'zod'
import {
  ok,
  err,
  tryAsync,
  type Result,
  createContextLogger,
  ValidationError,
  NotFoundError,
  DomainError,
} from '@shital/config'
import { prisma } from '@shital/db'
import type { AddItemInput, BasketItemSummary, BasketSummary } from './types.js'

const log = createContextLogger({ module: 'basket.service' })

// Gift Aid rate: 25p per £1 donated (25%)
const GIFT_AID_RATE = 0.25
const BASKET_EXPIRY_MINUTES = 30
const DEFAULT_CURRENCY = 'GBP'

const addItemSchema = z.object({
  basketId: z.string().uuid(),
  itemType: z.enum(['SERVICE', 'DONATION', 'PRODUCT']),
  referenceId: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  quantity: z.number().int().min(1).max(999),
  unitPrice: z.number().min(0),
  metadata: z.record(z.unknown()).optional(),
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function calcGiftAid(items: { itemType: string; totalPrice: number }[]): number {
  const donationTotal = items
    .filter((i) => i.itemType === 'DONATION')
    .reduce((acc, i) => acc + i.totalPrice, 0)
  return round2(donationTotal * GIFT_AID_RATE)
}

function toBasketItemSummary(item: {
  id: string
  itemType: string
  name: string
  quantity: number
  unitPrice: { toNumber: () => number } | number
  totalPrice: { toNumber: () => number } | number
  metadata: unknown
}): BasketItemSummary {
  const unitPrice =
    typeof item.unitPrice === 'number' ? item.unitPrice : item.unitPrice.toNumber()
  const totalPrice =
    typeof item.totalPrice === 'number' ? item.totalPrice : item.totalPrice.toNumber()

  const raw = item.metadata
  const metadata: Record<string, unknown> | undefined =
    raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined

  return {
    id: item.id,
    itemType: item.itemType,
    name: item.name,
    quantity: item.quantity,
    unitPrice: round2(unitPrice),
    totalPrice: round2(totalPrice),
    ...(metadata !== undefined ? { metadata } : {}),
  }
}

export class BasketService {
  async createBasket(
    branchId: string,
    userId?: string,
    sessionId?: string,
  ): Promise<Result<{ id: string }>> {
    const ctxLog = createContextLogger({ module: 'basket.service', ...(userId ? { userId } : {}) })

    return tryAsync(async () => {
      if (!userId && !sessionId) {
        throw new ValidationError('Either userId or sessionId is required')
      }

      const expiresAt = new Date(Date.now() + BASKET_EXPIRY_MINUTES * 60 * 1000)

      const basket = await prisma.basket.create({
        data: {
          branchId,
          userId: userId ?? null,
          sessionId: sessionId ?? null,
          status: 'ACTIVE',
          expiresAt,
        },
        select: { id: true },
      })

      ctxLog.info({ basketId: basket.id, branchId }, 'Basket created')
      return { id: basket.id }
    })
  }

  async getBasket(basketId: string): Promise<Result<BasketSummary>> {
    return tryAsync(async () => {
      const basket = await prisma.basket.findUnique({
        where: { id: basketId },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
          },
        },
      })

      if (!basket) {
        throw new NotFoundError('Basket', basketId)
      }

      const items = basket.items.map(toBasketItemSummary)
      const subtotal = round2(items.reduce((acc, i) => acc + i.totalPrice, 0))
      const giftAidAmount = calcGiftAid(items)
      const total = round2(subtotal + giftAidAmount)
      const itemCount = items.reduce((acc, i) => acc + i.quantity, 0)

      return {
        id: basket.id,
        branchId: basket.branchId,
        items,
        subtotal,
        giftAidAmount,
        total,
        itemCount,
        currency: DEFAULT_CURRENCY,
      }
    })
  }

  async addItem(input: AddItemInput): Promise<Result<BasketItemSummary>> {
    return tryAsync(async () => {
      const parsed = addItemSchema.safeParse(input)
      if (!parsed.success) {
        throw new ValidationError('Invalid add item input', parsed.error.format())
      }

      const { basketId, itemType, referenceId, name, description, quantity, unitPrice, metadata } =
        parsed.data

      const basket = await prisma.basket.findUnique({
        where: { id: basketId },
        select: { id: true, status: true },
      })

      if (!basket) {
        throw new NotFoundError('Basket', basketId)
      }

      if (basket.status !== 'ACTIVE') {
        throw new DomainError('BASKET_NOT_ACTIVE', `Basket ${basketId} is not active`)
      }

      const totalPrice = round2(quantity * unitPrice)

      // If a referenceId is provided, check for an existing item to update quantity
      if (referenceId !== undefined) {
        const existing = await prisma.basketItem.findFirst({
          where: { basketId, referenceId },
        })

        if (existing) {
          const newQty = existing.quantity + quantity
          const newTotal = round2(newQty * unitPrice)

          const updated = await prisma.basketItem.update({
            where: { id: existing.id },
            data: {
              quantity: newQty,
              totalPrice: newTotal,
              unitPrice,
              ...(metadata !== undefined ? { metadata: metadata as object } : {}),
            },
          })

          await prisma.basket.update({
            where: { id: basketId },
            data: { updatedAt: new Date() },
          })

          log.info({ basketId, itemId: updated.id }, 'Basket item quantity updated')
          return toBasketItemSummary(updated)
        }
      }

      const item = await prisma.basketItem.create({
        data: {
          basketId,
          itemType,
          referenceId: referenceId ?? null,
          name,
          description: description ?? null,
          quantity,
          unitPrice,
          totalPrice,
          ...(metadata !== undefined ? { metadata: metadata as object } : {}),
        },
      })

      await prisma.basket.update({
        where: { id: basketId },
        data: { updatedAt: new Date() },
      })

      log.info({ basketId, itemId: item.id }, 'Basket item added')
      return toBasketItemSummary(item)
    })
  }

  async removeItem(basketId: string, itemId: string): Promise<Result<void>> {
    return tryAsync(async () => {
      const item = await prisma.basketItem.findFirst({
        where: { id: itemId, basketId },
        select: { id: true },
      })

      if (!item) {
        throw new NotFoundError('BasketItem', itemId)
      }

      await prisma.basketItem.delete({ where: { id: itemId } })

      await prisma.basket.update({
        where: { id: basketId },
        data: { updatedAt: new Date() },
      })

      log.info({ basketId, itemId }, 'Basket item removed')
    })
  }

  async updateQuantity(
    basketId: string,
    itemId: string,
    quantity: number,
  ): Promise<Result<BasketItemSummary>> {
    return tryAsync(async () => {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
        throw new ValidationError('Quantity must be an integer between 1 and 999')
      }

      const item = await prisma.basketItem.findFirst({
        where: { id: itemId, basketId },
      })

      if (!item) {
        throw new NotFoundError('BasketItem', itemId)
      }

      const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : item.unitPrice.toNumber()
      const newTotal = round2(quantity * unitPrice)

      const updated = await prisma.basketItem.update({
        where: { id: itemId },
        data: { quantity, totalPrice: newTotal },
      })

      await prisma.basket.update({
        where: { id: basketId },
        data: { updatedAt: new Date() },
      })

      log.info({ basketId, itemId, quantity }, 'Basket item quantity updated')
      return toBasketItemSummary(updated)
    })
  }

  async clearBasket(basketId: string): Promise<Result<void>> {
    return tryAsync(async () => {
      const basket = await prisma.basket.findUnique({
        where: { id: basketId },
        select: { id: true },
      })

      if (!basket) {
        throw new NotFoundError('Basket', basketId)
      }

      await prisma.basketItem.deleteMany({ where: { basketId } })

      await prisma.basket.update({
        where: { id: basketId },
        data: { updatedAt: new Date() },
      })

      log.info({ basketId }, 'Basket cleared')
    })
  }

  async checkout(
    basketId: string,
  ): Promise<Result<{ basketId: string; totalAmount: number; currency: string }>> {
    return tryAsync(async () => {
      const basket = await prisma.basket.findUnique({
        where: { id: basketId },
        include: {
          items: true,
        },
      })

      if (!basket) {
        throw new NotFoundError('Basket', basketId)
      }

      if (basket.status !== 'ACTIVE') {
        throw new DomainError(
          'BASKET_NOT_ACTIVE',
          `Basket ${basketId} has status ${basket.status}, cannot checkout`,
        )
      }

      if (basket.items.length === 0) {
        throw new DomainError('BASKET_EMPTY', `Basket ${basketId} has no items`)
      }

      const items = basket.items.map(toBasketItemSummary)
      const subtotal = round2(items.reduce((acc, i) => acc + i.totalPrice, 0))
      const giftAidAmount = calcGiftAid(items)
      const totalAmount = round2(subtotal + giftAidAmount)

      await prisma.basket.update({
        where: { id: basketId },
        data: { status: 'CHECKOUT' },
      })

      log.info({ basketId, totalAmount }, 'Basket checked out')
      return { basketId, totalAmount, currency: DEFAULT_CURRENCY }
    })
  }

  async abandonExpired(): Promise<Result<number>> {
    return tryAsync(async () => {
      const result = await prisma.basket.updateMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'ABANDONED' },
      })

      log.info({ count: result.count }, 'Expired baskets abandoned')
      return result.count
    })
  }
}

export const basketService = new BasketService()
