/* Resumo do Dia — telas do app. Tudo roda no celular; nada é enviado para fora. */
"use strict";

const CATEGORIAS = {
  brasil: "🇧🇷 Brasil", politica: "🏛️ Política", economia: "💰 Economia",
  mundo: "🌍 Mundo", tecnologia: "💻 Tecnologia", esportes: "⚽ Esportes", bahia: "🌴 Bahia",
};
const TEMAS_PADRAO =
`Agronegócio: agro, safra, pecuária, soja, milho, exportação agrícola, Conab
Café: café, cafeicultura, arábica, conilon, cafeicultor
Energia: energia, mercado livre de energia, Aneel, energia solar, eólica, baterias, tarifa de luz
Indústria de alimentos: indústria de alimentos, alimentos, frigorífico, laticínios, Anvisa`;
const URL_VAGALUME = "https://raw.githubusercontent.com/microcosmojairo-jpg/vagalume-daily/main/noticias.json";
const FEMININOS = ["Folha", "CNN Brasil", "BBC News Brasil", "Agência Brasil", "DW Brasil", "RFI Brasil"];

const $ = (s) => document.querySelector(s);
let indice = null, edicao = null, filaAudio = [], posAudio = 0, pausado = false;

/* ------------------------------------------------------------ preferências */
function lerPrefs() {
  const padrao = { boas: false, temas: false, temasTexto: TEMAS_PADRAO, fontesOcultas: [], letra: "1" };
  try { return { ...padrao, ...JSON.parse(localStorage.getItem("resumo-prefs") || "{}") }; }
  catch { return padrao; }
}
function salvarPrefs(p) { try { localStorage.setItem("resumo-prefs", JSON.stringify(p)); } catch { /* sem espaço: segue sem salvar */ } }
let prefs = lerPrefs();

