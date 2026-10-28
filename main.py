"""
Studio Content Manager - Backend (FastAPI)

Endpoints:
    GET  /                       -> estado del servicio
    GET  /health                 -> health check (Render)
    POST /api/analizar-guion     -> analiza tags [BGM-...] y calcula tiempos

Arranque local:
    uvicorn main:app --reload --port 8000

Arranque en Render:
    uvicorn main:app --host 0.0.0.0 --port $PORT
"""

import os
import re
from typing import List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_VERSION = "2.0.0"

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
# ALLOWED_ORIGINS: lista separada por comas con las URLs de tu frontend.
# Ej: "https://mi-studio.web.app,https://usuario.github.io"
# Por defecto "*" (útil en desarrollo; en producción conviene restringirlo).
_origins_env = os.getenv("ALLOWED_ORIGINS", "*").strip()
ALLOWED_ORIGINS = ["*"] if _origins_env == "*" else [
    o.strip().rstrip("/") for o in _origins_env.split(",") if o.strip()
]

STOP_TAG = "[BGM-STOP]"

# Un tag válido: [BGM-ALGO] o [SFX-ALGO] (sin espacios dentro).
TAG_ONLY = re.compile(r"^\[(?:BGM|SFX)-[^\]\s]+\]$", re.IGNORECASE)
# Tokenizador: tag completo | palabra (sin '[') | corchete suelto.
TOKEN_RE = re.compile(r"\[(?:BGM|SFX)-[^\]\s]+\]|[^\s\[]+|\[", re.IGNORECASE)
# Cualquier cosa que parezca un tag, válida o no (para avisar de errores).
LOOKS_LIKE_TAG = re.compile(r"\[\s*(?:BGM|SFX)\b[^\]]*\]", re.IGNORECASE)
TAG_STRIP_RE = re.compile(r"\[(?:BGM|SFX)-[^\]\s]+\]", re.IGNORECASE)

FIN_ORACION = (".", "!", "?", "…")
FIN_COMA = (",", ";", ":")
CIERRES = "\"'»”’)]"

MIN_SEGMENTO_SEG = 3.0

# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------


class BibliotecaItem(BaseModel):
    identificador: str
    titulo: str = ""
    ambiente: str = ""
    volumen: Optional[int] = Field(default=None, ge=0, le=100)
    duracion: Optional[float] = Field(default=None, ge=0)


class AnalisisRequest(BaseModel):
    texto: str = Field(..., max_length=300_000)
    palabras_por_minuto: int = Field(default=150, ge=40, le=400)
    # Pausas extra opcionales (segundos) tras final de oración / coma.
    pausa_oracion: float = Field(default=0.0, ge=0, le=5)
    pausa_coma: float = Field(default=0.0, ge=0, le=5)
    biblioteca: List[BibliotecaItem] = Field(default_factory=list)


class Pista(BaseModel):
    orden: int
    tag: str
    tipo: str  # "bgm" | "sfx"
    titulo: str = ""
    ambiente: str = ""
    volumen: Optional[int] = None
    inicio_seg: float
    fin_seg: float
    duracion_seg: float
    inicio_fmt: str
    fin_fmt: str
    en_biblioteca: Optional[bool] = None
    fragmento: str = ""


