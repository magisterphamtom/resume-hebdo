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
 * { "resumes": [ { "session": 105, "titre": "…", "fichier": "session-105.webp" } ] }
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
        path: `${baseDir()}/${entry.fichier}`
      }))
      .sort((x, y) => y.session - x.session);
    return entries.length ? { entries, stamp } : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Liste des résumés illisible`, err);
    return null;
  }
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
        return { entries: index.entries, stamp: latestStamp };
      }
    }
  }

  const candidates = custom
    ? [custom]
    : EXTENSIONS.map((ext) => `${baseDir()}/dernier-resume.${ext}`);
  for (const path of candidates) {
    const stamp = await fetchStamp(path);
    if (stamp) return { entries: [{ session: 0, titre: "", path, stamp }], stamp };
  }
  return null;
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
      share: ResumeViewer.#onShare
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

  async _prepareContext() {
    const resume = await resolveResume();
    this.stamp = resume?.stamp ?? null;
    const isNew = !!resume && resume.stamp !== game.settings.get(MODULE_ID, "lastSeen");
    this.entries = (resume?.entries ?? []).map((entry, i) => ({
      index: i,
      active: i === 0,
      isNew: i === 0 && isNew,
      label: entry.session ? `S${entry.session}` : game.i18n.localize("RESUME_HEBDO.Titre"),
      titre: entry.titre,
      src: `${foundry.utils.getRoute(entry.path)}?v=${entry.stamp}`
    }));
    return {
      src: this.entries[0]?.src ?? "",
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
        new: game.i18n.localize("RESUME_HEBDO.Nouveau")
      }
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
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
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx));
      ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty));
    };
    const fitView = () => {
      if (!img.naturalWidth || !viewport.clientWidth) return;
      fit = Math.min(viewport.clientWidth / img.naturalWidth, viewport.clientHeight / img.naturalHeight);
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
    const zoomCenter = (factor) => zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    let drag = null;
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, tx, ty };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("rh-dragging");
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!drag) return;
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
    viewport.addEventListener("dblclick", fitView);

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
    img.addEventListener("load", () => this.zoomApi?.fit(), { once: true });
    img.src = entry.src;
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
    default: true
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
