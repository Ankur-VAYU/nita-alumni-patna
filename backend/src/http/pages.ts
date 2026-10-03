// Server-rendered pages: sign in, my profile, and the admin shell (admin.js does the rest).
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string, opts: { user?: { name: string; role: string } | null; script?: string } = {}) {
  const u = opts.user;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · NITA Alumni Patna</title>
<link rel="icon" href="/emblem.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Figtree:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/site.css">
${opts.script ? `<script src="/common.js" defer></script><script src="${opts.script}" defer></script>` : ''}
</head>
<body>
<header class="bar">
  <a class="brand" href="${u ? '/home' : '/join'}"><img src="/emblem.svg" alt="" width="36" height="36"><span><b>NITA Alumni</b><small>Patna Chapter</small></span></a>
  ${u ? `<nav class="who"><a href="/home">Home</a><a href="/alumni">Alumni</a><a href="/events">Events</a><a href="/board">Jobs &amp; Help</a><a href="/me">My profile</a>${u.role === 'admin' || u.role === 'moderator' ? '<a href="/admin">Admin</a>' : ''}<a href="/logout">Sign out</a><span class="me">${esc(u.name)}${u.role !== 'member' ? ` <em class="pill">${esc(u.role)}</em>` : ''}</span></nav>` : ''}
</header>
<main class="page">${body}</main>
<footer class="foot"><a href="/privacy">Privacy notice</a>${u ? '' : ' · <a href="/join">Join</a> · <a href="/login">Sign in</a>'}</footer>
</body>
</html>`;
}

const MESSAGES: Record<string, [string, string]> = {
  need: ['info', 'Please sign in to continue.'],
  signed_out: ['info', 'You have signed out.'],
  google_off: ['warn', 'Google sign-in is not set up yet. An admin can still sign in with the admin key below.'],
  state: ['warn', 'The sign-in was interrupted or took too long. Please try again.'],
  cancelled: ['info', 'Sign-in was cancelled.'],
  google: ['bad', 'Google sign-in did not work. Please try again in a minute.'],
  not_member: ['warn', 'This Google account is not linked to a member. Join first, or ask a chapter admin to add this email address to your profile.'],
  pending: ['info', 'Your registration is waiting for the committee to verify it, usually within 2 working days. You can sign in once it is approved.'],
  rejected: ['bad', 'Your registration was not verified. Please contact a chapter admin.'],
  suspended: ['bad', 'Your account is suspended. Please contact a chapter admin.'],
  key: ['bad', 'That admin key is not correct.'],
  limited: ['bad', 'Too many attempts. Please wait a few minutes and try again.'],
};

export function loginPage(code: string | undefined, email: string | undefined, googleOn: boolean) {
  const m = code ? MESSAGES[code] : undefined;
  const note = m ? `<p class="note ${m[0]}">${esc(m[1])}${code === 'not_member' && email ? `<br><small>Signed in to Google as ${esc(email)}.</small>` : ''}</p>` : '';
  return layout('Sign in', `
<section class="card narrow center">
  <img src="/emblem.svg" alt="" width="84" height="84">
  <h1>Sign in</h1>
  <p class="muted">For verified NIT Agartala alumni of the Patna Chapter. Use the Google account with the email in your member profile.</p>
  ${note}
  ${googleOn ? `<a class="btn google" href="/auth/google"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.1 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</a>` : '<p class="muted">Google sign-in is not set up yet.</p>'}
  <p class="muted small">Not a member yet? <a href="/join">Join the chapter</a></p>
  <details class="keylogin">
    <summary>Chapter admin: sign in with the admin key</summary>
    <form method="post" action="/auth/key">
      <label for="key">Admin key</label>
      <input id="key" name="key" type="password" autocomplete="current-password" required>
      <button class="btn">Sign in</button>
    </form>
  </details>
</section>`);
}

interface MeView {
  name: string; email: string | null; phone: string; rollNo: string | null; degree: string; branch: string; batch: number;
  position: string | null; organisation: string | null; homeDistrict: string; workDistrict: string | null; workState: string | null;
  role: string; title: string | null; status: string; hasPhoto: boolean; id: string;
}

export function mePage(m: MeView, user: { name: string; role: string }) {
  const row = (k: string, v: unknown) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class="muted">Not added</span>'}</dd>`;
  return layout('My profile', `
<section class="card">
  <div class="head">
    <div class="avatar">${m.hasPhoto ? `<img src="/api/v1/members/${esc(m.id)}/photo" alt="">` : esc(m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</div>
    <div><h1>${esc(m.name)}</h1><p class="muted">${esc(m.degree)} · ${esc(m.branch)} · ${esc(m.batch)}${m.title ? ` · <b>${esc(m.title)}</b>` : ''}</p></div>
  </div>
  <p class="note ok">Verified member${m.role !== 'member' ? ` · chapter ${esc(m.role)}` : ''}</p>
  <dl class="kv">
    ${row('Email', m.email)}${row('Mobile', m.phone)}${row('Roll number', m.rollNo)}
    ${row('Position', m.position)}${row('Organisation', m.organisation)}
    ${row('Works in', [m.workDistrict, m.workState].filter(Boolean).join(', '))}${row('Home district', `${m.homeDistrict}, Bihar`)}
  </dl>
  <p class="actions-row"><a class="btn" href="/me/edit">Edit my profile</a>${m.role === 'admin' || m.role === 'moderator' ? '<a class="btn ghost" href="/admin">Open admin</a>' : ''}</p>
  <p class="muted small">Name, email, roll number, degree, branch and batch are checked at verification. To correct them, contact a chapter admin.</p>
</section>`, { user });
}

