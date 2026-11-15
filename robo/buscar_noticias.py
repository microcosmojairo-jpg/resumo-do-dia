"""
Robô do Resumo do Dia.

Roda todo dia às 6:00 (horário da Bahia) no GitHub Actions e:
  1. Lê os feeds RSS oficiais listados em fontes.json.
  2. Cada fonte tem no máximo 2 tentativas de 10 segundos. Se falhar, pula.
  3. Só aproveita notícias com título, link e data, publicadas entre
     6:00 de ontem e 5:59 de hoje (horário da Bahia).
  4. Junta a mesma notícia publicada por veículos diferentes.
  5. Escolhe "As 3 do dia" (as que mais veículos publicaram) e as
     principais por categoria.
  6. Grava o resultado em dados/AAAA-MM-DD.json e mantém só 7 dias.

Não usa inteligência artificial: o texto mostrado é exatamente o título e o
trecho que o próprio veículo publicou no feed. Nada é inventado.
"""

import html
import json
import re
import sys
import time
import unicodedata
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import feedparser
import requests

FUSO = ZoneInfo("America/Bahia")
RAIZ = Path(__file__).resolve().parent.parent
PASTA_DADOS = RAIZ / "dados"
ARQ_FONTES = Path(__file__).resolve().parent / "fontes.json"

TENTATIVAS = 2
TEMPO_LIMITE = 10  # segundos
DIAS_HISTORICO = 7
MAX_POR_CATEGORIA = 3
MAX_LISTA = 12          # notícias nas categorias (além das 3 do dia)
MAX_TRECHO = 280        # caracteres do trecho mostrado
MAX_ACERVO = 200        # notícias guardadas para a busca por temas

# Títulos com cara de propaganda/oferta não entram no resumo
PROPAGANDA = re.compile(
    r"black (friday|november)|cupom|oferta|promo[cç][aã]o|desconto|"
    r"despenca \d+%|na amazon|no mercado livre|frete gr[aá]tis|publieditorial|conte[uú]do patrocinado",
    re.IGNORECASE)

CATEGORIAS = ["brasil", "politica", "economia", "mundo", "tecnologia", "esportes", "bahia"]

CABECALHO = {
    "User-Agent": "ResumoDoDia/1.0 (leitor de RSS pessoal; +https://github.com/microcosmojairo-jpg/resumo-do-dia)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
}

PALAVRAS_VAZIAS = set("""
a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas
para pra com sem sob sobre entre ate até e ou que se ao aos à às é ser foi sao são
como mais menos ja já nao não sim seu sua seus suas ele ela eles elas isso esse essa
este esta diz dizem apos após contra the of and to in on for veja video vídeo ao vivo
""".split())


# ---------------------------------------------------------------- utilidades

def janela_de_tempo(agora=None):
    """Retorna (inicio, fim, data_da_edicao). Fim = 6:00 de hoje (exclusivo)."""
    agora = agora or datetime.now(FUSO)
    fim = agora.replace(hour=6, minute=0, second=0, microsecond=0)
    if agora < fim:  # rodou antes das 6:00: usa a janela que terminou ontem
        fim -= timedelta(days=1)
    return fim - timedelta(hours=24), fim, fim.date().isoformat()


def limpar_texto(bruto):
    if not bruto:
        return ""
    texto = re.sub(r"<[^>]+>", " ", bruto)
    texto = html.unescape(texto)
    return re.sub(r"\s+", " ", texto).strip()


def encurtar(texto, limite=MAX_TRECHO):
    if len(texto) <= limite:
        return texto
    corte = texto[:limite].rsplit(" ", 1)[0].rstrip(" ,.;:-")
    return corte + "…"


def normalizar(texto):
    texto = unicodedata.normalize("NFKD", texto.lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]", " ", texto)


def palavras_chave(titulo):
    return {p for p in normalizar(titulo).split() if len(p) > 2 and p not in PALAVRAS_VAZIAS}


def data_da_entrada(entrada):
    for campo in ("published_parsed", "updated_parsed"):
        valor = entrada.get(campo)
        if valor:  # o feedparser já converte a data para UTC
            return datetime(*valor[:6], tzinfo=timezone.utc)
    return None


# ---------------------------------------------------------------- busca

