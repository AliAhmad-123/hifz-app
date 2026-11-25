// Quran PDF reader: choose PDF once (stored on-device), read inside the app.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const reader = $('reader'), scroller = $('rdScroll'), pagesEl = $('rdPages');
  if (!reader || !window.pdfjsLib) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';

  const K_PAGE = 'hifz_reader_page', K_ZOOM = 'hifz_reader_zoom', K_NIGHT = 'hifz_reader_night', K_META = 'hifz_reader_meta';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ---------- storage for the PDF (IndexedDB) ----------
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('hifz_reader', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbGet() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const q = db.transaction('files').objectStore('files').get('quran');
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  }
  async function dbPut(rec) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(rec, 'quran');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // ---------- state ----------
  let pdf = null, total = 0, aspect = 1.414, cssW = 0, cur = 1;
  let zoom = parseFloat(ls.get(K_ZOOM, '1')) || 1;
  let els = [], io = null;
  const rendered = new Map();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let lastW = 0, saveT = null, ticking = false, lastReady = null;
  const visible = new Set(), pending = new Set();
  let busy = false;

  const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? 'flex' : 'none'; };
  const isPdf = buf => { const u = new Uint8Array(buf.slice(0, 5)); return u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46; };

  // ---------- home card ----------
  function refreshCard() {
    const sub = $('qcSub'), label = $('openQuranLabel');
    if (!sub || !label) return;
    let meta = null;
    try { meta = JSON.parse(ls.get(K_META, 'null')); } catch (e) {}
    if (meta && meta.total) {
      const p = Math.min(parseInt(ls.get(K_PAGE, '1'), 10) || 1, meta.total);
      sub.textContent = 'Page ' + p + ' / ' + meta.total + ' · ' + (meta.name || 'Quran Pak');
      label.textContent = 'Continue Reading';
    } else {
      sub.textContent = 'Apni PDF ek baar select karein, phir yahin se parhein';
      label.textContent = 'Open Quran';
    }
  }

  // ---------- open / close ----------
  function isOpen() { return reader.classList.contains('open'); }

  async function blobIsPdf(blob) {
    try { return isPdf(await blob.slice(0, 5).arrayBuffer()); } catch (e) { return false; }
  }

  async function openReader() {
    reader.classList.add('open');
    document.documentElement.classList.add('reader-open');
    if (pdf) return;
    show('rdLoading', true); show('rdEmpty', false);
    let rec = null;
    try { rec = await dbGet(); } catch (e) {}
    let blob = rec && rec.blob, name = rec && rec.name;
    if (!blob && rec && rec.buf) blob = new Blob([rec.buf], { type: 'application/pdf' });
    if (!blob) { // optional: a PDF bundled inside the app as quran.pdf
      try {
        const r = await fetch('quran.pdf');
        if (r.ok) { const b = await r.blob(); if (await blobIsPdf(b)) { blob = b; name = 'Quran Pak'; } }
      } catch (e) {}
    }
    show('rdLoading', false);
    if (!blob) { show('rdEmpty', true); return; }
    await loadBlob(blob, name);
  }

  function closeReader() {
    reader.classList.remove('open');
    document.documentElement.classList.remove('reader-open');
    savePage();
    refreshCard();
  }

  // ---------- load ----------
  // The PDF opens immediately by reading only the needed parts of the file. In the
  // background the whole file is read into memory once (one fast sequential read);
  // after that every page request is answered from memory, which is much faster
  // than many small reads from storage.
  const MAX_MEM = 400 * 1024 * 1024;
  async function makeSource(blob) {
    const first = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
    const transport = new pdfjsLib.PDFDataRangeTransport(blob.size, first);
    let mem = null;
    transport.requestDataRange = function (begin, end) {
      // always answer asynchronously (pdf.js is not ready for an instant reply); slice = small copy
      if (mem) { const chunk = mem.slice(begin, end); setTimeout(() => transport.onDataRange(begin, chunk), 0); return; }
      blob.slice(begin, end).arrayBuffer().then(buf => transport.onDataRange(begin, new Uint8Array(buf)));
    };
    let ready = Promise.resolve();
    if (blob.size <= MAX_MEM) {
      ready = blob.arrayBuffer().then(ab => { mem = new Uint8Array(ab); }).catch(() => {});
    }
    return {
      ready: ready,
      opts: { range: transport, disableAutoFetch: true, disableStream: true, rangeChunkSize: 524288 }
    };
  }

  async function loadBlob(blob, name, startPage) {
    show('rdLoading', true); show('rdEmpty', false);
    try {
      if (pdf) { try { pdf.destroy(); } catch (e) {} pdf = null; }
      const src = await makeSource(blob);
      lastReady = src.ready;
      pdf = await pdfjsLib.getDocument(src.opts).promise;
      total = pdf.numPages;
      const p1 = await pdf.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      aspect = vp.height / vp.width;
      ls.set(K_META, JSON.stringify({ name: name || 'Quran Pak', total: total }));
      const start = startPage || Math.min(parseInt(ls.get(K_PAGE, '1'), 10) || 1, total);
      layout(start);
      show('rdLoading', false);
      refreshCard();
      return true;
    } catch (err) {
      console.error(err);
      pdf = null;
      show('rdLoading', false);
      const m = $('rdEmptyMsg');
      if (m) m.textContent = 'Ye PDF open nahi ho saki. Doosri file select karein.';
      show('rdEmpty', true);
      return false;
    }
  }

  // ---------- layout + lazy rendering ----------
  function layout(page) {
    if (io) io.disconnect();
    rendered.forEach(r => { try { r.task && r.task.cancel(); } catch (e) {} });
    rendered.clear(); visible.clear(); pending.clear();
    pagesEl.innerHTML = ''; els = [];
    lastW = scroller.clientWidth;
    const avail = Math.max(200, lastW - 16);
    cssW = Math.round(avail * zoom);
    pagesEl.style.width = Math.max(cssW + 16, lastW) + 'px';
    const h = Math.round(cssW * aspect);
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= total; i++) {
      const d = document.createElement('div');
      d.className = 'rd-page'; d.dataset.p = i;
      d.style.width = cssW + 'px'; d.style.height = h + 'px';
      d.innerHTML = '<span class="rd-num">' + i + '<small>Loading...</small></span>';
      frag.appendChild(d); els.push(d);
    }
    pagesEl.appendChild(frag);
    io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const p = +e.target.dataset.p;
        if (e.isIntersecting) { visible.add(p); if (!rendered.has(p)) pending.add(p); }
        else { visible.delete(p); pending.delete(p); releasePage(p); }
      });
      pump();
    }, { root: scroller, rootMargin: '500px 0px' });
    els.forEach(e => io.observe(e));
    gotoPage(page);
  }

  // one page at a time, always the one closest to what the reader is looking at
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (pending.size) {
        let best = null, bd = Infinity;
        pending.forEach(q => { const d = Math.abs(q - cur) + (q < cur ? 0.5 : 0); if (d < bd) { bd = d; best = q; } });
        pending.delete(best);
        if (!visible.has(best) || rendered.has(best)) continue;
        await renderPage(best);
      }
    } finally { busy = false; }
  }

  async function renderPage(p) {
    const rec = { task: null, canvas: null };
    rendered.set(p, rec);
    try {
      const page = await pdf.getPage(p);
      if (rendered.get(p) !== rec) return;
      const base = page.getViewport({ scale: 1 });
      let s = (cssW / base.width) * dpr;
      let vp = page.getViewport({ scale: s });
      const area = vp.width * vp.height;
      if (area > 6e6) { s *= Math.sqrt(6e6 / area); vp = page.getViewport({ scale: s }); }
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      rec.canvas = canvas;
      rec.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      await rec.task.promise;
      if (rendered.get(p) !== rec) return;
      const el = els[p - 1];
      el.appendChild(canvas);
      const hh = Math.round(cssW * base.height / base.width);
      if (Math.abs(el.offsetHeight - hh) > 2) el.style.height = hh + 'px';
      page.cleanup();
    } catch (err) {
      if (rendered.get(p) === rec) rendered.delete(p);
    }
  }

  function releasePage(p) {
    const rec = rendered.get(p);
    if (!rec) return;
    rendered.delete(p);
    try { rec.task && rec.task.cancel(); } catch (e) {}
    if (rec.canvas) { rec.canvas.width = rec.canvas.height = 0; rec.canvas.remove(); }
  }

  // ---------- navigation ----------
  function currentPage() {
    if (!els.length) return 1;
    const y = scroller.scrollTop + scroller.clientHeight * 0.35 - pagesEl.offsetTop;
    let lo = 0, hi = els.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (els[mid].offsetTop <= y) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }
  function gotoPage(p) {
    p = Math.max(1, Math.min(total, p || 1));
    if (els[p - 1]) scroller.scrollTop = els[p - 1].offsetTop + pagesEl.offsetTop - 6;
    cur = p; updateInfo(); savePage();
  }
  function updateInfo() { $('rdPageInfo').textContent = 'Page ' + cur + ' / ' + total; }
  function savePage() { if (pdf) ls.set(K_PAGE, String(cur)); }

  scroller.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const p = currentPage();
      if (p !== cur) { cur = p; updateInfo(); clearTimeout(saveT); saveT = setTimeout(savePage, 400); }
    });
  }, { passive: true });

  function setZoom(z) {
    if (!pdf) return;
    zoom = Math.max(0.7, Math.min(3, Math.round(z * 10) / 10));
    ls.set(K_ZOOM, String(zoom));
    const p = cur;
    layout(p);
  }

  // ---------- picking a file ----------
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    show('rdLoading', true); show('rdEmpty', false);
    if (!(await blobIsPdf(file))) {
      show('rdLoading', false);
      const m = $('rdEmptyMsg');
      if (m) m.textContent = 'Sahi PDF file select karein.';
      show('rdEmpty', !pdf);
      return;
    }
    const name = file.name.replace(/\.pdf$/i, '');
    ls.set(K_PAGE, '1');
    const ok = await loadBlob(file, name, 1);   // opens right away
    // saved in background for next time (after the file has been read into memory once)
    if (ok) (lastReady || Promise.resolve()).then(() => dbPut({ blob: file, name: name })).catch(() => {});
  }

  // ---------- wire up ----------
  $('openQuranBtn').addEventListener('click', openReader);
  $('rdClose').addEventListener('click', closeReader);
  $('rdPick').addEventListener('click', () => $('rdFile').click());
  $('rdChange').addEventListener('click', () => $('rdFile').click());
  $('rdFile').addEventListener('change', onFile);
  $('rdZoomIn').addEventListener('click', () => setZoom(zoom + 0.2));
  $('rdZoomOut').addEventListener('click', () => setZoom(zoom - 0.2));
  $('rdGo').addEventListener('click', () => {
    if (!pdf) return;
    const v = prompt('Page number (1 - ' + total + ')', String(cur));
    const n = parseInt(v, 10);
    if (n >= 1 && n <= total) gotoPage(n);
  });
  const nightBtn = $('rdNight');
  function applyNight(on) { reader.classList.toggle('night', on); ls.set(K_NIGHT, on ? '1' : '0'); }
  nightBtn.addEventListener('click', () => applyNight(!reader.classList.contains('night')));
  applyNight(ls.get(K_NIGHT, '0') === '1');

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) closeReader(); });
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (isOpen() && pdf && Math.abs(scroller.clientWidth - lastW) > 40) layout(cur); }, 250);
  });

  // Android back button: close reader/popups first, exit app last
  const Cap = window.Capacitor, App = Cap && Cap.Plugins && Cap.Plugins.App;
  if (App && App.addListener) {
    App.addListener('backButton', () => {
      const bk = $('bkOverlay');
      if (bk && bk.classList.contains('open')) return $('bkClose').click();
      if (isOpen()) return closeReader();
      const pop = $('surahLogOverlay'), rep = $('reportModal');
      if (pop && pop.classList.contains('active')) return $('popoverCloseBtn').click();
      if (rep && rep.classList.contains('active')) return $('closeReportBtn').click();
      if (window.hifzPager && window.hifzPager.index() === 1) return window.hifzPager.go(0);
      App.exitApp();
    });
  }

  refreshCard();
})();
