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
  // Escala pela menor dimensão e estica o palco na outra, para cobrir a tela toda
  // sem cortar nada (o layout interno é fluido). Usa a área visível real: no Chrome
  // do celular/DeX o innerWidth pode vir maior que a tela e o palco ficava cortado.
  let stageW = 1920;
  function fit() {
    const vv = window.visualViewport;
    const vw = Math.round((vv && vv.width) || document.documentElement.clientWidth || innerWidth);
    const vh = Math.round((vv && vv.height) || document.documentElement.clientHeight || innerHeight);
    if (!vw || !vh) return;
    const s = Math.min(vw / 1920, vh / 1080);
    const st = $('stage');
    stageW = Math.ceil(vw / s);
    st.style.width = stageW + 'px';
    st.style.height = Math.ceil(vh / s) + 'px';
    st.style.transform = `scale(${s})`;
    st.style.setProperty('--stage-w', stageW + 'px');
  }
  addEventListener('resize', fit);
  addEventListener('orientationchange', fit);
  document.addEventListener('fullscreenchange', fit);
  if (window.visualViewport) visualViewport.addEventListener('resize', fit);
  addEventListener('load', fit);
  setTimeout(fit, 500);   // barras do Android somem depois do primeiro desenho
  fit();

  // No navegador (Chrome do Android não tem F11): o 1º toque/tecla/clique põe em tela cheia.
  // O navegador só permite isso depois de um gesto do usuário. No app (WebView) não precisa.
  function goFullscreen() {
    const el = document.documentElement;
    if (A || document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' }).then(fit).catch(() => {});
  }
  ['click', 'touchend', 'keydown'].forEach((ev) => addEventListener(ev, goFullscreen));

  // ------------------------------------------------------------------ playlist
  async function loadPlaylist() {
    // ?t= fura o cache do CDN (GitHub Pages guarda ~10 min): edição no painel aparece rápido
    const local = await fetch('playlist.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => r.json());
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

  // Prévia (usada pelo painel): ?slide=3 mostra só o 4º slide; ?sponsor=crm4tech só esse patrocinado
  const qs = new URLSearchParams(location.search);
  function previewItem() {
    if (qs.has('slide')) return (cfg.slides || [])[Number(qs.get('slide'))] || null;
    if (qs.has('sponsor')) {
      const sp = (cfg.sponsors || []).find((s) => (s.id || s.name) === qs.get('sponsor'));
      return sp ? { type: 'sponsor', ...sp } : null;
    }
    return undefined;
  }

  function nextItem() {
    const pv = previewItem();
    if (pv !== undefined) return pv;
    const content = (cfg.slides || []).filter(isActive)
      .filter((it) => it.type !== 'agenda' || agendaView().list.length)
      .filter((it) => it.type !== 'newsPortal' || portalItems(it).length);
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

  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".18"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const benefitsHtml = (list) => (Array.isArray(list) && list.length
    ? `<ul class="benefits">${list.map((b) => `<li>${CHECK}<span>${esc(b)}</span></li>`).join('')}</ul>` : '');

  // Produto com foto de benefício (imagem larga, texto à direita)
  function productHero(it) {
    return `
      <div class="hero-bg">${media(it.hero)}</div>
      <div class="hero-panel">
        ${it.tag ? `<span class="tag">${esc(it.tag)}</span>` : ''}
        <h2>${esc(it.title)}</h2>
        ${it.text ? `<p>${esc(it.text)}</p>` : ''}
        ${benefitsHtml(it.benefits)}
        ${it.price ? `<div class="price">${esc(it.price)}${it.priceNote ? `<small>${esc(it.priceNote)}</small>` : ''}</div>` : ''}
        ${it.cta ? `<div class="cta"><span>${esc(it.cta)}</span></div>` : ''}
      </div>`;
  }

  // Patrocinado completo: logo + serviço + benefícios + QR (WhatsApp) + visual à direita
  function sponsorRich(it) {
    const visual = it.image ? `<div class="sp-visual ${esc(it.visualStyle || 'photo')}">
        ${it.visualStyle === 'screen' ? '<div class="sp-bar"><i></i><i></i><i></i></div>' : ''}${media(it.image)}</div>` : '';
    const brand = it.logo
      ? `<div class="sp-brand ${it.logoText ? 'mark' : 'wide'}"><img class="sp-logo" src="${esc(it.logo)}" alt="">${it.logoText ? `<span>${esc(it.logoText)}</span>` : ''}</div>`
      : `<div class="sp-brand mark"><span>${esc(it.logoText || it.name || '')}</span></div>`;
    return `
      ${visual}
      <div class="sp-info">
        ${brand}
        ${it.headline ? `<h2>${esc(it.headline)}</h2>` : ''}
        ${it.text ? `<p>${esc(it.text)}</p>` : ''}
        ${benefitsHtml(it.benefits)}
        ${it.cta || it.qr || it.contact ? `<div class="sp-cta">${it.qr ? `<img class="sp-qr" src="${esc(it.qr)}" alt="">` : ''}
          <div>${it.cta ? `<b>${esc(it.cta)}</b>` : ''}${it.contact ? `<span>${esc(it.contact)}</span>` : ''}</div></div>` : ''}
      </div>
      <div class="chip">${esc(it.label || 'Patrocinado')}${it.name ? ' · ' + esc(it.name) : ''}</div>`;
  }

  // Portal de notícias (news.json gerado pelo GitHub Actions a partir do RSS do g1/ge)
  let portalPos = 0;
  function portalItems(it) {
    const want = it.feed && it.feed !== 'all' ? String(it.feed).split(',') : null;
    return newsData.filter((n) => n && n.title && (!want || want.includes(n.category)));
  }
  function ago(d) {
    const t = Date.parse(d); if (!t) return '';
    const m = Math.max(1, Math.round((Date.now() - t) / 60000));
    return m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  }
  function newsPortal(it) {
    const all = portalItems(it);
    const withImg = all.filter((n) => n.image);
    const pool = withImg.length >= 4 ? withImg : all;
    const pick = []; for (let i = 0; i < Math.min(4, pool.length); i++) pick.push(pool[(portalPos + i) % pool.length]);
    portalPos = (portalPos + pick.length) % Math.max(1, pool.length);
    const [lead, ...side] = pick;
    const src = (n) => `<span class="src">${esc(n.source || '')}${n.date ? ' · ' + ago(n.date) : ''}</span>`;
    const img = (n, cls) => (n.image ? `<img class="${cls}" src="${esc(n.image)}" alt="" referrerpolicy="no-referrer">` : `<div class="${cls} noimg"></div>`);
    return `
      <div class="np-head"><span class="np-badge">${esc(it.title || 'Notícias')}</span>
        ${newsUpdated ? `<span class="np-upd">Atualizado ${esc(new Date(newsUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</span>` : ''}</div>
      <div class="np-grid">
        <article class="np-lead">${img(lead, 'np-img')}<div class="np-txt">${src(lead)}<h2>${esc(lead.title)}</h2>${lead.subtitle ? `<p>${esc(lead.subtitle)}</p>` : ''}</div></article>
        <div class="np-side">${side.map((n) => `<article class="np-item">${img(n, 'np-thumb')}<div>${src(n)}<h3>${esc(n.title)}</h3></div></article>`).join('')}</div>
      </div>`;
  }

  function build(it) {
    const el = document.createElement('div');
    el.className = 'slide ' + ({
      beforeAfter: 'ba', product: it.hero ? 'product hero' : 'product',
      sponsor: (it.logo || it.headline) ? 'sponsor rich' : 'sponsor',
      news: 'news', promo: 'promo', agenda: 'agenda', newsPortal: 'np',
    }[it.type] || 'full');
    if (it.color) el.style.setProperty('--sp', it.color);
    if (it.background && it.type === 'sponsor') el.style.background = it.background;

    switch (it.type) {
      case 'newsPortal':
        el.innerHTML = newsPortal(it);
        break;
      case 'beforeAfter':
        el.innerHTML = `
          <div class="ba-pair">
            <figure class="before">${media(it.before)}<figcaption>${esc(it.beforeLabel || 'ANTES')}</figcaption></figure>
            <figure class="after">${media(it.after)}<figcaption>${esc(it.afterLabel || 'DEPOIS')}</figcaption></figure>
          </div>
          ${it.title || it.text ? `<div class="caption"><h2>${esc(it.title)}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ''}</div>` : ''}`;
        break;
      case 'product':
        if (it.hero) { el.innerHTML = productHero(it); break; }
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
        if (it.logo || it.headline) { el.innerHTML = sponsorRich(it); break; }
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
  // newsUrl aceita [{title, source}] ou {updated, items:[{title, subtitle, image, source, category, date}]}
  let newsData = [], newsUpdated = '';
  async function loadNews() {
    const own = (cfg.news || []).map((n) => (typeof n === 'string' ? { title: n } : n));
    let remote = store.get('news.cache', { items: [] });
    if (cfg.newsUrl) {
      try {
        const u = cfg.newsUrl + (cfg.newsUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          remote = Array.isArray(j) ? { items: j } : j;
          store.set('news.cache', remote);
        }
      } catch { /* offline: usa o cache */ }
    }
    newsData = (remote.items || []).filter((n) => n && n.title);
    newsUpdated = remote.updated || '';
    // Ticker: recados da clínica primeiro, depois algumas manchetes
    renderTicker(own.concat(newsData.slice(0, cfg.tickerHeadlines ?? 8)).slice(0, 30));
  }

  function renderTicker(items) {
    const t = $('tickerText');
    if (!items.length) { $('ticker').hidden = true; return; }
    $('ticker').hidden = false;
    t.innerHTML = items.map((n) => `${esc(n.title)}${n.source ? `<span class="src">${esc(n.source)}</span>` : ''}`)
      .join('<span class="sep">●</span>');
    const pxPerSec = cfg.tickerSpeed || 110;
    const secs = (t.scrollWidth + stageW) / pxPerSec;
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
  // Atalhos de teclado (com o painel fechado):
  //   ↑ ↑ ↓ ↓  abre o painel técnico (apps, configurações, autostart...)
  //   ↓ ↓ ↑ ↑  FECHA o TV Launcher direto
  const SECRET = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];
  const QUIT = ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp'];
  let seq = [], seqTimer = null, quitArmed = false;
  const adminOpen = () => !$('admin').hidden;

  // ---- cursor do mouse e botão "Menu": aparecem ao mexer o mouse/tocar, somem após 3,5 s parado
  let idleT = null;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (!adminOpen()) document.body.classList.add('idle'); }, 3500);
  }
  ['mousemove', 'mousedown', 'pointerdown', 'touchstart'].forEach((ev) => addEventListener(ev, wake, { passive: true }));
  $('menuBtn').addEventListener('click', () => openAdmin());

  // aviso rápido na tela
  let toastT = null;
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function showMain() { $('appList').hidden = true; $('adminMain').hidden = false; }
  function openAdmin() {
    let info = { screen: cfg.screenId, slides: (cfg.slides || []).length, sponsors: (cfg.sponsors || []).length, playlist: cfg.remotePlaylistUrl || 'local' };
    try { if (A) info = { ...info, ...JSON.parse(A.deviceInfo()) }; } catch { /* sem ponte */ }
    $('adminInfo').textContent = JSON.stringify(info, null, 2);
    $('adminOut').textContent = '';
    quitArmed = false;
    showMain();
    $('admin').hidden = false;
    wake();
    $('admin').querySelector('button').focus();
  }
  function closeAdmin() { $('admin').hidden = true; showMain(); wake(); }

  function statsReport() {
    const stats = store.get('sponsor.stats', {});
    const rows = Object.values(stats).map((s) =>
      `${s.name.padEnd(28)} ${String(s.plays).padStart(6)} exib.  ${String(Math.round(s.seconds / 60)).padStart(5)} min  desde ${s.first.slice(0, 10)}`);
    return rows.length ? rows.join('\n') : 'Nenhuma exibição registrada ainda.';
  }

  // Lista os apps instalados para abrir (mouse, toque ou D-pad)
  function showApps() {
    const out = $('adminOut');
    if (!A || !A.listApps) { out.textContent = 'Disponível só no aparelho.'; return; }
    let apps = [];
    try { apps = JSON.parse(A.listApps()); } catch { /* sem lista */ }
    const list = $('appList');
    list.innerHTML = '<button class="back" data-act="appsBack">← Voltar</button>'
      + (apps.length ? apps.map((a) => `<button data-pkg="${esc(a.package)}">${esc(a.label)}</button>`).join('')
        : '<span style="grid-column:1/-1;color:#94a3b8;font-size:26px">Nenhum app encontrado.</span>');
    $('adminMain').hidden = true; list.hidden = false;
    list.querySelector('button').focus();
  }

  // Fecha o TV Launcher. Com o Autostart ligado o Android abre o app de novo (ele é a tela Início).
  function quitApp(force) {
    if (!A || !A.closeApp) { toast('Para fechar o app, instale o APK mais novo (esta versão não tem essa função).'); return; }
    if (!force && A.isHomeEnabled && A.isHomeEnabled() && !quitArmed) {
      quitArmed = true;
      $('adminOut').textContent = 'O Autostart está LIGADO: o Android abre o app de novo ao sair. Desligue o Autostart (botão acima) para sair de vez, ou clique em "Fechar" outra vez para fechar assim mesmo.';
      return;
    }
    A.closeApp();
  }

  $('admin').addEventListener('click', (e) => {
    const pkg = e.target.dataset && e.target.dataset.pkg;
    if (pkg) { closeAdmin(); if (A) A.launchApp(pkg); return; }
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    const out = $('adminOut');
    if (act !== 'quit') quitArmed = false;
    if (act === 'reload') { out.textContent = 'Recarregando...'; location.reload(); }   // página inteira: pega conteúdo E código novos
    if (act === 'stats') out.textContent = statsReport();
    if (act === 'resetStats') { store.set('sponsor.stats', {}); out.textContent = 'Relatório zerado.'; }
    if (act === 'apps') showApps();
    if (act === 'appsBack') { showMain(); $('admin').querySelector('button').focus(); }
    if (act === 'settings') { if (A) A.openSettings(); else out.textContent = 'Disponível só no aparelho.'; }
    if (act === 'home') {
      if (A && A.setHomeEnabled) {
        const on = A.setHomeEnabled(!A.isHomeEnabled());
        out.textContent = on
          ? 'Autostart LIGADO. Escolha "TV Launcher" como app de Início na tela que abriu. (No Samsung DeX o app não abre assim.)'
          : 'Autostart DESLIGADO. O app abre no Samsung DeX, mas não inicia sozinho no boot.';
      } else out.textContent = 'Disponível só no aparelho.';
    }
    if (act === 'quit') quitApp(false);
    if (act === 'exitKiosk') { if (A) { A.exitKiosk(); out.textContent = 'Kiosk desativado.'; } else out.textContent = 'Disponível só no aparelho.'; }
    if (act === 'close') closeAdmin();
  });

  function moveFocus(dir) {
    const btns = [...$('admin').querySelectorAll('button')].filter((b) => b.offsetParent);
    const i = btns.indexOf(document.activeElement);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[dir];
    const n = Math.min(btns.length - 1, Math.max(0, (i < 0 ? 0 : i) + step));
    btns[n].focus();
    btns[n].scrollIntoView({ block: 'nearest' });
  }

  addEventListener('keydown', (e) => {
    const k = e.key;
    if (adminOpen()) {
      if (k.startsWith('Arrow')) { e.preventDefault(); moveFocus(k); }
      else if (k === 'Enter' || e.keyCode === 23) { e.preventDefault(); document.activeElement.click(); }
      else if (k === 'Escape' || k === 'Backspace') { if (!$('appList').hidden) showMain(); else closeAdmin(); }
      return;
    }
    seq.push(k); seq = seq.slice(-SECRET.length);
    clearTimeout(seqTimer); seqTimer = setTimeout(() => { seq = []; }, 3000);
    if (SECRET.every((s, i) => seq[i] === s)) { seq = []; openAdmin(); return; }
    if (QUIT.every((s, i) => seq[i] === s)) { seq = []; quitApp(true); return; }
    if (k === 'ArrowRight') next();
    if (k === 'ArrowLeft') prev();
  });

  // Ganchos chamados pelo app Android
  window.onAndroidBack = () => { if (adminOpen()) { if (!$('appList').hidden) showMain(); else closeAdmin(); } };
  window.onAndroidHome = () => closeAdmin();
  window.onAndroidResume = () => clock();

  // ------------------------------------------------------------------ inicialização
  let intervals = [];
  async function boot() {
    intervals.forEach(clearInterval); intervals = [];
    clearTimeout(timer);
    cfg = await loadPlaylist();
    const bootVersion = cfg.version;
    applyBrand(cfg.brand);
    clock();
    await loadAgenda();
    await loadNews();
    contentCount = 0; cIdx = -1; sIdx = -1;
    next();

    intervals.push(setInterval(clock, 15000));
    intervals.push(setInterval(loadNews, (cfg.newsRefreshMinutes || 15) * 60000));
    intervals.push(setInterval(flushStats, 5 * 60000));
    intervals.push(setInterval(loadAgenda, 2 * 60000));
    // Atualiza a playlist sem cortar o slide atual
    intervals.push(setInterval(async () => {
      try {
        const n = await loadPlaylist();
        // "version" mudou no playlist = código novo publicado: recarrega a página inteira
        if (n.version && bootVersion && n.version !== bootVersion) { location.reload(); return; }
        cfg = n; applyBrand(cfg.brand);
      } catch { /* mantém a atual */ }
    }, (cfg.refreshMinutes || 10) * 60000));
  }

  boot().catch((e) => {
    console.error(e);
    $('slides').innerHTML = '<div class="slide promo show"><h2>Erro ao carregar a playlist</h2><p>Verifique o playlist.json</p></div>';
  });
})();
