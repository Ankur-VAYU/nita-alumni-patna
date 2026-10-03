// Small helpers shared by the member pages. Builds DOM nodes, never HTML strings from data.
window.NITA = (function () {
  'use strict';
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  async function api(path, opts = {}) {
    const headers = { 'x-requested-with': 'nita-admin' };
    let body;
    if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
    const res = await fetch(path, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login?m=need'; throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || 'Something went wrong'); e.fields = data.fields; throw e; }
    return data;
  }
  let timer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => (t.hidden = true), 3000);
  }
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const fmtPhone = (p) => (p && p.startsWith('+91') && p.length === 13 ? `${p.slice(3, 8)} ${p.slice(8)}` : p);
  return { h, api, toast, initials, fmtPhone };
})();
