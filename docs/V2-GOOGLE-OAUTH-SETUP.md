# Meeting MoM Online V2 — Google Drive OAuth Setup and Recovery

V2 uses a dedicated Google OAuth client and three dedicated GitHub Actions repository secrets. Do not reuse V1 credentials.

## Required V2 repository secrets

Repository: `RamakrishnaSemaladhari/meeting-mom-online-v2`

- `MMV2_GOOGLE_OAUTH_CLIENT_ID`
- `MMV2_GOOGLE_OAUTH_CLIENT_SECRET`
- `MMV2_GOOGLE_OAUTH_REFRESH_TOKEN`

The processing workflow maps these secrets to the standard environment variable names expected by `src/drive.py`. The V2 Connection Test workflow uses the same three V2 secret names.

Keep these existing secrets unchanged:

- `MMV2_GATEWAY_URL`
- `MMV2_CALLBACK_SECRET`

## One-time Google setup

1. Open [Google Cloud Console](https://console.cloud.google.com/), select the project used by Meeting MoM V2, and enable **Google Drive API**.
2. Configure Google Auth Platform / OAuth consent screen. If the app is External, publish it to **In production** when appropriate. Leaving an External app in Testing can cause refresh tokens to expire after seven days.
3. Create an OAuth client of type **Desktop app**.
4. Download the OAuth client JSON to a trusted Windows computer. Do not commit it to this repository or upload it to a public location.
5. Use the supplied `REPAIR_MMV2_GOOGLE_AUTH.bat` and `MMV2_AUTH_REPAIR.py` helper files from the conversation download. The helper opens Google's consent page, requests offline Drive access, validates a refresh-token exchange and a Drive API list call, then writes the three values directly to GitHub Actions secrets using GitHub CLI.
6. The Google account used in consent must have access to the source audio and destination folders in My Drive.

## GitHub CLI prerequisite

Install [GitHub CLI](https://cli.github.com/) and authenticate it with an account that has Admin access to this repository:

```bat
gh auth login
```

Run `REPAIR_MMV2_GOOGLE_AUTH.bat` from the folder containing the Python helper and downloaded OAuth client JSON. The helper does not print the refresh token or write it to a file. Do not share the OAuth client JSON.

## Validate from GitHub Actions

After the helper reports success:

1. Open **Actions** in the repository.
2. Select **V2 Connection Test**.
3. Select **Run workflow**.
4. Confirm these steps pass:
   - `GOOGLE_OAUTH_REFRESH: PASS`
   - `GOOGLE_DRIVE_API_LIST: PASS`
   - `APPS_SCRIPT_GATEWAY: PASS`

The test does not print Drive file names or IDs. It validates authentication and API access only; it does not prove that the processing workflow can download a particular recording or upload all final outputs. Run a dummy-data end-to-end test after this check.

## Recovery behaviour and limitations

- `invalid_grant`: Google rejected the refresh token. Re-authorise and replace `MMV2_GOOGLE_OAUTH_REFRESH_TOKEN`.
- `invalid_client`: The client ID and client secret do not belong to the same OAuth client, or the client is invalid. Replace the pair from the same Desktop OAuth client.
- `insufficientPermissions` / HTTP 403: Check Drive API enablement, granted scope and the Google account's access to the relevant Drive files.
- Never log or commit client secrets, refresh tokens or access tokens.

There is no guaranteed permanent Google refresh token. Google can revoke tokens or make them invalid under documented account, consent, security and token-lifetime conditions. Production publishing removes the specific Testing-mode seven-day expiry; it does not make tokens irrevocable.

## Security

- Keep all credentials in GitHub Actions repository secrets.
- Never put OAuth credentials in workflow YAML, source code, test payloads, artifacts, logs or the frontend.
- Do not use real meeting recordings as connection-test fixtures.
- Do not print raw OAuth or Drive response bodies in workflow logs.
