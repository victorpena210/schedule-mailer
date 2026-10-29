# Schedule Mailer

Turn an original weekly CSV or XLSX schedule into a separate reviewed email for each department. Each email contains only one date of the selected recipient group's employees, work locations, and final shift end times.

## Use the app

1. Sign in with the shared app password. Default department recipients load automatically.
2. Upload the original weekly CSV or XLSX schedule, already filtered to 15-year-olds. Choose the worksheet if the Excel workbook has more than one. Dates come from the dated columns inside the report, not the filename or upload date. ZIP archives are not accepted.
3. Select the schedule dates and the evening send time. The default is **8:00 PM America/Chicago (Central)**. The app creates a separate email for each department and date with shifts.
4. Review each daily card's schedule, recipients, source warnings, and send time. Add or remove To/CC recipients on that card; these edits affect only that department and date.
5. Click **Schedule**, review the confirmation, then **Confirm & schedule**. Each email is queued to send at the chosen Central time on the previous calendar day. For example, October 30 sends October 29, and November 1 sends October 31. Daylight-saving offsets are calculated for the send date.
6. After the card says **Scheduled**, the provider holds the message and sends it automatically even if the page is closed. Repeat for the other daily cards. Uploading or previewing a file alone does not queue or send anything.

If the planned evening has already passed but the schedule date is current or future, the card shows **Send now**, explains why, and requires explicit immediate-send confirmation. Past schedule dates and send times more than 30 days ahead are blocked. You can adjust the time before confirming. Accepted cards retain their confirmed content and time when other defaults change.

A new upload or changed draft does **not** update or cancel queued emails. Review and cancel the old email in Resend before submitting a replacement. In the current tab, confirmed department/date pairs are locked against another submission and retained across replacement uploads. Refreshing or signing out clears this local history, but queued messages remain active. Exact daily retries share a Resend idempotency reference for 24 hours, including across refreshes; changed messages are separate submissions, and retries beyond that window may duplicate delivery. Check the provider's queue before reuploading a schedule already confirmed.

Direct sending requires the private Netlify settings in [SETUP.md](SETUP.md). No Microsoft or Gmail mailbox connection is required. Scheduled delivery uses [Resend's scheduling API](https://resend.com/docs/dashboard/emails/schedule-email).

## Send one test summary to Victor

Load the schedule and recipient settings, choose dates, review the schedule and any source warnings, and enter the existing private sending code. Leave BCC off. Select **Review test summary for Victor**, inspect the complete summary, then **Send test summary to Victor**.

This sends exactly one message to **victor.pena@sixflags.com**, using the configured Resend sender (for this project, `victor.pena@wardrobe.team`). The test has no CC, BCC, or attachments. It contains every mapped department with shifts on the selected dates, the intended From/To/CC and subject, and the exact live email bodies including the automated footer. The current department uses its edited subject; other departments use the same default subjects that selecting them would generate. All use the current message and signature. Empty departments are listed as skipped. Missing mappings or incomplete contact lists must be fixed before preparing the test.

Signed-in operators can add any valid To or CC address to a department email. There is no recipient allowlist or separate approval step. The preview validates recipient formatting and displays the exact routing and message; each daily department send still requires confirmation. Test summaries always go only to Victor's fixed work address.

Preparing the summary does not send email. Confirming it sends only the summary, never department emails, and does not mark or schedule any live email. Summary retries use their own idempotency references, separate from live sends. A repeated accepted summary is blocked in the current tab; refreshing still clears the app's in-memory history. Check your work inbox and Resend for delivery status.

The app reports provider acceptance, not guaranteed inbox delivery. Check Resend for delivery or bounce status. Retries must be made within 23 hours of the original review; successful daily emails are blocked from resubmission in the current tab. If a send has an unknown result, retry without changing or refreshing the page, or check Resend before sending again. The app has no persistent send history across refreshes or devices.

## Data handling

The original file is read locally. Working schedules, contact settings, and the private sending code stay in memory until the tab is reset; they are not written to browser storage. Confirming a scheduled or immediate send transmits that department/date's message, selected schedule rows, and recipients to a Netlify function and then Resend. Resend stores scheduled messages until the requested send time, independently of the browser. The function does not write message content, credentials, or recipients to application logs or a database. Resend and recipient mail systems may retain message content and delivery records under their settings.

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
