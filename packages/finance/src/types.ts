import type { Decimal } from 'decimal.js'

export interface JournalEntry {
  description: string
  date: Date
  lines: JournalLine[]
  reference?: string
  idempotencyKey: string
}

export interface JournalLine {
  accountId: string
  description?: string
  debitAmount: Decimal
  creditAmount: Decimal
}

export interface TrialBalance {
  accounts: TrialBalanceRow[]
  totalDebits: Decimal
  totalCredits: Decimal
  isBalanced: boolean
  asAt: Date
}

export interface TrialBalanceRow {
  accountId: string
  accountCode: string
  accountName: string
  accountType: string
  debitBalance: Decimal
  creditBalance: Decimal
}

export interface IncomeStatement {
  branchId: string
  fromDate: Date
  toDate: Date
  totalIncome: Decimal
  totalExpenses: Decimal
  surplus: Decimal
  incomeLines: FinanceLine[]
  expenseLines: FinanceLine[]
}

export interface BalanceSheet {
  branchId: string
  asAt: Date
  totalAssets: Decimal
  totalLiabilities: Decimal
  totalEquity: Decimal
  assets: FinanceLine[]
  liabilities: FinanceLine[]
  equity: FinanceLine[]
}

export interface FinanceLine {
  accountCode: string
  accountName: string
  amount: Decimal
}

export interface GiftAidClaim {
  branchId: string
  fromDate: Date
  toDate: Date
  donations: GiftAidDonation[]
  totalDonations: Decimal
  totalGiftAid: Decimal
}

export interface GiftAidDonation {
  donorName: string
  donorAddress: string
  donorPostcode: string
  donationDate: Date
  donationAmount: Decimal
  giftAidAmount: Decimal
}
