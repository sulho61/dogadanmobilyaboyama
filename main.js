/* Doğadan Atölye — gezinme, galeri lightbox, renk kataloğu, form, PWA */
(() => {
  "use strict";

    /* ─── Tarayıcının kendi "resmi sürükle" özelliğini kapat (pan / kaydırmayı bozuyordu) ─── */
  document.addEventListener("dragstart", (event) => {
    if (event.target.closest?.(".lightbox, .gallery-open")) event.preventDefault();
  });

  /* ─── Tema: varsayılan açık (beyaz), elle koyuya geçilir ─── */
  const root = document.documentElement;
  const themeBtn = document.querySelector("#theme-toggle");
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function applyTheme(theme, save) {
    const dark = theme === "dark";
    if (dark) root.dataset.theme = "dark";
    else delete root.dataset.theme;
    themeMeta?.setAttribute("content", dark ? "#111113" : "#1d1d1f");
    themeBtn?.setAttribute("aria-pressed", String(dark));
    themeBtn?.setAttribute("aria-label", dark ? "Açık moda geç" : "Koyu moda geç");
    if (save) {
      try { localStorage.setItem("theme", theme); } catch { /* yoksay */ }
    }
  }

  applyTheme(root.dataset.theme === "dark" ? "dark" : "light", false);
  themeBtn?.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
  });

  /* ─── Aktif navbar (yalnızca ana sayfa bölümleri varsa) ─── */
  const sections = [...document.querySelectorAll("main section[id]")];
  const navLinks = [...document.querySelectorAll(".nav-link[data-section]")];

  function setActiveNav(id) {
    navLinks.forEach((link) => {
      const active = link.dataset.section === id;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function updateActiveFromScroll() {
    if (!sections.length || !navLinks.length) return;
    const marker = window.innerHeight * 0.28;
    let current = sections[0].id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= marker) current = section.id;
    }
    setActiveNav(current);
  }

  /* ─── "Aşağı keşfet" kaydırınca gizlensin ─── */
  const scrollHint = document.querySelector("#scroll-hint");
  function updateScrollHint() {
    if (!scrollHint) return;
    scrollHint.classList.toggle("is-hidden", window.scrollY > 40);
  }

  if (sections.length && navLinks.length) {
    navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        const id = link.dataset.section;
        if (id) setActiveNav(id);
      });
    });
  }

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateActiveFromScroll();
      updateScrollHint();
      ticking = false;
    });
  }, { passive: true });
  updateActiveFromScroll();
  updateScrollHint();

  /* ─── Galeri lightbox: zoom, kaydırma, video ─── */
  const lightbox = document.querySelector("#lightbox");
  if (lightbox) {
    const stage = lightbox.querySelector(".lightbox-stage");
    const mediaWrap = lightbox.querySelector(".lightbox-media");
    const imgEl = lightbox.querySelector("#lightbox-image");
    const videoEl = lightbox.querySelector("#lightbox-video");
    const captionEl = lightbox.querySelector("#lightbox-caption");
    const counterEl = lightbox.querySelector("#lightbox-counter");
    const btnClose = lightbox.querySelector(".lightbox-close");
    const btnPrev = lightbox.querySelector(".lightbox-prev");
    const btnNext = lightbox.querySelector(".lightbox-next");
    const btnZoomIn = lightbox.querySelector(".lightbox-zoom-in");
    const btnZoomOut = lightbox.querySelector(".lightbox-zoom-out");
    const btnReset = lightbox.querySelector(".lightbox-zoom-reset");
    const backdrop = lightbox.querySelector(".lightbox-backdrop");
    const btnShare = lightbox.querySelector(".lightbox-share");
    const toastEl = lightbox.querySelector("#lightbox-toast");

    let items = [];

    function collectItems() {
      return [...document.querySelectorAll(".gallery-open")].filter((btn) => {
        const card = btn.closest(".gallery-card");
        return !card || !card.hidden;
      }).map((btn, i) => {
        const img = btn.querySelector("img, video");
        const type = btn.dataset.type || (btn.dataset.video ? "video" : "image");
        return {
          index: i,
          type,
          src: btn.dataset.image || btn.dataset.video || img?.src || "",
          poster: btn.dataset.poster || "",
          title: btn.dataset.title || img?.alt || "Çalışma",
          alt: img?.alt || btn.dataset.title || "Mobilya çalışması",
          button: btn
        };
      });
    }

    let current = 0;
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let previousFocus = null;

    let pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let panStartX = 0;
    let panStartY = 0;
    let originPanX = 0;
    let originPanY = 0;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeActive = false;
    let lastTap = 0;

    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    const SWIPE_THRESHOLD = 56;

    function applyTransform() {
      if (!mediaWrap) return;
      mediaWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      lightbox.classList.toggle("is-zoomed", scale > 1.05);
    }

    function resetZoom() {
      scale = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    }

    function setZoom(next) {
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      if (scale <= 1) {
        panX = 0;
        panY = 0;
      }
      applyTransform();
    }

    function showItem(index) {
      if (!items.length) return;
      current = (index + items.length) % items.length;
      const item = items[current];
      resetZoom();

      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute("src");
        videoEl.load();
        videoEl.hidden = true;
      }
      if (imgEl) {
        imgEl.hidden = true;
        imgEl.removeAttribute("src");
      }

      if (item.type === "video" && videoEl) {
        if (item.poster) videoEl.poster = item.poster;
        videoEl.src = item.src;
        videoEl.hidden = false;
      } else if (imgEl) {
        imgEl.src = item.src;
        imgEl.alt = item.alt;
        imgEl.hidden = false;
      }

      if (item.type === "image") item.filePromise = item.filePromise || buildShareFile(item);
      if (captionEl) captionEl.textContent = item.title;
      if (counterEl) counterEl.textContent = `${current + 1} / ${items.length}`;
    }

    /* ─── Paylaş ─── */
    let toastTimer;
    function showToast(message) {
      if (!toastEl) return;
      toastEl.textContent = message;
      toastEl.classList.add("is-visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2200);
    }

    function absUrl(src) {
      return new URL(src, location.href).href;
    }

    /* Görseli önceden dosyaya çevir: paylaşım jesti kaybolmasın */
    async function buildShareFile(item) {
      try {
        const res = await fetch(absUrl(item.src));
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        const slug = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "dogadan-atolye";
        return new File([blob], `${slug}.${ext}`, { type: blob.type });
      } catch {
        return null;
      }
    }

    async function shareCurrent() {
      const item = items[current];
      if (!item) return;
      const url = absUrl(item.src);
      const text = `${item.title} — Doğadan Atölye`;
      try {
        if (item.type === "image" && navigator.canShare) {
          const file = await item.filePromise;
          if (file && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: item.title, text });
            return;
          }
        }
        if (navigator.share) {
          await navigator.share({ title: item.title, text, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        showToast("Bağlantı kopyalandı");
      } catch (err) {
        if (err && err.name === "AbortError") return;
        try {
          await navigator.clipboard.writeText(url);
          showToast("Bağlantı kopyalandı");
        } catch {
          showToast("Paylaşılamadı");
        }
      }
    }

    function openAt(index) {
      previousFocus = document.activeElement;
      showItem(index);
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
      document.body.classList.add("lightbox-open");
      btnClose?.focus();
    }

    function closeLightbox() {
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute("src");
      }
      if (imgEl) imgEl.removeAttribute("src");
      resetZoom();
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
      document.body.classList.remove("lightbox-open");
      previousFocus?.focus?.();
    }

    function next() { showItem(current + 1); }
    function prev() { showItem(current - 1); }

    document.querySelectorAll(".gallery-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        items = collectItems();
        const idx = items.findIndex((it) => it.button === btn);
        openAt(idx >= 0 ? idx : 0);
      });
    });

    btnClose?.addEventListener("click", closeLightbox);
    btnShare?.addEventListener("click", (e) => { e.stopPropagation(); shareCurrent(); });
    backdrop?.addEventListener("click", closeLightbox);
    btnPrev?.addEventListener("click", (e) => { e.stopPropagation(); prev(); });
    btnNext?.addEventListener("click", (e) => { e.stopPropagation(); next(); });
    btnZoomIn?.addEventListener("click", (e) => { e.stopPropagation(); setZoom(scale + 0.4); });
    btnZoomOut?.addEventListener("click", (e) => { e.stopPropagation(); setZoom(scale - 0.4); });
    btnReset?.addEventListener("click", (e) => { e.stopPropagation(); resetZoom(); });

    document.addEventListener("keydown", (event) => {
      if (!lightbox.classList.contains("is-open")) return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") prev();
      if (event.key === "+" || event.key === "=") setZoom(scale + 0.3);
      if (event.key === "-") setZoom(scale - 0.3);
      if (event.key === "0") resetZoom();
    });

    stage?.addEventListener("click", (event) => {
      if (event.target.closest("button, video")) return;
      const now = Date.now();
      if (now - lastTap < 280) {
        if (scale > 1.1) resetZoom();
        else setZoom(2.2);
        event.preventDefault();
      }
      lastTap = now;
    });

    stage?.addEventListener("wheel", (event) => {
      if (!lightbox.classList.contains("is-open")) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.15 : 0.15;
      setZoom(scale + delta);
    }, { passive: false });

    function pointerDistance(a, b) {
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    stage?.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      stage.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, event);

      if (pointers.size === 1) {
        swipeActive = scale <= 1.05;
        swipeStartX = event.clientX;
        swipeStartY = event.clientY;
        panStartX = event.clientX;
        panStartY = event.clientY;
        originPanX = panX;
        originPanY = panY;
      } else if (pointers.size === 2) {
        swipeActive = false;
        const pts = [...pointers.values()];
        pinchStartDist = pointerDistance(pts[0], pts[1]);
        pinchStartScale = scale;
      }
    });

    stage?.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, event);

      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = pointerDistance(pts[0], pts[1]);
        if (pinchStartDist > 0) setZoom(pinchStartScale * (dist / pinchStartDist));
        return;
      }

      if (pointers.size === 1) {
        const dx = event.clientX - panStartX;
        const dy = event.clientY - panStartY;

        if (scale > 1.05) {
          panX = originPanX + dx;
          panY = originPanY + dy;
          applyTransform();
          return;
        }

        if (swipeActive && Math.abs(dx) > Math.abs(dy)) {
          if (mediaWrap) mediaWrap.style.transform = `translateX(${dx * 0.35}px) scale(1)`;
        }
      }
    });

    function endPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      const wasSwipe = swipeActive && pointers.size === 1 && scale <= 1.05;
      const dx = event.clientX - swipeStartX;
      const dy = event.clientY - swipeStartY;
      pointers.delete(event.pointerId);

      if (pointers.size < 2) pinchStartDist = 0;

      if (wasSwipe && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) next();
        else prev();
      } else if (scale <= 1.05) {
        resetZoom();
      }
    }

    stage?.addEventListener("pointerup", endPointer);
    stage?.addEventListener("pointercancel", endPointer);
    stage?.addEventListener("pointerleave", (event) => {
      if (pointers.has(event.pointerId)) endPointer(event);
    });
  }

  /* ─── Öncesi / sonrası kaydırıcı ─── */
  const ba = document.querySelector("#ba-compare");
  const baRange = ba?.querySelector(".ba-range");
  if (ba && baRange) {
    const setPos = (value) => ba.style.setProperty("--pos", `${value}%`);
    baRange.addEventListener("input", () => setPos(baRange.value));
    setPos(baRange.value);
  }

  /* ─── Çalışma şekli sekmeleri ─── */
  const processTabs = [...document.querySelectorAll(".process-tab")];
  const processPanels = [...document.querySelectorAll(".process-panel")];
  processTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.process;
      processTabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
      processPanels.forEach((panel) => {
        const on = panel.dataset.process === key;
        panel.classList.toggle("is-active", on);
        panel.hidden = !on;
      });
    });
  });

  /* ─── Renk kataloğu (renkler.html) ─── */
  const colorGrid = document.querySelector("#color-grid");
  const colorSearch = document.querySelector("#color-search");
  const colorCats = [...document.querySelectorAll(".color-cat")];
  const colorPreview = document.querySelector("#color-preview");
  const previewChip = document.querySelector("#color-preview-chip");
  const previewName = document.querySelector("#color-preview-name");
  const previewCode = document.querySelector("#color-preview-code");
  const previewHex = document.querySelector("#color-preview-hex");
  const previewToast = document.querySelector("#color-preview-toast");
  const colorEmpty = document.querySelector("#color-empty");
  const colorCount = document.querySelector("#color-count");
  let activeCat = "all";

  function filterColors() {
    if (!colorGrid) return;
    const q = (colorSearch?.value || "").trim().toLowerCase();
    let visible = 0;
    colorGrid.querySelectorAll(".color-swatch").forEach((sw) => {
      const cat = sw.dataset.cat || "";
      const name = (sw.dataset.name || "").toLowerCase();
      const code = (sw.dataset.code || "").toLowerCase();
      const hex = (sw.dataset.hex || "").toLowerCase();
      const catOk = activeCat === "all" || cat === activeCat;
      const qOk = !q || name.includes(q) || code.includes(q) || hex.includes(q);
      sw.hidden = !(catOk && qOk);
      if (!sw.hidden) visible++;
    });
    if (colorEmpty) colorEmpty.hidden = visible > 0;
    if (colorCount) colorCount.textContent = `${visible} renk`;
  }

  colorCats.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCat = btn.dataset.cat || "all";
      colorCats.forEach((b) => b.classList.toggle("is-active", b === btn));
      filterColors();
    });
  });
  colorSearch?.addEventListener("input", filterColors);
  filterColors();

  colorGrid?.querySelectorAll(".color-swatch").forEach((sw) => {
    sw.addEventListener("click", async () => {
      colorGrid.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("is-selected"));
      sw.classList.add("is-selected");
      const name = sw.dataset.name || "";
      const code = sw.dataset.code || "";
      const hex = sw.dataset.hex || "";
      if (colorPreview) colorPreview.hidden = false;
      if (previewChip) previewChip.style.background = hex;
      if (previewName) previewName.textContent = name;
      if (previewCode) previewCode.textContent = code;
      if (previewHex) previewHex.textContent = hex;
      const text = `${name} · ${code} · ${hex}`;
      try {
        await navigator.clipboard.writeText(text);
        if (previewToast) previewToast.textContent = "Renk bilgisi kopyalandı";
      } catch {
        if (previewToast) previewToast.textContent = text;
      }
      setTimeout(() => {
        if (previewToast) previewToast.textContent = "";
      }, 2200);
    });
  });

  /* ─── WhatsApp FAB ─── */
  // Ülke kodu ile yazın, örn. 905551112233 (başında + olmasın)
  const WHATSAPP_NUMBER = "905332238145";
  const WHATSAPP_TEXT = "Merhaba, boyanması gereken mobilyam var.";
  const waFab = document.querySelector("#whatsapp-fab");
  if (waFab) {
    const msg = encodeURIComponent(WHATSAPP_TEXT);
    waFab.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
  }

  /* ─── Hızlı arama (WhatsApp ile aynı numara) ─── */
  const callFab = document.querySelector("#call-fab");
  if (callFab) callFab.href = `tel:+${WHATSAPP_NUMBER}`;

  /* ─── Yıl ─── */
  const year = document.querySelector("#current-year");
  if (year) year.textContent = new Date().getFullYear();

  /* ─── Form ─── */
  const CONTACT_EMAIL = "sulho6180@gmail.com";
  const form = document.querySelector("#contact-form");
  const status = document.querySelector("#form-status");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    if (CONTACT_EMAIL.includes("eposta-adresinizi-buraya-yazin")) {
      if (status) status.textContent = "Form hazır. main.js içindeki CONTACT_EMAIL alanına gerçek e-posta adresini ekleyin.";
      return;
    }

    const data = new FormData(form);
    const subject = `[Doğadan Mobilya Boyama] ${data.get("subject")}`;
    const body = [
      `Ad: ${data.get("name")}`,
      `E-posta: ${data.get("email")}`,
      `Konu: ${data.get("subject")}`,
      "",
      "Mesaj:",
      data.get("message")
    ].join("\n");

    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (status) status.textContent = "E-posta uygulamanız açılıyor…";
  });

  /* ─── PWA: service worker + yükleme düğmesi ─── */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  const installBtn = document.querySelector("#install-btn");
  const installIos = document.querySelector("#install-ios");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferredPrompt = null;

  if (!isStandalone) {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;
      if (installBtn) installBtn.hidden = false;
    });

    installBtn?.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      installBtn.hidden = true;
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      if (installBtn) installBtn.hidden = true;
      if (installIos) installIos.hidden = true;
    });

    /* iOS Safari "yükle" olayı sunmaz: kısa talimat göster */
    if (isIos && installIos) installIos.hidden = false;
  }
})();