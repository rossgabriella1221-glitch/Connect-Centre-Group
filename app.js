import { rubric, flatRubric, fullMaxScore, calculate } from "./lib/rubric.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const SUPABASE_URL = 'https://trbgcgwgbfqbfzsbdhmb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PCl6O_LbLG2DKPbMRhkG-Q_WLOWiHzr';
let selectedFile = null;
let currentTranscript = '';
let latestEvaluation = null;
let audioObjectUrl = null;
let currentUser = null;
let session = JSON.parse(sessionStorage.getItem('voiceqa_session') || 'null');
let authMode = 'signin';
const authHeaders = () => ({ Authorization: `Bearer ${session?.access_token || ''}` });

applyTheme(localStorage.getItem('voiceqa_theme') === 'dark' ? 'dark' : 'light');
initializeAuth();

$('#theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('voiceqa_theme', theme);
  const button = $('#theme-toggle');
  if (!button) return;
  const dark = theme === 'dark';
  button.textContent = dark ? '☀' : '☾';
  button.title = dark ? 'Use light mode' : 'Use dark mode';
  button.setAttribute('aria-label', button.title);
}

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
  loadDashboard();
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

const titles = { dashboard: "VoiceQA Dashboard", new: "New voice evaluation", history: "Evaluation history", rubric: "QA rubric", settings: "Settings" };
$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
function showView(view) {
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach(item => item.classList.toggle('active', item.id === `${view}-view`));
  $('#page-title').textContent = titles[view];
  if (view === 'dashboard') loadDashboard();
  if (view === 'history') loadHistory();
}
$('#brand-home').addEventListener('click', event => { event.preventDefault(); showView('dashboard'); });
$('#dashboard-new-evaluation').addEventListener('click', () => { showView('new'); $('#audio-input').click(); });
$('#dashboard-view-all').addEventListener('click', () => showView('history'));

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
  currentTranscript = '';
  latestEvaluation = null;
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = file ? URL.createObjectURL(file) : null;
  const player = $('#audio-player');
  player.src = audioObjectUrl || '';
  player.classList.toggle('hidden', !file);
  $('#file-chip').classList.toggle('hidden', !file);
  dropzone.classList.toggle('hidden', Boolean(file));
  $('#transcribe-button').disabled = !file;
  $('#transcribe-button span').textContent = 'Transcribe recording';
  $('#grade-button').classList.add('hidden');
  $('#grade-button').disabled = true;
  $('#results').classList.add('hidden');
  $('#live-transcript').classList.add('hidden');
  $('#live-transcript-text').textContent = '';
  $('#transcript-status').textContent = 'Waiting to transcribe';
  setPipeline(0);
  if (file) { $('#file-name').textContent = file.name; $('#file-size').textContent = formatBytes(file.size); setMessage('Click Transcribe recording. You can review the transcript before grading.'); }
  else setMessage('Add a recording to continue.');
}

