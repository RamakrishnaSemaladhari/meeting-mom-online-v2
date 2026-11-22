# Meeting MoM Online V2 — PoC setup

## Apps Script Project Properties

Keep the values in **Apps Script → Project Settings → Script properties**. Do not commit values to GitHub or place them in source files.

| Property | Purpose |
|---|---|
| `GITHUB_TOKEN` | GitHub Actions dispatch from Apps Script |
| `MMV2_AUDIO_FOLDER_ID` | Incoming audio folder |
| `MMV2_CALLBACK_SECRET` | Authenticates workflow callbacks |
| `MMV2_MEETINGS_FOLDER_ID` | Parent folder for meeting workspaces |
| `MMV2_MEETING_FOLDER_ID` | Legacy alias; same folder as above |
| `MMV2_PROCESSING_FOLDER_ID` | Processing workspace configuration |
| `MMV2_REGISTRY_SHEET_NAME` | Registry sheet name; current code uses `MEETINGS` |
| `MMV2_ROOT_FOLDER_ID` | Root workspace folder |
| `MMV2_SPREADSHEET_ID` | V2 registry spreadsheet |

The IDs are configuration, not credentials, but should still be kept out of public source code.

## GitHub Actions repository secrets

The V2 workflow uses these exact names:

- `MMV2_GOOGLE_OAUTH_CLIENT_ID`
- `MMV2_GOOGLE_OAUTH_CLIENT_SECRET`
- `MMV2_GOOGLE_OAUTH_REFRESH_TOKEN`
- `MMV2_GATEWAY_URL`
- `MMV2_CALLBACK_SECRET`

The three OAuth secrets must belong to the Google OAuth client intended for V2. Do not reuse V1 credentials unless you have explicitly confirmed they are dedicated to this V2 project. GitHub does not reveal existing secret values; create/update them in **Settings → Secrets and variables → Actions**.

## PoC processing flow

1. Upload or select an audio file in the Apps Script web app.
2. Apps Script creates the meeting record and dispatches the GitHub workflow.
3. The prepare job downloads the source audio from Drive and splits it into approximately ten-minute chunks.
4. Matrix jobs transcribe each chunk once with faster-whisper, translate timestamped text to English with Ollama, and produce chunk notes.
5. Finalization merges timestamps in chronological order, hierarchically synthesizes the chunk notes, generates the standalone summary, formal MoM and Word document, and uploads outputs to the meeting's Reports folder.
6. Temporary audio chunks and intermediate files are deleted from the temporary Drive folder.
7. The Apps Script callback marks the meeting complete and records output IDs.

## Connection test

Run **Actions → V2 Connection Test → Run workflow**. A passing result checks OAuth refresh, Drive API list access and Apps Script gateway health. It does not prove that a particular audio file can be downloaded or that outputs can be uploaded.

## First demo

Use a short, non-sensitive audio recording first. Confirm the transcript, English translation, summary, MoM, Word file, registry status and temporary-file cleanup before testing a long meeting.
