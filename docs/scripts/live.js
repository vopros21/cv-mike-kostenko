// "Right now" paragraph and system statuses on the homepage, from data/live.json.
//
// data/live.json is written by stats/collect.mjs (see README). Rules:
//   - only metrics with public === true and a numeric value are shown; nothing is ever invented;
//   - if the fetch fails or nothing is publishable, the static sentence in index.html stays;
//   - if generatedAt is older than 48 h the figures turn grey, "as of <date>" replaces
//     "updated X ago" and the dot turns amber;
//   - when the data is fresh, numbers count up once (<= 600 ms), unless reduced motion is on.
(function () {
  'use strict';

  var STALE_MS = 48 * 60 * 60 * 1000;
  var TICK_MS = 600;

  var box = document.getElementById('now');
  var textEl = document.getElementById('now-text');
  var metaEl = document.getElementById('now-meta');
  var whenEl = document.getElementById('now-when');
  if (!box || !textEl || !metaEl || !whenEl || !window.fetch) return;

  var numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  var monthFormat = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' });
  var dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  var fullFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

  fetch('data/live.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function () { /* keep the static fallback */ });

  function time(iso) {
    if (typeof iso !== 'string') return null;
    var t = Date.parse(iso);
    return isNaN(t) ? null : t;
  }

  function ago(ms) {
    var min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    var h = Math.floor(min / 60);
    if (h < 48) return h + ' h ago';
    return Math.floor(h / 24) + ' days ago';
  }

  function publishable(m) {
    if (!m || m.public !== true) return false;
    if (typeof m.value !== 'number' || !isFinite(m.value)) return false;
    if (typeof m.sentence !== 'string' || m.sentence.indexOf('{value}') < 0) return false;
    if (m.sentence.indexOf('{month}') >= 0 && time(m.asOf) === null) return false;
    return true;
  }

  function render(data) {
    if (!data || typeof data !== 'object') return;
    var now = Date.now();
    renderSystems(data.systems, now);

    var generated = time(data.generatedAt);
    var metrics = (Array.isArray(data.metrics) ? data.metrics : []).filter(publishable);
    if (generated === null || !metrics.length) return;

    var age = Math.max(0, now - generated);
    var stale = age > STALE_MS;

    var frag = document.createDocumentFragment();
    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Right now:';
    frag.appendChild(label);

    var nums = [];
    metrics.forEach(function (m) {
      frag.appendChild(document.createTextNode(' '));
      m.sentence.split(/(\{value\}|\{month\})/).forEach(function (part) {
        if (part === '{value}') {
          var span = document.createElement('span');
          span.className = 'num';
          span.textContent = numberFormat.format(m.value);
          nums.push({ el: span, value: m.value });
          frag.appendChild(span);
        } else if (part === '{month}') {
          frag.appendChild(document.createTextNode(monthFormat.format(time(m.asOf))));
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      });
    });

    textEl.textContent = '';
    textEl.appendChild(frag);

    var t = document.createElement('time');
    t.dateTime = data.generatedAt;
    t.title = fullFormat.format(generated) + ' UTC';
    t.textContent = stale ? 'figures as of ' + dayFormat.format(generated) : 'updated ' + ago(age);
    whenEl.textContent = '';
    whenEl.appendChild(t);
    metaEl.setAttribute('data-state', stale ? 'stale' : 'fresh');
    box.classList.toggle('is-stale', stale);

    // Pin each number's width to its final value so the sentence never reflows while counting.
    nums.forEach(function (n) { n.el.style.minWidth = Math.ceil(n.el.getBoundingClientRect().width) + 'px'; });

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!stale && !reduce && window.requestAnimationFrame) countUp(nums);
  }

  function countUp(nums) {
    var start = null;
    var formats = nums.map(function (n) {
      var d = Number.isInteger(n.value) ? 0 : 1;
      return new Intl.NumberFormat('en', { minimumFractionDigits: d, maximumFractionDigits: d });
    });
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / TICK_MS);
      var eased = 1 - Math.pow(1 - p, 3);
      nums.forEach(function (n, i) {
        n.el.textContent = p < 1 ? formats[i].format(n.value * eased) : numberFormat.format(n.value);
      });
      if (p < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  // Status words in the "Systems I run" table. Systems without a checkedAt keep the static text.
  function renderSystems(systems, now) {
    if (!Array.isArray(systems)) return;
    systems.forEach(function (s) {
      if (!s || typeof s.id !== 'string') return;
      var checked = time(s.checkedAt);
      if (checked === null) return;
      var row = document.querySelector('tr[data-system="' + s.id.replace(/["\\]/g, '') + '"]');
      var el = row && row.querySelector('.status');
      if (!el) return;

      var text = null, warn = false;
      if (now - checked > STALE_MS) { text = 'Data stale since ' + dayFormat.format(checked); warn = true; }
      else if (s.status === 'running') text = 'Running';
      else if (s.status === 'development') text = 'In development';
      else if (s.status === 'degraded') { text = 'Degraded at the last check, ' + ago(Math.max(0, now - checked)); warn = true; }
      if (text === null) return;
      el.textContent = text;
      el.classList.toggle('is-warn', warn);
    });
  }
})();
