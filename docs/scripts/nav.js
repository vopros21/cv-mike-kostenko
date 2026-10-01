// Highlights the current section in the top navigation while scrolling.
(function () {
  var links = document.querySelectorAll('.topnav a');
  if (!('IntersectionObserver' in window) || !links.length) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('current'); });
      var link = byId[e.target.id];
      if (link) link.classList.add('current');
    });
  }, { rootMargin: '-35% 0px -60% 0px' });

  Object.keys(byId).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) observer.observe(el);
  });
})();
