import { Client } from '@microsoft/microsoft-graph-client'
import {
  ok,
  err,
  tryAsync,
  type Result,
  createContextLogger,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  ExternalServiceError,
  ValidationError,
  PAGINATION,
  env,
} from '@shital/config'
import { prisma, type DocumentPermission, DocumentCategory } from '@shital/db'
import type { UploadDocumentInput, DocumentListItem } from './types.js'

const log = createContextLogger({ module: 'document.service' })

function toDocumentListItem(doc: {
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
}): DocumentListItem {
  return {
    id: doc.id,
    name: doc.name,
    category: doc.category,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    sharePointUrl: doc.sharePointUrl,
    version: doc.version,
    isPublic: doc.isPublic,
    tags: doc.tags,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
  }
}

export class DocumentService {
  private readonly graphClient: Client

  constructor(graphAccessToken: string) {
    this.graphClient = Client.init({
      authProvider: (done) => {
        done(null, graphAccessToken)
      },
    })
  }

  async upload(input: UploadDocumentInput): Promise<Result<DocumentListItem>> {
    return tryAsync(async () => {
      const siteId = env.SHAREPOINT_SITE_ID
      const driveId = env.SHAREPOINT_DRIVE_ID

      const remotePath = `documents/${input.branchId}/${input.name}`
      const uploadUrl = `/sites/${siteId}/drives/${driveId}/items/root:/${remotePath}:/content`

      const uploadResult = await this.graphClient
        .api(uploadUrl)
        .header('Content-Type', input.mimeType)
        .put(input.buffer) as Record<string, unknown>

      const sharePointItemId = String(uploadResult['id'] ?? '')
      const sharePointUrl = String(
        (uploadResult['webUrl'] as string | undefined) ??
        (uploadResult['@microsoft.graph.downloadUrl'] as string | undefined) ??
        '',
      )

      if (sharePointItemId === '' || sharePointUrl === '') {
        throw new ExternalServiceError('SharePoint', 'Upload response missing id or webUrl')
      }

      const doc = await prisma.document.create({
        data: {
          branchId: input.branchId,
          uploadedBy: input.uploadedBy,
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.buffer.length),
          sharePointUrl,
          sharePointItemId,
          isPublic: input.isPublic ?? false,
          tags: input.tags ?? [],
        },
      })

      log.info(
        { documentId: doc.id, branchId: input.branchId, uploadedBy: input.uploadedBy },
        'Document uploaded to SharePoint and saved to DB',
      )

      return toDocumentListItem(doc)
    })
  }

  async getDownloadUrl(documentId: string, userId: string): Promise<Result<string>> {
    return tryAsync(async () => {
      const doc = await prisma.document.findFirst({
        where: { id: documentId, deletedAt: null },
        include: { accessList: true },
      })

      if (doc === null || doc === undefined) {
        throw new NotFoundError('Document', documentId)
      }

      // Public documents are accessible to all authenticated users
      if (!doc.isPublic) {
        const hasAccess = doc.accessList.some((a) => a.userId === userId)
        if (!hasAccess) {
          // Check if uploader
          if (doc.uploadedBy !== userId) {
            throw new ForbiddenError('You do not have access to this document')
          }
        }
      }

      const siteId = env.SHAREPOINT_SITE_ID
      const driveId = env.SHAREPOINT_DRIVE_ID

      const driveItem = await this.graphClient
        .api(`/sites/${siteId}/drives/${driveId}/items/${doc.sharePointItemId}`)
        .select('@microsoft.graph.downloadUrl')
        .get() as Record<string, unknown>

      const downloadUrl = String(driveItem['@microsoft.graph.downloadUrl'] ?? '')

      if (downloadUrl === '') {
        throw new ExternalServiceError('SharePoint', 'Could not retrieve download URL')
      }

      return downloadUrl
    })
  }

  async list(
    branchId: string,
    category?: string,
    cursor?: string,
    limit?: number,
  ): Promise<Result<{ items: DocumentListItem[]; nextCursor: string | null }>> {
    return tryAsync(async () => {
      const take = Math.min(limit ?? PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT)

      const docs = await prisma.document.findMany({
        where: {
          branchId,
          deletedAt: null,
          ...(category !== undefined ? { category: category as unknown as DocumentCategory } : {}),
          ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
      })

      let nextCursor: string | null = null
      const hasMore = docs.length > take

      if (hasMore) {
        docs.pop()
        const last = docs[docs.length - 1]
        nextCursor = last !== undefined ? last.id : null
      }

      return {
        items: docs.map(toDocumentListItem),
        nextCursor,
      }
    })
  }

  async delete(documentId: string, userId: string): Promise<Result<void>> {
    return tryAsync(async () => {
      const doc = await prisma.document.findFirst({
        where: { id: documentId, deletedAt: null },
      })

      if (doc === null || doc === undefined) {
        throw new NotFoundError('Document', documentId)
      }

      const siteId = env.SHAREPOINT_SITE_ID
      const driveId = env.SHAREPOINT_DRIVE_ID

      // Soft delete in DB
      await prisma.document.update({
        where: { id: documentId },
        data: { deletedAt: new Date() },
      })

      // Also remove from SharePoint
      try {
        await this.graphClient
          .api(`/sites/${siteId}/drives/${driveId}/items/${doc.sharePointItemId}`)
          .delete()
      } catch (spError) {
        log.error(
          { documentId, sharePointItemId: doc.sharePointItemId, err: spError },
          'Soft deleted in DB but failed to delete from SharePoint',
        )
      }

      log.info({ documentId, userId }, 'Document soft deleted')
    })
  }

  async grantAccess(
    documentId: string,
    targetUserId: string,
    permission: 'VIEW' | 'EDIT',
    grantedBy: string,
  ): Promise<Result<void>> {
    return tryAsync(async () => {
      const doc = await prisma.document.findFirst({
        where: { id: documentId, deletedAt: null },
      })

      if (doc === null || doc === undefined) {
        throw new NotFoundError('Document', documentId)
      }

      await prisma.documentAccess.upsert({
        where: {
          documentId_userId: {
            documentId,
            userId: targetUserId,
          },
        },
        create: {
          documentId,
          userId: targetUserId,
          permission: permission as DocumentPermission,
          grantedBy,
        },
        update: {
          permission: permission as DocumentPermission,
          grantedBy,
        },
      })

      log.info({ documentId, targetUserId, permission, grantedBy }, 'Document access granted')
    })
  }
}
