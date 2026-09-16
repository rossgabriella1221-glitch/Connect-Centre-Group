# VoiceQA Dashboard

A Vercel-ready voice quality evaluation dashboard based exactly on `Evaluation sample.pdf`.

## Workflow

1. Upload one call recording (MP3, WAV, M4A, WEBM or OGG; max 25 MB).
2. Transcribe the call in its original language.
3. Translate the transcript to English when needed.
4. Apply all 30 PDF checks in the original 8-section sequence.
5. Review evidence and save the dynamic scorecard to Supabase. N/A checks are excluded from the available maximum.

## Local setup

Copy `.env.example` to `.env.local` and configure:

- `OPENAI_API_KEY` for transcription, translation and evaluation.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for saving evaluations.
- `QA_ACCESS_KEY` for protecting transcription and evaluation endpoints.

Apply `supabase/migrations/20260916000000_create_qa_schema.sql` to the chosen Supabase project. Never expose the service-role key in browser code.

Run `npm test` to verify the workbook scoring model. Deploy the repository to Vercel and add the same environment variables to Development, Preview and Production.

## Security notes

- The migration enables RLS on evaluation records and restricts recordings to per-user folders.
- The service-role key is used only in a serverless function.
- Every server endpoint requires the dashboard access key; the browser retains it only for the active session.
- Audio is capped at 25 MB and accepted only as audio input.
- CRM-only checks are marked for manual verification when the call recording cannot establish them.
