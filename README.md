# Meeting MoM Online V2

Production meeting transcription, translation, summarization and MoM pipeline.

## Architecture

Google Drive remains the system of record. Google Apps Script acts as the gateway and registry controller. GitHub Actions provides ephemeral processing workers. Meeting data is never committed to this repository.

The pipeline downloads a meeting audio file into the temporary runner workspace, splits it into approximately 10-minute segments, processes segments in parallel, merges the results deterministically, generates the final meeting summary/MoM and pushes outputs back to Google Drive through the gateway.


## Meeting output contract (V2)

A meeting is only complete when the Drive registry contains non-empty transcript, English translation, independent full-meeting summary, formal MoM, formatted Word document, and manifest. The UI exposes editable text outputs, copy and text-download controls, Drive save, and Word download with optional Drive save.

Meeting metadata includes type, subtype, and workflow stage. Legal stages are Case Analysis, Document Verification, and Legal Drafting. The processing manifest records per-chunk transcription/translation timings so performance can be measured rather than estimated from audio length alone.

The source validation workflow checks Apps Script JavaScript syntax and Python source compilation on pushes to main.

Source validation was also exercised after the latest UI change; the validation workflow checks the Apps Script source-string syntax and Python modules.

Validated the UI template escaping after restoring the meeting-type helper.

Source template escape checks are part of the current validation cycle.
