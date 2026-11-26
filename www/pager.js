// Two pages: Home | Settings. Swipe left/right, or use the tab bar.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const pager = $('pager'), tabs = Array.prototype.slice.call(document.querySelectorAll('#tabbar .tab'));
  if (!pager || !tabs.length) return;
  const root = document.documentElement;
  let idx = 0;

  function setTabs() {
    tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
    document.dispatchEvent(new CustomEvent('hifz:page', { detail: idx }));
  }
  function go(i) {
    idx = Math.max(0, Math.min(tabs.length - 1, i));
    setTabs();
    pager.scrollTo({ left: idx * pager.clientWidth, behavior: root.classList.contains('noanim') ? 'auto' : 'smooth' });
  }
  tabs.forEach((t, i) => t.addEventListener('click', () => go(i)));
  pager.addEventListener('scroll', () => {
    const w = pager.clientWidth || 1;
    const i = Math.round(pager.scrollLeft / w);
    if (i !== idx) { idx = i; setTabs(); }
  }, { passive: true });
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => pager.scrollTo({ left: idx * pager.clientWidth, behavior: 'auto' }), 120);
  });

  // animations switch (default: off on phone/app, on for desktop; the choice is remembered)
  const sw = $('animSwitch');
  function showAnim() {
    const on = !root.classList.contains('noanim');
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    const h = $('animHint');
    if (h) h.textContent = on ? 'On: effects aur motion chal rahe hain' : 'Off: app tez aur halki chalti hai';
  }
  sw.addEventListener('click', () => {
    const on = root.classList.contains('noanim');   // currently off -> turn on
    root.classList.toggle('noanim', !on);
    try { localStorage.setItem('hifz_anim', on ? '1' : '0'); } catch (e) {}
    showAnim();
  });
  showAnim();

  window.hifzPager = { index: () => idx, go: go };
})();
