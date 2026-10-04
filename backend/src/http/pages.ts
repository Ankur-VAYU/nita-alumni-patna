// Server-rendered pages in the app shell from the agreed prototype: navy sidebar on wide screens,
// bottom tab bar on phones. Page scripts in /public fill in the interactive parts.
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Who the page is for. `member` is false for a session opened with the admin key (no member profile). */
export interface NavUser {
  name: string;
  role: string;
  member: boolean;
  /** Registrations waiting plus reported posts, shown on the Admin link for staff. */
  badge?: number;
}
type Page = 'home' | 'events' | 'alumni' | 'board' | 'profile' | 'admin' | 'signin' | 'other';

const ICONS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  events: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  alumni: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.1 4.3 1.8 5 4.4"/>',
  board: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.1-6.5 8-6.5s7 2.3 8 6.5"/>',
  admin: '<path d="M12 3l8 3v6c0 4.5-3.3 8.3-8 9-4.7-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  signin: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>',
};
const icon = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

function navItems(u: NavUser | null | undefined): [Page, string, string, string][] {
  if (!u) return [['home', 'Home', '/', 'Home'], ['events', 'Events', '/events', 'Events'], ['signin', 'Sign in', '/login', 'Sign in']];
  if (!u.member) return [['admin', 'Admin', '/admin', 'Admin']];
  const items: [Page, string, string, string][] = [
    ['home', 'Home', '/home', 'Home'], ['events', 'Events', '/events', 'Events'], ['alumni', 'Alumni', '/alumni', 'Alumni'],
    ['board', 'Jobs & Help', '/board', 'Jobs'], ['profile', 'My profile', '/me', 'Profile'],
  ];
  if (u.role === 'admin' || u.role === 'moderator') items.push(['admin', 'Admin', '/admin', 'Admin']);
  return items;
}

function layout(title: string, body: string, opts: { user?: NavUser | null; active?: Page; script?: string } = {}) {
  const u = opts.user;
  const items = navItems(u);
  const cur = (k: Page) => (opts.active === k ? ' aria-current="page"' : '');
  const badge = (k: Page, dot: boolean) => (k === 'admin' && u?.badge ? (dot ? '<span class="dot"></span>' : `<span class="count">${u.badge}</span>`) : '');
  const role = u && u.role !== 'member' ? `<em class="pill">${esc(u.role)}</em>` : '';
  const brand = (size: number) => `<a class="brand" href="${u ? (u.member ? '/home' : '/admin') : '/'}"><img src="/emblem.svg" alt="" width="${size}" height="${size}"><span><b>NITA Alumni</b><small>Patna Chapter</small></span></a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · NITA Alumni Patna</title>
<link rel="icon" href="/emblem.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/site.css">
${opts.script ? `<script src="/common.js" defer></script><script src="${opts.script}" defer></script>` : ''}
</head>
<body>
<div class="shell">
  <aside class="side">
    ${brand(44)}
    <nav class="nav" aria-label="Main">${items.map(([k, label, href]) => `<a href="${href}"${cur(k)}>${icon(k)}${esc(label)}${badge(k, false)}</a>`).join('')}</nav>
    <div class="side-foot">
      ${u ? `<span><b>${esc(u.name)}</b>${role}</span><a href="/logout">Sign out</a>` : '<span>For NIT Agartala alumni from Bihar</span>'}
      <a href="/privacy">Privacy notice</a>
    </div>
  </aside>
  <main>
    <div class="utilbar">${brand(38)}${u ? `<span class="me">${esc(u.name.split(/\s+/)[0])}${role}</span>` : ''}</div>
    ${body}
    <p class="page-foot"><a href="/privacy">Privacy notice</a>${u ? ' · <a href="/logout">Sign out</a>' : ''}</p>
  </main>
</div>
<nav class="tabbar" aria-label="Main">${items.map(([k, , href, short]) => `<a href="${href}"${cur(k)}>${icon(k)}${esc(short)}${badge(k, true)}</a>`).join('')}</nav>
</body>
</html>`;
}

