import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

/* =========================================================
   FIREBASE
   ========================================================= */
const firebaseConfig = {
    apiKey: "AIzaSyD88uuqPYel-IcCqN_ytZx9xbJ2RG7WkQM",
    authDomain: "streaming-mundial.firebaseapp.com",
    projectId: "streaming-mundial",
    messagingSenderId: "286156726345",
    appId: "1:286156726345:web:3306c87cba9ecfb7395f98"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* =========================================================
   CONSTANTES
   ========================================================= */
const SETTINGS_KEY = "scm_settings_v1";
const LAST_PROJECT_KEY = "scm_last_project";

const ESTADOS = { guion: "Guion", locucion: "Locución", musica: "Edición de Música", listo: "Listo" };
const AMBIENTES = ["Terror", "Suspenso", "Épico", "Misterio", "Tristeza", "Calma", "Acción", "SFX", "Otro"];

const FONTS = [
    { name: "Inter", label: "Moderna", css: "'Inter', sans-serif" },
    { name: "Cinzel Decorative", label: "Elegante", css: "'Cinzel Decorative', serif" },
    { name: "Creepster", label: "Tétrica / Terror", css: "'Creepster', cursive" }
];

const DEFAULTS = {
    accent: "#6b48ff", accent2: "#3a2a8f", bg1: "#09090b", bg2: "#1a1a24", glass: "#141419",
    glassOpacity: 0.6, blur: 16, borderAlpha: 0.08, shadowAlpha: 0.4,
    font: FONTS[0].css,
    bgImage: "", bgPath: "", bgScale: 1, bgX: 50, bgY: 50, bgXm: 50, bgYm: 50, bgOverlay: 0, bgBlur: 0,
    apiUrl: "http://localhost:8000",
    wpm: 150,
    updatedAt: 0
};

const PRESETS = {
    noche:     { accent: "#6b48ff", accent2: "#3a2a8f", bg1: "#09090b", bg2: "#1a1a24", glass: "#141419" },
    neon:      { accent: "#00f0ff", accent2: "#ff00e5", bg1: "#05010f", bg2: "#12002b", glass: "#0d0720" },
    oro:       { accent: "#d4a017", accent2: "#7a5a0c", bg1: "#120c03", bg2: "#2b1d08", glass: "#1f1507" },
    vampirico: { accent: "#c1121f", accent2: "#6a040f", bg1: "#0d0206", bg2: "#2a0510", glass: "#1c0409" },
    sangre:    { accent: "#8b0000", accent2: "#ff2a2a", bg1: "#050000", bg2: "#1a0000", glass: "#140404" }
};

const SLIDERS = {
    glassOpacity: { label: "Opacidad del vidrio", min: 0.05, max: 0.95, step: 0.01, fmt: v => Math.round(v * 100) + "%" },
    blur:         { label: "Desenfoque (blur)", min: 0, max: 40, step: 1, fmt: v => v + "px" },
    borderAlpha:  { label: "Brillo del borde", min: 0, max: 0.5, step: 0.01, fmt: v => Math.round(v * 200) + "%" },
    shadowAlpha:  { label: "Intensidad de sombra", min: 0, max: 0.9, step: 0.01, fmt: v => Math.round(v * 100) + "%" },
    bgScale:      { label: "Escala de la imagen", min: 1, max: 3, step: 0.05, fmt: v => Number(v).toFixed(2) + "x" },
    bgX:          { label: "Posición horizontal (PC/tablet)", min: 0, max: 100, step: 1, fmt: v => v + "%" },
    bgY:          { label: "Posición vertical (PC/tablet)", min: 0, max: 100, step: 1, fmt: v => v + "%" },
    bgXm:         { label: "Posición horizontal (móvil)", min: 0, max: 100, step: 1, fmt: v => v + "%" },
    bgYm:         { label: "Posición vertical (móvil)", min: 0, max: 100, step: 1, fmt: v => v + "%" },
    bgOverlay:    { label: "Oscurecimiento", min: 0, max: 0.9, step: 0.01, fmt: v => Math.round(v * 100) + "%" },
    bgBlur:       { label: "Difuminado", min: 0, max: 20, step: 1, fmt: v => v + "px" }
};

const COLORS = {
    accent: "Color primario / acento",
    accent2: "Color secundario",
    bg1: "Gradiente de fondo · inicio",
    bg2: "Gradiente de fondo · final",
    glass: "Tinte del vidrio"
};

const TAG_RE = /\[(?:BGM|SFX)-[^\]\s]+\]/gi;

/* =========================================================
   ESTADO
   ========================================================= */
const state = {
    projects: [],
    songs: [],
    current: null,
    view: "dashboard",
    dirty: false,
    playingId: null,
    renderedId: null
};

let settings = loadSettings();

/* =========================================================
   UTILIDADES
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function toast(message, type = "ok") {
    const box = $("#toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : "");
    el.textContent = message;
    box.appendChild(el);
    const ms = type === "error" ? 10000 : 4000;
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, ms - 400);
    setTimeout(() => el.remove(), ms);
}

function friendlyError(err) {
    return (err && err.message) ? err.message : "Ocurrió un error inesperado.";
}

const guard = (fn) => async (...args) => {
    try { return await fn(...args); }
    catch (err) { console.error(err); toast(friendlyError(err), "error"); }
};

function fmtDur(secs) {
    const total = Math.max(0, Math.round(secs || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
             : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMinutes(secs) {
    const m = Math.round((secs || 0) / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "20, 20, 25";
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function safeFileName(name) {
    return name.replace(/[^\w.\-]+/g, "_");
}

function setBusy(labelEl, busy) {
    if (!labelEl) return;
    labelEl.style.opacity = busy ? "0.5" : "";
    labelEl.style.pointerEvents = busy ? "none" : "";
}

function setStatus(id, msg, kind = "info") {
    const el = $(`#${id}`);
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.className = "upload-status " + kind;
    el.textContent = msg;
}

// NUEVA FUNCIÓN: Subida a Cloudinary con seguimiento de progreso
function uploadToCloudinary(file, onProgress) {
    return new Promise((resolve, reject) => {
        const url = "https://api.cloudinary.com/v1_1/cwosbegc/auto/upload";
        const fd = new FormData();
        fd.append("file", file);
        fd.append("upload_preset", "MundoUmbra");

        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(e.loaded / e.total);
            }
        };
        
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const res = JSON.parse(xhr.responseText);
                resolve({ url: res.secure_url, path: res.public_id });
            } else {
                reject(new Error("Error de Cloudinary: " + xhr.statusText));
            }
        };
        
        xhr.onerror = () => reject(new Error("Error de red subiendo a Cloudinary"));
        xhr.send(fd);
    });
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
        return ok;
    }
}

function getAudioDuration(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const a = new Audio();
        let finished = false;
        const done = (v) => {
            if (finished) return;
            finished = true;
            URL.revokeObjectURL(url);
            resolve(v);
        };
        a.preload = "metadata";
        a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : 0);
        a.onerror = () => done(0);
        setTimeout(() => done(0), 8000);
        a.src = url;
    });
}

function imageToBlob(file, maxSide = 1920, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, maxSide / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(img.width * k));
            c.height = Math.max(1, Math.round(img.height * k));
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            c.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen.")),
                "image/jpeg", quality
            );
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen.")); };
        img.src = url;
    });
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("No se pudo leer la imagen."));
        r.readAsDataURL(blob);
    });
}

/* =========================================================
   AJUSTES VISUALES (CSS variables + localStorage)
   ========================================================= */
