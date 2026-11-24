# Sriya & Fani · The Engagement Album

[Open the guest invitation](https://sriya19.github.io/SriyaFani-Engagement-Pictures/)

The invitation uses green, ivory, lotus artwork and traditional kolam details. The gallery holds full original files in a private R2 bucket. Only published photographs are visible to approved guests. The owner dashboard is at `/host`.

## Run the project

Use Node 22.13 or newer. Clone the repository and run these commands from its root.

```sh
npm ci
npm test
npm run db:local
npm run dev
```

Open the local address printed by Wrangler. For a local SMS test, create an ignored `.dev.vars` file with the same keys described below, using a test account or an approved test number. The integration tests use a mocked provider and send no messages.

## Publish the GitHub guest link

Open **Settings → Pages**, select **Deploy from a branch**, choose **gh-pages** and **/(root)**, and save. The guest page calls the hosted album for access requests, approvals and private photographs. A guest submits their name and mobile number. Only the browser that made an approved request can use its session.

For future changes, build with `npm run build:pages` and publish the contents of `dist/` to the `gh-pages` branch. Set `GUEST_WEB_ORIGIN` on the backend to the exact Pages origin and use `ALBUM_API_ORIGIN` at build time if the backend address changes.

## Deploy your own copy on Cloudflare

1. Deploy from this repository. Configure folder access and server credentials in the hosting account. The invitation artwork and fonts are included here. Engagement originals, guest details and download records belong in the private bucket and database.
2. Log in to Cloudflare with `npx wrangler login`. Create a D1 database with `npx wrangler d1 create sriya-fani-album`. Copy its returned database ID into the `DB` entry in `wrangler.jsonc`. Create a private R2 bucket with `npx wrangler r2 bucket create sriya-fani-album-originals`. You can choose your own database and bucket names if you update the configuration. Leave public R2 access disabled. Review the account's plan and any storage or SMS costs before activation.
3. Set the server secrets listed below in Cloudflare Workers settings or through `npx wrangler secret put KEY_NAME`. Use a sender that can reach your guests' destinations.
4. Run `npm run db:remote` to create the hosted tables, then `npm run deploy`. Open the URL from the successful deployment. Verify a real invitation using your own number and a second approved test number before inviting guests.
5. For automatic deployments, connect this repository under Workers Builds and point it to the desired production branch. Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`. Apply new D1 migrations before deploying later versions that depend on them.

## Server settings

| Server key | Value |
| --- | --- |
| `WEB_PUSH_PRIVATE_JWK` | A private P-256 VAPID signing key in JWK form, configured only as a server secret. Browser alerts use its public key. |
| `TWILIO_ACCOUNT_SID` | Optional for the separate standalone host SMS sign-in. Guest requests do not use Twilio. |
| `TWILIO_AUTH_TOKEN` | Twilio account auth token, stored as a secret |
| `TWILIO_VERIFY_SERVICE_SID` | Your SMS-enabled Verify service SID |
| `OWNER_PHONE` | Your own mobile number in international form, for example a number beginning with +1 or +91. Only a verified session for this number can open the standalone host dashboard. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Optional for direct Drive import. Enable the Drive API in Google Cloud, create a dedicated service account, share the chosen folder to that service account as Viewer and save the complete JSON credential as a single secret. |
| `DRIVE_FOLDER_ID` | Optional initial folder ID. You can also paste the folder link into the host studio after signing in. |
| `RESEND_API_KEY`, `MAIL_FROM`, `HOST_EMAIL` | Optional host emails for new access requests. Use a verified Resend sender address and your own inbox. Requests are always available in the host studio. |
| `SMS_DAILY_LIMIT` | Optional site-wide limit on SMS starts in a rolling 24-hour window. The default is 120. |

## Use the album

Visit **Host studio**, sign in with your configured owner number and enter its SMS code. Open **Add photos**. Choose items from Drive and use **Import selected**, or use **Choose photos** to upload originals from your device or a synced Drive folder. Both paths create drafts. Go to **Photos** and press **Publish** on the images you want to open to approved guests. **Unpublish** immediately restricts future requests.

Guests request access with their name and phone number. A new browser needs its own approval, even if it supplies the same number. Enable notifications in **Guest requests** to receive host alerts. Guests can enable approval alerts on the invitation. On iOS 16.4 or later, add the guest or host site to the Home Screen and enable alerts from that icon. Use **Guest requests** to approve, decline or revoke. **Activity** shows the guest, phone number, photo, time and action. The download record means the server received an authorized request and began serving an original. Browsers cannot confirm that a file reached a device's photo library, or reliably report a screenshot.

Direct uploads support common image formats up to 90 MiB per photo. Browser-readable images receive a smaller preview. Drive imports retain the original and verify the source checksum when available. A file without a compatible thumbnail can still be downloaded in its original format.

Drive sharing and album access are independent. A Restricted source folder keeps its own link private. Copies stored by this album continue working if you later change Drive sharing. If the photographer controls the source, you can put selected originals in your own Restricted folder.
