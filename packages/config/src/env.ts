import { z } from 'zod'

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // NextAuth
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url(),

  // Microsoft OAuth
  MS_CLIENT_ID: z.string().min(1),
  MS_CLIENT_SECRET: z.string().min(1),
  MS_TENANT_ID: z.string().min(1),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Apple OAuth
  APPLE_CLIENT_ID: z.string().min(1),
  APPLE_CLIENT_SECRET: z.string().min(1),

  // SendGrid
  SENDGRID_API_KEY: z.string().min(1),

  // Meta WhatsApp
  META_WHATSAPP_TOKEN: z.string().min(1),
  META_WHATSAPP_PHONE_ID: z.string().min(1),
  META_WHATSAPP_VERIFY_TOKEN: z.string().min(1),

  // PayPal
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_TERMINAL_LOCATION_ID: z.string().min(1).optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Meilisearch
  MEILISEARCH_URL: z.string().url(),
  MEILISEARCH_MASTER_KEY: z.string().min(1),

  // SharePoint
  SHAREPOINT_SITE_ID: z.string().min(1),
  SHAREPOINT_DRIVE_ID: z.string().min(1),

  // Security
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be exactly 64 hex characters'),

  // Server
  CORS_ORIGINS: z.string().default('*'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
})

export type Env = z.infer<typeof envSchema>

export function createEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(input)
  if (!result.success) {
    const formatted = result.error.format()
    console.error('Invalid environment variables:', JSON.stringify(formatted, null, 2))
    throw new Error(
      `Invalid environment variables:\n${result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    )
  }
  return result.data
}

// Lazy singleton — only parsed once on first import
let _env: Env | undefined

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (_env === undefined) {
      _env = createEnv()
    }
    return (_env as Record<string, unknown>)[prop]
  },
})