function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { console.warn("Ajustes corruptos, se usan los de fábrica.", e); }
    return { ...DEFAULTS };
}

function persistLocal() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        return true;
    } catch (e) {
        console.warn("No se pudo guardar en localStorage", e);
        if (typeof settings.bgImage === "string" && settings.bgImage.startsWith("data:")) {
            settings.bgImage = "";
            applySettings();
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* sin espacio */ }
            toast("La imagen de fondo es demasiado pesada para guardarse en este dispositivo.", "error");
        }
        return false;
    }
}

function saveSettings(push = true) {
    settings.updatedAt = Date.now();
    const ok = persistLocal();
    if (push) schedulePush();
    return ok;
}

let saveTimer = null;
function saveSettingsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSettings(), 250);
}

let pushTimer = null;
let syncWarned = false;

function remotePayload() {
    const p = { ...settings };
    if (typeof p.bgImage === "string" && p.bgImage.startsWith("data:")) {
        delete p.bgImage;
        delete p.bgPath;
    }
    return p;
}

async function pushSettings() {
    try {
        await setDoc(doc(db, "Configuracion", "estilo"), remotePayload(), { merge: true });
    } catch (err) {
        console.warn("No se pudo sincronizar los ajustes", err);
        if (!syncWarned) {
            syncWarned = true;
            toast("No se pudieron sincronizar los ajustes con la nube. Revisa las reglas de Firestore.", "error");
        }
    }
}

function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushSettings, 900);
}

async function pullSettings() {
    try {
        const snap = await getDoc(doc(db, "Configuracion", "estilo"));
        if (!snap.exists()) {
            if (settings.updatedAt) pushSettings();
            return;
        }
        const remote = snap.data();
        const rTime = remote.updatedAt || 0;
        const lTime = settings.updatedAt || 0;
        if (rTime > lTime) {
            settings = { ...DEFAULTS, ...remote };
            applySettings();
            persistLocal();
            renderSettingsControls();
            const w = $("#wpm-input");
            if (w) w.value = settings.wpm;
        } else if (rTime < lTime) {
            pushSettings();
        }
    } catch (err) {
        console.warn("No se pudieron leer los ajustes de la nube", err);
    }
}

function applySettings() {
    const s = settings;
    const root = document.documentElement.style;
    root.setProperty("--accent", s.accent);
    root.setProperty("--accent-2", s.accent2);
    root.setProperty("--bg1", s.bg1);
    root.setProperty("--bg2", s.bg2);
    root.setProperty("--glass-rgb", hexToRgb(s.glass));
    root.setProperty("--glass-opacity", s.glassOpacity);
    root.setProperty("--blur", s.blur + "px");
    root.setProperty("--border-alpha", s.borderAlpha);
    root.setProperty("--shadow-alpha", s.shadowAlpha);
    root.setProperty("--main-font", s.font);
    root.setProperty("--bg-scale", s.bgScale);
    root.setProperty("--bg-x", s.bgX + "%");
    root.setProperty("--bg-y", s.bgY + "%");
    root.setProperty("--bg-x-m", s.bgXm + "%");
    root.setProperty("--bg-y-m", s.bgYm + "%");
    root.setProperty("--bg-overlay", s.bgOverlay);
    root.setProperty("--bg-blur", s.bgBlur + "px");

    const bg = $("#dynamic-bg");
    if (bg) {
        bg.style.backgroundImage = s.bgImage
            ? `url("${s.bgImage}")`
            : `linear-gradient(135deg, ${s.bg1}, ${s.bg2})`;
    }
}

function sliderHtml(key) {
    const d = SLIDERS[key];
    const v = settings[key];
    return `<label class="ctl"><span>${d.label}</span>
        <input type="range" data-k="${key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}">
        <output>${d.fmt(v)}</output></label>`;
}

function colorHtml(key) {
    return `<label class="ctl"><span>${COLORS[key]}</span>
        <input type="color" data-k="${key}" value="${esc(settings[key])}"></label>`;
}

function renderSettingsControls() {
    $("#ctl-color").innerHTML = Object.keys(COLORS).map(colorHtml).join("");
    $("#ctl-glass").innerHTML = ["glassOpacity", "blur", "borderAlpha", "shadowAlpha"].map(sliderHtml).join("");
    $("#ctl-bg").innerHTML = ["bgScale", "bgX", "bgY", "bgXm", "bgYm", "bgOverlay", "bgBlur"].map(sliderHtml).join("");

    $("#font-grid").innerHTML = FONTS.map((f, i) => `
        <button type="button" class="font-card ${settings.font === f.css ? "active" : ""}" data-font="${i}" style="font-family:${f.css}">
            Aa — Historias de misterio
            <small>${esc(f.name)} · ${esc(f.label)}</small>
        </button>`).join("");

    const api = $("#api-url-input");
    if (api) api.value = settings.apiUrl;
}

function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(settings, p);
    applySettings();
    saveSettings();
    renderSettingsControls();
    toast("Tema aplicado");
}

async function handleBgUpload(file) {
    if (!file) return;
    const label = $("#label-upload-bg");
    setBusy(label, true);
    try {
        const blob = await imageToBlob(file);
        toast("Subiendo fondo a Cloudinary...");
        try {
            const { url, path } = await uploadToCloudinary(blob);
            settings.bgImage = url;
            settings.bgPath = path;
            applySettings();
            saveSettings();
            toast("Fondo guardado: se verá en todos tus dispositivos");
        } catch (err) {
            console.warn("Falló la subida del fondo", err);
            settings.bgImage = await blobToDataURL(blob);
            settings.bgPath = "";
            applySettings();
            saveSettings();
            toast("Fondo local aplicado. No se pudo subir a la nube.", "error");
        }
    } finally {
        setBusy(label, false);
    }
}

