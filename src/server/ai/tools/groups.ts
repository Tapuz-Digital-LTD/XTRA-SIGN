import { planBulkSend, runBulkSend } from '@/server/groups/bulk-send'
import {
  addCompanies,
  createGroup,
  listGroupCompanies,
  listGroups,
  removeCompanies,
  renameGroup,
} from '@/server/groups/groups'
import { listTemplates } from '@/server/templates/templates'
import { defineTool, schema, str, strList } from '../registry'

/**
 * Groups, and sending to them.
 *
 * The bulk send is split in two on purpose: `prepare_bulk_send` is safe and
 * shows exactly who would receive what, and `run_bulk_send` is critical and
 * only ever runs behind an approval. The assistant is at its most useful — and
 * most dangerous — here, so the shape of the tools makes the dangerous half
 * impossible to reach by accident.
 */

export const listGroupsTool = defineTool<{ kind?: 'supplier' | 'customer' }>({
  name: 'list_groups',
  description: 'All groups, optionally only supplier groups or only customer groups.',
  risk: 'safe',
  input: schema({
    kind: { type: 'string', enum: ['supplier', 'customer'], description: 'קבוצות ספקים או לקוחות' },
  }),
  async run({ kind }, { session }) {
    const groups = await listGroups(session, kind)
    return {
      summary: groups.length ? `${groups.length} קבוצות.` : 'אין עדיין קבוצות.',
      data: {
        kind: 'groups',
        rows: groups.map((group) => ({
          id: group.id,
          name: group.name,
          companyCount: group.companyCount,
          groupKind: group.kind,
          href: `/groups/${group.id}`,
        })),
      },
    }
  },
})

export const createGroupTool = defineTool<{
  name: string
  description?: string
  kind?: 'supplier' | 'customer'
  companyIds?: string[]
}>({
  name: 'create_group',
  description: 'Create a group of suppliers or customers, optionally seeded with companies.',
  risk: 'safe',
  input: schema(
    {
      name: str('Group name'),
      description: str('What the group is for'),
      kind: { type: 'string', enum: ['supplier', 'customer'], description: 'קבוצת ספקים או לקוחות' },
      companyIds: strList('Company ids to put in the group immediately'),
    },
    ['name'],
  ),
  async run(input, { session }) {
    const result = await createGroup({
      session,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind ?? null,
      companyIds: input.companyIds,
    })
    if (!result.ok) return { summary: result.message }

    return {
      summary: `נוצרה הקבוצה "${input.name}".`,
      target: { type: 'group', id: result.id },
      data: {
        kind: 'groups',
        rows: [
          {
            id: result.id,
            name: input.name,
            companyCount: input.companyIds?.length ?? 0,
            groupKind: input.kind ?? null,
            href: `/groups/${result.id}`,
          },
        ],
      },
    }
  },
})

export const updateGroupTool = defineTool<{ groupId: string; name?: string; description?: string }>({
  name: 'update_group',
  description: 'Rename a group or change its description.',
  risk: 'confirm',
  input: schema({ groupId: str('Group id'), name: str('New name'), description: str('New description') }, [
    'groupId',
  ]),
  preview: ({ name }) => (name ? `שינוי שם הקבוצה ל"${name}"` : 'עדכון פרטי הקבוצה'),
  async run({ groupId, name, description }, { session }) {
    const groups = await listGroups(session)
    const current = groups.find((group) => group.id === groupId)
    if (!current) return { summary: 'הקבוצה לא נמצאה.' }

    const result = await renameGroup({
      session,
      groupId,
      name: name ?? current.name,
      description: description ?? current.description,
    })
    if (!result.ok) return { summary: result.message }
    return {
      summary: 'הקבוצה עודכנה.',
      target: { type: 'group', id: groupId },
      data: { kind: 'link', href: `/groups/${groupId}`, label: 'פתח קבוצה' },
    }
  },
})

export const addCompaniesToGroup = defineTool<{ groupId: string; companyIds: string[] }>({
  name: 'add_companies_to_group',
  description: 'Add suppliers or customers to a group. A company may be in several groups.',
  risk: 'safe',
  input: schema({ groupId: str('Group id'), companyIds: strList('Company ids') }, [
    'groupId',
    'companyIds',
  ]),
  async run({ groupId, companyIds }, { session }) {
    const result = await addCompanies({ session, groupId, companyIds })
    return {
      summary: result.added ? `נוספו ${result.added} חברות לקבוצה.` : 'כל החברות כבר היו בקבוצה.',
      target: { type: 'group', id: groupId },
      data: { kind: 'link', href: `/groups/${groupId}`, label: 'פתח קבוצה' },
    }
  },
})

export const removeCompaniesFromGroup = defineTool<{ groupId: string; companyIds: string[] }>({
  name: 'remove_companies_from_group',
  description: 'Take companies out of a group. The companies themselves are not deleted.',
  risk: 'confirm',
  input: schema({ groupId: str('Group id'), companyIds: strList('Company ids') }, [
    'groupId',
    'companyIds',
  ]),
  preview: ({ companyIds }) => `הוצאת ${companyIds.length} חברות מהקבוצה`,
  async run({ groupId, companyIds }, { session }) {
    const result = await removeCompanies({ session, groupId, companyIds })
    return {
      summary: `הוצאו ${result.removed} חברות מהקבוצה.`,
      target: { type: 'group', id: groupId },
    }
  },
})

