# Connect Schedule Mailer to Victor's Microsoft mailbox

The app update is ready for setup. It has not been deployed or connected to your work account. These steps keep the existing website address:

https://celebrated-yeot-408a90.netlify.app/

Power Automate and SharePoint are not used by this version. Ordinary Microsoft Graph email operations use the existing licensed mailbox. Netlify Functions and Blobs usage is subject to your Netlify plan and limits; this is not a promise of unlimited free hosting.

## 1. Check Microsoft app registration access

Open https://entra.microsoft.com/ and sign in with **victor.pena@sixflags.com**.

Go to **Entra ID → App registrations → New registration**. Navigation labels can vary; search for App registrations if necessary.

If app registrations or consent are restricted, Six Flags IT must register/approve the app. The code cannot grant itself company permissions. The IT details are listed below.

## 2. Register the app

Use these values:

| Field | Value |
| --- | --- |
| Name | Schedule Mailer — HR / Wardrobe |
| Supported account types | Accounts in this organizational directory only |
| Redirect URI platform | **Web** |
| Redirect URI | `https://celebrated-yeot-408a90.netlify.app/api/auth/callback` |

Select Register. Keep the Overview page open and record the **Application (client) ID** and **Directory (tenant) ID**.

The platform must be Web because the private server exchanges the authorization code. Do not select Single-page application, enable implicit grants, or enable public client flows.

## 3. Configure delegated permissions

In the app registration, open **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.

Add or retain:

- **User.Read** — used only when Victor connects the sending mailbox, to verify the mailbox identity.
- **Mail.Send** — send through the connected mailbox.
- **openid**, **profile**, **email**, and **offline_access** if the portal requires them to be listed explicitly. The app requests these scopes during its sign-in/connection flows.

Use **delegated permissions**, not application permissions. This implementation does not request Mail.Read, Mail.ReadWrite, tenant-wide mailbox access, or coworkers' mail-sending permissions. Staff sign-in requests only identity scopes; Victor's separate Connect my mailbox action requests the mail/refresh scopes.

Some companies require administrator consent even for delegated permissions. If Microsoft shows **Need admin approval**, ask Six Flags IT to approve this registration. Do not switch tenants or weaken authentication to get around that prompt.

## 4. Create a server credential and identify Victor's account

In the app registration, open **Certificates & secrets → Client secrets → New client secret**. Choose an expiration period appropriate for company policy. Record the secret **Value** when it is shown, not the Secret ID.

In **Entra ID → Users**, open Victor's work account and copy its **Object ID**. This is different from the app registration's Object ID and the Application (client) ID. The app uses Victor's user Object ID as the permanent owner identity.

If directory access is restricted, IT can supply that user Object ID. The app will not guess the owner from an email address or let the first visitor claim ownership.

## 5. Configure the existing Netlify project

Open the Netlify dashboard and select **celebrated-yeot-408a90**. Open **Project configuration → Environment variables** (or Site configuration, depending on the dashboard).

Add the following values with **Functions** scope and **Production** context. If your plan shows a single scope, ensure the variables are available to Functions. Do not expose them as frontend build variables.

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://celebrated-yeot-408a90.netlify.app` — no trailing slash |
| `MS_TENANT_ID` | Directory (tenant) ID from step 2 |
| `MS_CLIENT_ID` | Application (client) ID from step 2 |
| `MS_CLIENT_SECRET` | Client secret **Value** from step 4 |
| `MS_OWNER_OBJECT_ID` | Victor's **user** Object ID from step 4 |
| `TOKEN_ENCRYPTION_KEY` | A new random encryption key generated below |

On your Mac, generate the encryption key in Terminal:

```sh
openssl rand -base64 32
```

Paste its output into TOKEN_ENCRYPTION_KEY in Netlify. Enter the client secret directly into Netlify too; neither secret is needed in chat or in website files. Preserve the encryption key across deploys. Changing it without migrating the encrypted records makes the existing mailbox connection, staff access and settings unreadable.

Redeploy after changing runtime variables. Keep production credentials out of deploy previews. The API also checks its primary hostname and rejects preview aliases.

Netlify Blobs is accessed by Functions using the site's runtime credentials. No Netlify personal access token belongs in the app's environment. The private store is provisioned when the application first writes to it.

## 6. Deploy the extracted project

This version contains private server functions. **Do not drag the folder into Netlify Drop as a static website.** Do not upload the entire project as the public directory.

After extracting the ZIP, open Terminal in its `schedule-mailer-netlify` folder. With Node 22 or newer installed:

```sh
npm ci
npm test
npm run build
npx netlify-cli login
npx netlify-cli link
```

During `link`, select the existing **celebrated-yeot-408a90** project. Do not create a new site. Then run:

```sh
npx netlify-cli deploy --build --prod
```

The supplied netlify.toml uses:

- Build command: `npm run build`
- Publish directory: `public`
- Functions directory: `netlify/functions`

Alternatively, put this project in a **private Git repository**, connect that repository to the existing Netlify project, and use the same build settings. Keep private recipient seed files outside `public/`.

## 7. Connect and test your mailbox

