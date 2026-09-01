import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LIMITS, ProcessingError, type ProcessingFailure } from './limits'

/**
 * Runs a conversion inside the isolated converter container.
 *
 * The app process never invokes LibreOffice itself. Untrusted bytes only ever
 * meet that binary inside a container with no network, a read-only rootfs, all
 * capabilities dropped, and memory/cpu/pid ceilings — so a hostile document has
 * nothing to reach even if it wins.
 */

export type ConversionInput = {
  buffer: Buffer
  kind: 'pdf' | 'doc' | 'docx'
}

export type ConversionResult = {
  pdf: Buffer
  pages: Buffer[]
  pageCount: number
}

const IMAGE_NAME = process.env.CONVERTER_IMAGE ?? 'xtra-sign-converter'

/**
 * Total wall-clock ceiling for one job, above the per-step timeouts inside the
 * container.
 *
 * The inner timeouts assume the process is alive enough to enforce them. This
 * one does not: if the container wedges before Python runs, or the daemon
 * stalls, the caller is still released. A worker that waits forever on one bad
 * document stops serving every later one.
 */
const HARD_TIMEOUT_MS = LIMITS.CONVERSION_TIMEOUT_MS + LIMITS.RENDER_TIMEOUT_MS + 15_000

const FAILURES = new Set<string>([
  'timeout',
  'too_many_pages',
  'output_too_large',
  'conversion_failed',
  'unreadable',
])

export async function convertDocument(input: ConversionInput): Promise<ConversionResult> {
  // Host-side scratch, removed in the finally below whatever happens.
  const workDir = await mkdtemp(join(tmpdir(), 'xtra-sign-'))

  try {
    const sourceName = `source.${input.kind}`
    await writeFile(join(workDir, sourceName), input.buffer)

    const job = JSON.stringify({
      sourcePath: `/work/${sourceName}`,
      kind: input.kind,
      outputDir: '/work/out',
    })

    const raw = await runContainer(workDir, job)

    let parsed: { ok: boolean; failure?: string; pages?: number; images?: string[] }
    try {
      parsed = JSON.parse(raw)
    } catch {
      // The container produced something that is not a result. Treat as a
      // failed conversion rather than crashing the request.
      throw new ProcessingError('conversion_failed')
    }

    if (!parsed.ok) {
      const failure = FAILURES.has(parsed.failure ?? '')
        ? (parsed.failure as ProcessingFailure)
        : 'conversion_failed'
      throw new ProcessingError(failure)
    }

    const outDir = join(workDir, 'out')
    const pdf = await readFile(join(outDir, 'document.pdf'))

    if (pdf.length > LIMITS.MAX_RENDERED_BYTES) throw new ProcessingError('output_too_large')

    const imageNames = (await readdir(outDir)).filter((f) => f.endsWith('.png')).sort(byPageNumber)
    if (imageNames.length === 0) throw new ProcessingError('unreadable')

    const pages: Buffer[] = []
    for (const name of imageNames) {
      const page = await readFile(join(outDir, name))
      if (page.length > LIMITS.MAX_PAGE_IMAGE_BYTES) throw new ProcessingError('output_too_large')
      pages.push(page)
    }

    return { pdf, pages, pageCount: parsed.pages ?? pages.length }
  } finally {
    // Runs on success, on a thrown ProcessingError, and on an unexpected throw.
    // A leaked temp directory per bad upload fills the disk, and then every
    // later conversion fails for an unrelated reason.
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * `docker run` with every isolation flag set explicitly rather than relying on
 * the compose file — this is the path that actually executes, so the guarantees
 * have to be stated here.
 */
function runContainer(workDir: string, job: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--network', 'none',
        '--read-only',
        '--tmpfs', '/scratch:rw,noexec,nosuid,size=512m',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        '--security-opt', 'no-new-privileges:true',
        '--cap-drop', 'ALL',
        '--memory', '1g',
        '--memory-swap', '1g',
        '--cpus', '1.0',
        '--pids-limit', '128',
        '-e', 'SCRATCH_DIR=/scratch',
        '-e', 'HOME=/scratch',
        '-e', `CONVERSION_TIMEOUT_MS=${LIMITS.CONVERSION_TIMEOUT_MS}`,
        '-e', `RENDER_TIMEOUT_MS=${LIMITS.RENDER_TIMEOUT_MS}`,
        '-e', `MAX_PAGES=${LIMITS.MAX_PAGES}`,
        '-e', `RENDER_WIDTH_PX=${LIMITS.RENDER_WIDTH_PX}`,
        '-v', `${workDir}:/work`,
        IMAGE_NAME,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // SIGKILL, not SIGTERM: the point of the outer timeout is that the thing
      // being killed may be unresponsive.
      child.kill('SIGKILL')
      reject(new ProcessingError('timeout'))
    }, HARD_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      // Bound what a runaway container can push into this process's heap.
      if (stdout.length > 1_000_000) {
        child.kill('SIGKILL')
      }
    })

    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ProcessingError('conversion_failed'))
    })

    child.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(stdout)
    })

    child.stdin.write(job)
    child.stdin.end()
  })
}

/** page-2.png must sort after page-10.png by number, not by string. */
function byPageNumber(a: string, b: string): number {
  const n = (s: string) => Number(s.match(/(\d+)/)?.[1] ?? 0)
  return n(a) - n(b)
}
