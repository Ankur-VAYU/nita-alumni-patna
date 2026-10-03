// Alumni directory: search and filters; contact details arrive already filtered by privacy settings.
(function () {
  'use strict';
  const { h, api, initials, fmtPhone } = window.NITA;
  const root = document.getElementById('directory');
  const state = { q: '', branch: '', batch: '', homeDistrict: '', workState: '', mentor: false, offset: 0 };
  let items = [];
  let ref = null;

  const results = h('div', { class: 'people' });
  const countLine = h('p', { class: 'muted small' });
  const moreBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: () => { state.offset = items.length; load(true); } }, 'Show more');

  function select(label, key, list) {
    const s = h('select', { 'aria-label': label, onchange: () => { state[key] = s.value; state.offset = 0; load(); } },
      h('option', { value: '' }, label), list.map((v) => h('option', { value: v }, v)));
    return s;
  }

  function card(m) {
    const wa = m.phone ? 'https://wa.me/' + m.phone.replace(/\D/g, '') : null;
    return h('article', { class: 'card person' },
      h('div', { class: 'person-head' },
        h('div', { class: 'avatar' }, m.hasPhoto ? h('img', { src: `/api/v1/members/${m.id}/photo`, alt: '', loading: 'lazy' }) : initials(m.name)),
        h('div', {}, h('h2', {}, m.name, m.isMe ? h('span', { class: 'muted small' }, ' (you)') : null),
          h('p', { class: 'muted small' }, `${m.degree} · ${m.branch} · ${m.batch}`))),
      (m.title || m.openToMentor) ? h('p', {}, m.title ? h('span', { class: 'tag ok' }, m.title) : null, ' ', m.openToMentor ? h('span', { class: 'tag info' }, 'Open to mentoring') : null) : null,
      h('dl', { class: 'kv' },
        (m.position || m.organisation) ? [h('dt', {}, 'Work'), h('dd', {}, [m.position, m.organisation].filter(Boolean).join(', '))] : null,
        m.workDistrict ? [h('dt', {}, 'Works in'), h('dd', {}, [m.workDistrict, m.workState].filter(Boolean).join(', '))] : null,
        h('dt', {}, 'Home'), h('dd', {}, `${m.homeDistrict}, Bihar`),
        m.skills ? [h('dt', {}, 'Skills'), h('dd', {}, m.skills)] : null,
        h('dt', {}, 'Phone'), h('dd', {}, m.phone ? fmtPhone(m.phone) : h('span', { class: 'muted' }, 'Hidden by member')),
        h('dt', {}, 'Email'), h('dd', {}, m.email || h('span', { class: 'muted' }, 'Hidden by member'))),
      h('p', { class: 'actions-row' },
        wa ? h('a', { class: 'btn small', href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
        m.email ? h('a', { class: 'btn ghost small', href: 'mailto:' + m.email }, 'Email') : null,
        m.linkedin ? h('a', { class: 'btn ghost small', href: m.linkedin, target: '_blank', rel: 'noopener' }, 'LinkedIn') : null));
  }

  async function load(append) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) qs.set(k, String(v));
    try {
      const r = await api('/api/v1/members?' + qs);
      items = append ? items.concat(r.items) : r.items;
      results.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'muted' }, 'No alumni match these filters.')]));
      countLine.textContent = items.length ? `${items.length}${r.more ? '+' : ''} alumni shown` : '';
      moreBtn.hidden = !r.more;
    } catch (e) { results.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
  }

  fetch('/api/v1/reference').then((r) => r.json()).then((r) => {
    ref = r;
    const years = []; for (let y = new Date().getFullYear(); y >= r.firstBatchYear; y--) years.push(String(y));
    let t;
    const q = h('input', { type: 'search', placeholder: 'Name, company, city or skill', 'aria-label': 'Search alumni',
      oninput: () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value.trim(); state.offset = 0; load(); }, 300); } });
    const mentor = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { state.mentor = e.target.checked; state.offset = 0; load(); } }), ' Open to mentoring');
    root.replaceChildren(
      h('h1', {}, 'Alumni directory'),
      h('p', { class: 'muted' }, 'Verified members only. Phone and email follow each person\'s privacy choice.'),
      h('div', { class: 'card filters' }, h('div', { class: 'grow' }, q),
        select('All branches', 'branch', r.branches), select('All batches', 'batch', years),
        select('Any home district', 'homeDistrict', r.homeDistricts), select('Working anywhere', 'workState', r.workStates), mentor),
      countLine, results, h('p', {}, moreBtn));
    load();
  });
})();
