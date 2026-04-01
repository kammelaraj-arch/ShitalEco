import pino from 'pino'
import { env } from './env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty' } }
    : {}),
})

export function createContextLogger(context: {
  branchId?: string
  userId?: string
  module?: string
}) {
  return logger.child(context)
}
