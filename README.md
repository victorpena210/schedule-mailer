# Schedule Mailer

Turn an original weekly CSV or XLSX schedule into a separate reviewed email for each department. Each email contains only one date of the selected recipient group's employees, work locations, and final shift end times.

## Use the app

1. Sign in with the shared app password. Default department recipients load automatically.
2. Upload the original weekly CSV or XLSX schedule, already filtered to 15-year-olds. Choose the worksheet if the Excel workbook has more than one. Dates come from the dated columns inside the report, not the filename or upload date. ZIP archives are not accepted.
3. Select the schedule dates and the evening send time. The default is **8:00 PM America/Chicago (Central)**. The app creates a separate email for each department and date with shifts.
4. Review each daily card's schedule, recipients, source warnings, and send time. Add or remove To/CC recipients on that card; these edits affect only that department and date.
5. Click **Send all** and review the single confirmation listing every daily email, recipient list, schedule date, and send time. Confirm **Send all** once. Each email is submitted separately for its chosen Central time on the previous calendar day. October 30 schedules send October 29; November 1 schedules send October 31.
6. Keep the page open until submission finishes. Accepted emails send automatically after the page closes. If a request fails, processing stops and retrying skips the emails already accepted.
7. Open **History** to see scheduled, queued, sent, delivered, canceled, and failed messages. It remains available after refresh and sign-in. Use **Refresh** or **Load older emails**; the visible tab also checks once a minute. The email service, not the browser clock, determines delivery status.

If the planned evening has already passed but the schedule date is current or future, the status panel shows **Immediately after confirmation**, explains why, and requires explicit immediate-send confirmation. Past schedule dates and send times more than 30 days ahead are blocked. You can adjust the time before confirming. Accepted cards retain their confirmed content and time when other defaults change.

A new upload or changed draft does **not** update or cancel queued emails. Manage queued messages in Resend. Exact duplicates remain protected across refreshes, sign-ins, and deployments. A changed schedule or recipient list is a separate message; check History before confirming changes.

Direct sending requires the private Netlify settings in [SETUP.md](SETUP.md). No Microsoft or Gmail mailbox connection is required. Scheduled delivery uses [Resend's scheduling API](https://resend.com/docs/dashboard/emails/schedule-email).

## Send one test summary to Victor

Load the schedule and recipient settings, choose dates, review the schedule and any source warnings, and enter the existing private sending code. Leave BCC off. Select **Review test summary for Victor**, inspect the complete summary, then **Send test summary to Victor**.

This sends exactly one message to **victor.pena@sixflags.com**, using the configured Resend sender (for this project, `victor.pena@wardrobe.team`). The test has no CC, BCC, or attachments. It contains every mapped department with shifts on the selected dates, the intended From/To/CC and subject, and the exact live email bodies including the automated footer. The current department uses its edited subject; other departments use the same default subjects that selecting them would generate. All use the current message and signature. Empty departments are listed as skipped. Missing mappings or incomplete contact lists must be fixed before preparing the test.

Signed-in operators can add any valid To or CC address to a department email. There is no recipient allowlist or separate approval step. The preview validates recipient formatting and displays the exact routing and message; Send all requires one confirmation covering all pending daily emails. Test summaries always go only to Victor's fixed work address.

Preparing the summary does not send email. Confirming it sends only the summary, never department emails, and does not mark or schedule any live email. Summary retries use their own idempotency references, separate from live sends. A repeated accepted summary is blocked in the current tab; refreshing still clears the app's in-memory history. Check your work inbox and Resend for delivery status.

History distinguishes submission, scheduled delivery, sending, delivery, and failures using the provider’s reported status. It does not infer success from a timestamp. Accepted live emails are recorded persistently; uncertain attempts can be retried safely inside the 23-hour retry window and stop for review after that.

## Data handling

The original file is read locally. Working schedules, contact settings, and the private sending code stay in memory until the tab is reset; they are not written to browser storage. Confirming a scheduled or immediate send transmits that department/date's message, selected schedule rows, and recipients to a Netlify function and then Resend. Resend stores scheduled messages until the requested send time, independently of the browser. The function does not write message content or credentials to application logs or a database. Authenticated history retains delivery metadata, including recipients, and message fingerprints in Netlify Blobs. Resend and recipient mail systems may retain message content and delivery records under their settings.

Reviewing a test summary transmits all included drafts to a private Netlify function for validation and rendering. Confirming it sends their combined contents through Resend only to Victor's work address. These routes use the same private code, origin checks, size limits, and production-only configuration as live delivery.

Default department recipients and credentials are configured privately in Netlify, outside the public code. Operators can edit recipients in each department email after signing in. Keep downloaded recipient settings private and separate from the deployment and GitHub. Copies you intentionally download, copy, or email remain wherever you place them. The app does not infer ages.

## Development and deployment

Requires Node.js 22 or newer. No npm runtime dependencies; the spreadsheet library is bundled with its license.

```sh
npm ci
npm test
npm run build
```

Netlify publishes `public/` from `main` and bundles the sending function from `netlify/functions/`. Only the function reads private environment variables. See [SETUP.md](SETUP.md) for setup and validation.


## History and duplicate prevention

Production uses a site-wide Netlify Blobs store (`schedule-mailer-history`) for delivery metadata and SHA-256 fingerprints. Employee rows, email bodies, and passwords are not stored there. The original spreadsheet stays in the browser. History is protected by the same password and same-origin checks as sending. It imports earlier Schedule Mailer emails still available from Resend and keeps archived metadata even after those messages leave the provider's retention window.

An exact duplicate is the same sender, sorted To/CC recipients, subject, and full rendered HTML/plain-text message. The schedule date and shift details are part of that message. Changing only the send time does not create another email. Persistent fingerprints skip already accepted messages across refreshes and devices. Atomic first-write records keep concurrent requests on the same provider idempotency key. Unknown attempts older than 23 hours stop for review instead of risking another send. Before the first submission, the server also checks older provider emails for a matching full message. If that check is unavailable, nothing new is sent. Changing recipients or schedule content produces a different fingerprint.

Use a Resend key with permission to **read and send emails**. Sending-only keys cannot support reliable history or legacy duplicate checks. All credentials remain on the server. History includes provider-reported statuses and last-check timestamps; a scheduled timestamp is never presented as proof of sending or delivery. A canceled identical email remains protected from accidental resubmission; no automatic resend/reset control is exposed.
