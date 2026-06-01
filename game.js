/* ===========================================================================
   MANSÃO FIGHT — jogo de luta 1v1 estilo Mortal Kombat (Fase 3: "game feel")
   JavaScript vanilla, sem frameworks/servidor/build. Abra o index.html.

   Visão geral da arquitetura (mantida da Fase 2, evoluída sem reescrever):
     - Carregador (carregarManifest + Recursos): lê assets/manifest.json e
       pré-carrega TODAS as imagens via Promise.
     - Animator: avança quadros pelo fps do manifest, respeitando loop.
     - Entrada: teclado -> teclas mantidas + ações de borda.
     - Controle (NOVO): camada que abstrai "quem comanda" um lutador. Pode ser
       teclado (humano) ou IA. O Fighter passou a ler comandos do Controle, o
       que desacopla o SLOT (p1/p2 = teclas) do PERSONAGEM (p1/p2 = sprites).
     - Particulas / AudioFX (NOVOS): juice visual e sonoro.
     - Fighter: estado, física, vida, animação, hitbox/hurtbox, combos, especial.
     - Projetil: bola de energia (agora com rastro e variante "super").
     - Jogo: telas (START/MODO/SELECT/LUTA/VITORIA), rounds, timer, HUD,
       hit stop, screen shake e o game loop com requestAnimationFrame + dt.

   IMPORTANTE: as animações NÃO são fixadas no código — vêm do manifest. O
   código apenas decide QUAL animação usar em cada estado.

   >>> AJUSTE DE BALANCEAMENTO: tudo que afeta o "feel"/dificuldade está no
       objeto CONFIG logo abaixo. Mexa só ali. <<<
   =========================================================================== */

"use strict";

/* ===========================================================================
   0) CONFIG — TODOS os números de balanceamento num só lugar (comentado).
   Mexa aqui para sentir o jogo diferente sem caçar valores pelo código.
   =========================================================================== */

const CONFIG = {
  // --- Arena / física do mundo ---------------------------------------------
  arena: {
    largura: 960, // largura lógica do canvas/tela (px) — o que cabe na visão
    altura: 540, // altura lógica do canvas (px)
    // Largura TOTAL do mundo (px). Maior que a tela => a câmera desliza e
    // revela a parte esquerda/direita da arena conforme a luta se move.
    // Use múltiplos da tela (960*2=1920). O asset do mapa deve ter ESTA largura.
    larguraMundo: 1920,
    chaoY: 486, // linha do chão (pés do lutador)
    gravidade: 2200, // px/s²
  },

  // --- Movimentação dos lutadores ------------------------------------------
  movimento: {
    velAndar: 200, // px/s ao recuar (anda)
    velCorrer: 290, // px/s ao avançar contra o oponente (corre)
    forcaPulo: 820, // velocidade inicial do pulo (px/s)
    // Velocidade horizontal no ar (tecla pressionada). Levemente menor que
    // correr para que o crossover exija intenção, mas seja responsivo.
    velPuloLateral: 260,
    escala: 1.0, // escala de desenho do sprite (256px de altura)
    // Crossover jump: pés do saltador devem estar ao menos N px acima dos pés do
    // oponente para a separação de corpo ser desativada e a travessia ser permitida.
    alturaMinCrossover: 85,
  },

  // --- Regras de luta -------------------------------------------------------
  luta: {
    vidaMax: 100,
    tempoRound: 60, // segundos por round
    roundsParaVencer: 2, // melhor de 3
  },

  /* --- FRAME DATA dos golpes ------------------------------------------------
     Para CADA golpe (em "frames" a 60fps de referência):
       startup  = quadros até o golpe ficar ativo (causar dano)
       ativo    = quadros em que o golpe causa dano
       recovery = quadros de recuperação após o ativo
     Mais: dano, knockback (empurrão em px/s), derruba (knockdown),
     alcance [min,max] e altura [topo,base] da hitbox (offsets dos pés),
     cancelavel (se pode ser cancelado em combo ao ACERTAR).

     OBS: quando o sprite tem "framesAtivos" no manifest, ele manda no timing
     real do dano; senão o engine cai para o startup/ativo daqui (ver
     Fighter._golpeAtivo). Assim o frame data sempre tem efeito. */
  golpes: {
    punch: {
      startup: 4,
      ativo: 3,
      recovery: 8,
      dano: 6,
      knockback: 130,
      derruba: false,
      alcance: [18, 112],
      altura: [-178, -120],
      cancelavel: true,
      tipo_altura: "alto", // soco na altura da cabeça/tronco
    },
    punch_step: {
      startup: 5,
      ativo: 3,
      recovery: 10,
      dano: 7,
      knockback: 150,
      derruba: false,
      alcance: [18, 124],
      altura: [-178, -120],
      cancelavel: true,
      tipo_altura: "alto",
    },
    kick: {
      startup: 7,
      ativo: 4,
      recovery: 14,
      dano: 11,
      knockback: 230,
      derruba: true,
      alcance: [20, 140],
      altura: [-150, -92],
      cancelavel: false,
      tipo_altura: "medio", // chute em pé na altura do tronco
    },
    // CHUTE BAIXO (rasteira agachada): hitbox rente às pernas/pés. Só é
    // defendido com DEFESA_BAIXA (agachado + defender). Em pé, o bloqueio falha.
    kick_mid: {
      startup: 6,
      ativo: 3,
      recovery: 12,
      dano: 9,
      knockback: 200,
      derruba: true,
      alcance: [20, 132],
      altura: [-64, 0], // rente ao chão (pernas/pés)
      cancelavel: false,
      tipo_altura: "baixo",
    },
    kick_jump: {
      startup: 4,
      ativo: 6,
      recovery: 8,
      dano: 12,
      knockback: 250,
      derruba: true,
      alcance: [10, 122],
      altura: [-185, -90],
      cancelavel: false,
      tipo_altura: "alto", // chute aéreo (vem de cima)
    },
    // Agarrão (usa a pose "item"): ignora defesa, derruba, curto alcance.
    agarra: {
      startup: 3,
      ativo: 3,
      recovery: 18,
      dano: 14,
      knockback: 300,
      derruba: true,
      alcance: [8, 78],
      altura: [-180, -60],
      cancelavel: false,
      ignoraBloqueio: true,
      tipo_altura: "medio", // irrelevante (ignora bloqueio), mas documentado
    },
  },

  // --- Projéteis ------------------------------------------------------------
  projeteis: {
    fireball: { dano: 9, vel: 430, cor: "#5cd6ff", raio: 18 },
    special: { dano: 14, vel: 500, cor: "#ff7a3c", raio: 20 }, // p2 agachado
    super: { dano: 22, vel: 560, cor: "#ffe24d", raio: 30 }, // golpe de barra cheia
  },

  // --- Barra de especial ----------------------------------------------------
  especial: {
    max: 100,
    ganhoAoAcertar: 12, // enche ao acertar um golpe
    ganhoAoApanhar: 8, // enche ao levar dano
    custo: 100, // precisa estar cheia para usar o especial
  },

  // --- Combos / cancelamento ------------------------------------------------
  combo: {
    janelaCancelMs: 230, // janela (ms) após ACERTAR para cancelar em outro golpe
    maxCombo: 3, // nº máx. de golpes encadeados por cancelamento

    // --- Anti-combo-infinito --------------------------------------------------
    // Hits consecutivos antes do knockdown forçado (escape do defensor).
    hitMaxSequencia: 8,
    // Multiplicador de dano por posição no combo (índice = nº de hits recebidos).
    // Cada hit subsequente causa ~10-15% menos dano que o anterior.
    scalingDano: [1.0, 0.9, 0.8, 0.72, 0.65, 0.59, 0.53, 0.48],
    // Acréscimo fracional de knockback por hit acumulado no defensor.
    // No hit 0 = knockback normal; no hit 3 = knockback × 2,05; empurra para longe.
    pushbackPorHit: 0.35,
    // Milissegundos sem levar dano para zerar o contador de hits do defensor.
    comboResetMs: 1200,
  },

  // --- Game feel (juice) ----------------------------------------------------
  gameFeel: {
    hitStopMs: 60, // congela base no impacto
    hitStopPorDano: 4, // ms extras por ponto de dano
    hitStopMax: 170, // teto do hit stop
    hitStopKO: 340, // hit stop no golpe que dá KO
    shakeHit: 6, // intensidade do tremor no acerto
    shakeKO: 18, // intensidade do tremor no KO
    shakeProjetil: 4, // tremor ao projétil acertar
    flashMs: 130, // duração do flash branco em quem apanha
    knockbackEscala: 1.0, // multiplicador global de empurrão
    wakeupInvencivelMs: 650, // invencibilidade ao levantar (ms): ~0.25s getup + ~0.4s buffer
  },

  // --- Partículas -----------------------------------------------------------
  particulas: {
    faiscasAcerto: 14, // nº de faíscas no acerto corpo-a-corpo
    faiscasProjetil: 18, // nº de faíscas no acerto de projétil
    faiscasBloqueio: 8, // faíscas ao defender
    poeiraPulo: 8, // partículas de poeira ao pousar
    rastroProjetilMs: 18, // intervalo (ms) entre partículas do rastro
  },

  // --- Áudio (Web Audio API, sintetizado) -----------------------------------
  audio: {
    volumeMaster: 0.35, // 0..1 — volume dos efeitos sonoros
    volumeMusica: 0.5, // 0..1 — volume das músicas de fundo
    volumeUI: 0.7, // 0..1 — volume dos efeitos de interface (menus)
  },

  /* --- IA (3 dificuldades) -------------------------------------------------
     intervalo     = tempo médio (s) entre decisões (menor = reage mais)
     agressao      = chance de atacar quando está no alcance
     blockChance   = chance de defender quando o oponente ataca perto
     projChance    = chance de soltar projétil à distância
     alcanceAtaque = distância (px) considerada "no alcance" do corpo-a-corpo
     alcanceMedio  = distância (px) da zona média (projétil/aproximar)
     pulaProjetil  = chance de pular para desviar de projétil que se aproxima */
  ia: {
    facil: {
      intervalo: 0.55,
      agressao: 0.45,
      blockChance: 0.15,
      projChance: 0.12,
      alcanceAtaque: 120,
      alcanceMedio: 360,
      pulaProjetil: 0.15,
    },
    medio: {
      intervalo: 0.38,
      agressao: 0.68,
      blockChance: 0.35,
      projChance: 0.2,
      alcanceAtaque: 130,
      alcanceMedio: 380,
      pulaProjetil: 0.35,
    },
    dificil: {
      intervalo: 0.26,
      agressao: 0.88,
      blockChance: 0.58,
      projChance: 0.28,
      alcanceAtaque: 136,
      alcanceMedio: 420,
      pulaProjetil: 0.55,
    },
  },
};

/* --- Atalhos derivados do CONFIG (mantêm o resto do código legível) -------- */
const LARGURA = CONFIG.arena.largura; // largura da TELA (câmera/janela)
const MUNDO_L = CONFIG.arena.larguraMundo; // largura do MUNDO (arena inteira)
const ALTURA = CONFIG.arena.altura;
const CHAO_Y = CONFIG.arena.chaoY;
const GRAVIDADE = CONFIG.arena.gravidade;
const VEL_ANDAR = CONFIG.movimento.velAndar;
const VEL_CORRER = CONFIG.movimento.velCorrer;
const FORCA_PULO = CONFIG.movimento.forcaPulo;
const ESCALA = CONFIG.movimento.escala;
const VIDA_MAX = CONFIG.luta.vidaMax;
const TEMPO_ROUND = CONFIG.luta.tempoRound;
const ROUNDS_PARA_VENCER = CONFIG.luta.roundsParaVencer;
const GOLPES = CONFIG.golpes; // fallback/default; o manifest sobrepõe por personagem
const PROJETEIS = CONFIG.projeteis; // alias

/* FRAME DATA POR PERSONAGEM — fonte de balanceamento = manifest.json.
   Cada Fighter monta seu próprio conjunto de golpes a partir de
   manifest.players[<personagem>].golpes. O CONFIG.golpes acima é só o DEFAULT:
   se um golpe (ou um campo dele) faltar no manifest, cai para o default — assim
   o jogo nunca quebra por dado ausente. Edite dano/knockback/startup/etc. no
   manifest.json para balancear cada lutador separadamente. */
function montarGolpes(golpesManifest) {
  const fonte = golpesManifest || {};
  const out = {};
  const nomes = new Set([...Object.keys(GOLPES), ...Object.keys(fonte)]);
  for (const nome of nomes) {
    // Mescla campo a campo: manifest vence, default preenche o que faltar.
    out[nome] = { ...(GOLPES[nome] || {}), ...(fonte[nome] || {}) };
  }
  return out;
}

// Mapa de teclas por SLOT (usa event.code, independente de layout).
// Slot != personagem: o slot define as teclas; o personagem define o sprite.
const TECLAS = {
  p1: {
    esquerda: "KeyA",
    direita: "KeyD",
    pula: "KeyW",
    agacha: "KeyS",
    soco: "KeyF",
    chute: "KeyG",
    projetil: "KeyH",
    agarra: "KeyC",
    especial: "KeyV",
    defende: "KeyR",
    provoca: "KeyT",
  },
  p2: {
    esquerda: "ArrowLeft",
    direita: "ArrowRight",
    pula: "ArrowUp",
    agacha: "ArrowDown",
    soco: "KeyJ",
    chute: "KeyK",
    projetil: "KeyL",
    agarra: "KeyN",
    especial: "KeyM",
    defende: "KeyP",
    provoca: "KeyY",
  },
};

// Lista de personagens (chaves de sprite no manifest) para a seleção.
const PERSONAGENS = ["p1", "p2"];

// Estados possíveis da máquina de estados (um por vez).
const ESTADOS = {
  IDLE: "idle",
  WALK: "walk",
  JUMP: "jump",
  CROUCH: "crouch",
  PUNCH: "punch",
  KICK: "kick",
  FIREBALL: "fireball",
  BLOCK: "block",
  GRAB: "grab",
  SPECIAL: "special",
  HIT: "hit",
  KNOCKDOWN: "knockdown",
  GETUP: "getup",
  KO: "ko",
  VICTORY: "victory",
  TAUNT: "taunt",
};

// Estados "livres": a cada quadro são re-derivados a partir do input.
const ESTADOS_LIVRES = new Set([
  ESTADOS.IDLE,
  ESTADOS.WALK,
  ESTADOS.CROUCH,
  ESTADOS.BLOCK,
  ESTADOS.JUMP,
]);
// Estados de golpe (podem abrir janela de cancelamento ao acertar).
const ESTADOS_GOLPE = new Set([
  ESTADOS.PUNCH,
  ESTADOS.KICK,
  ESTADOS.GRAB,
  ESTADOS.SPECIAL,
  ESTADOS.FIREBALL,
]);

/* ===========================================================================
   1) CARREGADOR DE RECURSOS  (inalterado em relação à Fase 2)
   =========================================================================== */

async function carregarManifest() {
  try {
    const resp = await fetch("assets/manifest.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } catch (e) {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "assets/manifest.json", true);
      xhr.onload = () => {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("Falha ao ler manifest.json"));
      xhr.send();
    });
  }
}

function carregarImagem(caminho) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ img, ok: true });
    img.onerror = () => resolve({ img, ok: false });
    img.src = caminho;
  });
}

class Recursos {
  constructor(manifest) {
    this.manifest = manifest;
    this.frameW = manifest.frameSize ? manifest.frameSize[0] : 256;
    this.frameH = manifest.frameSize ? manifest.frameSize[1] : 256;
    this.dados = {};
    this.faltando = 0;
    // Retratos da tela de seleção (fotos reais), por personagem.
    this.retratos = {};
    // Imagem de fundo da arena (largura = MUNDO_L x altura = ALTURA).
    // Opcional: se não existir, o cenário procedural é usado como fallback.
    this.mapa = null;
  }

  async precarregar() {
    const tarefas = [];

    // Retratos para a seleção de personagem (não fazem parte do manifest).
    const fotos = { p1: "assets/silva.png", p2: "assets/vitor.png" };
    for (const pers of Object.keys(fotos)) {
      tarefas.push(
        carregarImagem(fotos[pers]).then((res) => {
          this.retratos[pers] = res.ok ? res.img : null;
        }),
      );
    }

    // Fundo da arena. O ARQUIVO vem do manifest ("mapa"); assim dá para trocar
    // de mapa só editando o JSON, sem mexer no código. Se o campo faltar, usa
    // "arena.png". Carregamento opcional: se o arquivo faltar, cai no procedural.
    const arquivoMapa = this.manifest.mapa || "arena.png";
    tarefas.push(
      carregarImagem(`assets/mapas/${arquivoMapa}`).then((res) => {
        this.mapa = res.ok ? res.img : null;
      }),
    );

    for (const player of Object.keys(this.manifest.players)) {
      this.dados[player] = {};
      const anims = this.manifest.players[player].animacoes;
      for (const nomeAnim of Object.keys(anims)) {
        const meta = anims[nomeAnim];
        const registro = { meta, frames: new Array(meta.frames) };
        this.dados[player][nomeAnim] = registro;
        for (let i = 0; i < meta.frames; i++) {
          const caminho = `assets/${player}/${nomeAnim}_${i}.png`;
          tarefas.push(
            carregarImagem(caminho).then((res) => {
              if (!res.ok) this.faltando++;
              registro.frames[i] = res;
            }),
          );
        }
      }
    }
    await Promise.all(tarefas);
  }

