import { rubric, flatRubric, fullMaxScore, calculate } from "./lib/rubric.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const SUPABASE_URL = 'https://trbgcgwgbfqbfzsbdhmb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PCl6O_LbLG2DKPbMRhkG-Q_WLOWiHzr';
let selectedFile = null;
let latestEvaluation = null;
let audioObjectUrl = null;
let currentUser = null;
let session = JSON.parse(sessionStorage.getItem('voiceqa_session') || 'null');
let authMode = 'signin';
const authHeaders = () => ({ Authorization: `Bearer ${session?.access_token || ''}` });

initializeAuth();

async function initializeAuth() {
  const setup = await fetch('/api/account-setup').then(response => response.json()).catch(() => ({ setupAvailable: false }));
  $('#auth-switch').classList.toggle('hidden', !setup.setupAvailable);
  if (!session) return;
  try {
    await ensureSession();
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, ...authHeaders() } });
    if (!response.ok) throw new Error();
    unlock(await response.json());
  } catch { clearSession(); }
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const userId = normalizeUserId($('#auth-user-id').value);
  const password = $('#auth-password').value;
  $('#auth-submit').disabled = true;
  setAuthMessage(authMode === 'setup' ? 'Creating the owner account…' : 'Signing in…', false);
  try {
    if (authMode === 'setup') {
      const setupResponse = await fetch('/api/account-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password, setupKey: $('#setup-key').value })
      });
      const setupPayload = await setupResponse.json();
      if (!setupResponse.ok) throw new Error(setupPayload.error || 'Could not create the owner account.');
    }
    await signIn(userId, password);
  } catch (error) { setAuthMessage(error.message, true); }
  finally { $('#auth-submit').disabled = false; }
});

$('#auth-switch').addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'setup' : 'signin';
  const setup = authMode === 'setup';
  $('#auth-title').textContent = setup ? 'Set up VoiceQA owner' : 'Sign in to VoiceQA';
  $('#auth-copy').textContent = setup ? 'Create the only account allowed to use this system.' : 'Use the single owner account to access evaluations.';
  $('#setup-key-label').classList.toggle('hidden', !setup);
  $('#setup-key').required = setup;
  $('#auth-password').minLength = setup ? 12 : 8;
  $('#auth-submit span').textContent = setup ? 'Create owner account' : 'Sign in';
  $('#auth-switch').textContent = setup ? 'Return to sign in' : 'Set up the owner account';
  setAuthMessage('', false);
});

$('#sign-out').addEventListener('click', async () => {
  if (session?.access_token) await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, ...authHeaders() } }).catch(() => {});
  clearSession();
});

async function signIn(userId, password) {
  const email = `${normalizeUserId(userId)}@voiceqa.local`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.message || 'Sign-in failed.');
  storeSession(payload);
  unlock(payload.user);
}

