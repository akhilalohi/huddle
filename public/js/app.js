/* Huddle front-end: hero carousel, live countdowns, live deal updates, share buttons. */
(function () {
  "use strict";

  var rupees = function (n) {
    return "₹" + Number(n).toLocaleString("en-IN");
  };

  /* ---------- hero carousel ---------- */
  var slides = Array.prototype.slice.call(document.querySelectorAll(".hero .slide"));
  if (slides.length) {
    var idx = 0;
    var show = function (n) {
      slides[idx].classList.remove("active");
      idx = (n + slides.length) % slides.length;
      slides[idx].classList.add("active");
    };
    document.querySelectorAll("[data-hero]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        show(idx + Number(btn.getAttribute("data-hero")));
      });
    });
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setInterval(function () { show(idx + 1); }, 6000);
  }

  /* ---------- card image previews ---------- */
  var imageViewer = document.querySelector(".image-viewer");
  if (imageViewer) {
    var viewerImage = imageViewer.querySelector("[data-image-viewer-img]");
    var viewerCaption = imageViewer.querySelector("[data-image-viewer-caption]");
    document.querySelectorAll("[data-image-preview]").forEach(function (button) {
      button.addEventListener("click", function () {
        viewerImage.src = button.getAttribute("data-image-src");
        viewerImage.alt = button.getAttribute("data-image-alt");
        viewerCaption.textContent = button.getAttribute("data-image-alt");
        imageViewer.showModal();
      });
    });
    imageViewer.querySelector("[data-image-close]").addEventListener("click", function () {
      imageViewer.close();
    });
    imageViewer.addEventListener("click", function (event) {
      if (event.target === imageViewer) imageViewer.close();
    });
    imageViewer.addEventListener("keydown", function (event) {
      if (event.key === "Escape") imageViewer.close();
    });
  }

  /* ---------- countdowns ---------- */
  function fmt(ms) {
    if (ms <= 0) return "Ended";
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (d > 0) return d + "d " + h + "h left";
    if (h > 0) return h + "h " + m + "m left";
    return m + "m " + sec + "s left";
  }
  var timers = Array.prototype.slice.call(document.querySelectorAll("[data-countdown]"));
  function tick() {
    timers.forEach(function (el) {
      el.textContent = fmt(new Date(el.getAttribute("data-countdown")) - new Date());
    });
  }
  if (timers.length) {
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- live deal page: poll the server, refresh when something changes ---------- */
  var live = document.querySelector("[data-live-deal]");
  if (live) {
    var dealId = live.getAttribute("data-live-deal");
    var startStatus = live.getAttribute("data-status");
    var startCount = Number(live.getAttribute("data-count"));
    var poll = function () {
      if (document.hidden) return;
      fetch("/deals/" + dealId + "/status.json", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return;
          if (d.status !== startStatus || d.count !== startCount) {
            window.location.reload();
          } else if (d.status === "open" && d.msLeft <= 0) {
            // timer just hit zero: give the server a moment to settle, then reload
            setTimeout(function () { window.location.reload(); }, 2500);
          }
        })
        .catch(function () { /* offline: try again next tick */ });
    };
    if (startStatus === "open") setInterval(poll, 8000);
  }

  /* ---------- share + copy ---------- */
  document.querySelectorAll("[data-share='whatsapp']").forEach(function (a) {
    var text = (a.getAttribute("data-text") || "Join this Huddle deal") + " " + window.location.href;
    a.href = "https://wa.me/?text=" + encodeURIComponent(text);
    a.target = "_blank";
    a.rel = "noopener";
  });
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var done = function () {
        var old = btn.textContent;
        btn.textContent = "Link copied!";
        setTimeout(function () { btn.textContent = old; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(window.location.href).then(done);
      } else {
        var t = document.createElement("textarea");
        t.value = window.location.href;
        document.body.appendChild(t);
        t.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
        document.body.removeChild(t);
      }
    });
  });

  /* ---------- deal form: tell the server which timezone the admin typed the end time in ---------- */
  document.querySelectorAll("input[name='tzOffset']").forEach(function (el) {
    el.value = String(new Date().getTimezoneOffset());
  });

  window.huddleRupees = rupees;
})();
