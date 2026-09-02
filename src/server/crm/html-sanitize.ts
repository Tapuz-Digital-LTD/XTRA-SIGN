import { parseFragment, serialize } from 'parse5'

/**
 * The shape of the tree we walk.
 *
 * Declared here rather than imported from parse5's internal tree-adapter path,
 * which is not part of its public entry points and would break on a minor
 * release. Structural typing means these still line up with the real nodes.
 */
type Attribute = { name: string; value: string }
type ChildNode = { nodeName: string; tagName?: string; attrs?: Attribute[]; childNodes?: ChildNode[] }
type Element = ChildNode & { tagName: string; attrs: Attribute[] }
type ParentNode = { childNodes: ChildNode[] }

/**
 * Sanitising a Fireberry print template before it is rendered.
 *
 * The body is third-party HTML: it comes from the CRM, and whoever edits a
 * template there decides what is in it. It is handed to a real browser, so this
 * is an allow-list, not a blocklist — anything not named here does not survive.
 *
 * This is defence in depth rather than the only control. The renderer also runs
 * with scripting disabled and every network request blocked, so a tag that slips
 * through still cannot execute or phone home. Both layers exist because either
 * one could be weakened by a later change without the other noticing.
 *
 * What is deliberately kept is everything the page's appearance depends on:
 * `<style>` blocks, `style` attributes, tables, lists and images. Stripping
 * those would produce a faithful-looking failure — a PDF that renders, but not
 * the agreement anyone approved.
 */

/** Tags allowed through. Anything else is dropped, children and all. */
const ALLOWED_TAGS = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style',
  'div', 'span', 'p', 'br', 'hr', 'center',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'font',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'img', 'a', 'figure', 'figcaption', 'blockquote', 'pre', 'code',
])

/**
 * Attributes allowed on any element. `style` is here on purpose: inline CSS is
 * how these templates lay themselves out, and CSS cannot execute script in any
 * browser this renders in.
 */
const ALLOWED_ATTRS = new Set([
  'style', 'class', 'id', 'dir', 'lang', 'align', 'valign',
  'width', 'height', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing',
  'bgcolor', 'color', 'face', 'size', 'charset', 'name', 'content',
  'src', 'alt', 'href', 'title',
])

/** URL schemes a `src`/`href` may use. Everything else becomes nothing. */
const SAFE_SCHEME = /^(https?:|mailto:|tel:|#|\/)/i

export type TemplateImage = { index: number; src: string }

function isElement(node: ChildNode): node is Element {
  return typeof node.tagName === 'string' && Array.isArray(node.attrs)
}

function hasChildren(node: ChildNode): node is ChildNode & ParentNode {
  return Array.isArray(node.childNodes)
}

/**
 * Walks the tree once, dropping what is not allowed and numbering the images.
 *
 * Images are marked with `data-xtra-img` rather than rewritten here: turning a
 * URL into a data URI means fetching it, which is I/O and belongs to
 * `inlineAssets`. The marker is the contract between the two steps.
 */
function clean(parent: ParentNode, images: TemplateImage[]): void {
  const kept: ChildNode[] = []

  for (const node of parent.childNodes) {
    if (!isElement(node)) {
      // Text and comments: text is content, comments are noise but harmless.
      if (node.nodeName !== '#comment') kept.push(node)
      continue
    }

    const tag = node.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) continue

    node.attrs = node.attrs.filter((attr: Attribute) => {
      const name = attr.name.toLowerCase()
      // Every `on*` handler, whatever it is called.
      if (name.startsWith('on')) return false
      if (!ALLOWED_ATTRS.has(name)) return false
      if ((name === 'src' || name === 'href') && !SAFE_SCHEME.test(attr.value.trim())) return false
      return true
    })

    if (tag === 'img') {
      const src = node.attrs.find((a: Attribute) => a.name === 'src')?.value
      if (src) {
        node.attrs.push({ name: 'data-xtra-img', value: String(images.length) })
        images.push({ index: images.length, src })
      }
    }

    if (hasChildren(node)) clean(node, images)
    kept.push(node)
  }

  parent.childNodes = kept
}

/**
 * Returns the safe HTML and the images found in it, in document order.
 *
 * Merge tokens (`{[!field]}`) are text and pass through untouched — they are
 * the merge-field step's input, not this one's.
 */
export function sanitizeTemplateHtml(html: string): { html: string; images: TemplateImage[] } {
  const images: TemplateImage[] = []
  const fragment = parseFragment(html)
  clean(fragment as unknown as ParentNode, images)
  return { html: serialize(fragment), images }
}
