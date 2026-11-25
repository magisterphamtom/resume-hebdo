const MODULE_ID = "resume-hebdo";
const VIEWER_ID = "resume-hebdo-viewer";
const SOCKET = `module.${MODULE_ID}`;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Extensions essayées dans l'ordre pour le fichier par défaut. */
const EXTENSIONS = ["webp", "png", "jpg", "jpeg"];

/** Dossier des résumés du monde courant. */
const baseDir = () => `worlds/${game.world.id}/resume`;

/** Date de dernière modification d'un fichier, ou null s'il est introuvable. */
async function fetchStamp(path) {
  try {
    const res = await fetch(foundry.utils.getRoute(path), { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    const modified = Date.parse(res.headers.get("last-modified") ?? "");
    if (!Number.isNaN(modified)) return modified;
    return Number(res.headers.get("content-length")) || 1;
  } catch (err) {
    console.warn(`${MODULE_ID} | Fichier du résumé injoignable`, err);
    return null;
  }
}

/**
 * Lit la liste des séances (resume/index.json) :
 * { "resumes": [ { "session": 105, "titre": "…", "fichier": "session-105.webp", "verso": "session-105-verso.webp" } ] }
 * « verso » est facultatif : sans lui, le module cherche tout seul « session-105-verso.webp » à côté du recto.
 * Retourne null si le fichier n'existe pas ou est invalide.
 */
async function fetchIndex() {
  try {
    const res = await fetch(foundry.utils.getRoute(`${baseDir()}/index.json`), { cache: "no-store" });
    if (!res.ok) return null;
    const stamp = Date.parse(res.headers.get("last-modified") ?? "") || 1;
    const data = await res.json();
    const list = Array.isArray(data?.resumes) ? data.resumes : [];
    const entries = list
      .filter((entry) => entry?.fichier)
      .map((entry) => ({
        session: Number(entry.session) || 0,
        titre: String(entry.titre ?? ""),
        path: `${baseDir()}/${entry.fichier}`,
        versoPath: entry.verso ? `${baseDir()}/${entry.verso}` : null
      }))
      .sort((x, y) => y.session - x.session);
    return entries.length ? { entries, stamp } : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Liste des résumés illisible`, err);
    return null;
  }
}

/** Chemin du verso deviné d'après le recto : « nom.webp » → « nom-verso.webp ». */
const versoGuess = (path) => path.replace(/(\.[a-z0-9]+)$/i, "-verso$1");

/** Complète chaque résumé avec son verso (indiqué dans index.json, ou trouvé à côté du recto). */
async function findVersos(entries) {
  await Promise.all(entries.map(async (entry) => {
    const path = entry.versoPath ?? versoGuess(entry.path);
    entry.versoPath = (await fetchStamp(path)) ? path : null;
  }));
  return entries;
}

/**
 * Trouve les résumés à afficher.
 * 1. Fichier choisi dans les réglages : un seul résumé, sans onglets.
 * 2. Sinon resume/index.json : un onglet par séance (la plus récente en premier).
 * 3. Sinon resume/dernier-resume.(webp|png|jpg|jpeg) : un seul résumé.
 * @returns {Promise<{entries: object[], stamp: number}|null>} stamp = version du résumé le plus récent
 */
async function resolveResume() {
  const custom = game.settings.get(MODULE_ID, "imagePath");

  if (!custom) {
    const index = await fetchIndex();
    if (index) {
      const latestStamp = await fetchStamp(index.entries[0].path);
      if (latestStamp) {
        index.entries.forEach((entry, i) => {
          entry.stamp = i === 0 ? latestStamp : index.stamp;
        });
        return { entries: await findVersos(index.entries), stamp: latestStamp };
      }
    }
  }

  const candidates = custom
    ? [custom]
    : EXTENSIONS.map((ext) => `${baseDir()}/dernier-resume.${ext}`);
  for (const path of candidates) {
    const stamp = await fetchStamp(path);
    if (stamp) return { entries: await findVersos([{ session: 0, titre: "", path, stamp }]), stamp };
  }
  return null;
}

/** Habillage de la fenêtre : « fantasy » (grimoire) ou « classique » ; « auto » = fantasy pour les systèmes médiévaux-fantastiques. */
const FANTASY_SYSTEMS = new Set(["dnd5e", "pf2e", "pf1", "a5e", "black-flag", "dragonbane", "forbidden-lands", "tormenta20"]);
function skin() {
  const value = game.settings.get(MODULE_ID, "habillage");
  if (value === "fantasy" || value === "classique") return value;
  return FANTASY_SYSTEMS.has(game.system.id) ? "fantasy" : "classique";
}

/** Fenêtre d'affichage du résumé hebdomadaire. */
class ResumeViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: VIEWER_ID,
    classes: ["resume-hebdo"],
    tag: "section",
    window: {
      title: "RESUME_HEBDO.Titre",
      icon: "fa-solid fa-scroll",
      resizable: true
    },
    position: { width: 720, height: 820 },
    actions: {
      zoomIn: ResumeViewer.#onZoomIn,
      zoomOut: ResumeViewer.#onZoomOut,
      fit: ResumeViewer.#onFit,
      selectTab: ResumeViewer.#onSelectTab,
      share: ResumeViewer.#onShare,
      flip: ResumeViewer.#onFlip,
      fullscreen: ResumeViewer.#onFullscreen
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/viewer.hbs` }
  };

  /** Version du fichier affichée dans la fenêtre. */
  stamp = null;

  /** Commandes de zoom de la vue en cours (définies au rendu). */
  zoomApi = null;

  #resizeObserver = null;

  /** Résumés affichables (un par onglet), dans l'ordre d'affichage. */
  entries = [];

  /** Résumé affiché (index dans entries), face visible (0 = recto, 1 = verso), retournement en cours. */
  entryIndex = 0;
  page = 0;
  flipping = false;

  async _prepareContext() {
    const resume = await resolveResume();
    this.stamp = resume?.stamp ?? null;
    const isNew = !!resume && resume.stamp !== game.settings.get(MODULE_ID, "lastSeen");
    const fantasy = skin() === "fantasy";
    this.entryIndex = 0;
    this.page = 0;
    this.entries = (resume?.entries ?? []).map((entry, i) => ({
      index: i,
      active: i === 0,
      isNew: i === 0 && isNew,
      label: entry.session ? (fantasy ? game.i18n.format("RESUME_HEBDO.Seance", { n: entry.session }) : `S${entry.session}`) : game.i18n.localize("RESUME_HEBDO.Titre"),
      titre: entry.titre,
      src: `${foundry.utils.getRoute(entry.path)}?v=${entry.stamp}`,
      verso: entry.versoPath ? `${foundry.utils.getRoute(entry.versoPath)}?v=${entry.stamp}` : null
    }));
    return {
      src: this.entries[0]?.src ?? "",
      hasVerso: !!this.entries[0]?.verso,
      fantasy,
      entries: this.entries,
      showTabs: this.entries.length > 1,
      isGM: game.user.isGM,
      labels: {
        zoomIn: game.i18n.localize("RESUME_HEBDO.ZoomPlus"),
        zoomOut: game.i18n.localize("RESUME_HEBDO.ZoomMoins"),
        fit: game.i18n.localize("RESUME_HEBDO.Ajuster"),
        hint: game.i18n.localize("RESUME_HEBDO.Aide"),
        share: game.i18n.localize("RESUME_HEBDO.Partager"),
        none: game.i18n.localize("RESUME_HEBDO.AucunResume"),
        new: game.i18n.localize("RESUME_HEBDO.Nouveau"),
        flip: game.i18n.localize("RESUME_HEBDO.Retourner"),
        recto: game.i18n.localize("RESUME_HEBDO.Recto"),
        fullscreen: game.i18n.localize("RESUME_HEBDO.Grand")
      }
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.classList.toggle("rh-fantasy", skin() === "fantasy");
    // Le résumé est considéré comme « vu » dès qu'il est affiché.
    if (this.stamp && game.settings.get(MODULE_ID, "lastSeen") !== this.stamp) {
      game.settings.set(MODULE_ID, "lastSeen", this.stamp).catch(() => {});
    }
    this.#setupZoom();
  }

  async _onClose(options) {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    return super._onClose?.(options);
  }

  /**
   * Zoom à la molette (centré sur le curseur), déplacement en glissant,
   * double-clic pour ajuster. Le dézoom s'arrête à l'image entière.
   */
  #setupZoom() {
    this.#resizeObserver?.disconnect();
    this.zoomApi = null;
    const viewport = this.element.querySelector(".rh-scroll");
    const img = viewport?.querySelector(".rh-img");
    if (!viewport || !img) return;
    // Les calculs se font sur la feuille (dans l'habillage fantasy, elle est un peu en retrait du cadre)
    const box = viewport.querySelector(".rh-sheet") ?? viewport;

    let fit = 1;
    let scale = 1;
    let tx = 0;
    let ty = 0;
    let atFit = true;

    const maxScale = () => Math.max(fit, 3);
    const apply = () => {
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    const clamp = () => {
      const vw = box.clientWidth;
      const vh = box.clientHeight;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx));
      ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty));
    };
    const fitView = () => {
      if (!img.naturalWidth || !box.clientWidth) return;
      fit = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
      scale = fit;
      atFit = true;
      clamp();
      apply();
    };
    const zoomAt = (factor, cx, cy) => {
      const next = Math.min(maxScale(), Math.max(fit, scale * factor));
      const ratio = next / scale;
      tx = cx - (cx - tx) * ratio;
      ty = cy - (cy - ty) * ratio;
      scale = next;
      atFit = scale <= fit * 1.001;
      clamp();
      apply();
    };
    const zoomCenter = (factor) => zoomAt(factor, box.clientWidth / 2, box.clientHeight / 2);

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    let drag = null;
    let moved = false;
    let clickTimer = null;
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, tx, ty };
      moved = false;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("rh-dragging");
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!drag) return;
      if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 5) moved = true;
      tx = drag.tx + (event.clientX - drag.x);
      ty = drag.ty + (event.clientY - drag.y);
      clamp();
      apply();
    });
    const endDrag = () => {
      drag = null;
      viewport.classList.remove("rh-dragging");
    };
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    // Un clic (sans glisser) retourne la feuille s'il y a un verso ; deux clics rapprochés ajustent à la fenêtre.
    viewport.addEventListener("click", (event) => {
      if (moved || event.button !== 0) return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        fitView();
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (this.entries[this.entryIndex]?.verso) ResumeViewer.#onFlip.call(this);
      }, 250);
    });

    // Si la fenêtre est redimensionnée : on réajuste, ou on garde le zoom courant.
    this.#resizeObserver = new ResizeObserver(() => {
      if (atFit) fitView();
      else {
        clamp();
        apply();
      }
    });
    this.#resizeObserver.observe(viewport);

    if (img.complete && img.naturalWidth) fitView();
    else img.addEventListener("load", fitView, { once: true });

    this.zoomApi = { zoomIn: () => zoomCenter(1.4), zoomOut: () => zoomCenter(1 / 1.4), fit: fitView };
  }

  static #onZoomIn() {
    this.zoomApi?.zoomIn();
  }

  static #onZoomOut() {
    this.zoomApi?.zoomOut();
  }

  static #onFit() {
    this.zoomApi?.fit();
  }

  static #onSelectTab(event, target) {
    const entry = this.entries[Number(target.dataset.index)];
    const img = this.element.querySelector(".rh-img");
    if (!entry || !img) return;
    this.element.querySelectorAll(".rh-tab").forEach((tab) => {
      tab.classList.toggle("active", tab === target);
    });
    target.querySelector(".rh-new")?.remove();
    this.entryIndex = Number(target.dataset.index);
    this.page = 0;
    this.#syncFlip();
    img.addEventListener("load", () => this.zoomApi?.fit(), { once: true });
    img.src = entry.src;
  }

  /** Affiche ou cache le bouton « Retourner » selon que la séance a un verso, avec la face visible (Recto / Verso). */
  #syncFlip() {
    const button = this.element.querySelector(".rh-flip");
    if (!button) return;
    button.hidden = !this.entries[this.entryIndex]?.verso;
    const label = button.querySelector(".rh-flip-label");
    if (label) label.textContent = game.i18n.localize(this.page ? "RESUME_HEBDO.Verso" : "RESUME_HEBDO.Recto");
  }

  /** Retourne la feuille (comme coc7-resume-epoques) : la feuille pivote sur son axe, l'image change, puis la feuille revient. */
  static async #onFlip() {
    const entry = this.entries[this.entryIndex];
    const viewport = this.element.querySelector(".rh-scroll");
    const img = viewport?.querySelector(".rh-img");
    if (this.flipping || !entry?.verso || !img) return;
    this.flipping = true;
    const turn = (deg) => `perspective(1400px) rotateY(${deg}deg)`;
    try {
      await viewport.animate([{ transform: turn(0) }, { transform: turn(90) }], { duration: 220, easing: "ease-in", fill: "forwards" }).finished;
      this.page = this.page ? 0 : 1;
      const src = this.page ? entry.verso : entry.src;
      await new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
        img.src = src;
      });
      this.zoomApi?.fit();
      viewport.getAnimations().forEach((animation) => animation.cancel());
      await viewport.animate([{ transform: turn(-90) }, { transform: turn(0) }], { duration: 220, easing: "ease-out" }).finished;
    } catch (err) {
      console.warn(`${MODULE_ID} | Retournement interrompu`, err);
    } finally {
      this.flipping = false;
      this.#syncFlip();
    }
  }

  /** Ouvre le résumé en grand, par-dessus tout l'écran (Échap, clic à côté ou bouton pour fermer). */
  static #onFullscreen() {
    const entry = this.entries[this.entryIndex];
    if (!entry) return;
    openLightbox(entry, this.page, skin() === "fantasy", (page) => {
      if (page === this.page || this.flipping) return;
      this.page = page;
      const img = this.element?.querySelector(".rh-img");
      if (img) {
        img.addEventListener("load", () => this.zoomApi?.fit(), { once: true });
        img.src = page ? entry.verso : entry.src;
      }
      this.#syncFlip();
    });
  }

  static #onShare() {
    try {
      game.socket.emit(SOCKET, { action: "show" });
      ui.notifications.info(game.i18n.localize("RESUME_HEBDO.PartageOk"));
    } catch (err) {
      console.error(`${MODULE_ID} | Échec du partage`, err);
      ui.notifications.error(game.i18n.localize("RESUME_HEBDO.PartageErreur"));
    }
  }
}