$('#transcribe-button').addEventListener('click', transcribeRecording);
async function transcribeRecording() {
  if (!selectedFile) return;
  setTranscribeBusy(true);
  try {
    setPipeline(0);
    $('#live-transcript').classList.remove('hidden');
    $('#transcript-status').textContent = 'Transcribing…';
    $('#live-transcript-text').textContent = 'VoiceQA is listening to the recording.';
    const parts = await prepareAudioParts(selectedFile);
    const transcripts = [];
    for (let index = 0; index < parts.length; index += 1) {
      $('#transcript-status').textContent = parts.length > 1 ? `Transcribing part ${index + 1} of ${parts.length}…` : 'Transcribing…';
      $('#live-transcript-text').textContent = parts.length > 1
        ? `VoiceQA is processing the complete recording in ${parts.length} sections.\n\nCompleted ${index} of ${parts.length}.`
        : 'VoiceQA is listening to the recording.';
      const data = new FormData();
      data.set('audio', parts[index].blob, parts[index].name);
      data.set('language', $('#language').value);
      data.set('part', String(index + 1));
      data.set('parts', String(parts.length));
      const transcriptionResponse = await authFetch('/api/transcribe', { method: 'POST', body: data });
      const transcription = await readApiResponse(transcriptionResponse);
      if (!transcriptionResponse.ok) throw new Error(transcription.error || `Transcription failed at part ${index + 1}.`);
      if (transcription.transcript?.trim()) transcripts.push(transcription.transcript.trim());
    }
    currentTranscript = transcripts.join('\n\n');
    if (!currentTranscript) throw new Error('No speech was detected in the recording.');
    $('#transcript-status').textContent = 'Identifying Agent and Caller…';
    $('#live-transcript-text').textContent = currentTranscript;
    const speakerResponse = await requestWithRateLimitRetry('/api/speakers', { transcript: currentTranscript }, 'Speaker identification');
    const speakerPayload = await readApiResponse(speakerResponse);
    if (!speakerResponse.ok) throw new Error(speakerPayload.error || 'Could not identify Agent and Caller.');
    currentTranscript = formatSpeakerTranscript(speakerPayload.transcript);
    $('#live-transcript-text').textContent = currentTranscript;
    $('#transcript-status').textContent = 'Agent and Caller identified';
    setPipeline(1);
    $('#transcribe-button span').textContent = 'Transcribe again';
    $('#grade-button').classList.remove('hidden');
    $('#grade-button').disabled = false;
    setMessage('Transcript ready. Review it, then click Grade scorecard.');
  } catch (error) {
    setPipeline(0);
    setMessage(error.message, true);
  } finally { setTranscribeBusy(false); }
}

async function prepareAudioParts(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return [{ blob: file, name: file.name }];
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration <= 75) return [{ blob: file, name: file.name }];
    const partSeconds = 60;
    const parts = [];
    for (let startSeconds = 0, part = 1; startSeconds < buffer.duration; startSeconds += partSeconds, part += 1) {
      const startFrame = Math.floor(startSeconds * buffer.sampleRate);
      const endFrame = Math.min(buffer.length, Math.floor((startSeconds + partSeconds) * buffer.sampleRate));
      const mono = new Float32Array(endFrame - startFrame);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const source = buffer.getChannelData(channel);
        for (let frame = startFrame; frame < endFrame; frame += 1) mono[frame - startFrame] += source[frame] / buffer.numberOfChannels;
      }
      const speechSamples = resampleAudio(mono, buffer.sampleRate, 16000);
      parts.push({ blob: encodeWav(speechSamples, 16000), name: `${file.name.replace(/\.[^.]+$/, '')}-part-${part}.wav` });
    }
    return parts;
  } catch (error) {
    console.warn('[VoiceQA] Could not split audio; using the original recording.', error);
    return [{ blob: file, name: file.name }];
  } finally {
    await context.close().catch(() => {});
  }
}

function resampleAudio(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return samples;
  const output = new Float32Array(Math.ceil(samples.length * targetRate / sourceRate));
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * ratio;
    const before = Math.floor(sourcePosition);
    const after = Math.min(before + 1, samples.length - 1);
    const weight = sourcePosition - before;
    output[index] = samples[before] * (1 - weight) + samples[after] * weight;
  }
  return output;
}