/** Page title with the gold rule, an optional line under it and optional buttons on the right. */
const top = (title: string, sub?: string, extra?: string) =>
  `<div class="top"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${extra ? `<div class="row">${extra}</div>` : ''}</div>`;

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
${top('Sign in', 'For verified NIT Agartala alumni of the Patna Chapter.')}
<section class="card narrow center">
  <img src="/emblem.svg" alt="" width="84" height="84">
  <p class="muted">Use the Google account with the email in your member profile.</p>
  ${note}
  ${googleOn ? `<a class="btn google" href="/auth/google"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.1 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</a>` : '<p class="muted">Google sign-in is not set up yet.</p>'}
  <p class="muted">Not a member yet? <a href="/join">Join the chapter</a></p>
  <details class="keylogin">
    <summary>Chapter admin: sign in with the admin key</summary>
    <form method="post" action="/auth/key">
      <label for="key" class="lbl">Admin key</label>
      <input id="key" name="key" type="password" autocomplete="current-password" required>
      <button class="btn">Sign in</button>
    </form>
  </details>
</section>`, { active: 'signin' });
}

export interface MeView {
  id: string; name: string; status: string; role: string; title: string | null; updatedAt: Date;
}
export interface Completeness { pct: number; missing: string[] }

/** My profile: status, completeness, the editable form (profile.js) and the account box. */
export function mePage(m: MeView, user: NavUser, comp: Completeness, email: string | null) {
  const roleLine = m.role !== 'member' ? ` · You are a chapter ${esc(m.role)}${m.title ? ` (${esc(m.title)})` : ''}.` : '';
  return layout('My profile', `
${top('My profile', `Last updated ${esc(fmtDay(m.updatedAt.toISOString().slice(0, 10)))}. Keep it current so fellow alumni can find you.`)}
<div class="banner ok"><span class="tag ok">Verified</span><span>Your profile is listed in the alumni directory${roleLine}</span></div>
${comp.pct < 100 ? `<div class="card section" style="gap:8px"><b>Profile ${comp.pct}% complete</b><div class="meter"><i style="width:${comp.pct}%"></i></div><p class="muted">Missing: ${esc(comp.missing.join(', '))}</p></div>` : ''}
<div id="profile-edit" class="card"><p class="muted">Loading…</p></div>
<section class="section">
  <h2>Account</h2>
  <div class="card row" style="justify-content:space-between"><span class="muted">Signed in with Google as ${esc(email ?? '')}</span><a class="btn ghost" href="/logout">Sign out</a></div>
</section>`, { user, active: 'profile', script: '/profile.js' });
}

export function adminPage(user: NavUser) {
  const staffLine = user.role === 'admin'
    ? 'Run the chapter: verify members, moderate the board, publish events and updates.'
    : 'Moderator tools: verify members, handle reported posts and publish updates.';
  return layout('Admin', `
${top('Admin', staffLine)}
<div id="admin" data-role="${esc(user.role)}" data-name="${esc(user.name)}"><p class="muted">Loading…</p></div>`, { user, active: 'admin', script: '/admin.js' });
}

export function privacyPage(contactEmail: string | undefined, user?: NavUser | null) {
  const contact = contactEmail
    ? `email <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>`
    : 'contact any member of the chapter committee';
  return layout('Privacy notice', `