1. Open the website and select **Sign in with Microsoft** using Victor's work account.
2. Select **Connect my mailbox** and sign in as Victor again when Microsoft asks. Approve the requested permissions if company policy permits it.
3. The page should show **Victor's mailbox connected**.
4. Select **Send a test to my work email**. This sends only synthetic test text to **victor.pena@sixflags.com**, not to departments.
5. Confirm the message arrives in Victor's Inbox and appears in Sent Items.
6. Open **Department recipients & staff access**. Review the three recipient lists and saved department mappings before using a real report.

The source lists contain 8 Food & Beverage addresses, 7 Admissions addresses and 4 Retail / Rentals / Attractions addresses from the examples you supplied. Both Natalia addresses were retained because they are distinct entries. CC is blank. You can change these lists and save in the owner panel.

## 8. Approve coworkers

1. Give a coworker the existing website address.
2. They sign in using their own work account. The app shows **Waiting for Victor's approval**.
3. In your owner panel, select **Refresh access requests** and check their displayed name/email before selecting **Approve**.
4. They select **Check access again** and can begin using the app.

Approved staff can view the full uploaded report and every prepared department email. Approval grants the ability to send this workflow from Victor's mailbox; it does not grant inbox-reading access. Only Victor can edit saved recipient/mapping settings or approve/remove staff. Removing access blocks further API requests, including an existing session. An already-submitted email cannot be recalled by removing access.

Staff still need to sign into this app to establish their identity. They do not connect their mailboxes, receive your Microsoft tokens, or need your password. Signing out of the app does not disconnect Victor's sending connection. **Disconnect mailbox** disables new sends for everyone.

## Daily use

1. Upload the original CSV or XLSX weekly report already filtered to 15-year-olds.
2. Choose the worksheet and dates. Check source warnings and confirm the report.
3. Select **Prepare department emails**.
4. Check each department's recipients and employee table. Select its review checkbox.
5. Select **Send reviewed emails**. Only checked departments are sent.

If a source department is unknown, Victor can assign it to the correct recipient group under **Match departments in this report**, save, then prepare the emails again. New departments outside the three configured groups need a code/configuration expansion; do not assign them to an unrelated group.

The site revalidates the data and recipient settings on the server. It accepts no user-supplied From address, arbitrary recipients, or arbitrary email body. Emails contain only the corresponding department's rows.

## When something stops working

- **Microsoft setup is still needed:** check the six environment variables and redeploy.
- **Need admin approval / access denied in Microsoft:** Six Flags IT must approve app registration or delegated consent.
- **Sign-in could not be completed:** check the exact Web redirect URI, tenant/client IDs, Victor's user Object ID, and client secret. The code intentionally does not display tokens or raw Microsoft responses.
- **Mailbox connection needed:** Victor selects Connect/Reconnect my mailbox. Microsoft can expire/revoke a delegated connection or require MFA/sign-in again.
- **Client secret expiring:** create a replacement secret, update the Netlify environment value, and redeploy before expiration. Keep the encryption key unchanged.
- **Email already accepted:** duplicate submission is skipped, including from a different staff member or after refreshing the page.
- **Delivery outcome uncertain:** check Victor's Sent Items and, if needed, ask IT to trace the message. Do not create repeated modified requests merely to force a resend. This implementation has no automatic retry or override for an uncertain result. After confirming non-delivery, a maintainer can reconcile the relevant private receipt deliberately.
- **Accepted by Microsoft but not received:** acceptance is not a final delivery receipt. Check Sent Items, spam/quarantine and Microsoft's delivery status.
- **Blobs access or quota error:** check Netlify Functions/Blobs availability and usage. Never put storage credentials in browser code.

## Details for Six Flags IT

- Existing origin: `https://celebrated-yeot-408a90.netlify.app`
- Single-tenant Microsoft Entra web application; authorization code flow with PKCE, verified ID tokens, and a server-held client secret.
- Web redirect: `https://celebrated-yeot-408a90.netlify.app/api/auth/callback`
- Owner: Victor Peña, `victor.pena@sixflags.com`, pinned to his Entra user Object ID.
- Delegated Microsoft Graph scopes for owner connection: `User.Read`, `Mail.Send`, `offline_access`, plus OIDC identity scopes.
- Staff authentication: OIDC identity only; owner-approved Entra object IDs. No mailbox-read permissions or app-only permissions.
- Tokens are encrypted with AES-256-GCM before durable storage, remain server-side, and are never included in browser responses.
- Each session is eight hours, uses Secure/HttpOnly/SameSite cookies and server-side records; state, nonce, PKCE, same-origin checks and CSRF tokens protect flows.
- Hosting: existing Netlify site, private Functions and encrypted site-scoped Blobs. Only `public/` is published as static files. Site administrators control server storage and secrets.
- Sending: Graph `/me/sendMail` through Victor's saved delegated authorization, department-specific fixed recipients and escaped HTML, Sent Items enabled, server-side duplicate claims and failure tracking.
- No workbook or employee row database. Minimal send receipts persist to prevent duplicates. Microsoft's sent messages and provider logs have their own retention.
- Automated checks are complete; live consent, hosting, and email delivery still require setup validation.

Official references:

- https://learn.microsoft.com/en-us/graph/api/user-sendmail
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
- https://docs.netlify.com/build/functions/overview/
