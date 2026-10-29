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
| `MAILER_ACCESS_CODE` | A random private sending code, 32–256 printable non-space ASCII characters |
| `MAILER_ALLOWED_RECIPIENTS` | Exact approved recipient email addresses, separated by commas, semicolons, or newlines; include every To and CC address |

Create the sending code in a password manager, or generate one locally with `openssl rand -hex 24`. This is an app sending code, not your Resend API key or a mailbox password. Share it only with authorized operators, through an appropriate private channel. It is entered into the app for the current tab and cleared when the app resets.

The allowlist is required: start with only your own test address. After delivery testing, add the exact approved department recipients. Wildcards and whole-domain permissions are not supported. Addresses are normalized to lowercase. The app's local department/contact settings determine the reviewed message routing; the server additionally refuses any unapproved recipient. Changing the local recipient file does not change the server allowlist.

Changing `MAIL_FROM` changes the displayed sender name and address. The address must belong to the verified Resend domain. No receiving mailbox is needed. The email includes a no-reply notice; this does not remove the recipient's Reply button. Any domain catch-all or forwarding rules determine what happens to replies.

5. Deploy the code and redeploy after environment-variable changes. Direct sending stays disabled until all four variables are valid. Preview branches are disabled even if they accidentally receive production variables. The development context is supported for local testing.
6. Check the Netlify deploy log for the function and its rate-limit rule (10 requests per IP/domain per minute on `/api/send-department`). Netlify rate limiting supplements the private code and recipient allowlist.

The test-summary feature adds `/api/test-summary-preview` (10 requests per IP/domain per minute) and `/api/test-summary` (5 per minute). They use the same four production environment variables and existing private sending code. No Microsoft mailbox connection or additional secret is required. The test destination is fixed on the server to `victor.pena@sixflags.com`, independently of the live recipient allowlist. Test requests cannot supply another To/CC/BCC destination, sender, raw email body, or attachments.

## Validate before department use

1. Use a sample CSV/XLSX with fictional employees and load the intended department recipient settings.
2. Check that the app displays the intended From name and address.
3. Choose dates, review the schedule, check the review boxes, enter the private sending code, and leave BCC off.
4. Choose **Review test summary for Victor**. This shows all included department recipients and full emails and flags addresses not yet approved for live sending. The preview sends no emails.
5. Confirm **Send test summary to Victor**. Exactly one `[TEST ONLY]` email goes to **victor.pena@sixflags.com**, with no CC, BCC, or attachments. Check that inbox and Resend's delivery status. The app's accepted status alone does not prove inbox delivery.
6. Add approved department To/CC addresses to `MAILER_ALLOWED_RECIPIENTS` when ready for live use and redeploy. Then choose and review one department and use **Review & send this department**. Testing never triggers this action or marks a department as sent.

Direct sending currently supports To and CC. For BCC, use the existing copy-and-draft workflow. Each confirmation sends one department email; it does not send other departments automatically.

If a request times out or has an unknown result, retry the unchanged email without refreshing. Its idempotency key is reused. Reviews expire after 23 hours, inside Resend's 24-hour deduplication window. Check Resend before refreshing, altering, or resending an uncertain request. No schedule or send history is stored by this app across browser sessions.

## Security and data handling

The function requires the private code, a same-origin JSON request, an approved recipient list, valid rows, and a confirmed review. It controls the sender and constructs escaped HTML and plain text on the server. It limits the input size and does not log schedule content, addresses, or secrets. Netlify and Resend still process the submitted message, and provider retention settings apply. Keep employee schedule data out of screenshots, deployment files, and test fixtures.

The copy/draft workflow remains available without private settings. This app does not alter Microsoft account security or Authenticator settings.
