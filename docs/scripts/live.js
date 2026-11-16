// "Right now" on the homepage. The figures are baked into index.html by stats/collect.mjs;
// this script only does what depends on the visitor's clock:
//   - turns the baked timestamp into "updated X ago";
//   - past 48 h: grey figures, "figures as of <date>", amber dot, and "Data stale since <date>"
//     for systems whose last check is that old.
(function () {
  'use strict';

  var STALE_MS = 48 * 60 * 60 * 1000;
  var now = Date.now();
  var dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function time(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : t; }

  function ago(ms) {
    var min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    var h = Math.floor(min / 60);
    if (h < 48) return h + ' h ago';
    return Math.floor(h / 24) + ' days ago';
  }

  // Systems whose last check is older than 48 h
  document.querySelectorAll('.status[data-checked-at]').forEach(function (el) {
    var checked = time(el.getAttribute('data-checked-at'));
    if (checked !== null && now - checked > STALE_MS) {
      el.textContent = 'Data stale since ' + dayFormat.format(checked);
      el.classList.add('is-warn');
    }
  });

  var text = document.getElementById('now-text');
  var meta = document.getElementById('now-meta');
  if (!text || !meta) return;                         // fallback sentence, nothing to do
  var generated = time(text.getAttribute('data-generated-at'));
  if (generated === null) return;

  var age = Math.max(0, now - generated);
  var stale = age > STALE_MS;
  var label = meta.querySelector('time').parentNode;
  label.firstChild.nodeValue = stale ? 'figures as of ' : 'updated ';
  meta.querySelector('time').textContent = stale ? dayFormat.format(generated) : ago(age);
  if (stale) document.getElementById('now').classList.add('is-stale');
})();
