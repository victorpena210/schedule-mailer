# Schedule Mailer setup

This is the browser-only version. It prepares department-specific emails for you to review and send in Outlook or another email app.

## Netlify

Keep the existing Netlify project connected to `victorpena210/schedule-mailer`, branch `main`.

| Setting | Value |
| --- | --- |
| Base directory | Leave blank |
| Build command | `npm run build` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` (empty) |
| Node version | 22 |

Push changes to `main` to trigger deployment. No Microsoft app registration, client secret, mailbox connection, or environment variables are required by this version.

## Prepare department emails

1. Open the website and upload the original weekly CSV or XLSX export, already filtered to 15-year-olds.
2. Load your private recipient settings JSON file under **Department recipients**. Complete any missing email addresses. You can also enter contacts manually and download settings to reuse later.
3. Choose the dates, select a department, and review the listed employees, locations, and end times. Assign any unknown source departments to the correct group before preparing their emails.
4. Check the review boxes, then click **Copy formatted email**.
5. Click **Open email draft**. Paste the copied message into the body. Check the From, To, CC/BCC, and subject before sending.
6. Repeat for the other departments. Each draft includes only the selected recipient group's assigned rows.

If your computer opens the wrong email app, use Outlook directly: create a new message and copy the displayed addresses, subject, and formatted message there. The app cannot select the sender account; choose `victor.pena@sixflags.com` in Outlook when Victor sends the messages. Coworkers' drafts open in their own email app/account.

Refreshing or clearing the app resets the schedule and contact settings. Keep the private recipient settings file on your device; do not upload it to the website's deployment or commit it to GitHub.

## Microsoft account security

The website does not manage your Microsoft account's authentication methods. Normal Outlook sign-in requirements still apply independently of this app. Restoring this version does not remove an Authenticator method you may have enrolled.
