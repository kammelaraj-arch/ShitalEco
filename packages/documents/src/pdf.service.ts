import puppeteer from 'puppeteer'
import Handlebars from 'handlebars'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  tryAsync,
  type Result,
  createContextLogger,
  DomainError,
} from '@shital/config'

const log = createContextLogger({ module: 'pdf.service' })

const TEMPLATES_DIR = join(__dirname, 'templates')

const BUILT_IN_TEMPLATES = ['payslip', 'donation-receipt', 'gift-aid-certificate'] as const
type BuiltInTemplate = (typeof BUILT_IN_TEMPLATES)[number]

function isBuiltInTemplate(name: string): name is BuiltInTemplate {
  return (BUILT_IN_TEMPLATES as readonly string[]).includes(name)
}

export async function generatePdf(
  htmlContent: string,
  options?: { format?: 'A4' | 'Letter'; landscape?: boolean },
): Promise<Result<Buffer>> {
  return tryAsync(async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    try {
      const page = await browser.newPage()
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' })

      const pdfBuffer = await page.pdf({
        format: options?.format ?? 'A4',
        landscape: options?.landscape ?? false,
        printBackground: true,
        margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' },
      })

      log.info(
        { format: options?.format ?? 'A4', sizeBytes: pdfBuffer.length },
        'PDF generated',
      )

      return Buffer.from(pdfBuffer)
    } finally {
      await browser.close()
    }
  })
}

export async function generateFromTemplate(
  templateName: string,
  data: Record<string, unknown>,
): Promise<Result<Buffer>> {
  if (!isBuiltInTemplate(templateName)) {
    return {
      ok: false,
      error: new DomainError(
        'INVALID_TEMPLATE',
        `Unknown template: ${templateName}. Available: ${BUILT_IN_TEMPLATES.join(', ')}`,
      ),
    }
  }

  return tryAsync(async () => {
    const templatePath = join(TEMPLATES_DIR, `${templateName}.hbs`)
    const templateSource = await readFile(templatePath, 'utf-8')
    const compiledTemplate = Handlebars.compile(templateSource)
    const html = compiledTemplate(data)

    const result = await generatePdf(html)

    if (!result.ok) {
      throw result.error
    }

    return result.value
  })
}
