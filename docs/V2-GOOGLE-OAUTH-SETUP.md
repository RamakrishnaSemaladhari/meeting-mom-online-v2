# Meeting MoM Online V2 — Dedicated Google OAuth Setup

V2 must use its own Google OAuth client and refresh token. Do not reuse V1 credentials.

## Dedicated GitHub Actions secrets

Create these three **repository secrets** in `RamakrishnaSemaladhari/meeting-mom-online-v2`:

- `MMV2_GOOGLE_OAUTH_CLIENT_ID`
- `MMV2_GOOGLE_OAUTH_CLIENT_SECRET`
- `MMV2_GOOGLE_OAUTH_REFRESH_TOKEN`

The V2 workflow now reads only these dedicated names for Drive authentication. Keep `MMV2_GATEWAY_URL` and `MMV2_CALLBACK_SECRET` unchanged.

## Create a new OAuth client in Google Cloud

1. Open https://console.cloud.google.com/ and create/select a project named **Meeting MoM V2**. Keep it separate from any V1 project.
2. Under **APIs & Services → Library**, enable **Google Drive API**.
3. Under **Google Auth Platform** (or **APIs & Services → OAuth consent screen**), configure the app. If the app is External and in Testing, add the Google account that owns the meeting audio as a test user.
4. Under **Clients**, create an OAuth client. Choose **Desktop app** for a user-authorized local token-generation flow, and save the client ID and client secret securely.
5. Generate a refresh token for this exact client using Google's OAuth flow with the scope `https://www.googleapis.com/auth/drive`. The Google account used for consent must have access to the target audio and the output folders. Do not paste credentials into chat, source code, or commits.
6. In the V2 repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add the three secret names above with the values from this new V2 client and its newly generated refresh token.

## Validation

After all three secrets are added, run the **Meeting MoM Online V2** workflow. The first check should be the Drive OAuth token refresh and file metadata lookup. A successful token refresh alone is not enough; the audio download and final output uploads must also succeed.

If Google returns `invalid_grant`, generate a new refresh token for the same client and replace `MMV2_GOOGLE_OAUTH_REFRESH_TOKEN`. If it returns `invalid_client`, verify the V2 client ID and client secret belong to the same OAuth client.

## Security notes

- Never log or commit client secrets, refresh tokens, or access tokens.
- Do not delete V1 secrets; V2 no longer reads their names.
- Restrict Drive access to the account and folders needed for processing.
