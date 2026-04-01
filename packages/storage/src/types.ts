export interface UploadFileInput {
  path: string // e.g. 'documents/main-temple/contract.pdf'
  buffer: Buffer
  mimeType: string
  name: string
}

export interface StoredFile {
  id: string // SharePoint item ID
  name: string
  webUrl: string
  downloadUrl: string
  size: number
  createdAt: string
  mimeType: string
}

export interface FolderListing {
  items: StoredFile[]
  nextLink?: string
}