${top('Privacy notice', 'NIT Agartala Alumni · Patna Chapter')}
<article class="card prose">
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
    <li>People who are not signed-in, verified members see nothing about you. The one exception is the chapter committee: the name, committee title, branch and batch of committee members (for example the President and Secretary) are shown on the public welcome page.</li>
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
</article>`, { user, active: 'other' });
}

export interface Stats { members: number; inBihar: number; outsideBihar: number; mentors: number; homeDistricts: number }

const POST_LABEL: Record<string, string> = { job: 'Vacancy', referral: 'Referral', help: 'Help needed', offer: 'Offering help', mentor: 'Mentorship' };
const fmtTime = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).toUpperCase();
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const istParts = (d: Date) => {
  const p = new Date(d.getTime() + 330 * 60000);
  return { day: p.getUTCDate(), month: p.toLocaleString('en-IN', { timeZone: 'UTC', month: 'short' }) };
};
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
/** The person's name from an activity-log label such as "member:Ankur Kumar". */
const byline = (label: string) => label.replace(/^(member|admin):/, '').replace(/^admin-(api|key)$/, 'Committee');

interface NewsItem { id: string; kind: string; tag: string | null; title: string; body: string | null; link: string | null; pinned: boolean; publishedOn: string; createdByLabel: string }

interface Highlights {
  nextEvent: {
    id: string; title: string; startsAt: Date; venue: string; feePaise: number; feeBasis: string; capacity: number | null; people: number;
    mine: { guests: number; duePaise: number; paidPaise: number } | null;
  } | null;
  latestPosts: { id: string; type: string; title: string; district: string; state: string; authorName: string }[];
  openJobs: number;
  announcements: NewsItem[];
  institute: NewsItem[];
  feed: InstituteFeed;
}

interface FeedItem { title: string; summary: string | null; link: string; date: string | null }
export interface InstituteFeed { notice: FeedItem[]; news: FeedItem[]; event: FeedItem[]; lastSuccessAt: string | null }

const fmtChecked = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const extLink = (href: string, text: string) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

/**
 * "From NIT Agartala": the latest items read automatically from nita.ac.in (Notice Board, Latest News,
 * Upcoming Events), then anything the committee added by hand in Admin → Content.
 */
function updatesSection(feed: InstituteFeed, manual: NewsItem[], allLink: boolean) {
  const group = (label: string, tag: string, items: FeedItem[]) => items.length ? `<div class="card section" style="gap:4px"><div class="eyebrow">${label}</div><div class="list">${items.map((it) =>
    `<div class="item"><span class="tag">${tag}</span><div><h3>${extLink(it.link, it.title)}</h3>${it.summary ? `<p class="small">${esc(it.summary)}</p>` : ''}${it.date ? `<small>${esc(fmtDay(it.date))}</small>` : ''}</div></div>`).join('')}</div></div>` : '';
  const auto = group('Notice board', 'Notice', feed.notice) + group('Latest news', 'News', feed.news) + group('Upcoming events', 'Event', feed.event);
  const hand = manual.length ? `<div class="card section" style="gap:4px"><div class="eyebrow">Added by the committee</div><div class="list">${manual.map((n) =>
    `<div class="item${n.tag ? '' : ' one'}">${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ''}<div><h3>${n.link ? extLink(n.link, n.title) : esc(n.title)}</h3>${n.body ? `<p class="small">${esc(n.body)}</p>` : ''}<small>${esc(fmtDay(n.publishedOn))}</small></div></div>`).join('')}</div></div>` : '';
  const note = feed.lastSuccessAt
    ? `Updated automatically from nita.ac.in every 6 hours · last checked ${esc(fmtChecked(feed.lastSuccessAt))}.`
    : 'Headlines from nita.ac.in appear here after the first automatic check.';
  return `<section class="section">
  <div class="section-head"><h2>From NIT Agartala</h2><a class="linkbtn" href="https://nita.ac.in/" target="_blank" rel="noopener noreferrer">nita.ac.in ↗</a></div>
  ${auto || hand ? auto + hand : '<div class="card empty">No institute updates yet.</div>'}
  <p class="hint">${note}${allLink ? ' <a href="/news">All news</a>' : ''}</p>
</section>`;
}

function announcementsList(list: NewsItem[]) {
  return `<div class="card list">${list.map((n) => `<div class="item one"><div>${n.pinned ? '<div class="pin">PINNED</div>' : ''}<h3>${esc(n.title)}</h3>${n.body ? `<p class="body">${esc(n.body)}</p>` : ''}${n.link ? `<p><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a></p>` : ''}<small>${esc(fmtDay(n.publishedOn))} · ${esc(byline(n.createdByLabel))}</small></div></div>`).join('')}</div>`;
}

export function homePage(user: NavUser, stats: Stats, comp: Completeness, hl: Highlights) {
  const first = user.name.split(/\s+/)[0];
  const e = hl.nextEvent;
  let eventCard = '';
  if (e) {
    const d = istParts(e.startsAt);
    const status = e.mine
      ? `<span class="btn on">Going${e.mine.guests ? ` · +${e.mine.guests}` : ''}</span>${e.feePaise ? (e.mine.paidPaise >= e.mine.duePaise ? '<span class="tag ok">Paid</span>' : `<span class="tag gold">${rupees(e.mine.duePaise)} due at venue</span>`) : ''}<a class="linkbtn" href="/events">Change</a>`
      : '<a class="btn" href="/events">RSVP</a>';
    eventCard = `<div class="card hero-event"><div class="datebox"><b>${d.day}</b><span>${esc(d.month)}</span></div>
  <div class="section" style="gap:6px"><div class="eyebrow">Next event</div><h2>${esc(e.title)}</h2>
  <p class="muted">${esc(fmtTime(e.startsAt))} · ${esc(e.venue)} · ${e.feePaise ? `${rupees(e.feePaise)} per ${esc(e.feeBasis)}` : 'Free'}</p>
  <div class="row">${status}<span class="muted">${e.people}${e.capacity ? ` of ${e.capacity}` : ''} places taken</span></div></div></div>`;
  }
  return layout('Home', `