async function ensureSession(force = false) {
  if (!session?.refresh_token) throw new Error('Please sign in.');
  if (!force && session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error('Your session expired. Please sign in again.');
  storeSession(payload);
  return session;
}

async function authFetch(url, options = {}) {
  await ensureSession();
  const request = () => fetch(url, { ...options, headers: { ...(options.headers || {}), ...authHeaders() } });
  let response = await request();
  if (response.status === 401) { await ensureSession(true); response = await request(); }
  return response;
}

function storeSession(payload) {
  session = { ...payload, expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + payload.expires_in };
  sessionStorage.setItem('voiceqa_session', JSON.stringify(session));
}

function unlock(user) {
  currentUser = user;
  const userId = user?.app_metadata?.voiceqa_user_id || user?.email?.split('@')[0] || 'Owner';
  $('#user-name').textContent = userId;
  $('#settings-user-email').textContent = userId;
  $('#user-avatar').textContent = userId.slice(0, 2).toUpperCase();
  document.body.classList.remove('auth-locked');
}

function clearSession() {
  session = null;
  currentUser = null;
  sessionStorage.removeItem('voiceqa_session');
  document.body.classList.add('auth-locked');
  $('#auth-password').value = '';
  setAuthMessage('', false);
}

function setAuthMessage(message, error) {
  $('#auth-message').textContent = message;
  $('#auth-message').style.color = error ? 'var(--red)' : 'var(--teal)';
}

function normalizeUserId(value = '') {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
}

const titles = { new: "New voice evaluation", history: "Evaluation history", rubric: "QA rubric", settings: "Settings" };
$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
function showView(view) {
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach(item => item.classList.toggle('active', item.id === `${view}-view`));
  $('#page-title').textContent = titles[view];
  if (view === 'history') loadHistory();
}

const dropzone = $('#dropzone');
$('#audio-input').addEventListener('change', event => selectFile(event.target.files[0]));
['dragenter','dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', event => selectFile(event.dataTransfer.files[0]));
$('#remove-file').addEventListener('click', () => selectFile(null));

function selectFile(file) {
  const valid = !file || file.type.startsWith('audio/') || /\.(mp3|wav|m4a|webm|ogg)$/i.test(file.name);
  if (!valid) return setMessage('Please choose an audio recording.', true);
  if (file?.size > 25 * 1024 * 1024) return setMessage('The recording must be 25 MB or smaller.', true);
  selectedFile = file;
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = file ? URL.createObjectURL(file) : null;
  const player = $('#audio-player');
  player.src = audioObjectUrl || '';
  player.classList.toggle('hidden', !file);
  $('#file-chip').classList.toggle('hidden', !file);
  dropzone.classList.toggle('hidden', Boolean(file));
  $('#evaluate-button').disabled = !file;
  $('#live-transcript').classList.add('hidden');
  $('#live-transcript-text').textContent = '';
  $('#transcript-status').textContent = 'Waiting to transcribe';
  if (file) { $('#file-name').textContent = file.name; $('#file-size').textContent = formatBytes(file.size); setMessage('Listen now, or start the evaluation to generate the transcript.'); }
  else setMessage('Add a recording to continue.');
}

$('#evaluate-button').addEventListener('click', evaluate);
async function evaluate() {
  if (!selectedFile) return;
  setBusy(true);
  try {
    const data = new FormData();
    data.set('audio', selectedFile);
    data.set('language', $('#language').value);
    setPipeline(0);
    $('#live-transcript').classList.remove('hidden');
    $('#transcript-status').textContent = 'Transcribing…';
    $('#live-transcript-text').textContent = 'VoiceQA is listening to the recording.';

    const transcriptionResponse = await authFetch('/api/transcribe', { method: 'POST', body: data });
    const transcription = await transcriptionResponse.json();
    if (!transcriptionResponse.ok) throw new Error(transcription.error || 'Transcription failed.');
    $('#live-transcript-text').textContent = transcription.transcript;
    $('#transcript-status').textContent = 'Transcript ready';
    setPipeline(1);
    setMessage('Transcript ready. Translating and applying the QA rubric…');

    const timers = [setTimeout(() => setPipeline(2), 1200), setTimeout(() => setPipeline(3), 3500)];
    const response = await authFetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcription.transcript })
    });
    timers.forEach(clearTimeout);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Evaluation failed.');
    latestEvaluation = payload;
    renderResults(payload);
    setPipeline(4);
    setMessage('Evaluation complete. Review the evidence before saving.');
  } catch (error) {
    setPipeline(0);
    setMessage(error.message, true);
  } finally { setBusy(false); }
}

function setBusy(busy) {
  $('#evaluate-button').disabled = busy;
  $('#evaluate-button span').textContent = busy ? 'Evaluating recording…' : 'Start evaluation';
}
function setPipeline(index) { $$('.pipeline li').forEach((item, i) => { item.classList.toggle('done', i < index); item.classList.toggle('current', i === index && index < 4); item.querySelector('span').textContent = i < index ? '✓' : String(i + 1); }); }
function setMessage(message, error = false) { $('#form-message').textContent = message; $('#form-message').style.color = error ? 'var(--red)' : ''; }

