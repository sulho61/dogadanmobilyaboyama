/* Doğadan Atölye — gezinme, galeri lightbox, renk kataloğu, form, PWA */
(() => {
  "use strict";

  /* ─── Tarayıcının kendi "resmi sürükle" özelliğini kapat (pan / kaydırmayı bozuyordu) ─── */
  document.addEventListener("dragstart", (event) => {
    if (event.target.closest?.(".lightbox, .gallery-open")) event.preventDefault();
  });

  /* ─── Tema: varsayılan açık (beyaz), elle koyuya geçilir ─── */
  const THEME_COLORS = { light: "#f5f5f7", dark: "#111113" };
  const root = document.documentElement;
  const themeBtn = document.querySelector("#theme-toggle");
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function applyTheme(theme, save) {
    const dark = theme === "dark";
    if (dark) root.dataset.theme = "dark";
    else delete root.dataset.theme;
    themeMeta?.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
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
  let navLock = false;
  let navLockTimer;

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
    /* Sayfa en altındaysa son bölüm, kısa olsa bile aktif sayılsın */
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) current = sections[sections.length - 1].id;
    setActiveNav(current);
  }

  function releaseNavLock() {
    navLock = false;
    clearTimeout(navLockTimer);
    updateActiveFromScroll();
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
        if (!id) return;
        setActiveNav(id);
        /* Yumuşak kaydırma sırasında vurgu ara bölümlerde zıplamasın */
        navLock = true;
        clearTimeout(navLockTimer);
        navLockTimer = setTimeout(releaseNavLock, 1200);
      });
    });
    window.addEventListener("scrollend", () => { if (navLock) releaseNavLock(); });
  }

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      /* Lightbox açıkken sayfa kilitli: scrollY 0 görünür, durumu bozma */
      if (document.body.classList.contains("lightbox-open")) return;
      if (!navLock) updateActiveFromScroll();
      updateScrollHint();
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
    let youtubeEl = lightbox.querySelector("#lightbox-youtube");
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

    /* Erişilebilirlik: diyalog olarak işaretle, arka plan düğmesi Tab sırasında olmasın */
    if (!lightbox.hasAttribute("role")) lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    if (backdrop) {
      backdrop.tabIndex = -1;
      backdrop.setAttribute("aria-hidden", "true");
    }

    let items = [];
    let current = 0;
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let previousFocus = null;
    let lockScrollY = 0;

    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let panStartX = 0;
    let panStartY = 0;
    let originPanX = 0;
    let originPanY = 0;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeActive = false;
    let dragMoved = false;
    let lastTap = 0;
    let toastTimer;
    const shareFileCache = new Map();

    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    const SWIPE_THRESHOLD = 56;
    const MOVE_TOLERANCE = 8;

    function collectItems() {
      return [...document.querySelectorAll(".gallery-open")]
        .filter((btn) => {
          const card = btn.closest(".gallery-card");
          return !card || !card.hidden;
        })
        .map((btn, i) => {
          const img = btn.querySelector("img, video");
          const type = btn.dataset.type || (btn.dataset.video ? "video" : "image");
          return {
            index: i,
            type,
            src: btn.dataset.image || btn.dataset.video || img?.src || "",
            videoId: btn.dataset.videoId || "",
            poster: btn.dataset.poster || "",
            title: btn.dataset.title || img?.alt || "Çalışma",
            alt: img?.alt || btn.dataset.title || "Mobilya çalışması",
            button: btn
          };
        });
    }

    /* ─── Yakınlaştırma / kaydırma ─── */
    function clampPan() {
      if (!mediaWrap) return;
      if (scale <= 1) {
        panX = 0;
        panY = 0;
        return;
      }
      /* Görsel tamamen ekran dışına sürüklenemesin */
      const maxX = (mediaWrap.offsetWidth * (scale - 1)) / 2 + 40;
      const maxY = (mediaWrap.offsetHeight * (scale - 1)) / 2 + 40;
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
    }

    function applyTransform() {
      if (!mediaWrap) return;
      clampPan();
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
      applyTransform();
    }

    /* ─── Medya yönetimi ─── */
    /* iframe'in src'sini değiştirmek geri tuşu geçmişine kayıt ekler ve ses açık kalabilir.
       Bu yüzden her seferinde iframe'i yenisiyle değiştiriyoruz. */
    function setYoutube(src, title) {
      if (!youtubeEl) return;
      if (!src && !youtubeEl.hasAttribute("src")) {
        youtubeEl.hidden = true;
        return;
      }
      const fresh = youtubeEl.cloneNode(false);
      if (src) fresh.setAttribute("src", src);
      else fresh.removeAttribute("src");
      if (!fresh.getAttribute("allow")) {
        fresh.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
      }
      fresh.setAttribute("allowfullscreen", "");
      fresh.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      if (title) fresh.setAttribute("title", title);
      fresh.hidden = !src;
      youtubeEl.replaceWith(fresh);
      youtubeEl = fresh;
    }

    function stopMedia() {
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute("src");
        videoEl.removeAttribute("poster");
        videoEl.load();
        videoEl.hidden = true;
      }
      setYoutube("");
      if (imgEl) {
        imgEl.hidden = true;
        imgEl.removeAttribute("src");
      }
    }

    function showItem(index) {
      if (!items.length) return;
      current = (index + items.length) % items.length;
      const item = items[current];
      resetZoom();
      stopMedia();

      if (item.type === "video" && videoEl) {
        if (item.poster) videoEl.poster = item.poster;
        videoEl.controls = true;
        videoEl.playsInline = true;
        videoEl.src = item.src;
        videoEl.hidden = false;
      } else if (item.type === "youtube" && youtubeEl) {
        if (/^[a-zA-Z0-9_-]{11}$/.test(item.videoId)) {
          setYoutube(
            `https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=1&rel=0&playsinline=1`,
            item.title
          );
        } else {
          showToast("YouTube video kimliği geçersiz");
        }
      } else if (imgEl) {
        imgEl.src = item.src;
        imgEl.alt = item.alt;
        imgEl.hidden = false;
      }

      if (item.type === "image") item.filePromise = getShareFile(item);
      if (captionEl) captionEl.textContent = item.title;
      if (counterEl) counterEl.textContent = `${current + 1} / ${items.length}`;
      const single = items.length < 2;
      if (btnPrev) btnPrev.hidden = single;
      if (btnNext) btnNext.hidden = single;
    }

    /* ─── Paylaş ─── */
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

    /* Görseli önceden dosyaya çevir: paylaşım jesti kaybolmasın (aynı görsel tekrar indirilmez) */
    function getShareFile(item) {
      if (!shareFileCache.has(item.src)) shareFileCache.set(item.src, buildShareFile(item));
      return shareFileCache.get(item.src);
    }

    async function buildShareFile(item) {
      try {
        const res = await fetch(absUrl(item.src));
        if (!res.ok) return null;
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
      const url = item.type === "youtube"
        ? `https://www.youtube.com/watch?v=${item.videoId}`
        : absUrl(item.src);
      const text = `${item.title} — LazVeGaz Atölye`;
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

    /* ─── Aç / kapat (sayfa konumu korunur) ─── */
    function openAt(index) {
      previousFocus = document.activeElement;
      showItem(index);

      /* body "fixed" olunca sayfa en üste atlıyordu: konumu kaydet */
      lockScrollY = window.scrollY;
      const b = document.body;
      b.style.top = `-${lockScrollY}px`;
      b.style.left = "0";
      b.style.right = "0";

      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
      b.classList.add("lightbox-open");
      document.documentElement.classList.add("lightbox-open");
      btnClose?.focus({ preventScroll: true });
    }

    function closeLightbox() {
      if (!lightbox.classList.contains("is-open")) return;
      stopMedia();
      pointers.clear();
      swipeActive = false;
      resetZoom();
      lightbox.classList.remove("is-open", "is-dragging", "is-zoomed");
      lightbox.setAttribute("aria-hidden", "true");

      const b = document.body;
      b.classList.remove("lightbox-open");
      document.documentElement.classList.remove("lightbox-open");
      b.style.top = "";
      b.style.left = "";
      b.style.right = "";

      /* html { scroll-behavior: smooth } yüzünden eski konuma kayarak dönüyordu:
         geri yüklerken geçici olarak anında kaydır */
      const html = document.documentElement;
      const prevBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      window.scrollTo(0, lockScrollY);
      html.style.scrollBehavior = prevBehavior;

      previousFocus?.focus?.({ preventScroll: true });
    }

    function next() { showItem(current + 1); }
    function prev() { showItem(current - 1); }

    /* Olay devri: sonradan eklenen galeri kartları da çalışır */
    document.addEventListener("click", (event) => {
      const btn = event.target.closest?.(".gallery-open");
      if (!btn) return;
      items = collectItems();
      if (!items.length) return;
      const idx = items.findIndex((it) => it.button === btn);
      openAt(idx >= 0 ? idx : 0);
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

      if (event.key === "Escape") {
        closeLightbox();
        return;
      }

      /* Tab tuşu lightbox dışına kaçmasın */
      if (event.key === "Tab") {
        const focusables = [...lightbox.querySelectorAll(
          "button, [href], input, select, textarea, video[controls], iframe, [tabindex]:not([tabindex='-1'])"
        )].filter((el) => el !== backdrop && !el.disabled && !el.hidden && el.getClientRects().length > 0);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!lightbox.contains(active)) {
          first.focus();
          event.preventDefault();
        } else if (event.shiftKey && active === first) {
          last.focus();
          event.preventDefault();
        } else if (!event.shiftKey && active === last) {
          first.focus();
          event.preventDefault();
        }
        return;
      }

      /* Video oynatıcı kendi ok / +/- tuşlarını kullanıyor: karışma */
      if (event.target instanceof Element && event.target.closest("video")) return;

      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") prev();
      if (event.key === "+" || event.key === "=") setZoom(scale + 0.3);
      if (event.key === "-") setZoom(scale - 0.3);
      if (event.key === "0") resetZoom();
    });

    /* Tek tık: görselin dışına tıklayınca kapat. Çift tık: yakınlaştır / sıfırla. */
    stage?.addEventListener("click", (event) => {
      if (event.target.closest("button, video, iframe")) return;
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      if (mediaWrap && scale <= 1.05) {
        const rect = mediaWrap.getBoundingClientRect();
        const outside =
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) {
          closeLightbox();
          return;
        }
      }
      const now = Date.now();
      if (now - lastTap < 280) {
        if (scale > 1.1) resetZoom();
        else setZoom(2.2);
        event.preventDefault();
        lastTap = 0;
        return;
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
      if (event.target.closest("button, iframe, video")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      try { stage.setPointerCapture(event.pointerId); } catch { /* yoksay */ }
      pointers.set(event.pointerId, event);

      if (pointers.size === 1) {
        dragMoved = false;
        swipeActive = scale <= 1.05;
        swipeStartX = event.clientX;
        swipeStartY = event.clientY;
        panStartX = event.clientX;
        panStartY = event.clientY;
        originPanX = panX;
        originPanY = panY;
      } else if (pointers.size === 2) {
        swipeActive = false;
        dragMoved = true;
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
        lightbox.classList.add("is-dragging");
        if (pinchStartDist > 0) setZoom(pinchStartScale * (dist / pinchStartDist));
        return;
      }

      if (pointers.size === 1) {
        const dx = event.clientX - panStartX;
        const dy = event.clientY - panStartY;

        if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
          dragMoved = true;
          lightbox.classList.add("is-dragging");
        }

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

    function endPointer(event, cancelled = false) {
      if (!pointers.has(event.pointerId)) return;
      const wasSingle = pointers.size === 1;
      const wasSwipe = swipeActive && wasSingle && scale <= 1.05;
      const dx = event.clientX - swipeStartX;
      const dy = event.clientY - swipeStartY;
      pointers.delete(event.pointerId);
      try { stage.releasePointerCapture(event.pointerId); } catch { /* yoksay */ }

      if (pointers.size < 2) pinchStartDist = 0;

      /* Kıstırma bitti, bir parmak kaldı: kaydırma başlangıcını yeniden ayarla (aksi halde görsel zıplıyordu) */
      if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        panStartX = p.clientX;
        panStartY = p.clientY;
        originPanX = panX;
        originPanY = panY;
        swipeActive = false;
        return;
      }

      lightbox.classList.remove("is-dragging");
      swipeActive = false;

      if (!cancelled && wasSwipe && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) next();
        else prev();
      } else if (scale <= 1.05) {
        resetZoom();
      }
    }

    stage?.addEventListener("pointerup", (event) => endPointer(event));
    stage?.addEventListener("pointercancel", (event) => endPointer(event, true));
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
  let previewToastTimer;

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
      colorCats.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
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
      colorPreview?.style.setProperty("--paint", hex);
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
      /* Art arda tıklamada eski zamanlayıcı yeni mesajı erken silmesin */
      clearTimeout(previewToastTimer);
      previewToastTimer = setTimeout(() => {
        if (previewToast) previewToast.textContent = "";
      }, 2200);
    });
  });

    /* ─── Önizleme: mobilya türü seçimi ─── */   // ← BURAYA yapıştırın
  const previewSvg = document.querySelector("#preview-furniture");
  const shapeBtns = [...document.querySelectorAll(".preview-shape-btn")];
  shapeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      previewSvg?.setAttribute("data-shape", btn.dataset.shape);
      shapeBtns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
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
    /* Uygulama (PWA) penceresi WhatsApp sayfasıyla değişmesin */
    waFab.target = "_blank";
    waFab.rel = "noopener noreferrer";
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

    const data = new FormData(form);
    const field = (name) => String(data.get(name) ?? "").trim();
    const subject = `[LazVeGaz Mobilya Boyama] ${field("subject")}`;
    const body = [
      `Ad: ${field("name")}`,
      `E-posta: ${field("email")}`,
      `Konu: ${field("subject")}`,
      "",
      "Mesaj:",
      field("message")
    ].join("\r\n");

    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (status) status.textContent = "E-posta uygulamanız açılıyor…";
  });

    /* ─── Formu WhatsApp ile gönder ─── */
  const waSubmit = document.querySelector("#wa-submit");
  waSubmit?.addEventListener("click", () => {
    if (!form) return;
    /* E-posta WhatsApp için gerekmez: yalnızca ad, konu, mesaj kontrol edilir */
    const needed = ["name", "subject", "message"].map((n) => form.elements[n]);
    const invalid = needed.find((el) => !el.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }

    const field = (name) => String(form.elements[name]?.value ?? "").trim();
    const lines = [
      `Merhaba, ben ${field("name")}.`,
      `Konu: ${field("subject")}`,
      "",
      field("message")
    ];
    if (field("email")) lines.push("", `E-posta: ${field("email")}`);

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank", "noopener");
    if (status) status.textContent = "WhatsApp açılıyor…";
  });

  /* ─── PWA: service worker + güncelleme bildirimi ─── */
  let updateRequested = false;

  function showUpdateBanner(worker) {
    if (document.querySelector(".update-banner")) return;
    const bar = document.createElement("div");
    bar.className = "update-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<span>Yeni bir güncelleme var.</span>' +
      '<button type="button" class="update-reload">Yenile</button>' +
      '<button type="button" class="update-dismiss" aria-label="Kapat">×</button>';
    document.body.appendChild(bar);

    bar.querySelector(".update-reload").addEventListener("click", (e) => {
      e.currentTarget.disabled = true;
      updateRequested = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    });
    bar.querySelector(".update-dismiss").addEventListener("click", () => bar.remove());
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    /* Yeni sürüm devreye girince sayfayı bir kez yenile (ilk kurulumda değil) */
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateRequested) location.reload();
    });

    const registerSW = () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        /* Sayfa açılmadan önce indirilmiş, bekleyen sürüm varsa */
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateBanner(worker);
            }
          });
        });

        /* Uygulama günlerce açık kalabilir: öne gelince ve saatte bir kontrol et */
        const check = () => reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        setInterval(check, 60 * 60 * 1000);
      }).catch(() => {});
    };
    if (document.readyState === "complete") registerSW();
    else window.addEventListener("load", registerSW, { once: true });
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

(function () {
  var btn = document.getElementById("share-site-btn");
  var status = document.getElementById("share-status");
  if (!btn) return;

  function say(msg) {
    if (!status) return;
    status.textContent = msg;
    clearTimeout(say.t);
    say.t = setTimeout(function () { status.textContent = ""; }, 2500);
  }

  btn.addEventListener("click", async function () {
    var url = location.origin + location.pathname; // #bölüm kısmı olmadan
    var data = {
      title: "LazVeGaz Mobilya Boyama",
      text: "Mobilyalarınıza yeni bir hayat veriyoruz. LazVeGaz Mobilya Boyama:",
      url: url
    };

    // 1) Sistem paylaş menüsü (mobil)
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // kullanıcı vazgeçti
      }
    }

    // 2) Panoya kopyala
    try {
      await navigator.clipboard.writeText(url);
      say("Bağlantı kopyalandı.");
    } catch (e) {
      // 3) Eski tarayıcılar için son çare
      window.prompt("Bağlantıyı kopyalayın:", url);
    }
  });
})();