${top(`Namaste, ${esc(first)}`, 'NIT Agartala alumni from Bihar, wherever they work.')}
${comp.pct < 100 ? `<div class="card section" style="gap:8px"><div class="section-head"><b>Your profile is ${comp.pct}% complete</b><a class="linkbtn" href="/me">Complete profile</a></div><div class="meter"><i style="width:${comp.pct}%"></i></div><p class="muted">Missing: ${esc(comp.missing.join(', '))}. Complete profiles are easier for fellow alumni to find.</p></div>` : ''}
${eventCard}
${hl.announcements.length ? `<section class="section"><div class="section-head"><h2>Chapter announcements</h2><a class="linkbtn" href="/news">See all</a></div>${announcementsList(hl.announcements)}</section>` : ''}
<div class="stats">
  <div class="card stat"><b>${stats.members}</b><span>verified alumni</span></div>
  <div class="card stat"><b>${stats.inBihar}</b><span>working in Bihar</span></div>
  <div class="card stat"><b>${stats.outsideBihar}</b><span>working outside Bihar</span></div>
  <div class="card stat"><b>${hl.openJobs}</b><span>open vacancies and referrals</span></div>
</div>
${updatesSection(hl.feed, hl.institute, true)}
<section class="section">
    <div class="section-head"><h2>Latest on the board</h2><a class="linkbtn" href="/board">See all</a></div>
    ${hl.latestPosts.length ? `<div class="card list">${hl.latestPosts.map((p) => `<div class="item"><span class="tag ${esc(p.type)}">${esc(POST_LABEL[p.type] ?? p.type)}</span><div><h3>${esc(p.title)}</h3><small>${esc(p.district)}, ${esc(p.state)} · ${esc(p.authorName)}</small></div></div>`).join('')}</div>` : '<div class="card empty">Nothing posted yet. <a href="/board">Share a vacancy or ask for help.</a></div>'}
  </section>`, { user, active: 'home' });
}

export function newsPage(user: NavUser, chapter: NewsItem[], institute: NewsItem[], feed: InstituteFeed) {
  const staff = user.role === 'admin' || user.role === 'moderator';
  return layout('News', `
${top('News', 'Chapter announcements and updates from NIT Agartala.', staff ? '<a class="btn" href="/admin#content">Post news</a>' : '')}
<section class="section"><h2>Chapter announcements</h2>${chapter.length ? announcementsList(chapter) : '<div class="card empty">No announcements yet.</div>'}</section>
${updatesSection(feed, institute, false)}`, { user, active: 'home' });
}

export function alumniPage(user: NavUser) {
  return layout('Alumni', `<div id="directory">${top('Alumni directory', 'Loading…')}</div>`, { user, active: 'alumni', script: '/directory.js' });
}

/** Events: members RSVP; visitors (user null) see the details and places left, and sign in to RSVP. */
export function eventsPage(user: NavUser | null) {
  const attrs = user ? `data-role="${esc(user.role)}"` : 'data-guest="1"';
  return layout('Events', `<div id="events" ${attrs}>${top('Events', 'Alumni meets and chapter activities. Places count you and your guests.')}<p class="muted">Loading…</p></div>`, { user, active: 'events', script: '/events.js' });
}

interface PublicHighlights {
  nextEvent: { title: string; startsAt: Date; venue: string; feePaise: number; feeBasis: string; capacity: number | null; people: number } | null;
  institute: NewsItem[];
  feed: InstituteFeed;
  committee: { name: string; title: string | null; branch: string; batch: number }[];
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/** The welcome page for visitors who are not signed in, as in the prototype. */
export function visitorHomePage(hl: PublicHighlights) {
  const e = hl.nextEvent;
  let eventCard = '';
  if (e) {
    const d = istParts(e.startsAt);
    eventCard = `<div class="card hero-event"><div class="datebox"><b>${d.day}</b><span>${esc(d.month)}</span></div>
  <div class="section" style="gap:6px"><div class="eyebrow">Next event</div><h2>${esc(e.title)}</h2>
  <p class="muted">${esc(fmtTime(e.startsAt))} · ${esc(e.venue)} · ${e.feePaise ? `${rupees(e.feePaise)} per ${esc(e.feeBasis)}` : 'Free'}</p>
  <div class="row"><a class="btn" href="/login">Sign in to RSVP</a><span class="muted">${e.people}${e.capacity ? ` of ${e.capacity}` : ''} places taken</span></div></div></div>`;
  }
  const committeeSection = hl.committee.length ? `<section class="section"><h2>Chapter committee</h2>
  <div class="card list">${hl.committee.map((m) => `<div class="item" style="align-items:center"><div class="avatar sm">${esc(initialsOf(m.name))}</div><div><b>${esc(m.name)}</b><div class="muted">${esc(m.title)} · ${esc(m.branch)} ${m.batch}</div></div></div>`).join('')}</div>
  <p class="hint">Questions about joining? Contact any committee member at the next meet or through the institute alumni office.</p></section>` : '';
  return layout('Welcome', `
