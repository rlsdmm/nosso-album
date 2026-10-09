"""
Gera o álbum criptografado a partir de privado/memorias.txt e privado/fotos/.

    python publicar.py

Pede a senha do álbum, reduz as fotos, remove os dados escondidos delas
(GPS, modelo do celular...) e criptografa tudo em dados/. Só a pasta dados/
vai pro GitHub; a pasta privado/ nunca sai do seu PC.
"""

import base64
import datetime as dt
import getpass
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sys
import unicodedata
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageOps

try:
    import pillow_heif  # fotos .heic de iPhone

    pillow_heif.register_heif_opener()
except ImportError:
    pass

for fluxo in (sys.stdout, sys.stderr):
    try:
        fluxo.reconfigure(encoding="utf-8")  # acentos e emoji no terminal do Windows
    except (AttributeError, ValueError):
        pass

RAIZ = Path(__file__).resolve().parent
PRIVADO = RAIZ / "privado"
FOTOS = PRIVADO / "fotos"
MEMORIAS = PRIVADO / "memorias.txt"
CACHE = PRIVADO / ".cache.json"
DADOS = RAIZ / "dados"
SAIDA_FOTOS = DADOS / "f"
ALBUM = DADOS / "album.json"

ITERACOES = 600_000
EXTENSOES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
TAMANHOS = {"m": (720, 80), "g": (1800, 84)}  # miniatura e foto grande: (lado maior, qualidade)
TIPOS = {"encontro", "comidinha", "passeio", "momento", "especial"}


def falhar(msg):
    print(f"\n✖ {msg}")
    sys.exit(1)


# ---------- senha ----------

def normalizar(senha):
    # Igual ao app.js: maiúsculas e espaços extras não importam (corretor do celular).
    senha = unicodedata.normalize("NFC", senha).strip()
    return re.sub(r"\s+", " ", senha).lower()


def derivar(senha, sal):
    return hashlib.pbkdf2_hmac("sha256", normalizar(senha).encode("utf-8"), sal, ITERACOES, 32)


def cifrar(chave, dados):
    iv = secrets.token_bytes(12)
    return iv + AESGCM(chave).encrypt(iv, dados, None)


def decifrar(chave, blob):
    return AESGCM(chave).decrypt(blob[:12], blob[12:], None)


def obter_chave():
    anterior = json.loads(ALBUM.read_text("utf-8")) if ALBUM.exists() else None
    senha = os.environ.get("ALBUM_SENHA") or getpass.getpass("Senha do álbum (não aparece enquanto digita): ")
    if not normalizar(senha):
        falhar("A senha não pode ficar vazia.")

    if anterior:
        sal = base64.b64decode(anterior["sal"])
        chave = derivar(senha, sal)
        try:
            decifrar(chave, base64.b64decode(anterior["meta"]))
            return sal, chave
        except Exception:
            print("\nEssa não é a senha atual do álbum.")
            if os.environ.get("ALBUM_SENHA") or input("Quer TROCAR a senha do álbum por essa? (s/N) ").strip().lower() != "s":
                falhar("Nada foi alterado.")

    if len(normalizar(senha)) < 12:
        print("\n⚠ Senha curta. Uma frase comprida que só vocês sabem é bem mais segura.")
        if not os.environ.get("ALBUM_SENHA") and input("Usar mesmo assim? (s/N) ").strip().lower() != "s":
            falhar("Nada foi alterado.")
    if not os.environ.get("ALBUM_SENHA"):
        if normalizar(getpass.getpass("Digite a senha de novo pra confirmar: ")) != normalizar(senha):
            falhar("As senhas não batem.")
    sal = secrets.token_bytes(16)
    return sal, derivar(senha, sal)


# ---------- memorias.txt ----------

def ler_data(texto, linha):
    texto = texto.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return dt.datetime.strptime(texto, fmt).date().isoformat()
        except ValueError:
            pass
    falhar(f"Linha {linha}: não entendi a data '{texto}'. Use 26/09/2026 ou 2026-09-26.")


