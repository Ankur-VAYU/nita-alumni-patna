// Admin pages: review registrations, manage members, add members, import, activity log.
// Talks to /api/v1/admin with the session cookie. Everything is built with DOM nodes, never
// innerHTML with data, so names and addresses cannot inject markup.
(function () {
  'use strict';
  const root = document.getElementById('admin');
  const ROLE = root.dataset.role;
  const IS_ADMIN = ROLE === 'admin';
  let reference = null;
  let tab = location.hash.replace('#', '') || 'pending';

  /* ---------- helpers ---------- */
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
  const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3000);
  }

  async function api(path, opts = {}) {
    const headers = { 'x-requested-with': 'nita-admin' };
    let body;
    if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
    if (opts.csv !== undefined) { headers['content-type'] = 'text/csv'; body = opts.csv; }
    const res = await fetch('/api/v1/admin' + path, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login?m=need'; throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || 'Something went wrong'); e.fields = data.fields; throw e; }
    return data;
  }

  const matchTag = (m) =>
    m.batchMatch === 'full' ? h('span', { class: 'tag ok' }, 'Batch list: full match')
      : m.batchMatch === 'partial' ? h('span', { class: 'tag warn' }, 'Batch list: partial match')
        : h('span', { class: 'tag bad' }, 'Not in batch list');
  const statusTag = (s) => h('span', { class: 'tag ' + ({ verified: 'ok', pending: 'info', rejected: 'bad', suspended: 'bad' }[s] || '') }, s);
  const avatar = (m) => h('div', { class: 'avatar' }, m.hasPhoto ? h('img', { src: `/api/v1/admin/members/${m.id}/photo`, alt: '' }) : initials(m.name));

  /* ---------- layout ---------- */
  const TABS = [
    ['pending', 'Registrations'],
    ['members', 'Members'],
    ...(IS_ADMIN ? [['add', 'Add member'], ['import', 'Import & export'], ['events', 'Events & payments']] : []),
    ['reports', 'Reports'],
    ['activity', 'Activity log'],
  ];
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('section', { class: 'card' });
  root.replaceChildren(
    h('div', {}, h('h1', {}, 'Admin'), h('p', { class: 'muted' }, IS_ADMIN ? 'Verify registrations, manage members, events and reported posts.' : 'As a moderator you can review registrations and reported posts.')),
    tabBar, panel,
  );

  function renderTabs(pendingCount) {
    tabBar.replaceChildren(...TABS.map(([k, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => show(k) }, label,
        k === 'pending' && pendingCount ? h('span', { class: 'count' }, pendingCount) : null)));
  }

  async function show(k) {
    tab = k; history.replaceState(null, '', '#' + k);
    renderTabs(lastPending);
    panel.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      await { pending: viewPending, members: viewMembers, add: viewAdd, import: viewImport, events: viewEvents, reports: viewReports, activity: viewActivity }[k]();
    } catch (e) {
      panel.replaceChildren(h('p', { class: 'note bad' }, e.message));
    }
  }
  let lastPending = 0;

  /* ---------- registrations ---------- */
  async function viewPending() {
    const list = await api('/members?status=pending&limit=200');
    lastPending = list.length; renderTabs(lastPending);
    if (!list.length) return panel.replaceChildren(h('h2', {}, 'Registrations'), h('p', { class: 'muted' }, 'Nothing waiting. New registrations from the join form appear here.'));
    panel.replaceChildren(
      h('h2', {}, `Waiting for review (${list.length})`),
      h('p', { class: 'muted small' }, 'Approve when the batch list matches, or after checking the proof document. A rejection reason is shown to the applicant.'),
      h('div', { class: 'list' }, list.map(pendingCard)),
    );
  }

  function pendingCard(m) {
    const actions = h('div', { class: 'actions' });
    const approve = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      approve.disabled = true;
      try { await api(`/members/${m.id}/approve`, { method: 'POST', json: {} }); toast(`${m.name} approved`); viewPending(); }
      catch (e) { toast(e.message); approve.disabled = false; }
    } }, 'Approve');
    const reason = h('select', { 'aria-label': 'Reason for rejecting' },
      ['Roll number not found in batch records', 'Proof document unclear or missing', 'Name does not match the proof', 'Duplicate registration', 'Not an NIT Agartala alumnus', 'Home district is not in Bihar']
        .map((r) => h('option', {}, r)));
    const rejectBox = h('div', { class: 'inline-reject', hidden: true }, reason,
      h('button', { class: 'btn danger small', type: 'button', onclick: async (ev) => {
        ev.target.disabled = true;
        try { await api(`/members/${m.id}/reject`, { method: 'POST', json: { reason: reason.value } }); toast(`${m.name} rejected`); viewPending(); }
        catch (e) { toast(e.message); ev.target.disabled = false; }
      } }, 'Confirm reject'));
    actions.append(approve, h('button', { class: 'btn ghost small', type: 'button', onclick: () => (rejectBox.hidden = !rejectBox.hidden) }, 'Reject…'), rejectBox);
    return h('article', { class: 'card item' }, avatar(m),
      h('div', {},
        h('h2', {}, m.name),
        h('p', { class: 'muted small' }, `${m.rollNo || 'No roll number'} · ${m.degree} · ${m.branch} · ${m.batch}`),
        h('p', {}, matchTag(m), m.batchMatchNotes ? h('span', { class: 'muted small' }, '  ' + m.batchMatchNotes) : null),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Mobile'), h('dd', {}, m.phone),
          h('dt', {}, 'Email'), h('dd', {}, m.email || '—'),
          h('dt', {}, 'Work'), h('dd', {}, [m.position, m.organisation].filter(Boolean).join(', ') + (m.workDistrict ? ` · ${m.workDistrict}, ${m.workState || ''}` : '')),
          h('dt', {}, 'Home'), h('dd', {}, `${m.homeDistrict}, Bihar`),
          h('dt', {}, 'Vouched by'), h('dd', {}, m.vouchedBy || '—'),
          h('dt', {}, 'Proof'), h('dd', {}, m.hasProof ? h('a', { href: `/api/v1/admin/members/${m.id}/proof`, target: '_blank', rel: 'noopener' }, m.proofName || 'Open document') : 'Not uploaded'),
          h('dt', {}, 'Registered'), h('dd', {}, fmtDate(m.createdAt)))),
      actions);
  }

  /* ---------- members ---------- */
  async function viewMembers() {
    const q = h('input', { type: 'search', placeholder: 'Name, mobile, roll number or company', 'aria-label': 'Search members' });
    const status = h('select', { 'aria-label': 'Status' }, [['verified', 'Verified'], ['', 'All'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([v, l]) => h('option', { value: v }, l)));
    const out = h('div', { class: 'tablewrap' });
    const load = async () => {
      const qs = new URLSearchParams({ limit: '300' });
      if (q.value.trim()) qs.set('q', q.value.trim());
      if (status.value) qs.set('status', status.value);
      const list = await api('/members?' + qs);
      out.replaceChildren(list.length ? memberTable(list, load) : h('p', { class: 'muted' }, 'No members match.'));
    };
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    status.addEventListener('change', load);
    panel.replaceChildren(h('h2', {}, 'Members'),
      h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, h('label', {}, 'Search'), q), h('div', { class: 'field' }, h('label', {}, 'Status'), status)),
      out);
    await load();
  }

  function memberTable(list, reload) {
    return h('table', {},
      h('thead', {}, h('tr', {}, ['Member', 'Batch', 'Contact', 'Status', 'Role', ...(IS_ADMIN ? ['Change'] : [])].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((m) => {
        const cells = [
          h('td', {}, h('b', {}, m.name), m.title ? h('div', { class: 'muted small' }, m.title) : null, !m.email ? h('div', { class: 'err' }, 'No email: cannot sign in') : null),
          h('td', {}, `${m.batch} · ${m.branch}`),
          h('td', {}, m.phone, h('div', { class: 'muted small' }, m.email || '')),
          h('td', {}, statusTag(m.status)),
          h('td', {}, m.role),
        ];
        if (IS_ADMIN) {
          const role = h('select', { 'aria-label': 'Role for ' + m.name }, ['member', 'moderator', 'admin'].map((r) => h('option', { value: r, selected: r === m.role }, r)));
          const title = h('select', { 'aria-label': 'Title for ' + m.name }, ['', ...(reference ? reference.titles : [])].map((t) => h('option', { value: t, selected: (m.title || '') === t }, t || 'No title')));
          const save = h('button', { class: 'btn small', type: 'button', onclick: async () => {
            try { await api(`/members/${m.id}/role`, { json: { role: role.value, title: title.value || null } }); toast('Saved'); reload(); }
            catch (e) { toast(e.message); }
          } }, 'Save');
          const susp = m.status === 'verified'
            ? h('button', { class: 'btn danger small', type: 'button', onclick: async () => { if (!confirm(`Suspend ${m.name}? They will not be able to sign in.`)) return; try { await api(`/members/${m.id}/suspend`, { json: {} }); toast('Suspended'); reload(); } catch (e) { toast(e.message); } } }, 'Suspend')
            : m.status === 'suspended'
              ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await api(`/members/${m.id}/reinstate`, { json: {} }); toast('Reinstated'); reload(); } catch (e) { toast(e.message); } } }, 'Reinstate')
              : null;
          cells.push(h('td', {}, m.status === 'verified' ? h('div', { class: 'toolbar' }, role, title, save) : null, susp));
        }
        return h('tr', {}, cells);
      })));
  }

  /* ---------- add member ---------- */
  async function viewAdd() {
    const R = reference;
    const years = []; for (let y = new Date().getFullYear(); y >= R.firstBatchYear; y--) years.push(String(y));
    const fields = [
      ['name', 'Full name', 'text', null, true], ['phone', 'Mobile number', 'tel', null, true], ['email', 'Email (Google account used to sign in)', 'email', null, true],
      ['rollNo', 'Roll number', 'text'], ['degree', 'Degree', 'select', R.degrees, true], ['branch', 'Branch', 'select', R.branches, true],
      ['batch', 'Batch (passing year)', 'select', years, true], ['homeDistrict', 'Home district (Bihar)', 'select', R.homeDistricts, true],
      ['position', 'Current position', 'text'], ['organisation', 'Current organisation', 'text'],
      ['workDistrict', 'Work city / district', 'text'], ['workState', 'Working state', 'select', R.workStates],
      ['role', 'Role', 'select', ['member', 'moderator', 'admin'], true], ['title', 'Committee title', 'select', R.titles],
    ];
    const errs = {};
    const form = h('form', { class: 'form', novalidate: true }, fields.map(([name, label, type, opts, req]) => {
      const input = type === 'select'
        ? h('select', { name, id: 'f-' + name }, req ? null : h('option', { value: '' }, '—'), opts.map((o) => h('option', { value: o }, o)))
        : h('input', { name, id: 'f-' + name, type, required: req });
      errs[name] = h('span', { class: 'err' });
      return h('div', { class: 'field' }, h('label', { for: 'f-' + name }, label), input, errs[name]);
    }), h('div', { class: 'full' }, h('button', { class: 'btn' }, 'Create verified account')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((e) => (e.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      data.status = 'verified';
      try {
        const m = await api('/members', { json: data });
        toast(`Created ${m.name}${m.role !== 'member' ? ' as ' + m.role : ''}`);
        form.reset();
      } catch (e) {
        if (e.fields) Object.entries(e.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; });
        toast(e.message);
      }
    });
    panel.replaceChildren(h('h2', {}, 'Add a member'),
      h('p', { class: 'muted small' }, 'Creates a verified account straight away. The person signs in with Google using the email entered here.'), form);
  }

  /* ---------- import & export ---------- */
  function viewImport() {
    const result = h('div', {});
    const readFile = (input) => new Promise((res, rej) => { const f = input.files[0]; if (!f) return rej(new Error('Choose a CSV file first')); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsText(f); });

    const batchFile = h('input', { type: 'file', accept: '.csv,text/csv' });
    const batchBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        const r = await api('/batch-list', { csv: await readFile(batchFile) });
        result.replaceChildren(h('p', { class: 'note ok' }, `Batch list: ${r.upserted} rows saved, ${r.skipped.length} skipped. Re-checked ${r.rematchedPending} pending registration(s).`),
          r.skipped.length ? h('ul', {}, r.skipped.slice(0, 50).map((s) => h('li', {}, `Row ${s.row}: ${s.reason}`))) : null);
      } catch (e) { result.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
    } }, 'Upload batch list');

    const memFile = h('input', { type: 'file', accept: '.csv,text/csv' });
    const run = (dry) => async () => {
      try {
        const s = await api(`/members/import?dryRun=${dry}&status=verified`, { csv: await readFile(memFile) });
        const bad = s.rows.filter((r) => r.result === 'invalid');
        result.replaceChildren(
          h('p', { class: 'note ' + (bad.length ? 'warn' : 'ok') }, `${dry ? 'Check only, nothing saved' : 'Imported'}: ${s.total} rows · ${dry ? s.wouldCreate + ' would be created' : s.created + ' created'} · ${s.alreadyRegistered} already registered · ${s.invalid} need fixing`),
          s.ignoredColumns.length ? h('p', { class: 'muted small' }, 'Ignored columns: ' + s.ignoredColumns.join(', ')) : null,
          bad.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'Name'), h('th', {}, 'What to fix'))),
            h('tbody', {}, bad.map((r) => h('tr', {}, h('td', {}, r.row), h('td', {}, r.name), h('td', {}, Object.entries(r.errors || {}).map(([k, v]) => `${k}: ${v}`).join('; '))))))) : null);
      } catch (e) { result.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
    };

    panel.replaceChildren(
      h('h2', {}, 'Institute batch list'),
      h('p', { class: 'muted small' }, 'CSV with columns roll_no, name, batch, branch, degree. Used only to check registrations; never shown to members.'),
      h('div', { class: 'toolbar' }, batchFile, batchBtn),
      h('h2', { style: 'margin-top:24px' }, 'Import members from a spreadsheet'),
      h('p', { class: 'muted small' }, 'CSV from Excel, Google Sheets or a Google Form export. Imported members are verified. Check first, then import.'),
      h('div', { class: 'toolbar' }, memFile, h('button', { class: 'btn ghost', type: 'button', onclick: run(true) }, 'Check file'), h('button', { class: 'btn', type: 'button', onclick: run(false) }, 'Import')),
      h('h2', { style: 'margin-top:24px' }, 'Export'),
      h('p', {}, h('a', { class: 'btn ghost', href: '/api/v1/admin/members.csv?status=verified' }, 'Download verified members (CSV)'), ' ',
        h('a', { class: 'btn ghost', href: '/api/v1/admin/members.csv' }, 'Download everyone (CSV)')),
      result);
  }

  /* ---------- events & payments ---------- */
  const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN');
  // datetime-local values are India time; the server reads them as +05:30.
  const toIstInput = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 16) : '');

  async function viewEvents() {
    const list = await api('/events');
    const formBox = h('div', {});
    const openForm = (e) => { formBox.replaceChildren(eventForm(e, () => { formBox.replaceChildren(); viewEvents(); })); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    panel.replaceChildren(
      h('div', { class: 'toolbar between' }, h('h2', {}, 'Events'), h('button', { class: 'btn small', type: 'button', onclick: () => openForm(null) }, 'New event')),
      formBox,
      list.length
        ? h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Event', 'When', 'Contribution', 'Going', 'Status', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, list.map((e) => h('tr', {},
            h('td', {}, h('b', {}, e.title), h('div', { class: 'muted small' }, e.venue)),
            h('td', {}, fmtDate(e.startsAt)),
            h('td', {}, e.feePaise ? `${rupees(e.feePaise)} per ${e.feeBasis}` : 'Free'),
            h('td', {}, `${e.people} people`, e.capacity ? h('div', { class: 'muted small' }, `${e.placesLeft} of ${e.capacity} left`) : null),
            h('td', {}, e.status === 'cancelled' ? h('span', { class: 'tag bad' }, 'Cancelled') : e.past ? h('span', { class: 'tag' }, 'Over') : h('span', { class: 'tag ok' }, 'Open')),
            h('td', {}, h('div', { class: 'actions-row' },
              h('button', { class: 'btn small', type: 'button', onclick: () => viewPayments(e) }, 'RSVPs & payments'),
              h('button', { class: 'btn ghost small', type: 'button', onclick: () => openForm(e) }, 'Edit'),
              e.status === 'cancelled'
                ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await api(`/events/${e.id}/restore`, { json: {} }); toast('Restored'); viewEvents(); } catch (err) { toast(err.message); } } }, 'Restore')
                : h('button', { class: 'btn danger small', type: 'button', onclick: async () => { if (!confirm(`Cancel "${e.title}"? Members will see it as cancelled.`)) return; try { await api(`/events/${e.id}/cancel`, { json: {} }); toast('Cancelled'); viewEvents(); } catch (err) { toast(err.message); } } }, 'Cancel event'))))))))
        : h('p', { class: 'muted' }, 'No events yet. Create the first one, for example the annual alumni meet.'));
  }

  function eventForm(e, done) {
    const fields = [
      ['title', 'Title', 'text', true, e?.title, 'full'],
      ['startsAt', 'Starts (India time)', 'datetime-local', true, toIstInput(e?.startsAt)],
      ['endsAt', 'Ends (optional)', 'datetime-local', false, toIstInput(e?.endsAt)],
      ['venue', 'Venue', 'text', true, e?.venue, 'full'],
      ['feeRupees', 'Contribution in ₹ (0 if free)', 'number', true, e ? String(e.feePaise / 100) : '0'],
      ['feeBasis', 'Contribution is per', 'select', true, e?.feeBasis || 'family'],
      ['capacity', 'Places (optional)', 'number', false, e?.capacity ? String(e.capacity) : ''],
      ['description', 'Details (optional)', 'textarea', false, e?.description || '', 'full'],
    ];
    const errs = {};
    const form = h('form', { class: 'form card', novalidate: true },
      h('h2', { class: 'full' }, e ? 'Edit event' : 'New event'),
      fields.map(([name, label, type, req, value, cls]) => {
        const id = 'ev-' + name;
        const input = type === 'select'
          ? h('select', { name, id }, [['family', 'Family'], ['person', 'Person (guests pay too)']].map(([v, l]) => h('option', { value: v, selected: v === value }, l)))
          : type === 'textarea'
            ? h('textarea', { name, id, rows: 4 }, value)
            : h('input', { name, id, type, required: req, value: value ?? '', min: type === 'number' ? '0' : null });
        errs[name] = h('span', { class: 'err' });
        return h('div', { class: 'field' + (cls ? ' ' + cls : '') }, h('label', { for: id }, label), input, errs[name]);
      }),
      h('div', { class: 'full actions-row' }, h('button', { class: 'btn' }, e ? 'Save changes' : 'Create event'), h('button', { class: 'btn ghost', type: 'button', onclick: () => done() }, 'Close')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((x) => (x.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      try {
        await api(e ? `/events/${e.id}` : '/events', { method: e ? 'PUT' : 'POST', json: data });
        toast(e ? 'Event saved' : 'Event created');
        done();
      } catch (err) {
        if (err.fields) Object.entries(err.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; });
        toast(err.message);
      }
    });
    return form;
  }

  async function viewPayments(e) {
    const r = await api(`/events/${e.id}/payments`);
    const owed = r.rows.filter((x) => x.paidPaise < x.duePaise);
    panel.replaceChildren(
      h('p', {}, h('button', { class: 'btn ghost small', type: 'button', onclick: () => viewEvents() }, '← All events')),
      h('h2', {}, r.event.title),
      h('p', { class: 'muted small' }, `${fmtDate(r.event.startsAt)} · ${r.event.venue}`),
      h('div', { class: 'stats' },
        h('div', { class: 'card stat' }, h('b', {}, r.rows.length), h('span', {}, 'RSVPs')),
        h('div', { class: 'card stat' }, h('b', {}, r.people), h('span', {}, 'People incl. guests')),
        h('div', { class: 'card stat' }, h('b', {}, rupees(r.collectedPaise)), h('span', {}, 'Collected')),
        h('div', { class: 'card stat' }, h('b', {}, rupees(r.expectedPaise - r.collectedPaise)), h('span', {}, `Still due (${owed.length})`))),
      r.rows.length
        ? h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Member', 'Mobile', 'Guests', 'Due', 'Paid', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.rows.map((x) => h('tr', {},
            h('td', {}, h('b', {}, x.name), h('div', { class: 'muted small' }, x.batch)),
            h('td', {}, x.phone),
            h('td', {}, x.guests),
            h('td', {}, rupees(x.duePaise)),
            h('td', {}, x.paidPaise >= x.duePaise && x.duePaise > 0
              ? [h('span', { class: 'tag ok' }, 'Paid'), h('div', { class: 'muted small' }, `${x.paidRecordedBy || ''} · ${fmtDate(x.paidAt)}`)]
              : x.duePaise === 0 ? h('span', { class: 'muted' }, '—') : rupees(x.paidPaise)),
            h('td', {}, x.paidPaise < x.duePaise
              ? h('button', { class: 'btn small', type: 'button', onclick: async (ev) => {
                if (!confirm(`Record ${rupees(x.duePaise - x.paidPaise)} received from ${x.name}?`)) return;
                ev.target.disabled = true;
                try { await api(`/events/${e.id}/payments/${x.memberId}`, { json: {} }); toast('Payment recorded'); viewPayments(e); }
                catch (err) { toast(err.message); ev.target.disabled = false; }
              } }, 'Mark paid')
              : null))))))
        : h('p', { class: 'muted' }, 'No RSVPs yet.'),
      h('p', { class: 'muted small' }, 'Use "Mark paid" for cash or UPI received at the venue or before. Each entry is saved in the activity log.'));
  }

  /* ---------- reported posts ---------- */
  async function viewReports() {
    const list = await api('/reports');
    if (!list.length) return panel.replaceChildren(h('h2', {}, 'Reported posts'), h('p', { class: 'muted' }, 'No open reports. When a member reports a post on Jobs & Help, it appears here.'));
    panel.replaceChildren(h('h2', {}, `Reported posts (${list.length})`),
      h('p', { class: 'muted small' }, 'Remove a post that breaks the rules (fees, agencies, misleading or inappropriate). Dismiss if it is fine; it stays on the board.'),
      h('div', { class: 'list' }, list.map((p) => {
        const act = (path, msg) => async (ev) => {
          ev.target.disabled = true;
          try { await api(`/posts/${p.postId}/${path}`, { json: {} }); toast(msg); viewReports(); }
          catch (err) { toast(err.message); ev.target.disabled = false; }
        };
        return h('article', { class: 'card' },
          h('p', {}, h('span', { class: 'tag ' + p.type }, p.type), ' ', h('span', { class: 'tag bad' }, `${p.count} report${p.count === 1 ? '' : 's'}`)),
          h('h2', { style: 'margin-top:8px' }, p.title),
          h('p', { class: 'muted small' }, `Posted by ${p.authorName}`),
          h('p', { class: 'body' }, p.body),
          h('p', { class: 'small' }, h('b', {}, 'Reasons: '), p.reasons.join(' · ')),
          h('div', { class: 'actions-row', style: 'margin-top:12px' },
            h('button', { class: 'btn danger small', type: 'button', onclick: async (ev) => { if (confirm('Remove this post from the board?')) await act('remove', 'Post removed')(ev); } }, 'Remove post'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: act('dismiss', 'Reports dismissed') }, 'Dismiss reports')));
      })));
  }

  /* ---------- activity ---------- */
  async function viewActivity() {
    const list = await api('/audit?limit=200');
    const LABELS = { 'member.registered': 'registered via the form', 'member.created': 'created a member', 'member.approved': 'approved', 'member.rejected': 'rejected', 'member.role_changed': 'changed a role', 'member.suspended': 'suspended', 'member.reinstated': 'reinstated', 'members.imported': 'imported members', 'batch_list.uploaded': 'uploaded the batch list', 'member.signed_in': 'signed in', 'event.created': 'created an event', 'event.updated': 'edited an event', 'event.cancelled': 'cancelled an event', 'event.restored': 'restored an event', 'event.payment_recorded': 'recorded a payment', 'post.removed': 'removed a post', 'post.reports_dismissed': 'dismissed reports', 'post.status_changed': 'changed a post' };
    panel.replaceChildren(h('h2', {}, 'Activity log'), h('p', { class: 'muted small' }, 'Every registration, decision and change. It cannot be edited.'),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), h('th', {}, 'Details'))),
        h('tbody', {}, list.map((a) => h('tr', {}, h('td', {}, fmtDate(a.createdAt)), h('td', {}, a.actor), h('td', {}, LABELS[a.action] || a.action),
          h('td', { class: 'muted small' }, a.detail ? Object.entries(a.detail).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ') : '')))))));
  }

  /* ---------- start ---------- */
  fetch('/api/v1/reference').then((r) => r.json()).then((r) => {
    reference = r;
    show(TABS.some(([k]) => k === tab) ? tab : 'pending');
  });
})();