<div class="hero-guest"><div class="hero-copy"><div class="eyebrow">NIT Agartala alumni · Patna Chapter</div>
  <h1>NIT Agartala alumni from Bihar, <em>wherever they work.</em></h1>
  <p>Find batchmates from your district, attend chapter meets in Patna, and help each other with jobs, referrals and mentoring across India. Every member is verified by the chapter committee.</p>
  <div class="row"><a class="btn" href="/join">Join the chapter</a><a class="btn ghost" href="/login">I already have an account</a></div></div>
  <img src="/emblem.svg" alt="" width="140" height="140"></div>
<section class="section"><h2>How joining works</h2><div class="steps">
  <div class="card step"><h3>Fill in the join form</h3><p class="muted">Add your batch, branch, roll number, your home district in Bihar and where you work now.</p></div>
  <div class="card step"><h3>We check the batch list</h3><p class="muted">We match your roll number with the institute batch list. A degree or ID upload helps if it does not match.</p></div>
  <div class="card step"><h3>Get verified, then sign in with Google</h3><p class="muted">The committee checks your details, usually within 2 working days.</p></div>
</div></section>
${eventCard}
${updatesSection(hl.feed, hl.institute, false)}
${committeeSection}`, { user: null, active: 'home' });
}

export interface JoinLists { degrees: readonly string[]; branches: readonly string[]; years: readonly number[]; districts: readonly string[]; states: readonly string[] }

/** The join form inside the app shell. join.js handles the photo, proof and submit. */
export function joinPage(l: JoinLists) {
  const opts = (list: readonly (string | number)[]) => list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const vis = '<option value="members">All verified alumni</option><option value="batch">Only my batchmates</option><option value="admins">Only chapter admins</option>';
  const err = (n: string) => `<small class="err" data-for="${n}"></small>`;
  return layout('Join', `
