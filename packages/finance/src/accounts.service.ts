import Decimal from 'decimal.js'
import { z } from 'zod'
import {
  ok,
  err,
  tryAsync,
  type Result,
  createContextLogger,
  ValidationError,
  NotFoundError,
  ConflictError,
  PAGINATION,
} from '@shital/config'
import { prisma, type Account, AccountType } from '@shital/db'

const createAccountSchema = z.object({
  code: z.string().min(1).max(20).regex(/^\d+$/, 'Account code must be numeric'),
  name: z.string().min(1).max(200),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  parentId: z.string().uuid().optional(),
  currency: z.string().length(3).default('GBP'),
})

export class AccountsService {
  async createAccount(
    branchId: string,
    input: {
      code: string
      name: string
      type: string
      parentId?: string
      currency?: string
    },
  ): Promise<Result<{ accountId: string }>> {
    const log = createContextLogger({ module: 'accounts.service', branchId })

    const parseResult = createAccountSchema.safeParse(input)
    if (!parseResult.success) {
      return err(new ValidationError('Invalid account data', parseResult.error.format()))
    }

    const data = parseResult.data

    return tryAsync(async () => {
      // Check uniqueness within branch
      const existing = await prisma.account.findUnique({
        where: { branchId_code: { branchId, code: data.code } },
      })
      if (existing !== null && existing !== undefined) {
        throw new ConflictError(`Account with code ${data.code} already exists in this branch`)
      }

      // Validate parent exists and belongs to branch
      if (data.parentId !== undefined) {
        const parent = await prisma.account.findFirst({
          where: { id: data.parentId, branchId },
        })
        if (parent === null || parent === undefined) {
          throw new NotFoundError('Parent account', data.parentId)
        }
      }

      const account = await prisma.account.create({
        data: {
          code: data.code,
          name: data.name,
          type: data.type as Account['type'],
          branchId,
          currency: data.currency,
          parentId: data.parentId ?? null,
          balance: 0,
          isActive: true,
        },
      })

      log.info({ accountId: account.id, code: data.code }, 'Account created')
      return { accountId: account.id }
    })
  }

  async getAccount(accountId: string): Promise<Result<Account>> {
    return tryAsync(async () => {
      const account = await prisma.account.findUnique({
        where: { id: accountId },
      })

      if (account === null || account === undefined) {
        throw new NotFoundError('Account', accountId)
      }

      return account
    })
  }

  async listAccounts(branchId: string, type?: string): Promise<Result<Account[]>> {
    return tryAsync(async () => {
      const accounts = await prisma.account.findMany({
        where: {
          branchId,
          isActive: true,
          ...(type !== undefined ? { type: type as AccountType } : {}),
        },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
      })

      return accounts
    })
  }

  async getAccountBalance(
    accountId: string,
  ): Promise<Result<{ balance: Decimal; currency: string }>> {
    return tryAsync(async () => {
      const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { balance: true, currency: true, isActive: true },
      })

      if (account === null || account === undefined) {
        throw new NotFoundError('Account', accountId)
      }

      return {
        balance: new Decimal(account.balance),
        currency: account.currency,
      }
    })
  }

  async deactivateAccount(accountId: string): Promise<Result<void>> {
    const log = createContextLogger({ module: 'accounts.service' })

    return tryAsync(async () => {
      const account = await prisma.account.findUnique({
        where: { id: accountId },
        include: { _count: { select: { children: true } } },
      })

      if (account === null || account === undefined) {
        throw new NotFoundError('Account', accountId)
      }

      if (!account.isActive) {
        return // Already inactive, idempotent
      }

      if (account._count.children > 0) {
        throw new ConflictError(
          `Cannot deactivate account ${accountId}: it has ${account._count.children} child accounts`,
        )
      }

      await prisma.account.update({
        where: { id: accountId },
        data: { isActive: false },
      })

      log.info({ accountId }, 'Account deactivated')
    })
  }
}
