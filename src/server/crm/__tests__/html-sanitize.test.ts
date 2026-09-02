import { describe, expect, it } from 'vitest'
import { sanitizeTemplateHtml } from '../html-sanitize'

/**
 * The template body is third-party HTML from the CRM. It is rendered by a real
 * browser, so anything executable that survives this step is a real problem —
 * even though the renderer also disables scripting and blocks the network.
 */

describe('sanitizeTemplateHtml', () => {
  it('removes scripts, handlers, external stylesheets and form controls', () => {
    const { html } = sanitizeTemplateHtml(
      '<link rel="stylesheet" href="http://x/a.css">' +
        '<script>alert(1)</script>' +
        '<form action="http://evil"><input name="a"></form>' +
        '<iframe src="http://evil"></iframe>' +
        '<div onclick="evil()" style="color:red">שלום</div>',
    )
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/onclick/i)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/<form|<input/i)
    expect(html).not.toMatch(/<iframe/i)
  })

  it('keeps the layout the template depends on', () => {
    const { html } = sanitizeTemplateHtml(
      '<style>td{padding:10px}</style>' +
        '<div style="color:red"><table><tr><td><b>שלום</b></td></tr></table></div>' +
        '<ol><li>סעיף</li></ol>',
    )
    expect(html).toContain('<style>')
    expect(html).toContain('padding:10px')
    expect(html).toContain('color:red')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>')
    expect(html).toContain('שלום')
    expect(html).toContain('<li>')
  })

  it('neutralises a javascript: url on a link', () => {
    const { html } = sanitizeTemplateHtml('<a href="javascript:alert(1)">x</a>')
    expect(html).not.toMatch(/javascript:/i)
  })

  it('collects images in document order and keeps them in place', () => {
    const { html, images } = sanitizeTemplateHtml(
      '<img src="https://a/logo.png"><p>x</p><img src="https://b/sig.jpg" width="120">',
    )
    expect(images).toEqual([
      { index: 0, src: 'https://a/logo.png' },
      { index: 1, src: 'https://b/sig.jpg' },
    ])
    // The marker is what inlineAssets later rewrites, so it must survive.
    expect(html).toMatch(/data-xtra-img="0"/)
    expect(html).toMatch(/data-xtra-img="1"/)
    expect(html).toContain('width="120"')
  })

  it('leaves merge tokens untouched for the merge-field step', () => {
    const { html } = sanitizeTemplateHtml('<p>{[!pcfsuppliers_pcfcity]}</p>')
    expect(html).toContain('{[!pcfsuppliers_pcfcity]}')
  })
})