async function readApiResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch {
    if (response.status === 413) return { error: 'This audio section was too large to upload. Please refresh and try again.' };
    return { error: response.ok ? 'The server returned an unreadable response.' : `The transcription service could not complete this request (${response.status}).` };
  }
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  writeText(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeText(8, 'WAVE');
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeText(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

$('#grade-button').addEventListener('click', gradeScorecard);
async function gradeScorecard() {
  if (!currentTranscript) return setMessage('Transcribe the recording first.', true);
  setGradeBusy(true);
  try {
    setPipeline(1);
    setMessage('Grading the transcript. This may take a little time…');
    const response = await requestEvaluationWithRateLimitRetry(currentTranscript);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Evaluation failed.');
    latestEvaluation = payload;
    renderResults(payload);
    setPipeline(2);
    setMessage('Scorecard ready. Review and edit the scores before saving.');
  } catch (error) {
    setPipeline(1);
    setMessage('The transcript is safe. Grading did not finish—click Grade scorecard to try again.', true);
  } finally { setGradeBusy(false); }
}

async function requestEvaluationWithRateLimitRetry(transcript) {
  return requestWithRateLimitRetry('/api/evaluate', { transcript }, 'Scorecard grading');
}

async function requestWithRateLimitRetry(url, body, activity) {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await authFetch(url, options);
    if (response.status !== 429 || attempt === 2) return response;
    const payload = await response.json().catch(() => ({}));
    const waitSeconds = Math.min(Math.max(Number(payload.retryAfter) || 30, 1), 60);
    await waitForRateLimit(waitSeconds, activity);
  }
}

async function waitForRateLimit(seconds, activity = 'Processing') {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    setMessage(`${activity} is paused while the free allowance resets. Retrying in ${remaining} second${remaining === 1 ? '' : 's'}…`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  setMessage(`Retrying ${activity.toLowerCase()} now…`);
}

function setTranscribeBusy(busy) {
  $('#transcribe-button').disabled = busy || !selectedFile;
  if (busy) $('#grade-button').disabled = true;
  if (busy) $('#transcribe-button span').textContent = 'Transcribing recording…';
  else {
    $('#transcribe-button span').textContent = currentTranscript ? 'Transcribe again' : 'Transcribe recording';
    $('#grade-button').disabled = !currentTranscript;
  }
}
function setGradeBusy(busy) {
  $('#grade-button').disabled = busy;
  $('#transcribe-button').disabled = busy || !selectedFile;
  $('#grade-button span').textContent = busy ? 'Grading scorecard…' : 'Grade scorecard';
}
function setPipeline(index) { const items = $$('.pipeline li'); items.forEach((item, i) => { item.classList.toggle('done', i < index); item.classList.toggle('current', i === index && index < items.length); item.querySelector('span').textContent = i < index ? '✓' : String(i + 1); }); }
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
  setMessage('Evaluation saved. Preparing a clean form for the next call.');
  window.setTimeout(resetEvaluation, 700);
});

