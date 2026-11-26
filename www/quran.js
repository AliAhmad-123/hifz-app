// Quran page: browse by Surah / Juz. Text comes from the Al Quran Cloud API (alquran.cloud),
// and every surah/juz you open is saved on the phone, so it works offline afterwards.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const list = $('qList'), SD = window.HIFZ_SURAH_DATA;
  if (!list || !SD) return;

  const API = 'https://api.alquran.cloud/v1';
  const ARABIC_ED = 'quran-uthmani';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const arNum = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

  // [surah, ayah] where each juz starts, and the traditional juz names
  const JUZ_START = [[1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],[9,93],[11,6],[12,53],[15,1],[17,1],
    [18,75],[21,1],[23,1],[25,21],[27,56],[29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]];
  const JUZ_AR = ['الم','سيقول','تلك الرسل','لن تنالوا','والمحصنات','لا يحب الله','وإذا سمعوا','ولو أننا','قال الملأ','واعلموا',
    'يعتذرون','وما من دابة','وما أبرئ','ربما','سبحان الذي','قال ألم','اقترب','قد أفلح','وقال الذين','أمن خلق',
    'اتل ما أوحي','ومن يقنت','وما لي','فمن أظلم','إليه يرد','حم','قال فما خطبكم','قد سمع الله','تبارك الذي','عم'];

  // ---------- storage (IndexedDB cache for downloaded surahs / juz) ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('hifz_quran', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('c');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function cacheGet(k) {
    try {
      const d = await db();
      return await new Promise((res, rej) => { const q = d.transaction('c').objectStore('c').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
    } catch (e) { return null; }
  }
  async function cachePut(k, v) {
    try {
      const d = await db();
      await new Promise((res, rej) => { const tx = d.transaction('c', 'readwrite'); tx.objectStore('c').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) {}
  }

  // ---------- API ----------
  async function getJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && j.code && j.code !== 200) throw new Error(j.status || ('code ' + j.code));
      return j.data;
    } finally { clearTimeout(t); }
  }

  let surahMeta = {};   // number -> {ar, en, tr, type}
  try { surahMeta = JSON.parse(ls.get('hifz_q_surahs', '{}')) || {}; } catch (e) {}
  async function loadSurahMeta() {
    if (surahMeta[1] && surahMeta[114]) return;
    try {
      const d = await getJson(API + '/surah');
      const m = {};
      d.forEach(s => { m[s.number] = { ar: s.name, en: s.englishName, tr: s.englishNameTranslation, type: s.revelationType }; });
      surahMeta = m; ls.set('hifz_q_surahs', JSON.stringify(m));
      renderList();
    } catch (e) {}
  }

  let urduId = ls.get('hifz_q_urid', '');
  async function getUrduId() {
    if (urduId) return urduId;
    try {
      const d = await getJson(API + '/edition/language/ur');
      const tr = (d || []).filter(e => e.type === 'translation' && (!e.format || e.format === 'text'));
      const pick = tr.find(e => e.identifier === 'ur.jalandhry') || tr[0];
      if (pick) { urduId = pick.identifier; ls.set('hifz_q_urid', urduId); return urduId; }
    } catch (e) {}
    return 'ur.jalandhry';
  }

  async function fetchAyahs(kind, n, ed) {
    const d = await getJson(kind === 'surah' ? API + '/surah/' + n + '/editions/' + ed : API + '/juz/' + n + '/' + ed);
    const one = Array.isArray(d) ? d[0] : d;
    return (one && one.ayahs) || [];
  }

  async function fetchUrdu(kind, n) {
    const id = await getUrduId();
    const ay = await fetchAyahs(kind, n, id);
    const map = {};
    ay.forEach(a => { map[a.number] = a.text; });
    return map;
  }

  // Returns {items:[{s,i,t,u}], urOk}. Uses the saved copy when there is one.
  async function getContent(kind, n) {
    const key = kind + ':' + n;
    let c = await cacheGet(key);
    if (c && c.urOk) return c;
    if (c) {                       // Arabic is saved, Urdu was missing: try again quietly
      try {
        const map = await fetchUrdu(kind, n);
        c.items.forEach(x => { x.u = map[x.g] || ''; });
        c.urOk = true; cachePut(key, c);
      } catch (e) {}
      return c;
    }
    const ar = await fetchAyahs(kind, n, ARABIC_ED);
    if (!ar.length) throw new Error('empty');
    let map = {}, urOk = false;
    try { map = await fetchUrdu(kind, n); urOk = true; } catch (e) {}
    const items = ar.map(a => ({
      g: a.number,
      s: kind === 'surah' ? n : (a.surah && a.surah.number) || 0,
      i: a.numberInSurah,
      t: a.text,
      u: map[a.number] || ''
    }));
    c = { items: items, urOk: urOk };
    cachePut(key, c);
    return c;
  }

  // ---------- helpers ----------
  const plain = s => s.replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/[ٱآأإ]/g, 'ا');
  function stripBismillah(text) {   // the API puts the bismillah in front of ayah 1; we show it as its own line
    const w = text.split(' ');
    if (w.length > 4 && plain(w[0]) === 'بسم' && plain(w[1]) === 'الله') return w.slice(4).join(' ');
    return text;
  }
  function memorized(snum) {
    try {
      const p = JSON.parse(localStorage.getItem('hifz_surah_progress_v2') || '{}');
      return p[SD[snum - 1][0]] || 0;
    } catch (e) { return 0; }
  }
  const surahName = n => SD[n - 1][0];
  const arShort = n => { const a = surahMeta[n] && surahMeta[n].ar; if (!a) return ''; const i = a.indexOf(' '); return i > 0 ? a.slice(i + 1) : a; };

  // ---------- list page ----------
  let mode = ls.get('hifz_q_mode', 'surah') === 'juz' ? 'juz' : 'surah';
  const seg = $('qSeg'), searchWrap = $('qSearchWrap'), search = $('qSearch');

  function renderList() {
    Array.prototype.forEach.call(seg.children, b => b.classList.toggle('active', b.dataset.m === mode));
    searchWrap.style.display = mode === 'surah' ? 'flex' : 'none';
    let h = '';
    if (mode === 'surah') {
      const q = (search.value || '').trim().toLowerCase();
      SD.forEach((row, idx) => {
        const n = idx + 1, name = row[0], total = row[1], m = surahMeta[n] || {};
        if (q) {
          const hay = (n + ' ' + name + ' ' + (m.en || '') + ' ' + (m.tr || '')).toLowerCase().replace(/[-']/g, ' ');
          if (String(n) !== q && hay.indexOf(q.replace(/[-']/g, ' ')) < 0) return;
        }
        const mem = Math.min(memorized(n), total), pct = Math.round(mem / total * 100);
        const type = m.type ? (m.type === 'Meccan' ? 'Makki' : 'Madani') : '';
        h += '<button class="qs-row" data-n="' + n + '"><span class="qs-num">' + n + '</span>' +
          '<span class="qs-main"><b>' + esc(name) + '</b><small>' + (m.tr ? esc(m.tr) + ' · ' : '') + total + ' ayahs' + (type ? ' · ' + type : '') + '</small>' +
          (mem > 0 ? '<span class="qs-bar"><i style="width:' + pct + '%"></i></span>' : '') + '</span>' +
          '<span class="qs-ar" dir="rtl" lang="ar">' + esc(arShort(n)) + '</span></button>';
      });
      if (!h) h = '<div class="q-empty">Koi surah nahi mili.</div>';
      list.className = 'qs-list';
    } else {
      for (let j = 1; j <= 30; j++) {
        const st = JUZ_START[j - 1];
        h += '<button class="qj-card" data-n="' + j + '"><span class="qj-n">Juz ' + j + '</span>' +
          '<b class="qj-ar" dir="rtl" lang="ar">' + JUZ_AR[j - 1] + '</b>' +
          '<small>' + esc(surahName(st[0])) + ' ' + st[0] + ':' + st[1] + '</small></button>';
      }
      list.className = 'qj-grid';
    }
    list.innerHTML = h;
  }
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    mode = b.dataset.m; ls.set('hifz_q_mode', mode); renderList();
  });
  search.addEventListener('input', renderList);
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    openViewer(mode, parseInt(b.dataset.n, 10));
  });
  document.addEventListener('hifz:page', e => { if (e.detail === 1) renderList(); });

  // ---------- viewer ----------
  const qv = $('qv'), qvBody = $('qvBody'), qvScroll = $('qvScroll'), qvTitle = $('qvTitle'), qvSub = $('qvSub');
  let cur = null, showUrdu = ls.get('hifz_q_tr', '1') !== '0', fs = parseFloat(ls.get('hifz_q_fs', '2')) || 2, token = 0;

  function applyFs() { qv.style.setProperty('--qv-fs', fs + 'rem'); ls.set('hifz_q_fs', String(fs)); }
  function syncTr() { $('qvTr').classList.toggle('on', showUrdu); }
  applyFs(); syncTr();

  const BISMILLAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
  function surahHead(n, full) {
    const m = surahMeta[n] || {}, total = SD[n - 1][1];
    const type = m.type ? ' · ' + (m.type === 'Meccan' ? 'Makki' : 'Madani') : '';
    let h = '<div class="qv-sh"><div class="qv-sh-ar" dir="rtl" lang="ar">' + esc(m.ar || '') + '</div>' +
      '<div class="qv-sh-en">' + n + '. ' + esc(surahName(n)) + (m.tr ? ' — ' + esc(m.tr) : '') + ' · ' + total + ' ayahs' + type + '</div></div>';
    if (full && n !== 1 && n !== 9) h += '<div class="qv-bis" dir="rtl" lang="ar">' + BISMILLAH + '</div>';
    return h;
  }

  function render(kind, n, items, urOk) {
    let h = '', prevS = 0;
    if (kind === 'surah') h += surahHead(n, true);
    const memCache = {};
    items.forEach(x => {
      if (kind === 'juz' && x.s !== prevS) {
        if (x.i === 1) h += surahHead(x.s, true);
        else h += '<div class="qv-cont">' + esc(surahName(x.s)) + ' — ayah ' + x.i + ' se</div>';
      }
      prevS = x.s;
      if (memCache[x.s] === undefined) memCache[x.s] = memorized(x.s);
      let t = x.t;
      if (x.i === 1 && x.s !== 1) t = stripBismillah(t);
      h += '<div class="qa' + (x.i <= memCache[x.s] ? ' mem' : '') + '"><div class="qa-ar" dir="rtl" lang="ar">' + esc(t) +
        ' <span class="qa-no">' + arNum(x.i) + '</span></div>' +
        (showUrdu && x.u ? '<div class="qa-ur" dir="rtl" lang="ur">' + esc(x.u) + '</div>' : '') + '</div>';
    });
    if (showUrdu && !urOk) h = '<div class="qv-note">Urdu tarjuma abhi load nahi ho saka (internet ya server). Arabic maujood hai.</div>' + h;
    const max = kind === 'surah' ? 114 : 30, nn = parseInt(n, 10);
    h += '<div class="qv-nav">' +
      (nn > 1 ? '<button data-go="' + (nn - 1) + '"><i class="fas fa-arrow-left"></i> ' + (kind === 'surah' ? esc(surahName(nn - 1)) : 'Juz ' + (nn - 1)) + '</button>' : '<span></span>') +
      (nn < max ? '<button data-go="' + (nn + 1) + '">' + (kind === 'surah' ? esc(surahName(nn + 1)) : 'Juz ' + (nn + 1)) + ' <i class="fas fa-arrow-right"></i></button>' : '<span></span>') + '</div>';
    qvBody.innerHTML = h;
  }

  function title(kind, n) {
    if (kind === 'surah') { qvTitle.textContent = n + '. ' + surahName(n); qvSub.textContent = (arShort(n) || '') ; }
    else { qvTitle.textContent = 'Juz ' + n; qvSub.textContent = JUZ_AR[n - 1]; }
  }

  async function openViewer(kind, n) {
    const my = ++token;
    cur = { kind: kind, n: n, items: null, urOk: false };
    title(kind, n);
    qv.classList.add('open');
    document.documentElement.classList.add('reader-open');
    qvBody.innerHTML = '<div class="qv-state"><i class="fas fa-spinner fa-spin"></i><span>Load ho raha hai...</span></div>';
    qvScroll.scrollTop = 0;
    try {
      const c = await getContent(kind, n);
      if (my !== token) return;
      cur.items = c.items; cur.urOk = c.urOk;
      render(kind, n, c.items, c.urOk);
      const pos = (() => { try { return JSON.parse(ls.get('hifz_q_pos', 'null')); } catch (e) { return null; } })();
      qvScroll.scrollTop = pos && pos.k === kind + ':' + n ? pos.y : 0;
    } catch (err) {
      if (my !== token) return;
      const off = navigator.onLine === false;
      qvBody.innerHTML = '<div class="qv-state err"><i class="fas fa-cloud-arrow-down"></i><span>' +
        (off ? 'Internet nahi hai. Ye ' + (kind === 'surah' ? 'surah' : 'juz') + ' pehle kabhi khola nahi, isliye phone mein save nahi.' : 'Data load nahi ho saka. Thori der baad dobara koshish karein.') +
        '</span><button class="qv-retry" id="qvRetry"><i class="fas fa-rotate"></i> Dobara koshish</button></div>';
      const rb = $('qvRetry'); if (rb) rb.addEventListener('click', () => openViewer(kind, n));
    }
  }

  function closeViewer() {
    if (!qv.classList.contains('open')) return false;
    savePos();
    token++;
    qv.classList.remove('open');
    document.documentElement.classList.remove('reader-open');
    renderList();   // progress bars may have changed
    return true;
  }
  function savePos() { if (cur) ls.set('hifz_q_pos', JSON.stringify({ k: cur.kind + ':' + cur.n, y: Math.round(qvScroll.scrollTop) })); }
  let st; qvScroll.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(savePos, 400); }, { passive: true });

  $('qvBack').addEventListener('click', closeViewer);
  $('qvPlus').addEventListener('click', () => { fs = Math.min(3.4, Math.round((fs + 0.2) * 10) / 10); applyFs(); });
  $('qvMinus').addEventListener('click', () => { fs = Math.max(1.2, Math.round((fs - 0.2) * 10) / 10); applyFs(); });
  $('qvTr').addEventListener('click', async () => {
    showUrdu = !showUrdu; ls.set('hifz_q_tr', showUrdu ? '1' : '0'); syncTr();
    if (!cur || !cur.items) return;
    if (showUrdu && !cur.urOk) {         // Urdu was missing before: try again now
      try { const c = await getContent(cur.kind, cur.n); cur.items = c.items; cur.urOk = c.urOk; } catch (e) {}
    }
    const y = qvScroll.scrollTop;
    render(cur.kind, cur.n, cur.items, cur.urOk);
    qvScroll.scrollTop = y;
  });
  qvBody.addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b || !cur) return;
    openViewer(cur.kind, parseInt(b.dataset.go, 10));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewer(); });

  window.hifzQuran = { closeIfOpen: closeViewer };
  renderList();
  loadSurahMeta();
})();
