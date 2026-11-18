// Android (Capacitor) bridge: turns "download" clicks into Save/Share sheet.
// On a normal browser this file does nothing.
(function () {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const P = Cap.Plugins || {};
  const Filesystem = P.Filesystem, Share = P.Share;
  if (!Filesystem || !Share) return;

  // Remember blobs, because the app revokes blob URLs right after click().
  const blobs = new Map();
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const url = origCreate(obj);
    if (obj instanceof Blob) {
      blobs.set(url, obj);
      setTimeout(() => blobs.delete(url), 120000);
    }
    return url;
  };

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function handle(a) {
    const name = a.download || 'file';
    try {
      let blob = blobs.get(a.href);
      if (!blob) blob = await (await fetch(a.href)).blob();
      const data = await blobToBase64(blob);
      const res = await Filesystem.writeFile({ path: name, data: data, directory: 'CACHE' });
      await Share.share({ title: name, url: res.uri, dialogTitle: 'Save / Share ' + name });
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return;
      alert('Export failed: ' + (e && e.message ? e.message : e));
    }
  }

  const isDownload = a =>
    a instanceof HTMLAnchorElement && a.download &&
    (a.href.startsWith('blob:') || a.href.startsWith('data:'));

  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownload(this)) { handle(this); return; }
    return origClick.call(this);
  };

  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && isDownload(this)) { handle(this); return true; }
    return origDispatch.call(this, ev);
  };
})();
