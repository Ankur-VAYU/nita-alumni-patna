# NIT Agartala Alumni — Patna Chapter

Web and mobile app for NIT Agartala alumni from Bihar, wherever they work.

| File | Contents |
| --- | --- |
| [`PRODUCT.md`](PRODUCT.md) | Product and technical spec: decisions, roles, eligibility, features, phased plan, recommended stack, data model, server rules, operating procedures, open questions |
| [`ui-prototype/index.html`](ui-prototype/index.html) | Clickable prototype (v4). Open in a browser; no build step |
| [`backend/`](backend/README.md) | Live backend: join form, member database, admin API and command-line tools |
| [`DEPLOY.md`](DEPLOY.md) | Where the data is stored, how to deploy, how to create accounts from the backend |

## UI prototype

The prototype uses **sample data** saved in the browser's local storage. Nothing is sent to a
server, and payments are simulated. "Reset sample data" in the sidebar restores the original data.

Use the **Demo: view as** menu to switch between a visitor, an applicant waiting for verification,
a member and the admin (the chapter President). To try sign-in, use mobile `98350 41276` and the
code shown on screen, or a new number to go through registration.

| Screen | What it covers |
| --- | --- |
| Home | Visitors: what the chapter is, how joining works, next event, institute updates, committee. Members: profile completeness, next event, pinned announcements, members working in and outside Bihar, institute updates, latest board posts |
| Sign in / Join | Mobile number + one-time code. New numbers go to registration: profile, roll number, home district in Bihar, work place anywhere, optional proof and vouch, consent |
| Events | RSVP with guests, contribution per family or person, pay online or at the venue, places left, add to Google Calendar, who's going |
| Alumni | Verified members only. Search and filters including home district and work place, quick filters, "where they work" and "home districts" summaries, full profile with WhatsApp and LinkedIn. Contact details follow each person's privacy setting |
| Jobs & Help | Vacancy, referral, help needed, offering help, mentorship. Expiry, filled/closed, interest, reporting |
| My profile | All profile fields, photo, completeness, privacy, notification preferences, sign out, request deletion, resubmit after rejection |
| Admin | Overview, Verify (batch-list match and checklist), Reports, Events & payments, Batch list (CSV upload and lookup), Members (roles, committee titles, suspend), Content, Activity log |

## Status

- **Built:** the app uses the prototype's layout and light colours (navy sidebar on computers, bottom tab bar on phones). A **welcome page** for visitors (`/`) with how joining works, the next event, NIT Agartala updates and the chapter committee; **events** visible to visitors (details only); the join form and **Sign in with Google**; **Home** with profile completeness, next event, pinned announcements, NIT Agartala updates and latest board posts; **Events** with RSVP, guests, places left and contribution; **Alumni** directory with filters, quick filters and "where they work / home districts"; **Jobs & Help** board; **My profile** (edit in place, privacy settings, request account deletion); a **status page** for applicants (waiting, or not verified with the reason and a form to correct and resubmit); **News** (`/news`); **Admin** with the prototype's tabs: Overview, Verify (checklist), Reports, Events & payments, Batch list (upload and lookup), Members (roles, add, import/export), Content (announcements, NIT Agartala updates, and the automatic nita.ac.in headlines with "Check now"), Activity log; and a **privacy notice**.
- **Next:** WhatsApp/email notifications, online payments, and the Play Store app.
