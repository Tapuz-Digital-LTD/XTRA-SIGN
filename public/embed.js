/**
 * XTRA Sign form embed.
 *
 * Usage (what the "copy embed code" button hands out):
 *
 *   <div data-xtra-form="FORM_ID"></div>
 *   <script src="https://<host>/embed.js" async></script>
 *
 * Replaces each [data-xtra-form] element with an iframe of the hosted form,
 * keeps the iframe's height in step with its content, and re-dispatches a
 * successful submission as a DOM event the host page can listen to:
 *
 *   document.addEventListener('xtra-form:submitted', function (e) { ... })
 *
 * No cookies, no storage, no data collection — the script only carries size
 * and a success ping between the iframe and the page.
 */
;(function () {
  'use strict'

  var script = document.currentScript
  var origin
  try {
    origin = new URL(script && script.src ? script.src : location.href).origin
  } catch (e) {
    return
  }

  function mount(el) {
    if (el.getAttribute('data-xtra-mounted')) return
    var formId = el.getAttribute('data-xtra-form')
    if (!formId || !/^[A-Za-z0-9_-]{1,64}$/.test(formId)) return
    el.setAttribute('data-xtra-mounted', '1')

    var iframe = document.createElement('iframe')
    iframe.src = origin + '/join/' + encodeURIComponent(formId) + '?embed=1'
    iframe.title = el.getAttribute('data-xtra-title') || 'טופס הצטרפות'
    iframe.style.width = '100%'
    iframe.style.border = '0'
    iframe.style.display = 'block'
    iframe.style.minHeight = '320px'
    iframe.setAttribute('loading', 'lazy')
    iframe.setAttribute('scrolling', 'no')
    el.appendChild(iframe)

    window.addEventListener('message', function (event) {
      if (event.origin !== origin || event.source !== iframe.contentWindow) return
      var data = event.data || {}
      if (data.type === 'xtra-form:height' && typeof data.height === 'number' && data.height > 0) {
        iframe.style.height = Math.min(Math.ceil(data.height), 10000) + 'px'
      }
      if (data.type === 'xtra-form:submitted') {
        try {
          el.dispatchEvent(new CustomEvent('xtra-form:submitted', { bubbles: true }))
        } catch (e) {
          /* older browsers: the form still works, only the event is lost */
        }
      }
    })
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-xtra-form]')
    for (var i = 0; i < nodes.length; i++) mount(nodes[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll)
  } else {
    mountAll()
  }
})()
