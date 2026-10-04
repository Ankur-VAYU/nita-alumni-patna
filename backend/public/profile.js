// My profile: the editable form, laid out like the prototype. Identity fields (name, email, roll number,
// degree, batch, branch) are checked at verification, so they are shown but only an admin can change them.
(function () {
  'use strict';
  const { h, api, toast, initials } = window.NITA;
  const root = document.getElementById('profile-edit');
  let photoData = null;
  let removePhoto = false;

  async function resizePhoto(file) {
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image could not be opened')); i.src = url; });
    const size = 512, s = Math.min(img.width, img.height);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85);
  }

  Promise.all([api('/api/v1/me/profile'), fetch('/api/v1/reference').then((r) => r.json())]).then(([m, ref]) => {
    const errs = {};
    const field = (name, label, input, opts = {}) => {
      errs[name] = h('span', { class: 'err' });
      return h('div', { class: 'field' + (opts.full ? ' full' : '') }, h('label', { for: 'p-' + name }, label), input, opts.hint ? h('span', { class: 'hint' }, opts.hint) : null, errs[name]);
    };
    const text = (name, value, type = 'text') => h('input', { id: 'p-' + name, name, type, value: value || '' });
    const locked = (name, value) => h('input', { id: 'p-' + name, value: value == null ? '' : String(value), readonly: true, title: 'Checked at verification. Ask a chapter admin to correct it.' });
    const sel = (name, list, value, blank) => h('select', { id: 'p-' + name, name }, blank ? h('option', { value: '' }, blank) : null,
      list.map((v) => Array.isArray(v) ? h('option', { value: v[0], selected: v[0] === value }, v[1]) : h('option', { value: v, selected: v === value }, v)));
    const vis = [['members', 'All verified alumni'], ['batch', 'Only my batchmates'], ['admins', 'Only chapter admins']];
    const legend = (t) => h('div', { class: 'legend' }, t);

    const avatar = h('div', { class: 'avatar lg' }, m.hasPhoto ? h('img', { src: `/api/v1/members/${m.id}/photo`, alt: '' }) : initials(m.name));
    const photoInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: 'p-photo', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { photoData = await resizePhoto(f); removePhoto = false; avatar.replaceChildren(h('img', { src: photoData, alt: '' })); }
      catch (err) { toast(err.message); }
    } });
    const removeBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { photoData = null; removePhoto = true; avatar.replaceChildren(initials(m.name)); } }, 'Remove photo');
    const mentor = h('input', { type: 'checkbox', id: 'p-mentor', checked: m.openToMentor });

    const form = h('form', { class: 'form', novalidate: true },
      h('div', { class: 'full photo-row' }, avatar,
        h('div', { class: 'field' }, h('label', { for: 'p-photo' }, 'Photo'), photoInput, h('span', { class: 'hint' }, 'A clear face photo helps batchmates recognise you.'), m.hasPhoto ? h('div', {}, removeBtn) : null, errs.photo = h('span', { class: 'err' }))),
      legend('About you'),
      field('name', 'Full name (as on degree)', locked('name', m.name), { full: true }),
      field('phone', 'Mobile number', text('phone', m.phone, 'tel')),
      field('email', 'Email (used to sign in with Google)', locked('email', m.email)),
      legend('At NIT Agartala'),
      field('rollNo', 'Roll number', locked('rollNo', m.rollNo || '—')),
      field('degree', 'Degree', locked('degree', m.degree)),
      field('batch', 'Batch (passing year)', locked('batch', m.batch)),
      field('branch', 'Branch / department', locked('branch', m.branch)),
      legend('Work'),
      field('position', 'Current position', text('position', m.position)),
      field('organisation', 'Current organisation', text('organisation', m.organisation)),
      field('workDistrict', 'Work city / district', text('workDistrict', m.workDistrict)),
      field('workState', 'Working state (or outside India)', sel('workState', ref.workStates, m.workState, 'Select')),
      legend('Home in Bihar'),
      field('homeDistrict', 'Home district', sel('homeDistrict', ref.homeDistricts, m.homeDistrict)),
      field('homeState', 'Home state', locked('homeState', 'Bihar')),
      h('p', { class: 'hint full' }, 'The Patna chapter is for NIT Agartala alumni whose home is in Bihar, wherever they work now.'),
      legend('Help fellow alumni find you'),
      field('linkedin', 'LinkedIn profile URL (optional)', text('linkedin', m.linkedin, 'url')),
      field('skills', 'Skills or expertise (optional)', text('skills', m.skills)),
      h('label', { class: 'check full' }, mentor, ' I am open to mentoring students and junior alumni'),
      legend('Privacy'),
      field('phoneVisibility', 'Who can see my phone number', sel('phoneVisibility', vis, m.phoneVisibility)),
      field('emailVisibility', 'Who can see my email', sel('emailVisibility', vis, m.emailVisibility)),
      h('p', { class: 'hint full' }, 'Your name, photo, batch, branch, position, organisation and districts are visible to all verified alumni. Visitors who are not signed in see nothing. Name, email, roll number, degree, batch and branch were checked at verification; ask a chapter admin to correct them.'),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn' }, 'Save profile')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((e) => (e.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      delete data.photo;
      data.openToMentor = mentor.checked;
      if (photoData) data.photo = photoData;
      if (removePhoto) data.removePhoto = true;
      try { await api('/api/v1/me/profile', { method: 'PUT', json: data }); toast('Profile saved'); setTimeout(() => location.reload(), 700); }
      catch (e) { if (e.fields) Object.entries(e.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; }); toast(e.message); }
    });

    root.replaceChildren(form);
  }).catch((e) => root.replaceChildren(h('p', { class: 'note bad' }, e.message)));
})();

// Account deletion: ask (with an optional reason), or withdraw the request.
(function () {
  'use strict';
  const { api, toast } = window.NITA;
  const $ = (id) => document.getElementById(id);
  if ($('askDeletion')) {
    $('askDeletion').addEventListener('click', () => { $('deletionForm').hidden = false; $('askDeletion').hidden = true; $('deletionNote').focus(); });
    $('closeDeletion').addEventListener('click', () => { $('deletionForm').hidden = true; $('askDeletion').hidden = false; });
    $('confirmDeletion').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await api('/api/v1/me/deletion-request', { json: { note: $('deletionNote').value } }); location.reload(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    });
  }
  if ($('cancelDeletion')) {
    $('cancelDeletion').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await api('/api/v1/me/deletion-request', { method: 'DELETE' }); location.reload(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    });
  }
})();
