// Backup & Restore sheet: save to phone (Documents/HifzTracker), share, or copy/paste text.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const sheet = $('bkOverlay');
  if (!sheet) return;
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = (Cap && Cap.Plugins) || {};
  const status = $('bkStatus');

  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function readLS(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function buildJson() {
    const records = readLS('hifz_records_v3', []);
    const surahProgress = readLS('hifz_surah_progress_v2', {});
    return { text: JSON.stringify({ exportVersion: 2, exportedAt: new Date().toISOString(), records: records, surahProgress: surahProgress }, null, 2), count: records.length };
  }
  function say(msg, ok) {
    status.className = 'bk-status ' + (ok === false ? 'bad' : ok ? 'good' : '');
    status.innerHTML = msg;
  }

  function openSheet() {
    const b = buildJson();
    $('bkCount').textContent = b.count + ' records';
    status.className = 'bk-status'; status.textContent = '';
    sheet.classList.add('open');
  }
  function closeSheet() { sheet.classList.remove('open'); }

  // 1) save to phone
  async function saveToPhone() {
    const b = buildJson();
    const name = 'hifz_backup_' + today() + '.json';
    if (!native || !P.Filesystem) {
      const url = URL.createObjectURL(new Blob([b.text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      say('Download shuru ho gayi: <b>' + name + '</b>', true);
      return;
    }
    try {
      try { const pr = await P.Filesystem.checkPermissions(); if (pr.publicStorage && pr.publicStorage !== 'granted') await P.Filesystem.requestPermissions(); } catch (e) {}
      await P.Filesystem.writeFile({ path: 'HifzTracker/' + name, data: b.text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      say('Save ho gayi ✅<br><b>Files</b> app &rarr; <b>Documents</b> &rarr; <b>HifzTracker</b> &rarr; <b>' + name + '</b>', true);
    } catch (e) {
      say('Phone mein save nahi ho saki (' + (e && e.message ? e.message : e) + '). "Backup text copy karein" try karein.', false);
    }
  }

  // 2) share file (WhatsApp, Drive, ...)
  async function shareFile() {
    const b = buildJson();
    const name = 'hifz_backup_' + today() + '.json';
    if (!native || !P.Filesystem || !P.Share) { saveToPhone(); return; }
    try {
      const r = await P.Filesystem.writeFile({ path: name, data: b.text, directory: 'CACHE', encoding: 'utf8' });
      await P.Share.share({ title: name, url: r.uri, dialogTitle: 'Backup bhejein' });
      say('Share sheet khul gayi. Jahan bheja wahan file ka naam: <b>' + name + '</b>', true);
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return;
      say('Share nahi ho saka: ' + (e && e.message ? e.message : e), false);
    }
  }

  // 3) copy backup text
  async function copyText() {
    const b = buildJson();
    try {
      await navigator.clipboard.writeText(b.text);
    } catch (e) {
      const ta = document.createElement('textarea'); ta.value = b.text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
      ta.remove();
      if (!ok) { say('Copy nahi ho saka.', false); return; }
    }
    say('Backup text copy ho gaya ✅<br>Ab WhatsApp (khud ko message), Notes ya Gmail mein <b>paste</b> kar ke save kar lein.', true);
  }

  // restore: file picker (uses the app\'s own import logic)
  function chooseFile() { closeSheet(); $('importFileInput').click(); }

  // restore: pasted text -> feed to the app's own import logic
  function restoreText() {
    const txt = $('bkPaste').value.trim();
    if (!txt) { say('Pehle backup text paste karein.', false); return; }
    try { const o = JSON.parse(txt); if (!o || !Array.isArray(o.records)) throw new Error('x'); }
    catch (e) { say('Ye sahi backup text nahi lagta. Poora text copy kiya hua hona chahiye (shuru {, aakhir }).', false); return; }
    const input = $('importFileInput');
    const dt = new DataTransfer();
    dt.items.add(new File([txt], 'backup.json', { type: 'application/json' }));
    input.files = dt.files;
    closeSheet();
    input.dispatchEvent(new Event('change'));
    $('bkPaste').value = '';
  }

  // take over the Export / Import buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#exportBtn, #importBtn');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    openSheet();
  }, true);

  $('bkSave').addEventListener('click', saveToPhone);
  $('bkShare').addEventListener('click', shareFile);
  $('bkCopy').addEventListener('click', copyText);
  $('bkChoose').addEventListener('click', chooseFile);
  $('bkRestore').addEventListener('click', restoreText);
  $('bkClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet(); });
})();
