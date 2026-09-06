import { mkdirSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { MAIL_TEMPLATES, renderSample } from '../../src/server/mail/catalog'

/**
 * Every email template with sample data, rendered and photographed at a
 * phone width and a desktop width, plus its plain-text twin — so what a
 * person receives is looked at, not assumed.
 *
 *   npx tsx scripts/qa/email-shots.ts
 */
const OUT = process.env.OUT ?? '.design/qa/emails'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(OUT, { recursive: true })

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let failures = 0
  try {
    for (const template of MAIL_TEMPLATES) {
      const rendered = await renderSample(template.key, { name: 'XTRA Sign', logoUrl: null, color: '#1d4ed8', supportEmail: 'support@example.co.il' }, 'https://example.invalid')
      writeFileSync(`${OUT}/${template.key}.html`, rendered.html)
      writeFileSync(`${OUT}/${template.key}.txt`, rendered.text)
      const problems: string[] = []
      if (rendered.html.includes('{{')) problems.push('unresolved variable')
      if (!rendered.html.includes('dir="rtl"')) problems.push('not rtl')
      if (rendered.text.trim().length < 40) problems.push('plain text too short')
      for (const width of [375, 720]) {
        const page = await browser.newPage()
        await page.setViewport({ width, height: 900 })
        await page.setContent(rendered.html, { waitUntil: 'load' })
        const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }))
        if (scroll.sw > scroll.vw + 1) problems.push(`horizontal overflow at ${width}`)
        // RTL full-page captures can start at the wrong edge; size the viewport to the page instead.
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewport({ width, height: Math.min(4000, height + 20) })
        await page.screenshot({ path: `${OUT}/${template.key}-${width}.png`, captureBeyondViewport: false })
        await page.close()
      }
      if (problems.length) failures++
      console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${template.key}  "${rendered.subject}"  ${problems.join('; ')}`)
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'EMAIL SHOTS OK' : `${failures} templates with problems`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