def baixar_feed(fonte):
    """Até 2 tentativas de 10 s. Retorna lista de entradas ou None se falhou."""
    ultimo_erro = ""
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            resposta = requests.get(fonte["url"], headers=CABECALHO, timeout=TEMPO_LIMITE)
            resposta.raise_for_status()
            feed = feedparser.parse(resposta.content)
            if feed.entries:
                return feed.entries
            ultimo_erro = "feed vazio ou ilegível"
        except Exception as erro:  # noqa: BLE001 — qualquer falha conta como tentativa
            ultimo_erro = str(erro)[:120]
        if tentativa < TENTATIVAS:
            time.sleep(2)
    print(f"  ✗ {fonte['nome']} ({fonte['cat']}): {ultimo_erro}")
    return None


def coletar(fontes, inicio, fim):
    noticias, vistos = [], set()
    ok, falhas = set(), set()
    for fonte in fontes:
        entradas = baixar_feed(fonte)
        if entradas is None:
            falhas.add(fonte["nome"])
            continue
        ok.add(fonte["nome"])
        aproveitadas = sem_dados = 0
        mais_recente = None
        for e in entradas:
            titulo = limpar_texto(e.get("title"))
            link = (e.get("link") or "").strip()
            quando = data_da_entrada(e)
            if not titulo or not link.startswith("http") or quando is None:
                sem_dados += 1
                continue  # sem título, link ou data: descarta
            if PROPAGANDA.search(titulo):
                continue  # propaganda/oferta: descarta
            quando_local = quando.astimezone(FUSO)
            mais_recente = max(mais_recente or quando_local, quando_local)
            if not (inicio <= quando_local < fim):
                continue  # fora da janela de 24 h: descarta
            if link in vistos:
                continue
            vistos.add(link)
            trecho = limpar_texto(e.get("summary") or e.get("description"))
            if trecho.startswith(titulo):  # alguns feeds repetem o título no trecho
                trecho = trecho[len(titulo):].lstrip(" .:-–—")
            if normalizar(trecho).strip() == normalizar(titulo).strip():
                trecho = ""
            noticias.append({
                "titulo": titulo,
                "trecho": encurtar(trecho),
                "link": link,
                "fonte": fonte["nome"],
                "cat": fonte["cat"],
                "paywall": bool(fonte.get("paywall")),
                "hora": quando_local.isoformat(timespec="minutes"),
                "_chaves": palavras_chave(titulo),
            })
            aproveitadas += 1
        print(f"  ✓ {fonte['nome']} ({fonte['cat']}): {aproveitadas} na janela "
              f"(de {len(entradas)} no feed; {sem_dados} sem título/link/data; "
              f"mais recente: {mais_recente:%d/%m %H:%M} )" if mais_recente else
              f"  ✓ {fonte['nome']} ({fonte['cat']}): {aproveitadas} na janela "
              f"(de {len(entradas)} no feed; {sem_dados} sem título/link/data)")
    # Fonte que falhou num feed mas funcionou em outro não conta como indisponível
    return noticias, sorted(falhas - ok)


# ---------------------------------------------------------------- agrupamento

def parecidas(a, b):
    if not a or not b:
        return False
    comuns = len(a & b)
    proporcao = comuns / min(len(a), len(b))
    return (comuns >= 3 and proporcao >= 0.5) or (comuns >= 2 and proporcao >= 0.75)


def agrupar(noticias):
    """Junta a mesma notícia publicada por veículos diferentes."""
    grupos = []
    for n in sorted(noticias, key=lambda x: x["hora"], reverse=True):
        for g in grupos:
            if any(parecidas(n["_chaves"], m["_chaves"]) for m in g["itens"]):
                g["itens"].append(n)
                break
        else:
            grupos.append({"itens": [n]})

    resultado = []
    for g in grupos:
        itens = g["itens"]
        # um link por veículo (o mais recente de cada)
        por_fonte = {}
        for i in itens:
            por_fonte.setdefault(i["fonte"], i)
        cats = Counter(i["cat"] for i in itens if i["cat"] != "agro")
        cat = cats.most_common(1)[0][0] if cats else "agro"
        # texto principal: de um veículo aberto, com o maior trecho
        base = max(itens, key=lambda i: (not i["paywall"], len(i["trecho"])))
        resultado.append({
            "titulo": base["titulo"],
            "trecho": base["trecho"],
            "fonte_texto": base["fonte"],
            "cat": cat,
            "hora": max(i["hora"] for i in itens),
            "fontes": [
                {"nome": i["fonte"], "link": i["link"], "paywall": i["paywall"]}
                for i in por_fonte.values()
            ],
        })
    return resultado