async function removeBackground() {
    settings.bgImage = "";
    settings.bgPath = "";
    applySettings();
    saveSettings();
    toast("Fondo propio eliminado");
}

/* =========================================================
   NAVEGACIÓN
   ========================================================= */
function showView(name) {
    $$(".view-section").forEach(s => s.classList.toggle("active", s.id === name));
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === name));
    state.view = name;
    if (name === "editor") ensureEditor();
    const main = $(".main-content");
    if (main) main.scrollTop = 0;
}

/* =========================================================
   PROYECTOS
   ========================================================= */
function normProject(id, d) {
    return {
        id,
        titulo: d.titulo || "Sin título",
        descripcion: d.descripcion || "",
        estado: ESTADOS[d.estado] ? d.estado : "guion",
        progreso: Number.isFinite(d.progreso) ? d.progreso : 0,
        guion: d.guion || "",
        audios: Array.isArray(d.audios_vinculados) ? d.audios_vinculados : [],
        creado: d.creado || 0,
        actualizado: d.actualizado || d.creado || 0
    };
}

async function loadProjects() {
    try {
        const snap = await getDocs(collection(db, "Proyectos"));
        state.projects = snap.docs.map(d => normProject(d.id, d.data()))
            .sort((a, b) => b.actualizado - a.actualizado);
    } catch (err) {
        console.error(err);
        $("#projects-grid").innerHTML = `<p class="helper-text warn">No se pudieron cargar los proyectos: ${esc(friendlyError(err))}</p>`;
        return;
    }
    renderDashboard();
    renderStats();
    renderEditorSelect();
}

function renderStats() {
    const audios = state.projects.reduce((n, p) => n + p.audios.length, 0);
    const secs = state.projects.reduce((n, p) => n + p.audios.reduce((m, a) => m + (a.duracion || 0), 0), 0);
    $("#st-projects").textContent = state.projects.filter(p => p.estado !== "listo").length;
    $("#st-audios").textContent = audios;
    $("#st-songs").textContent = state.songs.length;
    $("#st-hours").textContent = fmtMinutes(secs);

    const words = state.projects.reduce((n, p) => n + countWords(p.guion), 0);
    $("#st-words").textContent = words.toLocaleString("es");
    $("#st-script-time").textContent = fmtMinutes((words / settings.wpm) * 60);

    renderHome();
}

function greeting() {
    const h = new Date().getHours();
    if (h < 6) return "Buenas madrugadas";
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
}

function lastProject() {
    let id = null;
    try { id = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* ignorar */ }
    return state.projects.find(p => p.id === id) || state.projects[0] || null;
}

const PIPE_ICONS = { guion: "fa-feather-pointed", locucion: "fa-microphone-lines", musica: "fa-music", listo: "fa-circle-check" };

function renderHome() {
    const total = state.projects.length;
    const active = state.projects.filter(p => p.estado !== "listo").length;

    $("#hero-greet").textContent = `${greeting()}, creador`;
    $("#hero-date").textContent = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("#hero-sub").textContent = total
        ? `Tienes ${active} proyecto(s) en marcha de ${total}. ¿Qué historia vamos a contar hoy?`
        : "Crea tu primer proyecto y empieza a escribir tu próxima historia.";

    const filter = $("#project-filter").value;
    $("#pipeline").innerHTML = Object.keys(ESTADOS).map(k => {
        const n = state.projects.filter(p => p.estado === k).length;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return `<button type="button" class="pipe-row ${filter === k ? "active" : ""}" data-action="filter-estado" data-estado="${k}">
            <div class="pipe-top"><span><i class="fa-solid ${PIPE_ICONS[k]}"></i>${esc(ESTADOS[k])}</span><b>${n}</b></div>
            <div class="pipe-bar"><div style="width:${pct}%"></div></div>
        </button>`;
    }).join("");

    const box = $("#continue-card");
    const lp = lastProject();
    if (!lp) {
        box.innerHTML = `<p class="helper-text">Aún no hay proyectos. Crea uno para empezar.</p>
            <button class="btn-glass" data-action="new-project" style="width:100%"><i class="fa-solid fa-plus"></i> Crear proyecto</button>`;
    } else {
        const words = countWords(lp.guion);
        const others = state.projects.filter(p => p.id !== lp.id).slice(0, 3);
        box.innerHTML = `<div class="cont-main">
                <span class="badge ${esc(lp.estado)}">${esc(ESTADOS[lp.estado])}</span>
                <h4>${esc(lp.titulo)}</h4>
                <div class="progress"><div style="width:${lp.progreso}%"></div></div>
                <div class="meta"><span>${lp.progreso}% completado</span><span>${words} palabras · ${esc(fmtDur((words / settings.wpm) * 60))}</span></div>
                <button class="btn-glass" data-action="open-project" data-id="${esc(lp.id)}"><i class="fa-solid fa-pen-nib"></i> Abrir en el editor</button>
            </div>` +
            (others.length ? `<div class="recent-title">Recientes</div>` + others.map(p =>
                `<button type="button" class="recent-item" data-action="open-project" data-id="${esc(p.id)}"><span>${esc(p.titulo)}</span><small>${esc(fmtDate(p.actualizado))}</small></button>`
            ).join("") : "");
    }

    const amb = $("#amb-breakdown");
    if (!state.songs.length) {
        amb.innerHTML = `<p class="helper-text">Tu biblioteca está vacía. Sube pistas de terror, suspenso o épico para usarlas con tags en tus guiones.</p>
            <button class="btn-icon-text amb-link" data-action="goto" data-view="music-lib" style="width:100%"><i class="fa-solid fa-cloud-arrow-up"></i> Subir primera pista</button>`;
    } else {
        const counts = {};
        state.songs.forEach(s => { counts[s.ambiente] = (counts[s.ambiente] || 0) + 1; });
        const totalSecs = state.songs.reduce((n, s) => n + (s.duracion || 0), 0);
        amb.innerHTML = `<div class="amb-total"><b>${state.songs.length}</b> pistas · ${esc(fmtMinutes(totalSecs))}</div>
            <div class="amb-chips">${Object.entries(counts).sort((a, b) => b[1] - a[1])
                .map(([k, n]) => `<span class="amb-chip">${esc(k)} <b>${n}</b></span>`).join("")}</div>
            <button class="btn-icon-text amb-link" data-action="goto" data-view="music-lib" style="width:100%"><i class="fa-solid fa-music"></i> Abrir biblioteca</button>`;
    }
}

