# Schedule Mailer — connected Microsoft mailbox

This version keeps Victor's Microsoft mailbox connected on the server. Approved staff sign in with their own Six Flags accounts to use the app, then send separate department emails from victor.pena@sixflags.com.

**The code is prepared, but it is not connected to Microsoft or deployed yet. Start with [SETUP.md](SETUP.md).** Microsoft credentials are not included. No live emails were sent during development.

## Included

- Original CSV/XLSX weekly-report parser, date selection, final shift locations and end times.
- Authenticated staff access with owner approval and removal.
- An owner-only Microsoft mailbox connection using delegated Mail.Send and offline access.
- Department recipients from Victor's supplied contact lists, stored outside public assets. Owner-only recipient/mapping edits persist on the server.
- Preview and review of each department's exact recipients and email body before sending.
- HTML email sent through Microsoft Graph with a copy in Victor's Sent Items.
- Atomic duplicate protection across staff, tabs and retries. Uncertain delivery outcomes stop automatic retries.
- Encrypted Microsoft refresh token, settings, sessions and staff records in a private Netlify Blobs store.

## Deploying this version

This is a **Netlify Functions project, not a static drag-and-drop ZIP**. Extract it, configure Microsoft and Netlify using SETUP.md, then deploy using Netlify CLI or a private Git repository connected to Netlify. Publish only `public/`; Netlify builds the private function code separately. Never set the publish directory to the project root.

```sh
npm ci
npm test
npm run build
```

The server uses Node 22 or newer. `npm run dev` is a local visual preview, not a Microsoft-connected deployment. Without explicit local fixture mode it shows the setup-needed screen. A private `.env.preview` containing `PREVIEW_FIXTURE=1` enables synthetic visual QA; that script refuses all sending and connection operations. It is not deployed as a function.

## Data and limits

The workbook stays in the browser. Selected rows are posted to the server for preview and delivery but are not saved as schedule records. Microsoft retains sent messages. Netlify/Microsoft operational logs remain subject to their settings.

The app stores encrypted connection data, recipient settings, staff access, sign-in records and minimal duplicate receipts. Receipts retain a keyed message fingerprint, sending staff object ID, department, timestamp, count and outcome; they contain no employee names or email body. They are retained until the site owner removes the store, to prevent duplicate delivery. Eight-hour sessions and hourly rate-limit records expire and are cleaned up daily. Pending access requests expire after seven days; expired records are ignored and can be overwritten by a fresh sign-in.

Only approved uploaders can see the full source report and department previews. Department recipients receive separate emails, not access to the app. Input must already be filtered to 15-year-olds; the parser does not infer ages. Unknown departments, invalid recipient lists, formula-containing workbooks, conflicting shifts and duplicate employee-days stop sending.

Limits: 5 MB input file, 3,000 selected shifts, 50 recipients per department email, 30 send attempts per user per hour, and 5 owner connection-test attempts per hour. Preview approval expires after 15 minutes or a saved recipient/mapping change. The app does not automatically retry uncertain sends or guarantee final inbox delivery after Microsoft's 202 Accepted response.

## Validation completed

Automated tests exercise CSV/XLSX parsing, department isolation, unknown mappings, malformed dates/times, escaped email HTML, token-signature/issuer/audience/nonce validation, session restrictions, CSRF protection, owner-only operations, encrypted token storage, revocation, stale previews/settings, concurrent duplicate protection, connection loss and ambiguous delivery outcomes. The function bundle and public/private file separation are also checked.

Live Microsoft consent, Netlify storage, and actual email delivery must be verified after setup. See the first-use test in SETUP.md.

## File layout

- `public/`: browser app, parser and stylesheet. No recipient address lists or credentials.
- `server/`: authenticated API, encryption, Microsoft integration, routing and private initial recipients.
- `netlify/functions/`: request handler and daily cleanup.
- `test/`: synthetic tests; no real schedules.
- `scripts/`: build checks and a local preview server that cannot send mail.

Keep the source repository private because the server-side seed contains workplace contact addresses. Encryption protects stored values against casual inspection; hosting administrators with access to the encryption key and stored values can decrypt them.
# schedule-mailer
