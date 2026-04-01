import { Prisma, PrismaClient } from '@prisma/client'
import { logger } from '@shital/config'

const logConfig = [
  { emit: 'event', level: 'query' },
  { emit: 'event', level: 'error' },
  { emit: 'event', level: 'warn' },
] satisfies Prisma.LogDefinition[]

type EventEmittingClient = PrismaClient<{ log: typeof logConfig }>

const globalForPrisma = globalThis as unknown as { prisma: EventEmittingClient }

export const prisma: EventEmittingClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logConfig,
  })

prisma.$on('error', (e: Prisma.LogEvent) =>
  logger.error({ err: e }, 'Prisma error'),
)
prisma.$on('warn', (e: Prisma.LogEvent) =>
  logger.warn({ msg: e.message }, 'Prisma warning'),
)

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma
}

export { PrismaClient }