  nome(player) {
    const p = this.manifest.players[player];
    return p && p.nome ? p.nome : player.toUpperCase();
  }
  // Frame data dos golpes deste personagem (bloco "golpes" do manifest).
  // Pode vir vazio/parcial; montarGolpes() completa com os defaults do CONFIG.
  golpes(player) {
    const p = this.manifest.players[player];
    return (p && p.golpes) || {};
  }
  tem(player, anim) {
    return !!(this.dados[player] && this.dados[player][anim]);
  }
  meta(player, anim) {
    return this.tem(player, anim) ? this.dados[player][anim].meta : null;
  }
  frame(player, anim, indice) {
    if (!this.tem(player, anim)) return null;
    return this.dados[player][anim].frames[indice] || null;
  }
  // Retrato (foto) do personagem para a tela de seleção; null se ausente.
  retrato(player) {
    return this.retratos[player] || null;
  }
}

/* ===========================================================================
   1b) CATÁLOGO DE MAPAS — (1) MÓDULO DE DADOS de mapas
   Descobre os mapas em TEMPO DE EXECUÇÃO sem nomes hardcoded no código: tenta
   carregar assets/mapas/arena1.png, arena2.png, ... via Image.onload, parando
   após uma sequência de ausências. (Um navegador não consegue listar pastas
   offline, então a "varredura" é feita por tentativa de carregamento.)
   O manifest.json pode, OPCIONALMENTE, trazer um array "mapas" só para nomear
   bonito cada arquivo (id/nome) — mas a LISTA em si vem da varredura.

   Cada mapa expõe:  id, nome (exibição), arquivo, caminho (imagem completa),
   caminhos[] (camadas para parallax futuro), full (Image), caminhoThumb e
   thumb (miniatura em <canvas>, gerada da imagem cheia com letterbox).
   =========================================================================== */

// Gera uma MINIATURA (canvas) a partir da imagem cheia, preservando a proporção
// de aspecto com letterbox preto. Evita precisar de arquivos de thumb separados.
function gerarMiniatura(img, maxW, maxH) {
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = maxH;
  const cx = c.getContext("2d");
  cx.fillStyle = "#000";
  cx.fillRect(0, 0, maxW, maxH);
  if (img && img.width) {
    const escala = Math.min(maxW / img.width, maxH / img.height);
    const dw = img.width * escala;
    const dh = img.height * escala;
    cx.imageSmoothingEnabled = true; // downscale suave fica melhor na miniatura
    cx.drawImage(img, (maxW - dw) / 2, (maxH - dh) / 2, dw, dh);
  }
  return c;
}

class CatalogoMapas {
  constructor(manifest) {
    this.manifest = manifest;
    this.mapas = [];
  }

  async descobrir() {
    // Metadados opcionais por arquivo (nome de exibição), vindos do manifest.
    const meta = {};
    if (Array.isArray(this.manifest.mapas)) {
      for (const m of this.manifest.mapas)
        if (m && m.arquivo) meta[m.arquivo] = m;
    }

    const MAX_PROBE = 64; // teto de segurança da varredura
    const MAX_GAP = 2; // tolera buracos na numeração (ex.: arena1, arena3...)
    const achados = [];
    const vistos = new Set();
    let faltasSeguidas = 0;

    // (a) Varredura por padrão arena<N>.png — descoberta automática real.
    for (let i = 1; i <= MAX_PROBE && faltasSeguidas <= MAX_GAP; i++) {
      const arquivo = `arena${i}.png`;
      const caminho = `assets/mapas/${arquivo}`;
      const res = await carregarImagem(caminho);
      if (res.ok) {
        faltasSeguidas = 0;
        vistos.add(arquivo);
        achados.push(
          this._descritor(arquivo, caminho, res.img, meta[arquivo], achados.length + 1),
        );
      } else {
        faltasSeguidas++;
      }
    }

    // (b) Inclui mapas declarados no manifest que NÃO seguem o padrão arena<N>.
    if (Array.isArray(this.manifest.mapas)) {
      for (const m of this.manifest.mapas) {
        if (!m || !m.arquivo || vistos.has(m.arquivo)) continue;
        const caminho = `assets/mapas/${m.arquivo}`;
        const res = await carregarImagem(caminho);
        if (res.ok) {
          vistos.add(m.arquivo);
          achados.push(this._descritor(m.arquivo, caminho, res.img, m, achados.length + 1));
        }
      }
    }

    this.mapas = achados;
    return this.mapas;
  }

  _descritor(arquivo, caminho, img, meta, ordem) {
    meta = meta || {};
    const baseId = arquivo.replace(/\.[^.]+$/, "");
    return {
      id: meta.id || baseId,
      nome: String(meta.nome || `ARENA ${ordem}`).toUpperCase(),
      arquivo,
      caminho, // caminho da imagem COMPLETA
      caminhos: [caminho], // camadas extras (parallax) caberiam aqui no futuro
      full: img, // Image já carregada da imagem completa
      caminhoThumb: caminho, // a miniatura é gerada da imagem cheia
      thumb: gerarMiniatura(img, 320, 180), // <canvas> 16:9 com letterbox
    };
  }
}

/* ===========================================================================
   2) ANIMATOR  (inalterado)
   =========================================================================== */

class Animator {
  constructor(recursos, player) {
    this.recursos = recursos;
    this.player = player;
    this.anim = null;
    this.meta = null;
    this.frame = 0;
    this.timer = 0;
    this.terminou = false;
  }

  // Player aqui é o PERSONAGEM (sprite). Pode mudar (ver Fighter.personagem).
  definirPlayer(player) {
    this.player = player;
  }

  tocar(anim, forcar = false) {
    if (this.anim === anim && !forcar) return;
    this.anim = anim;
    this.meta = this.recursos.meta(this.player, anim);
    this.frame = 0;
    this.timer = 0;
    this.terminou = false;
  }

  atualizar(dt) {
    if (!this.meta) return;
    const total = this.meta.frames;
    if (total <= 1) {
      this.terminou = !this.meta.loop;
      return;
    }
    const duracaoQuadro = 1 / this.meta.fps;
    this.timer += dt;
    while (this.timer >= duracaoQuadro) {
      this.timer -= duracaoQuadro;
      this.frame++;
      if (this.frame >= total) {
        if (this.meta.loop) {
          this.frame = 0;
        } else {
          this.frame = total - 1;
          this.terminou = true;
        }
      }
    }
  }

  ehFrameAtivo() {
    return !!(
      this.meta &&
      this.meta.framesAtivos &&
      this.meta.framesAtivos.includes(this.frame)
    );
  }
}

/* ===========================================================================
   3) ENTRADA (INPUT)
   keydown/keyup mantêm teclas pressionadas; ações viram eventos de borda.
   NOVO: "bordas" guarda todos os códigos pressionados no quadro (para navegar
   menus), zeradas a cada frame pelo loop.
   =========================================================================== */

class Entrada {
  constructor() {
    this.pressionadas = new Set();
    this.pendentes = []; // ações de borda: {slot, acao}
    this.confirmar = false; // Enter/Espaço (avançar telas)
    this.voltar = false; // Esc (voltar telas)
    this.bordas = []; // todos os e.code pressionados neste quadro (menus)

    window.addEventListener("keydown", (e) => this._onDown(e));
    window.addEventListener("keyup", (e) => this._onUp(e));
  }

  _onDown(e) {
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        e.code,
      )
    ) {
      e.preventDefault();
    }
    if (e.code === "Enter" || e.code === "Space") this.confirmar = true;
    if (e.code === "Escape") this.voltar = true;
    if (e.repeat) return;

    this.pressionadas.add(e.code);
    this.bordas.push(e.code);

    // Converte tecla -> ação de borda, por SLOT.
    for (const slot of ["p1", "p2"]) {
      const mapa = TECLAS[slot];
      if (e.code === mapa.soco) this.pendentes.push({ slot, acao: "soco" });
      if (e.code === mapa.chute) this.pendentes.push({ slot, acao: "chute" });
      if (e.code === mapa.projetil)
        this.pendentes.push({ slot, acao: "projetil" });
      if (e.code === mapa.agarra) this.pendentes.push({ slot, acao: "agarra" });
      if (e.code === mapa.especial)
        this.pendentes.push({ slot, acao: "especial" });
      if (e.code === mapa.provoca)
        this.pendentes.push({ slot, acao: "provoca" });
    }
  }

  _onUp(e) {
    this.pressionadas.delete(e.code);
  }

  estaPressionada(code) {
    return this.pressionadas.has(code);
  }

  consumirAcoes(slot) {
    const minhas = this.pendentes.filter((a) => a.slot === slot);
    this.pendentes = this.pendentes.filter((a) => a.slot !== slot);
    return minhas.map((a) => a.acao);
  }

  limparPendentes() {
    this.pendentes.length = 0;
  }

  // Borda única (pressionou agora) para navegação de menus.
  borda(code) {
    return this.bordas.includes(code);
  }
}

/* ===========================================================================
   3b) GAMEPAD — leitura mínima por BORDA para navegação de menus.
   Sem dependências: usa a Gamepad API nativa. Converte "segurar" do D-pad/
   analógico e botões em eventos de borda (disparam uma vez por pressionada),
   ideal para mover o cursor da seleção de mapa sem repetição descontrolada.
   =========================================================================== */
class GamepadNav {
  constructor() {
    this.anterior = {}; // estado do quadro anterior (para detectar a borda)
  }

  // Retorna {left,right,up,down,confirm,back}; true apenas no quadro da BORDA.
  ler() {
    const atual = {
      left: false,
      right: false,
      up: false,
      down: false,
      confirm: false,
      back: false,
    };
    const pads =
      typeof navigator !== "undefined" && navigator.getGamepads
        ? navigator.getGamepads()
        : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const b = gp.buttons;
      const apert = (i) => b[i] && b[i].pressed;
      if (ax < -0.5 || apert(14)) atual.left = true; // analógico ← ou D-pad ←
      if (ax > 0.5 || apert(15)) atual.right = true;
      if (ay < -0.5 || apert(12)) atual.up = true;
      if (ay > 0.5 || apert(13)) atual.down = true;
      if (apert(0) || apert(9)) atual.confirm = true; // A / Start
      if (apert(1)) atual.back = true; // B
    }
    const out = {};
    for (const k of Object.keys(atual)) out[k] = atual[k] && !this.anterior[k];
    this.anterior = atual;
    return out;
  }
}

/* ===========================================================================
   4) CONTROLE — abstração de "quem comanda" um lutador
   O Fighter pergunta ao seu Controle: o que está segurando? quais ações?
   Há dois tipos: teclado (humano) e IA. Isso desacopla slot x personagem e
   habilita o modo 1 Player.
   =========================================================================== */

// 4.1) Controle por teclado: traduz o slot do jogador via TECLAS + Entrada.
class ControleTeclado {
  constructor(entrada, slot) {
    this.entrada = entrada;
    this.slot = slot;
    this.tipo = "humano";
  }
  atualizar() {
    /* nada: o teclado já é lido pela Entrada */
  }
  // Direções/defesa são lidas como "segurar".
  quer(nome) {
    const code = TECLAS[this.slot][nome];
    return code ? this.entrada.estaPressionada(code) : false;
  }
  // Ações de borda (soco, chute, projetil, agarra, especial, provoca).
  consumir() {
    return this.entrada.consumirAcoes(this.slot);
  }
}

/* 4.2) Controle por IA: observa o mundo e gera as MESMAS intenções que um
   humano (segurar direções/defesa + disparar ações). Estratégia simples mas
   convincente: aproximar, manter distância, atacar no alcance, defender. */
class ControleIA {
  constructor(dificuldade) {
    this.tipo = "ia";
    this.cfg = CONFIG.ia[dificuldade] || CONFIG.ia.medio;
    this.dificuldade = dificuldade;
    this.segura = new Set(); // direções/defesa "seguradas" neste frame
    this.fila = []; // ações de borda a emitir
    this.plano = "esperar"; // aproximar | recuar | defender | esperar
    this.t = 0; // contagem regressiva até a próxima decisão
  }

  // Recalcula intenções todo frame; decide um novo "plano" em intervalos.
  atualizar(dt, f) {
    const op = f.oponente;
    this.segura.clear();
    if (!op) return;

    const dist = op.x - f.x;
    const ad = Math.abs(dist);
    const dirOp = dist >= 0 ? "direita" : "esquerda";

    // (a) Desvio reativo: pula projétil que se aproxima.
    if (f.noChao) {
      for (const p of f.jogo.projeteis) {
        if (p.dono === f) continue;
        const vindo = (p.x < f.x && p.vx > 0) || (p.x > f.x && p.vx < 0);
        if (
          vindo &&
          Math.abs(p.x - f.x) < 230 &&
          Math.random() < this.cfg.pulaProjetil * dt * 8
        ) {
          this.segura.add("pula");
        }
      }
    }

    // (b) Decisão periódica de plano/ataque.
    this.t -= dt;
    if (this.t <= 0) {
      this.t = this.cfg.intervalo * (0.6 + Math.random() * 0.8);
      this._decidir(f, op, ad, dirOp);
    }

    // (c) Aplica o plano como "segurar".
    if (this.plano === "aproximar") this.segura.add(dirOp);
    else if (this.plano === "recuar")
      this.segura.add(dirOp === "direita" ? "esquerda" : "direita");
    else if (this.plano === "defender") this.segura.add("defende");
  }

  _decidir(f, op, ad, dirOp) {
    const c = this.cfg;
    const opAtacando = ESTADOS_GOLPE.has(op.estado);
    const barraCheia = f.especial >= CONFIG.especial.custo;

    // Defender se o oponente ataca de perto (reação).
    if (
      ad < c.alcanceAtaque + 25 &&
      opAtacando &&
      Math.random() < c.blockChance
    ) {
      this.plano = "defender";
      return;
    }

    if (ad <= c.alcanceAtaque) {
      // No alcance: atacar conforme agressividade.
      if (Math.random() < c.agressao) {
        const r = Math.random();
        if (barraCheia && r < 0.18) this.fila.push("especial");
        else if (r < 0.32) this.fila.push("agarra");
        else if (r < 0.68) this.fila.push("soco");
        else this.fila.push("chute");
        this.plano = "aproximar";
      } else {
        this.plano = Math.random() < 0.5 ? "esperar" : "recuar";
      }
    } else if (ad < c.alcanceMedio) {
      // Zona média: aproximar ou soltar projétil.
      if (Math.random() < c.projChance) {
        this.fila.push("projetil");
        this.plano = "esperar";
      } else this.plano = "aproximar";
    } else {
      // Longe: projétil de pressão ou correr para cima.
      if (Math.random() < c.projChance) {
        this.fila.push("projetil");
        this.plano = Math.random() < 0.5 ? "esperar" : "aproximar";
      } else this.plano = "aproximar";
    }
  }

  quer(nome) {
    return this.segura.has(nome);
  }
  consumir() {
    const f = this.fila;
    this.fila = [];
    return f;
  }
}

/* ===========================================================================
   5) PARTÍCULAS — sistema simples em canvas (faíscas, rastro, poeira)
   =========================================================================== */

class Particulas {
  constructor() {
    this.lista = [];
  }

  _add(p) {
    this.lista.push(p);
  }

