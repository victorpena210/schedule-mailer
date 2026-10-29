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

1. Use a sample CSV/XLSX with fictional employees and load the intended department recipient settings.
2. Check that the app displays the intended From name and address.
3. Choose dates, review the schedule, check the review boxes, enter the private sending code, and leave BCC off.
4. Choose **Review test summary for Victor**. This shows all included department recipients and full emails and validates recipient address formatting. The preview sends no emails.
5. Confirm **Send test summary to Victor**. Exactly one `[TEST ONLY]` email goes to **victor.pena@sixflags.com**, with no CC, BCC, or attachments. Check that inbox and Resend's delivery status. The app's accepted status alone does not prove inbox delivery.
6. Add or remove To and CC recipients directly in a department email card. Review the addresses and schedule, click **Send**, and confirm. Recipient edits require no Netlify configuration change or redeployment. Testing never triggers this action or marks a department as sent.

Direct sending currently supports To and CC. For BCC, use the existing copy-and-draft workflow. Each confirmation sends one department email; it does not send other departments automatically.

If a request times out or has an unknown result, retry the unchanged email without refreshing. Its idempotency key is reused. Reviews expire after 23 hours, inside Resend's 24-hour deduplication window. Check Resend before refreshing, altering, or resending an uncertain request. No schedule or send history is stored by this app across browser sessions.

## Security and data handling

The function requires the private code, a same-origin JSON request, valid To and CC addresses, valid rows, and a confirmed review. It controls the sender and constructs escaped HTML and plain text on the server. It limits the input size and does not log schedule content, addresses, or secrets. Netlify and Resend still process the submitted message, and provider retention settings apply. Keep employee schedule data out of screenshots, deployment files, and test fixtures.

The copy/draft workflow remains available without private settings. This app does not alter Microsoft account security or Authenticator settings.

## Private department recipients
Set `MAILER_RECIPIENT_SETTINGS` in Netlify Functions environment variables to the complete recipient settings JSON. Mark it secret and restrict it to Production. Never commit that value. `MAILER_ACCESS_CODE` (13–256 printable characters) protects `/api/private-contacts`; it uses the same code as sending. Redeploy after setting these values. The site opens with a password-only sign-in screen. Users enter this code once to load recipients and authorize the current tab. Sign out & clear and page navigation clear the session; schedule replacement retains it. The static app shell is public; private recipient retrieval and every send remain authenticated on the server. Clear everything removes the loaded list and code. Local file import remains available. These are the default recipient lists loaded at sign-in, not restrictions on who can receive email. Operators can add or remove valid addresses directly in each department card.
