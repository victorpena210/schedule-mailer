# Schedule Mailer setup

The existing Netlify project stays connected to `victorpena210/schedule-mailer`, branch `main`.

| Setting | Value |
| --- | --- |
| Base directory | Leave blank |
| Build command | `npm run build` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |
| Node version | 22 |

## Configure the sender

1. Create or sign into your Resend account.
2. Add `wardrobe.team` under Domains. Add exactly the DNS records Resend supplies at the domain's DNS provider, leaving existing website and mailbox records intact. Enable sending and leave receiving disabled. Wait for verification.
3. Create an API key with **Sending access**, restricted to this domain.
4. In the Schedule Mailer Netlify project, open **Project configuration → Environment variables**. Set the following values for **Production**, including the **Functions** scope. Do not put credentials in GitHub, the public folder, frontend code, URLs, or chat.

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | The private Resend sending key |
| `MAIL_FROM` | `Wardrobe Scheduling <victor.pena@wardrobe.team>` |
| `MAILER_ACCESS_CODE` | A random private sending code, 13–256 printable non-space ASCII characters |

Create the sending code in a password manager, or generate one locally with `openssl rand -hex 24`. This is an app sending code, not your Resend API key or a mailbox password. Share it only with authorized operators, through an appropriate private channel. It is entered into the app for the current tab and cleared when the app resets.

Signed-in operators can send to any valid email address they add to a department's To or CC list. No recipient allowlist is required. The legacy `MAILER_ALLOWED_RECIPIENTS` variable is ignored, even if still present in Netlify. Addresses are normalized to lowercase, duplicates are rejected, and each email supports up to 50 total recipients. Operators review and confirm the exact recipients before sending.

Changing `MAIL_FROM` changes the displayed sender name and address. The address must belong to the verified Resend domain. No receiving mailbox is needed. The email includes a no-reply notice; this does not remove the recipient's Reply button. Any domain catch-all or forwarding rules determine what happens to replies.

5. Deploy the code and redeploy after environment-variable changes. Direct sending stays disabled until all three variables are valid. Preview branches are disabled even if they accidentally receive production variables. The development context is supported for local testing.
6. Check the Netlify deploy log for the function and its rate-limit rule (10 requests per IP/domain per minute on `/api/send-department`). Netlify rate limiting supplements the private code and per-email confirmation.

The test-summary feature adds `/api/test-summary-preview` (10 requests per IP/domain per minute) and `/api/test-summary` (5 per minute). They use the same three production environment variables and existing private sending code. No Microsoft mailbox connection or additional secret is required. The test destination is fixed on the server to `victor.pena@sixflags.com`, regardless of the recipients in the department drafts. Test requests cannot supply another To/CC/BCC destination, sender, raw email body, or attachments.

## Validate before department use

1. Use a sample CSV/XLSX with fictional employees, sign in, and confirm the sender address.
2. Select two dates. Verify that each department has two separate cards when it has shifts on both days, each containing only that day's rows and a one-date subject.
3. Check the evening time (default 20:00 Central). October 30, 2026 at that setting queues for October 29 at 8 PM CDT (`2026-10-30T01:00:00.000Z`). November 1 queues for October 31 at 8 PM CDT. November 2 queues for November 1 at 8 PM CST, after the daylight-saving change.
4. Edit recipients in one daily card and verify that the other date's addresses stay unchanged.
5. Choose **Send** and inspect the complete confirmation, including the day the schedule covers and its send time. Canceling this dialog makes no provider request. Confirmation queues only that one daily email.
6. Verify the card reports **Scheduled** with its timestamp and reference. Check Resend for the queued email and eventual delivery or bounce status. Provider acceptance does not prove inbox delivery.
7. Check the late-upload path: when the previous evening has passed, current/future schedule dates show **Immediately after confirmation** in the status panel and require that explicit confirmation. Past schedule dates and send times more than 30 days away are rejected before contacting the provider.

The existing test-summary routes can preview multiple dates for the same department and send one summary only to Victor. They never queue or send the department drafts. Each department/date pair must be unique and each draft must contain one date. The summary supports up to 93 daily drafts within the existing 512 KiB request limit.

## Scheduled delivery

The server recomputes `scheduled_at` from the validated single schedule date and selected time in `America/Chicago`. It does not trust a browser-supplied timestamp. `POST https://api.resend.com/emails` holds the message for delivery, so no browser timer, cron job, or additional credential is needed. Production-only settings, the shared password, same-origin checks, recipient validation, limits, and confirmation remain required.

Scheduled responses contain `status: scheduled`, the provider message ID, and the canonical `scheduledAt` timestamp. Immediate sends return `status: accepted`. If the target time passes between review and submission, the server rejects the stale delivery mode and requires a new review; it never silently changes a scheduled request into an immediate send.

Queued messages are immutable snapshots of their confirmed recipients and content. Changing files, recipients, or the time in the app does not cancel or update those messages. Manage them in Resend, and cancel an existing queued message before making a replacement. The app retains confirmed cards across upload changes in the current tab, but has no persistent queue/history interface across refreshes or devices.

Exact daily payload retries reuse a content-based provider reference across refreshes for Resend's 24-hour idempotency window. The API rejects attempts older than 23 hours. Changed content produces a separate reference; a replacement is not an automatic update. A refreshed/reuploaded message outside the provider window may also duplicate an earlier queued email. Review Resend before resubmitting an existing schedule or retrying an unknown result.

See [Resend scheduling](https://resend.com/docs/dashboard/emails/schedule-email) for the 30-day scheduling limit and queue management.

## Security and data handling

The function requires the private code, a same-origin JSON request, valid To and CC addresses, valid rows, and a confirmed review. It controls the sender and constructs escaped HTML and plain text on the server. It limits the input size and does not log schedule content, addresses, or secrets. Netlify and Resend still process the submitted message, and provider retention settings apply. Keep employee schedule data out of screenshots, deployment files, and test fixtures.

The copy/draft workflow remains available without private settings. This app does not alter Microsoft account security or Authenticator settings.

## Private department recipients
Set `MAILER_RECIPIENT_SETTINGS` in Netlify Functions environment variables to the complete recipient settings JSON. Mark it secret and restrict it to Production. Never commit that value. `MAILER_ACCESS_CODE` (13–256 printable characters) protects `/api/private-contacts`; it uses the same code as sending. Redeploy after setting these values. The site opens with a password-only sign-in screen. Users enter this code once to load recipients and authorize the current tab. Sign out & clear and page navigation clear the session; schedule replacement retains it. The static app shell is public; private recipient retrieval and every send remain authenticated on the server. Clear everything removes the loaded list and code. Local file import remains available. These are the default recipient lists loaded at sign-in, not restrictions on who can receive email. Operators can add or remove valid addresses directly in each department card.
