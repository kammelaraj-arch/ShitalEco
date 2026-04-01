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
  DomainError,
  PAGINATION,
} from '@shital/config'
import { prisma, type Transaction, type TransactionLine } from '@shital/db'
import type { JournalEntry } from './types.js'

const journalLineSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().optional(),
  debitAmount: z.instanceof(Decimal),
  creditAmount: z.instanceof(Decimal),
})

const journalEntrySchema = z.object({
  description: z.string().min(1).max(500),
  date: z.date(),
  lines: z.array(journalLineSchema).min(2),
  reference: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128),
})

function validateJournal(entry: JournalEntry): void {
  const totalDebits = entry.lines.reduce(
    (sum, line) => sum.plus(line.debitAmount),
    new Decimal(0),
  )
  const totalCredits = entry.lines.reduce(
    (sum, line) => sum.plus(line.creditAmount),
    new Decimal(0),
  )

  if (!totalDebits.equals(totalCredits)) {
    throw new ValidationError(
      `Journal does not balance: debits ${totalDebits.toFixed(2)} != credits ${totalCredits.toFixed(2)}`,
      { totalDebits: totalDebits.toFixed(2), totalCredits: totalCredits.toFixed(2) },
    )
  }

  if (totalDebits.isZero()) {
    throw new ValidationError('Journal entry has zero value — at least one debit/credit must be non-zero')
  }
}