function resetEvaluation() {
  latestEvaluation = null;
  currentTranscript = '';
  $('#audio-input').value = '';
  selectFile(null);
  $('#agent').value = '';
  $('#campaign').value = '';
  $('#transaction').value = '';
  $('#language').value = 'auto';
  $('#results').classList.add('hidden');
  $('#section-results').innerHTML = '';
  $('#result-summary').textContent = '';
  $('#detected-language').textContent = '—';
  $('#save-button').textContent = 'Save evaluation';
  setPipeline(0);
  showView('new');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadHistory() {
  const tbody = $('#history-body');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Loading evaluations…</td></tr>';
  try {
    const response = await authFetch('/api/evaluations');
    if (!response.ok) throw new Error();
    const rows = await response.json();
    tbody.innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${escapeHtml(row.agent)}</strong></td><td>${escapeHtml(row.campaign)}</td><td>${escapeHtml(row.transaction_id || '—')}</td><td><strong>${row.score}/${row.max_score}</strong></td><td><strong>${formatPercentage(row.percentage)}</strong></td><td>${escapeHtml(row.status.replace('_',' '))}</td><td>${new Date(row.created_at).toLocaleDateString()}</td><td><button class="delete-evaluation" type="button" data-evaluation-id="${escapeHtml(row.id)}" data-evaluation-label="${escapeHtml(`${row.agent} · ${row.transaction_id || 'No transaction ID'}`)}">Delete</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">No saved evaluations yet.</td></tr>';
  } catch { tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Connect a Supabase project in Settings to load history.</td></tr>'; }
}
$('#refresh-history').addEventListener('click', loadHistory);

$('#history-body').addEventListener('click', async event => {
  const button = event.target.closest('.delete-evaluation');
  if (!button) return;
  if (!window.confirm(`Delete ${button.dataset.evaluationLabel}?\n\nThis cannot be undone.`)) return;
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    const response = await authFetch(`/api/evaluations?id=${encodeURIComponent(button.dataset.evaluationId)}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not delete the evaluation.');
    await Promise.all([loadHistory(), loadDashboard()]);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Delete';
    window.alert(error.message);
  }
});

async function loadDashboard() {
  try {
    const response = await authFetch('/api/evaluations');
    if (!response.ok) throw new Error();
    const rows = await response.json();
    const percentages = rows.map(row => Number(row.percentage)).filter(Number.isFinite);
    const average = percentages.length ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length : null;
    const passed = percentages.filter(value => value >= 85).length;
    $('#dashboard-average').textContent = average === null ? '—' : formatPercentage(average);
    $('#dashboard-count').textContent = String(rows.length);
    $('#dashboard-pass-rate').textContent = percentages.length ? formatPercentage((passed / percentages.length) * 100) : '—';
    $('#dashboard-history').innerHTML = rows.length ? rows.slice(0, 5).map(row => `<tr><td><strong>${escapeHtml(row.agent)}</strong></td><td>${escapeHtml(row.campaign)}</td><td><strong>${formatPercentage(row.percentage)}</strong></td><td><span class="status-pill ${Number(row.percentage) >= 85 ? 'pass' : 'review'}">${Number(row.percentage) >= 85 ? 'Pass' : 'Review required'}</span></td><td>${new Date(row.created_at).toLocaleDateString()}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">No saved evaluations yet.</td></tr>';
    renderDashboardTrend(rows.slice(0, 8).reverse());
  } catch {
    $('#dashboard-average').textContent = '—';
    $('#dashboard-count').textContent = '—';
    $('#dashboard-pass-rate').textContent = '—';
    $('#dashboard-history').innerHTML = '<tr><td colspan="5" class="empty-cell">Could not load saved evaluations.</td></tr>';
    $('#dashboard-trend').innerHTML = '<span class="dashboard-empty">Quality trend is unavailable.</span>';
  }
}

function renderDashboardTrend(rows) {
  const trend = $('#dashboard-trend');
  if (!rows.length) { trend.innerHTML = '<span class="dashboard-empty">No saved evaluations yet.</span>'; return; }
  trend.innerHTML = rows.map(row => { const percentage = Math.max(4, Math.min(100, Number(row.percentage) || 0)); return `<div class="trend-column"><strong>${formatPercentage(row.percentage)}</strong><span style="height:${percentage}%"></span><small>${new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`; }).join('');
}

$('#rubric-list').innerHTML = rubric.map((section, sectionIndex) => `<section class="rubric-section"><h3>${String(sectionIndex + 1).padStart(2,'0')} · ${escapeHtml(section.title)} <span class="section-score">${section.items.length * 5} pts</span></h3><ul>${section.items.map((item, i) => `<li><b>${i + 1}</b><span>${escapeHtml(item.text)}${item.critical ? '<span class="critical-tag">CRITICAL</span>' : ''}</span></li>`).join('')}</ul></section>`).join('');
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#help-close').addEventListener('click', () => $('#help-dialog').close());

function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function formatPercentage(value) { const number = Number(value); return Number.isFinite(number) ? `${Number(number.toFixed(2))}%` : '—'; }
function formatSpeakerTranscript(value = '') { return String(value).trim().replace(/\n+\s*(?=(?:Agent|Caller)\s*-\s*)/g, '\n\n'); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

if (document.modelContext?.registerTool) {
  document.modelContext.registerTool({ name: 'start_voice_qa_evaluation', title: 'Start voice QA evaluation', description: 'Transcribe and grade the recording currently selected in the visible VoiceQA dashboard.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async () => { if (!selectedFile) throw new Error('Select a recording first.'); if (!currentTranscript) await transcribeRecording(); if (currentTranscript) await gradeScorecard(); return { score: latestEvaluation?.score, max: latestEvaluation?.max, percentage: latestEvaluation?.percentage }; } });
}

console.info(`VoiceQA rubric loaded: ${flatRubric.length} checks, ${fullMaxScore} points.`);