function projectCard(p) {
    return `
    <article class="glass-panel project-card" data-id="${esc(p.id)}">
        <span class="badge ${esc(p.estado)}">${esc(ESTADOS[p.estado])}</span>
        <h3>${esc(p.titulo)}</h3>
        <p>${esc(p.descripcion) || "Sin descripción"}</p>
        <div class="progress"><div style="width:${p.progreso}%"></div></div>
        <div class="meta"><span>${p.progreso}% · ${p.audios.length} audio(s) · ${countWords(p.guion)} pal.</span><span>${esc(fmtDate(p.actualizado))}</span></div>
        <div class="card-actions">
            <button class="btn-glass" data-action="open-project" data-id="${esc(p.id)}"><i class="fa-solid fa-pen-nib"></i> Abrir</button>
            <button class="btn-icon-text" data-action="edit-project" data-id="${esc(p.id)}" title="Editar proyecto"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon-text" style="color:var(--danger)" data-action="delete-project" data-id="${esc(p.id)}" title="Eliminar proyecto"><i class="fa-solid fa-trash"></i></button>
        </div>
    </article>`;
}

function renderDashboard() {
    const q = $("#project-search").value.trim().toLowerCase();
    const f = $("#project-filter").value;
    const list = state.projects.filter(p =>
        (f === "all" || p.estado === f) &&
        (!q || (p.titulo + " " + p.descripcion).toLowerCase().includes(q))
    );
    let html;
    if (list.length) {
        html = list.map(projectCard).join("");
    } else if (state.projects.length) {
        html = '<p class="helper-text">Ningún proyecto coincide con la búsqueda o el filtro.</p>';
    } else {
        html = `<div class="glass-panel empty-projects">
            <i class="fa-solid fa-ghost"></i>
            <p>Aún no tienes proyectos.</p>
            <button class="btn-glass" data-action="new-project" style="margin-top:12px"><i class="fa-solid fa-plus"></i> Crear el primero</button>
        </div>`;
    }
    $("#projects-grid").innerHTML = html;
    $$(".pipe-row").forEach(r => r.classList.toggle("active", r.dataset.estado === f));
}

function openProjectModal(id) {
    const p = id ? state.projects.find(x => x.id === id) : null;
    $("#modal-title").textContent = p ? "Editar Proyecto" : "Nuevo Proyecto";
    $("#pm-id").value = p ? p.id : "";
    $("#pm-title").value = p ? p.titulo : "";
    $("#pm-desc").value = p ? p.descripcion : "";
    $("#pm-estado").value = p ? p.estado : "guion";
    $("#pm-progress").value = p ? p.progreso : 25;
    $("#pm-progress-out").textContent = p ? p.progreso : 25;
    $("#project-modal").hidden = false;
    setTimeout(() => $("#pm-title").focus(), 50);
}

function closeProjectModal() {
    $("#project-modal").hidden = true;
}

const saveProjectFromModal = guard(async () => {
    const id = $("#pm-id").value;
    const titulo = $("#pm-title").value.trim();
    if (!titulo) { toast("El título es obligatorio", "error"); return; }

    const payload = {
        titulo,
        descripcion: $("#pm-desc").value.trim(),
        estado: $("#pm-estado").value,
        progreso: Number($("#pm-progress").value),
        actualizado: Date.now()
    };

    const btn = $("#pm-save");
    btn.disabled = true;
    try {
        if (id) {
            await updateDoc(doc(db, "Proyectos", id), payload);
            toast("Proyecto actualizado");
        } else {
            await addDoc(collection(db, "Proyectos"), {
                ...payload, guion: "", audios_vinculados: [], creado: Date.now()
            });
            toast("Proyecto creado");
        }
        closeProjectModal();
        await loadProjects();
        if (id && state.current && state.current.id === id) {
            const fresh = state.projects.find(p => p.id === id);
            if (fresh) {
                state.current.titulo = fresh.titulo;
                state.current.estado = fresh.estado;
                state.current.progreso = fresh.progreso;
                $("#editor-title").textContent = `Estudio: ${fresh.titulo}`;
            }
        }
    } finally {
        btn.disabled = false;
    }
});

const deleteProject = guard(async (id) => {
    const p = state.projects.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`¿Eliminar «${p.titulo}» y sus ${p.audios.length} audio(s)? Esta acción no se puede deshacer.`)) return;

    // Solo eliminamos de Firestore (los archivos quedan huérfanos en Cloudinary sin afectar el sistema)
    await deleteDoc(doc(db, "Proyectos", id));

    if (state.current && state.current.id === id) {
        state.current = null;
        state.renderedId = null;
        state.dirty = false;
        try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* ignorar */ }
    }
    toast("Proyecto eliminado");
    await loadProjects();
    if (state.view === "editor") ensureEditor();
});

/* =========================================================
   EDITOR
   ========================================================= */
