// Jobs & Help board: post, filter, show interest, see who responded, close, report.
(function () {
  'use strict';
  const { h, api, toast, fmtPhone } = window.NITA;
  const root = document.getElementById('board');
  const TYPES = { job: 'Vacancy', referral: 'Referral', help: 'Help needed', offer: 'Offering help', mentor: 'Mentorship' };
  const REASONS = ['Asks for money or a fee', 'Paid placement agency', 'Wrong or misleading information', 'Promotional, not relevant', 'Inappropriate content'];
  const state = { type: '', state: '', mine: false, closed: false };
  const listEl = h('div', { class: 'list' });
  const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  let ref;

  function postCard(p) {
    const extra = h('div', { hidden: true });
    const status = p.status !== 'open' ? h('span', { class: 'tag ' + (p.status === 'filled' ? 'ok' : '') }, p.status === 'filled' ? 'Filled' : 'Closed')
      : p.expired ? h('span', { class: 'tag' }, 'Expired') : h('span', { class: 'muted small' }, `Open · closes ${fmt(p.expiresAt)}`);
    const actions = h('div', { class: 'actions-row' });
    const open = p.status === 'open' && !p.expired;
    if (p.isMine || p.canManage) {
      if (p.isMine) actions.append(h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        const list = await api(`/api/v1/posts/${p.id}/interested`);
        extra.replaceChildren(list.length ? h('ul', { class: 'plain' }, list.map((m) => h('li', {}, `${m.name} · ${m.branch} ${m.batch}`, m.phone ? h('span', { class: 'muted small' }, ` · ${fmtPhone(m.phone)}`) : null, m.email ? h('span', { class: 'muted small' }, ` · ${m.email}`) : null))) : h('p', { class: 'muted' }, 'No responses yet.'));
        extra.hidden = !extra.hidden;
      } }, `${p.interested} interested`));
      const setStatus = (s, label, msg) => h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        try { await api(`/api/v1/posts/${p.id}/status`, { json: { status: s } }); toast(msg); load(); } catch (e) { toast(e.message); }
      } }, label);
      if (open) actions.append(setStatus('filled', 'Mark filled', 'Marked as filled'), setStatus('closed', 'Close', 'Post closed'));
      else actions.append(setStatus('open', 'Reopen for 30 days', 'Reopened for 30 days'));
    }
    if (!p.isMine && open) {
      actions.append(h('button', { class: 'btn small' + (p.iAmInterested ? ' on' : ''), type: 'button', onclick: async () => {
        try { const r = await api(`/api/v1/posts/${p.id}/interest`, { json: {} }); toast(r.interested ? 'The author can now see your interest' : 'Interest removed'); load(); } catch (e) { toast(e.message); }
      } }, p.iAmInterested ? 'Interested ✓' : "I'm interested"));
      if (p.authorPhone) actions.append(h('a', { class: 'btn ghost small', href: 'https://wa.me/' + p.authorPhone.replace(/\D/g, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp author'));
    }
    if (!p.isMine) {
      const reason = h('select', { 'aria-label': 'Reason' }, REASONS.map((r) => h('option', {}, r)));
      const box = h('div', { class: 'actions-row', hidden: true }, reason, h('button', { class: 'btn danger small', type: 'button', onclick: async () => {
        try { await api(`/api/v1/posts/${p.id}/report`, { json: { reason: reason.value } }); toast('Reported to the moderators'); load(); } catch (e) { toast(e.message); }
      } }, 'Send report'));
      actions.append(h('button', { class: 'linkish', type: 'button', disabled: p.iReported, onclick: () => (box.hidden = !box.hidden) }, p.iReported ? 'Reported' : 'Report'), box);
    }
    return h('article', { class: 'card post' + (open ? '' : ' past') },
      h('div', { class: 'actions-row' }, h('span', { class: 'tag ' + p.type }, TYPES[p.type]), h('span', { class: 'muted small' }, `${p.district}, ${p.state}${p.organisation ? ' · ' + p.organisation : ''}`)),
      h('h2', {}, p.title), h('p', { class: 'body' }, p.body),
      p.applyLink ? h('p', {}, h('a', { href: p.applyLink, target: '_blank', rel: 'noopener' }, 'Apply or read more')) : null,
      h('p', { class: 'muted small' }, `${p.authorName} · ${p.authorBranch} ${p.authorBatch} · posted ${fmt(p.createdAt)}`),
      h('div', { class: 'post-foot' }, status, actions), extra);
  }

  async function load() {
    const qs = new URLSearchParams();
    if (state.type) qs.set('type', state.type);
    if (state.state) qs.set('state', state.state);
    if (state.mine) qs.set('mine', 'true');
    if (state.closed) qs.set('closed', 'true');
    try {
      const list = await api('/api/v1/posts?' + qs);
      listEl.replaceChildren(...(list.length ? list.map(postCard) : [h('p', { class: 'card muted' }, 'Nothing here yet. Share a vacancy in your organisation or ask fellow alumni for help.')]));
    } catch (e) { listEl.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
  }

  function composer() {
    const errs = {};
    const f = (name, label, input) => { errs[name] = h('span', { class: 'err' }); return h('div', { class: 'field' + (['title', 'body', 'type'].includes(name) ? ' full' : '') }, h('label', { for: 'n-' + name }, label), input, errs[name]); };
    const form = h('form', { class: 'form', novalidate: true },
      f('type', 'What are you posting?', h('select', { id: 'n-type', name: 'type' }, Object.entries(TYPES).map(([k, v]) => h('option', { value: k }, v)))),
      f('title', 'Title', h('input', { id: 'n-title', name: 'title', maxlength: 120, placeholder: 'e.g. Hiring two site engineers in Patna' })),
      f('body', 'Details', h('textarea', { id: 'n-body', name: 'body', rows: 4, maxlength: 2000, placeholder: 'Role, experience, how to apply, or how people can help' })),
      f('organisation', 'Organisation (optional)', h('input', { id: 'n-organisation', name: 'organisation' })),
      f('district', 'City or district', h('input', { id: 'n-district', name: 'district' })),
      f('state', 'State', h('select', { id: 'n-state', name: 'state' }, ref.workStates.map((s) => h('option', { value: s, selected: s === 'Bihar' }, s)))),
      f('applyLink', 'Application link (optional)', h('input', { id: 'n-applyLink', name: 'applyLink', type: 'url', placeholder: 'https://' })),
      f('expiresInDays', 'Close the post after', h('select', { id: 'n-expiresInDays', name: 'expiresInDays' }, [['15', '15 days'], ['30', '30 days'], ['60', '60 days']].map(([v, l]) => h('option', { value: v, selected: v === '30' }, l)))),
      h('p', { class: 'note info full' }, 'Posting rules: no fees, deposits or paid placement offers; share only your own contact details; mark the post filled when done.'),
      h('div', { class: 'full actions-row' }, h('button', { class: 'btn' }, 'Post'), h('button', { class: 'btn ghost', type: 'button', onclick: () => (wrap.hidden = true) }, 'Cancel')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((e) => (e.textContent = ''));
      try { await api('/api/v1/posts', { json: Object.fromEntries(new FormData(form)) }); toast('Posted'); form.reset(); wrap.hidden = true; load(); }
      catch (e) { if (e.fields) Object.entries(e.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; }); toast(e.message); }
    });
    const wrap = h('section', { class: 'card', hidden: true }, h('h2', {}, 'New post'), form);
    return wrap;
  }

  fetch('/api/v1/reference').then((r) => r.json()).then((r) => {
    ref = r;
    const comp = composer();
    const chips = h('div', { class: 'chips' }, [['', 'All'], ...Object.entries(TYPES)].map(([k, l]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.type === k), onclick: (ev) => { state.type = k; chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); ev.target.setAttribute('aria-pressed', 'true'); load(); } }, l)));
    const st = h('select', { 'aria-label': 'State', onchange: () => { state.state = st.value; load(); } }, h('option', { value: '' }, 'All states'), r.workStates.map((s) => h('option', { value: s }, s)));
    const tog = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { state[key] = e.target.checked; load(); } }), ' ' + label);
    root.replaceChildren(
      h('div', { class: 'toolbar between' }, h('div', {}, h('h1', {}, 'Jobs & Help'), h('p', { class: 'muted' }, 'Vacancies, referrals, mentoring and help between alumni. Posts close automatically when they expire.')),
        h('button', { class: 'btn', type: 'button', onclick: () => { comp.hidden = false; comp.scrollIntoView({ behavior: 'smooth' }); } }, 'New post')),
      comp, h('div', { class: 'card filters' }, chips, st, tog('mine', 'Only my posts'), tog('closed', 'Show filled and expired')), listEl);
    load();
  });
})();
