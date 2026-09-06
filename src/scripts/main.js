(function () {
  'use strict';

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var id = this.getAttribute('href');
      if (id === '#') return;
      var target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* --- Language picker --- */
  var picker = document.querySelector('[data-langpicker]');
  if (picker) {
    var trigger = picker.querySelector('.langpicker-trigger');
    var menu = picker.querySelector('.langpicker-menu');
    var backdrop = document.querySelector('[data-langpicker-backdrop]');
    var options = Array.prototype.slice.call(menu.querySelectorAll('a.langpicker-option'));

    var isOpen = function () { return trigger.getAttribute('aria-expanded') === 'true'; };

    var open = function () {
      trigger.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
      if (backdrop) backdrop.hidden = false;
      var current = menu.querySelector('.langpicker-option.active') || options[0];
      if (current) current.focus();
    };

    var close = function (refocus) {
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      if (backdrop) backdrop.hidden = true;
      if (refocus) trigger.focus();
    };

    trigger.addEventListener('click', function () {
      if (isOpen()) close(false); else open();
    });

    if (backdrop) backdrop.addEventListener('click', function () { close(false); });

    document.addEventListener('click', function (e) {
      if (isOpen() && !picker.contains(e.target)) close(false);
    });

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
        return;
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      var index = options.indexOf(document.activeElement);
      var step = e.key === 'ArrowDown' ? 1 : -1;
      var next = (index + step + options.length) % options.length;
      if (options[next]) options[next].focus();
    });
  }

}());