def ler_memorias():
    if not MEMORIAS.exists():
        falhar(f"Não achei {MEMORIAS.relative_to(RAIZ)}.")
    config, memorias, atual = {}, [], None

    for n, linha in enumerate(MEMORIAS.read_text("utf-8-sig").splitlines(), 1):
        limpa = linha.strip()
        if limpa.startswith("##"):
            partes = [p.strip() for p in limpa[2:].split("|")]
            if len(partes) == 2:
                partes.insert(1, "momento")
            if len(partes) != 3 or not partes[2]:
                falhar(f"Linha {n}: o título deve ser assim: ## 26/09/2026 | encontro | Nome da memória")
            tipo = partes[1].lower()
            if tipo not in TIPOS:
                falhar(f"Linha {n}: tipo '{partes[1]}' não existe. Use: {', '.join(sorted(TIPOS))}.")
            atual = {"data": ler_data(partes[0], n), "tipo": tipo, "titulo": partes[2],
                     "lugar": "", "fotos": [], "texto": [], "_linha": n}
            memorias.append(atual)
        elif limpa.startswith("#"):
            continue
        elif atual is None:
            if ":" in limpa:
                k, v = limpa.split(":", 1)
                config[k.strip().lower()] = v.strip()
        elif re.match(r"(?i)^fotos?\s*:", limpa):
            atual["fotos"] += [f.strip() for f in limpa.split(":", 1)[1].split(",") if f.strip()]
        elif re.match(r"(?i)^lugar\s*:", limpa):
            atual["lugar"] = limpa.split(":", 1)[1].strip()
        else:
            atual["texto"].append(limpa)

    for m in memorias:
        m["texto"] = re.sub(r"\n{3,}", "\n\n", "\n".join(m["texto"]).strip())
    for k in ("namoro-desde", "conhecemos-em"):
        if config.get(k):
            config[k] = ler_data(config[k], 0)
    memorias.sort(key=lambda m: m["data"])
    return config, memorias


def expandir_fotos(memoria):
    arquivos = []
    for nome in memoria["fotos"]:
        caminho = FOTOS / nome
        if nome.endswith(("/", "\\")) or caminho.is_dir():
            if not caminho.is_dir():
                falhar(f"Memória da linha {memoria['_linha']}: a pasta 'fotos/{nome}' não existe.")
            arquivos += sorted(p for p in caminho.iterdir() if p.suffix.lower() in EXTENSOES)
        elif caminho.is_file():
            arquivos.append(caminho)
        else:
            falhar(f"Memória da linha {memoria['_linha']}: não achei a foto 'fotos/{nome}'.")
    return arquivos


# ---------- fotos ----------

def processar(caminho, chave, cache, usados):
    bruto = caminho.read_bytes()
    nomes = {t: hmac.new(chave, f"v1|{t}|".encode() + bruto, hashlib.sha256).hexdigest()[:24] for t in TAMANHOS}
    usados.update(nomes.values())
    info = cache.get(nomes["g"])

    if info and all((SAIDA_FOTOS / f"{n}.bin").exists() for n in nomes.values()):
        return {"m": nomes["m"], "g": nomes["g"], "w": info["w"], "h": info["h"]}

    with Image.open(io.BytesIO(bruto)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        w, h = img.size
        for tam, nome in nomes.items():
            lado, qualidade = TAMANHOS[tam]
            copia = img.copy()
            copia.thumbnail((lado, lado), Image.LANCZOS)
            buf = io.BytesIO()
            copia.save(buf, "JPEG", quality=qualidade, progressive=True, optimize=True)  # sem EXIF/GPS
            (SAIDA_FOTOS / f"{nome}.bin").write_bytes(cifrar(chave, buf.getvalue()))
    cache[nomes["g"]] = {"w": w, "h": h}
    print(f"  ✓ {caminho.relative_to(FOTOS)}")
    return {"m": nomes["m"], "g": nomes["g"], "w": w, "h": h}


def main():
    config, memorias = ler_memorias()
    sal, chave = obter_chave()
    SAIDA_FOTOS.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}
    usados = set()

    print(f"\nPreparando {len(memorias)} memória(s)...")
    saida = []
    for i, m in enumerate(memorias):
        fotos = [processar(p, chave, cache, usados) for p in expandir_fotos(m)]
        saida.append({"id": i, "data": m["data"], "tipo": m["tipo"], "titulo": m["titulo"],
                      "lugar": m["lugar"], "texto": m["texto"], "fotos": fotos})

    removidas = 0
    for arq in SAIDA_FOTOS.glob("*.bin"):
        if arq.stem not in usados:
            arq.unlink()
            removidas += 1

    meta = json.dumps({"config": config, "memorias": saida}, ensure_ascii=False).encode("utf-8")
    ALBUM.write_text(json.dumps({
        "v": 1,
        "iteracoes": ITERACOES,
        "sal": base64.b64encode(sal).decode(),
        "meta": base64.b64encode(cifrar(chave, meta)).decode(),
    }, indent=1), "utf-8")
    CACHE.write_text(json.dumps(cache), "utf-8")

    total = sum(len(m["fotos"]) for m in saida)
    print(f"\n💜 Pronto! {len(saida)} memória(s), {total} foto(s) criptografadas em dados/.")
    if removidas:
        print(f"   ({removidas} arquivo(s) antigo(s) removido(s))")


if __name__ == "__main__":
    main()