export function adminPage(user: { name: string; role: string }) {
  return layout('Admin', `
<div id="admin" data-role="${esc(user.role)}" data-name="${esc(user.name)}">
  <h1>Admin</h1>
  <p class="muted">Loading…</p>
</div>`, { user, script: '/admin.js' });
}

export function privacyPage(contactEmail: string | undefined) {
  const contact = contactEmail
    ? `email <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>`
    : 'contact any member of the chapter committee';
  return layout('Privacy notice', `
<article class="card prose">
  <h1>Privacy notice</h1>
  <p class="muted">NIT Agartala Alumni · Patna Chapter</p>

  <h2>Who we are</h2>
  <p>This website is run by volunteers of the Patna Chapter of NIT Agartala alumni, for alumni whose home is in Bihar. It is not run by the institute.</p>

  <h2>What we collect</h2>
  <ul>
    <li>What you enter on the join form: name, mobile number, email, roll number, degree, branch, batch, current position and organisation, work city and state, home district, and optionally LinkedIn, skills, a photo and the name of someone who can vouch for you.</li>
    <li>A proof document (degree, provisional certificate or institute ID), if you upload one.</li>
    <li>When you sign in with Google: your name and email address only. We do not see your Google password or anything else in your Google account.</li>
    <li>A record of actions by chapter admins (who approved or changed what, and when).</li>
  </ul>

  <h2>Why we collect it</h2>
  <ul>
    <li>To check that you are an alumnus, using the institute's list of graduates.</li>
    <li>To let verified members find and contact each other, and to organise chapter events.</li>
  </ul>

  <h2>Who can see it</h2>
  <ul>
    <li>People who are not signed-in, verified members see nothing about you.</li>
    <li>Verified members can see your name, photo, batch, branch, position, organisation and districts. Your phone number and email are shown according to the privacy choices you make (all members, only your batchmates, or only admins).</li>
    <li>Chapter admins and moderators can see everything you submitted, including the proof document, in order to verify you.</li>
    <li>We do not sell your data or share it with advertisers.</li>
  </ul>

  <h2>Where it is stored and for how long</h2>
  <ul>
    <li>The website runs on Cloudflare and the data is stored in a PostgreSQL database hosted by Neon.</li>
    <li>Proof documents are deleted as soon as your registration is approved or rejected.</li>
    <li>Your profile is kept while you are a member. If you ask us to delete it, we remove it.</li>
  </ul>

  <h2>Your choices</h2>
  <p>You can ask to see, correct or delete your data at any time: ${contact}.</p>

  <p class="muted small">Last updated: ${new Date().getFullYear()}.</p>
</article>`);
}

export interface Stats { members: number; inBihar: number; outsideBihar: number; mentors: number; homeDistricts: number }

const POST_LABEL: Record<string, string> = { job: 'Vacancy', referral: 'Referral', help: 'Help needed', offer: 'Offering help', mentor: 'Mentorship' };
const fmtIST = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