  // Faíscas que explodem de um ponto (impacto de golpe/projétil/defesa).
  faiscas(x, y, n, cor, forca = 220) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = forca * (0.4 + Math.random() * 0.9);
      this._add({
        x,
        y,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - 60,
        vida: 0.25 + Math.random() * 0.25,
        vidaMax: 0.5,
        raio: 1.5 + Math.random() * 2.5,
        cor,
        grav: 900,
        brilho: true,
      });
    }
  }

  // Poeira ao pousar: partículas baixas, claras, espalhando no chão.
  poeira(x, y, n) {
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this._add({
        x: x + (Math.random() - 0.5) * 30,
        y,
        vx: dir * (40 + Math.random() * 90),
        vy: -(30 + Math.random() * 60),
        vida: 0.3 + Math.random() * 0.3,
        vidaMax: 0.6,
        raio: 2 + Math.random() * 3,
        cor: "rgba(180,170,200,0.7)",
        grav: 500,
        brilho: false,
      });
    }
  }

  // Ponto do rastro de projétil.
  rastro(x, y, cor) {
    this._add({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 30,
      vy: (Math.random() - 0.5) * 30,
      vida: 0.18,
      vidaMax: 0.18,
      raio: 2 + Math.random() * 3,
      cor,
      grav: 0,
      brilho: true,
    });
  }

  atualizar(dt) {
    for (const p of this.lista) {
      p.vida -= dt;
      p.vx *= Math.pow(0.2, dt);
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.lista = this.lista.filter((p) => p.vida > 0);
  }

  desenhar(ctx) {
    ctx.save();
    for (const p of this.lista) {
      const a = Math.max(0, p.vida / p.vidaMax);
      if (p.brilho) ctx.globalCompositeOperation = "lighter";
      else ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = a;
      ctx.fillStyle = p.cor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.raio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  limpar() {
    this.lista.length = 0;
  }
}

/* ===========================================================================
   6) ÁUDIO — Web Audio API sintetizado (sem arquivos)
   Inicializa só após um gesto do usuário (regra dos navegadores).
   =========================================================================== */

class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ligado = true;
  }

  // Cria o AudioContext na primeira interação.
  garantir() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.ligado = false;
      return;
    }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.volumeMaster;
    this.master.connect(this.ctx.destination);
  }

  // Envelope de tom (oscilador) com decaimento exponencial.
  _tom(freqIni, freqFim, dur, tipo, vol, atraso = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + atraso;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freqIni, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqFim), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Estouro de ruído (impactos secos).
  _ruido(dur, vol, corte, atraso = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + atraso;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filtro = this.ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = corte;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filtro).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- Sons do jogo (cada um isolado e fácil de ajustar) ---
  soco() {
    if (!this.ligado) return;
    this._tom(220, 90, 0.1, "square", 0.5);
    this._ruido(0.06, 0.25, 1200);
  }
  chute() {
    if (!this.ligado) return;
    this._tom(160, 60, 0.16, "sawtooth", 0.5);
    this._ruido(0.08, 0.3, 900);
  }
  projetil() {
    if (!this.ligado) return;
    this._tom(520, 180, 0.22, "sine", 0.4);
    this._tom(260, 90, 0.22, "triangle", 0.25);
  }
  acerto() {
    if (!this.ligado) return;
    this._ruido(0.1, 0.5, 2600);
    this._tom(300, 120, 0.08, "square", 0.3);
  }
  bloqueio() {
    if (!this.ligado) return;
    this._ruido(0.06, 0.35, 4200);
    this._tom(700, 500, 0.05, "square", 0.15);
  }
  especial() {
    if (!this.ligado) return;
    this._tom(180, 700, 0.2, "sawtooth", 0.4);
    this._tom(90, 300, 0.35, "square", 0.3, 0.05);
  }
  ko() {
    if (!this.ligado) return;
    this._tom(300, 40, 0.6, "sawtooth", 0.5);
    this._ruido(0.5, 0.4, 800);
    this._tom(120, 30, 0.7, "square", 0.3, 0.05);
  }
  pulo() {
    if (!this.ligado) return;
    this._tom(300, 600, 0.1, "sine", 0.18);
  }
}

/* ===========================================================================
   6b) MÚSICA — HTMLAudioElement em loop por tela.
   Arquivos esperados em assets/: musica_menu.mp3, musica_luta.mp3, musica_vitoria.mp3
   Troque os arquivos a qualquer momento sem tocar no código.
   =========================================================================== */

class MusicaFX {
  constructor() {
    // Trilhas indexadas por nome lógico.
    this.trilhas = {};
    this.nomeAtual = null;
    this.ligado = true;
  }

  // Pré-carrega as três trilhas (chamado antes de iniciar o jogo).
  precarregar() {
    const arquivos = {
      menu: "assets/audio/musica_menu.mp3",
      luta: "assets/audio/musica_luta.mp3",
      vitoria: "assets/audio/musica_vitoria.mp3",
      // Trilha EXCLUSIVA da VS Screen (não reutiliza nenhuma já existente).
      // Solte o arquivo abaixo em assets/audio/ — se faltar, a VS roda sem música.
      vs: "assets/audio/musica_vs.mp3",
    };
    for (const [nome, src] of Object.entries(arquivos)) {
      const audio = new Audio(src);
      audio.loop = true;
      audio.volume = CONFIG.audio.volumeMusica;
      audio.preload = "auto";
      this.trilhas[nome] = audio;
    }
  }

  // Toca a trilha indicada; se já estiver tocando, não reinicia.
  // Só começa a tocar após o primeiro gesto do usuário (política de autoplay).
  tocar(nome) {
    if (!this.ligado) return;
    if (this.nomeAtual === nome) return;

    // Para a trilha anterior imediatamente.
    const anterior = this.trilhas[this.nomeAtual];
    if (anterior) {
      anterior.pause();
      anterior.currentTime = 0;
    }

    this.nomeAtual = nome;
    const prox = this.trilhas[nome];
    if (!prox) return;

    prox.volume = CONFIG.audio.volumeMusica;
    const tentativa = prox.play();
    if (tentativa !== undefined) {
      tentativa.catch(() => {
        // Navegador bloqueou autoplay (política de interação do usuário).
        // Registra um listener único: assim que qualquer tecla for pressionada,
        // tenta tocar novamente — isso garante que a música começa no 1º ENTER.
        const retry = () => {
          if (this.nomeAtual === nome) prox.play().catch(() => {});
        };
        document.addEventListener("keydown", retry, { once: true });
      });
    }
  }

  // Pausa temporária (ex.: durante hit stop — opcional).
  pausar() {
    const t = this.trilhas[this.nomeAtual];
    if (t) t.pause();
  }

  retomar() {
    if (!this.ligado) return;
    const t = this.trilhas[this.nomeAtual];
    if (t) t.play().catch(() => {});
  }
}

/* ===========================================================================
   6c) SOM DE UI — efeitos sonoros dos menus (navegação, confirmação, voltar).
   Arquivos esperados em assets/audio/:
     sfx_confirmar.mp3   → ENTER na tela de título
     sfx_navegar.mp3     → trocar opção no menu de modo
     sfx_personagem.mp3  → trocar personagem na seleção
     sfx_selecionar.mp3  → confirmar personagem escolhido
     sfx_voltar.mp3      → ESC / voltar para tela anterior
   =========================================================================== */

class SomUI {
  constructor() {
    this.sons = {};
  }

  precarregar() {
    const arquivos = {
      confirmar: "assets/audio/sfx_confirmar.mp3",
      navegar: "assets/audio/sfx_navegar.mp3",
      personagem: "assets/audio/sfx_personagem.mp3",
      selecionar: "assets/audio/sfx_selecionar.mp3",
      voltar: "assets/audio/sfx_voltar.mp3",
    };
    for (const [nome, src] of Object.entries(arquivos)) {
      const audio = new Audio(src);
      audio.preload = "auto";
      this.sons[nome] = audio;
    }
  }

  // Toca o efeito indicado. Reinicia do início para poder disparar rapidamente.
  tocar(nome) {
    const s = this.sons[nome];
    if (!s) return;
    s.volume = CONFIG.audio.volumeUI;
    s.currentTime = 0;
    s.play().catch(() => {});
  }
}

/* ===========================================================================
   7) PROJÉTIL — viaja na horizontal, deixa rastro, some na borda/ao acertar.
   =========================================================================== */

class Projetil {
  constructor(dono, tipo) {
    const cfg = PROJETEIS[tipo] || PROJETEIS.fireball;
    this.dono = dono;
    this.tipo = tipo;
    this.dano = cfg.dano;
    this.cor = cfg.cor;
    this.facing = dono.facing;
    this.vx = cfg.vel * this.facing;
    this.x = dono.x + this.facing * 70;
    this.y = CHAO_Y - 132;
    this.raio = cfg.raio;
    this.vivo = true;
    this.t = 0;
    this.tRastro = 0; // acumulador para soltar o rastro
  }

  atualizar(dt) {
    this.t += dt;
    this.x += this.vx * dt;

    // Rastro de partículas (NOVO).
    this.tRastro += dt * 1000;
    if (this.tRastro >= CONFIG.particulas.rastroProjetilMs) {
      this.tRastro = 0;
      this.dono.jogo.particulas.rastro(
        this.x - this.facing * this.raio,
        this.y,
        this.cor,
      );
    }

    if (this.x < -40 || this.x > MUNDO_L + 40) this.vivo = false;
  }

  caixa() {
    return {
      x: this.x - this.raio,
      y: this.y - this.raio,
      w: this.raio * 2,
      h: this.raio * 2,
    };
  }

  desenhar(ctx) {
    const pulso = 1 + Math.sin(this.t * 18) * 0.12;
    const r = this.raio * pulso;
    const g = ctx.createRadialGradient(
      this.x,
      this.y,
      2,
      this.x,
      this.y,
      r * 1.6,
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, this.cor);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================================
   8) FIGHTER (LUTADOR)
   Física, máquina de estados, vida, animação, combate, combos e especial.
   AGORA: slot (teclas) separado de personagem (sprite); lê de um Controle.
   =========================================================================== */

// Offscreen reutilizável para o flash branco (tinge o sprite respeitando alpha).
const _bufFlash = document.createElement("canvas");
const _bufFlashCtx = _bufFlash.getContext("2d");

// Sombra (penumbra) pixelada: desenhada UMA vez como elipse com borda suave
// em baixíssima resolução. Ao ampliar sem suavização, vira blocos de pixel.
const _bufSombra = document.createElement("canvas");
(function construirSombra() {
  const W = 30,
    H = 9; // resolução base baixa => pixels grandes ao ampliar
  _bufSombra.width = W;
  _bufSombra.height = H;
  const c = _bufSombra.getContext("2d");
  // Gradiente radial num "quadrado unitário"; a escala não uniforme (W,H)
  // transforma o círculo numa elipse achatada com penumbra suave.
  c.save();
  c.scale(W, H);
  const g = c.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.5);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.62, "rgba(0,0,0,0.3)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 1, 1);
  c.restore();
})();

class Fighter {
  constructor(recursos, slot, personagem, x, jogo, controle) {
    this.recursos = recursos;
    this.slot = slot; // "p1"/"p2" -> só para referência/HUD
    this.personagem = personagem; // "p1"/"p2" -> qual SPRITE usar
    this.jogo = jogo;
    this.controle = controle; // ControleTeclado ou ControleIA
    this.nome = recursos.nome(personagem);
    // Frame data PRÓPRIO deste lutador (vem do manifest; default = CONFIG.golpes).
    this.golpes = montarGolpes(recursos.golpes(personagem));

    this.x = x;
    this.y = CHAO_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.noChao = true;

    this.hp = VIDA_MAX;
    this.especial = 0; // barra de especial (0..CONFIG.especial.max)
    this.estado = ESTADOS.IDLE;
    this.estadoTempo = 0;
    this.anim = new Animator(recursos, personagem);
    this.anim.tocar("idle");

    this.golpeAcertou = false;
    this.projetilLancado = false;
    this.golpeAtual = null;
    this.oponente = null;

    // Combos / cancelamento.
    this.janelaCancel = 0; // tempo restante (s) para cancelar
    this.comboContador = 0; // golpes encadeados na sequência atual

    // Anti-combo-infinito (rastreamento no lado do DEFENSOR).
    this.comboRecebido = 0; // hits consecutivos recebidos no combo atual
    this.comboResetTimer = 0; // timer (s) para zerar comboRecebido após pausa no dano

    // Game feel.
    this.flashTimer = 0; // duração restante do flash branco
    this.invencivel = 0; // invencibilidade de wakeup (s); sprite pisca

    // --- Postura de defesa/agachamento (sistema de golpes baixos) ----------
    // Re-derivadas a cada quadro em _processarInput (só valem em estados livres).
    // estaAgachado       = está agachado (CROUCH, ou defendendo agachado).
    // estaDefendendoBaixo = está em DEFESA_BAIXA (agachado + defender = down-back).
    //                       Só essa postura bloqueia golpes "baixo".
    this.estaAgachado = false;
    this.estaDefendendoBaixo = false;
  }

  // ---- Consultas ------------------------------------------------------------
  podeAgir() {
    return ESTADOS_LIVRES.has(this.estado);
  }
  estaVivo() {
    return this.estado !== ESTADOS.KO;
  }

  hurtbox() {
    const agachado = this.estado === ESTADOS.CROUCH;
    const meiaL = agachado ? 44 : 38;
    const topo = agachado ? -112 : -186;
    const alt = agachado ? 112 : 186;
    return { x: this.x - meiaL, y: this.y + topo, w: meiaL * 2, h: alt };
  }

  /* HURTBOX DIVIDIDA (sistema de golpes baixos) -----------------------------
     Divide a hurtbox cheia numa linha de "cintura" (~58% da altura a partir do
     topo). A parte de baixo é o quadrante inferior (pernas/pés) — alvo dos
     golpes "baixo"; a de cima é cabeça/tronco — alvo dos golpes "alto".
     Os golpes "medio" usam a hurtbox cheia.
     Como os offsets vêm da hurtbox atual, isso já respeita o agachamento:
     agachado, a hurtbox é mais baixa, então golpes "alto" passam por cima. */
  _linhaCintura(hb) {
    return hb.y + hb.h * 0.58;
  }
  hurtboxAlta() {
    const hb = this.hurtbox();
    const corte = this._linhaCintura(hb);
    return { x: hb.x, y: hb.y, w: hb.w, h: corte - hb.y };
  }
  hurtboxBaixa() {
    const hb = this.hurtbox();
    const corte = this._linhaCintura(hb);
    return { x: hb.x, y: corte, w: hb.w, h: hb.y + hb.h - corte };
  }

  // Retorna a região de hurtbox correspondente ao tipo de altura do golpe.
  hurtboxPara(tipoAltura) {
    if (tipoAltura === "baixo") return this.hurtboxBaixa();
    if (tipoAltura === "alto") return this.hurtboxAlta();
    return this.hurtbox(); // "medio" (ou ausente): corpo inteiro
  }

  // O golpe atual está nos quadros ativos? Usa framesAtivos do manifest se
  // existir; senão cai no frame data (startup/ativo) do CONFIG.
  _golpeAtivo() {
    const meta = this.anim.meta;
    if (meta && meta.framesAtivos && meta.framesAtivos.length) {
      return meta.framesAtivos.includes(this.anim.frame);
    }
    const frames60 = this.estadoTempo * 60;
    const fd = this.golpes[this.golpeAtual];
    if (fd) return frames60 >= fd.startup && frames60 < fd.startup + fd.ativo;
    // Sem framesAtivos nem frame data (ex.: super-projétil na pose "item"):
    // usa uma janela padrão para o disparo acontecer mesmo assim.
    return frames60 >= 5 && frames60 < 10;
  }

  hitbox() {
    if (!this.golpeAtual || !this.golpes[this.golpeAtual]) return null;
    if (!this._golpeAtivo()) return null;
    const g = this.golpes[this.golpeAtual];
    let x1, x2;
    if (this.facing === 1) {
      x1 = this.x + g.alcance[0];
      x2 = this.x + g.alcance[1];
    } else {
      x1 = this.x - g.alcance[1];
      x2 = this.x - g.alcance[0];
    }
    return {
      x: Math.min(x1, x2),
      y: this.y + g.altura[0],
      w: Math.abs(x2 - x1),
      h: g.altura[1] - g.altura[0],
    };
  }

  // ---- Transições de estado -------------------------------------------------
  // golpe: nome do golpe/projétil ao entrar num estado de ataque. Definido
  // ANTES de escolher a animação para que hitbox()/disparo usem o valor certo.
  irPara(estado, forcar = false, golpe = null) {
    if (this.estado === estado && !forcar) return;
    this.estado = estado;
    this.estadoTempo = 0;
    this.golpeAcertou = false;
    this.projetilLancado = false;
    this.golpeAtual = golpe;
    this.janelaCancel = 0;
    if (!ESTADOS_GOLPE.has(estado)) this.comboContador = 0;
    this.anim.tocar(this._animDoEstado(estado), true);
  }

  _animDoEstado(estado) {
    const r = this.recursos;
    const fb = (nome, alt) => (r.tem(this.personagem, nome) ? nome : alt);
    switch (estado) {
      case ESTADOS.IDLE:
        return "idle";
      case ESTADOS.WALK:
        return this._avancando() ? fb("run", "walk") : "walk";
      case ESTADOS.JUMP:
        return fb("run", "idle");
      case ESTADOS.CROUCH:
        return fb("item", "idle");
      case ESTADOS.BLOCK:
        return fb("block", "idle");
      case ESTADOS.HIT:
        return fb("hit", "idle");
      case ESTADOS.KNOCKDOWN:
        return fb("knockdown", "hit");
      case ESTADOS.GETUP:
        return fb("getup", "idle");
      case ESTADOS.KO:
        return fb("ko", "knockdown");
      case ESTADOS.VICTORY:
        return fb("taunt", "idle");
      case ESTADOS.TAUNT:
        return fb("taunt", "idle");
      case ESTADOS.PUNCH:
        return this.golpeAtual || "punch";
      case ESTADOS.KICK:
        return this.golpeAtual || "kick";
      case ESTADOS.FIREBALL:
        return this.golpeAtual || "fireball";
      case ESTADOS.GRAB:
        return fb("item", "punch"); // agarrão usa "item"
      case ESTADOS.SPECIAL:
        return fb("special", "item"); // especial usa "special"/"item"
      default:
        return "idle";
    }
  }