def importancia(grupo):
    return (len(grupo["fontes"]), grupo["hora"])


def montar_edicao(grupos):
    principais = [g for g in grupos if g["cat"] in CATEGORIAS]
    principais.sort(key=importancia, reverse=True)

    tres = principais[:3]
    resto = principais[3:]

    escolhidas, contagem = [], Counter()
    # 1ª volta: até 2 por categoria, para todas aparecerem
    for g in resto:
        if contagem[g["cat"]] < 2:
            escolhidas.append(g)
            contagem[g["cat"]] += 1
    # 2ª volta: completa até MAX_LISTA, com no máximo 3 por categoria
    escolhidas = escolhidas[:MAX_LISTA]
    for g in resto:
        if len(escolhidas) >= MAX_LISTA:
            break
        if g not in escolhidas and contagem[g["cat"]] < MAX_POR_CATEGORIA:
            escolhidas.append(g)
            contagem[g["cat"]] += 1

    categorias = {}
    for c in CATEGORIAS:
        lista = sorted([g for g in escolhidas if g["cat"] == c], key=importancia, reverse=True)
        if lista:
            categorias[c] = lista

    acervo = sorted(grupos, key=importancia, reverse=True)[:MAX_ACERVO]
    return tres, categorias, acervo


# ---------------------------------------------------------------- gravação

def ler_json(caminho, padrao):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return padrao


def gravar_json(caminho, dados):
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")


def atualizar_indice(data_edicao, falhou, total_fontes, indisponiveis):
    PASTA_DADOS.mkdir(exist_ok=True)
    arq = PASTA_DADOS / "indice.json"
    indice = ler_json(arq, {"edicoes": []})
    edicoes = set(indice.get("edicoes", []))
    if not falhou:
        edicoes.add(data_edicao)
    edicoes = sorted(edicoes, reverse=True)[:DIAS_HISTORICO]
    # apaga edições com mais de 7 dias
    for f in PASTA_DADOS.glob("????-??-??.json"):
        if f.stem not in edicoes:
            f.unlink()
    indice = {
        "edicoes": edicoes,
        "ultima_tentativa": datetime.now(FUSO).isoformat(timespec="minutes"),
        "ultima_tentativa_falhou": falhou,
        "edicao_tentada": data_edicao,
        "fontes_indisponiveis": indisponiveis if falhou else [],
        "total_fontes": total_fontes,
    }
    gravar_json(arq, indice)


def main():
    config = ler_json(ARQ_FONTES, {"fontes": []})
    fontes = [f for f in config["fontes"] if f.get("ativa", True)]
    inicio, fim, data_edicao = janela_de_tempo()
    print(f"Edição {data_edicao}: notícias de {inicio:%d/%m %H:%M} até {fim - timedelta(minutes=1):%d/%m %H:%M}")

    noticias, indisponiveis = coletar(fontes, inicio, fim)
    nomes_fontes = sorted({f["nome"] for f in fontes})

    if not noticias:
        print("Nenhuma notícia válida. A edição anterior continua no ar.")
        atualizar_indice(data_edicao, True, len(nomes_fontes), indisponiveis)
        return 0

    grupos = agrupar(noticias)
    tres, categorias, acervo = montar_edicao(grupos)

    edicao = {
        "edicao": data_edicao,
        "gerado_em": datetime.now(FUSO).isoformat(timespec="minutes"),
        "janela": {"inicio": inicio.isoformat(timespec="minutes"), "fim": fim.isoformat(timespec="minutes")},
        "tres_do_dia": tres,
        "categorias": categorias,
        "acervo": acervo,
        "fontes_indisponiveis": indisponiveis,
        "fontes_consultadas": nomes_fontes,
        "total_noticias_lidas": len(noticias),
    }
    PASTA_DADOS.mkdir(exist_ok=True)
    gravar_json(PASTA_DADOS / f"{data_edicao}.json", edicao)
    atualizar_indice(data_edicao, False, len(nomes_fontes), indisponiveis)
    print(f"OK: {len(noticias)} notícias lidas, {len(grupos)} assuntos, "
          f"{sum(len(v) for v in categorias.values()) + len(tres)} no resumo. "
          f"Indisponíveis: {', '.join(indisponiveis) or 'nenhuma'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
