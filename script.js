(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Landmark = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const DEFAULTS = Object.freeze({ cycles: 6, instructionMs: 4000, stimulusMs: 1600, isiMs: 200, restMs: 21600, linePx: 600, verticalPx: 40, strokePx: 2, gapPx: 8, keys: { yes: 'KeyF', no: 'KeyD' } });
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(values, random) {
    const a = values.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function createPlan(config, seed) {
    const random = rng(seed), phases = [], trials = [];
    let planned = 0;
    const add = (phase) => { phases.push({ ...phase, plannedOnsetMs: planned }); planned += phase.durationMs; };
    for (let cycle = 1; cycle <= config.cycles; cycle++) {
      for (const condition of ['LM', 'LMC']) {
        const block = (cycle - 1) * 3 + (condition === 'LM' ? 1 : 2);
        const context = { condition, cycle, block };
        add({ ...context, type: 'instruction', durationMs: config.instructionMs });
        const offsets = [0, 0, 0, 0, 0, 0, -0.025, 0.025, -0.05, 0.05, -0.075, 0.075];
        let deck;
        if (condition === 'LM') deck = offsets.map(offset => ({ offset, contact: true, expected: offset === 0 ? 'yes' : 'no' }));
        else {
          // Each contact condition has three central and three displaced stimuli.
          const shifted = shuffle([-0.025, 0.025, -0.05, 0.05, -0.075, 0.075], random);
          deck = [true, false].flatMap((contact, index) => [0, 0, 0, ...shifted.slice(index * 3, index * 3 + 3)].map(offset => ({ offset, contact, expected: contact ? 'yes' : 'no' })));
        }
        shuffle(deck, random).forEach((stimulus, index) => {
          const trial = { ...context, ...stimulus, number: trials.length + 1, withinBlock: index + 1 };
          trials.push(trial);
          add({ ...context, type: 'stimulus', durationMs: config.stimulusMs, trial });
          add({ ...context, type: 'isi', durationMs: config.isiMs });
        });
      }
      add({ type: 'rest', condition: 'Rest', cycle, block: cycle * 3, durationMs: config.restMs });
    }
    return { phases, trials, plannedDurationMs: planned };
  }
  class Session {
    constructor(config, seed, participant, timeOrigin, onChange = () => {}) {
      this.config = { ...DEFAULTS, ...config };
      this.seed = seed >>> 0;
      this.participant = participant;
      this.id = 'LM-' + new Date(timeOrigin).toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + this.seed.toString(16).slice(0, 6);
      this.version = VERSION; this.timeOrigin = timeOrigin;
      this.plan = createPlan(this.config, this.seed);
      this.rows = []; this.events = []; this.index = -1; this.state = 'ready'; this.onChange = onChange;
      this.startMs = null; this.endMs = null; this.active = null; this.currentRow = null;
      this.pausedTotalMs = 0; this.finishedBlocks = 0;
    }
    timestamp(now) { return new Date(this.timeOrigin + now).toISOString(); }
    event(type, now, extra = {}) { this.events.push({ session_id: this.id, participant_id: this.participant, event: type, timestamp: this.timestamp(now), elapsed_ms: this.startMs === null ? 0 : +(now - this.startMs).toFixed(3), condition: this.active?.condition || '', block: this.active?.block || '', phase: this.active?.type || '', ...extra }); }
    start(now) { if (this.state !== 'ready') return; this.startMs = now; this.state = 'running'; this.event('session_start', now); this.enter(0, now); }
    enter(index, now) {
      if (index >= this.plan.phases.length) { this.state = 'completed'; this.endMs = now; this.active = null; this.event('session_end', now); this.onChange('end'); return; }
      this.index = index; this.active = this.plan.phases[index]; this.phaseStart = now; this.deadline = now + this.active.durationMs;
      this.event('phase_start', now, { planned_onset_ms: this.active.plannedOnsetMs, planned_duration_ms: this.active.durationMs, onset_delay_ms: +(now - this.startMs - this.active.plannedOnsetMs).toFixed(3) });
      if (this.active.type === 'stimulus') {
        const t = this.active.trial;
        this.currentRow = { session_id: this.id, participant_id: this.participant, condition: t.condition, cycle: t.cycle, block: t.block, trial_in_block: t.withinBlock, trial_number: t.number, offset_ratio: t.offset, offset_direction: t.offset < 0 ? 'left' : t.offset > 0 ? 'right' : 'center', contact: t.contact, expected_answer: t.expected, response: '', response_key: '', correct: null, rt_ms: null, onset_timestamp: this.timestamp(now), onset_elapsed_ms: +(now - this.startMs).toFixed(3), planned_onset_ms: this.active.plannedOnsetMs, offset_timestamp: '', offset_elapsed_ms: null, actual_display_ms: null, response_timestamp: '', interrupted: false, interruption_reasons: '', status: 'pending' };
        this.stimulusStart = now; this.stimulusPausedMs = 0;
      }
      this.onChange('phase');
    }
    closePhase(now, aborted = false) {
      if (!this.active) return;
      this.event('phase_end', now, { actual_duration_ms: +(now - this.phaseStart).toFixed(3), aborted });
      if (this.active.type === 'stimulus' && this.currentRow) {
        const row = this.currentRow;
        row.offset_timestamp = this.timestamp(now); row.offset_elapsed_ms = +(now - this.startMs).toFixed(3);
        row.actual_display_ms = +(now - this.stimulusStart - this.stimulusPausedMs).toFixed(3);
        row.status = aborted ? 'aborted' : row.response ? 'answered' : 'no_response';
        if (aborted) { row.interrupted = true; row.interruption_reasons += (row.interruption_reasons ? ';' : '') + 'abort'; }
        this.rows.push(row); this.currentRow = null;
      }
      const next = this.plan.phases[this.index + 1];
      if (!aborted && (!next || next.block !== this.active.block)) this.finishedBlocks++;
    }
    tick(now) {
      if (this.state !== 'running') return;
      if (now >= this.deadline) { this.closePhase(now); this.enter(this.index + 1, now); }
    }
    answer(key, now) {
      if (this.state !== 'running' || this.active?.type !== 'stimulus' || now >= this.deadline || !this.currentRow || this.currentRow.response) return false;
      const response = key === this.config.keys.yes ? 'yes' : key === this.config.keys.no ? 'no' : null;
      if (!response) return false;
      const row = this.currentRow;
      row.response = response; row.response_key = key; row.correct = response === row.expected_answer;
      row.rt_ms = +(now - this.stimulusStart).toFixed(3); row.response_timestamp = this.timestamp(now);
      this.event('answer', now, { trial_number: row.trial_number, response, key }); this.onChange('answer'); return true;
    }
    pause(now, reason) {
      if (this.state !== 'running') return;
      this.tick(now);
      if (this.state !== 'running') return;
      this.remaining = Math.max(0, this.deadline - now); this.pauseMs = now; this.state = 'paused';
      if (this.currentRow) { this.currentRow.interrupted = true; this.currentRow.interruption_reasons += (this.currentRow.interruption_reasons ? ';' : '') + reason; }
      this.event('pause', now, { reason }); this.onChange('pause');
    }
    resume(now) {
      if (this.state !== 'paused') return;
      const paused = now - this.pauseMs; this.pausedTotalMs += paused;
      if (this.currentRow) this.stimulusPausedMs += paused;
      this.deadline = now + this.remaining; this.state = 'running'; this.event('resume', now, { pause_duration_ms: +paused.toFixed(3) }); this.onChange('resume');
    }
    abort(now, reason = 'user') {
      if (!['running', 'paused'].includes(this.state)) return;
      if (this.state === 'paused') { const paused = now - this.pauseMs; this.pausedTotalMs += paused; if (this.currentRow) this.stimulusPausedMs += paused; }
      this.closePhase(now, true); this.state = 'aborted'; this.endMs = now; this.event('session_abort', now, { reason }); this.active = null; this.onChange('end');
    }
    snapshot() {
      return { version: this.version, session_id: this.id, participant_id: this.participant, seed: this.seed, config: this.config, state: this.state, started_at: this.startMs === null ? null : this.timestamp(this.startMs), ended_at: this.endMs === null ? null : this.timestamp(this.endMs), paused_total_ms: this.pausedTotalMs, finished_blocks: this.finishedBlocks, planned_duration_ms: this.plan.plannedDurationMs, trial_order: this.plan.trials, rows: this.rows.map(r => ({ ...r })), events: this.events.map(e => ({ ...e })), current_trial: this.currentRow ? { ...this.currentRow } : null };
    }
  }
  function summarize(rows, condition) {
    const all = rows.filter(r => !condition || r.condition === condition);
    const valid = all.filter(r => !r.interrupted && r.status !== 'aborted' && r.status !== 'pending');
    const correct = valid.filter(r => r.correct === true), wrong = valid.filter(r => r.response && r.correct === false), missing = valid.filter(r => !r.response);
    const times = correct.map(r => r.rt_ms).filter(t => Number.isFinite(t)).sort((a,b) => a-b);
    const median = times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null;
    return { total: all.length, valid: valid.length, excluded: all.length - valid.length, correct: correct.length, wrong: wrong.length, missing: missing.length, accuracy: valid.length ? correct.length / valid.length * 100 : null, mean: times.length ? times.reduce((a,b) => a+b, 0) / times.length : null, median };
  }
  function csv(rows, columns) {
    const keys = columns || [...new Set(rows.flatMap(row => Object.keys(row)))];
    // Prevent user-entered participant IDs from becoming spreadsheet formulas.
    const cell = value => { let s = value === null || value === undefined ? '' : String(value); if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n');
  }
  return { VERSION, DEFAULTS, createPlan, Session, summarize, csv };
});

(() => {
  'use strict';
  const { DEFAULTS, Session, summarize, csv, VERSION } = Landmark;
  const $ = id => document.getElementById(id);
  const STORAGE = 'landmark-cai-session-v1', SETTINGS = 'landmark-cai-settings-v1';
  const labels = { LM: '中央判断', LMC: '接触判断', Rest: '安静' };
  let engine = null, report = null, animation = 0, toastTimer, abortWasRunning = false, lastCountdown = null;
  let config = { ...DEFAULTS, linePx: Math.min(600, Math.max(240, Math.floor((innerWidth - 110) / 10) * 10)), viewingDistanceCm: null, measuredLineCm: null };
  const held = new Set();
  const readStorage = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const writeStorage = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const storedConfig = readStorage(SETTINGS);
  if (storedConfig && [1,3,6].includes(storedConfig.cycles) && Number.isFinite(storedConfig.linePx)) config = { ...config, ...storedConfig, ...DEFAULTS, cycles: storedConfig.cycles, linePx: Math.max(240, Math.min(900, storedConfig.linePx)), viewingDistanceCm: storedConfig.viewingDistanceCm, measuredLineCm: storedConfig.measuredLineCm };
  let cached = readStorage(STORAGE);
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
  function showPage(page) { for (const id of ['home','run','results']) $(id).hidden = id !== page; if (page !== 'run') window.scrollTo(0,0); }
  const formatTime = milliseconds => { const s = Math.ceil(milliseconds / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const number = (value, decimals = 0) => value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals);
  function updateHome() {
    $('home-trial-count').textContent = config.cycles * 24;
    $('home-cycle-count').textContent = config.cycles;
    $('home-duration').textContent = formatTime(config.cycles * 72800);
    const supported = innerWidth >= 500 && !matchMedia('(pointer: coarse)').matches;
    $('device-note').textContent = supported ? 'PC のキーボードをご使用ください．' : 'PC とキーボードでの体験を推奨します．';
  }
  function loadSettings() {
    $('cycles').value = config.cycles; $('line-length').value = config.linePx;
    $('distance').value = config.viewingDistanceCm || ''; $('measured-length').value = config.measuredLineCm || '';
    previewSettings();
  }
  function previewSettings() {
    const line = Number($('line-length').value);
    $('line-length-value').textContent = line + ' px';
    $('calibration-preview').firstElementChild.style.width = line + 'px';
    const d = Number($('distance').value), length = Number($('measured-length').value);
    $('visual-angle').textContent = d > 0 && length > 0 ? '視角の目安：' + (2 * Math.atan(length / (2 * d)) * 180 / Math.PI).toFixed(2) + '°' : '距離と実寸を入力すると，視角の目安を表示します．';
  }
  $('settings-open').addEventListener('click', () => { loadSettings(); $('settings-dialog').showModal(); });
  $('protocol-open').addEventListener('click', () => $('protocol-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  for (const id of ['line-length','distance','measured-length']) $(id).addEventListener('input', previewSettings);
  $('settings-save').addEventListener('click', () => {
    if (!$('distance').checkValidity() || !$('measured-length').checkValidity()) { $('distance').reportValidity(); $('measured-length').reportValidity(); return; }
    config = { ...config, cycles: Number($('cycles').value), linePx: Number($('line-length').value), viewingDistanceCm: Number($('distance').value) || null, measuredLineCm: Number($('measured-length').value) || null };
    writeStorage(SETTINGS, config); updateHome(); $('settings-dialog').close();
  });
  function checkpoint() {
    if (!engine) return;
    cached = engine.snapshot();
    if (!writeStorage(STORAGE, cached) && !engine.storageWarned) { engine.storageWarned = true; toast('ブラウザ内への保存ができません．終了後に記録をダウンロードしてください．'); }
  }
  function drawStimulus(trial) {
    const w = engine.config.linePx, vertical = engine.config.verticalPx, y = 130, x = 40 + w * (0.5 + trial.offset);
    let y1, y2;
    if (trial.condition === 'LM') { y1 = y - vertical / 2; y2 = y + vertical / 2; }
    else { y2 = y - (trial.contact ? 0 : engine.config.gapPx); y1 = y2 - vertical; }
    const svg = $('stimulus');
    svg.setAttribute('viewBox', `0 0 ${w + 80} 260`); svg.style.width = (w + 80) + 'px';
    svg.replaceChildren();
    for (const coords of [[40,y,40+w,y], [x,y1,x,y2]]) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ['x1','y1','x2','y2'].forEach((key,index) => line.setAttribute(key, coords[index]));
      line.setAttribute('stroke','currentColor'); line.setAttribute('stroke-width',engine.config.strokePx); line.setAttribute('stroke-linecap','butt'); svg.appendChild(line);
    }
  }
  function renderPhase() {
    const phase = engine.active;
    for (const id of ['instruction-view','stimulus-view','rest-view','paused-view']) $(id).hidden = true;
    if (engine.state === 'paused') {
      $('paused-view').hidden = false; $('run-hint').textContent = ''; $('run-remaining').textContent = '記録を保持しています'; $('pause').hidden = true;
      return;
    }
    if (!phase) return;
    $('pause').hidden = false; $('run-condition').textContent = phase.condition; $('run-label').textContent = labels[phase.condition];
    $('run-counter').textContent = `${phase.cycle} / ${engine.config.cycles} セット`;
    $('run-hint').textContent = phase.condition === 'Rest' ? '＋を見て，回答せずに休んでください' : '左手：F はい / D いいえ';
    if (phase.type === 'instruction') {
      $('instruction-view').hidden = false;
      $('instruction-caption').textContent = `SET ${String(phase.cycle).padStart(2,'0')} / ${phase.condition}`;
      $('instruction-title').textContent = phase.condition === 'LM' ? '縦線は，中央にありますか？' : '縦線は，水平線に接触していますか？';
      $('instruction-subtitle').textContent = '続けて 12 問を表示します．左手で回答してください．';
      $('yes-label').textContent = phase.condition === 'LM' ? '中央にある' : '接触している';
      $('no-label').textContent = phase.condition === 'LM' ? '中央にない' : '接触していない';
      lastCountdown = null;
    } else if (phase.type === 'stimulus') { drawStimulus(phase.trial); $('stimulus-view').hidden = false; }
    else if (phase.type === 'rest') $('rest-view').hidden = false;
  }
  function change(kind) {
    checkpoint();
    if (kind === 'end') { cancelAnimationFrame(animation); report = engine.snapshot(); renderResults(report); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return; }
    if (kind !== 'answer') renderPhase();
  }
  function frame(now) {
    if (!engine || !['running','paused'].includes(engine.state)) return;
    engine.tick(now);
    if (engine.state === 'running') {
      const phase = engine.active;
      if (phase?.type === 'instruction') { const remaining = Math.ceil(Math.max(0, engine.deadline - now) / 1000); if (remaining !== lastCountdown) { $('instruction-countdown').textContent = remaining + ' 秒後に開始'; lastCountdown = remaining; } }
      const progressed = phase ? phase.plannedOnsetMs + Math.min(phase.durationMs, Math.max(0, phase.durationMs - (engine.deadline - now))) : engine.plan.plannedDurationMs;
      $('run-progress-fill').style.width = Math.min(100, progressed / engine.plan.plannedDurationMs * 100) + '%';
      $('run-remaining').textContent = '残りの目安 ' + formatTime(Math.max(0,engine.plan.plannedDurationMs - progressed));
    }
    if (['running','paused'].includes(engine.state)) animation = requestAnimationFrame(frame);
  }
  $('start').addEventListener('click', async () => {
    if (engine && ['running','paused'].includes(engine.state)) return;
    $('start').disabled = true;
    if ($('fullscreen').checked && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch { toast('全画面にできなかったため，通常表示で開始します．'); }
    }
    if (config.linePx + 80 > innerWidth) { $('start').disabled = false; toast('水平線が画面に収まりません．表示設定で長さを短くしてください．'); return; }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const participant = $('participant').value.trim() || 'anonymous';
    const runConfig = { ...config, viewportWidth: innerWidth, viewportHeight: innerHeight, devicePixelRatio, browser: navigator.userAgent, fullscreen: !!document.fullscreenElement };
    engine = new Session(runConfig, seed, participant, performance.timeOrigin, change);
    held.clear(); showPage('run'); $('run-progress-fill').style.width = '0%';
    requestAnimationFrame(now => { engine.start(now); animation = requestAnimationFrame(frame); });
    $('start').disabled = false;
  });
  document.addEventListener('keydown', event => {
    if (!engine || !['running','paused'].includes(engine.state) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyF' || event.code === 'KeyD') {
      event.preventDefault(); if (event.repeat || held.has(event.code)) return; held.add(event.code);
      if (!$('abort-dialog').open) engine.answer(event.code, performance.now());
    }
  });
  document.addEventListener('keyup', event => held.delete(event.code));
  function pause(reason, text) {
    if (engine?.state !== 'running') return;
    $('pause-reason').textContent = text; engine.pause(performance.now(),reason); held.clear();
  }
  $('pause').addEventListener('click', () => pause('manual', '再開すると，残りの時間から続きます．'));
  $('resume').addEventListener('click', () => { held.clear(); engine?.resume(performance.now()); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('tab_hidden', 'タブが非表示になったため，一時停止しました．'); });
  window.addEventListener('blur', () => pause('window_blur', '画面からフォーカスが外れたため，一時停止しました．'));
  window.addEventListener('resize', () => { updateHome(); pause('viewport_resize', '表示サイズが変わったため，一時停止しました．'); });
  document.addEventListener('fullscreenchange', () => { if (engine?.state === 'running' && !document.fullscreenElement) pause('fullscreen_exit', '全画面表示を終了したため，一時停止しました．'); });
  $('abort').addEventListener('click', () => { abortWasRunning = engine?.state === 'running'; pause('abort_dialog','中止操作の確認中です．'); $('abort-dialog').showModal(); });
  $('cancel-abort').addEventListener('click', () => $('abort-dialog').close());
  $('confirm-abort').addEventListener('click', () => { engine.abort(performance.now()); $('abort-dialog').close(); });
  $('abort-dialog').addEventListener('close', () => { if (abortWasRunning && engine?.state === 'paused') engine.resume(performance.now()); });
  window.addEventListener('beforeunload', event => { if (engine && ['running','paused'].includes(engine.state)) { checkpoint(); event.preventDefault(); event.returnValue = ''; } });
  function card(condition, rows) {
    const s = summarize(rows,condition), article = document.createElement('article'); article.className = 'score-card';
    const div = (cls,text) => { const el = document.createElement('div'); el.className = cls; if (text) el.textContent = text; return el; };
    const heading = div('score-card-heading'), tag = document.createElement('span'), title = document.createElement('h2'); tag.className = 'condition-tag'; tag.textContent = condition; title.textContent = labels[condition]; heading.append(tag,title);
    const value = div('score-value'), n = document.createElement('strong'), unit = document.createElement('span'); n.textContent = number(s.accuracy,1); unit.textContent = '%'; value.append(n,unit);
    const bar = div('score-bar'), fill = div(''); fill.style.width = (s.accuracy || 0) + '%'; bar.append(fill);
    const stats = div('score-stats');
    for (const [name,val] of [['平均 RT', number(s.mean)+' ms'],['中央値 RT',number(s.median)+' ms'],['正答 / 有効試行',s.correct+' / '+s.valid]]) { const group = div(''), label = document.createElement('span'), v = document.createElement('b'); label.textContent = name; v.textContent = val; group.append(label,v); stats.append(group); }
    const foot = document.createElement('p'); foot.className = 'score-foot'; foot.textContent = `誤答 ${s.wrong} 問 · 無回答 ${s.missing} 問 · 中断等による除外 ${s.excluded} 問`;
    article.append(heading,value,bar,stats,foot); return article;
  }
  function renderResults(data) {
    report = data; showPage('results');
    const completed = data.state === 'completed';
    $('result-title').textContent = completed ? 'おつかれさまでした．' : 'ここまでの記録です．';
    $('result-status').textContent = completed ? '本番完了' : data.state === 'aborted' ? '中止' : '中断した記録';
    const expected = data.config.cycles * 24;
    $('result-subtitle').textContent = `参加者 ${data.participant_id} · 記録 ${data.rows.length} / ${expected} 問 · 完了ブロック ${data.finished_blocks || 0} / ${data.config.cycles * 3}`;
    $('result-cards').replaceChildren(card('LM',data.rows),card('LMC',data.rows));
    const table = $('detail-body'); table.replaceChildren();
    for (const [name,offset] of [['中央',0],['左 2.5 %',-.025],['右 2.5 %',.025],['左 5.0 %',-.05],['右 5.0 %',.05],['左 7.5 %',-.075],['右 7.5 %',.075]]) {
      const s = summarize(data.rows.filter(r => r.condition === 'LM' && r.offset_ratio === offset));
      const tr = document.createElement('tr');
      for (const text of [name,s.valid,number(s.accuracy,1)+(s.accuracy === null ? '' : ' %'),number(s.mean)+(s.mean === null ? '' : ' ms')]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      table.append(tr);
    }
    const overall = summarize(data.rows), interruptions = data.events.filter(e => e.event === 'pause').length;
    $('result-note').textContent = `正答率＝正答数 ÷ 有効試行数．無回答を分母に含めます．刺激表示中に中断した問題と途中で中止した問題は除外します（${overall.excluded} 問）．一時停止 ${interruptions} 回．` + (data.config.cycles < 6 ? '今回は短縮体験です．' : '') + ' この成績から脳活動の左右差を判定することはできません．';
    $('download-trials').disabled = data.rows.length === 0;
  }
  function download(content, type, suffix) {
    if (!report) return;
    const blob = new Blob([content],{ type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = report.session_id + '_' + suffix; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('記録をダウンロードしました．');
  }
  $('download-trials').addEventListener('click', () => download(csv(report.rows),'text/csv;charset=utf-8','trials.csv'));
  $('download-events').addEventListener('click', () => download(csv(report.events),'text/csv;charset=utf-8','events.csv'));
  $('download-json').addEventListener('click', () => download(JSON.stringify({ ...report, protocol: { citation: 'Cai et al. (2013)', doi: '10.1073/pnas.1212956110', url: 'https://doi.org/10.1073/pnas.1212956110', appDefined: ['LM-LMC-Rest fixed order','21.6 s rest','fixation cross','stimulus appearance','keyboard mapping','within-block balancing','pause and exclusion policy'], timing: 'requestAnimationFrame callback timestamps; physical display onset is not measured', accuracy: 'correct / all non-interrupted finalized trials, including no-response trials' } },null,2),'application/json','session.json'));
  function updateRecovery() {
    const valid = cached && cached.version === VERSION && Array.isArray(cached.rows) && Array.isArray(cached.events) && cached.config;
    $('recovery').hidden = !valid;
    if (valid) $('recovery-detail').textContent = `${cached.participant_id} · ${cached.rows.length} 問の記録 · ${cached.state === 'completed' ? '完了' : '中止・中断'}`;
  }
  $('restore').addEventListener('click', () => {
    if (!cached) return;
    const recovered = JSON.parse(JSON.stringify(cached));
    if (recovered.current_trial) { recovered.rows.push({ ...recovered.current_trial, interrupted: true, interruption_reasons: (recovered.current_trial.interruption_reasons ? recovered.current_trial.interruption_reasons+';' : '')+'page_reload', status:'aborted' }); recovered.current_trial = null; }
    renderResults(recovered);
  });
  $('clear-recovery').addEventListener('click', () => { try { localStorage.removeItem(STORAGE); } catch {} cached = null; updateRecovery(); });
  $('back-home').addEventListener('click', () => { engine = null; cancelAnimationFrame(animation); showPage('home'); updateRecovery(); });
  document.querySelectorAll('.brand').forEach(link => link.addEventListener('click', event => { event.preventDefault(); if (!engine || !['running','paused'].includes(engine.state)) { showPage('home'); updateRecovery(); } }));
  updateHome(); updateRecovery();
})();