function renderResults(evaluation) {
  $('#results').classList.remove('hidden');
  renderScoreTotals(evaluation);
  renderScoreSections(evaluation.sections);
  $('#result-summary').textContent = evaluation.summary;
  $('#detected-language').textContent = evaluation.detected_language || 'English';
  const speakerTranscript = formatSpeakerTranscript(evaluation.english_transcript || evaluation.transcript);
  $('#live-transcript-text').textContent = speakerTranscript;
  $('#transcript-status').textContent = 'Speaker labels ready';
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderScoreTotals(evaluation) {
  $('#score-percent').textContent = `${evaluation.percentage}%`;
  $('#score-points').textContent = evaluation.score;
  $('#score-max').textContent = evaluation.max;
  $('.score-ring').style.background = `conic-gradient(var(--teal) ${evaluation.percentage * 3.6}deg,#e5ece9 0deg)`;
  $('#score-status').textContent = evaluation.percentage >= 85 ? 'Meets quality standard' : 'Review required';
}

function renderScoreSections(sections, openIds = new Set([sections[0]?.id])) {
  $('#section-results').innerHTML = sections.map(section => `<details class="result-section" data-section-id="${escapeHtml(section.id)}" ${openIds.has(section.id) ? 'open' : ''}><summary><span class="section-title"><strong>${escapeHtml(section.title)}</strong><small>${section.items.length} checks</small></span><span class="section-score">${section.score} / ${section.max}</span></summary>${section.items.map(item => `<div class="question-row"><div><p>${escapeHtml(item.text)}${item.critical ? '<span class="critical-tag">CRITICAL</span>' : ''}</p></div><label class="question-score-editor"><span class="sr-only">Edit score for ${escapeHtml(item.text)}</span><select class="question-score-select ${item.score === 0 && item.applicable !== false ? 'zero' : ''}" data-score-id="${escapeHtml(item.id)}" aria-label="Edit score for ${escapeHtml(item.text)}">${scoreOptions(item)}</select><b>/5</b></label></div>`).join('')}</details>`).join('');
}

function scoreOptions(item) {
  const values = item.type === 'rating' ? ['1','2','3','4','5'] : item.type === 'documentation' ? ['1','5'] : item.type === 'na' ? ['0','5','na'] : ['0','5'];
  const selected = item.applicable === false ? 'na' : String(item.score);
  return values.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value === 'na' ? 'N/A' : value}</option>`).join('');
}

$('#section-results').addEventListener('change', event => {
  const select = event.target.closest('.question-score-select');
  if (!select || !latestEvaluation) return;
  const openIds = new Set($$('.result-section[open]').map(section => section.dataset.sectionId));
  const results = latestEvaluation.sections.flatMap(section => section.items.map(item => ({
    id: item.id,
    score: item.id === select.dataset.scoreId ? select.value : item.applicable === false ? 'na' : String(item.score),
    comment: item.id === select.dataset.scoreId ? `${item.comment || 'Score reviewed.'} Manual score applied.` : item.comment,
    evidence: item.evidence
  })));
  const revised = calculate(results);
  latestEvaluation = { ...latestEvaluation, ...revised };
  renderScoreTotals(latestEvaluation);
  renderScoreSections(latestEvaluation.sections, openIds);
  $('#save-button').textContent = 'Save evaluation';
  setMessage('Score updated. Save the evaluation to keep this change.');
});

$('#save-button').addEventListener('click', async () => {
  if (!latestEvaluation) return;
  const body = { agent: $('#agent').value.trim(), campaign: $('#campaign').value.trim(), transaction_id: $('#transaction').value.trim(), evaluator: currentUser?.app_metadata?.voiceqa_user_id || 'VoiceQA owner', detected_language: latestEvaluation.detected_language, original_transcript: latestEvaluation.transcript, english_transcript: latestEvaluation.english_transcript, score: latestEvaluation.score, max_score: latestEvaluation.max, percentage: latestEvaluation.percentage, status: latestEvaluation.percentage >= 85 ? 'completed' : 'review_required', summary: latestEvaluation.summary, results: latestEvaluation.sections };
  const response = await authFetch('/api/evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); return setMessage(payload.error || 'Could not save the evaluation.', true); }
  $('#save-button').textContent = 'Saved ✓';
});

async function loadHistory() {
  const tbody = $('#history-body');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Loading evaluations…</td></tr>';
  try {
    const response = await authFetch('/api/evaluations');
    if (!response.ok) throw new Error();
    const rows = await response.json();
    tbody.innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${escapeHtml(row.agent)}</strong></td><td>${escapeHtml(row.campaign)}</td><td>${escapeHtml(row.transaction_id || '—')}</td><td><strong>${row.score}/${row.max_score}</strong></td><td>${escapeHtml(row.status.replace('_',' '))}</td><td>${new Date(row.created_at).toLocaleDateString()}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">No saved evaluations yet.</td></tr>';
  } catch { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Connect a Supabase project in Settings to load history.</td></tr>'; }
}
$('#refresh-history').addEventListener('click', loadHistory);

$('#rubric-list').innerHTML = rubric.map((section, sectionIndex) => `<section class="rubric-section"><h3>${String(sectionIndex + 1).padStart(2,'0')} · ${escapeHtml(section.title)} <span class="section-score">${section.items.length * 5} pts</span></h3><ul>${section.items.map((item, i) => `<li><b>${i + 1}</b><span>${escapeHtml(item.text)}${item.critical ? '<span class="critical-tag">CRITICAL</span>' : ''}</span></li>`).join('')}</ul></section>`).join('');
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#help-close').addEventListener('click', () => $('#help-dialog').close());

function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function formatSpeakerTranscript(value = '') { return String(value).trim().replace(/\n+\s*(?=(?:Agent|Caller)\s*-\s*)/g, '\n\n'); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

if (document.modelContext?.registerTool) {
  document.modelContext.registerTool({ name: 'start_voice_qa_evaluation', title: 'Start voice QA evaluation', description: 'Start evaluating the recording currently selected in the visible VoiceQA dashboard.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async () => { if (!selectedFile) throw new Error('Select a recording first.'); await evaluate(); return { score: latestEvaluation?.score, max: latestEvaluation?.max, percentage: latestEvaluation?.percentage }; } });
}

console.info(`VoiceQA rubric loaded: ${flatRubric.length} checks, ${fullMaxScore} points.`);
