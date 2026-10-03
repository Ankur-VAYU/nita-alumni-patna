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

  function card(e) {
    const date = h('div', { class: 'datebox' }, h('b', {}, ist(e.startsAt, { day: 'numeric' })), h('span', {}, ist(e.startsAt, { month: 'short' })));
    const who = h('div', { class: 'who-list', hidden: true });
    const actions = h('div', { class: 'event-actions' });
    if (e.status === 'cancelled') actions.append(h('span', { class: 'tag bad' }, 'Cancelled'));
    else if (e.past) actions.append(h('span', { class: 'tag' }, 'Over'));
    else {
      const guests = h('select', { 'aria-label': 'Guests' }, Array.from({ length: 11 }, (_, i) => h('option', { value: i, selected: e.mine && e.mine.guests === i }, i === 0 ? 'Just me' : `Me + ${i}`)));
      const go = h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await api(`/api/v1/events/${e.id}/rsvp`, { json: { guests: Number(guests.value) } }); toast(e.mine ? 'RSVP updated' : 'See you there!'); load(); }
        catch (err) { toast(err.message); }
      } }, e.mine ? 'Update RSVP' : "I'll attend");
      actions.append(guests, go);
      if (e.mine) actions.append(h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        try { await api(`/api/v1/events/${e.id}/rsvp`, { method: 'DELETE' }); toast('RSVP cancelled'); load(); } catch (err) { toast(err.message); }
      } }, 'Cancel my RSVP'));
      actions.append(h('a', { class: 'btn ghost small', href: gcal(e), target: '_blank', rel: 'noopener' }, 'Add to Google Calendar'));
    }
    return h('article', { class: 'card event' + (e.past || e.status === 'cancelled' ? ' past' : '') }, date,
      h('div', { class: 'event-body' },
        h('h2', {}, e.title),
        h('p', { class: 'muted' }, `${ist(e.startsAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${e.venue}`),
        e.description ? h('p', {}, e.description) : null,
        h('p', { class: 'small' }, h('b', {}, 'Contribution: '), feeText(e), e.feePaise ? ' · pay at the venue' : ''),
        h('p', { class: 'muted small' }, `${e.people} going${e.capacity ? ` · ${e.placesLeft} of ${e.capacity} places left` : ''}`),
        e.mine ? h('p', { class: 'note ok' }, `You're going${e.mine.guests ? ` with ${e.mine.guests} guest${e.mine.guests > 1 ? 's' : ''}` : ''}.`,
          e.feePaise ? ` Contribution: ${money(e.mine.duePaise)}${e.mine.paidPaise >= e.mine.duePaise ? ' (paid, thank you)' : ' (pay at the venue)'}.` : '') : null,
        e.rsvps ? h('button', { class: 'linkish', type: 'button', onclick: async () => {
          if (!who.hidden) { who.hidden = true; return; }
          const list = await api(`/api/v1/events/${e.id}/attendees`);
          who.replaceChildren(h('ul', { class: 'plain' }, list.map((a) => h('li', {}, `${a.name} · ${a.branch} ${a.batch}`, a.guests ? h('span', { class: 'muted small' }, ` +${a.guests}`) : null))));
          who.hidden = false;
        } }, `Who's going (${e.rsvps})`) : null,
        who),
      actions);
  }

  async function load() {
    try {
      const list = await api('/api/v1/events');
      const up = list.filter((e) => !e.past), past = list.filter((e) => e.past);
      root.replaceChildren(h('h1', {}, 'Events'), h('p', { class: 'muted' }, 'Chapter meets and activities. Places count you and your guests.'),
        h('h2', { class: 'section-title' }, 'Upcoming'),
        ...(up.length ? up.map(card) : [h('p', { class: 'card muted' }, 'No upcoming events yet. The committee will announce the next meet here.')]),
        past.length ? h('h2', { class: 'section-title' }, 'Past') : null, ...past.map(card));
    } catch (e) { root.replaceChildren(h('p', { class: 'note bad' }, e.message)); }
  }
  load();
})();
