import { rubric, flatRubric, fullMaxScore, calculate } from "./lib/rubric.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let selectedFile = null;
let latestEvaluation = null;
const accessKeyInput = $('#access-key');
accessKeyInput.value = sessionStorage.getItem('voiceqa_access_key') || '';
accessKeyInput.addEventListener('change', () => sessionStorage.setItem('voiceqa_access_key', accessKeyInput.value));
const authHeaders = () => ({ Authorization: `Bearer ${accessKeyInput.value}` });

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
  $('#file-chip').classList.toggle('hidden', !file);
  dropzone.classList.toggle('hidden', Boolean(file));
  $('#evaluate-button').disabled = !file;
  if (file) { $('#file-name').textContent = file.name; $('#file-size').textContent = formatBytes(file.size); setMessage('Ready to transcribe and score.'); }
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
    const request = fetch('/api/evaluate', { method: 'POST', headers: authHeaders(), body: data });
    const timers = [setTimeout(() => setPipeline(1), 1800), setTimeout(() => setPipeline(2), 3800), setTimeout(() => setPipeline(3), 6500)];
    const response = await request;
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
  $('#score-percent').textContent = `${evaluation.percentage}%`;
  $('#score-points').textContent = evaluation.score;
  $('#score-max').textContent = evaluation.max;
  $('.score-ring').style.background = `conic-gradient(var(--teal) ${evaluation.percentage * 3.6}deg,#e5ece9 0deg)`;
  $('#score-status').textContent = evaluation.percentage >= 85 ? 'Meets quality standard' : 'Review required';
  $('#result-summary').textContent = evaluation.summary;
  $('#detected-language').textContent = evaluation.detected_language || 'English';
  $('#transcript').textContent = evaluation.english_transcript || evaluation.transcript;
  $('#section-results').innerHTML = evaluation.sections.map((section, index) => `<details class="result-section" ${index === 0 ? 'open' : ''}><summary><span class="section-title"><strong>${escapeHtml(section.title)}</strong><small>${section.items.length} checks</small></span><span class="section-score">${section.score} / ${section.max}</span></summary>${section.items.map(item => `<div class="question-row"><div><p>${escapeHtml(item.text)}${item.critical ? '<span class="critical-tag">CRITICAL</span>' : ''}</p><small>${escapeHtml(item.comment || 'No comment')} ${item.evidence ? `· “${escapeHtml(item.evidence)}”` : ''}</small></div><span class="question-score ${item.score === 0 ? 'zero' : ''}">${item.score}/5</span></div>`).join('')}</details>`).join('');
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#save-button').addEventListener('click', async () => {
  if (!latestEvaluation) return;
  const body = { agent: $('#agent').value.trim(), campaign: $('#campaign').value.trim(), transaction_id: $('#transaction').value.trim(), evaluator: 'Harris Ross', detected_language: latestEvaluation.detected_language, original_transcript: latestEvaluation.transcript, english_transcript: latestEvaluation.english_transcript, score: latestEvaluation.score, max_score: latestEvaluation.max, percentage: latestEvaluation.percentage, status: latestEvaluation.percentage >= 85 ? 'completed' : 'review_required', summary: latestEvaluation.summary, results: latestEvaluation.sections };
  const response = await fetch('/api/evaluations', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); return setMessage(payload.error || 'Could not save the evaluation.', true); }
  $('#save-button').textContent = 'Saved ✓';
});

async function loadHistory() {
  const tbody = $('#history-body');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Loading evaluations…</td></tr>';
  try {
    const response = await fetch('/api/evaluations', { headers: authHeaders() });
    if (!response.ok) throw new Error();
    const rows = await response.json();
    tbody.innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${escapeHtml(row.agent)}</strong></td><td>${escapeHtml(row.campaign)}</td><td>${escapeHtml(row.transaction_id || '—')}</td><td><strong>${row.score}/${row.max_score}</strong></td><td>${escapeHtml(row.status.replace('_',' '))}</td><td>${new Date(row.created_at).toLocaleDateString()}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">No saved evaluations yet.</td></tr>';
  } catch { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Connect a Supabase project in Settings to load history.</td></tr>'; }
}
$('#refresh-history').addEventListener('click', loadHistory);

$('#rubric-list').innerHTML = rubric.map((section, sectionIndex) => `<section class="rubric-section"><h3>${String(sectionIndex + 1).padStart(2,'0')} · ${escapeHtml(section.title)} <span class="section-score">${section.items.length * 5} pts</span></h3><ul>${section.items.map((item, i) => `<li><b>${i + 1}</b><span>${escapeHtml(item.text)}${item.critical ? '<span class="critical-tag">CRITICAL</span>' : ''}</span></li>`).join('')}</ul></section>`).join('');
$('#copy-transcript').addEventListener('click', async () => { await navigator.clipboard.writeText($('#transcript').textContent); $('#copy-transcript').textContent = 'Copied'; setTimeout(() => $('#copy-transcript').textContent = 'Copy', 1200); });
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#help-close').addEventListener('click', () => $('#help-dialog').close());

function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

if (document.modelContext?.registerTool) {
  document.modelContext.registerTool({ name: 'start_voice_qa_evaluation', title: 'Start voice QA evaluation', description: 'Start evaluating the recording currently selected in the visible VoiceQA dashboard.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async () => { if (!selectedFile) throw new Error('Select a recording first.'); await evaluate(); return { score: latestEvaluation?.score, max: latestEvaluation?.max, percentage: latestEvaluation?.percentage }; } });
}

console.info(`VoiceQA rubric loaded: ${flatRubric.length} checks, ${fullMaxScore} points.`);
