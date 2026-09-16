create policy "No client access to VoiceQA owner"
on public.voiceqa_owners
for all
to authenticated
using (false)
with check (false);