class AnalisisRespuesta(BaseModel):
    total_palabras: int
    palabras_por_minuto: int
    duracion_total_seg: float
    duracion_total_fmt: str
    pistas: List[Pista]
    advertencias: List[str]
    texto_limpio: str


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def fmt_tiempo(segundos: float) -> str:
    total = int(round(max(segundos, 0)))
    h, resto = divmod(total, 3600)
    m, s = divmod(resto, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def normalizar_tag(valor: str) -> str:
    v = valor.strip().upper()
    if not v.startswith("["):
        v = "[" + v
    if not v.endswith("]"):
        v = v + "]"
    return v


def termina_en(token: str, finales: Tuple[str, ...]) -> bool:
    return token.rstrip(CIERRES).endswith(finales)


# ---------------------------------------------------------------------------
# Lógica de análisis
# ---------------------------------------------------------------------------


def analizar(req: AnalisisRequest) -> AnalisisRespuesta:
    texto = req.texto
    if not texto.strip():
        raise HTTPException(status_code=400, detail="El guion está vacío.")

    biblioteca = {normalizar_tag(i.identificador): i for i in req.biblioteca}
    seg_por_palabra = 60.0 / req.palabras_por_minuto
    advertencias: List[str] = []

    # Tags mal escritos (ej. [BGM], [BGM TENSION], [BGM-A B])
    for m in LOOKS_LIKE_TAG.finditer(texto):
        if not TAG_ONLY.match(m.group(0)):
            advertencias.append(
                f"Tag con formato inválido ignorado: {m.group(0)} (usa [BGM-NOMBRE] sin espacios)."
            )

    # 1) Recorrer el texto: palabras avanzan el reloj, tags quedan como eventos.
    t = 0.0
    palabras: List[str] = []
    eventos: List[Tuple[str, float, int]] = []  # (tag, segundo, indice_palabra)

    for m in TOKEN_RE.finditer(texto):
        tok = m.group(0)
        if TAG_ONLY.match(tok):
            eventos.append((tok.upper(), t, len(palabras)))
            continue
        if tok == "[" or not re.search(r"\w", tok):
            continue
        palabras.append(tok)
        t += seg_por_palabra
        if termina_en(tok, FIN_ORACION):
            t += req.pausa_oracion
        elif termina_en(tok, FIN_COMA):
            t += req.pausa_coma

    total = t

    # 2) Construir la secuencia limpia de música.
    pistas_raw: List[dict] = []
    actual: Optional[dict] = None

    def fragmento(idx: int) -> str:
        if idx >= len(palabras):
            return "(fin del guion)"
        frag = " ".join(palabras[idx: idx + 10])
        return frag if len(frag) <= 80 else frag[:77] + "..."

    def cerrar(fin: float) -> None:
        nonlocal actual
        if actual is None:
            return
        actual["fin"] = max(fin, actual["inicio"])
        pistas_raw.append(actual)
        actual = None

    for tag, tiempo, idx in eventos:
        if tag == STOP_TAG:
            if actual is None:
                advertencias.append(
                    f"[BGM-STOP] en {fmt_tiempo(tiempo)} no tiene música activa que cortar."
                )
            else:
                cerrar(tiempo)
            continue

        if tag.startswith("[SFX-"):
            item = biblioteca.get(tag)
            dur = item.duracion if item and item.duracion else 0.0
            pistas_raw.append(
                {"tag": tag, "tipo": "sfx", "inicio": tiempo, "fin": tiempo + dur, "idx": idx}
            )
            continue

        # BGM
        if actual is not None and actual["tag"] == tag:
            advertencias.append(
                f"{tag} se repite en {fmt_tiempo(tiempo)} mientras ya está sonando; se ignoró la repetición."
            )
            continue
        if actual is not None:
            cerrar(tiempo)  # cambio de pista (crossfade en la edición)
        actual = {"tag": tag, "tipo": "bgm", "inicio": tiempo, "fin": tiempo, "idx": idx}

    cerrar(total)  # la última música suena hasta el final

    pistas_raw.sort(key=lambda p: p["inicio"])

    pistas: List[Pista] = []
    for n, p in enumerate(pistas_raw, start=1):
        item = biblioteca.get(p["tag"])
        en_lib: Optional[bool] = (item is not None) if biblioteca else None
        dur_seg = round(p["fin"] - p["inicio"], 2)

        if biblioteca and item is None:
            advertencias.append(
                f"{p['tag']} no existe en tu biblioteca musical (revisa el identificador)."
            )
        if p["tipo"] == "bgm":
            if dur_seg < MIN_SEGMENTO_SEG:
                advertencias.append(
                    f"{p['tag']} suena solo {dur_seg:.1f}s (en {fmt_tiempo(p['inicio'])}); puede resultar muy corto."
                )
            if item and item.duracion and dur_seg > item.duracion + 0.5:
                advertencias.append(
                    f"{p['tag']} se usa {fmt_tiempo(dur_seg)} pero la pista dura {fmt_tiempo(item.duracion)}; necesitará loop."
                )

        pistas.append(
            Pista(
                orden=n,
                tag=p["tag"],
                tipo=p["tipo"],
                titulo=item.titulo if item else "",
                ambiente=item.ambiente if item else "",
                volumen=item.volumen if item else None,
                inicio_seg=round(p["inicio"], 2),
                fin_seg=round(p["fin"], 2),
                duracion_seg=dur_seg,
                inicio_fmt=fmt_tiempo(p["inicio"]),
                fin_fmt=fmt_tiempo(p["fin"]),
                en_biblioteca=en_lib,
                fragmento=fragmento(p["idx"]),
            )
        )

    if not pistas and not advertencias:
        advertencias.append("El guion no contiene tags de música ([BGM-...]).")

    texto_limpio = re.sub(r"\s+", " ", TAG_STRIP_RE.sub(" ", texto)).strip()

    return AnalisisRespuesta(
        total_palabras=len(palabras),
        palabras_por_minuto=req.palabras_por_minuto,
        duracion_total_seg=round(total, 2),
        duracion_total_fmt=fmt_tiempo(total),
        pistas=pistas,
        advertencias=advertencias,
        texto_limpio=texto_limpio,
    )


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Studio Content Manager API",
    version=APP_VERSION,
    description="Análisis de guiones con tags de música para creadores de contenido.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def raiz():
    return {"servicio": "Studio Content Manager API", "version": APP_VERSION, "estado": "ok"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/analizar-guion", response_model=AnalisisRespuesta)
def analizar_guion(req: AnalisisRequest) -> AnalisisRespuesta:
    return analizar(req)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