function renderEditorSelect() {
    const sel = $("#editor-project-select");
    sel.innerHTML = state.projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.titulo)}</option>`).join("");
    if (state.current) sel.value = state.current.id;
}

function ensureEditor() {
    // No re-renderizar si ya está dibujado: conserva guion sin guardar y los audios en reproducción
    if (state.current) { if (state.renderedId !== state.current.id) renderEditor(); return; }
    let id = null;
    try { id = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* ignorar */ }
    if (!id || !state.projects.some(p => p.id === id)) id = state.projects[0] ? state.projects[0].id : null;
    if (id) openProject(id, false);
    else renderEditor();
}

const openProject = guard(async (id, goEditor = true) => {
    const snap = await getDoc(doc(db, "Proyectos", id));
    if (!snap.exists()) {
        toast("El proyecto ya no existe", "error");
        await loadProjects();
        return;
    }
    state.current = normProject(id, snap.data());
    state.dirty = false;
    state.renderedId = null;
    try { localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* ignorar */ }
    if (goEditor) showView("editor");
    else renderEditor();
});

function renderEditor() {
    const p = state.current;
    $("#editor-empty").hidden = !!p;
    $("#editor-body").hidden = !p;
    $("#editor-title").textContent = p ? `Estudio: ${p.titulo}` : "Estudio de Grabación";
    if (!p) return;
    state.renderedId = p.id;

    renderEditorSelect();
    $("#wpm-input").value = settings.wpm;
    $("#script-textarea").value = p.guion;
    $("#analysis-result").hidden = true;
    $("#analysis-result").innerHTML = "";
    updateScriptStats();
    renderTagChips();
    renderAudios();
}

function countWords(text) {
    return text.replace(TAG_RE, " ").split(/\s+/).filter(Boolean).length;
}

function getWpm() {
    const v = Number($("#wpm-input").value);
    return Number.isFinite(v) && v >= 60 ? Math.min(v, 300) : settings.wpm;
}

function updateScriptStats() {
    const words = countWords($("#script-textarea").value);
    const secs = (words / getWpm()) * 60;
    $("#word-count").textContent = `${words} palabras`;
    $("#time-estimate").textContent = fmtDur(secs);
}

function renderTagChips() {
    const box = $("#tag-chips");
    if (!box) return;
    const q = ($("#tag-search") ? $("#tag-search").value : "").trim().toLowerCase();
    const amb = $("#tag-filter") ? $("#tag-filter").value : "all";
    const chips = state.songs
        .filter(s => (amb === "all" || s.ambiente === amb) && (!q || (s.identificador + " " + s.titulo).toLowerCase().includes(q)))
        .map(s => `<span class="chip-wrap">
            <button type="button" class="chip-play" data-action="play-song" data-id="${esc(s.id)}" title="Previsualizar pista"><i class="fa-solid fa-play"></i></button>
            <button type="button" class="chip" data-tag="${esc(s.identificador)}" title="${esc(s.titulo)} · ${esc(s.ambiente)}">${esc(s.identificador)}</button>
        </span>`);
    chips.push(`<span class="chip-wrap"><button type="button" class="chip" data-tag="[BGM-STOP]" title="Corta la música">[BGM-STOP]</button></span>`);
    box.innerHTML = chips.join("");
    refreshPlayButtons();
}

// Ubica el cursor en el guion según el minuto actual del audio (estimado por palabras/min)
function locateAudioPoint() {
    const el = lastVoiceEl;
    if (!el) { toast("Reproduce o mueve un audio primero", "error"); return; }
    const ta = $("#script-textarea");
    const target = Math.round((el.currentTime / 60) * getWpm());
    const re = /\S+/g;
    const isTag = /^\[(?:BGM|SFX)-[^\]\s]+\]$/i;
    let m, n = 0, pos = ta.value.length;
    while ((m = re.exec(ta.value))) {
        if (isTag.test(m[0])) continue;
        if (n >= target) { pos = m.index; break; }
        n++;
    }
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.scrollTop = Math.max(0, (pos / Math.max(1, ta.value.length)) * ta.scrollHeight - ta.clientHeight / 2);
    toast(`Punto estimado: palabra ${target} (${fmtDur(el.currentTime)})`);
}

function insertAtCursor(ta, text) {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const insert = (before && !/\s$/.test(before) ? " " : "") + text + " ";
    ta.setRangeText(insert, start, end, "end");
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
}

const saveScript = guard(async () => {
    const p = state.current;
    if (!p) return;
    const btn = $("#btn-save-script");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    try {
        const guion = $("#script-textarea").value;
        const now = Date.now();
        await updateDoc(doc(db, "Proyectos", p.id), { guion, actualizado: now });
        p.guion = guion;
        p.actualizado = now;
        const inList = state.projects.find(x => x.id === p.id);
        if (inList) { inList.guion = guion; inList.actualizado = now; }
        state.dirty = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Guardado';
        setTimeout(() => { btn.innerHTML = original; }, 1800);
    } catch (err) {
        btn.innerHTML = original;
        throw err;
    } finally {
        btn.disabled = false;
    }
});

/* ---- Análisis de guion con el backend ---- */
function renderAnalysis(data) {
    const box = $("#analysis-result");
    const pistas = data.pistas || [];

    const rows = pistas.map(p => `
        <tr>
            <td>${p.orden}</td>
            <td><code>${esc(p.tag)}</code></td>
            <td>${esc(p.titulo) || "—"}</td>
            <td>${esc(p.ambiente) || "—"}</td>
            <td>${esc(p.inicio_fmt)}</td>
            <td>${esc(p.fin_fmt)}</td>
            <td>${esc(fmtDur(p.duracion_seg))}</td>
            <td>${esc(p.fragmento)}</td>
        </tr>`).join("");

    const table = pistas.length ? `
        <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Tag</th><th>Título</th><th>Ambiente</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Fragmento</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : `<p class="helper-text" style="margin-top:15px">No se encontraron pistas en el guion.</p>`;

    const warns = (data.advertencias || []).map(w =>
        `<p class="warn" style="margin-top:8px"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(w)}</p>`).join("");

    box.innerHTML = `
        <div class="analysis-head">
            <span>Palabras: <b>${data.total_palabras}</b></span>
            <span>Duración: <b>${esc(data.duracion_total_fmt)}</b></span>
            <span>Ritmo: <b>${data.palabras_por_minuto} ppm</b></span>
            <span>Pistas: <b>${pistas.length}</b></span>
        </div>
        ${table}
        ${warns}`;
    box.hidden = false;
}

const analyzeScript = guard(async () => {
    const texto = $("#script-textarea").value;
    if (!texto.trim()) { toast("Escribe un guion antes de analizarlo", "error"); return; }

    const base = (settings.apiUrl || "").trim().replace(/\/+$/, "");
    if (!base) { toast("Configura la URL del backend en Ajustes Visuales", "error"); return; }

    const btn = $("#btn-analyze");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando...';

    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), 70000);
    const slowTimer = setTimeout(() => toast("El servidor puede estar despertando (Render gratis tarda hasta ~1 min)..."), 6000);

    try {
        const res = await fetch(`${base}/api/analizar-guion`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                texto,
                palabras_por_minuto: getWpm(),
                biblioteca: state.songs.map(s => ({
                    identificador: s.identificador,
                    titulo: s.titulo,
                    ambiente: s.ambiente,
                    volumen: s.volumen,
                    duracion: s.duracion || null
                }))
            }),
            signal: ctrl.signal
        });

        if (!res.ok) {
            let detail = "";
            try {
                const j = await res.json();
                detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
            } catch { /* sin cuerpo JSON */ }
            throw new Error(detail || `El servidor respondió HTTP ${res.status}`);
        }
        renderAnalysis(await res.json());
    } catch (e) {
        const msg = e.name === "AbortError"
            ? "Tiempo de espera agotado. Revisa que el backend esté activo."
            : `No se pudo analizar el guion: ${e.message}`;
        toast(msg, "error");
    } finally {
        clearTimeout(abortTimer);
        clearTimeout(slowTimer);
        btn.disabled = false;
        btn.innerHTML = original;
    }
});

