/* Player de digital signage — roda no WebView do app Android e em qualquer navegador (teste). */
(() => {
  'use strict';

  const A = window.Android || null;          // ponte nativa (null no navegador)
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage indisponível */ } },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let cfg = null;
  let current = null;           // elemento do slide visível
  let timer = null;
  let contentCount = 0, cIdx = -1, sIdx = -1;
  const history = [];

  // ------------------------------------------------------------------ escala do palco
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    $('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  addEventListener('resize', fit);
  fit();

  // ------------------------------------------------------------------ playlist
  async function loadPlaylist() {
    const local = await fetch('playlist.json', { cache: 'no-store' }).then((r) => r.json());
    const remote = (local.remotePlaylistUrl || '').trim();
    if (!remote) return local;
    try {
      const url = remote + (remote.includes('?') ? '&' : '?') + 't=' + Date.now();
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const pl = await r.json();
      store.set('playlist.cache', pl);         // última versão boa, pra rodar offline
      return pl;
    } catch (e) {
      console.warn('Playlist remota indisponível, usando cache/local', e);
      return store.get('playlist.cache', local);
    }
  }

  function applyBrand(b = {}) {
    const root = document.documentElement.style;
    if (b.primary) root.setProperty('--primary', b.primary);
    if (b.accent) root.setProperty('--accent', b.accent);
    $('brandName').textContent = b.name || '';
    const logo = $('logo');
    if (b.logo) { logo.src = b.logo; logo.hidden = false; } else { logo.hidden = true; }
  }

  // Patrocínio/slide com período de contrato: "from"/"until" (AAAA-MM-DD)
  const today = () => new Date().toLocaleDateString('sv-SE');   // AAAA-MM-DD, fuso local
  const isActive = (it) => it && it.enabled !== false
    && (!it.from || today() >= it.from) && (!it.until || today() <= it.until);

  function nextItem() {
    const content = (cfg.slides || []).filter(isActive)
      .filter((it) => it.type !== 'agenda' || agendaView().list.length);
    const sponsors = (cfg.sponsors || []).filter(isActive);
    const every = Math.max(1, cfg.sponsorEvery || 3);

    if (sponsors.length && (contentCount >= every || !content.length)) {
      contentCount = 0;
      sIdx = (sIdx + 1) % sponsors.length;
      return { type: 'sponsor', ...sponsors[sIdx], _sponsor: true };
    }
    if (!content.length) return null;
    contentCount++;
    cIdx = (cIdx + 1) % content.length;
    return content[cIdx];
  }

  // ------------------------------------------------------------------ agenda do dia
  let agendaData = [];
  async function loadAgenda() {
    let items = cfg.agenda || [];
    if (cfg.agendaUrl) {
      try {
        const r = await fetch(cfg.agendaUrl, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        items = await r.json();
        store.set('agenda.cache', items);
      } catch { items = store.get('agenda.cache', items); }
    }
    agendaData = Array.isArray(items) ? items : [];
  }

  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  // Privacidade (LGPD): sala de espera é ambiente público. Padrão = "Carlos S."
  function maskName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    const mode = cfg.agendaPrivacy || 'first';
    if (mode === 'full' || parts.length === 0) return parts.join(' ');
    if (mode === 'initials') return parts.map((p) => p[0].toUpperCase()).join('.') + '.';
    return parts[0] + (parts[1] ? ' ' + parts[1][0].toUpperCase() + '.' : '');
  }

  function agendaView() {
    const day = today();
    const all = agendaData.filter((a) => a && a.time && (!a.date || a.date === day))
      .sort((a, b) => toMin(a.time) - toMin(b.time));
    const n = nowMin();
    const upcoming = all.filter((a) => toMin(a.time) + (a.duration || 60) > n);
    const live = upcoming.length > 0;
    return { list: (live ? upcoming : all).slice(0, 6), live, n };
  }

  function agendaHtml() {
    const { list, live, n } = agendaView();
    let nextMarked = false;
    const rows = list.map((a) => {
      const start = toMin(a.time), end = start + (a.duration || 60);
      let badge = '', cls = '';
      if (live) {
        if (n >= start && n < end) { badge = 'EM ATENDIMENTO'; cls = 'now'; }
        else if (!nextMarked) { badge = 'PRÓXIMO'; cls = 'next'; nextMarked = true; }
      }
      return `<li class="${cls}"><span class="t">${esc(a.time)}</span>
        <span class="who">${esc(maskName(a.client))}<small>${esc(a.service || '')}</small></span>
        <span class="badge">${badge}</span></li>`;
    }).join('');
    const d = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    return `<div class="agenda-box">
      <div class="agenda-head"><h2>${live ? 'Agenda de hoje' : 'Atendimentos de hoje'}</h2><span>${esc(d)}</span></div>
      <ul>${rows}</ul></div>`;
  }

  // ------------------------------------------------------------------ renderização
  function media(src, cls = '') {
    if (/\.(mp4|webm)(\?|$)/i.test(src)) {
      return `<video class="${cls}" src="${esc(src)}" muted autoplay playsinline preload="auto"></video>`;
    }
    return `<img class="${cls}" src="${esc(src)}" alt="" decoding="async">`;
  }

  function build(it) {
    const el = document.createElement('div');
    el.className = 'slide ' + ({
      beforeAfter: 'ba', product: 'product', sponsor: 'sponsor',
      news: 'news', promo: 'promo', agenda: 'agenda',
    }[it.type] || 'full');

    switch (it.type) {
      case 'beforeAfter':
        el.innerHTML = `
          <div class="ba-pair">
            <figure class="before">${media(it.before)}<figcaption>${esc(it.beforeLabel || 'ANTES')}</figcaption></figure>
            <figure class="after">${media(it.after)}<figcaption>${esc(it.afterLabel || 'DEPOIS')}</figcaption></figure>
          </div>
          ${it.title || it.text ? `<div class="caption"><h2>${esc(it.title)}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ''}</div>` : ''}`;
        break;
      case 'product':
        el.innerHTML = `
          <div class="p-img">${media(it.image)}</div>
          <div class="p-info">
            ${it.tag ? `<span class="tag">${esc(it.tag)}</span>` : ''}
            <h2>${esc(it.title)}</h2>
            ${it.text ? `<p>${esc(it.text)}</p>` : ''}
            ${it.price ? `<div class="price">${esc(it.price)}${it.priceNote ? `<small>${esc(it.priceNote)}</small>` : ''}</div>` : ''}
            ${it.cta || it.qr ? `<div class="cta">${it.qr ? `<img src="${esc(it.qr)}" alt="">` : ''}<span>${esc(it.cta)}</span></div>` : ''}
          </div>`;
        break;
      case 'sponsor':
        el.innerHTML = `${media(it.image)}<div class="chip">${esc(it.label || 'Patrocínio')}${it.name ? ' · ' + esc(it.name) : ''}</div>`;
        break;
      case 'agenda':
        el.innerHTML = agendaHtml();
        if (cfg.agendaBackground) el.style.backgroundImage = `linear-gradient(rgba(8,12,24,.72), rgba(8,12,24,.72)), url(${cfg.agendaBackground})`;
        break;
      case 'news':
        el.innerHTML = `${it.source ? `<div class="src">${esc(it.source)}</div>` : ''}<h2>${esc(it.title)}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ''}`;
        break;
      case 'promo':
        el.innerHTML = `<h2>${esc(it.title)}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ''}`;
        if (it.background) el.style.background = it.background;
        break;
      default: // image | video
        el.innerHTML = `${media(it.image || it.src)}${it.title || it.text ? `<div class="caption"><h2>${esc(it.title)}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ''}</div>` : ''}`;
    }
    return el;
  }

  // espera as mídias carregarem (no máximo 4s) pra não mostrar slide "em branco"
  function whenReady(el) {
    const items = [...el.querySelectorAll('img, video')];
    const waits = items.map((m) => new Promise((ok) => {
      if (m.tagName === 'IMG') { if (m.complete) ok(); else { m.onload = m.onerror = ok; } }
      else { if (m.readyState >= 2) ok(); else { m.onloadeddata = m.onerror = ok; } }
    }));
    return Promise.race([Promise.all(waits), new Promise((ok) => setTimeout(ok, 4000))]);
  }

  async function show(it, { fromHistory = false } = {}) {
    clearTimeout(timer);
    if (!it) { timer = setTimeout(next, 5000); return; }

    const el = build(it);
    $('slides').appendChild(el);
    await whenReady(el);

    requestAnimationFrame(() => el.classList.add('show'));
    const old = current;
    current = el;
    if (old) setTimeout(() => old.remove(), 1000);
    if (!fromHistory) { history.push(it); if (history.length > 20) history.shift(); }

    let secs = Number(it.duration) || (it.type === 'sponsor' ? cfg.sponsorDuration : cfg.defaultDuration) || 10;
    const video = el.querySelector('video');
    if (video && !it.duration) {
      video.onended = next;
      secs = 300;                                   // trava de segurança se o vídeo não terminar
      if (isFinite(video.duration) && video.duration > 0) secs = video.duration + 1;
    }

    if (it._sponsor) trackPlay(it, secs);
    animateProgress(secs);
    timer = setTimeout(next, secs * 1000);
  }

  function next() { show(nextItem()); }
  function prev() {
    if (history.length < 2) return;
    history.pop();
    show(history[history.length - 1], { fromHistory: true });
  }

  function animateProgress(secs) {
    const p = $('progress');
    p.style.transition = 'none'; p.style.width = '0';
    void p.offsetWidth;
    p.style.transition = `width ${secs}s linear`; p.style.width = '100%';
  }

  // ------------------------------------------------------------------ prova de exibição (patrocinadores)
  function trackPlay(it, secs) {
    const id = it.id || it.name || it.image;
    const stats = store.get('sponsor.stats', {});
    const s = stats[id] || { name: it.name || id, plays: 0, seconds: 0, first: new Date().toISOString() };
    s.plays += 1; s.seconds += Math.round(secs); s.last = new Date().toISOString();
    stats[id] = s;
    store.set('sponsor.stats', stats);

    if (cfg.statsUrl) {
      const queue = store.get('sponsor.queue', []);
      queue.push({ id, at: s.last, seconds: Math.round(secs) });
      store.set('sponsor.queue', queue.slice(-5000));
    }
  }

  async function flushStats() {
    const queue = store.get('sponsor.queue', []);
    if (!cfg.statsUrl || !queue.length) return;
    try {
      const r = await fetch(cfg.statsUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen: cfg.screenId || 'tv-1', plays: queue }),
      });
      if (r.ok) store.set('sponsor.queue', []);
    } catch { /* offline: tenta de novo depois */ }
  }

  // ------------------------------------------------------------------ ticker de notícias
  async function loadNews() {
    let items = (cfg.news || []).map((n) => (typeof n === 'string' ? { title: n } : n));
    if (cfg.newsUrl) {
      try {
        const r = await fetch(cfg.newsUrl, { cache: 'no-store' });
        if (r.ok) { const remote = await r.json(); items = remote.concat(items); store.set('news.cache', remote); }
      } catch { items = store.get('news.cache', []).concat(items); }
    }
    renderTicker(items.slice(0, 30));
  }

  function renderTicker(items) {
    const t = $('tickerText');
    if (!items.length) { $('ticker').hidden = true; return; }
    $('ticker').hidden = false;
    t.innerHTML = items.map((n) => `${esc(n.title)}${n.source ? `<span class="src">${esc(n.source)}</span>` : ''}`)
      .join('<span class="sep">●</span>');
    const pxPerSec = cfg.tickerSpeed || 110;
    const secs = (t.scrollWidth + 1920) / pxPerSec;
    t.style.animation = 'none'; void t.offsetWidth;
    t.style.animation = `tick ${secs}s linear infinite`;
  }

  // ------------------------------------------------------------------ relógio
  function clock() {
    const d = new Date();
    $('time').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    $('date').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  // ------------------------------------------------------------------ painel técnico
  const SECRET = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];
  let seq = [], seqTimer = null;
  const adminOpen = () => !$('admin').hidden;

  function openAdmin() {
    let info = { screen: cfg.screenId, slides: (cfg.slides || []).length, sponsors: (cfg.sponsors || []).length, playlist: cfg.remotePlaylistUrl || 'local' };
    try { if (A) info = { ...info, ...JSON.parse(A.deviceInfo()) }; } catch { /* sem ponte */ }
    $('adminInfo').textContent = JSON.stringify(info, null, 2);
    $('adminOut').textContent = '';
    $('admin').hidden = false;
    $('admin').querySelector('button').focus();
  }
  function closeAdmin() { $('admin').hidden = true; }

  function statsReport() {
    const stats = store.get('sponsor.stats', {});
    const rows = Object.values(stats).map((s) =>
      `${s.name.padEnd(28)} ${String(s.plays).padStart(6)} exib.  ${String(Math.round(s.seconds / 60)).padStart(5)} min  desde ${s.first.slice(0, 10)}`);
    return rows.length ? rows.join('\n') : 'Nenhuma exibição registrada ainda.';
  }

  $('admin').addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    const out = $('adminOut');
    if (act === 'reload') { closeAdmin(); boot(); }
    if (act === 'stats') out.textContent = statsReport();
    if (act === 'resetStats') { store.set('sponsor.stats', {}); out.textContent = 'Relatório zerado.'; }
    if (act === 'settings') { if (A) A.openSettings(); else out.textContent = 'Disponível só no aparelho.'; }
    if (act === 'exitKiosk') { if (A) { A.exitKiosk(); out.textContent = 'Kiosk desativado.'; } else out.textContent = 'Disponível só no aparelho.'; }
    if (act === 'close') closeAdmin();
  });

  function moveFocus(dir) {
    const btns = [...$('admin').querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[dir];
    const n = Math.min(btns.length - 1, Math.max(0, (i < 0 ? 0 : i) + step));
    btns[n].focus();
  }

  addEventListener('keydown', (e) => {
    const k = e.key;
    if (adminOpen()) {
      if (k.startsWith('Arrow')) { e.preventDefault(); moveFocus(k); }
      else if (k === 'Enter' || e.keyCode === 23) { e.preventDefault(); document.activeElement.click(); }
      else if (k === 'Escape' || k === 'Backspace') closeAdmin();
      return;
    }
    seq.push(k); seq = seq.slice(-SECRET.length);
    clearTimeout(seqTimer); seqTimer = setTimeout(() => { seq = []; }, 3000);
    if (SECRET.every((s, i) => seq[i] === s)) { seq = []; openAdmin(); return; }
    if (k === 'ArrowRight') next();
    if (k === 'ArrowLeft') prev();
  });

  // Ganchos chamados pelo app Android
  window.onAndroidBack = () => { if (adminOpen()) closeAdmin(); };
  window.onAndroidHome = () => closeAdmin();
  window.onAndroidResume = () => clock();

  // ------------------------------------------------------------------ inicialização
  let intervals = [];
  async function boot() {
    intervals.forEach(clearInterval); intervals = [];
    clearTimeout(timer);
    cfg = await loadPlaylist();
    applyBrand(cfg.brand);
    clock();
    await loadAgenda();
    loadNews();
    contentCount = 0; cIdx = -1; sIdx = -1;
    next();

    intervals.push(setInterval(clock, 15000));
    intervals.push(setInterval(loadNews, (cfg.newsRefreshMinutes || 15) * 60000));
    intervals.push(setInterval(flushStats, 5 * 60000));
    intervals.push(setInterval(loadAgenda, 2 * 60000));
    // Atualiza a playlist sem cortar o slide atual
    intervals.push(setInterval(async () => {
      try { const n = await loadPlaylist(); cfg = n; applyBrand(cfg.brand); } catch { /* mantém a atual */ }
    }, (cfg.refreshMinutes || 10) * 60000));
  }

  boot().catch((e) => {
    console.error(e);
    $('slides').innerHTML = '<div class="slide promo show"><h2>Erro ao carregar a playlist</h2><p>Verifique o playlist.json</p></div>';
  });
})();
