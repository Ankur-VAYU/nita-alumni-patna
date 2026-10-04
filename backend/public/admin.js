// Admin, laid out like the prototype: Overview, Verify, Reports, Events & payments, Batch list, Members,
// Content, Activity log. Talks to /api/v1/admin with the session cookie. Everything is built with DOM nodes,
// never innerHTML with data, so names and addresses cannot inject markup.
(function () {
  'use strict';
  const { h, toast, initials, fmtPhone } = window.NITA;
  const root = document.getElementById('admin');
  const ROLE = root.dataset.role;
  const IS_ADMIN = ROLE === 'admin';
  let reference = null;
  let meId = null;
  let counts = { pending: 0, reports: 0 };

  const IST = { timeZone: 'Asia/Kolkata' };
  const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { ...IST, dateStyle: 'medium', timeStyle: 'short' }) : '');
  const fmtShort = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN');
  // datetime-local values are India time; the server reads them as +05:30.
  const toIstInput = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 16) : '');
  const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);

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
  /** A button that runs an action, disables itself while it runs and shows the error if it fails. */
  const actionBtn = (label, cls, fn, confirmText) => {
    const b = h('button', { class: 'btn small ' + (cls || ''), type: 'button', onclick: async () => {
      if (confirmText && !confirm(confirmText)) return;
      b.disabled = true;
      try { await fn(); } catch (e) { toast(e.message); b.disabled = false; }
    } }, label);
    return b;
  };

  const matchTag = (m) =>
    m.batchMatch === 'full' ? h('span', { class: 'tag ok' }, 'Full match')
      : m.batchMatch === 'partial' ? h('span', { class: 'tag warn' }, 'Partial match')
        : h('span', { class: 'tag bad' }, 'Not in batch list');
  const statusTag = (s) => h('span', { class: 'tag ' + ({ verified: 'ok', pending: 'warn', rejected: 'bad', suspended: 'bad' }[s] || '') }, s);
  const avatar = (m, cls) => h('div', { class: 'avatar ' + (cls || '') }, m.hasPhoto ? h('img', { src: `/api/v1/admin/members/${m.id}/photo`, alt: '' }) : initials(m.name));
  const sectionHead = (title, ...extra) => h('div', { class: 'section-head' }, h('h2', {}, title), extra.length ? h('div', { class: 'row' }, extra) : null);
  const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

  /* ---------- layout ---------- */
  const TABS = [
    ['overview', 'Overview'],
    ['verify', 'Verify'],
    ['reports', 'Reports'],
    ...(IS_ADMIN ? [['events', 'Events & payments'], ['batch', 'Batch list']] : []),
    ['members', 'Members'],
    ['content', 'Content'],
    ['activity', 'Activity log'],
  ];
  const ALIASES = { pending: 'verify', news: 'content', add: 'members', import: 'members' };
  const hashTab = () => { const k = location.hash.replace('#', ''); return ALIASES[k] || k; };
  let tab = TABS.some(([k]) => k === hashTab()) ? hashTab() : 'overview';
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  // On phones the eight tabs do not fit, so a dropdown lists every section instead.
  const tabSelect = h('select', { class: 'tab-select', 'aria-label': 'Admin section', onchange: () => show(tabSelect.value) });
  const panel = h('div', { class: 'stack', style: 'gap:24px' });
  root.replaceChildren(h('div', { class: 'field tab-pick' }, h('label', {}, 'Section'), tabSelect), tabBar, panel);
  // On phones tables are shown as cards; each cell needs its column name as a label.
  new MutationObserver(() => {
    for (const table of panel.querySelectorAll('table')) {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
      for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => {
        if (td.dataset.label || !heads[i]) return;
        td.dataset.label = heads[i];
        // Keep a cell's lines together in the value column of the card.
        if (td.childNodes.length > 1) td.replaceChildren(h('div', {}, ...td.childNodes));
      });
    }
  }).observe(panel, { childList: true, subtree: true });
  root.className = 'stack';
  root.style.gap = '20px';

  function renderTabs() {
    tabBar.replaceChildren(...TABS.map(([k, label]) => {
      const n = k === 'verify' ? counts.pending : k === 'reports' ? counts.reports : 0;
      return h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => show(k) }, label, n ? h('span', { class: 'count' }, n) : null);
    }));
    tabSelect.replaceChildren(...TABS.map(([k, label]) => {
      const n = k === 'verify' ? counts.pending : k === 'reports' ? counts.reports : 0;
      return h('option', { value: k, selected: tab === k }, label + (n ? ` (${n})` : ''));
    }));
  }
  async function refreshCounts() {
    try {
      const [p, r] = await Promise.all([api('/members?status=pending&limit=200'), api('/reports')]);
      counts = { pending: p.length, reports: r.length }; renderTabs();
    } catch { /* counts are a convenience */ }
  }
  async function show(k) {
    tab = k; history.replaceState(null, '', '#' + k);
    renderTabs();
    panel.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      await { overview: viewOverview, verify: viewVerify, reports: viewReports, events: viewEvents, batch: viewBatch, members: viewMembers, content: viewContent, activity: viewActivity }[k]();
    } catch (e) {
      panel.replaceChildren(h('p', { class: 'note bad' }, e.message));
    }
  }
  window.addEventListener('hashchange', () => { const k = hashTab(); if (k !== tab && TABS.some(([t]) => t === k)) show(k); });

  /* ---------- overview ---------- */
  async function viewOverview() {
    const o = await api('/overview');
    const attention = [];
    if (o.pending) attention.push([`${o.pending} registration${o.pending === 1 ? '' : 's'} waiting`, 'verify']);
    if (o.reported) attention.push([`${o.reported} reported post${o.reported === 1 ? '' : 's'}`, 'reports']);
    if (IS_ADMIN && o.nextEvent && o.nextEvent.unpaidPaise) attention.push([`${rupees(o.nextEvent.unpaidPaise)} not yet paid for “${o.nextEvent.title}”`, 'events']);
    if (IS_ADMIN && o.deletionRequests) attention.push([`${o.deletionRequests} member${o.deletionRequests === 1 ? '' : 's'} asked for their account to be deleted`, 'members']);
    if (IS_ADMIN && o.admins < 2) attention.push([`Only ${o.admins === 1 ? 'one admin' : 'no admins with a member profile'}. Appoint a second admin so verification continues when the President is away`, 'members']);
    panel.replaceChildren(
      h('div', { class: 'stats' },
        h('div', { class: 'card stat' }, h('b', {}, o.verified), h('span', {}, 'verified members')),
        h('div', { class: 'card stat' }, h('b', {}, o.pending), h('span', {}, 'waiting for verification')),
        h('div', { class: 'card stat' }, h('b', {}, o.openPosts), h('span', {}, 'open board posts')),
        h('div', { class: 'card stat' }, h('b', {}, o.nextEvent ? o.nextEvent.people : 0), h('span', {}, 'coming to the next event'))),
      h('div', { class: 'grid2' },
        h('section', { class: 'section' }, h('h2', {}, 'Needs attention'),
          attention.length
            ? h('div', { class: 'card list' }, attention.map(([text, k]) => h('div', { class: 'item wide' }, h('span', {}, text), h('button', { class: 'linkbtn', type: 'button', onclick: () => show(k) }, 'Review'))))
            : h('div', { class: 'card empty' }, 'Nothing waiting. All caught up.')),
        h('section', { class: 'section' }, h('h2', {}, 'Profile freshness'),
          h('div', { class: 'card section', style: 'gap:10px' },
            h('p', {}, h('b', {}, o.staleProfiles.count), ` of ${o.verified} profiles not updated in 12 months.`),
            o.staleProfiles.names.length ? h('p', { class: 'muted' }, o.staleProfiles.names.join(', ') + (o.staleProfiles.count > o.staleProfiles.names.length ? ' and others' : '')) : null,
            h('p', { class: 'muted' }, `${o.closingSoon} board post${o.closingSoon === 1 ? '' : 's'} close in the next 7 days.`)))));
  }

  /* ---------- verify ---------- */
  const REASONS = ['Roll number not found in batch records', 'Proof document unclear or missing', 'Name does not match the proof', 'Duplicate registration', 'Not an NIT Agartala alumnus', 'Home district is not in Bihar'];

  async function viewVerify() {
    const list = await api('/members?status=pending&limit=200');
    counts.pending = list.length; renderTabs();
    panel.replaceChildren(
      h('p', { class: 'muted' }, 'Target: decide within 2 working days. Checks are ticked automatically from the batch list; tick the rest after looking at the proof. Approve unlocks once all checks are ticked.'),
      list.length ? h('div', { class: 'card list' }, list.map(reviewRow)) : h('div', { class: 'card empty' }, 'Nothing waiting. New registrations from the join form appear here.'));
  }

  function reviewRow(m) {
    const full = m.batchMatch === 'full';
    const checks = [
      'Roll number, batch, branch and degree match the batch list',
      'Name matches the batch list or the proof',
      'Proof is readable (not needed when the batch list fully matches)',
    ].map((label) => h('input', { type: 'checkbox', checked: full, 'aria-label': label }));
    const labels = ['Roll number, batch, branch and degree match the batch list', 'Name matches the batch list or the proof', 'Proof is readable (not needed when the batch list fully matches)'];
    const approve = actionBtn('Approve', '', async () => { await api(`/members/${m.id}/approve`, { json: {} }); toast(`${m.name} approved`); viewVerify(); });
    approve.classList.remove('small');
    const sync = () => { approve.disabled = !checks.every((c) => c.checked); };
    checks.forEach((c) => c.addEventListener('change', sync)); sync();
    const reason = h('select', { 'aria-label': 'Reason for rejecting' }, REASONS.map((r) => h('option', {}, r)));
    const rejectBox = h('div', { class: 'stack', style: 'gap:8px', hidden: true }, h('label', { class: 'lbl' }, 'Reason (shown to the applicant)'), reason,
      actionBtn('Confirm reject', 'danger', async () => { await api(`/members/${m.id}/reject`, { json: { reason: reason.value } }); toast(`${m.name} rejected`); viewVerify(); }));
    const waited = daysSince(m.createdAt);
    const wa = 'https://wa.me/' + m.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(`Namaste ${m.name.split(' ')[0]}, this is the NIT Agartala Alumni Patna Chapter about your registration. Could you share `);
    return h('div', { class: 'review' },
      h('div', { class: 'section', style: 'gap:10px' },
        h('div', { class: 'person-head' }, avatar(m), h('div', {}, h('h3', {}, m.name), h('div', { class: 'batch' }, `${m.rollNo || 'no roll number'} · ${m.degree} · ${m.batch}`))),
        kv([
          ['Branch', m.branch],
          ['Work', [[m.position, m.organisation].filter(Boolean).join(', '), m.workDistrict].filter(Boolean).join(' · ') || '—'],
          ['Home', `${m.homeDistrict}, Bihar`],
          ['Batch list', [matchTag(m), m.batchMatchNotes ? h('div', { class: 'muted' }, m.batchMatchNotes) : null]],
          ['Mobile', h('span', { class: 'phone' }, fmtPhone(m.phone))],
          ['Email', m.email || '—'],
          ['Proof', m.hasProof ? h('a', { href: `/api/v1/admin/members/${m.id}/proof`, target: '_blank', rel: 'noopener' }, h('b', {}, m.proofName || 'Open document')) : 'Not uploaded'],
          ['Vouched by', m.vouchedBy || 'No one'],
          ['Waiting', waited >= 2 ? h('span', { class: 'tag warn' }, `${waited} days`) : `${waited} day${waited === 1 ? '' : 's'}`],
        ])),
      h('div', { class: 'review-side' },
        h('div', { class: 'checklist' }, checks.map((c, i) => h('label', { class: 'check' }, c, labels[i]))),
        h('div', { class: 'actions' }, approve,
          h('a', { class: 'btn ghost', href: wa, target: '_blank', rel: 'noopener' }, 'Ask for info'),
          h('button', { class: 'btn danger', type: 'button', onclick: () => (rejectBox.hidden = !rejectBox.hidden) }, 'Reject')),
        rejectBox));
  }

  /* ---------- reports ---------- */
  async function viewReports() {
    const list = await api('/reports');
    counts.reports = list.length; renderTabs();
    panel.replaceChildren(
      h('p', { class: 'muted' }, 'Remove a post that breaks the rules (fees, agencies, misleading or inappropriate). Dismiss the reports if it is fine; it stays on the board.'),
      list.length ? h('div', { class: 'card list' }, list.map((p) => h('div', { class: 'review' },
        h('div', { class: 'section', style: 'gap:8px' },
          h('div', { class: 'post-head' }, h('span', { class: 'tag ' + p.type }, p.type), h('h3', {}, p.title)),
          h('p', { class: 'muted' }, `Posted by ${p.authorName}`),
          h('p', { class: 'body', style: 'white-space:pre-line' }, p.body)),
        h('div', { class: 'review-side' },
          h('p', {}, h('span', { class: 'tag bad' }, `${p.count} report${p.count === 1 ? '' : 's'}`)),
          h('p', { class: 'muted' }, p.reasons.join(' · ')),
          h('div', { class: 'actions' },
            actionBtn('Remove post', 'danger', async () => { await api(`/posts/${p.postId}/remove`, { json: {} }); toast('Post removed'); viewReports(); }, 'Remove this post from the board?'),
            actionBtn('Dismiss reports', 'ghost', async () => { await api(`/posts/${p.postId}/dismiss`, { json: {} }); toast('Reports dismissed'); viewReports(); }))))))
        : h('div', { class: 'card empty' }, 'No open reports. When a member reports a post on Jobs & Help, it appears here.'));
  }

  /* ---------- events & payments ---------- */
  async function viewEvents(openNew) {
    const list = await api('/events');
    const formBox = h('div', {});
    const openForm = (e) => { formBox.replaceChildren(eventForm(e, () => { formBox.replaceChildren(); viewEvents(); })); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    panel.replaceChildren(
      h('section', { class: 'section' },
        sectionHead('Events', h('button', { class: 'btn', type: 'button', onclick: () => openForm(null) }, 'Add event')),
        formBox,
        list.length
          ? h('div', { class: 'card tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Event', 'When', 'Contribution', 'Going', 'Status', ''].map((t) => h('th', {}, t)))),
            h('tbody', {}, list.map((e) => h('tr', {},
              h('td', {}, h('b', {}, e.title), h('div', { class: 'muted' }, e.venue)),
              h('td', {}, fmtDate(e.startsAt)),
              h('td', {}, e.feePaise ? `${rupees(e.feePaise)} per ${e.feeBasis}` : 'Free'),
              h('td', {}, `${e.people} people`, e.capacity ? h('div', { class: 'muted' }, `${e.placesLeft} of ${e.capacity} left`) : null),
              h('td', {}, e.status === 'cancelled' ? h('span', { class: 'tag bad' }, 'Cancelled') : e.past ? h('span', { class: 'tag' }, 'Over') : h('span', { class: 'tag ok' }, 'Open')),
              h('td', {}, h('div', { class: 'actions' },
                h('button', { class: 'btn small', type: 'button', onclick: () => viewPayments(e) }, 'RSVPs & payments'),
                h('button', { class: 'btn ghost small', type: 'button', onclick: () => openForm(e) }, 'Edit'),
                e.status === 'cancelled'
                  ? actionBtn('Restore', 'ghost', async () => { await api(`/events/${e.id}/restore`, { json: {} }); toast('Restored'); viewEvents(); })
                  : actionBtn('Cancel event', 'danger', async () => { await api(`/events/${e.id}/cancel`, { json: {} }); toast('Cancelled'); viewEvents(); }, `Cancel "${e.title}"? Members will see it as cancelled.`))))))))
          : h('div', { class: 'card empty' }, 'No events yet. Add the first one, for example the annual alumni meet.')));
    if (openNew === true) openForm(null);
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
      h('h2', {}, e ? 'Edit event' : 'Add event'),
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
      h('div', { class: 'form-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => done() }, 'Close'), h('button', { class: 'btn' }, e ? 'Save changes' : 'Publish event')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((x) => (x.textContent = ''));
      try {
        await api(e ? `/events/${e.id}` : '/events', { method: e ? 'PUT' : 'POST', json: Object.fromEntries(new FormData(form)) });
        toast(e ? 'Event saved' : 'Event published');
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
      h('div', {}, h('h2', {}, r.event.title), h('p', { class: 'muted' }, `${fmtDate(r.event.startsAt)} · ${r.event.venue}`)),
      h('div', { class: 'stats' },
        h('div', { class: 'card stat' }, h('b', {}, r.rows.length), h('span', {}, 'RSVPs')),
        h('div', { class: 'card stat' }, h('b', {}, r.people), h('span', {}, 'people incl. guests')),
        h('div', { class: 'card stat' }, h('b', {}, rupees(r.collectedPaise)), h('span', {}, 'collected')),
        h('div', { class: 'card stat' }, h('b', {}, rupees(r.expectedPaise - r.collectedPaise)), h('span', {}, `still due (${owed.length})`))),
      r.rows.length
        ? h('div', { class: 'card tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Member', 'Mobile', 'Guests', 'Due', 'Paid', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.rows.map((x) => h('tr', {},
            h('td', {}, h('b', {}, x.name), h('div', { class: 'muted' }, x.batch)),
            h('td', { class: 'phone' }, fmtPhone(x.phone)),
            h('td', {}, x.guests),
            h('td', {}, rupees(x.duePaise)),
            h('td', {}, x.paidPaise >= x.duePaise && x.duePaise > 0
              ? [h('span', { class: 'tag ok' }, 'Paid'), h('div', { class: 'muted' }, `${x.paidRecordedBy || ''} · ${fmtDate(x.paidAt)}`)]
              : x.duePaise === 0 ? h('span', { class: 'muted' }, '—') : rupees(x.paidPaise)),
            h('td', {}, x.paidPaise < x.duePaise
              ? actionBtn('Mark paid', '', async () => { await api(`/events/${e.id}/payments/${x.memberId}`, { json: {} }); toast('Payment recorded'); viewPayments(e); }, `Record ${rupees(x.duePaise - x.paidPaise)} received from ${x.name}?`)
              : null))))))
        : h('div', { class: 'card empty' }, 'No RSVPs yet.'),
      h('p', { class: 'hint' }, 'Use "Mark paid" for cash or UPI received at the venue or before. Each entry is saved in the activity log.'));
  }

  /* ---------- batch list ---------- */
  const readFile = (input) => new Promise((res, rej) => { const f = input.files[0]; if (!f) return rej(new Error('Choose a CSV file first')); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsText(f); });

  async function viewBatch() {
    const info = await api('/batch-list');
    const result = h('div', {});
    const file = h('input', { type: 'file', id: 'batch-file', accept: '.csv,text/csv' });
    const upload = actionBtn('Upload batch list', '', async () => {
      const r = await api('/batch-list', { csv: await readFile(file) });
      toast(`${r.upserted} rows saved`);
      await viewBatch();
      panel.prepend(h('div', { class: 'stack', style: 'gap:6px' },
        h('p', { class: 'note ok' }, `Batch list: ${r.upserted} rows saved, ${r.skipped.length} skipped. Re-checked ${r.rematchedPending} pending registration(s).`),
        r.skipped.length ? h('ul', { class: 'muted' }, r.skipped.slice(0, 50).map((s) => h('li', {}, `Row ${s.row}: ${s.reason}`))) : null));
    });
    upload.classList.remove('small');
    const rows = h('tbody', {});
    const fill = (list) => rows.replaceChildren(...(list.length ? list.map((r) => h('tr', {}, h('td', { class: 'mono' }, r.rollNo), h('td', {}, r.name), h('td', {}, r.batch), h('td', {}, `${r.branch} · ${r.degree}`)))
      : [h('tr', {}, h('td', { colspan: 4, class: 'muted' }, info.count ? 'No match.' : 'The batch list is empty. Upload it on the left.'))]));
    fill(info.rows);
    let t;
    const q = h('input', { id: 'batch-q', type: 'search', placeholder: 'e.g. 19PCS011 or Gaurav', oninput: () => { clearTimeout(t); t = setTimeout(async () => { try { fill((await api('/batch-list?q=' + encodeURIComponent(q.value.trim()))).rows); } catch (e) { toast(e.message); } }, 300); } });
    panel.replaceChildren(
      h('div', { class: 'stats' },
        h('div', { class: 'card stat' }, h('b', {}, info.count), h('span', {}, 'graduates in the list')),
        h('div', { class: 'card stat' }, h('b', {}, info.minBatch ? `${info.minBatch}–${info.maxBatch}` : '—'), h('span', {}, 'batches covered')),
        h('div', { class: 'card stat' }, h('b', {}, info.lastUploadedAt ? new Date(info.lastUploadedAt).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' }) : '—'), h('span', {}, 'last uploaded')),
        h('div', { class: 'card stat' }, h('b', {}, info.lastUploadedBy ? info.lastUploadedBy.replace(/^(member|admin):/, '').split(' ')[0] : '—'), h('span', {}, 'uploaded by'))),
      h('div', { class: 'grid2' },
        h('section', { class: 'section' }, h('h2', {}, 'Upload the batch list'),
          h('div', { class: 'card section' },
            h('p', {}, 'Upload a CSV file with one graduate per row. Rows with a roll number already in the list are updated; new roll numbers are added.'),
            h('pre', { class: 'code' }, 'roll_no,name,batch,branch,degree\n08UCE021,Rohit Kumar,2012,Civil Engineering,B.Tech'),
            h('div', { class: 'field' }, h('label', { for: 'batch-file' }, 'CSV file'), file),
            h('div', {}, upload),
            h('p', { class: 'hint' }, 'The list is used only to check registrations. It is never shown to members.'), result)),
        h('section', { class: 'section' }, h('h2', {}, 'Look up a graduate'),
          h('div', { class: 'field' }, h('label', { for: 'batch-q' }, 'Roll number or name'), q),
          h('div', { class: 'card tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Roll', 'Name', 'Batch', 'Branch'].map((x) => h('th', {}, x)))), rows)))));
  }

  /* ---------- members ---------- */
  async function viewMembers() {
    const q = h('input', { id: 'm-q', type: 'search', placeholder: 'Name, roll number, mobile or company' });
    const status = h('select', { id: 'm-status', style: 'width:auto' }, [['verified', 'Verified'], ['', 'Everyone'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([v, l]) => h('option', { value: v }, l)));
    const out = h('div', {});
    const tools = h('div', {});
    const load = async () => {
      const qs = new URLSearchParams({ limit: '300' });
      if (q.value.trim()) qs.set('q', q.value.trim());
      if (status.value) qs.set('status', status.value);
      const list = await api('/members?' + qs);
      out.replaceChildren(list.length ? h('div', { class: 'card list' }, list.map((m) => memberRow(m, load))) : h('div', { class: 'card empty' }, 'No members match.'));
    };
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    status.addEventListener('change', load);
    const openTool = (fn) => { tools.replaceChildren(fn(() => { tools.replaceChildren(); load(); })); tools.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    panel.replaceChildren(
      h('div', { class: 'toolbar' },
        h('div', { class: 'field grow' }, h('label', { for: 'm-q' }, 'Find a member'), q),
        h('div', { class: 'field' }, h('label', { for: 'm-status' }, 'Status'), status),
        IS_ADMIN ? h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => openTool(addMemberForm) }, 'Add member'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openTool(importBox) }, 'Import & export')) : null),
      tools, out,
      IS_ADMIN ? h('p', { class: 'hint' }, 'Keep at least two admins so verification continues when one is away.') : '');
    await load();
  }

  function memberRow(m, reload) {
    const isMe = m.id === meId;
    const setRole = (role, title) => async () => { await api(`/members/${m.id}/role`, { json: { role, title: title === undefined ? m.title : title } }); toast('Saved'); reload(); };
    const actions = h('div', { class: 'actions' });
    if (isMe) actions.append(h('span', { class: 'muted' }, 'This is you'));
    else if (IS_ADMIN && m.status === 'verified') {
      if (m.role !== 'member') {
        const title = h('select', { class: 'title-sel', 'aria-label': 'Committee title for ' + m.name, onchange: async () => { try { await setRole(m.role, title.value || null)(); } catch (e) { toast(e.message); } } },
          ['', ...(reference ? reference.titles : [])].map((t) => h('option', { value: t, selected: (m.title || '') === t }, t || 'No title')));
        actions.append(title);
      }
      if (m.role !== 'moderator') actions.append(actionBtn('Make moderator', 'ghost', setRole('moderator')));
      if (m.role !== 'admin') actions.append(actionBtn('Make admin', 'ghost', setRole('admin'), `Make ${m.name} an admin? Admins can change everything, including roles.`));
      if (m.role !== 'member') actions.append(actionBtn(`Remove ${m.role} role`, 'ghost', setRole('member', null)));
      if (m.deletionRequestedAt) actions.append(deleteBtn(m, reload));
      actions.append(actionBtn('Suspend', 'danger', async () => { await api(`/members/${m.id}/suspend`, { json: {} }); toast('Suspended'); reload(); }, `Suspend ${m.name}? They will not be able to sign in.`));
    } else if (IS_ADMIN && m.status === 'suspended') {
      if (m.deletionRequestedAt) actions.append(deleteBtn(m, reload));
      actions.append(actionBtn('Reinstate', 'ghost', async () => { await api(`/members/${m.id}/reinstate`, { json: {} }); toast('Reinstated'); reload(); }));
    }
    return h('div', { class: 'item member-row' }, avatar(m, 'sm'),
      h('div', {},
        h('div', { class: 'row', style: 'gap:6px' }, h('b', {}, m.name), statusTag(m.status),
          m.deletionRequestedAt ? h('span', { class: 'tag bad' }, 'Deletion requested') : null,
          m.title ? h('span', { class: 'tag info' }, m.title) : m.role !== 'member' ? h('span', { class: 'tag info' }, m.role) : null),
        h('div', { class: 'batch' }, [m.rollNo || 'no roll no.', m.batch, fmtPhone(m.phone)].join(' · ')),
        !m.email ? h('div', { class: 'err' }, 'No email: cannot sign in') : null,
        m.deletionRequestedAt ? h('div', { class: 'muted' }, `Asked on ${fmtShort(m.deletionRequestedAt)}${m.deletionNote ? `: “${m.deletionNote}”` : ''}`) : null),
      actions);
  }

  /** Permanent deletion, offered when the member asked for it. */
  const deleteBtn = (m, reload) => actionBtn('Delete permanently', 'danger', async () => {
    await api(`/members/${m.id}`, { method: 'DELETE' }); toast(`${m.name}'s account was deleted`); reload();
  }, `Delete ${m.name}'s account permanently? Their profile, photo, RSVPs and board posts are removed. This cannot be undone.`);

  function addMemberForm(done) {
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
    const form = h('form', { class: 'form card', novalidate: true }, h('h2', {}, 'Add a member'),
      h('p', { class: 'hint full' }, 'Creates a verified account straight away. The person signs in with Google using the email entered here.'),
      fields.map(([name, label, type, opts, req]) => {
        const input = type === 'select'
          ? h('select', { name, id: 'f-' + name }, req ? null : h('option', { value: '' }, '—'), opts.map((o) => h('option', { value: o }, o)))
          : h('input', { name, id: 'f-' + name, type, required: req });
        errs[name] = h('span', { class: 'err' });
        return h('div', { class: 'field' }, h('label', { for: 'f-' + name }, label), input, errs[name]);
      }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => done() }, 'Close'), h('button', { class: 'btn' }, 'Create verified account')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((e) => (e.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      data.status = 'verified';
      try {
        const m = await api('/members', { json: data });
        toast(`Created ${m.name}${m.role !== 'member' ? ' as ' + m.role : ''}`);
        done();
      } catch (e) {
        if (e.fields) Object.entries(e.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; });
        toast(e.message);
      }
    });
    return form;
  }

  function importBox(done) {
    const result = h('div', {});
    const memFile = h('input', { type: 'file', id: 'imp-file', accept: '.csv,text/csv' });
    const run = (dry) => async () => {
      try {
        const s = await api(`/members/import?dryRun=${dry}&status=verified`, { csv: await readFile(memFile) });
        const bad = s.rows.filter((r) => r.result === 'invalid');
        result.replaceChildren(
          h('p', { class: 'note ' + (bad.length ? 'warn' : 'ok') }, `${dry ? 'Check only, nothing saved' : 'Imported'}: ${s.total} rows · ${dry ? s.wouldCreate + ' would be created' : s.created + ' created'} · ${s.alreadyRegistered} already registered · ${s.invalid} need fixing`),
          s.ignoredColumns.length ? h('p', { class: 'hint' }, 'Ignored columns: ' + s.ignoredColumns.join(', ')) : '',
          bad.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'Name'), h('th', {}, 'What to fix'))),
            h('tbody', {}, bad.map((r) => h('tr', {}, h('td', {}, r.row), h('td', {}, r.name), h('td', {}, Object.entries(r.errors || {}).map(([k, v]) => `${k}: ${v}`).join('; '))))))) : '');
      } catch (e) { result.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
    };
    return h('div', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Import members from a spreadsheet'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => done() }, 'Close')),
      h('p', { class: 'hint' }, 'CSV from Excel, Google Sheets or a Google Form export. Imported members are verified. Check first, then import.'),
      h('div', { class: 'field' }, h('label', { for: 'imp-file' }, 'CSV file'), memFile),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: run(true) }, 'Check file'), h('button', { class: 'btn', type: 'button', onclick: run(false) }, 'Import')),
      result,
      h('h2', { style: 'margin-top:8px' }, 'Export'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn ghost', href: '/api/v1/admin/members.csv?status=verified' }, 'Download verified members (CSV)'),
        h('a', { class: 'btn ghost', href: '/api/v1/admin/members.csv' }, 'Download everyone (CSV)')));
  }

  /* ---------- content ---------- */
  const UPDATE_TAGS = ['Admission', 'Notice', 'Result', 'Tender', 'Event', 'News'];

  /** The automatic nita.ac.in check: when it last worked, what it found, and a "Check now" button. */
  function nitaStatusCard(st) {
    const when = (iso) => (iso ? fmtDate(iso) : 'never');
    const found = st.counts && Object.keys(st.counts).length ? `${st.counts.notice || 0} notices, ${st.counts.news || 0} news, ${st.counts.event || 0} events` : 'nothing yet';
    const btn = actionBtn('Check now', 'ghost', async () => {
      const r = await api('/nita/refresh', { json: {} });
      toast(r.lastError ? 'Check failed: ' + r.lastError : 'Updated from nita.ac.in');
      viewContent();
    });
    return h('div', { class: 'card section', style: 'gap:8px' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Automatic headlines from nita.ac.in'), btn),
      h('p', { class: 'muted' }, 'The latest 2 from the Notice Board, Latest News and Upcoming Events are read every 6 hours and shown on Home and the welcome page.'),
      kv([['Last successful check', when(st.lastSuccessAt)], ['Last attempt', when(st.lastAttemptAt)], ['Found', found]]),
      st.lastError ? h('p', { class: 'note warn' }, `The last check did not work: ${st.lastError}. The previous headlines are still shown. Updates added below still appear.`) : null);
  }

  async function viewContent() {
    const [list, nita] = await Promise.all([api('/news'), api('/nita')]);
    const formBox = h('div', {});
    const openForm = (kind, n) => { formBox.replaceChildren(newsForm(kind, n, () => { formBox.replaceChildren(); viewContent(); })); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const save = (n, changes) => api(`/news/${n.id}`, { method: 'PUT', json: { kind: n.kind, tag: n.tag || '', title: n.title, body: n.body || '', link: n.link || '', pinned: n.pinned, publishedOn: n.publishedOn, ...changes } });
    const del = (n) => actionBtn('Delete', 'danger', async () => { await api(`/news/${n.id}`, { method: 'DELETE' }); toast('Deleted'); viewContent(); }, `Delete "${n.title}"?`);
    const chapter = list.filter((n) => n.kind === 'chapter'), institute = list.filter((n) => n.kind === 'institute');
    panel.replaceChildren(
      nitaStatusCard(nita),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => openForm('chapter') }, 'Post announcement'),
        IS_ADMIN ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { show('events').then(() => viewEvents(true)); } }, 'Add event') : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => openForm('institute') }, 'Add NIT Agartala update')),
      formBox,
      h('section', { class: 'section' }, h('h2', {}, 'Announcements'),
        chapter.length ? h('div', { class: 'card list' }, chapter.map((n) => h('div', { class: 'item wide' },
          h('div', {}, h('b', {}, n.title), n.pinned ? h('span', { class: 'pin' }, '  PINNED') : null, h('div', { class: 'muted' }, `${fmtDay(n.publishedOn)} · ${n.createdByLabel.replace(/^(member|admin):/, '')}`)),
          h('div', { class: 'actions' },
            actionBtn(n.pinned ? 'Unpin' : 'Pin', 'ghost', async () => { await save(n, { pinned: !n.pinned }); toast(n.pinned ? 'Unpinned' : 'Pinned'); viewContent(); }),
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => openForm('chapter', n) }, 'Edit'), del(n)))))
          : h('div', { class: 'card empty' }, 'No announcements yet. Pinned announcements appear at the top of every member\'s home page.')),
      h('section', { class: 'section' }, h('h2', {}, 'NIT Agartala updates added by hand'),
        institute.length ? h('div', { class: 'card list' }, institute.map((n) => h('div', { class: 'item wide' },
          h('div', {}, n.tag ? [h('span', { class: 'tag' }, n.tag), ' '] : null, h('b', {}, n.title), h('div', { class: 'muted' }, fmtDay(n.publishedOn), n.link ? [' · ', h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, 'link ↗')] : null)),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => openForm('institute', n) }, 'Edit'), del(n)))))
          : h('div', { class: 'card empty' }, 'No updates yet. Copy headlines from the notices on nita.ac.in and paste the link.')));
  }

  function newsForm(kind, n, done) {
    const errs = {};
    const field = (name, label, input, full) => { errs[name] = h('span', { class: 'err' }); return h('div', { class: 'field' + (full ? ' full' : '') }, h('label', { for: 'nw-' + name }, label), input, errs[name]); };
    const isUpdate = kind === 'institute';
    const pinned = h('input', { type: 'checkbox', checked: n ? n.pinned : false });
    const form = h('form', { class: 'form card', novalidate: true },
      h('h2', {}, n ? 'Edit' : isUpdate ? 'Add NIT Agartala update' : 'Post announcement'),
      isUpdate ? h('p', { class: 'hint full' }, 'Copy the headline from the notice on nita.ac.in and paste its link. A one-line summary is optional.') : null,
      field('title', 'Headline', h('input', { id: 'nw-title', name: 'title', maxlength: 160, value: n ? n.title : '' }), true),
      isUpdate ? field('tag', 'Label', h('select', { id: 'nw-tag', name: 'tag' }, h('option', { value: '' }, '—'), UPDATE_TAGS.map((t) => h('option', { value: t, selected: n && n.tag === t }, t)))) : null,
      field('publishedOn', 'Date', h('input', { id: 'nw-publishedOn', name: 'publishedOn', type: 'date', value: n ? n.publishedOn : '' })),
      field('body', isUpdate ? 'Summary (optional)' : 'Announcement', h('textarea', { id: 'nw-body', name: 'body', rows: isUpdate ? 2 : 5, maxlength: 4000 }, n ? n.body || '' : ''), true),
      field('link', isUpdate ? 'Link to the notice' : 'Link (optional)', h('input', { id: 'nw-link', name: 'link', type: 'url', placeholder: isUpdate ? 'https://www.nita.ac.in/…' : 'https://', value: n ? n.link || '' : '' }), true),
      isUpdate ? null : h('label', { class: 'check full' }, pinned, ' Pin to the top of everyone\'s home page'),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => done() }, 'Close'), h('button', { class: 'btn' }, n ? 'Save changes' : 'Publish')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((x) => (x.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      data.kind = kind;
      data.pinned = isUpdate ? false : pinned.checked;
      try {
        await api(n ? `/news/${n.id}` : '/news', { method: n ? 'PUT' : 'POST', json: data });
        toast(n ? 'Saved' : 'Published');
        done();
      } catch (e) {
        if (e.fields) Object.entries(e.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; });
        toast(e.message);
      }
    });
    return form;
  }

  /* ---------- activity ---------- */
  async function viewActivity() {
    const list = await api('/audit?limit=200');
    const LABELS = {
      'member.registered': 'registered via the form', 'member.created': 'created a member', 'member.approved': 'approved', 'member.rejected': 'rejected',
      'member.role_changed': 'changed a role', 'member.suspended': 'suspended', 'member.reinstated': 'reinstated', 'members.imported': 'imported members',
      'batch_list.uploaded': 'uploaded the batch list', 'member.signed_in': 'signed in', 'event.created': 'created an event', 'event.updated': 'edited an event',
      'event.cancelled': 'cancelled an event', 'event.restored': 'restored an event', 'event.payment_recorded': 'recorded a payment', 'post.removed': 'removed a post',
      'post.reports_dismissed': 'dismissed reports', 'post.status_changed': 'changed a post', 'news.created': 'posted news', 'news.updated': 'edited news', 'news.deleted': 'deleted news', 'member.resubmitted': 'submitted again after a rejection', 'member.deletion_requested': 'asked for account deletion', 'member.deletion_withdrawn': 'withdrew the deletion request', 'member.deleted': 'deleted an account',
    };
    const who = (a) => a.replace(/^(member|admin):/, '').replace(/^admin-(key|api)$/, 'Admin key');
    panel.replaceChildren(
      h('p', { class: 'muted' }, 'Every registration, decision and change. It cannot be edited.'),
      list.length ? h('div', { class: 'card list log' }, list.map((a) => h('div', { class: 'item' },
        h('time', {}, fmtShort(a.createdAt)),
        h('div', {}, h('b', {}, who(a.actor)), ' ', LABELS[a.action] || a.action,
          a.detail ? h('div', { class: 'muted' }, Object.entries(a.detail).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ')) : null))))
        : h('div', { class: 'card empty' }, 'Nothing yet.'));
  }

  /* ---------- start ---------- */
  Promise.all([fetch('/api/v1/reference').then((r) => r.json()), fetch('/api/v1/me', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}))]).then(([r, me]) => {
    reference = r;
    meId = me.id || null;
    renderTabs();
    refreshCounts();
    show(tab);
  });
})();
