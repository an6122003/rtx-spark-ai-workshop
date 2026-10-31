/* Studio: the workshop page for RTX Spark laptops, in NVIDIA's look.
 *
 * The same labs and API as the classic page (index.html), with its own look:
 * chapters instead of tabs, a living chip behind the page (die.js) that lights
 * up with the work, and every model answer streamed token by token. All of it
 * served from this machine; nothing is loaded from the internet.
 */
(function () {
  'use strict';

  const WS = window.WORKSHOP || {edition: 'windows', device: '', features: {sandbox: false, openclaw: false, enterprise: true, lab1_train: true}};
  const FEAT = WS.features || {};
  const STR = window.STR, ENT_LABELS = window.ENT_LABELS;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const MOTION = !!window.gsap && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (MOTION) gsap.ticker.lagSmoothing(0);  // follow the clock: never leave content half-faded in a throttled window

  let LANG = 'vi';
  try { LANG = localStorage.getItem('studio-lang') || localStorage.getItem('dgx-lang') || 'vi'; } catch (e) {}

  /* --------------------------------------------------------- helpers --- */
  function t(k, vars) {
    const L = STR[LANG] || STR.en;
    let s = k in L ? L[k] : (k in STR.en ? STR.en[k] : k);
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  }
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  function num(v, d) {
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString(LANG === 'vi' ? 'vi-VN' : 'en-US', {maximumFractionDigits: d == null ? 1 : d});
  }
  const secs = v => t('seconds', {s: num(v, 1)});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const EL = (group, key) => { const L = ENT_LABELS[LANG] || ENT_LABELS.en; return (L[group] && L[group][key]) || key || '—'; };
  function setHTML(el, html) { if (el && el.__h !== html) { el.innerHTML = html; el.__h = html; } }
  function lamp(kind) { return `<i class="lamp ${kind || ''}"></i>`; }
  function meter(pct, n, cls) {
    const on = Math.round(Math.max(0, Math.min(100, pct || 0)) / 100 * n);
    return `<div class="meter ${cls || ''}">` + Array.from({length: n}, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('') + '</div>';
  }

  /* Minimal, safe markdown: **bold**, bullets, tables, paragraphs. */
  function md(text) {
    const lines = esc(text || '').split('\n');
    const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const img = s => s.replace(/!\[([^\]]*)\](?:\([^)]*\))?/g, (_, alt) => (alt.trim() ? `<em>${alt.trim()}</em>` : ''));
    let html = '', list = false, table = null;
    const endTable = () => {
      if (!table) return;
      html += '<table class="mdt">' + table.map((cells, i) => '<tr>' + cells.map(c => `<${i ? 'td' : 'th'}>${bold(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>';
      table = null;
    };
    for (let line of lines) {
      line = img(line);
      if (/^\s*\|.*\|\s*$/.test(line)) {
        if (list) { html += '</ul>'; list = false; }
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
        (table = table || []).push(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
        continue;
      }
      endTable();
      const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + bold(m[1]) + '</li>'; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (line.trim()) html += '<p>' + bold(line.replace(/^\s*(?:#{1,6}|&gt;)\s*/, '')) + '</p>';
    }
    endTable();
    if (list) html += '</ul>';
    return html;
  }

  /* Newline-delimited JSON from the app, one event at a time. */
  async function streamNDJSON(url, body, onEvent, method) {
    const opts = method === 'GET' ? {method: 'GET'} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})};
    const res = await fetch(url, opts);
    if (!res.ok || !res.body) {
      let detail = 'HTTP ' + res.status;
      try { const j = await res.json(); detail = j.error || j.reason || detail; } catch (e) {}
      throw new Error(detail);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line.trim()) { try { onEvent(JSON.parse(line)); } catch (e) { console.warn(e); } }
      }
    }
    if (buf.trim()) { try { onEvent(JSON.parse(buf)); } catch (e) {} }
  }
  async function getJSON(url) { const r = await fetch(url); return r.json(); }
  async function postJSON(path, body) {
    try {
      const r = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
      let j = {}; try { j = await r.json(); } catch (e) {}
      return Object.assign({ok: r.ok}, j);
    } catch (e) { return {ok: false, detail: String(e)}; }
  }

  /* ---------------------------------------------------------- motion --- */
  // Never leave content hidden: if frames stop arriving (power saving), finish the tween.
  function finishSoon(tw, ms) { setTimeout(() => { if (tw && tw.progress() < 1) tw.progress(1); }, ms); return tw; }
  // A kicker settles in: its letters close up from a wide spacing.
  function scramble(el, text, dur) {
    if (!el) return;
    el.textContent = text;
    if (MOTION) finishSoon(gsap.fromTo(el, {letterSpacing: '0.4em', autoAlpha: 0}, {letterSpacing: '0em', autoAlpha: 1, duration: dur || 1.2, ease: 'expo.out', clearProps: 'letterSpacing,opacity,visibility'}), 2400);
  }
  function countTo(el, to, fmt) {
    if (!el) return;
    const from = Number(el.__v || 0);
    el.__v = to;
    if (!MOTION || !isFinite(to) || !isFinite(from)) { el.textContent = fmt(to); return; }
    const o = {v: from};
    gsap.to(o, {v: to, duration: 0.9, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(o.v); }, onComplete: () => { el.textContent = fmt(to); }});
  }
  function setHeadline(el) {
    el.innerHTML = t(el.dataset.h).split('\n').map(l => `<span class="ln"><span class="li">${l}</span></span>`).join('');
  }
  function reveal(scene) {
    const kick = scene.querySelector('.kicker .scramble');
    if (kick) scramble(kick, kick.dataset.text || kick.textContent, 0.9);
    if (!MOTION) return;
    const tl = gsap.timeline({defaults: {ease: 'expo.out'}});
    tl.from(scene.querySelectorAll('.headline .li'), {yPercent: 110, duration: 1.4, stagger: 0.12, clearProps: 'transform'})
      .from(scene.querySelectorAll('.headline em'), {fontWeight: 200, duration: 2, ease: 'power2.out', clearProps: 'fontWeight'}, '<0.35');
    const items = Array.from(scene.querySelectorAll(':scope .reveal, :scope .chap')).filter(el => el.offsetParent !== null).slice(0, 14);
    tl.from(items, {autoAlpha: 0, y: 28, duration: 1.1, stagger: 0.08, clearProps: 'opacity,visibility,transform'}, '<0.3');
    const nodes = scene.querySelectorAll('.flow .fnode');
    if (nodes.length) tl.from(nodes, {autoAlpha: 0, y: 12, duration: 0.7, stagger: 0.07, clearProps: 'all'}, '<0.1');
    finishSoon(tl, 3200);
  }
  function popIn(el) { if (MOTION && el) finishSoon(gsap.from(el, {autoAlpha: 0, y: 14, duration: 0.6, ease: 'expo.out', clearProps: 'all'}), 1200); }

  /* -------------------------------------------------------- language --- */
  function applyLang() {
    document.documentElement.lang = LANG;
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-h]').forEach(setHeadline);
    $$('.kicker .scramble[data-i18n]').forEach(el => { el.dataset.text = el.textContent; });
    $('#home-kicker').dataset.text = homeKicker();
    $('#home-kicker').textContent = homeKicker();
    $('#l1-q').placeholder = t('cmp_placeholder');
    $('#l2-q').placeholder = t('l2_placeholder');
    $('#l3-q').placeholder = t('l3_placeholder');
    $('#f2-search-d').textContent = t(FEAT.sandbox ? 'f2_search_d_sb' : 'f2_search_d');
    $('#f3-nc').textContent = t(FEAT.sandbox ? 'f3_nc_sb' : 'f3_nc');
    $$('.langs button').forEach(b => b.classList.toggle('on', b.dataset.lang === LANG));
    renderHome(); mxRender(); modelsRender(); lab1Render(); lab2Examples(); lab2Map(); lab2Steps(L2.step || 'idle'); lab3Render();
    if (window.Die) Die.configure({names: dieNames()});
    ENT.built = ''; ENT.costBuilt = ''; entRender();
    if (L2.last) lab2Answer(L2.last);
    if (L2.sources) lab2Sources(L2.sources);
  }
  $$('.langs button').forEach(b => b.addEventListener('click', () => {
    if (LANG === b.dataset.lang) return;
    LANG = b.dataset.lang;
    try { localStorage.setItem('studio-lang', LANG); } catch (e) {}
    applyLang();
    const scene = $('.scene.on');
    if (scene) reveal(scene);
  }));

  /* ---------------------------------------------------------- scenes --- */
  const SCENES = ['home', 'lab1', 'lab2', 'lab3', 'ent'].filter(n => n !== 'ent' || FEAT.enterprise !== false);
  if (FEAT.enterprise === false) $$('.need-ent').forEach(el => { el.hidden = true; });
  let current = null;
  function show(name, first) {
    if (!SCENES.includes(name)) name = 'home';
    if (current === name) return;
    const prev = current;
    current = name;
    document.body.dataset.scene = name;
    $$('.chapters a').forEach(a => a.classList.toggle('on', a.dataset.go === name && !a.dataset.scroll));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (window.Die) Die.focus(name, first ? 2.4 : 1.6);
    const next = $('#scene-' + name), old = prev && $('#scene-' + prev);
    const swap = () => {
      if (old) old.classList.remove('on');
      next.classList.add('on');
      window.scrollTo(0, 0);
      onScroll();
      reveal(next);
      if (name === 'ent') entTick(true);
      if (name === 'lab2') lab2Map();
    };
    if (MOTION && old) {
      gsap.to(old, {autoAlpha: 0, y: -26, duration: 0.32, ease: 'power2.in', onComplete: () => { gsap.set(old, {clearProps: 'all'}); swap(); }});
    } else swap();
  }
  function scrollToId(id, delay) {
    setTimeout(() => { const el = document.getElementById(id); if (el) el.scrollIntoView({behavior: MOTION ? 'smooth' : 'auto', block: 'start'}); }, delay || 0);
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      const was = current;
      show(go.dataset.go);
      if (go.dataset.scroll) scrollToId(go.dataset.scroll, was === go.dataset.go ? 0 : 500);
      return;
    }
    const spec = e.target.closest('[data-mx]');
    if (spec && !spec.closest('#mx-list')) { mxSelect(spec.dataset.mx, true); scrollToId('machine-h'); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) copyText(copy.dataset.copy).then(ok => {
      if (ok) { toast(t('ww_copied')); return; }
      const mail = $('.ww-mail');  // no clipboard for this page: leave the address selected instead
      if (mail) { const r = document.createRange(); r.selectNodeContents(mail); getSelection().removeAllRanges(); getSelection().addRange(r); }
      toast(t('ww_copy_fail'));
    });
  });
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.spec[data-mx]')) {
      e.preventDefault(); mxSelect(e.target.dataset.mx, true); scrollToId('machine-h'); return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, textarea, select'))) return;
    const map = {0: 'home', 1: 'lab1', 2: 'lab2', 3: 'lab3', 4: 'ent'};
    if (map[e.key] && SCENES.includes(map[e.key])) show(map[e.key]);
  });

  /* ----------------------------------------------------- sheet, toast --- */
  function openSheet(title, sub, html) {
    $('#sheet-title').textContent = title;
    $('#sheet-sub').textContent = sub || '';
    $('#sheet-body').innerHTML = html;
    $('#sheet-body').scrollTop = 0;
    $('#sheet').classList.add('on');
    $('#sheet').setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    $$('#sheet audio').forEach(a => a.pause());
    $('#sheet').classList.remove('on');
    $('#sheet').setAttribute('aria-hidden', 'true');
  }
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  let toastTimer = null;
  function toast(text) {
    $('#toast').textContent = text;
    $('#toast').classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('on'), 2800);
  }

  /* --------------------------------------------- telemetry and health --- */
  let TEL = null, HEALTH = null;
  const MACHINE = {gpuName: '', gpuCores: 0, cpuCores: 0, memGb: 0};
  function homeKicker() {
    return t('home_kicker') + (MACHINE.gpuName ? ' · ' + MACHINE.gpuName : '');
  }
  // The chip's labels, in the page's language.
  function dieNames() {
    return {gpu: MACHINE.gpuCores ? t('die_gpu', {n: num(MACHINE.gpuCores, 0)}) : 'GPU', cpu: t('die_cpu', {n: MACHINE.cpuCores || 20}),
            mem: MACHINE.memGb ? t('die_mem', {n: num(MACHINE.memGb, 0)}) : t('die_mem_0'), slc: t('die_slc')};
  }
  async function telemetry() {
    try { TEL = await getJSON('/api/telemetry'); } catch (e) { TEL = null; }
    const g = (TEL && TEL.gpu) || {};
    const name = (g.name || (HEALTH && HEALTH.gpu) || '').trim();
    const before = MACHINE.gpuName;
    MACHINE.gpuName = name.replace(/\s*\(.*\)\s*$/, '');
    const cores = name.match(/(\d[\d,]*)-core/i);
    MACHINE.gpuCores = cores ? Number(cores[1].replace(/,/g, '')) : 0;
    const cpu = (TEL && TEL.cpu) || {};
    const cc = String(cpu.name || '').match(/(\d+)-core CPU/i);
    MACHINE.cpuCores = cc ? Number(cc[1]) : (cpu.cores || 0);
    MACHINE.memGb = (TEL && TEL.memory && TEL.memory.installed_gb) || 0;
    if (window.Die) {
      Die.configure({sm: MACHINE.gpuCores ? MACHINE.gpuCores / 128 : 48, cores: MACHINE.cpuCores || 20,
                     gpuCores: MACHINE.gpuCores, memGb: MACHINE.memGb, label: MACHINE.gpuName.replace(/^NVIDIA\s+/i, ''), names: dieNames()});
      Die.telemetry(g.util, g.mem_total_mb ? g.mem_used_mb / g.mem_total_mb : null);
    }
    // the status corner of the navigation
    const up = !!(HEALTH && HEALTH.ollama);
    $('#lamp-sys').className = 'lamp ' + (up ? 'on' : HEALTH ? 'bad' : '');
    $('#hud-device').textContent = MACHINE.gpuName ? MACHINE.gpuName + (up ? '' : ' · ' + t('hud_ollama_off')) : (up ? '' : t('hud_ollama_off'));
    $('#hud-gpu').innerHTML = g.util != null ? `GPU <b>${num(g.util, 0)}%</b>` : '';
    if (before !== MACHINE.gpuName) { $('#home-kicker').dataset.text = homeKicker(); if (current === 'home') scramble($('#home-kicker'), homeKicker(), 0.9); }
    renderSpecs();
    if (current === 'home') mxRender();
  }
  async function health() {
    try { HEALTH = await getJSON('/api/health'); } catch (e) { HEALTH = null; }
    const h = HEALTH || {};
    if (h.embed_model) $('#f2-embed-d').textContent = h.embed_model.name.split(':')[0];
    if (h.doc_count) L2.docCount = h.doc_count;
    renderHome();
  }
  function labState(k) {
    const h = HEALTH || {}, m = x => !!(h.ollama && x && x.ready);
    if (k === 'lab1') { const i = L1.info || {}; return i.tuned_ready && i.trainer && i.trainer.ready ? 'on' : (i.tuned_ready || i.base_ready) ? 'warn' : ''; }
    if (k === 'lab2') return m(h.chat_model) && m(h.embed_model) ? 'on' : h.ollama ? 'warn' : '';
    if (k === 'lab3') return m(h.chat_model) && (!L3.info || L3.info.tools_ok) ? 'on' : h.ollama ? 'warn' : '';
    if (k === 'ent') { const d = ENT.data; return d && d.installed && d.installed.image && d.installed.model ? 'on' : FEAT.enterprise ? 'warn' : ''; }
    return '';
  }

  /* ------------------------------------------------------------ home --- */
  function renderSpecs() {
    const items = [
      ['spec_gpu', MACHINE.gpuCores ? t('spec_gpu_v', {n: num(MACHINE.gpuCores, 0)}) : (MACHINE.gpuName ? 'CUDA' : '—'), MACHINE.gpuName || '—', '', 'gpu'],
      ['spec_cpu', MACHINE.cpuCores ? t('spec_cpu_v', {n: MACHINE.cpuCores}) : '—', (TEL && TEL.cpu && TEL.cpu.name || '').replace(/\s*\(.*\)\s*$/, '') || '—', '', 'cpu'],
      ['spec_mem', MACHINE.memGb ? t('spec_mem_v', {n: num(MACHINE.memGb, 0)}) : '—', t('spec_mem_d'), '', 'mem'],
      ['spec_cloud', '0', t('spec_cloud_d'), 'ember', ''],
    ];
    setHTML($('#home-specs'), items.map(([k, v, d, cls, mx]) =>
      `<div class="spec"${mx ? ` data-mx="${mx}" role="button" tabindex="0"` : ''}><dt>${esc(t(k))}</dt><dd><span class="v ${cls}">${esc(v)}</span><span class="d">${esc(d)}</span></dd></div>`).join(''));
  }
  const REGION = {lab1: 'gpu', lab2: 'mem', lab3: 'cpu', ent: 'gpu'};
  function renderHome() {
    renderSpecs();
    const st = k => { const s = labState(k); return `${lamp(s)}<span>${esc(t(s === 'on' ? 'st_ready' : s === 'warn' ? 'st_partial' : 'st_missing'))}</span>`; };
    const rows = ['lab1', 'lab2', 'lab3', 'ent'].filter(k => SCENES.includes(k));
    setHTML($('#home-index'), rows.map((k, i) =>
      `<li><button type="button" class="chap" data-go="${k}" data-region="${REGION[k]}"><span class="no">0${i + 1}</span>` +
      `<span class="nm">${esc(t('idx_' + k))}</span><span class="ds">${esc(t(k === 'ent' ? 'ent_desc' : k + '_desc'))}</span>` +
      `<span class="st">${st(k)}</span><span class="go">→</span></button></li>`).join(''));
    for (const k of ['lab1', 'lab2', 'lab3', 'ent']) { const l = $('#lamp-' + k); if (l) l.className = 'lamp ' + labState(k); }
    const plan = [['intro', 10], ['lab1', 20], ['lab2', 20], ['lab3', 20], ['ent', 15], ['qa', 5]].filter(p => p[0] !== 'ent' || SCENES.includes('ent'));
    let m = 0;
    setHTML($('#home-plan'), plan.map(([k, w]) => {
      const at = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      m += w;
      return `<div class="seg2${k.startsWith('lab') || k === 'ent' ? ' lab' : ''}" style="--w:${w}"><b>${at}</b><span>${esc(t('plan_' + k))}</span></div>`;
    }).join(''));
    const h = HEALTH || {}, ed = ENT.data;
    const models = [h.chat_model && h.chat_model.name, h.embed_model && h.embed_model.name, L1.info && L1.info.base_model, L1.info && L1.info.tuned_model].filter(Boolean);
    const engineName = (ed && ed.engine_name) || 'llama.cpp';
    setHTML($('#home-stack'),
      `<li>${lamp(h.ollama ? 'on' : HEALTH ? 'bad' : '')}<b>${esc(t('stack_models'))}</b><span><code>${esc(models.join(' · ') || '—')}</code></span></li>` +
      `<li>${lamp(L3.info ? (L3.info.tools_ok ? 'on' : 'bad') : '')}<b>${esc(t('stack_tools'))}</b><span>${esc(t('stack_tools_d'))}</span></li>` +
      (FEAT.enterprise !== false ? `<li>${lamp(labState('ent'))}<b>${esc(t('stack_engine'))}</b><span>${esc(t('stack_engine_d', {e: engineName}))}</span></li>` : '') +
      `<li>${lamp('on')}<b>${esc(t('stack_page'))}</b><span>${esc(t('stack_page_d'))}</span></li>`);
  }
  $('#home-index').addEventListener('pointerover', e => {
    const c = e.target.closest('.chap');
    if (c && window.Die) Die.highlight(c.dataset.region);
  });
  $('#home-index').addEventListener('pointerleave', () => { if (window.Die) Die.highlight(null); });

  /* ----------------------------------------------------- the machine --- */
  // NVIDIA's specifications for the RTX Spark (the 6144-core laptop part), each tied to a block
  // of the chip behind the page and to what this machine reports right now.
  const MX = ['gpu', 'cpu', 'mem', 'ai', 'npu', 'power'];
  const MX_REGION = {gpu: 'gpu', cpu: 'cpu', mem: 'mem', ai: 'gpu', npu: 'npu', power: 'pkg'};
  const MX_TOUR = 6000;
  const MXS = {sel: 'gpu', touring: true, resumeAt: 0, inView: false};
  function mxValue(k) {
    if (k === 'gpu') return num(MACHINE.gpuCores || 6144, 0);
    if (k === 'cpu') return String(MACHINE.cpuCores || 20);
    if (k === 'mem') return num(MACHINE.memGb || 128, 0) + ' GB';
    return t('mx_' + k + '_v');
  }
  function mxRender() {
    const list = $('#mx-list');
    setHTML(list, MX.map(k => `<button type="button" class="mx-row" role="tab" aria-controls="mx-live" data-mx="${k}">` +
      `<span class="mx-v">${esc(mxValue(k))}</span><span class="mx-u">${esc(t('mx_' + k + '_u'))}</span>` +
      `<span class="mx-t">${esc(t('mx_' + k + '_t'))}</span><span class="mx-d">${esc(t('mx_' + k + '_d'))}</span><span class="mx-bar"><i></i></span></button>`).join(''));
    list.style.setProperty('--tour', MX_TOUR + 'ms');
    mxMark();
    setHTML($('#mx-feat'), t('mx_feat').map(f => `<span>${esc(f)}</span>`).join(''));
    setHTML($('#mx-src'), esc(t('mx_src')).replace('{link}',
      `<a href="https://www.nvidia.com/en-us/products/rtx-spark/specifications/" target="_blank" rel="noopener">${esc(t('mx_src_link'))}</a>`));
    mxLive();
  }
  function mxMark() {  // classes, not new markup: the rows open and close with their transitions
    $$('#mx-list .mx-row').forEach(b => {
      const on = b.dataset.mx === MXS.sel;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    });
  }
  function mxSelect(k, byUser) {
    if (!MX.includes(k)) return;
    if (byUser) { MXS.touring = false; MXS.resumeAt = Date.now() + 25000; }
    const changed = MXS.sel !== k;
    MXS.sel = k;
    mxMark();
    mxLive();
    if (changed) mxEnter();
    if (MXS.inView && window.Die) Die.inspect(MX_REGION[k]);
    mxTour();
  }
  // The new readout settles in; the memory map fills cell by cell.
  function mxEnter() {
    if (!MOTION) return;
    const box = $('#mx-live');
    finishSoon(gsap.fromTo(box.querySelectorAll('.lv > div, .lv-big, .legend li, .note-s'), {autoAlpha: 0, y: 14},
      {autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.06, ease: 'expo.out', overwrite: true, clearProps: 'opacity,visibility,transform'}), 1600);
    const cells = box.querySelectorAll('.waffle i');
    if (cells.length) finishSoon(gsap.fromTo(cells, {autoAlpha: 0, scale: 0.3},
      {autoAlpha: 1, scale: 1, duration: 0.5, stagger: 0.005, ease: 'back.out(2)', overwrite: true, clearProps: 'opacity,visibility,transform'}), 1600);
  }
  $('#mx-list').addEventListener('click', e => { const r = e.target.closest('.mx-row'); if (r) mxSelect(r.dataset.mx, true); });
  $('#mx-list').addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = MX.indexOf(MXS.sel) + (e.key === 'ArrowDown' ? 1 : -1);
    mxSelect(MX[(i + MX.length) % MX.length], true);
    const b = $(`#mx-list [data-mx="${MXS.sel}"]`);
    if (b) b.focus();
  });
  // A slow tour of the chip while the section is on screen and nobody touches it; a click
  // holds the tour for a while. The bar under the open row shows when it moves on.
  let mxTimer = 0;
  function mxTour() {
    clearTimeout(mxTimer);
    const list = $('#mx-list');
    list.classList.remove('touring');
    if (!MXS.inView || current !== 'home') return;
    if (!MXS.touring && Date.now() >= MXS.resumeAt) MXS.touring = true;
    void list.offsetWidth;  // restart the bar
    list.classList.toggle('touring', MXS.touring);
    mxTimer = setTimeout(() => {
      if (MXS.touring) mxSelect(MX[(MX.indexOf(MXS.sel) + 1) % MX.length], false);
      else mxTour();
    }, MXS.touring ? MX_TOUR : Math.max(500, MXS.resumeAt - Date.now()));
  }
  function mxLive() {
    const box = $('#mx-live');
    if (!box) return;
    const g = (TEL && TEL.gpu) || {}, pf = (TEL && TEL.platform) || {}, k = MXS.sel;
    const cell = (label, value, wide) => `<div${wide ? ' class="wide"' : ''}><span>${esc(label)}</span><b>${value}</b></div>`;
    const v = (x, unit) => (x == null || x === '' ? '—' : esc(x) + (unit ? `<small> ${esc(unit)}</small>` : ''));
    const util = v(g.util != null ? num(g.util, 0) : null, '%'), temp = v(g.temp_c != null ? num(g.temp_c, 0) : null, '°C');
    let body;
    if (k === 'gpu') {
      body = cell(t('lv_load'), util) + cell(t('lv_temp'), temp) +
        cell(t('lv_clock'), v(pf.max_clock_mhz ? num(pf.max_clock_mhz, 0) : null, 'MHz')) + cell(t('lv_cc'), v(pf.compute_cap));
    } else if (k === 'ai') {
      const lr = L1.info && L1.info.last_run;
      body = cell(t('lv_load'), util) + cell(t('lv_temp'), temp) +
        cell(t('lv_train'), esc(lr ? t('lv_train_v', {steps: lr.steps, sec: num(lr.train_seconds, 0)}) : t('lv_train_none')), true);
    } else if (k === 'cpu') {
      body = cell(t('lv_cores'), v(MACHINE.cpuCores || (TEL && TEL.cpu && TEL.cpu.cores))) +
        cell(t('lv_model'), v([pf.maker, pf.model].filter(Boolean).join(' '))) +
        cell(t('lv_cpu'), esc((TEL && TEL.cpu && TEL.cpu.name) || '—'), true);
    } else if (k === 'npu') {
      body = cell(t('lv_npu'), esc(t(pf.npu ? 'lv_npu_yes' : 'lv_npu_no'))) + cell(t('lv_driver'), v(pf.driver)) +
        cell(t('lv_cuda'), v(pf.cuda)) + cell(t('lv_cc'), v(pf.compute_cap));
    } else if (k === 'power') {
      body = cell(t('lv_power'), v(g.power_w != null ? num(g.power_w, 1) : null, 'W')) + cell(t('lv_budget'), v('45–80', 'W')) +
        cell(t('lv_temp'), temp) + cell(t('lv_load'), util);
    }
    setHTML(box, `<div class="plate-h"><span class="lbl"><i class="lamp on"></i>${esc(t('mx_live'))}</span><span class="count">${esc(t('mx_' + k + '_t'))}</span></div>` +
      (k === 'mem' ? mxWaffle() : `<div class="lv">${body}</div>`));
    if (MXS.inView) mxFollow();  // the readout's height sets where the chip sits
  }
  // One cell per GB: the models in memory right now (as Ollama reports them), the rest of
  // Windows and its apps, and what is free.
  function mxWaffle() {
    const mem = (TEL && TEL.memory) || {};
    const total = Math.round(mem.installed_gb || MACHINE.memGb || 128);
    const models = ((TEL && TEL.loaded) || []).filter(m => m.vram_gb > 0).sort((a, b) => b.vram_gb - a.vram_gb);
    const used = models.reduce((a, m) => a + m.vram_gb, 0);
    const free = mem.available_gb != null ? mem.available_gb : total - used;
    const other = Math.max(0, total - free - used);
    let cells = '', n = 0;
    const fill = (count, cls, m) => { for (let j = 0; j < count && n < total; j++, n++) cells += `<i class="${cls}" data-m="${m}"></i>`; };
    models.forEach((m, mi) => fill(Math.max(1, Math.round(m.vram_gb)), 'm' + (mi % 6), mi));
    fill(Math.round(other), 'mo', 'o');
    fill(total - n, 'mf', 'f');
    const row = (m, cls, name, gb) => `<li data-m="${m}"><i class="sw ${cls}"></i><span>${esc(name)}</span><b>${esc(num(gb, 1))} GB</b></li>`;
    return `<p class="lv-big"><b>${esc(num(used, 0))} GB</b>${esc(t('lv_mem_of', {t: total}))}</p><div class="waffle" id="mx-waffle">${cells}</div>` +
      (models.length ? '' : `<p class="note-s">${esc(t('lv_none'))}</p>`) +
      '<ul class="legend">' + models.map((m, mi) => row(mi, 'm' + (mi % 6), m.name.replace(/:latest$/, ''), m.vram_gb)).join('') +
      (other >= 0.5 ? row('o', 'mo', t('lv_mem_other'), other) : '') + row('f', 'mf', t('lv_mem_free'), free) + '</ul>';
  }
  // Point at a model (in the legend or on the map) and its cells stand out.
  function mxHot(m) {
    const w = $('#mx-waffle');
    if (!w) return;
    w.classList.toggle('hl', m != null);
    w.querySelectorAll('i').forEach(c => c.classList.toggle('hot', m != null && c.dataset.m === m));
    $$('#mx-live .legend li').forEach(li => li.classList.toggle('hot', m != null && li.dataset.m === m));
  }
  $('#mx-live').addEventListener('pointerover', e => {
    const hit = e.target.closest('.legend li, .waffle i');
    if (!hit && e.target.closest('.waffle')) return;  // the gaps between cells
    mxHot(hit ? hit.dataset.m : null);
  });
  $('#mx-live').addEventListener('pointerleave', () => mxHot(null));
  // While the section is on screen the chip behind the page moves into its stage, centred in the
  // room above the live readout.
  function mxFollow() {
    const r = $('#mx-stage').getBoundingClientRect(), free = $('#mx-live').getBoundingClientRect().top - r.top;
    if (window.Die) Die.follow((r.left + r.width * 0.5) / innerWidth, (r.top + Math.max(90, Math.min(300, free / 2))) / innerHeight);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      const en = entries[entries.length - 1];
      const on = en.isIntersecting && en.intersectionRatio >= 0.19 && current === 'home';
      if (on === MXS.inView) return;
      MXS.inView = on;
      if (window.Die) {
        if (on) { mxFollow(); Die.inspect(MX_REGION[MXS.sel]); }
        else if (current === 'home') Die.focus('home', 1.2);
      }
      onScroll();
      mxTour();
    }, {threshold: [0, 0.2, 0.4]}).observe($('#machine'));
  }

  /* ---------------------------------------------------------- models --- */
  // What this machine is (the app reads it, hardware.py) and the chat models that fit it. A model is
  // downloaded and Labs 2 and 3 switch to it; one the machine cannot hold is locked.
  const MD = {data: null, timer: 0, pull: null};
  const GB = v => (v == null ? '—' : num(v, v >= 10 ? 0 : 1) + ' GB');
  const MD_ERR = {busy: 'md_err_busy', too_big: 'md_err_too_big', no_disk: 'md_err_no_disk', ollama_off: 'md_alert_off', local_only: 'md_local'};
  async function modelsLoad() {
    if (FEAT.models === false) return;
    clearTimeout(MD.timer);
    try { MD.data = await getJSON('/api/models'); } catch (e) { MD.data = null; }
    const d = MD.data || {}, p = d.pull || {};
    if (MD.pull && MD.pull.running && !p.running && p.model === MD.pull.model) {  // a download just ended
      if (p.done) { toast(t('md_toast_done', {m: p.model})); health(); }
      else toast(t('md_dl_failed', {m: p.model, e: p.error || ''}));
    }
    MD.pull = p;
    modelsRender();
    const live = p.running || (d.switching && d.switching.busy);
    MD.timer = setTimeout(modelsLoad, live ? 1000 : 15000);
  }
  function modelsRender() {
    if (FEAT.models === false) return;
    const d = MD.data;
    setHTML($('#md-hw'), modelsHw(d));
    if (!d || !d.models) { setHTML($('#md-rows'), ''); return; }
    const ok = d.models.filter(m => m.status === 'fits' || m.status === 'slow');
    $('#md-count').textContent = t('md_count', {n: ok.length, t: d.models.filter(m => m.status !== 'custom').length});
    const active = d.models.find(m => m.active) || {};
    const rec = d.models.find(m => m.id === d.recommended);
    let alert = '';
    if (!d.ollama) alert = `<p class="md-alert bad">${lamp('bad')}<span>${esc(t('md_alert_off'))}</span></p>`;
    else if (rec && (!d.active_ready || active.status === 'too_big')) {
      alert = `<div class="md-alert">${lamp('warn')}<span>${esc(t(d.active_ready ? 'md_alert_big' : 'md_alert_missing', {m: d.active}))}</span>` +
        (d.can_change ? `<button type="button" class="act primary" data-md-${rec.installed ? 'use' : 'pull'}="${esc(rec.id)}"${d.pull && d.pull.running ? ' disabled' : ''}>` +
          `<span>${esc(rec.name)}</span><span class="arr">→</span></button>` : `<b>${esc(rec.name)}</b>`) + '</div>';
    }
    setHTML($('#md-alert'), alert);
    // Every bar on one scale; the dashed lines are what the GPU, and the machine, can hold.
    const b = d.budget || {};
    const scale = Math.max(b.limit_gb || 0, ...d.models.map(m => m.need_gb || 0)) * 1.06 || 1;
    const pos = v => (100 * Math.min(v, scale) / scale).toFixed(1) + '%';
    const twoLines = d.hardware.kind === 'discrete' && b.limit_gb > b.fast_gb;
    const lines = (b.fast_gb ? `<i class="ln" style="left:${pos(b.fast_gb)}"></i>` : '') + (twoLines || !b.fast_gb ? `<i class="ln max" style="left:${pos(b.limit_gb)}"></i>` : '');
    setHTML($('#md-legend'), (b.fast_gb ? `<span><i class="ln"></i>${esc(t('md_line_gpu', {n: GB(b.fast_gb)}))}</span>` : '') +
      (twoLines || !b.fast_gb ? `<span><i class="ln max"></i>${esc(t('md_line_max', {n: GB(b.limit_gb)}))}</span>` : ''));
    setHTML($('#md-rows'), d.models.map(m => modelRow(m, d, pos, lines)).join(''));
    setHTML($('#md-note'), esc(t('md_note')) + (d.can_change ? '' : ' ' + esc(t('md_local'))));
    const lm = $('#lamp-models');
    if (lm) lm.className = 'lamp ' + (d.active_ready ? 'on' : 'warn');
  }
  function modelsHw(d) {
    const hw = d && d.hardware;
    const head = `<div class="plate-h"><span class="lbl"><i class="lamp on"></i>${esc(t('md_hw'))}</span><span class="count">${esc(t('md_auto'))}</span></div>`;
    if (!hw) return head + `<p class="note-s">${esc(t('md_reading'))}</p>`;
    const b = d.budget || {}, e = d.enterprise || {};
    const cell = (label, value, sub, wide) => `<div${wide ? ' class="wide"' : ''}><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
    const mem = hw.kind === 'discrete'
      ? cell(t('md_vram'), GB(hw.vram_gb), t('md_vram_d')) + cell(t('md_ram'), GB(hw.ram_gb))
      : cell(t('md_mem'), GB(hw.ram_gb), t(hw.kind === 'unified' ? 'md_shared' : 'md_ram_d')) + cell(t('md_disk'), GB(hw.disk_free_gb));
    const ent = e.fits ? t('md_ent_yes') : t('md_ent_' + (e.reason || 'memory'), {n: e.need_gb || 32});
    return head +
      `<p class="md-big"><b>${esc(GB(b.fast_gb || b.limit_gb))}</b>${esc(t(b.fast_gb ? 'md_budget' : 'md_budget_cpu'))}</p>` +
      '<div class="lv">' +
      cell(t('md_gpu'), hw.gpu || t('md_none'), t('md_kind_' + hw.kind), true) + mem +
      (hw.kind === 'discrete' ? cell(t('md_disk'), GB(hw.disk_free_gb)) : '') +
      cell(t('md_cpu'), hw.cores ? t('md_cores', {n: hw.cores}) : '—', hw.cpu) +
      (FEAT.enterprise !== false ? cell(t('md_ent'), ent, '', true) : '') + '</div>';
  }
  function modelRow(m, d, pos, lines) {
    const st = m.status, p = d.pull || {}, sw = d.switching || {};
    const usable = st === 'fits' || st === 'slow' || st === 'custom';
    const pulling = p.running && p.model === m.id;
    const chip = m.active && m.installed ? ['on', 'md_st_active'] : m.id === d.recommended ? ['ion', 'md_st_rec'] :
      {fits: ['on', 'md_st_fits'], slow: ['warn', 'md_st_slow'], too_big: ['bad', 'md_st_too_big'], no_disk: ['bad', 'md_st_no_disk'], custom: ['', 'md_st_custom']}[st];
    const meta = [m.params, m.size_gb != null ? t('md_dl', {n: GB(m.size_gb)}) : '', m.need_gb ? t('md_need', {n: GB(m.need_gb)}) : '',
      m.context ? t('md_ctx', {n: Math.round(m.context / 1024)}) : ''].filter(Boolean).join(' · ');
    let go = '';
    if (pulling) {
      const pct = p.total ? Math.min(100, 100 * p.completed / p.total) : 0;
      go = `<div class="mprog"><div class="mbar"><i style="width:${pct.toFixed(1)}%"></i></div><span>${esc(p.total ? `${num(pct, 0)}% · ${GB(p.completed / 1e9)} / ${GB(p.total / 1e9)}` : t(p.status === 'retrying' ? 'md_retry' : 'md_wait'))}</span></div>`;
    } else if (m.active && m.installed) {
      go = `<span class="md-using">${esc(t(sw.busy && sw.model === m.id ? 'md_preparing' : 'md_using'))}</span>`;
    } else if (!usable) {
      go = `<span class="md-lock"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>${esc(t('md_locked'))}</span>`;
    } else if (d.can_change && st !== 'custom') {
      const busy = p.running ? ' disabled' : '';
      go = m.installed ? `<button type="button" class="act ghost" data-md-use="${esc(m.id)}">${esc(t('md_use'))}</button>`
        : `<button type="button" class="act ghost${m.id === d.recommended ? ' rec' : ''}" data-md-pull="${esc(m.id)}"${busy}>${esc(t('md_get'))}<span class="arr">↓</span></button>`;
    }
    const bar = m.need_gb ? `<div class="mbar ${st}"><i style="width:${pos(m.need_gb)}"></i>${lines}</div>` : '<div></div>';
    return `<li class="mrow${usable ? '' : ' locked'}${m.active && m.installed ? ' active' : ''}">` +
      `<div class="nm"><b>${esc(m.name)}</b>${m.maker ? `<span class="mk${m.nvidia ? ' nv' : ''}">${esc(m.maker)}</span>` : ''}` +
      `<div class="meta"><code>${esc(m.id)}</code>${esc(meta)}</div></div>` +
      bar + `<div class="mst">${lamp(chip[0])}<span>${esc(t(chip[1]))}</span>${st === 'slow' ? `<em>${esc(t('md_why_slow'))}</em>` : ''}</div>` +
      `<div class="go">${go}</div></li>`;
  }
  $('#models').addEventListener('click', async e => {
    const btn = e.target.closest('[data-md-pull], [data-md-use]');
    if (!btn || btn.disabled) return;
    const model = btn.dataset.mdPull || btn.dataset.mdUse, pull = !!btn.dataset.mdPull;
    btn.disabled = true;
    const r = await postJSON(pull ? '/api/models/pull' : '/api/models/select', {model});
    if (!r.ok) toast(MD_ERR[r.detail] ? t(MD_ERR[r.detail]) : t('md_err', {d: r.detail || r.error || ''}));
    else if (r.detail === 'started') toast(t('md_toast_start', {m: model}));
    else { toast(t('md_toast_use', {m: model})); health(); }
    modelsLoad();
  });

  /* ------------------------------------------------- streamed answers --- */
  // Tokens arrive as glowing spans; when the answer is complete it is set as formatted text.
  function streamPut(el, text) {
    if (!el.classList.contains('raw')) { el.classList.add('raw'); el.innerHTML = ''; }
    const s = document.createElement('span');
    s.className = 'tk';
    s.textContent = text;
    el.appendChild(s);
    if (el.children.length > 90) {  // keep the page light: fold old spans into plain text
      const keep = Array.from(el.children).slice(-24);
      const tail = keep.reduce((a, k) => a + k.textContent.length, 0);
      const all = el.textContent;
      el.textContent = '';
      el.append(document.createTextNode(all.slice(0, all.length - tail)), ...keep);
    }
  }
  function streamDone(el, text) { el.classList.remove('raw'); el.innerHTML = md(text); }
  function waiting(el) { el.classList.remove('raw'); el.innerHTML = '<span class="cursor"></span>'; }

  // The "without" side of the Lab 2 and Lab 3 comparisons: the same model, no documents, no tools.
  function chatModelName() { return (HEALTH && HEALTH.chat_model && HEALTH.chat_model.name) || (L3.info && L3.info.chat_model) || ''; }
  async function plainAsk(q, el, metaEl) {
    let text = '', err = null, seconds = null;
    waiting(el); metaEl.textContent = '';
    try {
      await streamNDJSON('/api/plain/stream', {question: q, lang: LANG}, ev => {
        if (ev.text) { text += ev.text; streamPut(el, ev.text); if (window.Die) Die.token(); }
        if (ev.error) err = ev.error;
        if (ev.done) seconds = ev.seconds;
      });
    } catch (e) { err = String(e.message || e); }
    if (err && !text) el.innerHTML = `<div class="err">${esc(t('err_generic', {e: err}))}</div>`;
    else streamDone(el, text);
    metaEl.textContent = seconds != null ? secs(seconds) : '';
  }

  function qrows(items, start, isKey) {
    return items.map((q, i) => {
      const key = !!(isKey && isKey(q));
      return `<li><button type="button" class="qrow" data-q="${esc(q)}"><span class="qn">${String(start + i + 1).padStart(2, '0')}</span>` +
        `<span class="qt">${esc(q)}${key ? `<span class="key">${esc(t('key_q'))}</span>` : ''}</span><span class="qa">→</span></button></li>`;
    }).join('');
  }
  function qgroups(groups, isKey) {
    let n = 0;
    return groups.map((g, gi) => {
      const html = `<div class="qgroup"><h3>${esc(g.group)}<span>· ${g.items.length}</span></h3><ol class="qrows">${qrows(g.items, n, q => isKey(q, gi))}</ol></div>`;
      n += g.items.length;
      return html;
    }).join('');
  }
  function flow(id, order, active, allDone) {
    const idx = order.indexOf(active);
    const nodes = $$(`#${id} .fnode`);
    nodes.forEach((n, k) => {
      n.classList.toggle('active', k === idx && !allDone);
      n.classList.toggle('done', allDone || k < idx);
    });
    const wire = $(`#${id} .wire`);
    if (wire) {
      const reach = allDone ? order.length - 1 : Math.max(0, idx);
      wire.style.width = (idx < 0 && !allDone ? 0 : (reach / (order.length - 1)) * 100) + '%';
    }
  }

  /* ----------------------------------------------------------- LAB 1 --- */
  const L1 = {info: null, losses: [], total: 0, running: false, stage: '', logs: [], following: false,
              p: {epochs: '5', lr: '0.0002', rank: '16'}};
  const L1P = {epochs: ['2', '3', '4', '5', '6'], lr: [['0.0001', '1e-4'], ['0.0002', '2e-4'], ['0.0003', '3e-4']], rank: ['8', '16', '32']};
  function segButtons() {
    for (const [k, opts] of Object.entries(L1P)) {
      setHTML($('#p-' + k), opts.map(o => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return `<button type="button" role="radio" data-k="${k}" data-v="${v}" aria-checked="${L1.p[k] === v}" class="${L1.p[k] === v ? 'on' : ''}">${label}</button>`;
      }).join(''));
    }
  }
  $('#l1-trainplate').addEventListener('click', e => {
    const b = e.target.closest('.seg button');
    if (!b || L1.running) return;
    L1.p[b.dataset.k] = b.dataset.v;
    segButtons();
  });
  async function lab1Load() {
    try { L1.info = await getJSON('/api/lab1/info'); } catch (e) { return; }
    lab1Render();
    renderHome();
    if (L1.info.job && L1.info.job.running && !L1.following) lab1Follow(0);
  }
  function lab1Render() {
    segButtons();
    const i = L1.info;
    if (!i) return;
    const ds = i.dataset || {};
    $('#l1-count').textContent = t('data_count', {n: ds.count || 0});
    $('#f1-data-d').textContent = t('data_count', {n: ds.count || 0});
    $('#l1-base').textContent = i.base_hf;
    $('#f1-ollama-d').textContent = i.tuned_model;
    $('#l1-mbase').textContent = i.base_model;
    $('#l1-mtuned').textContent = i.tuned_model;
    setHTML($('#l1-examples'), (ds.examples || []).slice(0, 4).map(e =>
      `<div class="ex"><div class="q">${esc(e.q)}</div><div class="a">${esc(e.a)}</div></div>`).join(''));
    const qs = ((ds.eval || {})[LANG] || []).map(x => x.q);
    setHTML($('#l1-chips'), qrows(qs, 0));
    const tr = i.trainer || {};
    $('#l1-start').disabled = !tr.ready || L1.running;
    setHTML($('#l1-trainer'), tr.ready ? '' : `<div class="warn-line"><span>✳</span><span>${esc(t('tr_' + (tr.reason || 'windows_compare_only')))}</span></div>`);
    const lr = i.last_run;
    $('#l1-last').textContent = lr ? t('last_run', {steps: lr.steps, sec: num(lr.train_seconds, 0), dev: lr.device}) : '';
    lab1Flow(L1.stage || (i.tuned_ready ? 'finished' : ''));
  }
  const L1MAP = {queued: 'data', download: 'data', start: 'train', load_model: 'train', data: 'train', lora: 'train', train_start: 'train',
                 train: 'train', sample: 'train', merge: 'gguf', saved: 'gguf', convert: 'gguf', converted: 'gguf',
                 register: 'ollama', registered: 'ollama', test: 'ollama', finished: 'compare'};
  function lab1Flow(stage) {
    flow('flow1', ['data', 'train', 'gguf', 'ollama', 'compare'], L1MAP[stage] || '', stage === 'finished' && !L1.running);
  }
  async function lab1Start() {
    L1.losses = []; L1.total = 0; L1.logs = []; L1.stage = 'queued';
    $('#l1-sample').hidden = true;
    $('#l1-log').textContent = '';
    $('#l1-ruler').innerHTML = '';
    $('#l1-loss').innerHTML = '';
    let res, j = {};
    try {
      res = await fetch('/api/lab1/train', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(L1.p)});
      j = await res.json();
    } catch (e) { j = {error: String(e)}; }
    if (!res || !res.ok) {
      setHTML($('#l1-trainer'), `<div class="err" style="margin-top:14px">${esc(j.error === 'trainer_not_ready' ? t('tr_' + j.reason) : j.job === 'busy' ? t('tr_busy') : (j.error || j.job || 'error'))}</div>`);
      return;
    }
    lab1Follow(0);
  }
  async function lab1Follow(from) {
    if (L1.following) return;
    L1.following = true; L1.running = true;
    $('#l1-run').hidden = false;
    $('#l1-start').disabled = true;
    $('#l1-cancel').hidden = false;
    lab1Stage('queued');
    try { await streamNDJSON('/api/lab1/stream?from=' + from, null, lab1Event, 'GET'); }
    catch (e) { lab1Stage('error', {msg: String(e.message || e)}); }
    L1.following = false; L1.running = false;
    $('#l1-cancel').hidden = true;
    await lab1Load();
  }
  function lab1Stage(key, vars) {
    const spinning = L1.running && !['finished', 'error', 'cancelled'].includes(key);
    const icon = spinning ? '<i class="spinner"></i>' : key === 'finished' ? '<span class="ok">✓</span>' : key === 'error' ? '<span class="err">✕</span>' : '';
    $('#l1-stage').innerHTML = icon + '<span>' + esc(t('st_' + key, vars)) + '</span>';
  }
  function lab1Ruler(step) {
    const r = $('#l1-ruler');
    if (r.children.length !== L1.total && L1.total) r.innerHTML = '<i></i>'.repeat(L1.total);
    Array.from(r.children).forEach((tick, k) => { tick.className = k < step - 1 ? 'done' : k === step - 1 ? 'on' : ''; });
  }
  function lab1Event(ev) {
    const st = ev.stage;
    if (st === 'heartbeat') return;
    if (st === 'log') {
      L1.logs.push(ev.line); if (L1.logs.length > 200) L1.logs.shift();
      $('#l1-log').textContent = L1.logs.join('\n');
      return;
    }
    if (st === 'exit') {
      if (ev.code !== 0 && L1.stage !== 'error') lab1Stage(ev.code === 130 ? 'cancelled' : 'error', {msg: 'exit ' + ev.code});
      return;
    }
    L1.stage = st;
    const i = L1.info || {};
    if (st === 'start') lab1Stage('start', {gpu: ev.gpu || ev.device});
    else if (st === 'data') lab1Stage('data', {n: ev.examples});
    else if (st === 'lora') lab1Stage('lora', {m: num(ev.trainable, 0), p: num(ev.pct, 2)});
    else if (st === 'train_start') { L1.total = ev.total_steps; lab1Ruler(0); lab1Stage('train', {s: 0, t: ev.total_steps, l: '—'}); }
    else if (st === 'train') {
      L1.total = ev.total || L1.total;
      L1.losses.push(ev.loss);
      lab1Stage('train', {s: ev.step, t: ev.total, l: num(ev.loss, 3)});
      lab1Ruler(ev.step);
      $('#l1-sub').textContent = secs(ev.elapsed) + ' · epoch ' + ev.epoch;
      $('#l1-lastloss').innerHTML = 'LOSS <b>' + esc(num(ev.loss, 3)) + '</b>';
      lab1Loss();
      if (window.Die) Die.step(ev.step / Math.max(1, ev.total), ev.loss);
    } else if (st === 'sample' || st === 'test') {
      lab1Stage(st);
      if (ev.answer) {
        $('#l1-sample').hidden = false;
        $('#l1-sample').innerHTML = `<span class="lbl">${esc(t('sample_label'))}</span>${esc(ev.answer)}`;
        popIn($('#l1-sample'));
      }
    } else if (st === 'converted') lab1Stage('converted', {mb: num(ev.size_mb, 0)});
    else if (st === 'finished') {
      L1.running = false;
      lab1Ruler(L1.total + 1);
      lab1Stage('finished', {model: ev.model || i.tuned_model});
    } else if (st === 'error') { L1.running = false; lab1Stage('error', {msg: ev.message || ''}); }
    else if (STR.en['st_' + st]) lab1Stage(st);
    lab1Flow(st);
  }
  function lab1Loss() {
    const svg = $('#l1-loss'), W = 640, H = 220, PL = 38, PR = 10, PT = 10, PB = 26;
    const ys = L1.losses;
    if (!ys.length) { svg.innerHTML = ''; return; }
    const n = Math.max(L1.total || ys.length, 2);
    const max = Math.max(...ys), min = Math.min(0, ...ys);
    const x = i => PL + (W - PL - PR) * (i / (n - 1));
    const y = v => PT + (H - PT - PB) * (1 - (v - min) / Math.max(1e-9, max - min));
    const pts = ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const last = [x(ys.length - 1), y(ys[ys.length - 1])];
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = min + (max - min) * f, yy = y(v).toFixed(1);
      return `<line class="gridl" x1="${PL}" x2="${W - PR}" y1="${yy}" y2="${yy}"/><text class="tick" x="0" y="${(+yy + 3.5).toFixed(1)}">${num(v, 2)}</text>`;
    }).join('');
    svg.innerHTML = '<defs><linearGradient id="lossfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#76b900" stop-opacity=".32"/><stop offset="1" stop-color="#76b900" stop-opacity="0"/></linearGradient></defs>' +
      grid + `<polygon class="area" points="${x(0).toFixed(1)},${H - PB} ${pts} ${last[0].toFixed(1)},${H - PB}"/>` +
      `<polyline class="curve" points="${pts}"/><rect class="head" x="${(last[0] - 3.5).toFixed(1)}" y="${(last[1] - 3.5).toFixed(1)}" width="7" height="7"/>` +
      `<text class="tick" x="${W - PR}" y="${H - 6}" text-anchor="end">STEP ${ys.length} / ${n}</text>`;
  }
  async function lab1Compare() {
    const q = $('#l1-q').value.trim();
    const btn = $('#l1-ask');
    if (!q || btn.disabled) return;
    btn.disabled = true;
    const buf = {base: '', tuned: ''};
    ['base', 'tuned'].forEach(s => { waiting($('#l1-a-' + s)); $('#l1-m-' + s).textContent = ''; });
    lab1Flow('finished');
    try {
      await streamNDJSON('/api/lab1/compare', {question: q, lang: LANG}, ev => {
        const s = ev.side;
        if (!s) return;
        const el = $('#l1-a-' + s);
        if (ev.text) { buf[s] += ev.text; streamPut(el, ev.text); if (window.Die) Die.token(); }
        if (ev.error) {
          const name = s === 'base' ? (L1.info || {}).base_model : (L1.info || {}).tuned_model;
          el.innerHTML = `<div class="warn-line"><span>✳</span><span>${esc(ev.error === 'model_missing' ? t('cmp_missing', {m: ev.model || name}) : ev.error)}</span></div>`;
        }
        if (ev.done) { if (buf[s]) streamDone(el, buf[s]); $('#l1-m-' + s).textContent = secs(ev.seconds); }
      });
    } catch (e) {
      ['base', 'tuned'].forEach(s => { if (!buf[s]) $('#l1-a-' + s).innerHTML = `<div class="err">${esc(t('err_generic', {e: e.message || e}))}</div>`; });
    }
    btn.disabled = false;
  }
  $('#l1-start').addEventListener('click', lab1Start);
  $('#l1-cancel').addEventListener('click', () => postJSON('/api/lab1/cancel'));
  $('#l1-ask').addEventListener('click', lab1Compare);
  $('#l1-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lab1Compare(); } });
  $('#l1-chips').addEventListener('click', e => { const r = e.target.closest('.qrow'); if (r) { $('#l1-q').value = r.dataset.q; lab1Compare(); } });
  $('#l1-all').addEventListener('click', () => {
    const all = ((L1.info || {}).dataset || {}).all || [];
    openSheet(t('data_title'), t('data_count', {n: all.length}),
      '<div class="examples">' + all.map(e => `<div class="ex"><div class="q">${esc(e.q)}</div><div class="a" style="-webkit-line-clamp:unset">${esc(e.a)}</div></div>`).join('') + '</div>');
  });

  /* ----------------------------------------------------------- LAB 2 --- */
  const L2 = {examples: null, docs: [], docCount: 28, busy: false, last: null, sources: null, q: '', text: '', step: 'idle', t0: 0, clock: null, hits: null};
  async function lab2Load() {
    try { L2.examples = (await getJSON('/api/lab2/examples')).examples; } catch (e) { L2.examples = {en: [], vi: []}; }
    try { L2.docs = (await getJSON('/api/lab2/corpus')).documents || []; } catch (e) { L2.docs = []; }
    L2.docCount = L2.docs.length || L2.docCount;
    lab2Examples(); lab2Map(); lab2Library(); lab2Steps('idle');
  }
  function lab2Examples() {
    if (!L2.examples) return;
    setHTML($('#l2-examples'), qgroups(L2.examples[LANG] || L2.examples.en || [], q => /disconnect|5-minute|ngắt|5 phút/i.test(q)));
  }
  $('#l2-examples').addEventListener('click', e => { const r = e.target.closest('.qrow'); if (r) { $('#l2-q').value = r.dataset.q; lab2Ask(); } });
  const docNo = d => { const m = String(d.doc || '').match(/doc-(\d+)/i); return m ? m[1] : '·'; };
  // The library as a ring of points; a question draws beams to the passages it used.
  function lab2Map() {
    const svg = $('#l2-map');
    $('#l2-maptitle').textContent = t('map_title', {n: L2.docs.length || L2.docCount});
    if (!svg || !L2.docs.length) return;
    const C = 320, R = 232, n = L2.docs.length;
    const pos = i => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [C + R * Math.cos(a), C + R * Math.sin(a), a]; };
    let html = `<circle class="ring" cx="${C}" cy="${C}" r="${R}"/><circle class="ring inner" cx="${C}" cy="${C}" r="${R * 0.62}"/>` +
      `<circle class="ring inner" cx="${C}" cy="${C}" r="${R * 1.16}"/>`;
    L2.docs.forEach((d, i) => { const [x, y] = pos(i); html += `<line class="spoke" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" opacity=".5"/>`; });
    html += '<g id="l2-beams"></g><circle class="scan" id="l2-scan" cx="320" cy="320" r="40"/>';
    L2.docs.forEach((d, i) => {
      const [x, y, a] = pos(i), lx = C + (R + 26) * Math.cos(a), ly = C + (R + 26) * Math.sin(a);
      const anchor = Math.cos(a) > 0.25 ? 'start' : Math.cos(a) < -0.25 ? 'end' : 'middle';
      html += `<g class="doc" data-doc="${esc(d.doc)}" data-i="${i}"><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>` +
        `<text class="dlabel" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${docNo(d)}</text></g>`;
    });
    html += `<circle class="core${L2.busy ? ' on' : ''}" id="l2-core" cx="${C}" cy="${C}" r="40"/><text class="ctext" x="${C}" y="${C}" text-anchor="middle" dominant-baseline="middle">${esc(t('map_core'))}</text><g id="l2-ranks"></g>`;
    svg.innerHTML = html;
    if (L2.hits) lab2Beams(L2.hits, false);
  }
  function lab2Beams(list, animate) {
    const svg = $('#l2-map');
    if (!svg || !L2.docs.length) return;
    const C = 320, R = 232, n = L2.docs.length;
    const best = {};
    (list || []).forEach((s, rank) => { if (!best[s.doc] || best[s.doc].score < s.score) best[s.doc] = {score: s.score, rank: best[s.doc] ? best[s.doc].rank : rank + 1}; });
    const max = Math.max(0.0001, ...Object.values(best).map(b => b.score));
    let beams = '', ranks = '';
    svg.querySelectorAll('g.doc').forEach(g => {
      const b = best[g.dataset.doc];
      g.classList.toggle('hit', !!b);
      g.classList.toggle('miss', !!list && !b);
      if (!b) return;
      const i = Number(g.dataset.i), a = -Math.PI / 2 + i * 2 * Math.PI / n;
      const x = C + R * Math.cos(a), y = C + R * Math.sin(a), len = Math.hypot(x - C, y - C);
      const w = 1 + 4.5 * (b.score / max);
      beams += `<line class="beam" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke-width="${w.toFixed(1)}" stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${animate ? len.toFixed(0) : 0}" opacity="${(0.35 + 0.65 * b.score / max).toFixed(2)}"/>`;
      const rx = C + (R - 26) * Math.cos(a), ry = C + (R - 26) * Math.sin(a);
      ranks += `<circle class="rbadge" cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="9"/><text class="rank" x="${rx.toFixed(1)}" y="${(ry + 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${b.rank}</text>`;
    });
    $('#l2-beams').innerHTML = beams;
    $('#l2-ranks').innerHTML = ranks;
    if (animate && MOTION) {
      gsap.to('#l2-beams .beam', {strokeDashoffset: 0, duration: 0.9, stagger: 0.08, ease: 'expo.out'});
      gsap.from('#l2-ranks > *', {autoAlpha: 0, scale: 0.4, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.05, delay: 0.4, ease: 'back.out(2)'});
    } else $$('#l2-beams .beam').forEach(b => b.setAttribute('stroke-dashoffset', 0));
  }
  $('#l2-map').addEventListener('pointerover', e => {
    const g = e.target.closest('g.doc');
    if (!g) return;
    const d = L2.docs[Number(g.dataset.i)] || {};
    $('#l2-tip').innerHTML = `<b>${esc(docNo(d))}</b>${esc(d.title || '')}`;
  });
  $('#l2-map').addEventListener('pointerleave', () => { $('#l2-tip').textContent = t('map_hint'); });
  $('#l2-map').addEventListener('click', e => { const g = e.target.closest('g.doc'); if (g) lab2Doc(g.dataset.doc); });
  function lab2Library() {
    $('#l2-libcount').textContent = String(L2.docs.length);
    setHTML($('#l2-docs'), L2.docs.map(d => `<button type="button" class="card-doc" data-doc="${esc(d.doc)}"><div class="dn">AGS-DOC-${esc(docNo(d))}</div>` +
      `<div class="dt">${esc(d.title)}</div><div class="dp">${esc(d.preview)}</div></button>`).join(''));
    if (!$('#l2-tip').textContent) $('#l2-tip').textContent = t('map_hint');
  }
  $('#l2-docs').addEventListener('click', e => { const c = e.target.closest('.card-doc'); if (c) lab2Doc(c.dataset.doc); });
  async function lab2Doc(name) {
    try {
      const d = await getJSON('/api/lab2/doc?name=' + encodeURIComponent(name));
      const txt = String(d.text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '');
      openSheet(d.title || name, d.doc || '', `<pre class="doc">${esc(txt)}</pre>`);
    } catch (e) {}
  }
  const L2STEPS = ['search', 'found', 'generate', 'done'];
  function lab2Steps(active, detail) {
    L2.step = active;
    if (detail) L2.detail = detail;
    const det = L2.detail || {};
    if (active === 'idle') { setHTML($('#l2-steps'), `<li class="pstep"><div class="pdot"></div><div><div class="pt">${esc(t('step_idle'))}</div></div></li>`); return; }
    const cur = L2STEPS.indexOf(active);
    setHTML($('#l2-steps'), L2STEPS.map((id, i) => {
      const state = i < cur || active === 'done' ? 'done' : i === cur ? 'active' : '';
      const vars = {n: id === 'found' ? (det.n || '') : L2.docCount, s: id === 'done' ? (det.total || '') : (det.s || '')};
      const d = STR.en['step_' + id + '_d'] ? t('step_' + id + '_d', vars) : '';
      return `<li class="pstep ${state}"><div class="pdot">${state === 'done' ? '✓' : ''}</div><div><div class="pt">${esc(t('step_' + id, vars))}</div>` +
        (state && d ? `<div class="pd">${esc(d)}</div>` : '') + '</div></li>';
    }).join(''));
  }
  function lab2Clock(on) {
    clearInterval(L2.clock);
    if (on) L2.clock = setInterval(() => { $('#l2-clock').textContent = secs((performance.now() - L2.t0) / 1000); }, 100);
  }
  async function lab2Ask() {
    const q = $('#l2-q').value.trim();
    if (!q || L2.busy) return;
    L2.busy = true; L2.q = q; L2.text = ''; L2.last = null; L2.sources = null; L2.hits = null; L2.detail = null;
    L2.t0 = performance.now();
    $('#l2-go').disabled = true;
    $('#l2-sources').hidden = true;
    $('#l2-answer').hidden = true;
    lab2Steps('search');
    lab2Clock(true);
    flow('flow2', ['q', 'embed', 'search', 'answer'], 'embed');
    lab2Beams(null, false);
    const core = $('#l2-core');
    if (core) core.classList.add('on');
    if (MOTION && $('#l2-scan')) gsap.fromTo('#l2-scan', {attr: {r: 40}, opacity: 0.9}, {attr: {r: 270}, opacity: 0, duration: 1.1, repeat: 2, ease: 'power2.out'});
    let failed = false;
    try {
      await streamNDJSON('/api/lab2/ask/stream', {question: q, lang: LANG, k: 5}, ev => {
        if (ev.event === 'retrieved') {
          L2.sources = ev.sources || [];
          L2.hits = L2.sources;
          lab2Steps('generate', {n: ev.count, s: num(ev.seconds)});
          flow('flow2', ['q', 'embed', 'search', 'answer'], 'answer');
          lab2Beams(L2.sources, true);
          lab2Sources(L2.sources);
          if (window.Die) Die.retrieve(ev.count || 5);
          $('#l2-answer').hidden = false;
          $('#l2-answer').innerHTML = lab2Card('<div class="stream" id="l2-live"></div>', '');
          waiting($('#l2-live'));
          popIn($('#l2-answer'));
        } else if (ev.event === 'delta') {
          L2.text += ev.text;
          const el = $('#l2-live');
          if (el) streamPut(el, ev.text);
          if (window.Die) Die.token();
        } else if (ev.event === 'answer') {
          flow('flow2', ['q', 'embed', 'search', 'answer'], 'answer', true);
          L2.last = ev;
          lab2Steps('done', Object.assign({}, L2.detail, {total: num(ev.seconds)}));
          lab2Answer(ev);
        } else if (ev.event === 'error') failed = true;
      });
    } catch (e) { failed = true; }
    lab2Clock(false);
    if (core) core.classList.remove('on');
    if (failed && !L2.last) {
      $('#l2-answer').hidden = false;
      $('#l2-answer').innerHTML = `<div class="plate-h"><span class="lbl ember">${esc(t('l2_answer'))}</span></div><div class="err">${esc(t('l2_unreach'))}</div>`;
      flow('flow2', ['q', 'embed', 'search', 'answer'], '');
      lab2Steps('idle');
    } else if (L2.last) {
      await plainAsk(q, $('#l2-plain'), $('#l2-plain-m'));
    }
    L2.busy = false;
    $('#l2-go').disabled = false;
  }
  function lab2Card(rightHtml, metaHtml) {
    const model = chatModelName();
    return `<div class="plate-h"><span class="lbl ember">${esc(t('l2_answer'))}</span><span class="count" id="l2-total"></span></div>` +
      `<p class="qecho"><b>${esc(t('l2_youasked'))}</b>${esc(L2.q)}</p>` +
      `<div class="duo"><div class="side"><div class="side-h"><span class="lbl">${esc(t('cmp2_before'))}</span><b>${esc(t('cmp2_before_d', {model}))}</b></div>` +
      `<div class="stream" id="l2-plain"><span class="dim">${esc(t('plain_wait'))}</span></div><div class="meta" id="l2-plain-m"></div></div>` +
      `<div class="side after"><div class="side-h"><span class="lbl">${esc(t('cmp2_after'))}</span><b>${esc(t('cmp2_after_d', {model, n: (L2.sources || []).length}))}</b></div>` +
      `${rightHtml}${metaHtml}</div></div><p class="aside-note ion">${esc(t('cmp2_note'))}</p>`;
  }
  function lab2Answer(d) {
    const via = d.source === 'sandbox' ? t('via_sandbox') : d.source === 'local-index' ? t('via_local') : '—';
    const body = d.error ? `<div class="err">${esc(t('l2_unreach2'))}</div>` : !d.answer ? `<div class="err">${esc(t('l2_noanswer'))}</div>` : `<div class="stream">${md(d.answer)}</div>`;
    const keep = $('#l2-plain') ? {html: $('#l2-plain').innerHTML, meta: $('#l2-plain-m').textContent} : null;
    $('#l2-answer').hidden = false;
    $('#l2-answer').innerHTML = lab2Card(body, `<div class="meta"><span>${esc(t('l2_docs_used', {n: (d.sources || []).length}))}</span>` +
      `<span>${esc(t('l2_total', {s: num(d.seconds)}))}</span><span>${esc(t('l2_via', {v: via}))}</span></div>`);
    if (keep) { $('#l2-plain').innerHTML = keep.html; $('#l2-plain-m').textContent = keep.meta; }
  }
  function lab2Sources(list) {
    if (!list || !list.length) { $('#l2-sources').hidden = true; return; }
    const max = Math.max(...list.map(s => s.score), 0.0001);
    const title = s => (L2.docs.find(d => d.doc === s.doc) || {}).title || s.title;  // the library's own title, not a file name
    setHTML($('#l2-srclist'), list.map((s, i) =>
      `<li class="src"><button type="button" class="src-h"><span class="rk">${String(i + 1).padStart(2, '0')}</span><span class="tt">${esc(title(s))}</span>` +
      `${meter(s.score / max * 100, 12)}<span class="pc">${Math.round(s.score * 100)}%</span></button><div class="passage">${esc(s.passage)}</div></li>`).join(''));
    $('#l2-sources').hidden = false;
  }
  $('#l2-srclist').addEventListener('click', e => { const h = e.target.closest('.src-h'); if (h) h.parentElement.classList.toggle('open'); });
  $('#l2-go').addEventListener('click', lab2Ask);
  $('#l2-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lab2Ask(); } });

  /* ----------------------------------------------------------- LAB 3 --- */
  const L3 = {info: null, dataset: null, busy: false, t0: 0, clock: null, calls: 0, lastChart: null, q: '', answered: false, stepEl: null};
  try { L3.dataset = localStorage.getItem('dgx-dataset') || null; } catch (e) {}
  async function lab3Load() {
    try { L3.info = await getJSON('/api/lab3/info?dataset=' + encodeURIComponent(L3.dataset || '')); } catch (e) { return; }
    lab3Render();
    renderHome();
  }
  function lab3Render() {
    const i = L3.info;
    if (!i) return;
    const ex = i.examples || {};
    setHTML($('#l3-examples'), qgroups(ex[LANG] || ex.vi || [], (q, gi) => gi === 0));
    const nc = i.nemoclaw || {};
    $('#l3-route').innerHTML = nc.ready ? `${lamp('ion')}<span>${esc(t('route_nemoclaw', {agent: nc.agent}))}</span>`
      : `${lamp('on')}<span>${esc(t('route_direct', {model: i.chat_model}))}</span>`;
    const d = i.dataset;
    if (!i.tools_ok) $('#l3-dserr').innerHTML = `<div class="err" style="margin-top:14px">${esc(t('err_tools'))}</div>`;
    if (!d || d.error) { if (d && d.error) $('#l3-dserr').innerHTML = `<div class="err" style="margin-top:14px">${esc(d.error)}</div>`; return; }
    $('#l3-dsname').textContent = d.name;
    $('#l3-dsmeta').textContent = t('ds_meta', {n: num(d.rows, 0), c: d.columns.length, s: d.sheet});
    $('#l3-dsdl').href = '/api/lab3/dataset?name=' + encodeURIComponent(d.name);
    $('#l3-reset').hidden = !!d.default;
    setHTML($('#l3-preview'), '<table class="data"><thead><tr>' + d.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
      d.preview.map(r => '<tr>' + r.map(v => `<td>${esc(typeof v === 'number' && !Number.isInteger(v) ? num(v, 1) : v)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
  }
  $('#l3-examples').addEventListener('click', e => { const r = e.target.closest('.qrow'); if (r) { $('#l3-q').value = r.dataset.q; lab3Run(); } });
  function lab3Flow(active) { flow('flow3', ['user', 'nc', 'py', 'out'], active === 'done' ? 'out' : active, active === 'done'); }
  function trace(kind, title, sub, extra) {
    const li = document.createElement('li');
    li.className = 'tstep k-' + kind;
    const at = '+' + ((performance.now() - L3.t0) / 1000).toFixed(1) + 's';
    li.innerHTML = `<div class="tt"><span class="at">${at}</span><span>${title}</span></div>` + (sub ? `<div class="ts">${sub}</div>` : '') + (extra || '');
    $('#l3-trace').appendChild(li);
    popIn(li);
    return li;
  }
  function argList(args) {
    const entries = Object.entries(args || {});
    if (!entries.length) return '';
    return '<dl class="argl">' + entries.map(([k, v]) => {
      const s = Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ') : typeof v === 'string' ? v : JSON.stringify(v);
      return `<dt>${esc(k)}</dt><dd>${esc(s.length > 220 ? s.slice(0, 218) + '…' : s)}</dd>`;
    }).join('') + '</dl>';
  }
  function toolResult(ev) {
    const ui = ev.ui || {};
    if (!ev.ok) {
      const hint = ui.available_columns || ui.available_values;
      return `<div class="err" style="margin-top:8px">${esc(ui.error || 'error')}${hint ? `<br>→ ${esc(hint.slice(0, 12).join(', '))}` : ''}</div>`;
    }
    if (ev.name === 'get_dataset_info') return `<div class="ts">${esc(ui.summary || '')}</div>` + (ui.columns ? `<div class="ts" style="font-family:var(--mono);font-size:12px">${esc(ui.columns.join(' · '))}</div>` : '');
    if (ev.name === 'analyze_sales') {
      const tb = ui.table || {columns: [], rows: []};
      const table = '<table class="data"><thead><tr>' + tb.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
        tb.rows.map(r => '<tr>' + r.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      return `<ul class="hl">${(ui.highlights || []).map(h => `<li>${esc(h)}</li>`).join('')}</ul>` +
        `<details class="log" style="margin-top:10px"><summary>${esc(t('tr_table'))}</summary><div class="tablewrap">${table}</div></details>`;
    }
    if (ev.name === 'create_chart' && ev.image_url) return `<img class="thumb" src="${esc(ev.image_url)}" alt="${esc(ui.title || '')}" data-zoom="1">`;
    if (ev.name === 'export_excel_report' && ev.file_url) {
      return `<div class="files"><a class="textlink" href="${esc(ev.file_url)}"><span>${esc(t('tr_download'))} · ${esc(ui.file || '')}</span><span>↓</span></a></div>` +
        (ui.sheets ? `<div class="ts">${esc(ui.sheets.join(' · '))}</div>` : '');
    }
    return '';
  }
  function lab3Clock(on) {
    clearInterval(L3.clock);
    if (on) L3.clock = setInterval(() => { $('#l3-clock').textContent = secs((performance.now() - L3.t0) / 1000); }, 100);
  }
  async function lab3Run() {
    const q = $('#l3-q').value.trim();
    if (!q || L3.busy) return;
    Object.assign(L3, {busy: true, calls: 0, lastChart: null, q, t0: performance.now(), answered: false});
    $('#l3-go').disabled = true;
    $('#l3-trace').innerHTML = '';
    $('#l3-traceplate').hidden = false;
    $('#l3-answer').hidden = true;
    $('#f3-user-d').textContent = '“' + (q.length > 40 ? q.slice(0, 38) + '…' : q) + '”';
    lab3Flow('user');
    lab3Clock(true);
    $('#l3-traceplate').scrollIntoView({behavior: MOTION ? 'smooth' : 'auto', block: 'start'});
    let thinking = null;
    try {
      await streamNDJSON('/api/lab3/run', {question: q, lang: LANG, route: 'auto', dataset: L3.dataset}, ev => {
        const e = ev.event;
        if (e === 'start') {
          const nc = ev.route === 'nemoclaw';
          trace('llm', esc(nc ? t('tr_start_nc', {agent: ev.agent, model: ev.model}) : t('tr_start_direct', {model: ev.model})), esc(ev.data || ''));
        } else if (e === 'fallback') trace('err', esc(t('tr_fallback')), esc(ev.reason || ''));
        else if (e === 'llm') {
          lab3Flow('nc');
          thinking = trace('llm', `<i class="spinner" style="display:inline-block;vertical-align:-1px"></i> ${esc(t('tr_thinking', {n: ev.step}))}`);
        } else if (e === 'llm_done') {
          if (thinking) {
            thinking.querySelector('.tt span:last-child').textContent = ev.tool_calls ? t('tr_thought', {s: num(ev.seconds), k: ev.tool_calls})
              : ev.nudge ? t('tr_draft', {s: num(ev.seconds)}) : t('tr_final', {s: num(ev.seconds)});
            thinking = null;
          }
        } else if (e === 'thought') trace('llm', '', '', `<div class="thought">${md(ev.text)}</div>`);
        else if (e === 'nudge') {
          trace('llm', esc(ev.reason === 'described' ? t('tr_nudge_described') : ev.reason === 'no_analysis' ? t('tr_nudge_figures')
            : ev.reason === 'figures' ? t('tr_nudge_quote') : t('tr_nudge', {m: (ev.missing || []).map(n => t('tool_' + n)).join(', ')})));
        } else if (e === 'tool_call') {
          L3.calls++;
          lab3Flow('py');
          if (window.Die) Die.tool();
          L3.stepEl = trace('call', `${esc(t('tool_' + ev.name))} <code>${esc(ev.name)}()</code>`, '', argList(ev.args));
        } else if (e === 'tool_result') {
          const el = L3.stepEl;
          if (el) {
            el.classList.remove('k-call');
            el.classList.add(ev.ok ? 'k-res' : 'k-err');
            el.insertAdjacentHTML('beforeend', `<div class="ts">${esc(ev.ok ? t('tr_result', {s: num(ev.seconds, 2)}) : t('tr_error'))}</div>` + toolResult(ev));
          }
          if (ev.ok && ev.image_url) L3.lastChart = ev.image_url;
        } else if (e === 'delta') {
          if (window.Die) Die.token();
        } else if (e === 'answer') {
          lab3Flow('done');
          lab3Answer(ev);
        } else if (e === 'error') {
          const msg = ev.message === 'busy' ? t('err_busy') : /missing Python package/.test(ev.message || '') ? t('err_tools') : t('err_generic', {e: ev.message});
          trace('err', esc(msg));
          lab3Flow('');
        }
      });
    } catch (err) {
      trace('err', esc(t('err_generic', {e: err.message || err})));
      lab3Flow('');
    }
    lab3Clock(false);
    $('#l3-clock').textContent = secs((performance.now() - L3.t0) / 1000);
    if (L3.answered) await plainAsk(q, $('#l3-plain'), $('#l3-plain-m'));
    L3.busy = false;
    $('#l3-go').disabled = false;
    lab3Load();
  }
  function lab3Answer(ev) {
    L3.answered = true;
    $('#l3-answer').hidden = false;
    $('#l3-before-d').textContent = t('cmp3_before_d', {model: chatModelName() || ev.model || ''});
    $('#l3-after-d').textContent = t('cmp3_after_d', {n: L3.calls});
    $('#l3-plain').innerHTML = `<span class="dim">${esc(t('plain_wait'))}</span>`;
    $('#l3-plain-m').textContent = '';
    $('#l3-qecho').innerHTML = `<b>${esc(t('an_question'))}</b>${esc(L3.q)}`;
    $('#l3-text').innerHTML = md(ev.text || '') + (ev.unverified ? `<div class="warn-line"><span>✳</span><span>${esc(t('an_unverified', {f: ev.unverified.slice(0, 6).join(', ')}))}</span></div>` : '');
    $('#l3-meta').innerHTML = `<span>${esc(t('an_meta', {s: num(ev.seconds), n: L3.calls, r: ev.route === 'nemoclaw' ? t('an_route_nc') : t('an_route_direct')}))}</span>`;
    const reports = (ev.files || []).filter(f => f.kind === 'report');
    $('#l3-files').innerHTML = reports.map(f => `<a class="textlink" href="${esc(f.url)}"><span>${esc(t('tr_download'))} · ${esc(f.name)}</span><span>↓</span></a>`).join('');
    const chart = L3.lastChart || ((ev.files || []).find(f => f.kind === 'chart') || {}).url;
    $('#l3-chart').innerHTML = chart ? `<div class="paper"><img src="${esc(chart)}" alt="chart" data-zoom="1"></div>` : '';
    $('#l3-answer').scrollIntoView({behavior: MOTION ? 'smooth' : 'auto', block: 'start'});
    popIn($('#l3-answer'));
  }
  document.addEventListener('click', e => {
    const img = e.target.closest('img[data-zoom]');
    if (img) openSheet(img.alt || '', '', `<img class="big" src="${esc(img.src)}" alt="">`);
  });
  $('#l3-go').addEventListener('click', lab3Run);
  $('#l3-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lab3Run(); } });
  $('#l3-upload').addEventListener('click', () => $('#l3-file').click());
  $('#l3-file').addEventListener('change', async () => {
    const f = $('#l3-file').files[0];
    if (!f) return;
    $('#l3-dserr').innerHTML = `<div class="stage" style="margin-top:14px"><i class="spinner"></i><span>${esc(t('ds_uploading'))}</span></div>`;
    try {
      const res = await fetch('/api/lab3/upload', {method: 'POST', headers: {'X-Filename': encodeURIComponent(f.name)}, body: f});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.status);
      L3.dataset = j.name;
      try { localStorage.setItem('dgx-dataset', j.name); } catch (e) {}
      $('#l3-dserr').innerHTML = '';
      await lab3Load();
    } catch (err) {
      $('#l3-dserr').innerHTML = `<div class="err" style="margin-top:14px">${esc(t('ds_bad', {e: err.message || err}))}</div>`;
    }
    $('#l3-file').value = '';
  });
  $('#l3-reset').addEventListener('click', async () => {
    L3.dataset = null;
    try { localStorage.removeItem('dgx-dataset'); } catch (e) {}
    await lab3Load();
  });

  /* ------------------------------------------------------ ENTERPRISE --- */
  const ENT = {demo: 'inbox', engine: 'vllm', data: null, rows: [], samples: {}, only: 'all', built: '', costBuilt: '', seen: {}};
  try { ENT.demo = localStorage.getItem('ent-demo') || 'inbox'; ENT.engine = localStorage.getItem('ent-engine') || 'vllm'; } catch (e) {}
  const ENT_DEMOS = ['inbox', 'invoices', 'calls'];
  if (!ENT_DEMOS.includes(ENT.demo)) ENT.demo = 'inbox';
  const ENT_ACTIVE = ['running', 'stopping', 'engine', 'preparing'];
  const ENT_TIERS = {frontier: [3, 15], mid: [1.25, 10], mini: [0.25, 2]};
  const ENT_COST = {inbox_month: 60000, invoices_month: 10000, calls_month: 20000, asr_min: 0.006, tier: 'mid', usd: 26000, kwh: 3000, watts: 240, box: 100000000, months: 36};
  try { Object.assign(ENT_COST, JSON.parse(localStorage.getItem('ent-cost') || '{}')); } catch (e) {}
  const ENT_FIELDS = {inbox: ['category', 'urgency', 'sentiment', 'order'],
                      invoices: ['tax_code', 'series', 'number', 'date', 'subtotal', 'vat', 'total', 'lines'],
                      calls: ['greeting', 'disclosure', 'verification', 'empathy', 'resolution', 'closing', 'violations', 'asr']};
  function entDur(s) {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    const U = LANG === 'vi' ? ['giờ', 'phút', 'giây'] : ['h', 'min', 's'];
    if (h) return `${h} ${U[0]} ${m} ${U[1]}`;
    if (m) return `${m} ${U[1]}` + (m < 10 && x ? ` ${x} ${U[2]}` : '');
    return `${x} ${U[2]}`;
  }
  const vnd = v => num(Math.round(v), 0) + ' đ';
  const usd = v => '$' + num(v, v < 10 ? 2 : 0);
  const mark = (ok, label) => `<span class="mk ${ok ? 'y' : 'n'}">${ok ? '✓' : '✕'}${label ? ' ' + esc(label) : ''}</span>`;
  const entCur = () => ENT.data && ENT.data.demos && ENT.data.demos[ENT.demo];
  const engName = () => (ENT.data && ENT.data.engine_name) || 'llama.cpp';
  function entEngineOk() {
    const d = ENT.data;
    if (!d) return false;
    if (ENT.demo === 'calls' && !(d.installed && d.installed.asr && d.demos && d.demos.calls && d.demos.calls.ready)) return false;
    return ENT.engine === 'ollama' ? !!d.ollama_ready : !!(d.installed && d.installed.image && d.installed.model);
  }
  function entRender() { entEngine(); entJobs(); entPanel(); entLive(); entCostForm(); entCostCalc(); entFeedRender(); }
  function entEngine() {
    const d = ENT.data, box = $('#ent-engine');
    if (!d) { setHTML(box, `<div><div class="eh">${esc(t('ent_engine'))}</div><div class="ev">${lamp('')}${esc(t('ent_loading'))}</div></div>`); return; }
    const e = d.engine || {}, inst = d.installed || {};
    let kind = '', state = t('ent_eng_off'), sub = esc(t('ent_eng_off_d'));
    if (!inst.image || !inst.model) { kind = 'bad'; state = t('ent_eng_missing'); sub = esc(t('ent_eng_missing_d')); }
    else if (e.ready) { kind = 'on'; state = t('ent_eng_ready'); sub = `<b>${esc(d.engine_model)}</b> · ${esc(engName())}`; }
    else if (e.container === 'running') {
      kind = 'busy'; state = t('ent_eng_starting');
      sub = esc(t('ent_phase_' + (e.phase || 'starting')) + (e.percent != null ? ` ${e.percent}%` : '') + (e.seconds ? ' · ' + entDur(e.seconds) : ''));
    } else if (e.phase === 'failed') { kind = 'bad'; state = t('ent_eng_failed'); sub = esc(t('ent_eng_failed_d')); }
    const g = (TEL && TEL.gpu) || {};
    const power = d.power_w != null ? num(d.power_w, 0) + ' W' : '—';
    const util = g.util != null ? num(g.util, 0) + '%' : '—';
    const mem = d.memory ? t('ent_mem', {a: num(d.memory.available_gb, 0), t: num(d.memory.total_gb, 0)}) : '';
    const btn = e.container === 'running'
      ? `<button type="button" class="act ghost" data-ent="engine-stop">${esc(t('ent_eng_stop'))}</button>`
      : `<button type="button" class="act ghost" data-ent="engine-start"${inst.image && inst.model ? '' : ' disabled'}>${esc(t('ent_eng_start'))}</button>`;
    setHTML(box,
      `<div><div class="eh">${esc(t('ent_engine'))}</div><div class="ev">${lamp(kind)}${esc(state)}</div><div class="es">${sub}</div></div>` +
      `<div><div class="eh">${esc(t('ent_gpu_now'))}</div><div class="ev">${esc(util)}<span class="count">${esc(power)}</span></div><div class="es">${esc(mem)}</div></div>` +
      `<div><div class="eh">${esc(t('ent_run_on'))}</div><div class="switch" data-on="${ENT.engine === 'ollama' ? 1 : 0}"><i class="knob"></i>` +
      `<button type="button" data-ent-engine="vllm" class="${ENT.engine === 'vllm' ? 'on' : ''}">${esc(t('ent_eng_batch', {e: engName()}))}</button>` +
      `<button type="button" data-ent-engine="ollama" class="${ENT.engine === 'ollama' ? 'on' : ''}">${esc(t('ent_eng_ollama'))}</button></div>` +
      `<div class="acts">${btn}</div></div>`);
  }
  function entJobs() {
    const d = ENT.data;
    setHTML($('#ent-jobs'), ENT_DEMOS.map((k, i) => {
      const s = d && d.demos && d.demos[k];
      const pct = s && s.total ? s.processed / s.total * 100 : 0;
      let status = '—';
      if (s) status = ENT_ACTIVE.includes(s.status)
        ? t('ent_st_' + s.status) + (s.status === 'running' && s.rate_per_min ? ' · ' + t('ent_rate', {n: num(s.rate_per_min, 0)}) : '')
        : s.processed ? t('ent_done_n', {n: num(s.processed, 0), t: num(s.total, 0)}) : t('ent_ready_n', {t: num(s.total, 0)});
      return `<button type="button" class="job${ENT.demo === k ? ' on' : ''}" data-ent-demo="${k}"><div class="jk">0${i + 1} · ${esc(t('ent_' + k + '_k'))}</div>` +
        `<h3>${esc(t('ent_' + k + '_n'))}</h3><p>${esc(t('ent_' + k + '_d'))}</p>${meter(pct, 24, 'ember')}` +
        `<div class="jp"><span>${esc(status)}</span><span>${num(Math.floor(pct), 0)}%</span></div></button>`;
    }).join(''));
  }
  function entPanel() {
    const k = ENT.demo, key = k + LANG + ENT.only;
    if (ENT.built === key) return;
    ENT.built = key;
    const d = ENT.data || {};
    const model = d.engine_model ? `${d.engine_model} · GPU` : 'GPU';
    $('#ent-panel').innerHTML =
      `<div class="panel-head"><span class="lbl">${esc(t('ent_job'))}</span><h2>${esc(t('ent_' + k + '_n'))}</h2><p>${esc(t('ent_' + k + '_long'))}</p>` +
      `<div class="io"><span>${esc(t('ent_' + k + '_in'))}</span><i>→</i>` + (k === 'calls' ? `<span class="ai">${esc(t('ent_asr'))}</span><i>→</i>` : '') +
      `<span class="ai" id="ent-io-model">${esc(model)}</span><i>→</i><span>${esc(t('ent_' + k + '_out'))}</span></div></div>` +
      `<div class="acts" id="ent-ctl" style="margin-top:26px"></div><div class="runbar" id="ent-runbar"><i></i></div><div class="runline" id="ent-runline"></div>` +
      `<div class="kpis" id="ent-kpis"></div><div class="sub2">${esc(t('ent_acc_h'))}</div><div class="accgrid" id="ent-acc"></div><div id="ent-hl"></div>` +
      `<div class="feedhead"><span class="lbl">${esc(t('ent_feed_h'))}</span><div class="tabs2">` +
      ['all', 'review'].map(o => `<button type="button" data-ent-only="${o}" class="${ENT.only === o ? 'on' : ''}">${esc(t('ent_only_' + o))}</button>`).join('') +
      `</div></div><div class="tablewrap"><table class="data" id="ent-feed"></table></div><p class="note-s" id="ent-feednote"></p>`;
  }
  function entLive() {
    const s = entCur(), k = ENT.demo;
    if (!$('#ent-ctl')) return;
    const active = !!(s && ENT_ACTIVE.includes(s.status));
    const left = s ? Math.max(0, s.total - s.processed) : 0;
    const can = !!(s && !active && left > 0 && entEngineOk());
    const n = {inbox: 300, invoices: 100, calls: 30}[k];
    setHTML($('#ent-ctl'),
      `<button type="button" class="act primary" data-ent="run" data-n="${n}"${can ? '' : ' disabled'}><span class="k">▶</span>${esc(t('ent_run_n', {n}))}</button>` +
      `<button type="button" class="act" data-ent="run" data-n="100000"${can ? '' : ' disabled'}>${esc(t('ent_run_all', {n: num(left, 0)}))}</button>` +
      `<button type="button" class="act danger" data-ent="stop"${active ? '' : ' disabled'}>${esc(t('ent_stop'))}</button>` +
      `<button type="button" class="act ghost" data-ent="export"${s && s.processed ? '' : ' disabled'}>${esc(t('ent_export'))} ↓</button>` +
      `<button type="button" class="act ghost" data-ent="reset"${s && s.processed && !active ? '' : ' disabled'}>${esc(t('ent_reset'))}</button>`);
    const run = (s && s.run) || {};
    const bar = $('#ent-runbar');
    bar.style.visibility = active || run.target ? 'visible' : 'hidden';
    bar.querySelector('i').style.width = (run.target ? Math.min(100, run.done / run.target * 100) : 0) + '%';
    let line = '';
    if (s) {
      const eng = run.engine === 'ollama' ? t('ent_eng_line_ollama') : t('ent_eng_line_batch', {e: engName(), c: run.concurrency || ''});
      if (s.status === 'engine' || s.status === 'preparing') {
        const e = (ENT.data && ENT.data.engine) || {};
        line = t('ent_st_' + s.status) + (s.status === 'engine' ? ' · ' + t('ent_phase_' + (e.phase || 'starting')) + (e.percent != null ? ` ${e.percent}%` : '') : '') + '…';
      } else if (active) {
        line = t('ent_runline', {d: num(run.done || 0, 0), t: num(run.target || 0, 0), r: num(s.rate_per_min || 0, 0), e: s.eta_s != null ? entDur(s.eta_s) : '—', eng});
      } else if (s.message === 'finished' || s.message === 'stopped') {
        line = t('ent_msg_' + s.message) + (run.done ? ' ' + t('ent_runline_done', {d: num(run.done, 0), r: num(s.rate_per_min || 0, 0), eng}) : '');
      } else if (s.message === 'interrupted') line = t('ent_msg_interrupted');
      else if (String(s.message || '').startsWith('engine:')) line = t('ent_msg_error', {m: s.message.slice(7)});
      if (!entEngineOk() && ENT.data) line = k === 'calls' && !(ENT.data.installed && ENT.data.installed.asr && s.ready) ? t('ent_calls_missing')
        : ENT.engine === 'ollama' ? t('ent_no_ollama', {m: ENT.data.ollama_model}) : t('ent_eng_missing_d');
    }
    setHTML($('#ent-runline'), esc(line));
    const tot = (s && s.totals) || {}, acc = (s && s.accuracy) || {};
    const accMain = {inbox: acc.category, invoices: acc.total, calls: acc.checklist}[k];
    const cells = [
      ['done', s ? `${num(s.processed, 0)} / ${num(s.total, 0)}` : '—', 'ent_k_done'],
      ['rate', s && s.rate_per_min ? num(s.rate_per_min, 0) : '—', 'ent_k_rate'],
      active ? ['eta', s.eta_s != null ? entDur(s.eta_s) : '—', 'ent_k_eta'] : ['busy', tot.busy_s ? entDur(tot.busy_s) : '—', 'ent_k_busy'],
      ['acc', s && s.processed && accMain != null ? num(accMain, 1) + '%' : '—', 'ent_k_acc_' + k],
      ['wh', tot.wh ? num(tot.wh, 1) + ' Wh' : '—', 'ent_k_wh'],
      k === 'calls' ? ['audio', s && s.audio_min ? num(s.audio_min, 0) : '—', 'ent_k_audio']
        : ['tokens', tot.tokens_in ? num((tot.tokens_in + tot.tokens_out) / 1e6, 2) + ' M' : '—', 'ent_k_tokens'],
    ];
    setHTML($('#ent-kpis'), cells.map(([id, v, l]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(t(l))}</span></div>`).join(''));
    setHTML($('#ent-acc'), ENT_FIELDS[k].map(f => {
      const v = acc[f];
      const shown = s && s.processed && v != null;
      return `<div class="acc"><div class="ah"><span>${esc(t('ent_f_' + f))}</span><b>${shown ? num(v, 1) + '%' : '—'}</b></div>${meter(shown ? v : 0, 20, 'lime')}</div>`;
    }).join(''));
    let hl = '';
    if (s && s.processed) {
      if (k === 'inbox' && s.critical) hl = t('ent_hl_inbox', {f: num(s.critical.found, 0), o: num(s.critical.of, 0)});
      if (k === 'invoices' && s.problems) hl = t('ent_hl_invoices', {c: num(s.problems.caught, 0), p: num(s.problems.planted, 0),
        d: num(s.problems.duplicates, 0), fa: num(s.problems.false_alarms, 0), v: num(s.value || 0, 0)});
      if (k === 'calls' && s.violations) hl = t('ent_hl_calls', {f: num(s.violations.found, 0), o: num(s.violations.of, 0),
        a: num(s.avg_score || 0, 0), n: num(s.failed || 0, 0), m: num(s.audio_min || 0, 0)});
    }
    setHTML($('#ent-hl'), hl ? `<div class="banner"><span>${esc(hl)}</span></div>` : `<p class="note-s">${esc(t('ent_hl_none'))}</p>`);
  }
  async function entFeed() {
    if (!$('#ent-feed')) return;
    const demo = ENT.demo;
    try {
      const j = await getJSON(`/api/ent/feed?demo=${demo}&limit=60&only=${ENT.only}`);
      if (demo !== ENT.demo) return;
      ENT.rows = j.rows || [];
    } catch (e) { return; }
    if (!ENT.rows.length && !ENT.samples[demo]) {
      try { ENT.samples[demo] = (await getJSON('/api/ent/samples?demo=' + demo)).rows || []; } catch (e) {}
    }
    entFeedRender();
  }
  function entFeedRender() {
    const tb = $('#ent-feed');
    if (!tb) return;
    const k = ENT.demo, rows = ENT.rows || [];
    if (!rows.length) {
      const smp = ENT.only === 'all' ? (ENT.samples[k] || []) : [];
      setHTML(tb, k === 'inbox'
        ? `<tr><th>${esc(t('ent_th_id'))}</th><th>${esc(t('ent_th_channel'))}</th><th>${esc(t('ent_th_msg'))}</th></tr>` +
          smp.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(EL('ch', r.channel))}</td><td class="wrap">${esc(r.text)}</td></tr>`).join('')
        : k === 'calls'
        ? `<tr><th>${esc(t('ent_th_call'))}</th><th>${esc(t('ent_th_len'))}</th></tr>` +
          smp.map(r => `<tr class="click" data-audio="${esc(r.file)}"><td>${esc(r.id)}</td><td>${esc(entDur(r.seconds))}</td></tr>`).join('')
        : `<tr><th>${esc(t('ent_th_file'))}</th><th>${esc(t('ent_f_seller'))}</th></tr>` +
          smp.map(r => `<tr class="click" data-img="${esc(r.file)}"><td>${esc(r.file)}</td><td>${esc(r.seller)}</td></tr>`).join(''));
      setHTML($('#ent-feednote'), esc(smp.length ? t('ent_samples_note') : ''));
      return;
    }
    if (k === 'calls') {
      setHTML(tb, `<tr><th>${esc(t('ent_th_call'))}</th><th>${esc(t('ent_th_len'))}</th><th>${esc(t('ent_th_topic'))}</th>` +
        `<th>${esc(t('ent_th_score'))}</th><th>${esc(t('ent_th_result'))}</th><th>${esc(t('ent_th_check'))}</th></tr>` +
        rows.map(r => {
          const p = r.pred || {}, ok = r.ok || {};
          const right = Object.values(ok).filter(Boolean).length, all = Object.keys(ok).length;
          const res = p.passed ? `<span class="ok-t">${esc(t('ent_pass'))}</span>`
            : `<span class="bad-t">${esc(t('ent_fail_qa'))}${(p.violations || []).length ? ' · ' + esc(p.violations.map(v => EL('viol', v)).join(', ')) : ''}</span>`;
          return `<tr class="click" data-id="${esc(r.id)}"><td>${esc(r.id)}</td><td>${esc(entDur(r.audio_s))}</td>` +
            (r.error ? `<td colspan="4" class="bad-t">${esc(r.error)}</td>` :
            `<td>${esc(EL('topic', p.topic))}</td><td class="num">${esc(p.score)}</td><td class="wrap" style="min-width:150px">${res}</td><td>${mark(right === all, `${right}/${all}`)}</td>`) + '</tr>';
        }).join(''));
    } else if (k === 'inbox') {
      setHTML(tb, `<tr><th>${esc(t('ent_th_id'))}</th><th>${esc(t('ent_th_channel'))}</th><th>${esc(t('ent_th_msg'))}</th>` +
        `<th>${esc(t('ent_f_category'))}</th><th>${esc(t('ent_f_urgency'))}</th><th>${esc(t('ent_th_check'))}</th></tr>` +
        rows.map(r => {
          const p = r.pred || {}, ok = r.ok || {};
          const txt = r.text.length > 150 ? r.text.slice(0, 150) + '…' : r.text;
          return `<tr class="click" data-id="${esc(r.id)}"><td>${esc(r.id)}</td><td>${esc(EL('ch', r.channel))}</td><td class="wrap">${esc(txt)}</td>` +
            (r.error ? `<td colspan="3" class="bad-t">${esc(r.error)}</td>` :
            `<td>${esc(EL('cat', p.category))}</td><td class="u-${esc(p.urgency)}">${esc(EL('urg', p.urgency))}</td><td>${mark(ok.category)} ${mark(ok.urgency)}</td>`) + '</tr>';
        }).join(''));
    } else {
      setHTML(tb, `<tr><th>${esc(t('ent_th_file'))}</th><th>${esc(t('ent_f_seller'))}</th><th>${esc(t('ent_f_number'))}</th>` +
        `<th>${esc(t('ent_f_total'))}</th><th>${esc(t('ent_th_checks'))}</th><th>${esc(t('ent_th_check'))}</th></tr>` +
        rows.map(r => {
          const p = r.pred || {}, ok = r.ok || {};
          const right = Object.values(ok).filter(Boolean).length, all = Object.keys(ok).length;
          const checks = (r.checks || []).length ? `<span class="bad-t">${esc(r.checks.map(c => EL('chk', c)).join(' · '))}</span>` : `<span class="ok-t">${esc(t('ent_ok'))}</span>`;
          return `<tr class="click" data-id="${esc(r.id)}"><td>${esc(r.file)}</td>` +
            (r.error ? `<td colspan="5" class="bad-t">${esc(r.error)}</td>` :
            `<td class="wrap" style="min-width:200px">${esc(p.seller_name || '—')}</td><td>${esc(p.number || '—')}</td>` +
            `<td class="num">${esc(num(p.total || 0, 0))}</td><td class="wrap" style="min-width:160px">${checks}</td><td>${mark(right === all, `${right}/${all}`)}</td>`) + '</tr>';
        }).join(''));
    }
    setHTML($('#ent-feednote'), esc(t('ent_feed_note')));
  }
  async function entCallDetail(id) {
    let d;
    try { d = await getJSON(`/api/ent/item?demo=calls&id=${encodeURIComponent(id)}`); } catch (e) { return; }
    const p = d.pred || {}, tr = d.truth || {}, ok = d.ok || {};
    const yes = v => (v ? t('ent_yes') : t('ent_no'));
    const row = (label, a, b, good) => `<tr><td>${esc(label)}</td><td class="wrap" style="min-width:90px">${esc(a)}</td><td class="wrap" style="min-width:90px">${esc(b)}</td><td>${good == null ? '' : mark(good)}</td></tr>`;
    const lines = (d.transcript || []).map(sg => `<div><span class="tt">${String(Math.floor(sg.start / 60)).padStart(2, '0')}:${String(Math.floor(sg.start % 60)).padStart(2, '0')}</span>` +
      `<span class="${sg.speaker === 'agent' ? 'ag' : 'cu'}">${esc(t(sg.speaker === 'agent' ? 'ent_agent' : 'ent_customer'))}</span><span>${esc(sg.text)}</span></div>`).join('');
    const viol = v => (v || []).map(x => EL('viol', x)).join(', ') || '—';
    openSheet(d.id, `${d.agent || ''} · ${EL('topic', p.topic || d.scenario)} · ${entDur(d.seconds)}`,
      `<div class="det"><audio controls preload="metadata" src="/api/ent/call/${esc(d.file)}"></audio>` +
      `<div class="scorebig"><b>${esc(p.score != null ? p.score : '—')}</b><span>${esc(t('ent_score_of', {s: tr.score}))}</span></div>` +
      (p.summary ? `<p style="margin:0 0 16px;color:var(--fg-2)">${esc(p.summary)}</p>` : '') +
      `<div class="tablewrap" style="max-height:none"><table class="data"><tr><th></th><th>AI</th><th>${esc(t('ent_truth'))}</th><th></th></tr>` +
      ['greeting', 'disclosure', 'verification', 'empathy', 'closing'].map(c => row(t('ent_f_' + c), yes(p[c]), yes(tr[c]), ok[c])).join('') +
      row(t('ent_f_resolution'), EL('res', p.resolution), EL('res', tr.resolution), ok.resolution) +
      row(t('ent_f_violations'), viol(p.violations), viol(tr.violations), ok.violations) +
      row(t('ent_f_customer_end'), EL('cend', p.customer_end), EL('cend', tr.customer_end), ok.customer_end) + '</table></div>' +
      (p.coaching ? `<div class="sub2">${esc(t('ent_coaching'))}</div><p style="margin:0;color:var(--fg-2)">${esc(p.coaching)}</p>` : '') +
      `<div class="sub2">${esc(t('ent_transcript'))}${d.wer != null ? ' · ' + esc(t('ent_wer', {p: num(100 - d.wer * 100, 0)})) : ''}</div>` +
      `<div class="tscript">${lines || esc(t('ent_no_transcript'))}</div></div>`);
  }
  function entDetail(id) {
    if (ENT.demo === 'calls') { entCallDetail(id); return; }
    const r = (ENT.rows || []).find(x => x.id === id);
    if (!r) return;
    const p = r.pred || {};
    const tr3 = (label, a, b, ok) => `<tr><td>${esc(label)}</td><td class="wrap">${esc(a)}</td><td class="wrap">${esc(b)}</td><td>${ok == null ? '' : mark(ok)}</td></tr>`;
    const head = `<tr><th></th><th>AI</th><th>${esc(t('ent_truth'))}</th><th></th></tr>`;
    if (ENT.demo === 'inbox') {
      const tr = r.truth || {};
      const flags = f => (f || []).map(x => EL('flag', x)).join(', ') || '—';
      openSheet(r.id, `${EL('ch', r.channel)} · ${secs(r.seconds || 0)}`,
        `<div class="det"><blockquote>${esc(r.text)}</blockquote><div class="tablewrap" style="max-height:none"><table class="data">${head}` +
        tr3(t('ent_f_category'), EL('cat', p.category), EL('cat', tr.category), p.category === tr.category) +
        tr3(t('ent_f_urgency'), EL('urg', p.urgency), EL('urg', tr.urgency), p.urgency === tr.urgency) +
        tr3(t('ent_f_sentiment'), EL('sent', p.sentiment), EL('sent', tr.sentiment), p.sentiment === tr.sentiment) +
        tr3(t('ent_f_flags'), flags(p.flags), flags(tr.flags), null) +
        tr3(t('ent_f_order'), p.order_id || '—', tr.order_id || '—', (p.order_id || '') === (tr.order_id || '')) + '</table></div>' +
        (p.summary ? `<div class="sub2">${esc(t('ent_todo'))}</div><p style="margin:0;color:var(--fg-2)">${esc(p.summary)}</p>` : '') +
        (r.reply ? `<div class="sub2">${esc(t('ent_reply'))}</div><blockquote>${esc(r.reply)}</blockquote>` : '') + '</div>');
      return;
    }
    const tr = r.truth || {};
    const money = v => (v == null ? '—' : num(v, 0));
    const lines = (p.items || []).map(l => `<tr><td class="wrap" style="min-width:160px">${esc(l.desc)}</td><td>${esc(l.unit)}</td>` +
      `<td class="num">${esc(num(l.qty, 2))}</td><td class="num">${esc(money(l.price))}</td><td class="num">${esc(money(l.amount))}</td></tr>`).join('');
    const checks = (r.checks || []).length
      ? r.checks.map(c => `<div class="bad-t">✕ ${esc(EL('chk', c))}${c === 'duplicate' && r.duplicate_of ? ' (' + esc(r.duplicate_of) + ')' : ''}</div>`).join('')
      : `<div class="ok-t">✓ ${esc(t('ent_ok'))}</div>`;
    openSheet(r.file, `${p.seller_name || ''} · ${secs(r.seconds || 0)}`,
      `<div class="det"><div class="two"><img src="/api/ent/invoice/${esc(r.file)}" alt="${esc(r.file)}" data-zoom="1"><div>` +
      `<div class="sub2" style="margin-top:0">${esc(t('ent_th_checks'))}</div>${checks}` +
      ((r.planted || []).length ? `<p class="note-s">${esc(t('ent_planted', {p: r.planted.map(c => EL('chk', c)).join(', ')}))}</p>` : '') +
      `<div class="sub2">${esc(t('ent_extracted'))}</div><div class="tablewrap" style="max-height:none"><table class="data">${head}` +
      tr3(t('ent_f_seller'), p.seller_name, '', null) +
      tr3(t('ent_f_tax_code'), p.seller_tax_code, tr.seller_tax_code, p.seller_tax_code === tr.seller_tax_code) +
      tr3(t('ent_f_series'), p.series, tr.series, p.series === tr.series) +
      tr3(t('ent_f_number'), p.number, tr.number, Number(p.number) === Number(tr.number)) +
      tr3(t('ent_f_date'), p.date, tr.date, p.date === tr.date) +
      tr3(t('ent_f_subtotal'), money(p.subtotal), money(tr.subtotal), p.subtotal === tr.subtotal) +
      tr3(t('ent_f_vat') + (p.vat_rate != null ? ` (${p.vat_rate}%)` : ''), money(p.vat), money(tr.vat), p.vat === tr.vat) +
      tr3(t('ent_f_total'), money(p.total), money(tr.total), p.total === tr.total) + '</table></div></div></div>' +
      `<div class="sub2">${esc(t('ent_items'))}</div><div class="tablewrap" style="max-height:none"><table class="data">` +
      `<tr><th>${esc(t('ent_th_desc'))}</th><th>${esc(t('ent_th_unit'))}</th><th>${esc(t('ent_th_qty'))}</th><th>${esc(t('ent_th_price'))}</th><th>${esc(t('ent_th_amount'))}</th></tr>` +
      lines + '</table></div></div>');
  }
  function entCostForm() {
    const key = ENT.demo + LANG;
    if (ENT.costBuilt === key || !$('#ent-cost')) return;
    ENT.costBuilt = key;
    const c = ENT_COST, k = ENT.demo;
    const fld = (id, label, step) => `<label class="fld"><span>${esc(label)}</span><input type="number" min="0" step="${step || 'any'}" data-cost="${id}" value="${c[id]}"></label>`;
    $('#ent-cost').innerHTML = '<div>' + fld(k + '_month', t('ent_c_month'), 1000) +
      `<label class="fld"><span>${esc(t('ent_c_tier'))}</span><select data-cost="tier">` +
      Object.keys(ENT_TIERS).map(x => `<option value="${x}"${c.tier === x ? ' selected' : ''}>${esc(t('ent_tier_' + x))}</option>`).join('') + '</select></label>' +
      (k === 'calls' ? fld('asr_min', t('ent_c_asr'), 0.001) : '') +
      fld('usd', t('ent_c_usd'), 100) + fld('kwh', t('ent_c_kwh'), 100) + fld('watts', t('ent_c_watts'), 10) +
      fld('box', t('ent_c_box'), 1000000) + fld('months', t('ent_c_months'), 1) +
      `<p class="note-s">${esc(t('ent_c_note'))}</p></div><div id="ent-costout"></div>`;
  }
  function entMonthly(k) {
    const s = ENT.data && ENT.data.demos && ENT.data.demos[k], tot = (s && s.totals) || {}, c = ENT_COST;
    const n = tot.items || 0;
    if (!n || !tot.busy_s || !tot.tokens_in) return null;
    const [pin, pout] = ENT_TIERS[c.tier] || ENT_TIERS.mid;
    const per = (tot.tokens_in / n * pin + tot.tokens_out / n * pout) / 1e6 + (k === 'calls' ? (tot.audio_s || 0) / n / 60 * (c.asr_min || 0) : 0);
    const vol = c[k + '_month'] || 0;
    return {cloud: per * vol, hours: vol * tot.busy_s / n / 3600};
  }
  const costRow = (cls, label, big, small) => `<div class="costrow ${cls}"><span>${esc(label)}${small ? `<small>${esc(small)}</small>` : ''}</span><b>${esc(big)}</b></div>`;
  function entCostCalc() {
    const out = $('#ent-costout');
    if (!out) return;
    const c = ENT_COST, k = ENT.demo, s = entCur(), tot = (s && s.totals) || {};
    const n = tot.items || 0;
    if (!n || !tot.busy_s || !tot.tokens_in) { setHTML(out, `<p class="note-s" style="margin:0">${esc(t('ent_c_wait'))}</p>`); return; }
    const [pin, pout] = ENT_TIERS[c.tier] || ENT_TIERS.mid;
    const perItemUsd = (tot.tokens_in / n * pin + tot.tokens_out / n * pout) / 1e6 + (k === 'calls' ? (tot.audio_s || 0) / n / 60 * (c.asr_min || 0) : 0);
    const toVnd = u => u * (c.usd || 0);
    const batchCloud = perItemUsd * n;
    const batchElec = tot.busy_s / 3600 * (c.watts || 0) / 1000 * (c.kwh || 0);
    const gpuAvg = tot.wh ? tot.wh / (tot.busy_s / 3600) : null;
    const vol = c[k + '_month'] || 0;
    const cloudMonth = perItemUsd * vol;
    const hours = vol * (tot.busy_s / n) / 3600;
    const elecMonth = hours * (c.watts || 0) / 1000 * (c.kwh || 0);
    const amort = (c.box || 0) / Math.max(1, c.months || 1);
    const saving = toVnd(cloudMonth) - elecMonth;
    const payback = saving > 0 ? (c.box || 0) / saving : Infinity;
    setHTML(out,
      `<div class="sub2" style="margin-top:0">${esc(t('ent_c_batch', {n: num(n, 0)}))}</div>` +
      costRow('', t('ent_c_cloud'), vnd(toVnd(batchCloud)), usd(batchCloud)) +
      costRow('local', t('ent_c_local'), vnd(batchElec), t('ent_c_local_d', {w: num(c.watts, 0), h: entDur(tot.busy_s), g: gpuAvg ? num(gpuAvg, 0) : '—'})) +
      `<div class="sub2">${esc(t('ent_c_permonth', {v: num(vol, 0)}))}</div>` +
      costRow('', t('ent_c_cloud_m'), vnd(toVnd(cloudMonth)), usd(cloudMonth)) +
      costRow('local', t('ent_c_local_m'), vnd(amort + elecMonth), t('ent_c_local_m_d', {a: vnd(amort), e: vnd(elecMonth), h: entDur(hours * 3600), s: num(hours / 720 * 100, 1)})) +
      (isFinite(payback) && payback <= (c.months || 36) * 1.5
        ? costRow('local big', t('ent_c_payback'), t('ent_c_months_n', {n: num(payback, 1)}), t('ent_c_free'))
        : `<p class="note-s">${esc(t('ent_c_never'))}</p>`) + entCostAll());
  }
  function entCostAll() {
    const c = ENT_COST, parts = ENT_DEMOS.map(k => [k, entMonthly(k)]).filter(x => x[1]);
    if (parts.length < 2) return '';
    const cloud = parts.reduce((a, x) => a + x[1].cloud, 0) * (c.usd || 0);
    const hours = parts.reduce((a, x) => a + x[1].hours, 0);
    const elec = hours * (c.watts || 0) / 1000 * (c.kwh || 0);
    const amort = (c.box || 0) / Math.max(1, c.months || 1);
    const payback = cloud - elec > 0 ? (c.box || 0) / (cloud - elec) : Infinity;
    return `<div class="sub2">${esc(t('ent_c_all', {n: parts.length}))}</div>` +
      costRow('', t('ent_c_cloud_m'), vnd(cloud), parts.map(x => t('ent_' + x[0] + '_n')).join(' + ')) +
      costRow('local', t('ent_c_local_m'), vnd(amort + elec), t('ent_c_local_m_d', {a: vnd(amort), e: vnd(elec), h: entDur(hours * 3600), s: num(hours / 720 * 100, 1)})) +
      (isFinite(payback) ? costRow('local big', t('ent_c_payback'), t('ent_c_months_n', {n: num(payback, 1)}), t('ent_c_all_note')) : '');
  }
  let entPolling = false;
  async function entTick(force) {
    if (FEAT.enterprise === false) return;
    const visible = current === 'ent';
    const busy = ENT.data && Object.values(ENT.data.demos || {}).some(d => ENT_ACTIVE.includes(d.status));
    if (!force && !visible && !busy && ENT.data) return;
    if (entPolling) return;
    entPolling = true;
    try {
      ENT.data = await getJSON('/api/ent/summary' + (visible ? '?active=1' : ''));
      // the chip shows the batch: one pulse per item finished since the last look
      let rate = 0;
      for (const k of ENT_DEMOS) {
        const s = ENT.data.demos && ENT.data.demos[k];
        if (!s) continue;
        const was = ENT.seen[k];
        ENT.seen[k] = s.processed;
        if (s.status === 'running') {
          rate += (s.rate_per_min || 0) / 60;
          if (was != null && s.processed > was && window.Die) for (let i = 0; i < Math.min(30, s.processed - was); i++) setTimeout(() => Die.item(), i * 60);
        }
      }
      if (window.Die) Die.batch(Math.min(rate, 6));
      if (visible) {
        entEngine(); entJobs(); entPanel(); entLive(); entCostCalc();
        const io = $('#ent-io-model');
        if (io && ENT.data.engine_model) io.textContent = ENT.data.engine_model + ' · GPU';
        await entFeed();
      }
      renderHome();
    } catch (e) {
    } finally { entPolling = false; }
  }
  $('#scene-ent').addEventListener('click', async e => {
    const demo = e.target.closest('[data-ent-demo]');
    if (demo) {
      ENT.demo = demo.dataset.entDemo; ENT.rows = []; ENT.built = ''; ENT.costBuilt = '';
      try { localStorage.setItem('ent-demo', ENT.demo); } catch (x) {}
      entRender(); entTick(true);
      return;
    }
    const eng = e.target.closest('[data-ent-engine]');
    if (eng) {
      ENT.engine = eng.dataset.entEngine;
      try { localStorage.setItem('ent-engine', ENT.engine); } catch (x) {}
      entEngine(); entLive();
      return;
    }
    const only = e.target.closest('[data-ent-only]');
    if (only) { ENT.only = only.dataset.entOnly; ENT.built = ''; ENT.rows = []; entPanel(); entLive(); entFeed(); return; }
    const aud = e.target.closest('tr[data-audio]');
    if (aud) { openSheet(aud.dataset.audio, '', `<div class="det"><audio controls autoplay preload="metadata" src="/api/ent/call/${esc(aud.dataset.audio)}"></audio></div>`); return; }
    const img = e.target.closest('tr[data-img]');
    if (img) { openSheet(img.dataset.img, '', `<div class="det"><img src="/api/ent/invoice/${esc(img.dataset.img)}" alt="" data-zoom="1"></div>`); return; }
    const row = e.target.closest('tr[data-id]');
    if (row) { entDetail(row.dataset.id); return; }
    const btn = e.target.closest('[data-ent]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.ent;
    if (act === 'export') { location.href = `/api/ent/export?demo=${ENT.demo}`; return; }
    if (act === 'reset' && !confirm(t('ent_reset_q'))) return;
    btn.disabled = true;
    let r;
    if (act === 'run') r = await postJSON('/api/ent/start', {demo: ENT.demo, limit: Number(btn.dataset.n), engine: ENT.engine});
    else if (act === 'stop') r = await postJSON('/api/ent/stop', {demo: ENT.demo});
    else if (act === 'reset') { r = await postJSON('/api/ent/reset', {demo: ENT.demo}); ENT.rows = []; }
    else if (act === 'engine-start') { toast(t('ent_eng_starting_toast')); r = await postJSON('/api/ent/engine', {action: 'start'}); }
    else if (act === 'engine-stop') r = await postJSON('/api/ent/engine', {action: 'stop'});
    if (r && !r.ok) toast(t('ent_fail', {m: r.detail || r.error || '?'}));
    await entTick(true);
  });
  $('#scene-ent').addEventListener('input', e => {
    const f = e.target.closest('[data-cost]');
    if (!f) return;
    const id = f.dataset.cost;
    ENT_COST[id] = id === 'tier' ? f.value : Math.max(0, Number(f.value) || 0);
    try { localStorage.setItem('ent-cost', JSON.stringify(ENT_COST)); } catch (x) {}
    entCostCalc();
  });

  /* ---------------------------------------------------------- scroll --- */
  // The chip is the hero; under long content it steps back.
  let scrollQueued = false;
  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const y = window.scrollY || 0;
      $('#hud').classList.toggle('solid', y > 24);
      if (MXS.inView) mxFollow();  // the machine section holds the chip in its stage, fully lit
      const floor = current === 'home' ? 0.4 : 0.22;
      const span = current === 'home' ? 1200 : 700;
      if (window.Die) Die.opacity(MXS.inView ? 1 : Math.max(floor, 1 - y / span), 0.5);
    });
  }
  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('resize', onScroll);

  /* ------------------------------------------------------------ init --- */
  (async function init() {
    try { history.scrollRestoration = 'manual'; } catch (e) {}  // a reload starts at the top of the chapter
    if (window.Die) Die.init($('#die'));
    applyLang();
    show(location.hash.slice(1) || 'home', true);
    if (window.Die) Die.boot();
    await health();
    telemetry();
    modelsLoad();
    setInterval(telemetry, 2000);
    await Promise.all([lab1Load(), lab2Load(), lab3Load()]);
    applyLang();
    entTick(true);
    setInterval(health, 10000);
    setInterval(() => { if (!L1.running) lab1Load(); }, 30000);
    setInterval(entTick, 2000);
  })();
})();