interface Highlights {
  nextEvent: { id: string; title: string; startsAt: Date; venue: string; feePaise: number; feeBasis: string; capacity: number | null; people: number } | null;
  latestPosts: { id: string; type: string; title: string; district: string; state: string; authorName: string }[];
}

export function homePage(user: { name: string; role: string }, stats: Stats, missing: string[], hl: Highlights) {
  const first = user.name.split(/\s+/)[0];
  return layout('Home', `
<section class="hero-band">
  <div>
    <p class="eyebrow">NIT Agartala alumni · Patna Chapter</p>
    <h1>Namaste, ${esc(first)}</h1>
    <p>Alumni from Bihar, wherever they work.</p>
  </div>
  <img src="/emblem.svg" alt="" width="88" height="88">
</section>
${missing.length ? `<section class="card"><p class="note warn">Your profile is missing: ${esc(missing.join(', '))}. Complete profiles are easier for fellow alumni to find.</p><p><a class="btn" href="/me/edit">Complete my profile</a></p></section>` : ''}
<section class="stats">
  <div class="card stat"><b>${stats.members}</b><span>verified alumni</span></div>
  <div class="card stat"><b>${stats.inBihar}</b><span>working in Bihar</span></div>
  <div class="card stat"><b>${stats.outsideBihar}</b><span>working outside Bihar</span></div>
  <div class="card stat"><b>${stats.mentors}</b><span>open to mentoring</span></div>
</section>
<section class="tiles">
  <a class="card tile" href="/alumni"><h2>Alumni directory</h2><p class="muted">Find batchmates by name, branch, batch, home district or where they work.</p></a>
  <a class="card tile" href="/me"><h2>My profile</h2><p class="muted">Your details, photo, and who can see your phone and email.</p></a>
  ${user.role === 'admin' || user.role === 'moderator' ? '<a class="card tile" href="/admin"><h2>Admin</h2><p class="muted">Review registrations and manage members.</p></a>' : ''}
</section>
<section class="tiles two">
  <div class="card">
    <p class="eyebrow-ink">Next event</p>
    ${hl.nextEvent ? `<h2>${esc(hl.nextEvent.title)}</h2><p class="muted">${esc(fmtIST(hl.nextEvent.startsAt))} · ${esc(hl.nextEvent.venue)}</p>
    <p class="muted small">${hl.nextEvent.people} going${hl.nextEvent.capacity ? ` of ${hl.nextEvent.capacity} places` : ''} · ${hl.nextEvent.feePaise ? `₹${(hl.nextEvent.feePaise / 100).toLocaleString('en-IN')} per ${hl.nextEvent.feeBasis}` : 'Free'}</p>
    <p><a class="btn" href="/events">RSVP</a></p>` : '<p class="muted">No upcoming events yet.</p><p><a class="btn ghost" href="/events">See events</a></p>'}
  </div>
  <div class="card">
    <p class="eyebrow-ink">Latest on the Jobs &amp; Help board</p>
    ${hl.latestPosts.length ? `<ul class="plain">${hl.latestPosts.map((p) => `<li><span class="tag ${esc(p.type)}">${esc(POST_LABEL[p.type] ?? p.type)}</span> ${esc(p.title)} <span class="muted small">· ${esc(p.district)}, ${esc(p.state)} · ${esc(p.authorName)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing posted yet. Share a vacancy or ask for help.</p>'}
    <p><a class="btn ghost" href="/board">Open the board</a></p>
  </div>
</section>`, { user });
}

export function alumniPage(user: { name: string; role: string }) {
  return layout('Alumni', `<div id="directory"><h1>Alumni directory</h1><p class="muted">Loading…</p></div>`, { user, script: '/directory.js' });
}

export function editProfilePage(user: { name: string; role: string }) {
  return layout('Edit my profile', `<div id="profile-edit"><h1>Edit my profile</h1><p class="muted">Loading…</p></div>`, { user, script: '/profile.js' });
}

export function eventsPage(user: { name: string; role: string }) {
  return layout('Events', `<div id="events"><h1>Events</h1><p class="muted">Loading…</p></div>`, { user, script: '/events.js' });
}

export function boardPage(user: { name: string; role: string }) {
  return layout('Jobs & Help', `<div id="board"><h1>Jobs &amp; Help</h1><p class="muted">Loading…</p></div>`, { user, script: '/board.js' });
}