/* ---- Audios locutados ---- */
/* Los <audio> se crean una sola vez y se reutilizan: pausar/cambiar de pestaña no los reinicia */
const audioEls = new Map();
let lastVoiceEl = null;
const POS_KEY = "scm_audio_pos_";

function getAudioEl(a) {
    let el = audioEls.get(a.path);
    if (el) return el;
    el = document.createElement("audio");
    el.controls = true;
    el.preload = "metadata";
    el.src = a.url;

    const savePos = () => { try { localStorage.setItem(POS_KEY + a.path, String(el.currentTime)); } catch { /* ignorar */ } };
    let saved = 0;
    try { saved = Number(localStorage.getItem(POS_KEY + a.path)) || 0; } catch { /* ignorar */ }
    if (saved) el.addEventListener("loadedmetadata", () => { if (el.duration > saved) el.currentTime = saved; }, { once: true });

    let lastSave = 0;
    el.addEventListener("timeupdate", () => {
        const now = Date.now();
        if (now - lastSave > 1500) { lastSave = now; savePos(); }
    });
    el.addEventListener("pause", savePos);
    el.addEventListener("seeked", () => { lastVoiceEl = el; savePos(); });
    el.addEventListener("play", () => {
        lastVoiceEl = el;
        audioEls.forEach(o => { if (o !== el) o.pause(); });
    });
    el.addEventListener("ended", () => { try { localStorage.removeItem(POS_KEY + a.path); } catch { /* ignorar */ } });

    audioEls.set(a.path, el);
    return el;
}

