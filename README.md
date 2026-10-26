# Schedule Mailer

Turn an original weekly CSV or XLSX schedule into a separate reviewed email for each department. Each email contains only the selected recipient group's employees, work locations, and final shift end times.

## Use the app

1. Load the original weekly schedule already filtered to 15-year-olds. Choose the worksheet for an Excel workbook.
2. Load your private recipient settings file or enter the department contacts. Fix unassigned departments and incomplete addresses.
3. Choose dates and one department. Review employees, locations, end times, recipients, and source warnings; check the review boxes.
4. For direct sending, enter your private sending code, choose **Review & send this department**, review the summary, and confirm **Send email**. Direct sending uses To and CC; BCC remains available through email drafts.
5. Alternatively, use **Copy formatted email**, **Open email draft**, then paste and send from your own email app.
6. Repeat for the next department.

Direct sending requires the private Netlify settings in [SETUP.md](SETUP.md). Without them, sending stays disabled and the copy/draft workflow remains usable. No Microsoft or Gmail mailbox connection is required.

The app reports provider acceptance, not guaranteed inbox delivery. Check Resend for delivery or bounce status. Retries of an unchanged review reuse a provider idempotency key for up to 23 hours; successful emails are blocked from resending in the current tab. If a send has an unknown result, retry without changing or refreshing the page, or check Resend before sending again. The app has no persistent send history across refreshes or devices.

## Data handling

The original file is read locally. Working schedules, contact settings, and the private sending code stay in memory until the tab is reset; they are not written to browser storage. Confirming a direct send transmits that department's message, selected schedule rows, and recipients to a Netlify function and then Resend. The function does not write message content, credentials, or recipients to application logs or a database. Resend and recipient mail systems may retain message content and delivery records under their settings.

Approved recipient addresses and credentials are configured in Netlify, outside the public code. Keep downloaded recipient settings private and separate from the deployment and GitHub. Copies you intentionally download, copy, or email remain wherever you place them. The app does not infer ages.

## Development and deployment

Requires Node.js 22 or newer. No npm runtime dependencies; the spreadsheet library is bundled with its license.

```sh
npm ci
npm test
npm run build
```

Netlify publishes `public/` from `main` and bundles the sending function from `netlify/functions/`. Only the function reads private environment variables. See [SETUP.md](SETUP.md) for setup and validation.