  _avancando() {
    const querEsq = this.controle.quer("esquerda");
    const querDir = this.controle.quer("direita");
    if (querDir && this.facing === 1) return true;
    if (querEsq && this.facing === -1) return true;
    return false;
  }

  // ---- Ações ----------------------------------------------------------------
  iniciarSoco(movendo) {
    let anim = "punch";
    if (movendo && this.recursos.tem(this.personagem, "punch_step"))
      anim = "punch_step";
    this.irPara(ESTADOS.PUNCH, true, anim);
  }

  iniciarChute(agachado, noAr) {
    let anim = "kick";
    if (noAr && this.recursos.tem(this.personagem, "kick_jump"))
      anim = "kick_jump";
    else if (agachado && this.recursos.tem(this.personagem, "kick_mid"))
      anim = "kick_mid";
    this.irPara(ESTADOS.KICK, true, anim);
  }

  iniciarProjetil(agachado) {
    let anim = "fireball";
    if (agachado && this.recursos.tem(this.personagem, "special"))
      anim = "special";
    if (!this.recursos.tem(this.personagem, anim)) anim = "fireball";
    this.irPara(ESTADOS.FIREBALL, true, anim);
  }

  // NOVO: agarrão (usa pose "item"; ignora defesa; derruba).
  iniciarAgarra() {
    this.irPara(ESTADOS.GRAB, true, "agarra");
    this.jogo.audio.chute();
  }

  // NOVO: especial (gasta a barra cheia; lança o super-projétil na pose "special").
  iniciarEspecial() {
    this.especial = 0;
    this.irPara(ESTADOS.SPECIAL, true, "super"); // "super" = tipo de projétil
    this.jogo.audio.especial();
  }

  ganharEspecial(qtd) {
    this.especial = Math.min(CONFIG.especial.max, this.especial + qtd);
  }

  // Recebe um golpe. info: {dano, knockback, derruba, origemX, ignoraBloqueio}.
  // Retorna um resumo para o Jogo decidir o feedback (partículas/som/shake).
  receberGolpe(info) {
    if (!this.estaVivo()) return { ignorado: true };
    if (this.invencivel > 0) return { ignorado: true };

    const atacanteDoLado =
      (info.origemX <= this.x && this.facing === -1) ||
      (info.origemX >= this.x && this.facing === 1);

    // Postura de defesa correta para a ALTURA do golpe (regra clássica):
    //  - "baixo": SÓ DEFESA_BAIXA (agachado + defender) bloqueia. Em pé falha.
    //  - "alto"/"medio": bloqueável em pé ou agachado (defesa alta ou baixa).
    // (Para transformar "alto" em overhead — só defesa em pé —, basta exigir
    //  !this.estaDefendendoBaixo no ramo "alto".)
    const tipoAltura = info.tipoAltura || "medio";
    const posturaCorreta =
      tipoAltura === "baixo" ? this.estaDefendendoBaixo : true;
    const bloqueando =
      this.estado === ESTADOS.BLOCK &&
      atacanteDoLado &&
      !info.ignoraBloqueio &&
      posturaCorreta;

    if (bloqueando) {
      // Defesa: chip mínimo + recuo curto; bloquear quebra o combo recebido.
      const chip = Math.floor(info.dano * 0.15);
      this.hp = Math.max(0, this.hp - chip);
      this.vx = (this.x < info.origemX ? -1 : 1) * 90;
      this.ganharEspecial(CONFIG.especial.ganhoAoApanhar * 0.3);
      this.comboRecebido = 0;
      this.comboResetTimer = 0;
      return { bloqueado: true, ko: false };
    }

    const cc = CONFIG.combo;

    // Scaling de dano: hits consecutivos causam progressivamente menos dano,
    // desincentivando combos longos sem eliminar a mecânica de combo.
    const scalingIdx = Math.min(this.comboRecebido, cc.scalingDano.length - 1);
    const dano = Math.max(
      1,
      Math.round(info.dano * cc.scalingDano[scalingIdx]),
    );

    // Scaling de knockback: cada hit empurra mais para forçar reposicionamento.
    // No 3º hit: knockback × 2,05 — suficiente para quebrar o range do combo.
    const knockback =
      info.knockback * (1 + cc.pushbackPorHit * this.comboRecebido);

    // Avança o contador e reinicia o timer de reset do combo recebido.
    this.comboRecebido++;
    this.comboResetTimer = cc.comboResetMs / 1000;

    // Após hitMaxSequencia hits consecutivos, forçar knockdown independente do golpe.
    const derruba = info.derruba || this.comboRecebido >= cc.hitMaxSequencia;

    this.hp = Math.max(0, this.hp - dano);
    this.ganharEspecial(CONFIG.especial.ganhoAoApanhar);
    const dir = this.x < info.origemX ? -1 : 1;
    this.vx = dir * knockback * CONFIG.gameFeel.knockbackEscala;
    this.flashTimer = CONFIG.gameFeel.flashMs / 1000;

    if (this.hp <= 0) {
      this.irPara(ESTADOS.KO, true);
      this.vx = dir * 160;
      this.vy = -180;
      this.noChao = false;
      return { bloqueado: false, ko: true, dano };
    } else if (derruba) {
      this.irPara(ESTADOS.KNOCKDOWN, true);
      this.vy = -260;
      this.noChao = false;
      // Knockdown forçado pelo limite de hits: zera o contador para o próximo ciclo.
      if (this.comboRecebido >= cc.hitMaxSequencia) this.comboRecebido = 0;
      return { bloqueado: false, ko: false, derrubou: true, dano };
    } else {
      this.irPara(ESTADOS.HIT, true);
      return { bloqueado: false, ko: false, dano };
    }
  }

  // ---- Atualização por quadro ----------------------------------------------
  atualizar(dt, podeControlar) {
    this.estadoTempo += dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.janelaCancel > 0) this.janelaCancel -= dt;
    if (this.invencivel > 0) this.invencivel -= dt;
    if (this.comboResetTimer > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) {
        this.comboResetTimer = 0;
        this.comboRecebido = 0;
      }
    }

    if (this.podeAgir() && this.oponente) {
      this.facing = this.oponente.x >= this.x ? 1 : -1;
    }

    // Pensamento da IA acontece junto do controle (gera intenções deste frame).
    if (podeControlar && this.controle.atualizar)
      this.controle.atualizar(dt, this);

    if (podeControlar) this._processarInput();

    this._fisica(dt);
    this._transicoes();

    if (this.estado === ESTADOS.WALK)
      this.anim.tocar(this._animDoEstado(ESTADOS.WALK));
    this.anim.atualizar(dt);

    // CROUCH: mantém sempre o frame 0 da pose agachada (item_0).
    // O frame 1 (item_1) é reservado para o agarrão — não deve aparecer ao agachar.
    if (this.estado === ESTADOS.CROUCH) this.anim.frame = 0;

    // Lança projétil/super no frame ativo de FIREBALL/SPECIAL.
    if (
      (this.estado === ESTADOS.FIREBALL || this.estado === ESTADOS.SPECIAL) &&
      !this.projetilLancado &&
      this._golpeAtivo()
    ) {
      this.jogo.projeteis.push(new Projetil(this, this.golpeAtual));
      this.projetilLancado = true;
      this.jogo.audio.projetil();
    }
  }

  _processarInput() {
    const acoes = this.controle.consumir();

    /* --- CANCELAMENTO DE COMBO -------------------------------------------
       Se um golpe CANCELÁVEL acertou e ainda estamos na janela, um novo
       comando interrompe a recuperação e encadeia o próximo golpe. */
    if (
      !this.podeAgir() &&
      this.janelaCancel > 0 &&
      this.golpes[this.golpeAtual] &&
      this.golpes[this.golpeAtual].cancelavel &&
      this.comboContador < CONFIG.combo.maxCombo
    ) {
      if (acoes.includes("chute")) {
        this.comboContador++;
        this.iniciarChute(false, !this.noChao);
        this.jogo.audio.chute();
        return;
      }
      if (acoes.includes("soco")) {
        this.comboContador++;
        this.iniciarSoco(false);
        this.jogo.audio.soco();
        return;
      }
      if (
        acoes.includes("especial") &&
        this.especial >= CONFIG.especial.custo
      ) {
        this.comboContador++;
        this.iniciarEspecial();
        return;
      }
    }

    // --- Estados livres: deriva movimento/defesa/agachar a cada quadro ---
    if (this.podeAgir()) {
      const querEsq = this.controle.quer("esquerda");
      const querDir = this.controle.quer("direita");
      const querPula = this.controle.quer("pula");
      const querAgacha = this.controle.quer("agacha");
      const querDefende = this.controle.quer("defende");
      const agachado = this.estado === ESTADOS.CROUCH;

      // Postura padrão deste quadro (sobrescrita nas defesas/agachamento abaixo).
      // Atacar ou andar zera as flags — só BLOCK/CROUCH as ativam.
      this.estaAgachado = false;
      this.estaDefendendoBaixo = false;

      // Ações de borda (prioridade).
      if (
        acoes.includes("especial") &&
        this.especial >= CONFIG.especial.custo &&
        this.noChao
      ) {
        this.comboContador = 1;
        this.iniciarEspecial();
        return;
      }
      if (acoes.includes("agarra") && this.noChao) {
        this.comboContador = 1;
        this.iniciarAgarra();
        return;
      }
      if (acoes.includes("soco")) {
        this.comboContador = 1;
        this.iniciarSoco(querEsq || querDir);
        this.jogo.audio.soco();
        return;
      }
      if (acoes.includes("chute")) {
        this.comboContador = 1;
        this.iniciarChute(agachado, !this.noChao);
        this.jogo.audio.chute();
        return;
      }
      if (acoes.includes("projetil")) {
        this.iniciarProjetil(agachado);
        return;
      }
      if (acoes.includes("provoca") && this.noChao) {
        this.irPara(ESTADOS.TAUNT, true);
        return;
      }

      if (!this.noChao) {
        // Controle direcional no ar: segura ← ou → para mover lateralmente.
        if (querDir) this.vx = CONFIG.movimento.velPuloLateral;
        else if (querEsq) this.vx = -CONFIG.movimento.velPuloLateral;
        // Sem tecla: momentum atual é preservado (sem atrito no ar — ver _fisica).
        this.irPara(ESTADOS.JUMP);
        return;
      }

      if (querPula) {
        this.vy = -FORCA_PULO;
        this.noChao = false;
        // Velocidade horizontal inicial do pulo (direção pressionada no momento).
        if (querDir) this.vx = CONFIG.movimento.velPuloLateral;
        else if (querEsq) this.vx = -CONFIG.movimento.velPuloLateral;
        else this.vx = 0; // pulo reto
        this.irPara(ESTADOS.JUMP, true);
        this.jogo.audio.pulo();
        return;
      }
      if (querDefende) {
        this.vx = 0;
        // DEFESA_BAIXA = defender + agachar (down-back): bloqueia golpes baixos.
        // DEFESA_ALTA  = só defender (em pé): NÃO bloqueia golpes baixos.
        this.estaAgachado = querAgacha;
        this.estaDefendendoBaixo = querAgacha;
        this.irPara(ESTADOS.BLOCK);
        return;
      }
      if (querAgacha) {
        this.vx = 0;
        this.estaAgachado = true; // agachado sem defender (esquiva de altos)
        this.irPara(ESTADOS.CROUCH);
        return;
      }

      if (querEsq || querDir) {
        const dir = querDir ? 1 : -1;
        const avancando = dir === this.facing;
        this.vx = dir * (avancando ? VEL_CORRER : VEL_ANDAR);
        this.irPara(ESTADOS.WALK);
      } else {
        this.vx = 0;
        this.irPara(ESTADOS.IDLE);
      }
    }
  }

  _fisica(dt) {
    if (!this.noChao) this.vy += GRAVIDADE * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.estado !== ESTADOS.WALK && this.estado !== ESTADOS.JUMP) {
      // No chão e fora do andar: desacelera rápido (empurrões, hit stun, etc.).
      this.vx *= Math.pow(0.0008, dt);
      if (Math.abs(this.vx) < 4) this.vx = 0;
    }
    // JUMP: sem atrito passivo — o input controla vx diretamente.
    // Momentum inicial (sem tecla pressionada) é preservado até o pouso.

    if (this.y >= CHAO_Y) {
      const estavaNoAr = !this.noChao;
      this.y = CHAO_Y;
      this.vy = 0;
      this.noChao = true;
      if (estavaNoAr) {
        // Poeira ao pousar (NOVO).
        this.jogo.particulas.poeira(
          this.x,
          CHAO_Y,
          CONFIG.particulas.poeiraPulo,
        );
        if (this.estado === ESTADOS.JUMP) this.irPara(ESTADOS.IDLE, true);
      }
    } else {
      this.noChao = false;
    }

    const margem = 40;
    if (this.x < margem) this.x = margem;
    if (this.x > MUNDO_L - margem) this.x = MUNDO_L - margem;
  }

  _transicoes() {
    switch (this.estado) {
      case ESTADOS.PUNCH:
      case ESTADOS.KICK:
      case ESTADOS.GRAB:
        // Recovery frames: o lutador fica preso na pose final pelo tempo de recovery
        // definido no frame data. Isso impede o encadeamento infinito após a chain de
        // cancels — o atacante precisa esperar antes de poder agir novamente.
        // (Cancels ainda funcionam: eles interrompem o recovery do hit anterior.)
        if (this.anim.terminou) {
          const fd = this.golpes[this.golpeAtual];
          const durAnim = this.anim.meta
            ? this.anim.meta.frames / this.anim.meta.fps
            : 0;
          const minDuracao = fd ? durAnim + fd.recovery / 60 : durAnim;
          if (this.estadoTempo >= minDuracao) this.irPara(ESTADOS.IDLE, true);
        }
        break;
      case ESTADOS.FIREBALL:
      case ESTADOS.SPECIAL:
        if (this.anim.terminou) this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.HIT:
        if (this.anim.terminou && this.estadoTempo > 0.25)
          this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.KNOCKDOWN:
        if (this.noChao && this.estadoTempo > 0.7) {
          this.irPara(ESTADOS.GETUP, true);
          // Invencibilidade começa ao levantar: cobre toda a animação de getup
          // (~0.25 s) + janela de reação ao ficar de pé (~0.4 s).
          this.invencivel = CONFIG.gameFeel.wakeupInvencivelMs / 1000;
        }
        break;
      case ESTADOS.GETUP:
        if (this.anim.terminou) {
          // Wakeup block: segurar defesa durante o getup entra em guarda.
          if (this.controle.quer("defende")) {
            this.irPara(ESTADOS.BLOCK, true);
          } else {
            this.irPara(ESTADOS.IDLE, true);
          }
        }
        break;
      case ESTADOS.TAUNT:
        if (this.anim.terminou) this.irPara(ESTADOS.IDLE, true);
        break;
    }
  }

  // ---- Desenho --------------------------------------------------------------
  // Penumbra pixelada arredondada projetada no chão (CHAO_Y). No ar ela
  // encolhe e clareia, dando sensação de altura.
  _desenharSombra(ctx) {
    const alturaPulo = Math.max(0, CHAO_Y - this.y);
    const k = Math.max(0.45, 1 - alturaPulo / 520); // 1 no chão -> menor no ar
    const w = 120 * k;
    const h = 36 * k;
    ctx.save();
    ctx.imageSmoothingEnabled = false; // mantém os blocos de pixel nítidos
    ctx.globalAlpha = 0.9 * k;
    ctx.drawImage(_bufSombra, this.x - w / 2, CHAO_Y - h / 2 + 2, w, h);
    ctx.restore();
  }

  desenhar(ctx, debug) {
    const fr = this.recursos.frame(
      this.personagem,
      this.anim.anim,
      this.anim.frame,
    );
    const dw = this.recursos.frameW * ESCALA;
    const dh = this.recursos.frameH * ESCALA;
    const dx = this.x - dw / 2;
    const dy = this.y - dh;

    this._desenharSombra(ctx); // penumbra no chão, sob o personagem

    ctx.save();
    if (this.facing === -1) {
      ctx.translate(this.x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-this.x, 0);
    }

    // Flicker durante invencibilidade de wakeup (oculta a cada ~2 frames visuais).
    const flickerOculto =
      this.invencivel > 0 && Math.floor(this.invencivel * 14) % 2 === 0;

    if (fr && fr.ok) {
      if (!flickerOculto) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fr.img, dx, dy, dw, dh);

        // FLASH BRANCO: redesenha o sprite tingido respeitando o alpha (NOVO).
        if (this.flashTimer > 0) {
          const intensidade = Math.min(
            1,
            this.flashTimer / (CONFIG.gameFeel.flashMs / 1000),
          );
          const fw = this.recursos.frameW,
            fh = this.recursos.frameH;
          if (_bufFlash.width !== fw) {
            _bufFlash.width = fw;
            _bufFlash.height = fh;
          }
          _bufFlashCtx.clearRect(0, 0, fw, fh);
          _bufFlashCtx.drawImage(fr.img, 0, 0, fw, fh);
          _bufFlashCtx.globalCompositeOperation = "source-atop";
          _bufFlashCtx.fillStyle = `rgba(255,255,255,${0.85 * intensidade})`;
          _bufFlashCtx.fillRect(0, 0, fw, fh);
          _bufFlashCtx.globalCompositeOperation = "source-over";
          ctx.drawImage(_bufFlash, dx, dy, dw, dh);
        }
      }
    } else {
      ctx.fillStyle = "rgba(220,60,90,0.85)";
      ctx.fillRect(this.x - 40, this.y - 180, 80, 180);
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(this.personagem, this.x, this.y - 95);
      ctx.fillText(this.anim.anim + ":" + this.anim.frame, this.x, this.y - 80);
    }
    ctx.restore();

    if (debug) {
      const hb = this.hurtbox();
      ctx.strokeStyle = "#3df";
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
      // Quadrante inferior (pernas/pés): alvo dos golpes "baixo".
      const hbBaixa = this.hurtboxBaixa();
      ctx.strokeStyle = this.estaDefendendoBaixo ? "#3f9" : "#fa0";
      ctx.strokeRect(hbBaixa.x, hbBaixa.y, hbBaixa.w, hbBaixa.h);
      const hit = this.hitbox();
      if (hit) {
        ctx.strokeStyle = "#f33";
        ctx.strokeRect(hit.x, hit.y, hit.w, hit.h);
      }
      // Frame data do golpe atual (NOVO no debug).
      if (this.golpeAtual && this.golpes[this.golpeAtual]) {
        const fd = this.golpes[this.golpeAtual];
        ctx.fillStyle = "#ff3";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          `${this.golpeAtual} s${fd.startup}/a${fd.ativo}/r${fd.recovery} d${fd.dano}`,
          this.x,
          this.y - 200,
        );
      }
    }
  }
}