function renderAudios() {
    const box = $("#project-audios-list");
    const audios = state.current ? state.current.audios : [];
    box.textContent = "";
    if (!audios.length) {
        box.innerHTML = '<p class="helper-text">Aún no hay audios en este proyecto.</p>';
        return;
    }
    audios.forEach(a => {
        const item = document.createElement("div");
        item.className = "audio-item";
        item.innerHTML = `<div class="row">
                <span><i class="fa-solid fa-microphone-lines"></i> ${esc(a.nombre)}
                    ${a.duracion ? `<small style="color:var(--text-muted)">· ${esc(fmtDur(a.duracion))}</small>` : ""}</span>
                <button class="delete-icon" data-action="delete-audio" data-path="${esc(a.path)}" title="Eliminar audio"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        item.appendChild(getAudioEl(a));
        box.appendChild(item);
    });
}

const uploadVoice = guard(async (file) => {
    const p = state.current;
    if (!file || !p) return;
    const projectId = p.id;
    const label = $("#label-upload-voice");
    setBusy(label, true);
    setStatus("voice-status", `Preparando ${file.name}...`);
    try {
        const duracion = await getAudioDuration(file);
        
        const { url, path } = await uploadToCloudinary(file, (pct) =>
            setStatus("voice-status", `Subiendo ${file.name}... ${Math.round(pct * 100)}%`)
        );

        const audio = { nombre: file.name, url, path, duracion, subido: Date.now() };
        await updateDoc(doc(db, "Proyectos", projectId), {
            audios_vinculados: arrayUnion(audio),
            actualizado: Date.now()
        });

        if (state.current && state.current.id === projectId) {
            state.current.audios = [...state.current.audios, audio];
            renderAudios();
        }
        toast("Audio subido al proyecto");
        setStatus("voice-status", "Audio subido correctamente.", "ok");
        await loadProjects();
    } catch (err) {
        console.error(err);
        setStatus("voice-status", `No se pudo subir el audio: ${err.message}`, "error");
        throw err;
    } finally {
        setBusy(label, false);
        $("#upload-voice-input").value = "";
    }
});

const deleteAudio = guard(async (path) => {
    const p = state.current;
    if (!p) return;
    if (!confirm("¿Eliminar este audio del proyecto?")) return;

    const snap = await getDoc(doc(db, "Proyectos", p.id));
    const audios = (snap.exists() && Array.isArray(snap.data().audios_vinculados)) ? snap.data().audios_vinculados : [];
    const rest = audios.filter(a => a.path !== path);

    // Solo se borra de Firestore para no complicar la gestión sin backend
    await updateDoc(doc(db, "Proyectos", p.id), { audios_vinculados: rest, actualizado: Date.now() });
    p.audios = rest;
    const gone = audioEls.get(path);
    if (gone) { gone.pause(); audioEls.delete(path); }
    renderAudios();
    toast("Audio eliminado");
    await loadProjects();
});

/* =========================================================
   BIBLIOTECA MUSICAL
   ========================================================= */
const player = new Audio();
player.addEventListener("ended", () => { state.playingId = null; refreshPlayButtons(); });
player.addEventListener("pause", () => refreshPlayButtons());
player.addEventListener("play", () => refreshPlayButtons());

function normSong(id, d) {
    return {
        id,
        identificador: d.identificador || "[BGM-SIN-TAG]",
        titulo: d.titulo || "",
        ambiente: d.ambiente || "Otro",
        volumen: Number.isFinite(d.volumen) ? d.volumen : 70,
        url: d.url || "",
        path: d.path || "",
        duracion: d.duracion || 0
    };
}

function normalizeTag(value) {
    let v = String(value || "").trim().replace(/^\[|\]$/g, "").trim().toUpperCase();
    v = v.replace(/\s+/g, "-").replace(/[^\w\-]/g, "");
    if (!v) return "";
    if (!/^(BGM|SFX)-/.test(v)) v = "BGM-" + v;
    return `[${v}]`;
}

function slugify(name) {
    const base = name.replace(/\.[^.]+$/, "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    return base || "PISTA";
}

function uniqueTag(base) {
    const exists = (t) => state.songs.some(s => s.identificador === t);
    let tag = `[BGM-${base}]`;
    let n = 2;
    while (exists(tag)) { tag = `[BGM-${base}-${String(n).padStart(2, "0")}]`; n++; }
    return tag;
}

async function loadMusic() {
    try {
        const snap = await getDocs(collection(db, "Biblioteca_Musica"));
        state.songs = snap.docs.map(d => normSong(d.id, d.data()))
            .sort((a, b) => a.identificador.localeCompare(b.identificador));
    } catch (err) {
        console.error(err);
        $("#music-library-list").innerHTML = `<p class="helper-text warn">No se pudo cargar la biblioteca: ${esc(friendlyError(err))}</p>`;
        return;
    }
    renderMusic();
    renderTagChips();
    renderStats();
}

function songRow(s) {
    const options = AMBIENTES.map(a => `<option value="${esc(a)}" ${a === s.ambiente ? "selected" : ""}>${esc(a)}</option>`).join("");
    return `
    <div class="music-edit-row" data-id="${esc(s.id)}">
        <button type="button" class="btn-icon" data-action="play-song" data-id="${esc(s.id)}" title="Reproducir${s.duracion ? " (" + esc(fmtDur(s.duracion)) + ")" : ""}"><i class="fa-solid fa-play"></i></button>
        <input type="text" class="glass-input-small tag-in" data-f="identificador" value="${esc(s.identificador)}" placeholder="[BGM-NOMBRE]">
        <input type="text" class="glass-input-small title-in" data-f="titulo" value="${esc(s.titulo)}" placeholder="Título / descripción">
        <select class="glass-select" data-f="ambiente">${options}</select>
        <label class="vol" title="Volumen sugerido"><i class="fa-solid fa-volume-high"></i>
            <input type="range" min="0" max="100" step="5" data-f="volumen" value="${s.volumen}"><output>${s.volumen}%</output></label>
        <button type="button" class="btn-glass" data-action="save-song" data-id="${esc(s.id)}" title="Guardar cambios"><i class="fa-solid fa-floppy-disk"></i></button>
        <button type="button" class="btn-glass" data-action="copy-tag" data-id="${esc(s.id)}" title="Copiar tag"><i class="fa-regular fa-copy"></i> Tag</button>
        <button type="button" class="btn-icon delete-icon" data-action="delete-song" data-id="${esc(s.id)}" title="Eliminar pista"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function renderMusic() {
    const box = $("#music-library-list");
    if (!state.songs.length) {
        box.innerHTML = '<p class="helper-text">Tu biblioteca está vacía. Sube tu primera pista.</p>';
        return;
    }
    box.innerHTML = state.songs.map(songRow).join("") +
        '<p class="helper-text" id="music-empty" hidden>Ninguna pista coincide con la búsqueda.</p>';
    applyMusicFilter();
    refreshPlayButtons();
}

function applyMusicFilter() {
    const q = $("#music-search").value.trim().toLowerCase();
    const amb = $("#music-filter").value;
    let visible = 0;
    $$("#music-library-list .music-edit-row").forEach(row => {
        const s = state.songs.find(x => x.id === row.dataset.id);
        if (!s) return;
        const live = (row.querySelector('[data-f="identificador"]').value + " " + row.querySelector('[data-f="titulo"]').value).toLowerCase();
        const ok = (!q || live.includes(q)) && (amb === "all" || s.ambiente === amb);
        row.hidden = !ok;
        if (ok) visible++;
    });
    const empty = $("#music-empty");
    if (empty) empty.hidden = visible > 0;
}

function refreshPlayButtons() {
    $$('[data-action="play-song"]').forEach(btn => {
        const active = btn.dataset.id === state.playingId && !player.paused;
        btn.classList.toggle("playing", active);
        btn.innerHTML = `<i class="fa-solid ${active ? "fa-pause" : "fa-play"}"></i>`;
    });
}

function togglePlay(id) {
    const s = state.songs.find(x => x.id === id);
    if (!s || !s.url) return;
    if (state.playingId === id && !player.paused) {
        player.pause();
        return;
    }
    if (state.playingId !== id) {
        player.src = s.url;
        state.playingId = id;
    }
    player.volume = Math.min(1, Math.max(0, s.volumen / 100));
    player.play().catch((err) => {
        if (err && err.name === "AbortError") return; // el clic en otra pista canceló esta carga: no es un fallo
        const code = player.error ? player.error.code : 0;
        const why = code === 4 ? "el archivo no existe, está bloqueado o su formato no es compatible"
            : code === 2 ? "falló la red al descargarlo"
            : code === 3 ? "el archivo está dañado"
            : err && err.name === "NotAllowedError" ? "el navegador bloqueó la reproducción"
            : (err && err.message) || "motivo desconocido";
        console.error("Error de audio:", s.url, player.error, err);
        toast(`No se pudo reproducir ${s.identificador}: ${why}`, "error");
    });
}

const saveSong = guard(async (id) => {
    const row = $(`.music-edit-row[data-id="${CSS.escape(id)}"]`);
    const s = state.songs.find(x => x.id === id);
    if (!row || !s) return;

    const identificador = normalizeTag(row.querySelector('[data-f="identificador"]').value);
    if (!identificador) { toast("El identificador no puede estar vacío", "error"); return; }
    if (identificador === "[BGM-STOP]") { toast("[BGM-STOP] está reservado para cortar la música", "error"); return; }
    if (state.songs.some(x => x.id !== id && x.identificador === identificador)) {
        toast(`El tag ${identificador} ya existe en otra pista`, "error");
        return;
    }

    const data = {
        identificador,
        titulo: row.querySelector('[data-f="titulo"]').value.trim(),
        ambiente: row.querySelector('[data-f="ambiente"]').value,
        volumen: Number(row.querySelector('[data-f="volumen"]').value)
    };
    await updateDoc(doc(db, "Biblioteca_Musica", id), data);
    Object.assign(s, data);
    row.querySelector('[data-f="identificador"]').value = identificador;
    renderTagChips();
    toast(`Pista ${identificador} guardada`);
});

const copyTag = guard(async (id) => {
    const row = $(`.music-edit-row[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const tag = normalizeTag(row.querySelector('[data-f="identificador"]').value);
    if (!tag) { toast("No hay tag para copiar", "error"); return; }
    const ok = await copyText(tag);
    toast(ok ? `Tag copiado: ${tag}` : "No se pudo copiar al portapapeles", ok ? "ok" : "error");
});

const deleteSong = guard(async (id) => {
    const s = state.songs.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`¿Eliminar permanentemente la pista ${s.identificador}?`)) return;

    if (state.playingId === id) { player.pause(); state.playingId = null; }
    
    // Solo eliminamos de Firestore
    await deleteDoc(doc(db, "Biblioteca_Musica", id));
    state.songs = state.songs.filter(x => x.id !== id);
    renderMusic();
    renderTagChips();
    renderStats();
    toast("Pista eliminada");
});

const uploadMusic = guard(async (file) => {
    if (!file) return;
    const label = $("#label-upload-music");
    setBusy(label, true);
    setStatus("music-status", `Preparando ${file.name}...`);
    try {
        const duracion = await getAudioDuration(file);
        
        const { url, path } = await uploadToCloudinary(file, (pct) =>
            setStatus("music-status", `Subiendo ${file.name}... ${Math.round(pct * 100)}%`)
        );

        setStatus("music-status", "Guardando en la biblioteca...");
        const identificador = uniqueTag(slugify(file.name));

        await addDoc(collection(db, "Biblioteca_Musica"), {
            identificador,
            titulo: file.name.replace(/\.[^.]+$/, ""),
            ambiente: "Suspenso",
            volumen: 70,
            url,
            path,
            duracion,
            creado: Date.now()
        });
        await loadMusic();
        setStatus("music-status", `Pista añadida como ${identificador}. Edita su tag y ambiente abajo.`, "ok");
        toast(`Pista añadida como ${identificador}`);
    } catch (err) {
        console.error(err);
        setStatus("music-status", `No se pudo subir la pista: ${err.message}`, "error");
        throw err;
    } finally {
        setBusy(label, false);
        $("#upload-music-input").value = "";
    }
});

/* =========================================================
   EVENTOS
   ========================================================= */
document.addEventListener("click", (e) => {
    const nav = e.target.closest(".nav-item[data-view]");
    if (nav) { e.preventDefault(); showView(nav.dataset.view); return; }

    const chip = e.target.closest(".chip[data-tag]");
    if (chip) { insertAtCursor($("#script-textarea"), chip.dataset.tag); return; }

    const fontBtn = e.target.closest(".font-card[data-font]");
    if (fontBtn) {
        const f = FONTS[Number(fontBtn.dataset.font)];
        if (f) {
            settings.font = f.css;
            applySettings();
            saveSettings();
            $$(".font-card").forEach(c => c.classList.toggle("active", c === fontBtn));
        }
        return;
    }

    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id, path, preset, view, estado } = btn.dataset;

    switch (action) {
        case "new-project": openProjectModal(null); break;
        case "close-modal": closeProjectModal(); break;
        case "goto": if (view) showView(view); break;
        case "continue-project": {
            const lp = lastProject();
            if (lp) openProject(lp.id); else openProjectModal(null);
            break;
        }
        case "filter-estado": {
            const sel = $("#project-filter");
            sel.value = sel.value === estado ? "all" : estado;
            renderDashboard();
            $("#projects-grid").scrollIntoView({ behavior: "smooth", block: "start" });
            break;
        }
        case "open-project": openProject(id); break;
        case "edit-project": openProjectModal(id); break;
        case "delete-project": deleteProject(id); break;
        case "delete-audio": deleteAudio(path); break;
        case "play-song": togglePlay(id); break;
        case "save-song": saveSong(id); break;
        case "copy-tag": copyTag(id); break;
        case "delete-song": deleteSong(id); break;
        case "preset": applyPreset(preset); break;
        case "remove-bg": removeBackground(); break;
        case "reset-settings": {
            if (!confirm("¿Restablecer todo el estilo visual a los valores originales?")) break;
            settings = { ...DEFAULTS, apiUrl: settings.apiUrl, wpm: settings.wpm };
            applySettings();
            saveSettings();
            renderSettingsControls();
            toast("Estilo restablecido");
            break;
        }
        default: break;
    }
});

document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || !el.matches) return;

    if (el.matches("[data-k]")) {
        const k = el.dataset.k;
        if (k === "apiUrl") {
            settings.apiUrl = el.value.trim().replace(/\/+$/, "");
            saveSettingsSoon();
            return;
        }
        settings[k] = el.type === "range" ? Number(el.value) : el.value;
        const out = el.parentElement.querySelector("output");
        if (out && SLIDERS[k]) out.textContent = SLIDERS[k].fmt(settings[k]);
        applySettings();
        saveSettingsSoon();
        return;
    }

    if (el.matches('.music-edit-row input[type="range"]')) {
        const out = el.parentElement.querySelector("output");
        if (out) out.textContent = el.value + "%";
        return;
    }

    if (el.matches('.music-edit-row [data-f="identificador"], .music-edit-row [data-f="titulo"]')) {
        applyMusicFilter();
    }
});

function bindStaticListeners() {
    $("#project-search").addEventListener("input", renderDashboard);
    $("#project-filter").addEventListener("change", renderDashboard);

    $("#pm-progress").addEventListener("input", (e) => { $("#pm-progress-out").textContent = e.target.value; });
    $("#pm-save").addEventListener("click", saveProjectFromModal);
    $("#project-modal").addEventListener("click", (e) => { if (e.target.id === "project-modal") closeProjectModal(); });
    $("#pm-title").addEventListener("keydown", (e) => { if (e.key === "Enter") saveProjectFromModal(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("#project-modal").hidden) closeProjectModal();
    });

    const ta = $("#script-textarea");
    ta.addEventListener("input", () => { state.dirty = true; updateScriptStats(); });
    ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveScript(); }
    });
    $("#wpm-input").addEventListener("input", () => {
        const v = Number($("#wpm-input").value);
        if (Number.isFinite(v) && v >= 60 && v <= 300) { settings.wpm = v; saveSettingsSoon(); }
        updateScriptStats();
    });
    $("#btn-save-script").addEventListener("click", saveScript);
    $("#btn-analyze").addEventListener("click", analyzeScript);
    $("#btn-locate").addEventListener("click", locateAudioPoint);
    $("#tag-filter").innerHTML = '<option value="all">Todos</option>' +
        AMBIENTES.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    $("#tag-search").addEventListener("input", renderTagChips);
    $("#tag-filter").addEventListener("change", renderTagChips);
    $("#editor-project-select").addEventListener("change", (e) => {
        const target = e.target.value;
        if (state.dirty && !confirm("Tienes cambios sin guardar en el guion. ¿Cambiar de proyecto igualmente?")) {
            e.target.value = state.current ? state.current.id : "";
            return;
        }
        openProject(target, false);
    });
    $("#upload-voice-input").addEventListener("change", (e) => uploadVoice(e.target.files[0]));

    $("#upload-music-input").addEventListener("change", (e) => uploadMusic(e.target.files[0]));
    $("#music-search").addEventListener("input", applyMusicFilter);
    $("#music-filter").addEventListener("change", applyMusicFilter);
    $("#music-filter").innerHTML = '<option value="all">Todos los ambientes</option>' +
        AMBIENTES.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");

    $("#bg-upload").addEventListener("change", guard(async (e) => {
        await handleBgUpload(e.target.files[0]);
        e.target.value = "";
    }));

    window.addEventListener("beforeunload", (e) => {
        if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
    });
}

/* =========================================================
   INICIALIZACIÓN
   ========================================================= */
async function init() {
    applySettings();
    renderSettingsControls();
    bindStaticListeners();
    $("#wpm-input").value = settings.wpm;
    pullSettings().then(() => renderStats()).catch(() => {});
    await Promise.allSettled([loadProjects(), loadMusic()]);
    renderStats();
}

init();