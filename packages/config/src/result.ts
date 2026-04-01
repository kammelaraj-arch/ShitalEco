import { DomainError } from './errors.js'

export type Result<T, E extends Error = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error }
}

export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, DomainError>> {
  try {
    return ok(await fn())
  } catch (e) {
    if (e instanceof DomainError) {
      return err(e)
    }
    return err(new DomainError('UNKNOWN', String(e)))
  }
}
