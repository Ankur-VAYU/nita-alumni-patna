// Events: RSVP with guests, places left, contribution, who's going, add to Google Calendar.
(function () {
  'use strict';
  const { h, api, toast } = window.NITA;
  const root = document.getElementById('events');
  const ist = (d, o) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
  const money = (p) => '₹' + (p / 100).toLocaleString('en-IN');
  const feeText = (e) => (e.feePaise ? `${money(e.feePaise)} per ${e.feeBasis}` : 'Free');
  const gcal = (e) => {
    const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const end = e.endsAt || new Date(new Date(e.startsAt).getTime() + 3 * 3600 * 1000);
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${f(e.startsAt)}/${f(end)}`, location: e.venue, details: e.description || '' });
  };

  const IS_ADMIN = root.dataset.role === 'admin';
  // Visitors who are not signed in see details and places left, and sign in to RSVP.
  const GUEST = root.dataset.guest === '1';
  const MON = (d) => ist(d, { month: 'short' });

  function rsvpControls(e) {
    const guests = h('select', { 'aria-label': 'Guests', style: 'width:auto' }, Array.from({ length: 11 }, (_, i) => h('option', { value: i, selected: e.mine && e.mine.guests === i }, i === 0 ? 'Just me' : `Me + ${i}`)));
    const go = h('button', { class: 'btn', type: 'button', onclick: async () => {
      go.disabled = true;
      try { await api(`/api/v1/events/${e.id}/rsvp`, { json: { guests: Number(guests.value) } }); toast(e.mine ? 'RSVP updated' : 'See you there!'); load(); }
      catch (err) { toast(err.message); go.disabled = false; }
    } }, e.mine ? 'Update RSVP' : "I'll attend");
    const out = [guests, go];
    if (e.mine) out.push(h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
      if (!confirm('Cancel your RSVP?')) return;
      try { await api(`/api/v1/events/${e.id}/rsvp`, { method: 'DELETE' }); toast('RSVP cancelled'); load(); } catch (err) { toast(err.message); }
    } }, 'Cancel my RSVP'));
    return out;
  }

  function card(e) {
    const date = h('div', { class: 'datebox' }, h('b', {}, ist(e.startsAt, { day: 'numeric' })), h('span', {}, MON(e.startsAt)));
    const who = h('div', { class: 'who-list', hidden: true });
    const isPast = e.past || e.status === 'cancelled';
    const actions = h('div', { class: 'event-actions' });
    if (e.status === 'cancelled') actions.append(h('span', { class: 'tag bad' }, 'Cancelled'));
    else if (e.past) actions.append(h('span', { class: 'tag' }, 'Past'));
    else {
      if (GUEST) actions.append(h('a', { class: 'btn', href: '/login' }, 'Sign in to RSVP'));
      else {
        if (e.mine) actions.append(h('span', { class: 'btn on' }, `Going${e.mine.guests ? ` · +${e.mine.guests}` : ''}`));
        actions.append(...rsvpControls(e));
      }
      if (e.capacity) {
        const taken = e.people;
        actions.append(h('div', { class: 'cap' }, h('span', {}, `${taken} of ${e.capacity} places taken · ${e.placesLeft} left`),
          h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, Math.round((taken / e.capacity) * 100))}%` }))));
      } else actions.append(h('div', { class: 'cap' }, `${e.people} going`));
      actions.append(h('a', { class: 'btn ghost small', href: gcal(e), target: '_blank', rel: 'noopener' }, 'Add to Google Calendar'));
    }
    const time = ist(e.startsAt, { hour: 'numeric', minute: '2-digit' }).toUpperCase() + (e.endsAt ? '–' + ist(e.endsAt, { hour: 'numeric', minute: '2-digit' }).toUpperCase() : '');
    return h('article', { class: 'card event' + (isPast ? ' past' : '') }, date,
      h('div', { class: 'section', style: 'gap:6px;min-width:0' },
        h('h2', {}, e.title),
        h('p', { class: 'muted' }, `${ist(e.startsAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${time} · ${e.venue}`),
        e.description ? h('p', {}, e.description) : null,
        h('p', { class: 'muted' }, h('b', {}, 'Contribution: '), feeText(e), e.feePaise && !isPast ? ' · pay at the venue' : ''),
        e.mine && e.feePaise ? h('p', {}, e.mine.paidPaise >= e.mine.duePaise ? h('span', { class: 'tag ok' }, `Paid ${money(e.mine.paidPaise)}`) : h('span', { class: 'tag gold' }, `${money(e.mine.duePaise)} due at venue`)) : null,
        e.rsvps ? h('div', {}, h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
          if (!who.hidden) { who.hidden = true; return; }
          const list = await api(`/api/v1/events/${e.id}/attendees`);
          who.replaceChildren(h('ul', { class: 'plain' }, list.map((a) => h('li', {}, `${a.name} · ${a.branch} ${a.batch}`, a.guests ? h('span', { class: 'muted' }, ` +${a.guests}`) : null))));
          who.hidden = false;
        } }, `${e.past ? 'Who came' : "Who's going"} (${e.rsvps})`)) : null,
        who),
      actions);
  }

  async function load() {
    try {
      const list = GUEST ? await fetch('/api/v1/public/events').then((r) => { if (!r.ok) throw new Error('Could not load events'); return r.json(); }) : await api('/api/v1/events');
      const up = list.filter((e) => !e.past), past = list.filter((e) => e.past);
      root.replaceChildren(
        h('div', { class: 'top' }, h('div', {}, h('h1', {}, 'Events'), h('p', {}, 'Alumni meets and chapter activities. Places count you and your guests.' + (GUEST ? ' Sign in to RSVP and see who is going.' : ''))),
          IS_ADMIN ? h('div', { class: 'row' }, h('a', { class: 'btn', href: '/admin#events' }, 'Add event')) : null),
        h('section', { class: 'section' }, h('h2', {}, 'Upcoming'),
          ...(up.length ? up.map(card) : [h('div', { class: 'card empty' }, 'No upcoming events yet. The committee will announce the next meet here.')])),
        past.length ? h('section', { class: 'section' }, h('h2', {}, 'Past'), ...past.map(card)) : '');
    } catch (e) { root.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
  }
  load();
})();