export const listGroupCompaniesTool = defineTool<{ groupId: string }>({
  name: 'list_group_companies',
  description: 'The companies in a group, and whether each one can be sent to.',
  risk: 'safe',
  input: schema({ groupId: str('Group id') }, ['groupId']),
  async run({ groupId }, { session }) {
    const companies = await listGroupCompanies(session, groupId)
    return {
      summary: `${companies.length} חברות בקבוצה.`,
      target: { type: 'group', id: groupId },
      data: {
        kind: 'companies',
        rows: companies.map((company) => ({
          id: company.id,
          name: company.name,
          companyKind: company.kind,
          contactName: company.contactName,
          readyToSend: company.readyToSend,
          href: `/companies/${company.id}`,
        })),
      },
    }
  },
})

export const prepareBulkSend = defineTool<{ groupId: string; templateId: string }>({
  name: 'prepare_bulk_send',
  description:
    'Work out exactly who would receive a template and what each copy would say, without creating or sending anything. Always run this before run_bulk_send.',
  risk: 'safe',
  input: schema({ groupId: str('Group id'), templateId: str('Template id') }, [
    'groupId',
    'templateId',
  ]),
  async run({ groupId, templateId }, { session }) {
    const plan = await planBulkSend({ session, groupId, templateId })
    const blocked = plan.rows.filter((row) => !row.ready)

    return {
      summary: `${plan.rows.length} חברות בקבוצה · ${plan.readyCount} מוכנות לשליחה${
        blocked.length ? ` · ${blocked.length} חסרות פרטים` : ''
      }.`,
      target: { type: 'group', id: groupId },
      data: {
        kind: 'bulk_plan',
        templateName: plan.templateName,
        groupId,
        templateId,
        readyCount: plan.readyCount,
        rows: plan.rows,
      },
    }
  },
})

export const runBulkSendTool = defineTool<{
  groupId: string
  templateId: string
  companyIds: string[]
}>({
  name: 'run_bulk_send',
  description:
    'Actually create and send one agreement per company. Only the company ids listed are sent to. Requires approval.',
  risk: 'critical',
  input: schema(
    {
      groupId: str('Group id'),
      templateId: str('Template id'),
      companyIds: strList('Exactly the companies to send to — normally the ready ones from prepare_bulk_send'),
    },
    ['groupId', 'templateId', 'companyIds'],
  ),
  preview: ({ companyIds }) =>
    `שליחת ${companyIds.length} הסכמים לחתימה — ${companyIds.length} הודעות ייצאו בפועל`,
  async run({ groupId, templateId, companyIds }, { session }) {
    const result = await runBulkSend({ session, groupId, templateId, companyIds })
    return {
      summary: result.failed.length
        ? `נשלחו ${result.sent}, נכשלו ${result.failed.length}.`
        : `נשלחו ${result.sent} הסכמים.`,
      target: { type: 'group', id: groupId },
      data: {
        kind: 'bulk_result',
        batchId: result.batchId,
        sent: result.sent,
        failed: result.failed,
        href: `/groups/${groupId}`,
      },
    }
  },
})

export const retryBulkFailures = defineTool<{
  groupId: string
  templateId: string
  batchId: string
  companyIds: string[]
}>({
  name: 'retry_bulk_failures',
  description:
    'Re-run an existing batch. Companies already sent are skipped, so only the failures go out.',
  risk: 'critical',
  input: schema(
    {
      groupId: str('Group id'),
      templateId: str('Template id'),
      batchId: str('The batch to continue'),
      companyIds: strList('The companies to retry'),
    },
    ['groupId', 'templateId', 'batchId', 'companyIds'],
  ),
  preview: ({ companyIds }) => `ניסיון חוזר עבור ${companyIds.length} חברות שנכשלו`,
  async run({ groupId, templateId, batchId, companyIds }, { session }) {
    const result = await runBulkSend({ session, groupId, templateId, companyIds, batchId })
    return {
      summary: `נשלחו ${result.sent}, דילג על ${result.skipped} שכבר נשלחו.`,
      target: { type: 'group', id: groupId },
      data: { kind: 'bulk_result', batchId: result.batchId, sent: result.sent, failed: result.failed },
    }
  },
})

export const listTemplatesTool = defineTool<Record<string, never>>({
  name: 'list_templates',
  description: 'The saved templates that can be sent to a company or a group.',
  risk: 'safe',
  input: schema({}),
  async run(_input, { session }) {
    const templates = await listTemplates(session)
    return {
      summary: templates.length ? `${templates.length} תבניות.` : 'אין עדיין תבניות.',
      data: {
        kind: 'templates',
        rows: templates.map((template) => ({
          id: template.id,
          name: template.name,
          signatureCount: template.signatureCount,
          href: `/templates`,
        })),
      },
    }
  },
})
