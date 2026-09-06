import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { createGroup } from '@/server/groups/groups'
import { createTemplateFromPdf } from '@/server/templates/templates'
import { getPublicLanding, saveLandingSettings } from '../landing'
import {
  findSelfServiceProjectBySkin,
  getSelfServiceConfig,
  saveSelfServiceConfig,
} from '../self-service'

/**
 * Self-service settings live on the project and gate the public flow. What is
 * tested is the boundary: the flow only sees a project that is on and whole,
 * ids are verified inside the organization, and the generic joining form
 * steps aside while self-service is on.
 */

const FIXTURE = readFileSync('.design/tourism-2026/agreement.pdf')
const db = getDb()

let admin: StaffSession
let stranger: StaffSession
let groupId: string
let templateId: string

async function makeSession(orgName: string): Promise<StaffSession> {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: orgName }).returning({ id: schema.organizations.id })
  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: org.id,
      email: `${suffix}@xtra.test`,
      name: orgName,
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      isAdmin: true,
    })
    .returning({ id: schema.users.id })
  return { userId: user.id, organizationId: org.id, email: `${suffix}@xtra.test`, name: orgName, isAdmin: true }
}

beforeAll(async () => {
  admin = await makeSession('Tourism Org')
  stranger = await makeSession('Other Org')
  const group = await createGroup({ session: admin, name: 'חודש התיירות הישראלית 2026', kind: 'supplier' })
  if (!group.ok) throw new Error(group.message)
  groupId = group.id
  const template = await createTemplateFromPdf({ session: admin, buffer: FIXTURE, name: 'הסכם השתתפות' })
  if (!template.ok) throw new Error(template.message)
  templateId = template.templateId
})

describe('self-service settings', () => {
  it('starts off, and refuses to switch on without template, owner and skin', async () => {
    expect((await getSelfServiceConfig(admin, groupId)).enabled).toBe(false)

    const noTemplate = await saveSelfServiceConfig(admin, groupId, { enabled: true, skin: 'tourism-2026', ownerUserId: admin.userId })
    expect(noTemplate.ok).toBe(false)

    const noOwner = await saveSelfServiceConfig(admin, groupId, { enabled: true, skin: 'tourism-2026', templateId })
    expect(noOwner.ok).toBe(false)

    expect(await findSelfServiceProjectBySkin('tourism-2026')).toBeNull()
  })

  it('verifies template and owner inside the organization', async () => {
    // The stranger cannot even reach the project.
    await expect(saveSelfServiceConfig(stranger, groupId, { templateId })).rejects.toBeInstanceOf(ForbiddenError)

    const strangersOwn = await createGroup({ session: stranger, name: 'Their project', kind: 'supplier' })
    if (!strangersOwn.ok) throw new Error(strangersOwn.message)
    const crossTenant = await saveSelfServiceConfig(stranger, strangersOwn.id, { templateId, ownerUserId: admin.userId })
    expect(crossTenant.ok).toBe(false)
  })

  it('switches on with everything in place and becomes visible to the public flow', async () => {
    const saved = await saveSelfServiceConfig(admin, groupId, {
      enabled: true,
      skin: 'tourism-2026',
      templateId,
      ownerUserId: admin.userId,
      linkTtlDays: 45,
      thankYouTitle: 'ההצטרפות הושלמה בהצלחה',
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.config.linkTtlDays).toBe(45)

    const project = await findSelfServiceProjectBySkin('tourism-2026')
    expect(project?.groupId).toBe(groupId)
    expect(project?.template.id).toBe(templateId)
    expect(project?.template.fields.map((f) => f.variableKey)).toContain('business_name')
    expect(project?.owner.id).toBe(admin.userId)

    expect(await findSelfServiceProjectBySkin('no-such-skin')).toBeNull()
  })

  it('survives a save of the regular joining form, and hides that form while on', async () => {
    const landing = await saveLandingSettings(admin, groupId, { enabled: true, config: { title: 'טופס רגיל' } })
    expect((await getSelfServiceConfig(admin, groupId)).enabled).toBe(true)
    expect(await getPublicLanding(landing.slug!)).toBeNull()

    const off = await saveSelfServiceConfig(admin, groupId, { enabled: false })
    expect(off.ok).toBe(true)
    expect(await getPublicLanding(landing.slug!)).not.toBeNull()
    expect(await findSelfServiceProjectBySkin('tourism-2026')).toBeNull()
  })
})