/**
 * Résumé en grand sur tout l'écran : l'image tient dans l'écran, molette pour zoomer, glisser pour déplacer,
 * double-clic pour revenir, « Retourner » s'il y a un verso. Échap, clic sur le fond ou ✕ pour fermer.
 * @param {object} entry    Résumé (src, verso)
 * @param {number} page     Face affichée au départ (0 recto, 1 verso)
 * @param {boolean} fantasy Habillage fantasy
 * @param {Function} onPage Appelée avec la face visible à la fermeture, pour garder la fenêtre en accord
 */
function openLightbox(entry, page, fantasy, onPage) {
  document.querySelector(".rh-lightbox")?.remove();
  const t = (k) => game.i18n.localize(`RESUME_HEBDO.${k}`);
  const box = document.createElement("div");
  box.className = `rh-lightbox${fantasy ? " rh-fantasy" : ""}`;
  box.innerHTML = `<div class="rh-lb-scene"><img class="rh-lb-img" alt="" draggable="false"></div>
    <div class="rh-lb-bar">
      ${entry.verso ? `<button type="button" class="rh-lb-flip"><i class="fa-solid fa-rotate"></i> ${t("Retourner")}</button><span class="rh-lb-page"></span>` : ""}
      <span class="rh-lb-hint">${t("AideGrand")}</span>
      <button type="button" class="rh-lb-close" aria-label="${t("Fermer")}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  document.body.append(box);
  const scene = box.querySelector(".rh-lb-scene");
  const img = box.querySelector(".rh-lb-img");
  const label = box.querySelector(".rh-lb-page");
  let scale = 1, tx = 0, ty = 0, drag = null, moved = false, busy = false;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const reset = () => { scale = 1; tx = 0; ty = 0; apply(); };
  const show = () => { img.src = page ? entry.verso : entry.src; if (label) label.textContent = t(page ? "Verso" : "Recto"); reset(); };
  const close = () => { document.removeEventListener("keydown", onKey, true); box.remove(); onPage?.(page); };
  const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(); } };
  const flip = async () => {
    if (busy || !entry.verso) return;
    busy = true;
    const turn = (deg) => `perspective(1800px) rotateY(${deg}deg)`;
    try {
      await scene.animate([{ transform: turn(0) }, { transform: turn(90) }], { duration: 240, easing: "ease-in", fill: "forwards" }).finished;
      page = page ? 0 : 1;
      await new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); show(); });
      scene.getAnimations().forEach((a) => a.cancel());
      await scene.animate([{ transform: turn(-90) }, { transform: turn(0) }], { duration: 240, easing: "ease-out" }).finished;
    } catch (err) { /* retournement interrompu */ } finally { busy = false; }
  };
  box.querySelector(".rh-lb-close").addEventListener("click", close);
  box.querySelector(".rh-lb-flip")?.addEventListener("click", flip);
  box.addEventListener("click", (event) => { if (event.target === box || event.target === scene) close(); });
  scene.addEventListener("wheel", (event) => {
    event.preventDefault();
    const r = img.getBoundingClientRect();
    const next = Math.min(4, Math.max(1, scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const cx = event.clientX - (r.left + r.width / 2); const cy = event.clientY - (r.top + r.height / 2);
    tx -= cx * (next / scale - 1); ty -= cy * (next / scale - 1); scale = next;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });
  img.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, tx, ty }; moved = false; img.setPointerCapture(event.pointerId); });
  img.addEventListener("pointermove", (event) => { if (!drag) return; if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) moved = true; if (scale > 1) { tx = drag.tx + event.clientX - drag.x; ty = drag.ty + event.clientY - drag.y; apply(); } });
  img.addEventListener("pointerup", () => { drag = null; });
  // Un clic (sans glisser) tourne la page s'il y a un verso ; un double-clic revient à la taille de l'écran.
  let clickTimer = null;
  img.addEventListener("click", (event) => {
    event.stopPropagation();
    if (moved || event.button !== 0) return;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; reset(); return; }
    clickTimer = setTimeout(() => { clickTimer = null; flip(); }, 250);
  });
  document.addEventListener("keydown", onKey, true);
  show();
}

/**
 * Ouvre (ou rafraîchit) la fenêtre du résumé.
 * @param {object} [options]
 * @param {boolean} [options.silent] Ne rien afficher si aucun résumé n'existe.
 */
async function openViewer({ silent = false } = {}) {
  try {
    if (!(await resolveResume())) {
      if (!silent) ui.notifications.info(game.i18n.localize("RESUME_HEBDO.AucunResume"));
      return;
    }
    const existing = foundry.applications.instances.get(VIEWER_ID);
    if (existing) {
      await existing.render({ force: true });
      existing.bringToFront?.();
      return;
    }
    await new ResumeViewer().render({ force: true });
  } catch (err) {
    console.error(`${MODULE_ID} | Échec d'ouverture`, err);
    ui.notifications.error(game.i18n.localize("RESUME_HEBDO.OuvertureErreur"));
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "imagePath", {
    name: "RESUME_HEBDO.Reglage.Image.Nom",
    hint: "RESUME_HEBDO.Reglage.Image.Aide",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "",
    filePicker: "image"
  });

  game.settings.register(MODULE_ID, "habillage", {
    name: "RESUME_HEBDO.Reglage.Habillage.Nom",
    hint: "RESUME_HEBDO.Reglage.Habillage.Aide",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      auto: "RESUME_HEBDO.Reglage.Habillage.Auto",
      fantasy: "RESUME_HEBDO.Reglage.Habillage.Fantasy",
      classique: "RESUME_HEBDO.Reglage.Habillage.Classique"
    },
    default: "auto",
    onChange: () => foundry.applications.instances.get(VIEWER_ID)?.render({ force: true })
  });

  game.settings.register(MODULE_ID, "lastSeen", {
    scope: "client",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(MODULE_ID, "autoOpen", {
    name: "RESUME_HEBDO.Reglage.Auto.Nom",
    hint: "RESUME_HEBDO.Reglage.Auto.Aide",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", async () => {
  game.socket.on(SOCKET, (data) => {
    if (data?.action === "show") openViewer();
  });

  // Ouverture automatique à la connexion si le résumé n'a pas encore été vu.
  if (!game.settings.get(MODULE_ID, "autoOpen")) return;
  const resume = await resolveResume();
  if (resume && resume.stamp !== game.settings.get(MODULE_ID, "lastSeen")) {
    setTimeout(() => openViewer({ silent: true }), 1000);
  }
});

// Bouton toujours disponible dans la barre d'outils de gauche (joueurs et MJ).
Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls.tokens ?? Object.values(controls)[0];
  if (!group?.tools) return;
  group.tools.resumeHebdo = {
    name: "resumeHebdo",
    title: "RESUME_HEBDO.Bouton",
    icon: "fa-solid fa-scroll",
    order: 100,
    button: true,
    visible: true,
    onChange: () => openViewer()
  };
});