${top('Join the chapter', "For NIT Agartala alumni whose home is in Bihar, wherever they work now. The committee checks every registration against the institute's batch list. Already a member? <a href=\"/login\">Sign in</a>")}
<form id="joinForm" class="card form" novalidate>
  <p class="note bad full" id="formError" role="alert" hidden></p>
  <fieldset><legend>About you</legend>
    <div class="field full"><label for="name">Full name (as on degree)</label><input id="name" name="name" autocomplete="name" required maxlength="120">${err('name')}</div>
    <div class="field"><label for="phone">Mobile number (WhatsApp)</label><input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" required placeholder="10-digit number"><span class="hint">For WhatsApp messages from the chapter and fellow alumni.</span>${err('phone')}</div>
    <div class="field"><label for="email">Email (Google account)</label><input id="email" name="email" type="email" autocomplete="email" required><span class="hint">You will sign in with Google using this address.</span>${err('email')}</div>
  </fieldset>
  <fieldset><legend>At NIT Agartala</legend>
    <div class="field"><label for="rollNo">Roll / enrolment number</label><input id="rollNo" name="rollNo" required maxlength="32" autocapitalize="characters"><span class="hint">Used to match you with the institute batch list.</span>${err('rollNo')}</div>
    <div class="field"><label for="degree">Degree</label><select id="degree" name="degree" required><option value="">Select</option>${opts(l.degrees)}</select>${err('degree')}</div>
    <div class="field"><label for="batch">Batch (passing year)</label><select id="batch" name="batch" required><option value="">Select</option>${opts(l.years)}</select>${err('batch')}</div>
    <div class="field"><label for="branch">Branch / department</label><select id="branch" name="branch" required><option value="">Select</option>${opts(l.branches)}</select>${err('branch')}</div>
  </fieldset>
  <fieldset><legend>Work</legend>
    <div class="field"><label for="position">Current position</label><input id="position" name="position" required maxlength="120" autocomplete="organization-title">${err('position')}</div>
    <div class="field"><label for="organisation">Current organisation</label><input id="organisation" name="organisation" required maxlength="160" autocomplete="organization">${err('organisation')}</div>
    <div class="field"><label for="workDistrict">Work city / district</label><input id="workDistrict" name="workDistrict" required maxlength="80">${err('workDistrict')}</div>
    <div class="field"><label for="workState">Working state (or outside India)</label><select id="workState" name="workState" required><option value="">Select</option>${opts(l.states)}</select>${err('workState')}</div>
  </fieldset>
  <fieldset><legend>Home in Bihar</legend>
    <div class="field"><label for="homeDistrict">Home district</label><select id="homeDistrict" name="homeDistrict" required><option value="">Select</option>${opts(l.districts)}</select>${err('homeDistrict')}</div>
    <div class="field"><label for="homeState">Home state</label><input id="homeState" value="Bihar" readonly></div>
  </fieldset>
  <fieldset><legend>Help fellow alumni find you</legend>
    <div class="field"><label for="linkedin">LinkedIn profile link <span class="opt">(optional)</span></label><input id="linkedin" name="linkedin" type="url" placeholder="https://www.linkedin.com/in/...">${err('linkedin')}</div>
    <div class="field"><label for="skills">Skills or expertise <span class="opt">(optional)</span></label><input id="skills" name="skills" maxlength="300">${err('skills')}</div>
    <label class="check full"><input type="checkbox" id="openToMentor" name="openToMentor"> <span>I am open to mentoring students and junior alumni</span></label>
  </fieldset>
  <fieldset><legend>Photo and proof</legend>
    <div class="field full"><div class="photo-row"><div class="avatar lg photo-preview" id="photoPreview" aria-hidden="true"></div>
      <div class="field"><label for="photo">Profile photo <span class="opt">(recommended)</span></label><input id="photo" type="file" accept="image/jpeg,image/png,image/webp"><span class="hint">A clear face photo. It is resized before upload.</span>${err('photo')}</div></div></div>
    <div class="field full"><label for="proof">Degree, provisional certificate or institute ID <span class="opt">(recommended)</span></label><input id="proof" type="file" accept="image/jpeg,image/png,application/pdf"><span class="hint">A photo of the certificate (JPG or PNG, shrunk automatically) or a PDF under 500 KB. Seen only by chapter admins, needed if your roll number does not match the batch list, and deleted once your registration is decided.</span>${err('proof')}</div>
    <div class="field full"><label for="vouchedBy">A verified alumnus who knows you <span class="opt">(optional)</span></label><input id="vouchedBy" name="vouchedBy" maxlength="160" placeholder="Name and batch, e.g. Priya Sinha, 2015">${err('vouchedBy')}</div>
  </fieldset>
  <fieldset><legend>Privacy</legend>
    <div class="field"><label for="phoneVisibility">Who can see my phone number</label><select id="phoneVisibility" name="phoneVisibility">${vis}</select></div>
    <div class="field"><label for="emailVisibility">Who can see my email</label><select id="emailVisibility" name="emailVisibility">${vis}</select></div>
    <p class="hint full">Your name, photo, batch, branch, position, organisation and districts are visible to verified alumni only. People who are not members see nothing.</p>
  </fieldset>
  <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
  <label class="check full"><input type="checkbox" id="consent" name="consent" required> <span>I confirm these details are true and agree that they are shown to verified members according to my privacy settings, as described in the <a href="/privacy" target="_blank">privacy notice</a>.</span></label>
  <small class="err full" data-for="consent"></small>
  <div class="form-actions"><button class="btn" id="submitBtn" type="submit">Submit registration</button></div>
</form>
<section id="done" class="card center" hidden tabindex="-1">
  <img src="/emblem.svg" alt="" width="72" height="72">
  <h2>Thank you, <span id="doneName"></span></h2>
  <p class="muted">Your registration has reached the chapter committee. We check it against the institute batch list, usually within 2 working days. Once you are verified, sign in with Google using the email you entered.</p>
  <a class="btn ghost" href="/">Back to the welcome page</a>
</section>`, { user: null, active: 'home', script: '/join.js' });
}

export function boardPage(user: NavUser) {
  return layout('Jobs & Help', `<div id="board">${top('Jobs &amp; Help', 'Loading…')}</div>`, { user, active: 'board', script: '/board.js' });
}