/* ===========================================================================
   9) COLISÃO AABB
   =========================================================================== */
function colideAABB(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/* ===========================================================================
   10) JOGO — telas, rounds, timer, HUD, hit stop, screen shake, game loop.
   =========================================================================== */

const TELAS = {
  START: "start",
  MODO: "modo",
  DIFICULDADE: "dificuldade",
  SELECT: "select", // seleção de PERSONAGEM
  MAPA: "mapa", // seleção de ESTÁGIO (NOVO)
  VS: "vs", // tela intermediária "VS Screen" (NOVO)
  LUTA: "luta",
  VITORIA: "vitoria",
  CONFIG: "config",
};

/* ===========================================================================
   SELEÇÃO DE MAPA — (3) MÓDULO DE ESTADO da seleção
   Só guarda/atualiza qual mapa está sob o cursor numa grade responsiva, com
   WRAP nas bordas. Não desenha nada (separado da UI) nem carrega assets
   (separado dos dados): recebe a lista já pronta do CatalogoMapas.
   =========================================================================== */
class SelecaoMapa {
  constructor(mapas) {
    this.mapas = mapas;
    this.indice = 0;
    this._calcularGrade();
  }

  // Grade responsiva: acomoda a quantidade encontrada (ex.: 3→3×1, 6→3×2,
  // 12→4×3). Até 4 por linha em quantidades pequenas; acima, formato quadrado.
  _calcularGrade() {
    const n = Math.max(1, this.mapas.length);
    let cols = Math.min(4, n);
    if (n > 4) cols = Math.min(5, Math.ceil(Math.sqrt(n)));
    this.cols = cols;
    this.linhas = Math.ceil(n / cols);
  }

  get mapaAtual() {
    return this.mapas[this.indice] || null;
  }

  // Move o cursor com WRAP nas bordas. dx/dy ∈ {-1,0,1}. Retorna se mudou.
  mover(dx, dy) {
    const n = this.mapas.length;
    if (n === 0) return false;
    const anterior = this.indice;

    if (dx !== 0) {
      // Horizontal: anda no índice global (wrap natural ao fim/início da lista).
      this.indice = (this.indice + dx + n) % n;
    } else if (dy !== 0) {
      // Vertical: mantém a coluna e troca de linha, saltando linhas sem célula.
      const col = this.indice % this.cols;
      let lin = Math.floor(this.indice / this.cols);
      for (let passo = 0; passo < this.linhas; passo++) {
        lin = (lin + dy + this.linhas) % this.linhas;
        const alvo = lin * this.cols + col;
        if (alvo < n) {
          this.indice = alvo;
          break;
        }
      }
    }
    return this.indice !== anterior;
  }
}

/* ===========================================================================
   VS SCREEN — linha do tempo (segundos). >>> AJUSTE FINO DE TIMING AQUI <<<
   Total = 0.5 + 1.5 + 1.2 + 0.05 ≈ 3.25s (dentro da faixa pedida de 3–5s).
     entrada   : lutadores deslizam das bordas até o centro.
     confronto : idle se encarando + fundo scrollando + "VS" pulsando.
     round     : "ROUND N" entra com zoom-in.
     flash     : flash branco rápido (ref. SF2) antes de revelar o estágio.
   scrollPxFrame fica entre 0.3 e 0.8 px/frame (convertido p/ px/s no update).
   =========================================================================== */
const VS_TIMING = {
  entrada: 0.5,
  confronto: 1.5,
  round: 1.2,
  flash: 0.05,
  scrollPxFrame: 0.6,
};

/* ===========================================================================
   CONFIGURAÇÕES — array de descritores de cada item do menu.
   Para ADICIONAR uma nova configuração basta incluir uma entrada aqui.
   Tipos suportados:
     "slider"  — número min/max/step ajustado com ←/→
     "toggle"  — booleano alternado com ←/→ ou ENTER
   O campo "aplicar(jogo)" garante que o valor novo tem efeito imediato.
   =========================================================================== */
const CONFIGS = [
  {
    id: "volumeMusica",
    label: "Volume Música",
    tipo: "slider",
    min: 0,
    max: 1,
    step: 0.05,
    get: () => CONFIG.audio.volumeMusica,
    set: (v) => {
      CONFIG.audio.volumeMusica = v;
    },
    aplicar: (v, jogo) => {
      // Atualiza a faixa que já está tocando.
      const trilha = jogo.musica.trilhas[jogo.musica.nomeAtual];
      if (trilha) trilha.volume = v;
    },
  },
  {
    id: "volumeEfeitos",
    label: "Volume Efeitos",
    tipo: "slider",
    min: 0,
    max: 1,
    step: 0.05,
    get: () => CONFIG.audio.volumeMaster,
    set: (v) => {
      CONFIG.audio.volumeMaster = v;
      CONFIG.audio.volumeUI = v;
    },
    aplicar: (v, jogo) => {
      // Atualiza o gain do Web Audio (efeitos de combate) em tempo real.
      if (jogo.audio.master) jogo.audio.master.gain.value = v;
    },
  },
  // ── Adicione novas configurações abaixo ──────────────────────────────────
];

class Jogo {
  constructor(canvas, recursos, catalogo) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.recursos = recursos;
    this.catalogo = catalogo || { mapas: [] }; // (1) dados de mapas
    this.entrada = new Entrada();
    this.gamepad = new GamepadNav(); // navegação por controle nos menus
    this.particulas = new Particulas();
    this.audio = new AudioFX();
    this.musica = new MusicaFX();
    this.musica.precarregar();
    this.somUI = new SomUI();
    this.somUI.precarregar();
    this.debug = false;

    this.tela = TELAS.START;
    this.projeteis = [];

    // Placar / rounds.
    this.roundsP1 = 0;
    this.roundsP2 = 0;
    this.roundAtual = 1;
    this.tempoRestante = TEMPO_ROUND;
    this.faseRound = "anuncio";
    this.timerFase = 0;
    this.vencedorRound = null;
    this.vencedorPartida = null;
    this.terminouPorKO = false;

    // Configuração de partida (definida nas telas MODO/SELECT).
    this.modo = "2p"; // "1p" | "2p"
    this.dificuldade = "medio";
    this.escolha = { p1: 0, p2: 1 }; // índices em PERSONAGENS
    this.confirmado = { p1: false, p2: false };

    // Game feel global.
    this.hitStop = 0; // tempo congelado restante (s)
    this.shake = 0; // intensidade atual do tremor
    this.cameraX = 0; // deslocamento horizontal da câmera no mundo (px)
    this.menuIndex = 0; // navegação da tela MODO
    this.dificuldadeIndex = 0; // navegação da tela DIFICULDADE
    this.configIndex = 0; // navegação da tela CONFIG
    this.telaAnteriorConfig = TELAS.MODO; // para onde ESC leva ao sair das configs

    this.p1 = null;
    this.p2 = null;

    // Seleção de mapa / VS Screen (NOVO).
    this.selecaoMapa = null; // instância de SelecaoMapa enquanto em TELAS.MAPA
    this.mapaEscolhido = null; // descritor do mapa confirmado
    this.vs = null; // estado da VS Screen enquanto em TELAS.VS

    window.addEventListener("keydown", (e) => {
      if (e.code === "F1") {
        e.preventDefault();
        this.debug = !this.debug;
      }
    });
  }

  // Cria os lutadores conforme modo/personagens/dificuldade escolhidos.
  _criarLutadores() {
    const persP1 = PERSONAGENS[this.escolha.p1];
    const persP2 = PERSONAGENS[this.escolha.p2];

    const controleP1 = new ControleTeclado(this.entrada, "p1");
    const controleP2 =
      this.modo === "1p"
        ? new ControleIA(this.dificuldade)
        : new ControleTeclado(this.entrada, "p2");

    this.p1 = new Fighter(
      this.recursos,
      "p1",
      persP1,
      MUNDO_L / 2 - 172, // ambos começam centrados no mundo, separados ~344px
      this,
      controleP1,
    );
    this.p2 = new Fighter(
      this.recursos,
      "p2",
      persP2,
      MUNDO_L / 2 + 172,
      this,
      controleP2,
    );
    this.p1.oponente = this.p2;
    this.p2.oponente = this.p1;
    this.p1.facing = 1;
    this.p2.facing = -1;
  }

  _iniciarRound() {
    this.projeteis.length = 0;
    this.particulas.limpar();
    this.hitStop = 0;
    this.shake = 0;
    this.p1.x = MUNDO_L / 2 - 172;
    this.p1.y = CHAO_Y;
    this.p1.vx = 0;
    this.p1.vy = 0;
    this.p2.x = MUNDO_L / 2 + 172;
    this.p2.y = CHAO_Y;
    this.p2.vx = 0;
    this.p2.vy = 0;
    this.cameraX = this._alvoCamera(); // posiciona a câmera de imediato
    this.p1.hp = VIDA_MAX;
    this.p2.hp = VIDA_MAX;
    this.p1.especial = 0;
    this.p2.especial = 0;
    this.p1.comboRecebido = 0;
    this.p1.comboResetTimer = 0;
    this.p2.comboRecebido = 0;
    this.p2.comboResetTimer = 0;
    this.p1.irPara(ESTADOS.IDLE, true);
    this.p2.irPara(ESTADOS.IDLE, true);
    this.p1.facing = 1;
    this.p2.facing = -1;
    this.tempoRestante = TEMPO_ROUND;
    this.faseRound = "anuncio";
    this.timerFase = 0;
    this.vencedorRound = null;
    this.terminouPorKO = false;
  }

  /* ---- FLUXO: Seleção de mapa → VS Screen → Início do round (sem desvios) ----
     Após confirmar os PERSONAGENS, a tela SELECT chama _irParaSelecaoMapa(). */

  // Entra na seleção de estágio. Se nenhum mapa foi descoberto, pula direto para
  // a VS (a luta usará o cenário procedural de fallback).
  _irParaSelecaoMapa() {
    const mapas = this.catalogo ? this.catalogo.mapas : [];
    if (!mapas.length) {
      this.mapaEscolhido = null;
      this._criarLutadores();
      this._iniciarVS();
      return;
    }
    this.selecaoMapa = new SelecaoMapa(mapas);
    this.tela = TELAS.MAPA;
  }

  // Confirma o mapa: vira o estágio da luta e segue para a VS Screen.
  _confirmarMapa(mapa) {
    this.mapaEscolhido = mapa;
    if (mapa && mapa.full) this.recursos.mapa = mapa.full; // estágio da LUTA
    this._criarLutadores(); // criados aqui para a VS já mostrar HUD e sprites
    this._iniciarVS();
  }

  // Inicializa o estado da VS Screen (posições em ESPAÇO DE TELA, fora da câmera).
  _iniciarVS() {
    this.tela = TELAS.VS;
    this.roundAtual = 1; // a VS anuncia "ROUND 1"
    this.vs = {
      t: 0,
      scroll: 0,
      p1x: -260, // entra deslizando da borda esquerda
      p2x: LARGURA + 260, // entra deslizando da borda direita
      p1Alvo: LARGURA * 0.3, // para perto do centro-esquerda
      p2Alvo: LARGURA * 0.7, // para perto do centro-direita
    };
    this.musica.tocar("vs"); // trilha própria da VS Screen
  }

  // Chamada ao final da VS: começa de fato a partida/round.
  _comecarLutaAposVS() {
    this.roundsP1 = 0;
    this.roundsP2 = 0;
    this.roundAtual = 1;
    this.vencedorPartida = null;
    this._iniciarRound();
    this.tela = TELAS.LUTA;
    this.musica.tocar("luta");
  }

  // ---- Loop principal -------------------------------------------------------
  rodar() {
    // Tenta tocar a música do menu assim que o jogo inicia.
    // Se o navegador bloquear (autoplay policy), o MusicaFX reativa no 1º gesto.
    this.musica.tocar("menu");

    let anterior = performance.now();
    const passo = (agora) => {
      let dt = (agora - anterior) / 1000;
      anterior = agora;
      if (dt > 0.05) dt = 0.05;

      this._atualizar(dt);
      this._desenhar();

      this.entrada.confirmar = false;
      this.entrada.voltar = false;
      this.entrada.bordas.length = 0;
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  _atualizar(dt) {
    // --- Telas de menu ---
    if (this.tela === TELAS.START) {
      if (this.entrada.confirmar) {
        this.audio.garantir();
        this.somUI.tocar("confirmar");
        this.musica.tocar("menu");
        this.tela = TELAS.MODO;
        this.menuIndex = 0;
      }
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.MODO) {
      this._atualizarModo();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.DIFICULDADE) {
      this._atualizarDificuldade();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.SELECT) {
      this._atualizarSelect();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.MAPA) {
      this._atualizarMapa();
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.VS) {
      this._atualizarVS(dt);
      this.entrada.limparPendentes();
      return;
    }
    if (this.tela === TELAS.CONFIG) {
      this._atualizarConfig();
      this.entrada.limparPendentes();
      return;
    }

    if (this.tela === TELAS.VITORIA) {
      this.p1.atualizar(dt, false);
      this.p2.atualizar(dt, false);
      this.particulas.atualizar(dt);
      if (this.entrada.confirmar) {
        this.somUI.tocar("confirmar");
        this.musica.tocar("menu");
        this.tela = TELAS.MODO;
        this.menuIndex = 0;
      }
      this.entrada.limparPendentes();
      return;
    }

    // ----- Tela de LUTA -----
    this._atualizarShake(dt);
    this._atualizarCamera(dt);
    this.timerFase += dt;

    if (this.faseRound === "anuncio") {
      this.p1.atualizar(dt, false);
      this.p2.atualizar(dt, false);
      this.particulas.atualizar(dt);
      if (this.timerFase > 1.6) {
        this.faseRound = "lutando";
        this.timerFase = 0;
      }
      this.entrada.limparPendentes();
      return;
    }

    if (this.faseRound === "lutando") {
      // HIT STOP: congela lutadores/projéteis, mas mantém partículas e shake.
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        this.particulas.atualizar(dt);
        return; // NÃO limpa pendentes: o input fica bufferizado para o combo.
      }

      this.tempoRestante -= dt;
      if (this.tempoRestante <= 0) {
        this.tempoRestante = 0;
        this._encerrarRound(this._vencedorPorVida(), false);
      }

      this.p1.atualizar(dt, true);
      this.p2.atualizar(dt, true);
      this._resolverColisaoCorpos();
      this._resolverGolpes();
      this._atualizarProjeteis(dt);
      this.particulas.atualizar(dt);

      if (this.p1.hp <= 0) this._encerrarRound("p2", true);
      else if (this.p2.hp <= 0) this._encerrarRound("p1", true);

      this.entrada.limparPendentes();
      return;
    }

    if (this.faseRound === "fim") {
      this.p1.atualizar(dt, false);
      this.p2.atualizar(dt, false);
      this._atualizarProjeteis(dt);
      this.particulas.atualizar(dt);
      if (this.timerFase > 2.6) {
        if (this.vencedorPartida) {
          this.tela = TELAS.VITORIA;
          this.musica.tocar("vitoria");
        } else {
          this.roundAtual++;
          this._iniciarRound();
        }
      }
      this.entrada.limparPendentes();
      return;
    }
  }

  // --- Tela MODO: 1 Jogador / 2 Jogadores / Configurações ---
  _atualizarModo() {
    const total = 3;
    const anteriorIndex = this.menuIndex;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.menuIndex = (this.menuIndex + total - 1) % total;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.menuIndex = (this.menuIndex + 1) % total;
    if (this.menuIndex !== anteriorIndex) this.somUI.tocar("navegar");

    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.tela = TELAS.START;
      return;
    }

    if (this.entrada.confirmar) {
      this.somUI.tocar("confirmar");
      if (this.menuIndex === 0) {
        // 1 Jogador → tela intermediária de dificuldade.
        this.dificuldadeIndex = 1; // começa selecionado em Médio
        this.tela = TELAS.DIFICULDADE;
      } else if (this.menuIndex === 1) {
        // 2 Jogadores → direto para seleção de personagem.
        this.modo = "2p";
        this.escolha = { p1: 0, p2: 1 };
        this.confirmado = { p1: false, p2: false };
        this.tela = TELAS.SELECT;
      } else {
        // Configurações.
        this.telaAnteriorConfig = TELAS.MODO;
        this.configIndex = 0;
        this.tela = TELAS.CONFIG;
      }
    }
  }

  // --- Tela DIFICULDADE: fácil / médio / difícil (só para 1 Jogador) ---
  _atualizarDificuldade() {
    const total = 3;
    const anteriorIndex = this.dificuldadeIndex;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.dificuldadeIndex = (this.dificuldadeIndex + total - 1) % total;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.dificuldadeIndex = (this.dificuldadeIndex + 1) % total;
    if (this.dificuldadeIndex !== anteriorIndex) this.somUI.tocar("navegar");

    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.tela = TELAS.MODO;
      return;
    }

    if (this.entrada.confirmar) {
      const dificuldades = ["facil", "medio", "dificil"];
      this.modo = "1p";
      this.dificuldade = dificuldades[this.dificuldadeIndex];
      this.escolha = { p1: 0, p2: 1 };
      this.confirmado = { p1: false, p2: false };
      this.somUI.tocar("confirmar");
      this.tela = TELAS.SELECT;
    }
  }

  // --- Tela SELECT: cada jogador escolhe um dos dois personagens ---
  _atualizarSelect() {
    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.tela = TELAS.MODO;
      return;
    }
    const n = PERSONAGENS.length;

    // Jogador 1 navega com A/D e confirma com soco (F) ou Enter.
    if (!this.confirmado.p1) {
      const ant1 = this.escolha.p1;
      if (this.entrada.borda("KeyA"))
        this.escolha.p1 = (this.escolha.p1 + n - 1) % n;
      if (this.entrada.borda("KeyD"))
        this.escolha.p1 = (this.escolha.p1 + 1) % n;
      if (this.escolha.p1 !== ant1) this.somUI.tocar("personagem");
      if (this.entrada.borda(TECLAS.p1.soco)) {
        this.confirmado.p1 = true;
        this.somUI.tocar("selecionar");
      }
    }

    if (this.modo === "2p") {
      // Jogador 2 navega com ← → e confirma com soco (J).
      if (!this.confirmado.p2) {
        const ant2 = this.escolha.p2;
        if (this.entrada.borda("ArrowLeft"))
          this.escolha.p2 = (this.escolha.p2 + n - 1) % n;
        if (this.entrada.borda("ArrowRight"))
          this.escolha.p2 = (this.escolha.p2 + 1) % n;
        if (this.escolha.p2 !== ant2) this.somUI.tocar("personagem");
        if (this.entrada.borda(TECLAS.p2.soco)) {
          this.confirmado.p2 = true;
          this.somUI.tocar("selecionar");
        }
      }
      // Enter confirma quem ainda falta (atalho).
      if (this.entrada.confirmar) {
        if (!this.confirmado.p1) {
          this.confirmado.p1 = true;
          this.somUI.tocar("selecionar");
        } else if (!this.confirmado.p2) {
          this.confirmado.p2 = true;
          this.somUI.tocar("selecionar");
        }
      }
    } else {
      // 1 Player: a CPU pega o personagem oposto até o P1 confirmar.
      if (!this.confirmado.p1) this.escolha.p2 = (this.escolha.p1 + 1) % n;
      if (this.entrada.confirmar) {
        this.confirmado.p1 = true;
        this.somUI.tocar("selecionar");
      }
      this.confirmado.p2 = this.confirmado.p1;
    }

    // Personagens confirmados → seleção de ESTÁGIO (e depois a VS Screen).
    if (this.confirmado.p1 && this.confirmado.p2) this._irParaSelecaoMapa();
  }

  // --- Tela MAPA: grade de estágios; navegação por teclado e gamepad (3) ---
  _atualizarMapa() {
    const sel = this.selecaoMapa;
    if (!sel) return;
    const gp = this.gamepad.ler();

    // ESC / B volta para a seleção de personagem (re-escolher).
    if (this.entrada.voltar || gp.back) {
      this.somUI.tocar("voltar");
      this.confirmado = { p1: false, p2: false };
      this.tela = TELAS.SELECT;
      return;
    }

    // Navegação com WRAP (teclado WASD/setas + D-pad/analógico do gamepad).
    let moveu = false;
    if (this.entrada.borda("KeyA") || this.entrada.borda("ArrowLeft") || gp.left)
      moveu = sel.mover(-1, 0) || moveu;
    if (this.entrada.borda("KeyD") || this.entrada.borda("ArrowRight") || gp.right)
      moveu = sel.mover(1, 0) || moveu;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp") || gp.up)
      moveu = sel.mover(0, -1) || moveu;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown") || gp.down)
      moveu = sel.mover(0, 1) || moveu;
    if (moveu) this.somUI.tocar("navegar"); // sfx de mover cursor (sfx_cursor_move)

    // Confirmar: ENTER/Espaço, A do gamepad ou o soco do P1 (F).
    if (this.entrada.confirmar || gp.confirm || this.entrada.borda(TECLAS.p1.soco)) {
      this.somUI.tocar("confirmar"); // sfx de confirmar (sfx_confirm)
      this._confirmarMapa(sel.mapaAtual);
    }
  }

  // --- Tela VS: linha do tempo cronometrada (ver VS_TIMING) ---
  _atualizarVS(dt) {
    const vs = this.vs;
    if (!vs) return;
    vs.t += dt;

    // Scroll seamless do fundo: px/frame → px/s (referência de 60fps).
    vs.scroll += VS_TIMING.scrollPxFrame * 60 * dt;

    // FASE 0–0.5s: lutadores deslizam das bordas até o centro (ease-out cúbico).
    const k = Math.min(1, vs.t / VS_TIMING.entrada);
    const ease = 1 - Math.pow(1 - k, 3);
    vs.p1x = -260 + (vs.p1Alvo + 260) * ease;
    vs.p2x = LARGURA + 260 + (vs.p2Alvo - (LARGURA + 260)) * ease;

    // Ao fim de TODA a linha do tempo, revela o estágio e começa o round.
    const total =
      VS_TIMING.entrada + VS_TIMING.confronto + VS_TIMING.round + VS_TIMING.flash;
    if (vs.t >= total) this._comecarLutaAposVS();
  }

  // --- Tela CONFIG: ajusta configurações via CONFIGS[] ---
  _atualizarConfig() {
    const total = CONFIGS.length;
    const anteriorIndex = this.configIndex;

    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.configIndex = (this.configIndex + total - 1) % total;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.configIndex = (this.configIndex + 1) % total;
    if (this.configIndex !== anteriorIndex) this.somUI.tocar("navegar");

    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.tela = this.telaAnteriorConfig;
      return;
    }

    // Ajuste de valor do item selecionado.
    const item = CONFIGS[this.configIndex];
    if (!item) return;

    if (item.tipo === "slider") {
      let alterou = false;
      if (this.entrada.borda("KeyA") || this.entrada.borda("ArrowLeft")) {
        item.set(Math.max(item.min, +(item.get() - item.step).toFixed(2)));
        alterou = true;
      }
      if (this.entrada.borda("KeyD") || this.entrada.borda("ArrowRight")) {
        item.set(Math.min(item.max, +(item.get() + item.step).toFixed(2)));
        alterou = true;
      }
      if (alterou) {
        item.aplicar(item.get(), this);
        this.somUI.tocar("navegar");
      }
    } else if (item.tipo === "toggle") {
      if (
        this.entrada.borda("KeyA") ||
        this.entrada.borda("ArrowLeft") ||
        this.entrada.borda("KeyD") ||
        this.entrada.borda("ArrowRight") ||
        this.entrada.confirmar
      ) {
        item.set(!item.get());
        item.aplicar(item.get(), this);
        this.somUI.tocar("navegar");
      }
    }
  }

  // --- Screen shake: decai com o tempo ---
  _atualizarShake(dt) {
    if (this.shake > 0) {
      this.shake -= dt * 60; // decaimento
      if (this.shake < 0) this.shake = 0;
    }
  }
  _tremor(intensidade) {
    this.shake = Math.max(this.shake, intensidade);
  }

  // Posição-alvo da câmera (px no mundo): centraliza o meio dos dois lutadores
  // na tela, travando nas bordas do mundo para nunca mostrar fora da arena.
  _alvoCamera() {
    if (!this.p1 || !this.p2) return 0;
    const meio = (this.p1.x + this.p2.x) / 2;
    let cam = meio - LARGURA / 2;
    const max = MUNDO_L - LARGURA;
    if (cam < 0) cam = 0;
    if (cam > max) cam = max;
    return cam;
  }

  // Move a câmera suavemente em direção ao alvo (segue a luta sem solavancos).
  _atualizarCamera(dt) {
    const alvo = this._alvoCamera();
    this.cameraX += (alvo - this.cameraX) * Math.min(1, dt * 8);
  }

  _resolverColisaoCorpos() {
    const a = this.p1.hurtbox();
    const b = this.p2.hurtbox();
    if (!colideAABB(a, b)) return;

    // ── CROSSOVER JUMP ────────────────────────────────────────────────────────
    // Se um lutador está no ar com os pés acima de alturaMinCrossover relativo
    // aos pés do oponente, suspende a separação horizontal — isso permite pular
    // por cima do adversário e pousar do outro lado.
    // O facing já atualiza automaticamente ao cruzar o x do oponente (durante
    // JUMP o podeAgir() é true, então o facing recalcula frame a frame).
    const limiar = CONFIG.movimento.alturaMinCrossover;
    if (!this.p1.noChao && this.p1.y < this.p2.y - limiar) return; // p1 cruzando
    if (!this.p2.noChao && this.p2.y < this.p1.y - limiar) return; // p2 cruzando
    // ─────────────────────────────────────────────────────────────────────────

    const sobreposicao = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const metade = sobreposicao / 2;
    if (this.p1.x < this.p2.x) {
      this.p1.x -= metade;
      this.p2.x += metade;
    } else {
      this.p1.x += metade;
      this.p2.x -= metade;
    }
  }

  _resolverGolpes() {
    this._checarGolpe(this.p1, this.p2);
    this._checarGolpe(this.p2, this.p1);
  }

  _checarGolpe(atacante, alvo) {
    if (atacante.golpeAcertou) return;
    const hit = atacante.hitbox();
    if (!hit) return;
    if (!alvo.estaVivo()) return;
    const g = atacante.golpes[atacante.golpeAtual];
    // HITBOX INFERIOR: o golpe testa colisão contra a REGIÃO da hurtbox que
    // corresponde à sua altura. Um golpe "baixo" precisa alcançar o quadrante
    // inferior (pernas/pés); um "alto" passa por cima de quem está agachado.
    const tipoAltura = (g && g.tipo_altura) || "medio";
    const alvoBox = alvo.hurtboxPara(tipoAltura);
    if (colideAABB(hit, alvoBox)) {
      const res = alvo.receberGolpe({
        dano: g.dano,
        knockback: g.knockback,
        derruba: g.derruba,
        origemX: atacante.x,
        ignoraBloqueio: !!g.ignoraBloqueio,
        tipoAltura, // usado pela validação de DEFESA_ALTA vs DEFESA_BAIXA
      });
      atacante.golpeAcertou = true;

      // Abre a janela de cancelamento se o golpe for cancelável (combo).
      if (g.cancelavel)
        atacante.janelaCancel = CONFIG.combo.janelaCancelMs / 1000;

      // Feedback (juice) — centralizado para corpo-a-corpo e agarrão.
      const px = hit.x + hit.w / 2;
      const py = hit.y + hit.h / 2;
      this._feedbackAcerto(
        atacante,
        alvo,
        res,
        res.dano ?? g.dano,
        px,
        py,
        false,
      );
    }
  }

  _atualizarProjeteis(dt) {
    for (const p of this.projeteis) {
      p.atualizar(dt);
      const alvo = p.dono === this.p1 ? this.p2 : this.p1;
      if (p.vivo && alvo.estaVivo() && colideAABB(p.caixa(), alvo.hurtbox())) {
        const res = alvo.receberGolpe({
          dano: p.dano,
          knockback: 180,
          derruba: p.tipo === "super",
          origemX: p.x,
        });
        p.vivo = false;
        this._feedbackAcerto(p.dono, alvo, res, p.dano, p.x, p.y, true);
      }
    }
    this.projeteis = this.projeteis.filter((p) => p.vivo);

    if (this.faseRound === "lutando") {
      if (this.p1.hp <= 0) this._encerrarRound("p2", true);
      else if (this.p2.hp <= 0) this._encerrarRound("p1", true);
    }
  }

  /* Centraliza TODO o "game feel" de um acerto: hit stop, knockback (já aplicado
     no Fighter), screen shake, faíscas e som. */
  _feedbackAcerto(atacante, alvo, res, dano, px, py, ehProjetil) {
    if (!res || res.ignorado) return;

    if (res.bloqueado) {
      this.particulas.faiscas(
        px,
        py,
        CONFIG.particulas.faiscasBloqueio,
        "#cfe8ff",
        160,
      );
      this.audio.bloqueio();
      this.hitStop = Math.max(this.hitStop, 0.03);
      this._tremor(CONFIG.gameFeel.shakeHit * 0.4);
      return;
    }

    // Ganho de especial para quem acertou.
    atacante.ganharEspecial(CONFIG.especial.ganhoAoAcertar);

    // Faíscas proporcionais ao dano (mais no projétil).
    const n = ehProjetil
      ? CONFIG.particulas.faiscasProjetil
      : CONFIG.particulas.faiscasAcerto;
    this.particulas.faiscas(
      px,
      py,
      n,
      ehProjetil ? "#fff2a8" : "#ffcf6b",
      240 + dano * 10,
    );

    if (res.ko) {
      // KO: hit stop e tremor grandes.
      this.hitStop = Math.max(this.hitStop, CONFIG.gameFeel.hitStopKO / 1000);
      this._tremor(CONFIG.gameFeel.shakeKO);
      this.particulas.faiscas(px, py, 26, "#fff", 360);
      this.audio.ko();
    } else {
      // Hit stop proporcional ao dano (com teto).
      const hs = Math.min(
        CONFIG.gameFeel.hitStopMax,
        CONFIG.gameFeel.hitStopMs + dano * CONFIG.gameFeel.hitStopPorDano,
      );
      this.hitStop = Math.max(this.hitStop, hs / 1000);
      this._tremor(
        ehProjetil
          ? CONFIG.gameFeel.shakeProjetil
          : CONFIG.gameFeel.shakeHit + dano * 0.2,
      );
      this.audio.acerto();
    }
  }

  _vencedorPorVida() {
    if (this.p1.hp > this.p2.hp) return "p1";
    if (this.p2.hp > this.p1.hp) return "p2";
    return "empate";
  }

  _encerrarRound(vencedor, porKO) {
    if (this.faseRound !== "lutando") return;
    this.faseRound = "fim";
    this.timerFase = 0;
    this.vencedorRound = vencedor;
    this.terminouPorKO = porKO;

    if (vencedor === "p1") {
      this.roundsP1++;
      this.p1.irPara(ESTADOS.VICTORY, true);
      if (this.p2.estaVivo()) this.p2.irPara(ESTADOS.IDLE, true);
    } else if (vencedor === "p2") {
      this.roundsP2++;
      this.p2.irPara(ESTADOS.VICTORY, true);
      if (this.p1.estaVivo()) this.p1.irPara(ESTADOS.IDLE, true);
    }

    if (this.roundsP1 >= ROUNDS_PARA_VENCER) this.vencedorPartida = "p1";
    else if (this.roundsP2 >= ROUNDS_PARA_VENCER) this.vencedorPartida = "p2";
  }

  // ---- Renderização ---------------------------------------------------------
  _desenhar() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, LARGURA, ALTURA);

    // Telas de menu (sem shake).
    if (this.tela === TELAS.START) {
      this._desenharCenario(ctx);
      this._desenharStart(ctx);
      return;
    }
    if (this.tela === TELAS.MODO) {
      this._desenharCenario(ctx);
      this._desenharModo(ctx);
      return;
    }
    if (this.tela === TELAS.DIFICULDADE) {
      this._desenharCenario(ctx);
      this._desenharDificuldade(ctx);
      return;
    }
    if (this.tela === TELAS.SELECT) {
      this._desenharCenario(ctx);
      this._desenharSelect(ctx);
      return;
    }
    if (this.tela === TELAS.MAPA) {
      this._desenharCenario(ctx);
      this._desenharMapaSelect(ctx);
      return;
    }
    if (this.tela === TELAS.VS) {
      this._desenharVS(ctx);
      return;
    }
    if (this.tela === TELAS.CONFIG) {
      this._desenharCenario(ctx);
      this._desenharConfig(ctx);
      return;
    }

    // Tela de vitória: arena + sprites animando e o texto central.
    if (this.tela === TELAS.VITORIA) {
      ctx.save();
      ctx.translate(-Math.round(this.cameraX), 0); // mantém a câmera da luta
      this._desenharArena(ctx);
      this.p1.desenhar(ctx, this.debug);
      this.p2.desenhar(ctx, this.debug);
      this.particulas.desenhar(ctx);
      ctx.restore();
      this._desenharVitoria(ctx);
      return;
    }

    // Tela de LUTA — mundo com screen shake + câmera que segue a luta.
    ctx.save();
    if (this.shake > 0) {
      const dx = (Math.random() - 0.5) * this.shake;
      const dy = (Math.random() - 0.5) * this.shake;
      ctx.translate(dx, dy);
    }
    ctx.translate(-Math.round(this.cameraX), 0); // desloca o mundo sob a tela
    this._desenharArena(ctx);
    this.p1.desenhar(ctx, this.debug);
    this.p2.desenhar(ctx, this.debug);
    for (const p of this.projeteis) p.desenhar(ctx);
    this.particulas.desenhar(ctx);
    ctx.restore();

    // HUD e textos centrais (fora do shake).
    this._desenharHUD(ctx);
    if (this.faseRound === "anuncio") this._desenharAnuncio(ctx);
    if (this.faseRound === "fim") this._desenharFimRound(ctx);
  }

  _desenharCenario(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, ALTURA);
    g.addColorStop(0, "#2a1a3a");
    g.addColorStop(0.6, "#1a1426");
    g.addColorStop(1, "#0c0a14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    ctx.fillStyle = "rgba(255,240,200,0.12)";
    ctx.beginPath();
    ctx.arc(LARGURA * 0.78, 110, 70, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#211a2e";
    ctx.fillRect(0, CHAO_Y, LARGURA, ALTURA - CHAO_Y);
    ctx.fillStyle = "#3a2f4f";
    ctx.fillRect(0, CHAO_Y, LARGURA, 6);
  }

  // Fundo da ARENA inteira (largura = MUNDO_L). Desenhado sob a câmera.
  // Usa a imagem assets/mapas/arena.png se existir; senão, cai no procedural.
  _desenharArena(ctx) {
    if (this.recursos && this.recursos.mapa) {
      // A imagem é esticada para ocupar o mundo inteiro (MUNDO_L x ALTURA).
      // Para 1:1, exporte o PNG já em MUNDO_L x ALTURA (ex.: 1920x540).
      ctx.drawImage(this.recursos.mapa, 0, 0, MUNDO_L, ALTURA);
      return;
    }

    // Fallback procedural: mesmo visual de antes, porém cobrindo todo o mundo.
    const g = ctx.createLinearGradient(0, 0, 0, ALTURA);
    g.addColorStop(0, "#2a1a3a");
    g.addColorStop(0.6, "#1a1426");
    g.addColorStop(1, "#0c0a14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, MUNDO_L, ALTURA);

    ctx.fillStyle = "rgba(255,240,200,0.12)";
    ctx.beginPath();
    ctx.arc(MUNDO_L * 0.78, 110, 70, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#211a2e";
    ctx.fillRect(0, CHAO_Y, MUNDO_L, ALTURA - CHAO_Y);
    ctx.fillStyle = "#3a2f4f";
    ctx.fillRect(0, CHAO_Y, MUNDO_L, 6);
  }

  _barraVida(ctx, x, y, w, h, hp, daDireita) {
    const frac = Math.max(0, hp / VIDA_MAX);
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#5a1010";
    ctx.fillRect(x, y, w, h);
    const larguraVida = w * frac;
    let cor = "#36d23a";
    if (frac < 0.5) cor = "#e0c020";
    if (frac < 0.25) cor = "#e03020";
    ctx.fillStyle = cor;
    if (daDireita) ctx.fillRect(x + (w - larguraVida), y, larguraVida, h);
    else ctx.fillRect(x, y, larguraVida, h);
    ctx.strokeStyle = "#e8e2f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // NOVO: barra de especial (mais fina, sob a vida; brilha quando cheia).
  _barraEspecial(ctx, x, y, w, h, valor, daDireita) {
    const frac = Math.max(0, valor / CONFIG.especial.max);
    const cheia = valor >= CONFIG.especial.custo;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#101830";
    ctx.fillRect(x, y, w, h);
    const lw = w * frac;
    if (cheia) {
      const pulso = 0.6 + 0.4 * Math.sin(performance.now() / 120);
      ctx.fillStyle = `rgba(255,226,77,${pulso})`;
    } else {
      ctx.fillStyle = "#39b6ff";
    }
    if (daDireita) ctx.fillRect(x + (w - lw), y, lw, h);
    else ctx.fillRect(x, y, lw, h);
    ctx.strokeStyle = cheia ? "#ffe24d" : "#5a7aa0";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  _pipsRounds(ctx, x, y, ganhos, daDireita) {
    for (let i = 0; i < ROUNDS_PARA_VENCER; i++) {
      const px = daDireita ? x - i * 22 : x + i * 22;
      ctx.beginPath();
      ctx.arc(px, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = i < ganhos ? "#ffd34d" : "rgba(255,255,255,0.2)";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _desenharHUD(ctx) {
    const w = 360,
      h = 22,
      y = 24;
    this._barraVida(ctx, 30, y, w, h, this.p1.hp, false);
    this._barraVida(ctx, LARGURA - 30 - w, y, w, h, this.p2.hp, true);

    // Barras de especial (logo abaixo da vida).
    this._barraEspecial(ctx, 30, y + h + 4, w, 8, this.p1.especial, false);
    this._barraEspecial(
      ctx,
      LARGURA - 30 - w,
      y + h + 4,
      w,
      8,
      this.p2.especial,
      true,
    );

    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(this.p1.nome, 30, y + h + 34);
    ctx.textAlign = "right";
    ctx.fillText(
      this.p2.nome + (this.modo === "1p" ? "  (CPU)" : ""),
      LARGURA - 30,
      y + h + 34,
    );

    this._pipsRounds(ctx, 36, y + h + 50, this.roundsP1, false);
    this._pipsRounds(ctx, LARGURA - 36, y + h + 50, this.roundsP2, true);

    ctx.fillStyle = "#000";
    ctx.fillRect(LARGURA / 2 - 38, y - 4, 76, h + 8);
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 30px 'Segoe UI', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      String(Math.ceil(this.tempoRestante)).padStart(2, "0"),
      LARGURA / 2,
      y + h - 1,
    );
  }

  _textoCentral(ctx, titulo, sub, corTitulo, tamanho = 56) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, ALTURA / 2 - 70, LARGURA, 140);
    ctx.fillStyle = corTitulo || "#ffd34d";
    ctx.font = `bold ${tamanho}px 'Segoe UI', sans-serif`;
    ctx.fillText(titulo, LARGURA / 2, ALTURA / 2);
    if (sub) {
      ctx.fillStyle = "#fff";
      ctx.font = "20px 'Segoe UI', sans-serif";
      ctx.fillText(sub, LARGURA / 2, ALTURA / 2 + 42);
    }
  }

  _desenharAnuncio(ctx) {
    const mostrarLutar = this.timerFase > 0.9;
    this._textoCentral(
      ctx,
      mostrarLutar ? "FIGHT!" : "ROUND " + this.roundAtual,
      null,
      mostrarLutar ? "#36d23a" : "#ffd34d",
    );
  }

  _desenharFimRound(ctx) {
    // KO recebe destaque "K.O.".
    if (this.terminouPorKO && this.timerFase < 1.3) {
      this._textoCentral(ctx, "K.O.", null, "#e03020", 96);
      return;
    }
    let texto = "EMPATE";
    if (this.vencedorRound === "p1") texto = this.p1.nome + " VENCE O ROUND";
    else if (this.vencedorRound === "p2")
      texto = this.p2.nome + " VENCE O ROUND";
    this._textoCentral(ctx, texto, null, "#ffd34d", 40);
  }

  _desenharVitoria(ctx) {
    const v = this.vencedorPartida === "p1" ? this.p1 : this.p2;
    this._textoCentral(
      ctx,
      v.nome.toUpperCase() + " VENCEU!",
      "Pressione ENTER para jogar de novo",
      "#ffd34d",
    );
  }

  // ---- Tela inicial (título) -----------------------------------------------
  _desenharStart(ctx) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 62px 'Segoe UI', sans-serif";
    ctx.fillText("MANSÃO FIGHT", LARGURA / 2, 140);

    ctx.fillStyle = "#cfc6e0";
    ctx.font = "22px 'Segoe UI', sans-serif";
    ctx.fillText(
      this.recursos.nome("p1") + "  VS  " + this.recursos.nome("p2"),
      LARGURA / 2,
      184,
    );

    // Tabela rápida de comandos (atualizada com agarrão/especial).
    const linhas1 = [
      "JOGADOR 1",
      "A / D andar   W pular   S agachar",
      "F soco   G chute   H projétil",
      "C agarrão   V especial   R defender",
    ];
    const linhas2 = [
      "JOGADOR 2",
      "← / → andar   ↑ pular   ↓ agachar",
      "J soco   K chute   L projétil",
      "N agarrão   M especial   P defender",
    ];
    ctx.font = "16px 'Segoe UI', monospace";
    const desenhaCol = (linhas, cx) => {
      let y = 250;
      for (let i = 0; i < linhas.length; i++) {
        ctx.fillStyle = i === 0 ? "#5cd6ff" : "#e8e2f0";
        ctx.font =
          i === 0
            ? "bold 20px 'Segoe UI', sans-serif"
            : "15px 'Segoe UI', monospace";
        ctx.fillText(linhas[i], cx, y);
        y += 28;
      }
    };
    desenhaCol(linhas1, LARGURA * 0.28);
    desenhaCol(linhas2, LARGURA * 0.72);

    ctx.fillStyle = "#9b90b5";
    ctx.font = "15px 'Segoe UI', sans-serif";
    ctx.fillText(
      "Combos: cancele soco→chute/especial • barra cheia libera o especial • F1 = debug",
      LARGURA / 2,
      410,
    );

    if (Math.floor(performance.now() / 500) % 2 === 0) {
      ctx.fillStyle = "#ffd34d";
      ctx.font = "bold 26px 'Segoe UI', sans-serif";
      ctx.fillText("Pressione ENTER para começar", LARGURA / 2, 470);
    }

    if (this.recursos.faltando > 0) {
      ctx.fillStyle = "#e05050";
      ctx.font = "14px 'Segoe UI', sans-serif";
      ctx.fillText(
        this.recursos.faltando + " imagem(ns) ausente(s): usando placeholders",
        LARGURA / 2,
        510,
      );
    }
  }

  // ---- Tela de configurações -----------------------------------------------
  _desenharConfig(ctx) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 48px 'Segoe UI', sans-serif";
    ctx.fillText("CONFIGURAÇÕES", LARGURA / 2, 110);

    const itemH = 80; // altura por item
    const totalH = CONFIGS.length * itemH;
    const startY = ALTURA / 2 - totalH / 2 + 20;
    const sliderW = 320; // largura da barra de slider

    for (let i = 0; i < CONFIGS.length; i++) {
      const item = CONFIGS[i];
      const sel = i === this.configIndex;
      const cy = startY + i * itemH;

      // Fundo do item selecionado.
      if (sel) {
        ctx.fillStyle = "rgba(255,211,77,0.10)";
        ctx.fillRect(LARGURA / 2 - 360, cy - 30, 720, 58);
      }

      // Label.
      ctx.fillStyle = sel ? "#ffd34d" : "#cfc6e0";
      ctx.font = sel
        ? "bold 22px 'Segoe UI', sans-serif"
        : "20px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(item.label, LARGURA / 2 - sliderW / 2 - 24, cy + 6);

      if (item.tipo === "slider") {
        const val = item.get();
        const frac = (val - item.min) / (item.max - item.min);
        const sx = LARGURA / 2 - sliderW / 2;

        // Trilha.
        ctx.fillStyle = "#1a1430";
        ctx.fillRect(sx, cy - 8, sliderW, 16);
        ctx.strokeStyle = sel ? "#ffd34d" : "#5a5070";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, cy - 8, sliderW, 16);

        // Preenchimento.
        ctx.fillStyle = sel ? "#ffd34d" : "#7a60cc";
        ctx.fillRect(sx, cy - 8, sliderW * frac, 16);

        // Alça.
        const hx = sx + sliderW * frac;
        ctx.fillStyle = sel ? "#fff" : "#cfc6e0";
        ctx.beginPath();
        ctx.arc(hx, cy, 11, 0, Math.PI * 2);
        ctx.fill();

        // Setas e percentual.
        ctx.textAlign = "left";
        ctx.fillStyle = sel ? "#ffd34d" : "#9b90b5";
        ctx.font = sel
          ? "bold 20px 'Segoe UI', sans-serif"
          : "18px 'Segoe UI', sans-serif";
        const pct = Math.round(val * 100) + "%";
        ctx.fillText(sel ? `◀  ${pct}  ▶` : pct, sx + sliderW + 18, cy + 7);
      } else if (item.tipo === "toggle") {
        const ligado = item.get();
        ctx.textAlign = "left";
        const tx = LARGURA / 2 - sliderW / 2;
        ctx.fillStyle = ligado ? "#36d23a" : "#e03020";
        ctx.font = sel
          ? "bold 22px 'Segoe UI', sans-serif"
          : "20px 'Segoe UI', sans-serif";
        ctx.fillText(
          ligado
            ? sel
              ? "◀  LIGADO  ▶"
              : "LIGADO"
            : sel
              ? "◀  DESLIGADO  ▶"
              : "DESLIGADO",
          tx,
          cy + 7,
        );
      }
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ para navegar  •  ←/→ para ajustar  •  ESC volta",
      LARGURA / 2,
      468,
    );
  }

  // ---- Tela de seleção de modo ---------------------------------------------
  _desenharModo(ctx) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 48px 'Segoe UI', sans-serif";
    ctx.fillText("MODO DE JOGO", LARGURA / 2, 105);

    const opcoes = [
      { label: "1 JOGADOR", sub: "Enfrenta a inteligência artificial" },
      { label: "2 JOGADORES", sub: "Partida local entre dois jogadores" },
      { label: "⚙  CONFIGURAÇÕES", sub: "Ajuste volume e outras opções" },
    ];
    let y = 205;
    for (let i = 0; i < opcoes.length; i++) {
      const sel = i === this.menuIndex;
      ctx.fillStyle = sel ? "#ffd34d" : "#cfc6e0";
      ctx.font = sel
        ? "bold 30px 'Segoe UI', sans-serif"
        : "24px 'Segoe UI', sans-serif";
      ctx.fillText((sel ? "▶  " : "   ") + opcoes[i].label, LARGURA / 2, y);
      ctx.fillStyle = sel ? "rgba(255,211,77,0.6)" : "rgba(207,198,224,0.45)";
      ctx.font = "15px 'Segoe UI', sans-serif";
      ctx.fillText(opcoes[i].sub, LARGURA / 2, y + 22);
      y += 72;
    }

    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ para escolher  •  ENTER confirma  •  ESC volta",
      LARGURA / 2,
      468,
    );
  }

  // ---- Tela de seleção de dificuldade (1 Jogador) --------------------------
  _desenharDificuldade(ctx) {
    ctx.textAlign = "center";

    // Título com breadcrumb.
    ctx.fillStyle = "rgba(207,198,224,0.5)";
    ctx.font = "18px 'Segoe UI', sans-serif";
    ctx.fillText("1 JOGADOR", LARGURA / 2, 68);
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 48px 'Segoe UI', sans-serif";
    ctx.fillText("DIFICULDADE", LARGURA / 2, 118);

    const opcoes = [
      {
        label: "FÁCIL",
        cor: "#36d23a",
        sub: "IA reage mais devagar, ideal para começar",
      },
      {
        label: "MÉDIO",
        cor: "#ffd34d",
        sub: "Equilíbrio entre desafio e diversão",
      },
      {
        label: "DIFÍCIL",
        cor: "#e03020",
        sub: "IA agressiva e precisa — sem piedade",
      },
    ];
    let y = 200;
    for (let i = 0; i < opcoes.length; i++) {
      const sel = i === this.dificuldadeIndex;
      const op = opcoes[i];

      if (sel) {
        ctx.fillStyle = "rgba(255,211,77,0.08)";
        ctx.fillRect(LARGURA / 2 - 300, y - 32, 600, 66);
      }

      ctx.fillStyle = sel ? op.cor : "rgba(207,198,224,0.55)";
      ctx.font = sel
        ? "bold 32px 'Segoe UI', sans-serif"
        : "26px 'Segoe UI', sans-serif";
      ctx.fillText((sel ? "▶  " : "   ") + op.label, LARGURA / 2, y);

      ctx.fillStyle = sel ? "rgba(255,255,255,0.65)" : "rgba(207,198,224,0.35)";
      ctx.font = "15px 'Segoe UI', sans-serif";
      ctx.fillText(op.sub, LARGURA / 2, y + 22);

      y += 80;
    }

    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ para escolher  •  ENTER confirma  •  ESC volta",
      LARGURA / 2,
      468,
    );
  }

  // ---- Tela de seleção de personagem ---------------------------------------
  _desenharSelect(ctx) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 44px 'Segoe UI', sans-serif";
    ctx.fillText("ESCOLHA SEU LUTADOR", LARGURA / 2, 96);

    // Dois painéis (P1 à esquerda, P2/CPU à direita).
    const painel = (titulo, idx, confirmado, cx, ehCPU) => {
      const pers = PERSONAGENS[idx];
      const cw = 220,
        ch = 220,
        bx = cx - cw / 2,
        by = 150;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(bx, by, cw, ch);
      ctx.strokeStyle = confirmado ? "#36d23a" : "#5cd6ff";
      ctx.lineWidth = 4;
      ctx.strokeRect(bx, by, cw, ch);

      // Retrato: usa a foto real (silva.png/vitor.png) recortada para preencher
      // o quadrado mantendo a proporção (efeito "cover"); cai no sprite idle se
      // a foto não estiver disponível.
      const foto = this.recursos.retrato(pers);
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, cw, ch);
      ctx.clip();
      if (foto) {
        const escala = Math.max(cw / foto.width, ch / foto.height);
        const dw = foto.width * escala,
          dh = foto.height * escala;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(foto, cx - dw / 2, by + (ch - dh) / 2, dw, dh);
      } else {
        const fr = this.recursos.frame(pers, "idle", 0);
        if (fr && fr.ok) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(fr.img, cx - 110, by, 220, 220);
        }
      }
      ctx.restore();
      // Nome + título.
      ctx.fillStyle = "#5cd6ff";
      ctx.font = "bold 22px 'Segoe UI', sans-serif";
      ctx.fillText(titulo, cx, by - 18);
      ctx.fillStyle = confirmado ? "#36d23a" : "#fff";
      ctx.font = "bold 26px 'Segoe UI', sans-serif";
      ctx.fillText(this.recursos.nome(pers), cx, by + ch + 38);
      ctx.fillStyle = confirmado ? "#36d23a" : "#9b90b5";
      ctx.font = "16px 'Segoe UI', sans-serif";
      ctx.fillText(
        confirmado ? "PRONTO!" : ehCPU ? "CPU escolhe" : "◀  trocar  ▶",
        cx,
        by + ch + 64,
      );
    };

    painel(
      "JOGADOR 1",
      this.escolha.p1,
      this.confirmado.p1,
      LARGURA * 0.3,
      false,
    );
    painel(
      this.modo === "1p" ? "CPU" : "JOGADOR 2",
      this.escolha.p2,
      this.confirmado.p2,
      LARGURA * 0.7,
      this.modo === "1p",
    );

    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    const dica =
      this.modo === "2p"
        ? "P1: A/D e F p/ confirmar  •  P2: ←/→ e J p/ confirmar  •  ESC volta"
        : "A/D para trocar  •  ENTER/F confirma  •  ESC volta";
    ctx.fillText(dica, LARGURA / 2, 500);
  }

  /* =========================================================================
     SELEÇÃO DE MAPA + VS SCREEN — (2) MÓDULO DE UI / RENDERIZAÇÃO
     Estética arcade CRT: paleta de 4 tons (fundo púrpura escuro, ciano, âmbar,
     branco), bordas pixel (cantos marcados, sem border-radius), miniaturas em
     letterbox e cursor piscante de alto contraste.
     ========================================================================= */

  // Linhas de varredura (scanlines) leves — textura "monitor CRT".
  _scanlines(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#000";
    for (let y = 0; y < ALTURA; y += 3) ctx.fillRect(0, y, LARGURA, 1);
    ctx.restore();
  }

  // Desenha uma miniatura (canvas 16:9) dentro de um retângulo, com letterbox
  // preto e pixels nítidos (sem suavização) — combina com a estética retrô.
  _desenharThumb(ctx, thumb, x, y, w, h) {
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    if (!thumb) return;
    const escala = Math.min(w / thumb.width, h / thumb.height);
    const dw = thumb.width * escala;
    const dh = thumb.height * escala;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(thumb, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  // Cantos marcados estilo pixel-art (4 "Ls" nas quinas de um retângulo).
  _cantosPixel(ctx, x, y, w, h, t, cor) {
    ctx.fillStyle = cor;
    const c = [
      [x, y, t, t * 4],
      [x, y, t * 4, t], // sup-esq
      [x + w - t, y, t, t * 4],
      [x + w - t * 4, y, t * 4, t], // sup-dir
      [x, y + h - t * 4, t, t * 4],
      [x, y + h - t, t * 4, t], // inf-esq
      [x + w - t, y + h - t * 4, t, t * 4],
      [x + w - t * 4, y + h - t, t * 4, t], // inf-dir
    ];
    for (const r of c) ctx.fillRect(r[0], r[1], r[2], r[3]);
  }

  // ---- Tela de SELEÇÃO DE MAPA ("SELECT STAGE") ----------------------------
  _desenharMapaSelect(ctx) {
    const sel = this.selecaoMapa;
    const agora = performance.now();

    // Título "SELECT STAGE" com brilho pulsante suave.
    const pulso = 0.55 + 0.45 * Math.sin(agora / 350);
    ctx.save();
    ctx.textAlign = "center";
    ctx.shadowColor = "#5cd6ff";
    ctx.shadowBlur = 26 * pulso;
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 40px 'Segoe UI', monospace";
    ctx.fillText("SELECT STAGE", LARGURA / 2, 66);
    ctx.restore();

    const mapas = sel.mapas;
    const cols = sel.cols;
    const linhas = sel.linhas;

    // Área da grade e tamanho de célula que acomoda cols×linhas.
    const areaX = 60;
    const areaY = 96;
    const areaW = LARGURA - 120;
    const areaH = 372;
    const gap = 18;
    const cellW = (areaW - gap * (cols - 1)) / cols;
    let cellH = (areaH - gap * (linhas - 1)) / linhas;
    cellH = Math.min(cellH, cellW * 0.62 + 28); // não deixa a célula esticar demais
    const tiraNome = 26; // faixa do nome embaixo da miniatura
    const gridH = cellH * linhas + gap * (linhas - 1);
    const startY = areaY + Math.max(0, (areaH - gridH) / 2);

    for (let idx = 0; idx < mapas.length; idx++) {
      const col = idx % cols;
      const lin = Math.floor(idx / cols);
      const x = areaX + col * (cellW + gap);
      const y = startY + lin * (cellH + gap);
      const m = mapas[idx];
      const ehSel = idx === sel.indice;

      // Miniatura (proporção preservada com letterbox).
      const thumbH = cellH - tiraNome;
      this._desenharThumb(ctx, m.thumb, x, y, cellW, thumbH);

      // Faixa do nome (fonte arcade/maiúsculas).
      ctx.fillStyle = ehSel ? "#ffd34d" : "#1a1430";
      ctx.fillRect(x, y + thumbH, cellW, tiraNome);
      ctx.fillStyle = ehSel ? "#1a1430" : "#cfc6e0";
      ctx.font = "bold 13px 'Segoe UI', monospace";
      ctx.textAlign = "center";
      ctx.fillText(m.nome, x + cellW / 2, y + thumbH + 18);

      // Borda pixel (cantos marcados, sem arredondamento).
      ctx.strokeStyle = "#3a2f4f";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, cellW - 3, cellH - 3);
      this._cantosPixel(ctx, x, y, cellW, cellH, 3, "#5a4a7a");

      // CURSOR animado: borda piscante de alto contraste (ciano ↔ branco).
      if (ehSel) {
        const on = Math.floor(agora / 110) % 2 === 0;
        ctx.strokeStyle = on ? "#5cd6ff" : "#ffffff";
        ctx.lineWidth = 4;
        ctx.strokeRect(x - 3, y - 3, cellW + 6, cellH + 6);
        this._cantosPixel(ctx, x - 3, y - 3, cellW + 6, cellH + 6, 4, on ? "#ffffff" : "#5cd6ff");
      }
    }

    // Rodapé com instruções.
    ctx.textAlign = "center";
    ctx.fillStyle = "#9b90b5";
    ctx.font = "15px 'Segoe UI', monospace";
    ctx.fillText(
      "↑ ↓ ← → mover  •  ENTER / F confirma  •  ESC volta",
      LARGURA / 2,
      ALTURA - 18,
    );

    this._scanlines(ctx);
  }

  // ---- VS SCREEN -----------------------------------------------------------
  // Fundo com scroll horizontal SEAMLESS (direita → esquerda). Estruturado como
  // lista de camadas para suportar parallax: hoje há 1 camada (a imagem do mapa),
  // mas camadas extras com velocidades diferentes entrariam aqui sem retrabalho.
  _desenharScrollVS(ctx, scroll) {
    const img = this.recursos && this.recursos.mapa;
    if (!img || !img.width) {
      // Sem imagem: cai no cenário procedural (cobrindo a tela toda).
      this._desenharCenario(ctx);
      return;
    }
    // Escala a imagem para COBRIR a altura da tela, preservando a proporção.
    const escala = ALTURA / img.height;
    const sw = img.width * escala; // largura de UMA cópia desenhada
    let off = scroll % sw;
    if (off < 0) off += sw;
    ctx.imageSmoothingEnabled = false;
    // Tile horizontal: desenha cópias lado a lado até cobrir a tela (loop perfeito).
    for (let x = -off; x < LARGURA; x += sw) {
      ctx.drawImage(img, x, 0, sw, ALTURA);
    }
  }

  // Desenha um lutador (sprite idle) em ESPAÇO DE TELA, virado para o centro.
  _desenharLutadorVS(ctx, pers, x, facing) {
    const fr = this.recursos.frame(pers, "idle", 0);
    const dw = this.recursos.frameW * ESCALA;
    const dh = this.recursos.frameH * ESCALA;
    const dx = x - dw / 2;
    const dy = CHAO_Y - dh; // pés no chão

    // Sombra simples sob os pés.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, CHAO_Y, 72, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (facing === -1) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }
    if (fr && fr.ok) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fr.img, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  // HUD da VS: barras de vida/especial, nomes e pips de round (antecipação).
  _desenharHUDVS(ctx) {
    const w = 360;
    const h = 22;
    const y = 24;
    this._barraVida(ctx, 30, y, w, h, this.p1.hp, false);
    this._barraVida(ctx, LARGURA - 30 - w, y, w, h, this.p2.hp, true);
    this._barraEspecial(ctx, 30, y + h + 4, w, 8, this.p1.especial, false);
    this._barraEspecial(ctx, LARGURA - 30 - w, y + h + 4, w, 8, this.p2.especial, true);
    this._pipsRounds(ctx, 36, y + h + 24, this.roundsP1, false);
    this._pipsRounds(ctx, LARGURA - 36, y + h + 24, this.roundsP2, true);
  }

  _desenharVS(ctx) {
    const vs = this.vs;
    if (!vs) return;
    const T = VS_TIMING;
    const total = T.entrada + T.confronto + T.round + T.flash;

    // 1) FUNDO ANIMADO — scroll seamless do estágio escolhido.
    this._desenharScrollVS(ctx, vs.scroll);
    // Escurece levemente para destacar lutadores e o "VS".
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // 2) LUTADORES deslizando das bordas (P1 esquerda, P2 direita), se encarando.
    const persP1 = PERSONAGENS[this.escolha.p1];
    const persP2 = PERSONAGENS[this.escolha.p2];
    this._desenharLutadorVS(ctx, persP1, vs.p1x, 1);
    this._desenharLutadorVS(ctx, persP2, vs.p2x, -1);

    // Nomes abaixo de cada sprite (fonte arcade/maiúsculas).
    ctx.textAlign = "center";
    ctx.font = "bold 18px 'Segoe UI', monospace";
    ctx.fillStyle = "#5cd6ff";
    ctx.fillText(this.p1.nome.toUpperCase(), vs.p1x, ALTURA - 18);
    ctx.fillText(
      this.p2.nome.toUpperCase() + (this.modo === "1p" ? " (CPU)" : ""),
      vs.p2x,
      ALTURA - 18,
    );

    // 3) HUD topo (barras + pips) para criar antecipação.
    this._desenharHUDVS(ctx);

    // 4) ELEMENTO "VS" central com entrada dramática (escala + flash).
    let escalaVS = 1;
    let flashVS = 0;
    if (vs.t < T.entrada) {
      const k = vs.t / T.entrada; // 0→1 durante a entrada
      escalaVS = 2.6 - 1.6 * (1 - Math.pow(1 - k, 2)); // grande → 1 (ease-out)
      flashVS = 1 - k; // clarão que some
    } else {
      escalaVS = 1 + 0.06 * Math.sin(performance.now() / 170); // pulso sutil
    }
    ctx.save();
    ctx.translate(LARGURA / 2, ALTURA / 2);
    ctx.scale(escalaVS, escalaVS);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#1a0a14";
    ctx.font = "900 120px 'Segoe UI', monospace";
    ctx.strokeText("VS", 0, 0);
    ctx.fillStyle = "#e03020";
    ctx.fillText("VS", 0, 0);
    if (flashVS > 0) {
      ctx.globalAlpha = flashVS;
      ctx.fillStyle = "#ffffff";
      ctx.fillText("VS", 0, 0);
    }
    ctx.restore();
    ctx.textBaseline = "alphabetic";

    // 5) "ROUND N" com zoom-in a partir dos 2s (fim do confronto).
    const inicioRound = T.entrada + T.confronto;
    if (vs.t >= inicioRound) {
      const tr = vs.t - inicioRound;
      const k = Math.min(1, tr / 0.3); // zoom-in nos primeiros 0.3s
      const escR = 3 - 2 * (1 - Math.pow(1 - k, 3)); // 3 → 1
      ctx.save();
      ctx.translate(LARGURA / 2, 150);
      ctx.scale(escR, escR);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd34d";
      ctx.font = "bold 46px 'Segoe UI', monospace";
      ctx.fillText("ROUND " + this.roundAtual, 0, 0);
      ctx.restore();
    }

    this._scanlines(ctx);

    // 6) FLASH BRANCO final (ref. SF2): 2–3 frames antes de revelar o estágio.
    if (vs.t >= total - T.flash) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
  }
}

/* ===========================================================================
   11) INICIALIZAÇÃO
   =========================================================================== */

async function iniciar() {
  const canvas = document.getElementById("tela");
  const aviso = document.getElementById("aviso");

  let manifest;
  try {
    manifest = await carregarManifest();
  } catch (e) {
    aviso.classList.remove("oculto");
    aviso.innerHTML =
      "Não foi possível carregar <b>assets/manifest.json</b>.<br><br>" +
      "Alguns navegadores bloqueiam leitura de arquivos via <b>file://</b>.<br>" +
      "Abra o projeto com um servidor local (ex.: a extensão <b>Live Server</b> " +
      "do VS Code) ou use o Firefox.";
    console.error("Falha ao carregar manifest:", e);
    return;
  }

  const recursos = new Recursos(manifest);
  await recursos.precarregar();
  if (recursos.faltando > 0) {
    console.warn(
      `Assets ausentes: ${recursos.faltando} (serão exibidos como placeholders).`,
    );
  }

  // (1) DADOS DE MAPAS: varre assets/mapas/ e monta o catálogo em runtime.
  const catalogo = new CatalogoMapas(manifest);
  await catalogo.descobrir();
  console.info(`Mapas descobertos: ${catalogo.mapas.length}`);

  const jogo = new Jogo(canvas, recursos, catalogo);
  jogo.rodar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciar);
} else {
  iniciar();
}
