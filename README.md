# Meeting MoM Online V2

Production meeting transcription, translation, summarization and MoM pipeline.

## Architecture

Google Drive remains the system of record. Google Apps Script acts as the gateway and registry controller. GitHub Actions provides ephemeral processing workers. Meeting data is never committed to this repository.

The pipeline downloads a meeting audio file into the temporary runner workspace, splits it into approximately 10-minute segments, processes segments in parallel, merges the results deterministically, generates the final meeting summary/MoM and pushes outputs back to Google Drive through the gateway.
