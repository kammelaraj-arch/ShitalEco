import bcrypt from 'bcryptjs'
import { logger } from '@shital/config'
import { prisma } from './client.js'

async function main(): Promise<void> {
  const seedLogger = logger.child({ module: 'seed' })

  // ─── 1. Default Branch ──────────────────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Shital Temple - Main',
      code: 'MAIN',
      address: {
        line1: '1 Temple Road',
        line2: '',
        city: 'Leicester',
        county: 'Leicestershire',
        postcode: 'LE1 1AA',
        country: 'GB',
      },
      phone: '+44 116 000 0000',
      email: 'info@shital.org',
      isActive: true,
      settings: {
        timezone: 'Europe/London',
        locale: 'en-GB',
        currency: 'GBP',
      },
    },
  })
  seedLogger.info({ branchId: branch.id }, 'Branch upserted')

  // ─── 2. Super Admin User ─────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@shital.org' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'admin@shital.org',
      passwordHash,
      name: 'System Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
      mfaEnabled: false,
      branchId: branch.id,
    },
  })
  seedLogger.info({ userId: admin.id }, 'Super admin upserted')

  // ─── 3. Chart of Accounts ────────────────────────────────────────────────────
  // Root accounts (no parent)
  const assetRoot = await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '1000' } },
    update: {},
    create: {
      code: '1000',
      name: 'Assets',
      type: 'ASSET',
      branchId: branch.id,
      currency: 'GBP',
    },
  })

  const liabilityRoot = await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '2000' } },
    update: {},
    create: {
      code: '2000',
      name: 'Liabilities',
      type: 'LIABILITY',
      branchId: branch.id,
      currency: 'GBP',
    },
  })

  const equityRoot = await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '3000' } },
    update: {},
    create: {
      code: '3000',
      name: 'Equity / Funds',
      type: 'EQUITY',
      branchId: branch.id,
      currency: 'GBP',
    },
  })

  const incomeRoot = await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '4000' } },
    update: {},
    create: {
      code: '4000',
      name: 'Income',
      type: 'INCOME',
      branchId: branch.id,
      currency: 'GBP',
    },
  })

  const expenseRoot = await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5000' } },
    update: {},
    create: {
      code: '5000',
      name: 'Expenses',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
    },
  })

  seedLogger.info(
    {
      accounts: [assetRoot.code, liabilityRoot.code, equityRoot.code, incomeRoot.code, expenseRoot.code],
    },
    'Root accounts upserted',
  )

  // Asset sub-accounts
  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '1010' } },
    update: {},
    create: {
      code: '1010',
      name: 'Current Account',
      type: 'ASSET',
      branchId: branch.id,
      currency: 'GBP',
      parentId: assetRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '1020' } },
    update: {},
    create: {
      code: '1020',
      name: 'Savings Account',
      type: 'ASSET',
      branchId: branch.id,
      currency: 'GBP',
      parentId: assetRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '1030' } },
    update: {},
    create: {
      code: '1030',
      name: 'Petty Cash',
      type: 'ASSET',
      branchId: branch.id,
      currency: 'GBP',
      parentId: assetRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '1040' } },
    update: {},
    create: {
      code: '1040',
      name: 'Accounts Receivable',
      type: 'ASSET',
      branchId: branch.id,
      currency: 'GBP',
      parentId: assetRoot.id,
    },
  })

  // Liability sub-accounts
  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '2010' } },
    update: {},
    create: {
      code: '2010',
      name: 'Accounts Payable',
      type: 'LIABILITY',
      branchId: branch.id,
      currency: 'GBP',
      parentId: liabilityRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '2020' } },
    update: {},
    create: {
      code: '2020',
      name: 'PAYE / NIC Liability',
      type: 'LIABILITY',
      branchId: branch.id,
      currency: 'GBP',
      parentId: liabilityRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '2030' } },
    update: {},
    create: {
      code: '2030',
      name: 'Pension Liability',
      type: 'LIABILITY',
      branchId: branch.id,
      currency: 'GBP',
      parentId: liabilityRoot.id,
    },
  })

  // Equity sub-accounts
  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '3010' } },
    update: {},
    create: {
      code: '3010',
      name: 'General Fund',
      type: 'EQUITY',
      branchId: branch.id,
      currency: 'GBP',
      parentId: equityRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '3020' } },
    update: {},
    create: {
      code: '3020',
      name: 'Building Fund',
      type: 'EQUITY',
      branchId: branch.id,
      currency: 'GBP',
      parentId: equityRoot.id,
    },
  })

  // Income sub-accounts
  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '4010' } },
    update: {},
    create: {
      code: '4010',
      name: 'Donations',
      type: 'INCOME',
      branchId: branch.id,
      currency: 'GBP',
      parentId: incomeRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '4020' } },
    update: {},
    create: {
      code: '4020',
      name: 'Gift Aid Reclaim',
      type: 'INCOME',
      branchId: branch.id,
      currency: 'GBP',
      parentId: incomeRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '4030' } },
    update: {},
    create: {
      code: '4030',
      name: 'Service Bookings',
      type: 'INCOME',
      branchId: branch.id,
      currency: 'GBP',
      parentId: incomeRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '4040' } },
    update: {},
    create: {
      code: '4040',
      name: 'Hall Hire',
      type: 'INCOME',
      branchId: branch.id,
      currency: 'GBP',
      parentId: incomeRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '4050' } },
    update: {},
    create: {
      code: '4050',
      name: 'Grants',
      type: 'INCOME',
      branchId: branch.id,
      currency: 'GBP',
      parentId: incomeRoot.id,
    },
  })

  // Expense sub-accounts
  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5010' } },
    update: {},
    create: {
      code: '5010',
      name: 'Salaries & Wages',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5020' } },
    update: {},
    create: {
      code: '5020',
      name: 'Employer NIC',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5030' } },
    update: {},
    create: {
      code: '5030',
      name: 'Pension Contributions',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5040' } },
    update: {},
    create: {
      code: '5040',
      name: 'Utilities',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5050' } },
    update: {},
    create: {
      code: '5050',
      name: 'Maintenance & Repairs',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5060' } },
    update: {},
    create: {
      code: '5060',
      name: 'Office & Admin',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5070' } },
    update: {},
    create: {
      code: '5070',
      name: 'Religious Supplies',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  await prisma.account.upsert({
    where: { branchId_code: { branchId: branch.id, code: '5080' } },
    update: {},
    create: {
      code: '5080',
      name: 'IT & Software',
      type: 'EXPENSE',
      branchId: branch.id,
      currency: 'GBP',
      parentId: expenseRoot.id,
    },
  })

  seedLogger.info('Chart of accounts seeded')

  seedLogger.info('Seed completed successfully')
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed')
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
