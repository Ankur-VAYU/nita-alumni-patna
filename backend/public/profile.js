// Edit my profile: work, home district, links, mentoring, privacy and photo.
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
    const field = (name, label, input, hint) => { errs[name] = h('span', { class: 'err' }); return h('div', { class: 'field' }, h('label', { for: 'p-' + name }, label), input, hint ? h('small', { class: 'muted small' }, hint) : null, errs[name]); };
    const text = (name, value, type = 'text') => h('input', { id: 'p-' + name, name, type, value: value || '' });
    const sel = (name, list, value, blank) => h('select', { id: 'p-' + name, name }, blank ? h('option', { value: '' }, blank) : null, list.map((v) => Array.isArray(v) ? h('option', { value: v[0], selected: v[0] === value }, v[1]) : h('option', { value: v, selected: v === value }, v)));
    const vis = [['members', 'All verified alumni'], ['batch', 'Only my batchmates'], ['admins', 'Only chapter admins']];

    const avatar = h('div', { class: 'avatar big' }, m.hasPhoto ? h('img', { src: `/api/v1/members/${m.id}/photo`, alt: '' }) : initials(m.name));
    const photoInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: 'p-photo', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { photoData = await resizePhoto(f); removePhoto = false; avatar.replaceChildren(h('img', { src: photoData, alt: '' })); }
      catch (err) { toast(err.message); }
    } });
    const removeBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { photoData = null; removePhoto = true; avatar.replaceChildren(initials(m.name)); } }, 'Remove photo');
    const mentor = h('input', { type: 'checkbox', id: 'p-mentor', checked: m.openToMentor });

    const form = h('form', { class: 'form', novalidate: true },
      h('div', { class: 'full photo-edit' }, avatar, h('div', { class: 'field' }, h('label', { for: 'p-photo' }, 'Photo'), photoInput, m.hasPhoto ? removeBtn : null, errs.photo = h('span', { class: 'err' }))),
      field('phone', 'Mobile number', text('phone', m.phone, 'tel')),
      field('position', 'Current position', text('position', m.position)),
      field('organisation', 'Current organisation', text('organisation', m.organisation)),
      field('workDistrict', 'Work city / district', text('workDistrict', m.workDistrict)),
      field('workState', 'Working state (or outside India)', sel('workState', ref.workStates, m.workState, 'Select')),
      field('homeDistrict', 'Home district (Bihar)', sel('homeDistrict', ref.homeDistricts, m.homeDistrict)),
      field('linkedin', 'LinkedIn profile link', text('linkedin', m.linkedin, 'url'), 'Starts with https://'),
      field('skills', 'Skills or expertise', text('skills', m.skills)),
      h('label', { class: 'check full' }, mentor, ' I am open to mentoring students and junior alumni'),
      field('phoneVisibility', 'Who can see my phone number', sel('phoneVisibility', vis, m.phoneVisibility)),
      field('emailVisibility', 'Who can see my email', sel('emailVisibility', vis, m.emailVisibility)),
      h('div', { class: 'full actions-row' }, h('button', { class: 'btn' }, 'Save changes'), h('a', { class: 'btn ghost', href: '/me' }, 'Cancel')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Object.values(errs).forEach((e) => (e.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      delete data.photo;
      data.openToMentor = mentor.checked;
      if (photoData) data.photo = photoData;
      if (removePhoto) data.removePhoto = true;
      try { await api('/api/v1/me/profile', { method: 'PUT', json: data }); toast('Saved'); setTimeout(() => (location.href = '/me'), 600); }
      catch (e) { if (e.fields) Object.entries(e.fields).forEach(([k, v]) => { if (errs[k]) errs[k].textContent = v; }); toast(e.message); }
    });

    root.replaceChildren(h('h1', {}, 'Edit my profile'),
      h('p', { class: 'muted' }, `${m.name} · ${m.degree} · ${m.branch} · ${m.batch}. To correct your name, email, roll number, degree, branch or batch, contact a chapter admin.`),
      h('section', { class: 'card' }, form));
  }).catch((e) => root.replaceChildren(h('p', { class: 'note bad' }, e.message)));
})();
