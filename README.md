# VoiceQA Dashboard

A Vercel-ready voice quality evaluation dashboard based exactly on `Evaluation sample.pdf`.

## Workflow

1. Upload one call recording (MP3, WAV, M4A, WEBM or OGG; max 25 MB) and play it in the dashboard.
2. Transcribe the complete call with the fast Whisper Large v3 Turbo model and show it as soon as it is ready.
3. Translate the transcript to English when needed.
4. Apply all 30 PDF checks in the original 8-section sequence.
5. Review evidence and save the dynamic scorecard to Supabase. N/A checks are excluded from the available maximum.

The speaker transcript is editable: click a speaker label to switch between Agent and Caller, add missing lines, remove incorrect lines and correct the text before saving.

Every QA item score is editable before saving. Manual changes immediately recalculate the section total, overall score, available maximum and percentage while keeping the allowed values for that rubric item.

If Groq cannot satisfy the strict JSON scorecard schema on the first attempt, VoiceQA automatically retries once with deterministic settings and a flexible JSON response, then validates all 30 rubric IDs before displaying results.

## Local setup

Copy `.env.example` to `.env.local` and configure:

- `GROQ_API_KEY` for transcription, translation and evaluation.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for storage and the one-time owner-account setup.
- `QA_ACCESS_KEY` is used only once to authorize creation of the single owner account.

On first launch, select **Set up the owner account**, enter a User ID, a strong password and the existing `QA_ACCESS_KEY`. No email address is required. Once the owner exists, the setup endpoint refuses to create another account. All evaluation API routes require the owner's verified Supabase session, and Row Level Security restricts saved evaluations to that owner.

Apply `supabase/migrations/20260916000000_create_qa_schema.sql` to the chosen Supabase project. Never expose the service-role key in browser code.

Run `npm test` to verify the workbook scoring model. Deploy the repository to Vercel and add the same environment variables to Development, Preview and Production.

## Security notes

- The migration enables RLS on evaluation records and restricts recordings to per-user folders.
- The service-role key is used only in a serverless function.
- Every evaluation endpoint requires a verified Supabase user session; the browser retains it only for the active tab.
- Audio is capped at 25 MB and accepted only as audio input.
- CRM-only checks are marked for manual verification when the call recording cannot establish them.
