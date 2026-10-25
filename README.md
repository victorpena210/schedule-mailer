# Schedule Mailer

Turn an original weekly CSV or XLSX schedule into a separate email-ready table for each department. Each message contains only that recipient group's employees, work locations, and final shift end times.

## Use the app

1. Upload the original weekly schedule already filtered to 15-year-olds. For an Excel workbook, choose the worksheet to include.
2. Load your private `schedule-mailer-recipients.json` settings file or add contacts under Department recipients.
3. Choose dates and one department. Review any unassigned departments, incomplete addresses, and source warnings.
4. Check the schedule review box, then choose **Copy formatted email**.
5. Choose **Open email draft**, paste the copied table into the message, verify the sending account and recipients, and send from your email app. Repeat for each department.

The draft button uses the device's default email handler. If you use Outlook in a browser, you can instead open Outlook yourself and copy the displayed To, CC, subject, and formatted message into a new email.

## Data handling

Schedules and recipient settings stay in the browser tab. The app has no Microsoft login, mailbox connection, automatic sending, or server data store. Nothing is uploaded or saved to browser storage. Refreshing or selecting **Clear everything** removes the in-tab data. Changing the schedule preserves the recipient settings until the tab is reset.

Downloaded files, copied messages, and sent emails remain wherever you place them. Keep the recipient settings file private and separate from the public website and GitHub repository. The app does not infer ages: use the source report already filtered to 15-year-olds.

## Development and deployment

Requires Node.js 22 or newer. The spreadsheet library is bundled locally with its license; there are no npm runtime dependencies.

```sh
npm ci
npm test
npm run build
```

Netlify publishes `public/` from the GitHub `main` branch using `netlify.toml`. The functions directory is intentionally empty. Microsoft credentials and Netlify environment variables are not needed. See [SETUP.md](SETUP.md) for deployment and usage details.
