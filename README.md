# VoiceQA Dashboard

A Vercel-ready voice quality evaluation dashboard based exactly on `Evaluation sample.pdf`.

## Workflow

1. Upload one call recording (MP3, WAV, M4A, WEBM or OGG; max 25 MB), play it when needed and enter the call details.
2. Select **Grade scorecard**. VoiceQA processes the recording privately, translates when needed and applies all 30 PDF checks in the original 8-section sequence. The transcript is not displayed.
3. Review and save only the dynamic scorecard to Supabase. The temporary transcript is neither displayed nor included in new saved evaluations. N/A checks are excluded from the available maximum. If grading fails after the recording has been processed, VoiceQA can retry grading without processing the audio again.

The completed scorecard focuses on QA questions and editable scores. The separate English speaker transcript editing panel is not displayed.

Every QA item score is editable before saving. Manual changes immediately recalculate the section total, overall score, available maximum and percentage while keeping the allowed values for that rubric item.

The visible scorecard shows only each rubric question and its editable score. AI comments and transcript evidence are retained in the evaluation data but hidden from the scorecard.

Each completed scorecard includes a concise call evaluation summary covering the caller's reason, the agent's strongest performance, the main improvement needed and the overall QA outcome.

Evaluation history displays both the points score and the saved QA percentage.

The header includes a light/dark mode switch. The selected appearance is remembered on the device.

VoiceQA requests a marker-based plain-text evaluation, parses and validates all 30 rubric IDs itself, and retries once only when the returned content is incomplete. This avoids provider-side JSON validation failures on longer calls.

When Groq's free tokens-per-minute allowance is temporarily exhausted, the dashboard shows a countdown and retries the evaluation automatically after the provider's reset time.

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
- The Calm Modern dashboard summarizes average QA, pass rate, recent evaluations and quality trends.
- After an evaluation is saved, the new-evaluation form resets automatically for the next call.
- Evaluation History includes an owner-only Delete action with confirmation for removing accidental duplicate entries.
