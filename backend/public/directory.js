// Alumni directory, laid out like the prototype: filters and quick filters on the left, "where they work" and
// "home districts" on the right, then the cards. Contact details arrive already filtered by privacy settings.
(function () {
  'use strict';
  const { h, api, initials, fmtPhone } = window.NITA;
  const root = document.getElementById('directory');
  const state = { q: '', branch: '', batch: '', homeDistrict: '', workState: '', workDistrict: '', mentor: false, offset: 0 };
  let items = [];
  let summary;
  let panelTab = 'work';
  const controls = {};

  const results = h('div', { class: 'people' });
  const countLine = h('p', { class: 'muted' });
  const moreBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: () => { state.offset = items.length; load(true); } }, 'Show more');
  const chipsEl = h('div', { class: 'chips full' });
  const panel = h('div', { class: 'card section' });

  function set(changes) {
    Object.assign(state, changes, { offset: 0 });
    for (const [k, el] of Object.entries(controls)) el.value = state[k] || '';
    renderChips(); renderPanel(); load();
  }

  function select(label, key, list, blank) {
    const s = h('select', { id: 'f-' + key, onchange: () => set({ [key]: s.value }) }, h('option', { value: '' }, blank), list.map((v) => h('option', { value: v }, v)));
    controls[key] = s;
    return h('div', { class: 'field' }, h('label', { for: 'f-' + key }, label), s);
  }

  function renderChips() {
    const me = summary && summary.me;
    const chip = (label, active, toggle) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(active), onclick: toggle }, label);
    const list = [];
    if (me) {
      list.push(chip(`My batch (${me.batch})`, state.batch === String(me.batch), () => set({ batch: state.batch === String(me.batch) ? '' : String(me.batch) })));
      list.push(chip(`From ${me.homeDistrict}`, state.homeDistrict === me.homeDistrict, () => set({ homeDistrict: state.homeDistrict === me.homeDistrict ? '' : me.homeDistrict })));
    }
    list.push(chip('Working in Patna', state.workDistrict.toLowerCase() === 'patna', () => set({ workDistrict: state.workDistrict.toLowerCase() === 'patna' ? '' : 'Patna' })));
    list.push(chip('Open to mentoring', state.mentor, () => set({ mentor: !state.mentor })));
    chipsEl.replaceChildren(...list);
  }

  function renderPanel() {
    if (!summary) return;
    const rows = panelTab === 'work' ? summary.work : summary.home;
    const max = Math.max(1, ...rows.map((r) => r.n));
    const key = panelTab === 'work' ? 'workDistrict' : 'homeDistrict';
    const tab = (k, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(panelTab === k), onclick: () => { panelTab = k; renderPanel(); } }, label);
    panel.replaceChildren(
      h('div', { class: 'chips' }, tab('work', 'Where they work'), tab('home', 'Home districts')),
      rows.length
        ? h('div', { class: 'bars' }, rows.map((r) => {
          const on = (state[key] || '').toLowerCase() === r.place.toLowerCase();
          return h('button', { class: 'bar', type: 'button', 'aria-pressed': String(on), onclick: () => set({ [key]: on ? '' : r.place }) },
            h('span', {}, r.place), h('i', { style: `width:${Math.max(8, Math.round((r.n / max) * 100))}%` }), h('b', {}, r.n));
        }))
        : h('p', { class: 'muted' }, panelTab === 'work' ? 'No work places added yet.' : 'No members yet.'),
      h('p', { class: 'hint' }, 'Tap a place to filter. Home districts help plan meets in Bihar; work places show who can refer or help in each city.'));
  }

  function card(m) {
    const wa = m.phone ? 'https://wa.me/' + m.phone.replace(/\D/g, '') : null;
    const tags = [m.openToMentor ? h('span', { class: 'tag mentor' }, 'Mentor') : null, m.title ? h('span', { class: 'tag ok' }, m.title) : null].filter(Boolean);
    return h('article', { class: 'card person' },
      h('div', { class: 'person-head' },
        h('div', { class: 'avatar' }, m.hasPhoto ? h('img', { src: `/api/v1/members/${m.id}/photo`, alt: '', loading: 'lazy' }) : initials(m.name)),
        h('div', {}, h('h3', {}, m.name, m.isMe ? h('span', { class: 'muted' }, ' (you)') : null), h('div', { class: 'batch' }, `${m.degree} · ${m.batch}`))),
      tags.length ? h('div', { class: 'row', style: 'gap:6px' }, tags) : null,
      h('dl', { class: 'kv' },
        h('dt', {}, 'Branch'), h('dd', {}, m.branch),
        (m.position || m.organisation) ? [h('dt', {}, 'Role'), h('dd', {}, [m.position, m.organisation].filter(Boolean).join(', '))] : null,
        m.workDistrict ? [h('dt', {}, 'Works in'), h('dd', {}, [m.workDistrict, m.workState].filter(Boolean).join(', '))] : null,
        h('dt', {}, 'Home'), h('dd', {}, `${m.homeDistrict}, Bihar`),
        m.skills ? [h('dt', {}, 'Skills'), h('dd', {}, m.skills)] : null,
        h('dt', {}, 'Phone'), h('dd', { class: 'phone' }, m.phone ? fmtPhone(m.phone) : h('span', { class: 'muted' }, 'Hidden by member')),
        m.email ? [h('dt', {}, 'Email'), h('dd', {}, m.email)] : null),
      h('div', { class: 'actions', style: 'margin-top:auto' },
        wa ? h('a', { class: 'btn ghost small', href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
        m.email ? h('a', { class: 'btn ghost small', href: 'mailto:' + m.email }, 'Email') : null,
        m.linkedin ? h('a', { class: 'btn ghost small', href: m.linkedin, target: '_blank', rel: 'noopener' }, 'LinkedIn') : null));
  }

  async function load(append) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) qs.set(k, String(v));
    try {
      const r = await api('/api/v1/members?' + qs);
      items = append ? items.concat(r.items) : r.items;
      results.replaceChildren(...(items.length ? items.map(card) : [h('div', { class: 'card empty' }, 'No alumni match these filters.')]));
      countLine.textContent = `${items.length}${r.more ? '+' : ''} of ${summary ? summary.total : '…'} shown`;
      moreBtn.hidden = !r.more;
    } catch (e) { results.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
  }

  Promise.all([fetch('/api/v1/reference').then((r) => r.json()), api('/api/v1/members/summary')]).then(([r, s]) => {
    summary = s;
    const years = []; for (let y = new Date().getFullYear(); y >= r.firstBatchYear; y--) years.push(String(y));
    let t;
    const q = h('input', { id: 'f-q', type: 'search', placeholder: 'Name, company, city or skill',
      oninput: () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value.trim(); state.offset = 0; load(); }, 300); } });
    const city = h('input', { id: 'f-workDistrict', type: 'search', placeholder: 'Any city',
      onchange: () => set({ workDistrict: city.value.trim() }) });
    controls.workDistrict = city;
    root.replaceChildren(
      h('div', { class: 'top' }, h('div', {}, h('h1', {}, 'Alumni directory'),
        h('p', {}, `${s.total} verified alumni. Contact details follow each person's privacy settings.`))),
      h('div', { class: 'grid2 dir-top' },
        h('div', { class: 'filters' },
          h('div', { class: 'field full' }, h('label', { for: 'f-q' }, 'Search'), q),
          select('Branch', 'branch', r.branches, 'All branches'), select('Batch', 'batch', years, 'All batches'),
          select('Home district (Bihar)', 'homeDistrict', r.homeDistricts, 'All districts'), select('Working state', 'workState', r.workStates, 'All states'),
          h('div', { class: 'field' }, h('label', { for: 'f-workDistrict' }, 'Working city / district'), city),
          chipsEl),
        panel),
      countLine, results, h('p', {}, moreBtn));
    renderChips(); renderPanel(); load();
  }).catch((e) => root.replaceChildren(h('p', { class: 'note bad' }, e.message)));
})();
