export interface UploadDocumentInput {
  branchId: string
  uploadedBy: string
  name: string
  description?: string
  category: 'POLICY' | 'CONTRACT' | 'MINUTES' | 'REPORT' | 'INVOICE' | 'RECEIPT' | 'OTHER'
  buffer: Buffer
  mimeType: string
  isPublic?: boolean
  tags?: string[]
}

export interface DocumentListItem {
  id: string
  name: string
  category: string
  mimeType: string
  sizeBytes: bigint
  sharePointUrl: string
  version: number
  isPublic: boolean
  tags: string[]
  uploadedBy: string
  createdAt: Date
}
