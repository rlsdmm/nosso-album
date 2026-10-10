(() => {
  "use strict";

  const TIPOS = {
    encontro:  { icone: "💜", nome: "Encontro",  plural: "Encontros" },
    comidinha: { icone: "🍰", nome: "Comidinha", plural: "Comidinhas" },
    passeio:   { icone: "🌙", nome: "Passeio",   plural: "Passeios" },
    momento:   { icone: "✨", nome: "Momento",   plural: "Momentos" },
    especial:  { icone: "💍", nome: "Especial",  plural: "Especiais" },
  };
  const CHAVE_SALVA = "album-chave";
  const TEMPO_SLIDE = 4500;
  const TAMANHOS = { m: [720, 0.8], g: [1800, 0.84] }; // igual ao publicar.py

  // Repositório onde o álbum mora (rlsdmm.github.io/nosso-album → rlsdmm/nosso-album).
  const REPO = (() => {
    const pasta = location.pathname.split("/").filter(Boolean)[0];
    if (location.hostname.endsWith(".github.io") && pasta) return `${location.hostname.split(".")[0]}/${pasta}`;
    return new URLSearchParams(location.search).get("repo");
  })();

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, texto) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  };

  let album = null;   // dados/album.json
  let chave = null;   // CryptoKey AES-GCM
  let meta = null;    // { config, memorias }
  let token = null;   // chave de edição do GitHub (fica criptografada no album.json)
  let filtro = "todos";
  let fotosVisiveis = []; // [{ mem, foto }] na ordem da linha do tempo
  const urls = new Map();

  // ───────────── cripto ─────────────

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const paraB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const hexAleatorio = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

  // Igual ao publicar.py: maiúsculas e espaços extras não importam.
  const normalizar = (s) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

  async function derivar(senha) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalizar(senha)), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(album.sal), iterations: album.iteracoes, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
  }

  async function decifrar(k, dados) {
    const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, k, bytes.slice(12));
  }

  async function cifrar(dados) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, dados));
    const saida = new Uint8Array(12 + ct.length);
    saida.set(iv);
    saida.set(ct, 12);
    return saida;
  }

  const lerTexto = async (k, campo) => new TextDecoder().decode(await decifrar(k, b64(campo)));

  async function abrirCom(k, dados = album) {
    const novo = JSON.parse(await lerTexto(k, dados.meta));
    let tk = null;
    if (dados.token) {
      try { tk = await lerTexto(k, dados.token); } catch { tk = null; }
    }
    chave = k;
    album = dados;
    meta = novo;
    token = tk;
  }

  function carregarFoto(nome) {
    if (!urls.has(nome)) {
      const p = fetch(`dados/f/${nome}.bin`)
        .then((r) => {
          if (r.ok) return r.arrayBuffer();
          // Foto recém-salva pelo site ainda não chegou no GitHub Pages: busca direto no repositório.
          if (token && REPO) return gh(`/contents/dados/f/${nome}.bin`, { cru: true }).then((x) => x.arrayBuffer());
          throw new Error(r.status);
        })
        .then((buf) => decifrar(chave, buf))
        .then((jpg) => URL.createObjectURL(new Blob([jpg], { type: "image/jpeg" })));
      p.catch(() => urls.delete(nome));
      urls.set(nome, p);
    }
    return urls.get(nome);
  }

  const guardar = {
    ler() { try { return JSON.parse(localStorage.getItem(CHAVE_SALVA)); } catch { return null; } },
    salvar(v) { try { localStorage.setItem(CHAVE_SALVA, JSON.stringify(v)); } catch {} },
    apagar() { try { localStorage.removeItem(CHAVE_SALVA); } catch {} },
  };

  // ───────────── datas ─────────────

  const dataLocal = (iso) => { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d); };
  const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
  const diaPorExtenso = (iso) => fmtDia.format(dataLocal(iso));
  const diasDesde = (iso) => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return Math.round((hoje - dataLocal(iso)) / 864e5);
  };
  const hojeISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // ───────────── tela da senha ─────────────

  async function iniciar() {
    criarCeu();
    if (!window.crypto?.subtle) return mostrarErro("Esse navegador não consegue abrir o álbum 🥺");

    try {
      const r = await fetch("dados/album.json", { cache: "no-cache" });
      if (!r.ok) throw new Error();
      album = await r.json();
    } catch {
      $("abrir").disabled = true;
      return mostrarErro("O álbum ainda está sendo preparado… 💜");
    }

    const salva = guardar.ler();
    if (salva?.sal === album.sal) {
      try {
        const k = await crypto.subtle.importKey("raw", b64(salva.k), "AES-GCM", true, ["encrypt", "decrypt"]);
        await abrirCom(k);
        return entrar(false);
      } catch {
        guardar.apagar();
      }
    }
    $("senha").focus();
  }

  function mostrarErro(msg) {
    $("erro").textContent = msg;
  }

  $("form-senha").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const senha = $("senha").value;
    if (!normalizar(senha) || !album) return;
    const botao = $("abrir");
    botao.disabled = true;
    botao.textContent = "abrindo…";
    mostrarErro("");
    try {
      const k = await derivar(senha);
      await abrirCom(k);
      if ($("lembrar").checked) {
        guardar.salvar({ sal: album.sal, k: paraB64(await crypto.subtle.exportKey("raw", k)) });
      }
      $("form-senha").classList.add("abrindo");
      setTimeout(() => entrar(true), 650);
    } catch {
      botao.disabled = false;
      botao.textContent = "Abrir 💌";
      mostrarErro("Hmm, não é essa… tenta de novo 🥺");
      const carta = $("form-senha");
      carta.classList.remove("tremer");
      void carta.offsetWidth;
      carta.classList.add("tremer");
      $("senha").select();
    }
  });

  $("ver-senha").addEventListener("click", () => {
    const campo = $("senha");
    campo.type = campo.type === "password" ? "text" : "password";
    campo.focus();
  });

  $("trancar").addEventListener("click", () => {
    guardar.apagar();
    location.reload();
  });

  // ───────────── álbum ─────────────

  function entrar(comFesta) {
    $("cadeado").hidden = true;
    $("album").hidden = false;
    montarTela();
    if (comFesta) chuvaDeCoracoes();
    atualizarDoRepositorio();
  }

  // O GitHub Pages pode demorar alguns minutos pra mostrar o que foi salvo pelo site;
  // quem pode editar já busca a versão mais nova direto no repositório.
  async function atualizarDoRepositorio() {
    if (!token || !REPO) return;
    try {
      const fresco = JSON.parse(await (await gh("/contents/dados/album.json?ref=main", { cru: true })).text());
      if (fresco.meta !== album.meta || fresco.token !== album.token) {
        await abrirCom(chave, fresco);
        montarTela();
      }
    } catch (e) {
      if (e.codigo === "chave") avisar("A chave de edição expirou ou foi apagada. Dá pra colocar outra em ✏️ lá embaixo.", true);
    }
  }

  function montarTela() {
    const cfg = meta.config || {};
    document.title = `${cfg.titulo || "Nossa história"} 💜`;
    $("titulo").textContent = cfg.titulo || "Nossa história";
    $("casal").textContent = cfg.casal || "";

    const cont = $("contadores");
    cont.replaceChildren();
    const contador = (n, antes, depois) => {
      const c = el("div", "contador");
      c.append(antes, el("b", null, ` ${n} `), depois);
      cont.append(c);
    };
    if (cfg["namoro-desde"]) {
      const d = diasDesde(cfg["namoro-desde"]);
      if (d === 0) cont.append(el("div", "contador", "💜 começamos hoje!"));
      else if (d > 0) contador(d, "💜 juntos há", d === 1 ? "dia" : "dias");
    }
    if (cfg["conhecemos-em"]) {
      const d = diasDesde(cfg["conhecemos-em"]);
      if (d > 0) contador(d, "✨ nos conhecemos há", d === 1 ? "dia" : "dias");
    }
    const totalFotos = meta.memorias.reduce((s, m) => s + m.fotos.length, 0);
    if (meta.memorias.length) {
      contador(meta.memorias.length, "📸", `${meta.memorias.length === 1 ? "memória" : "memórias"} · ${totalFotos} ${totalFotos === 1 ? "foto" : "fotos"}`);
    }

    const podeEditar = Boolean(token && REPO);
    $("nova").hidden = !podeEditar;
    $("ativar-edicao").hidden = !REPO;
    $("ativar-edicao").textContent = podeEditar ? "🔑 trocar chave de edição" : "✏️ ativar edição";

    if (filtro !== "todos" && !meta.memorias.some((m) => m.tipo === filtro)) filtro = "todos";
    criarFiltros();
    desenhar();
  }

  function criarFiltros() {
    const nav = $("filtros");
    nav.replaceChildren();
    const presentes = Object.keys(TIPOS).filter((t) => meta.memorias.some((m) => m.tipo === t));
    if (presentes.length < 2) return;
    const botao = (valor, texto) => {
      const b = el("button", "filtro", texto);
      b.setAttribute("aria-pressed", String(filtro === valor));
      b.addEventListener("click", () => {
        filtro = valor;
        nav.querySelectorAll(".filtro").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        desenhar();
      });
      nav.append(b);
    };
    botao("todos", "Todas");
    presentes.forEach((t) => botao(t, `${TIPOS[t].icone} ${TIPOS[t].plural}`));
  }

  const observadorFoto = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      observadorFoto.unobserve(e.target);
      const img = e.target;
      carregarFoto(img.dataset.nome).then((url) => {
        img.onload = () => { img.classList.add("ok"); img.parentElement.classList.remove("carregando"); };
        img.src = url;
      }).catch(() => img.parentElement.classList.remove("carregando"));
    }
  }, { rootMargin: "400px 0px" });

  const observadorCartao = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting) { e.target.classList.add("visivel"); observadorCartao.unobserve(e.target); }
    }
  }, { threshold: 0.12 });

  function polaroid(foto, indice, proporcao, giro) {
    const b = el("button", "polaroid");
    b.type = "button";
    b.setAttribute("aria-label", "Ver foto");
    if (giro != null) b.style.setProperty("--giro", `${giro}deg`);
    const q = el("div", "quadro carregando");
    if (proporcao) q.style.aspectRatio = proporcao;
    const img = el("img");
    img.alt = "";
    img.dataset.nome = foto.m;
    q.append(img);
    b.append(q);
    b.addEventListener("click", () => abrirVisor(indice, false));
    observadorFoto.observe(img);
    return b;
  }

  function desenhar() {
    const linha = $("linha");
    linha.replaceChildren();
    fotosVisiveis = [];
    const lista = meta.memorias.filter((m) => filtro === "todos" || m.tipo === filtro);
    $("viajar").hidden = !lista.some((m) => m.fotos.length);

    if (!lista.length) {
      const v = el("div", "vazio");
      const c = el("div", "cartao");
      c.append(el("h3", null, "Nossa história começa aqui…"), el("p", null, "A primeira página ainda está em branco. Logo, logo ela vai ficar cheia de nós dois 💜"));
      v.append(c);
      linha.append(v);
      return;
    }

    let mesAtual = "";
    lista.forEach((m, i) => {
      const mes = m.data.slice(0, 7);
      if (mes !== mesAtual) {
        mesAtual = mes;
        const cab = el("div", "mes");
        cab.append(el("span", null, fmtMes.format(dataLocal(m.data))));
        linha.append(cab);
      }

      const item = el("div", `item ${i % 2 ? "dir" : "esq"}`);
      const tipo = TIPOS[m.tipo] || TIPOS.momento;
      item.append(el("div", "no", tipo.icone));
      const cartao = el("article", "cartao");

      if (token && REPO) {
        const editar = el("button", "editar", "✏️");
        editar.type = "button";
        editar.setAttribute("aria-label", `Editar "${m.titulo}"`);
        editar.addEventListener("click", () => abrirEditor(m));
        cartao.append(editar);
      }

      if (m.fotos.length) {
        const fotos = el("div", "fotos");
        const inicio = fotosVisiveis.length;
        m.fotos.forEach((f) => fotosVisiveis.push({ mem: m, foto: f }));
        const [capa, ...resto] = m.fotos;
        const prop = String(Math.max(capa.w / capa.h, 0.8)); // retrato muito alto vira 4:5
        fotos.append(polaroid(capa, inicio, prop, i % 2 ? 1.6 : -1.6));
        if (resto.length) {
          const mini = el("div", "mini");
          resto.slice(0, 4).forEach((f, j) => {
            const p = polaroid(f, inicio + 1 + j, null, null);
            if (j === 3 && resto.length > 4) p.querySelector(".quadro").append(el("span", "mais", `+${resto.length - 3}`));
            mini.append(p);
          });
          fotos.append(mini);
        }
        cartao.append(fotos);
      }

      const topo = el("div");
      topo.append(el("span", "data", diaPorExtenso(m.data)), el("span", "tipo", tipo.nome));
      cartao.append(topo, el("h3", null, m.titulo));
      if (m.texto) cartao.append(el("p", null, m.texto));
      if (m.lugar) cartao.append(el("p", "lugar", `📍 ${m.lugar}`));

      item.append(cartao);
      linha.append(item);
      observadorCartao.observe(cartao);
    });
  }

  // ───────────── visor ─────────────

  let atual = 0;
  let tocando = false;
  let timer = null;
  let memAnterior = null;
  let toqueX = null;
  let pedido = 0;

  function abrirVisor(i, auto) {
    if (!fotosVisiveis.length) return;
    $("visor").hidden = false;
    document.body.style.overflow = "hidden";
    memAnterior = null;
    tocando = auto;
    mostrar(i);
  }

  function fecharVisor() {
    pararTimer();
    tocando = false;
    $("visor").hidden = true;
    document.body.style.overflow = "";
  }

  function pararTimer() {
    clearTimeout(timer);
    const barra = $("visor-progresso");
    barra.style.transition = "none";
    barra.style.width = "0";
  }

  function atualizarPlay() {
    $("visor-play").textContent = tocando ? "❚❚ pausar" : "▶ passar sozinho";
  }

  function mostrarCapitulo(texto) {
    const cap = $("visor-capitulo");
    cap.textContent = texto;
    cap.classList.remove("mostrar");
    void cap.offsetWidth;
    cap.classList.add("mostrar");
  }

  async function mostrar(i) {
    pararTimer();
    atual = (i + fotosVisiveis.length) % fotosVisiveis.length;
    const { mem, foto } = fotosVisiveis[atual];
    const meu = ++pedido;
    const quadro = document.querySelector(".visor-polaroid");
    quadro.classList.add("trocando");
    atualizarPlay();

    const novoCapitulo = tocando && mem !== memAnterior;
    if (novoCapitulo) mostrarCapitulo(diaPorExtenso(mem.data));
    memAnterior = mem;

    let url;
    try { url = await carregarFoto(foto.g); } catch { url = null; }
    if (meu !== pedido) return;
    const img = $("visor-img");
    if (url) {
      img.src = url;
      await img.decode().catch(() => {});
    }
    if (meu !== pedido) return;
    $("visor-titulo").textContent = mem.titulo;
    $("visor-data").textContent = diaPorExtenso(mem.data);
    $("visor-contagem").textContent = `${atual + 1} de ${fotosVisiveis.length}`;
    setTimeout(() => quadro.classList.remove("trocando"), novoCapitulo ? 900 : 0);

    const prox = fotosVisiveis[(atual + 1) % fotosVisiveis.length];
    carregarFoto(prox.foto.g).catch(() => {});

    if (tocando) {
      const dur = TEMPO_SLIDE + (novoCapitulo ? 1200 : 0);
      const barra = $("visor-progresso");
      void barra.offsetWidth;
      barra.style.transition = `width ${dur}ms linear`;
      barra.style.width = "100%";
      timer = setTimeout(() => {
        if (atual === fotosVisiveis.length - 1) {
          tocando = false;
          atualizarPlay();
          pararTimer();
          mostrarCapitulo("…e a história continua 💜");
        } else {
          mostrar(atual + 1);
        }
      }, dur);
    }
  }

  $("viajar").addEventListener("click", () => abrirVisor(0, true));
  $("visor-fechar").addEventListener("click", fecharVisor);
  $("visor-ant").addEventListener("click", () => mostrar(atual - 1));
  $("visor-prox").addEventListener("click", () => mostrar(atual + 1));
  $("visor-play").addEventListener("click", () => {
    tocando = !tocando;
    if (tocando) { memAnterior = fotosVisiveis[atual].mem; mostrar(atual === fotosVisiveis.length - 1 ? 0 : atual + 1); }
    else { pararTimer(); atualizarPlay(); }
  });
  $("visor").addEventListener("click", (e) => { if (e.target.id === "visor" || e.target.classList.contains("visor-foto")) fecharVisor(); });
  $("visor").addEventListener("pointerdown", (e) => { toqueX = e.clientX; });
  $("visor").addEventListener("pointerup", (e) => {
    if (toqueX == null) return;
    const dx = e.clientX - toqueX;
    toqueX = null;
    if (Math.abs(dx) > 50) mostrar(atual + (dx < 0 ? 1 : -1));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("editor").hidden) return fecharModal("editor");
      if (!$("config").hidden) return fecharModal("config");
    }
    if ($("visor").hidden) return;
    if (e.key === "Escape") fecharVisor();
    else if (e.key === "ArrowRight") mostrar(atual + 1);
    else if (e.key === "ArrowLeft") mostrar(atual - 1);
    else if (e.key === " ") { e.preventDefault(); $("visor-play").click(); }
  });

  // ───────────── GitHub (salvar pelo site) ─────────────

  async function gh(caminho, { cru = false, metodo = "GET", corpo, chaveTeste } = {}) {
    const r = await fetch(`https://api.github.com/repos/${REPO}${caminho}`, {
      method: metodo,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${chaveTeste || token}`,
        Accept: cru ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("chave"), { codigo: "chave" });
    if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}`), { codigo: r.status });
    return cru ? r : r.json();
  }

  // Grava um commit no repositório. `aplicar` recebe o album.json mais novo e devolve
  // { album, apagar }, assim duas pessoas editando ao mesmo tempo não se atropelam.
  async function commitar(mensagem, novosArquivos, aplicar, chaveTeste) {
    const opts = { chaveTeste };
    const blobs = [];
    for (const [i, arq] of novosArquivos.entries()) {
      progresso(`enviando fotos… ${Math.round((i / novosArquivos.length) * 100)}%`);
      const b = await gh("/git/blobs", { ...opts, metodo: "POST", corpo: { content: paraB64(arq.bytes), encoding: "base64" } });
      blobs.push({ path: arq.caminho, mode: "100644", type: "blob", sha: b.sha });
    }
    progresso("salvando…");

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const ref = await gh("/git/ref/heads/main", opts);
      const base = await gh(`/git/commits/${ref.object.sha}`, opts);
      const atualRemoto = JSON.parse(await (await gh(`/contents/dados/album.json?ref=${ref.object.sha}`, { ...opts, cru: true })).text());
      const { album: novo, apagar } = await aplicar(atualRemoto);
      const texto = JSON.stringify(novo, null, 1);
      const blobAlbum = await gh("/git/blobs", { ...opts, metodo: "POST", corpo: { content: texto, encoding: "utf-8" } });
      const arvore = await gh("/git/trees", {
        ...opts,
        metodo: "POST",
        corpo: {
          base_tree: base.tree.sha,
          tree: [
            ...blobs,
            { path: "dados/album.json", mode: "100644", type: "blob", sha: blobAlbum.sha },
            ...apagar.map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
          ],
        },
      });
      const commit = await gh("/git/commits", { ...opts, metodo: "POST", corpo: { message: mensagem, tree: arvore.sha, parents: [ref.object.sha] } });
      try {
        await gh("/git/refs/heads/main", { ...opts, metodo: "PATCH", corpo: { sha: commit.sha } });
        return novo;
      } catch (e) {
        if (e.codigo !== 422) throw e; // 422: alguém salvou antes; tenta de novo por cima
      }
    }
    throw new Error("conflito");
  }

  async function salvarMeta(mensagem, novosArquivos, mexer) {
    const novo = await commitar(mensagem, novosArquivos, async (remoto) => {
      const metaRemota = JSON.parse(await lerTexto(chave, remoto.meta));
      const apagar = mexer(metaRemota);
      metaRemota.memorias.sort((a, b) => a.data.localeCompare(b.data));
      const meta64 = paraB64(await cifrar(new TextEncoder().encode(JSON.stringify(metaRemota))));
      return { album: { ...remoto, meta: meta64 }, apagar };
    });
    await abrirCom(chave, novo);
    montarTela();
  }

  const caminhosDaFoto = (f) => [`dados/f/${f.m}.bin`, `dados/f/${f.g}.bin`];

  // ───────────── editor de memórias ─────────────

  let rascunho = null; // { id, fotos: [{ foto } | { nova }] }
  let salvando = false;

  function abrirModal(id) {
    $(id).hidden = false;
    document.body.style.overflow = "hidden";
  }

  function fecharModal(id) {
    if (salvando) return;
    $(id).hidden = true;
    document.body.style.overflow = "";
  }

  function progresso(texto, erro = false, alvo = $("editor").hidden ? $("cfg-status") : $("ed-status")) {
    alvo.textContent = texto;
    alvo.classList.toggle("ruim", erro);
  }

  function avisar(texto, ruim = false) {
    const a = $("aviso");
    a.textContent = texto;
    a.classList.toggle("ruim", ruim);
    a.hidden = false;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => { a.hidden = true; }, ruim ? 7000 : 4000);
  }

  const seletorTipo = $("ed-tipo");
  for (const [valor, t] of Object.entries(TIPOS)) {
    const o = el("option", null, `${t.icone} ${t.nome}`);
    o.value = valor;
    seletorTipo.append(o);
  }

  function abrirEditor(mem) {
    rascunho = { id: mem?.id ?? null, fotos: (mem?.fotos || []).map((foto) => ({ foto })) };
    $("editor-titulo").textContent = mem ? "Editar memória" : "Nova memória";
    $("ed-data").value = mem?.data || hojeISO();
    $("ed-tipo").value = mem?.tipo || "encontro";
    $("ed-titulo").value = mem?.titulo || "";
    $("ed-texto").value = mem?.texto || "";
    $("ed-lugar").value = mem?.lugar || "";
    $("ed-apagar").hidden = !mem;
    $("ed-apagar").textContent = "apagar memória";
    delete $("ed-apagar").dataset.certeza;
    progresso("", false, $("ed-status"));
    desenharFotosEditor();
    abrirModal("editor");
    if (!mem) $("ed-titulo").focus();
  }

  function desenharFotosEditor() {
    const grade = $("ed-fotos");
    grade.replaceChildren();
    rascunho.fotos.forEach((item, i) => {
      const tile = el("div", "ed-foto" + (i === 0 ? " capa" : ""));
      const img = el("img");
      img.alt = "";
      if (item.nova) img.src = item.nova.previa;
      else carregarFoto(item.foto.m).then((u) => { img.src = u; }).catch(() => {});
      tile.append(img);
      if (i === 0) tile.append(el("span", "selo-capa", "capa"));
      else {
        const capa = el("button", "ed-btn ed-capa", "★");
        capa.type = "button";
        capa.title = "Usar como capa";
        capa.setAttribute("aria-label", "Usar como capa");
        capa.addEventListener("click", () => { rascunho.fotos.unshift(...rascunho.fotos.splice(i, 1)); desenharFotosEditor(); });
        tile.append(capa);
      }
      const tirar = el("button", "ed-btn ed-tirar", "✕");
      tirar.type = "button";
      tirar.setAttribute("aria-label", "Tirar foto");
      tirar.addEventListener("click", () => { rascunho.fotos.splice(i, 1); desenharFotosEditor(); });
      tile.append(tirar);
      grade.append(tile);
    });
    const add = el("label", "ed-add");
    add.append(el("span", null, "＋"), el("small", null, "fotos"));
    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.addEventListener("change", () => adicionarFotos([...input.files]));
    add.append(input);
    grade.append(add);
  }

  async function prepararFoto(arquivo) {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const saida = { w: bmp.width, h: bmp.height };
    for (const [t, [lado, qualidade]] of Object.entries(TAMANHOS)) {
      const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const tela = document.createElement("canvas");
      tela.width = Math.round(bmp.width * escala);
      tela.height = Math.round(bmp.height * escala);
      tela.getContext("2d").drawImage(bmp, 0, 0, tela.width, tela.height);
      // Recriar a imagem no canvas já tira GPS e outros dados escondidos da foto.
      saida[t] = await new Promise((ok, falha) => tela.toBlob((b) => (b ? ok(b) : falha(new Error("jpeg"))), "image/jpeg", qualidade));
    }
    bmp.close?.();
    saida.previa = URL.createObjectURL(saida.m);
    return saida;
  }

  async function adicionarFotos(arquivos) {
    if (!arquivos.length) return;
    let falhas = 0;
    for (const [i, arq] of arquivos.entries()) {
      progresso(`preparando foto ${i + 1} de ${arquivos.length}…`);
      try {
        rascunho.fotos.push({ nova: await prepararFoto(arq) });
        desenharFotosEditor();
      } catch {
        falhas++;
      }
    }
    progresso(falhas ? `${falhas} foto(s) não deram certo. Tenta mandar em JPG 🥺` : "", Boolean(falhas));
  }

  function travarEditor(sim) {
    salvando = sim;
    $("form-editor").querySelectorAll("input, select, textarea, button").forEach((x) => { x.disabled = sim; });
  }

  function erroAoSalvar(e) {
    if (e.codigo === "chave") return "A chave de edição não funcionou (expirou ou foi apagada). Coloque outra em ✏️ lá embaixo.";
    if (e.message === "conflito") return "Alguém salvou ao mesmo tempo. Tenta de novo 💜";
    return "Não deu pra salvar. Confere a internet e tenta de novo 🥺";
  }

  $("form-editor").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (salvando) return;
    const dados = {
      data: $("ed-data").value,
      tipo: $("ed-tipo").value,
      titulo: $("ed-titulo").value.trim(),
      texto: $("ed-texto").value.trim(),
      lugar: $("ed-lugar").value.trim(),
    };
    if (!dados.data || !dados.titulo) return progresso("Coloca pelo menos a data e o título 💜", true);

    travarEditor(true);
    try {
      progresso("protegendo as fotos…");
      const arquivos = [];
      const fotos = [];
      for (const item of rascunho.fotos) {
        if (item.foto) { fotos.push(item.foto); continue; }
        const f = { m: hexAleatorio(12), g: hexAleatorio(12), w: item.nova.w, h: item.nova.h };
        for (const t of ["m", "g"]) {
          arquivos.push({ caminho: `dados/f/${f[t]}.bin`, bytes: await cifrar(new Uint8Array(await item.nova[t].arrayBuffer())) });
          urls.set(f[t], Promise.resolve(URL.createObjectURL(item.nova[t])));
        }
        fotos.push(f);
      }

      const id = rascunho.id ?? `m${hexAleatorio(6)}`;
      const memoria = { id, ...dados, fotos };
      await salvarMeta(`${rascunho.id == null ? "Nova memória" : "Edita"}: ${dados.titulo}`, arquivos, (m) => {
        const i = m.memorias.findIndex((x) => x.id === id);
        const antigas = i >= 0 ? m.memorias[i].fotos : [];
        if (i >= 0) m.memorias[i] = memoria; else m.memorias.push(memoria);
        const ficam = new Set(fotos.map((f) => f.g));
        return antigas.filter((f) => !ficam.has(f.g)).flatMap(caminhosDaFoto);
      });
      travarEditor(false);
      fecharModal("editor");
      avisar("Salvo! 💜 Em uns minutinhos aparece em todos os celulares.");
    } catch (e) {
      travarEditor(false);
      progresso(erroAoSalvar(e), true);
    }
  });

  $("ed-apagar").addEventListener("click", async () => {
    const botao = $("ed-apagar");
    if (!botao.dataset.certeza) {
      botao.dataset.certeza = "1";
      botao.textContent = "toca de novo pra apagar de vez";
      return;
    }
    const id = rascunho.id;
    travarEditor(true);
    try {
      await salvarMeta(`Apaga: ${$("ed-titulo").value.trim()}`, [], (m) => {
        const i = m.memorias.findIndex((x) => x.id === id);
        if (i < 0) return [];
        const [tirada] = m.memorias.splice(i, 1);
        return tirada.fotos.flatMap(caminhosDaFoto);
      });
      travarEditor(false);
      fecharModal("editor");
      avisar("Memória apagada.");
    } catch (e) {
      travarEditor(false);
      progresso(erroAoSalvar(e), true);
    }
  });

  $("ed-cancelar").addEventListener("click", () => fecharModal("editor"));
  $("nova").addEventListener("click", () => abrirEditor(null));

  // ───────────── chave de edição ─────────────

  $("ativar-edicao").addEventListener("click", () => {
    $("cfg-token").value = "";
    progresso("", false, $("cfg-status"));
    abrirModal("config");
    $("cfg-token").focus();
  });
  $("cfg-cancelar").addEventListener("click", () => fecharModal("config"));

  $("form-config").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nova = $("cfg-token").value.trim();
    if (!nova || salvando) return;
    salvando = true;
    $("cfg-salvar").disabled = true;
    progresso("testando a chave…");
    try {
      const token64 = paraB64(await cifrar(new TextEncoder().encode(nova)));
      // Salvar a própria chave já é o teste: só funciona se ela puder escrever no repositório.
      const novo = await commitar("Ativa edição pelo site", [], async (remoto) => ({ album: { ...remoto, token: token64 }, apagar: [] }), nova);
      await abrirCom(chave, novo);
      salvando = false;
      fecharModal("config");
      montarTela();
      avisar("Edição ativada! ✏️ Agora vocês dois podem editar.");
    } catch (e) {
      salvando = false;
      progresso(e.codigo === "chave" || e.codigo === 404
        ? "Essa chave não tem permissão no álbum. Confere se escolheu o repositório nosso-album e Contents: Read and write."
        : "Não deu certo. Confere a internet e tenta de novo 🥺", true);
    } finally {
      $("cfg-salvar").disabled = false;
    }
  });

  // ───────────── enfeites ─────────────

  function criarCeu() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ceu = document.querySelector(".ceu");
    const simbolos = ["✦", "♡", "⋆", "✧", "♡", "·"];
    for (let i = 0; i < 22; i++) {
      const s = el("i", null, simbolos[i % simbolos.length]);
      const dur = 22 + Math.random() * 26;
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${100 + Math.random() * 10}%`;
      s.style.fontSize = `${10 + Math.random() * 16}px`;
      s.style.animationDuration = `${dur}s`;
      s.style.animationDelay = `${-Math.random() * dur}s`;
      ceu.append(s);
    }
  }

  function chuvaDeCoracoes() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const chuva = el("div", "chuva");
    const cores = ["💜", "💗", "🤍", "💜", "✨"];
    for (let i = 0; i < 36; i++) {
      const c = el("i", null, cores[i % cores.length]);
      c.style.left = `${Math.random() * 100}%`;
      c.style.fontSize = `${16 + Math.random() * 22}px`;
      c.style.animationDelay = `${Math.random() * 0.9}s`;
      c.style.setProperty("--r", `${(Math.random() - 0.5) * 120}deg`);
      chuva.append(c);
    }
    document.body.append(chuva);
    setTimeout(() => chuva.remove(), 4000);
  }

  iniciar();
})();