/* ------------------------------------------------------------ utilidades */
function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  for (const f of filhos) if (f) n.append(f);
  return n;
}
const dataLonga = (iso) => new Date(iso + "T12:00:00-03:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
const dataCurta = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const prep = (nome) => (FEMININOS.includes(nome) ? "na " : nome === "A Tarde" ? "em " : "no ") + nome;
const normalizar = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");

async function buscarJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

/* ------------------------------------------------------------ filtro de fontes */
function filtrar(grupo) {
  const fontes = grupo.fontes.filter((f) => !prefs.fontesOcultas.includes(f.nome));
  return fontes.length ? { ...grupo, fontes } : null;
}

/* ------------------------------------------------------------ cartões */
function cartao(g, chave) {
  const ler = el("div", { class: "ler" });
  if (g.fontes.length === 1) {
    const f = g.fontes[0];
    ler.append(el("a", { href: f.link, target: "_blank", rel: "noopener" },
      "Ler notícia completa", f.paywall ? el("small", { text: "pode exigir assinatura" }) : null));
  } else {
    for (const f of g.fontes) {
      ler.append(el("a", { href: f.link, target: "_blank", rel: "noopener" },
        "Ler " + prep(f.nome), f.paywall ? el("small", { text: "pode exigir assinatura" }) : null));
    }
  }
  const nomes = g.fontes.map((f) => f.nome).join(", ");
  const c = el("article", { class: "cartao", "data-chave": chave },
    el("h3", { text: g.titulo }),
    g.trecho ? el("p", { text: g.trecho }) : null,
    el("div", { class: "meta", text: `${nomes} · ${hora(g.hora)}` }),
    ler);
  filaAudio.push({ chave, texto: `${g.titulo}. ${g.trecho || ""} Fonte: ${nomes}.` });
  return c;
}

/* ------------------------------------------------------------ desenho da tela */
function desenhar() {
  filaAudio = [];
  const d = edicao;
  $("#data-edicao").textContent = dataLonga(d.edicao);
  $("#janela").textContent = `Notícias de 6:00 de ${dataCurta(d.janela.inicio)} até 5:59 de ${dataCurta(d.janela.fim)}`;
  filaAudio.push({ chave: null, texto: `Resumo do dia, ${dataLonga(d.edicao)}.` });

  // As 3 do dia
  const tres = d.tres_do_dia.map(filtrar).filter(Boolean);
  const boxTres = $("#tres"); boxTres.replaceChildren(); boxTres.classList.add("tres");
  if (tres.length) filaAudio.push({ chave: null, texto: "As três do dia." });
  tres.forEach((g, i) => boxTres.append(cartao(g, "t" + i)));
  $("#sec-tres").hidden = !tres.length;

  // Categorias
  const boxCat = $("#categorias"); boxCat.replaceChildren();
  for (const [cat, rotulo] of Object.entries(CATEGORIAS)) {
    const lista = (d.categorias[cat] || []).map(filtrar).filter(Boolean);
    if (!lista.length) continue;
    filaAudio.push({ chave: null, texto: rotulo.replace(/^\S+\s/, "") + "." });
    const sec = el("section", {}, el("h2", { class: "titulo-secao", text: rotulo }));
    const l = el("div", { class: "lista" });
    lista.forEach((g, i) => l.append(cartao(g, cat + i)));
    sec.append(l); boxCat.append(sec);
  }

  desenharTemas();
  desenharBoas();

  $("#indisponiveis").textContent = d.fontes_indisponiveis?.length
    ? "Fontes indisponíveis hoje: " + d.fontes_indisponiveis.join(", ") : "";
  $("#fim").hidden = false;
}

function lerTemas() {
  return prefs.temasTexto.split("\n").map((linha) => {
    const [nome, resto] = linha.split(":");
    if (!nome || !resto) return null;
    const palavras = resto.split(",").map((p) => normalizar(p).trim()).filter(Boolean);
    return palavras.length ? { nome: nome.trim(), palavras } : null;
  }).filter(Boolean);
}

function desenharTemas() {
  const box = $("#temas"); box.replaceChildren();
  $("#sec-temas").hidden = !prefs.temas;
  if (!prefs.temas) return;
  const acervo = (edicao.acervo || []).map(filtrar).filter(Boolean);
  filaAudio.push({ chave: null, texto: "Meus temas." });
  lerTemas().forEach((t, ti) => {
    const regras = t.palavras.map((p) => new RegExp("(^| )" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const achadas = acervo.filter((g) => {
      const txt = " " + normalizar(g.titulo + " " + g.trecho);
      return regras.some((r) => r.test(txt));
    }).slice(0, 3);
    const sec = el("div", { class: "tema" }, el("h4", { text: t.nome }));
    if (!achadas.length) {
      sec.append(el("p", { class: "nada", text: "Nada novo hoje sobre este tema." }));
    } else {
      filaAudio.push({ chave: null, texto: t.nome + "." });
      const l = el("div", { class: "lista" });
      achadas.forEach((g, i) => l.append(cartao(g, `tema${ti}-${i}`)));
      sec.append(l);
    }
    box.append(sec);
  });
}

async function desenharBoas() {
  const box = $("#boas"); box.replaceChildren();
  $("#sec-boas").hidden = true;
  if (!prefs.boas) return;
  try {
    const v = await buscarJSON(URL_VAGALUME);
    const lista = [v.destaque, ...(v.noticias || [])].filter(Boolean).slice(0, 5);
    if (!lista.length) return;
    filaAudio.push({ chave: null, texto: "Boas notícias." });
    lista.forEach((n, i) => {
      const g = { titulo: n.title, trecho: n.dek, hora: (n.date || v.edicao) + "T12:00:00-03:00", fontes: [{ nome: n.src, link: n.url, paywall: false }] };
      box.append(cartao(g, "boa" + i));
    });
    $("#sec-boas").hidden = false;
  } catch { /* Vagalume fora do ar: a seção simplesmente não aparece */ }
}

/* ------------------------------------------------------------ carregamento */
async function carregar(dataEscolhida) {
  pararAudio();
  $("#aviso").hidden = true;
  try {
    indice = await buscarJSON("dados/indice.json");
  } catch {
    mostrarAviso("Não foi possível atualizar agora. Verifique a internet e tente mais tarde.");
    return;
  }
  if (!indice.edicoes?.length) { mostrarAviso("O primeiro resumo ainda não foi gerado. Ele sai amanhã às 6:00."); return; }

  const sel = $("#historico"); sel.replaceChildren();
  indice.edicoes.forEach((e, i) => sel.append(el("option", { value: e, text: i === 0 ? "Hoje · " + dataCurta(e + "T12:00:00-03:00") : dataLonga(e) })));
  const alvo = dataEscolhida || indice.edicoes[0];
  sel.value = alvo;

  try {
    edicao = await buscarJSON(`dados/${alvo}.json`);
  } catch {
    mostrarAviso("Não foi possível abrir esta edição. Tente mais tarde."); return;
  }
  desenhar();

  if (!dataEscolhida && indice.ultima_tentativa_falhou && indice.edicao_tentada > indice.edicoes[0]) {
    mostrarAviso(`Não foi possível atualizar hoje. Tente mais tarde. Você está vendo o resumo de ${dataLonga(indice.edicoes[0])}.`);
  } else if (alvo !== indice.edicoes[0]) {
    mostrarAviso(`Edição anterior: ${dataLonga(alvo)}.`);
  }
}
function mostrarAviso(t) { const a = $("#aviso"); a.textContent = t; a.hidden = false; }

/* ------------------------------------------------------------ áudio */
const temVoz = "speechSynthesis" in window;
function vozPt() {
  const vozes = speechSynthesis.getVoices();
  return vozes.find((v) => v.lang === "pt-BR" && /google|luciana|felipe|natural/i.test(v.name))
    || vozes.find((v) => v.lang === "pt-BR") || vozes.find((v) => v.lang.startsWith("pt"));
}
function falar() {
  speechSynthesis.cancel();
  document.querySelectorAll(".cartao.lendo").forEach((c) => c.classList.remove("lendo"));
  if (posAudio >= filaAudio.length) { pararAudio(); return; }
  const item = filaAudio[posAudio];
  if (item.chave) {
    const c = document.querySelector(`[data-chave="${item.chave}"]`);
    if (c) { c.classList.add("lendo"); c.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  $("#pl-status").textContent = item.texto.slice(0, 80);
  const u = new SpeechSynthesisUtterance(item.texto);
  u.lang = "pt-BR"; u.rate = 1.0;
  const v = vozPt(); if (v) u.voice = v;
  u.onend = () => { if (!pausado) { posAudio++; falar(); } };
  speechSynthesis.speak(u);
}
function iniciarAudio() {
  if (!temVoz) { alert("Este navegador não tem leitura em voz alta."); return; }
  if (!filaAudio.length) return;
  posAudio = 0; pausado = false; $("#player").hidden = false; $("#pl-pausar").textContent = "⏸";
  falar();
}
function pararAudio() {
  if (temVoz) speechSynthesis.cancel();
  pausado = false; $("#player").hidden = true;
  document.querySelectorAll(".cartao.lendo").forEach((c) => c.classList.remove("lendo"));
}
function pularPara(delta) {
  // pula para a próxima/anterior notícia (ignora títulos de seção)
  let p = posAudio + delta;
  while (p > 0 && p < filaAudio.length && !filaAudio[p].chave) p += delta;
  posAudio = Math.max(0, Math.min(p, filaAudio.length));
  pausado = false; $("#pl-pausar").textContent = "⏸"; falar();
}
$("#btn-ouvir").onclick = iniciarAudio;
$("#pl-parar").onclick = pararAudio;
$("#pl-avancar").onclick = () => pularPara(1);
$("#pl-voltar").onclick = () => pularPara(-1);
$("#pl-pausar").onclick = () => {
  if (pausado) { pausado = false; $("#pl-pausar").textContent = "⏸"; falar(); }
  else { pausado = true; speechSynthesis.cancel(); $("#pl-pausar").textContent = "▶"; }
};
if (temVoz) speechSynthesis.onvoiceschanged = () => {};

/* ------------------------------------------------------------ configurações */
function abrirConfig() {
  $("#cfg-boas").checked = prefs.boas;
  $("#cfg-temas").checked = prefs.temas;
  $("#cfg-temas-texto").value = prefs.temasTexto;
  $("#cfg-letra").value = prefs.letra;
  const box = $("#cfg-fontes"); box.replaceChildren();
  (edicao?.fontes_consultadas || []).forEach((nome) => {
    const cb = el("input", { type: "checkbox", value: nome });
    cb.checked = !prefs.fontesOcultas.includes(nome);
    box.append(el("label", {}, cb, nome));
  });
  $("#config").showModal();
}
$("#btn-config").onclick = abrirConfig;
$("#cfg-temas-padrao").onclick = () => { $("#cfg-temas-texto").value = TEMAS_PADRAO; };
$("#config").addEventListener("close", () => {
  if ($("#config").returnValue !== "ok") return;
  prefs = {
    boas: $("#cfg-boas").checked,
    temas: $("#cfg-temas").checked,
    temasTexto: $("#cfg-temas-texto").value.trim() || TEMAS_PADRAO,
    letra: $("#cfg-letra").value,
    fontesOcultas: [...document.querySelectorAll("#cfg-fontes input")].filter((c) => !c.checked).map((c) => c.value),
  };
  salvarPrefs(prefs);
  aplicarLetra();
  if (edicao) desenhar();
});
function aplicarLetra() { document.documentElement.style.setProperty("--escala", prefs.letra); }

/* ------------------------------------------------------------ início */
$("#btn-atualizar").onclick = () => carregar();
$("#historico").onchange = (e) => carregar(e.target.value === indice.edicoes[0] ? null : e.target.value);
aplicarLetra();
carregar();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