export class JournalService {
  async postJournal(
    branchId: string,
    entry: JournalEntry,
    postedBy: string,
  ): Promise<Result<{ transactionId: string }>> {
    const log = createContextLogger({ module: 'journal.service', branchId, userId: postedBy })

    const parseResult = journalEntrySchema.safeParse(entry)
    if (!parseResult.success) {
      return err(new ValidationError('Invalid journal entry', parseResult.error.format()))
    }

    try {
      validateJournal(entry)
    } catch (e) {
      if (e instanceof DomainError) return err(e)
      return err(new DomainError('VALIDATION_ERROR', String(e)))
    }

    return tryAsync(async () => {
      // Check idempotency
      const existing = await prisma.transaction.findFirst({
        where: { idempotencyKey: entry.idempotencyKey },
      })
      if (existing !== null && existing !== undefined) {
        log.info({ transactionId: existing.id }, 'Idempotent journal post — returning existing')
        return { transactionId: existing.id }
      }

      // Verify all accounts exist and belong to this branch
      const accountIds = entry.lines.map((l) => l.accountId)
      const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds }, branchId },
      })

      if (accounts.length !== accountIds.length) {
        const foundIds = new Set(accounts.map((a) => a.id))
        const missing = accountIds.filter((id) => !foundIds.has(id))
        throw new ValidationError(`Accounts not found or not in branch: ${missing.join(', ')}`)
      }

      const result = await prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            branchId,
            description: entry.description,
            date: entry.date,
            reference: entry.reference,
            idempotencyKey: entry.idempotencyKey,
            postedBy,
            status: 'POSTED',
          },
        })

        await tx.transactionLine.createMany({
          data: entry.lines.map((line) => ({
            transactionId: transaction.id,
            accountId: line.accountId,
            description: line.description,
            debitAmount: line.debitAmount.toDecimalPlaces(2).toNumber(),
            creditAmount: line.creditAmount.toDecimalPlaces(2).toNumber(),
          })),
        })

        // Update account balances — debit increases debit-normal accounts, credit increases credit-normal accounts
        for (const line of entry.lines) {
          const account = accounts.find((a) => a.id === line.accountId)
          if (account === undefined) continue

          const debitDelta = line.debitAmount.minus(line.creditAmount)
          // For asset and expense accounts: balance increases on debit
          // For liability, equity, income: balance increases on credit
          const isDebitNormal = account.type === 'ASSET' || account.type === 'EXPENSE'
          const balanceDelta = isDebitNormal ? debitDelta : debitDelta.negated()

          await tx.account.update({
            where: { id: line.accountId },
            data: {
              balance: {
                increment: balanceDelta.toNumber(),
              },
            },
          })
        }

        return transaction
      })

      log.info({ transactionId: result.id }, 'Journal posted successfully')
      return { transactionId: result.id }
    })
  }

  async voidTransaction(
    transactionId: string,
    voidedBy: string,
    mfaToken: string,
  ): Promise<Result<void>> {
    const log = createContextLogger({ module: 'journal.service', userId: voidedBy })

    if (mfaToken.trim().length === 0) {
      return err(new ValidationError('MFA token is required to void a transaction'))
    }

    return tryAsync(async () => {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { lines: true },
      })

      if (transaction === null || transaction === undefined) {
        throw new NotFoundError('Transaction', transactionId)
      }

      if (transaction.status === 'VOID') {
        throw new ConflictError(`Transaction ${transactionId} is already void`)
      }

      const reversingIdempotencyKey = `void-${transactionId}`

      await prisma.$transaction(async (tx) => {
        // Mark original as void
        await tx.transaction.update({
          where: { id: transactionId },
          data: { status: 'VOID', voidedBy, voidedAt: new Date() },
        })

        // Create reversing journal entry
        const reversing = await tx.transaction.create({
          data: {
            branchId: transaction.branchId,
            description: `VOID: ${transaction.description}`,
            date: new Date(),
            reference: `VOID-${transaction.reference ?? transactionId}`,
            idempotencyKey: reversingIdempotencyKey,
            postedBy: voidedBy,
            status: 'POSTED',
            reversalOf: transactionId,
          },
        })

        // Reverse lines (swap debit/credit)
        await tx.transactionLine.createMany({
          data: transaction.lines.map((line) => ({
            transactionId: reversing.id,
            accountId: line.accountId,
            description: `Reversal: ${line.description ?? ''}`,
            debitAmount: line.creditAmount,
            creditAmount: line.debitAmount,
          })),
        })

        // Reverse account balance updates
        const accountIds = transaction.lines.map((l) => l.accountId)
        const accounts = await tx.account.findMany({
          where: { id: { in: accountIds } },
        })

        for (const line of transaction.lines) {
          const account = accounts.find((a) => a.id === line.accountId)
          if (account === undefined) continue

          const debitDelta = new Decimal(line.debitAmount).minus(new Decimal(line.creditAmount))
          const isDebitNormal = account.type === 'ASSET' || account.type === 'EXPENSE'
          // Reverse the original balance change
          const balanceDelta = isDebitNormal ? debitDelta.negated() : debitDelta

          await tx.account.update({
            where: { id: line.accountId },
            data: { balance: { increment: balanceDelta.toNumber() } },
          })
        }
      })

      log.info({ transactionId }, 'Transaction voided and reversing entry posted')
    })
  }

  async getTransaction(
    transactionId: string,
  ): Promise<Result<Transaction & { lines: TransactionLine[] }>> {
    return tryAsync(async () => {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { lines: true },
      })

      if (transaction === null || transaction === undefined) {
        throw new NotFoundError('Transaction', transactionId)
      }

      return transaction
    })
  }

  async listTransactions(
    branchId: string,
    filters: {
      fromDate?: Date
      toDate?: Date
      accountId?: string
      status?: string
    },
    cursor?: string,
    limit?: number,
  ): Promise<Result<{ items: (Transaction & { lines: TransactionLine[] })[]; nextCursor: string | null }>> {
    return tryAsync(async () => {
      const take = Math.min(limit ?? PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT)

      const items = await prisma.transaction.findMany({
        where: {
          branchId,
          ...(filters.fromDate !== undefined ? { date: { gte: filters.fromDate } } : {}),
          ...(filters.toDate !== undefined ? { date: { lte: filters.toDate } } : {}),
          ...(filters.status !== undefined ? { status: filters.status } : {}),
          ...(filters.accountId !== undefined
            ? { lines: { some: { accountId: filters.accountId } } }
            : {}),
          ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
        },
        include: { lines: true },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: take + 1,
      })

      let nextCursor: string | null = null
      const hasMore = items.length > take
      if (hasMore) {
        items.pop()
        const last = items[items.length - 1]
        nextCursor = last !== undefined ? last.id : null
      }

      return { items, nextCursor }
    })
  }
}
