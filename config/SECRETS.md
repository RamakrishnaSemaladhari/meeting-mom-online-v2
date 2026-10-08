# V2 secrets

Repository secrets:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REFRESH_TOKEN
- MMV2_GATEWAY_URL

Optional variables:
- WHISPER_MODEL = small
- OLLAMA_MODEL = qwen2.5:3b

Never commit credentials or meeting data. Google OAuth offline access uses a refresh token; the Drive API is used to download the source file and upload generated outputs.
