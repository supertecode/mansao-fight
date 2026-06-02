/* ===========================================================================
   MANSÃO FIGHT — jogo de luta 1v1 estilo Mortal Kombat (Fase 3: "game feel")
   JavaScript vanilla, sem frameworks/build. Rode com um servidor local
   (jogar.bat / serve.py) e abra http://localhost:8000/index.html.

   ORGANIZAÇÃO DOS ARQUIVOS (o antigo game.js foi dividido em src/*.js, todos
   <script> clássicos carregados EM ORDEM pelo index.html — compartilham o mesmo
   escopo global, então cada arquivo enxerga o que foi declarado acima dele):
     src/config.js     -> este arquivo: CONFIG + constantes derivadas + montarGolpes
     src/constantes.js -> TECLAS, PERSONAGENS, FICHA_PADRAO, SELECT_*, ESTADOS
     src/recursos.js   -> carregarManifest/lerJSON + classe Recursos (assets)
     src/mapas.js      -> CatalogoMapas (varredura de arenas) + miniaturas
     src/animator.js   -> Animator (avanço de quadros pelo fps do manifest)
     src/controles.js  -> Entrada, GamepadNav, ControleTeclado, ControleIA
     src/particulas.js -> Particulas (faíscas, rastro, poeira)
     src/audio.js      -> AudioFX (Web Audio), MusicaFX, SomUI
     src/projetil.js   -> Projetil (bola de energia, rastro, variante super)
     src/fighter.js    -> Fighter (estado, física, vida, hitbox/hurtbox, combos)
     src/selecao.js    -> colideAABB, TELAS, SelecaoMapa, VS_TIMING, CONFIGS
     src/jogo.js       -> Jogo (telas, rounds, HUD, hit stop, shake, game loop)
     src/main.js       -> iniciar() — boot: carrega tudo e arranca o loop

   DADOS (assets/): manifest.json é só o ÍNDICE; cada lutador vive em
   assets/data/players/<p>.json e a lista de arenas em assets/data/mapas.json.
   Sprites em assets/sprites/<p>/, retratos em assets/retratos/, áudio em
   assets/audio/, arenas em assets/mapas/.

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

     OBS: o TIMING do dano vem SEMPRE deste frame data (startup/ativo), medido
     em 60fps de referência a partir do início do golpe — INDEPENDENTE de quantos
     sprites a animação tem. Por isso dá para adicionar quadros intermediários
     (mais fluidez) sem mudar QUANDO o golpe acerta (ver Fighter._golpeAtivo).
     O campo "framesAtivos" no manifest virou LEGADO e é ignorado para o timing. */
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
    // SOCO BAIXO (jab agachado): golpe rápido e curto que mira o quadrante
    // INFERIOR do oponente (mesma faixa de altura do kick_mid). Por ser
    // "baixo", só é defendido com DEFESA_BAIXA (agachado + defender) e passa
    // por baixo de quem só pode ser atingido em região alta — então NÃO acerta
    // alvos cuja única hurtbox válida é a alta. Cancelável: encadeia em combos.
    // Disparado com AGACHAR + SOCO (mesma convenção do kick_mid via AGACHAR+CHUTE).
    // Todos os campos abaixo são configuráveis (e sobreponíveis por personagem
    // no manifest.json, bloco "golpes"). Para dar animação própria ao golpe,
    // adicione os sprites assets/sprites/<p>/soco_baixo_*.png e uma entrada
    // "animacoes.soco_baixo" no manifest; sem isso ele reutiliza o sprite "punch".
    soco_baixo: {
      startup: 3, // sai rápido (poke)
      ativo: 2,
      recovery: 9,
      dano: 5, // dano baixo: é um poke de pressão
      knockback: 100,
      derruba: false,
      alcance: [16, 96], // curto
      altura: [-64, 0], // rente ao chão (pernas/pés) — igual ao kick_mid
      cancelavel: true,
      tipo_altura: "baixo",
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
  // vel = velocidade horizontal (px/s) em LINHA RETA (sem gravidade).
  projeteis: {
    fireball: { dano: 9, vel: 430, cor: "#5cd6ff", raio: 18 },
    special: { dano: 14, vel: 500, cor: "#ff7a3c", raio: 20 }, // p2 agachado
    super: { dano: 22, vel: 560, cor: "#ffe24d", raio: 30 }, // golpe de barra cheia
  },

  /* --- OVERRIDE DE PROJÉTIL POR PERSONAGEM (sprite) -------------------------
     Mescla campo a campo SOBRE o tipo base de CONFIG.projeteis (mesma filosofia
     de montarGolpes): só o personagem listado recebe o comportamento especial,
     todos os outros continuam usando o projétil padrão (reta). Por isso a
     fireball PARABÓLICA é EXCLUSIVA do P1 sem tocar em P2/P3.

     PARÁBOLA: quando "gravidade" > 0, o projétil deixa de andar em linha reta e
     passa a ter velocidade vertical inicial "vy" (negativo = para cima) somada a
     uma aceleração "gravidade" por segundo — descrevendo um arco. "vx" define a
     velocidade horizontal própria do arco (se ausente, cai para "vel"). O sentido
     (esquerda/direita) é aplicado em runtime conforme o facing do lutador.
     Ajuste fino de TUDO aqui: dano, vx, vy, gravidade e tempoVida. */
  projetilPorPersonagem: {
    p1: {
      fireball: {
        dano: 10, // dano do projétil (mantém o sistema de dano atual)
        vx: 380, // velocidade HORIZONTAL do arco (px/s)
        vy: -540, // velocidade VERTICAL inicial (px/s; negativo = sobe)
        gravidade: 1400, // px/s² puxando o projétil para baixo (curva a parábola)
        tempoVida: 2.2, // s até sumir sozinho (rede de segurança além das bordas)
        cor: "#5cd6ff",
        raio: 18,
      },
    },
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

  // --- Throw Tech (defesa de agarrão) --------------------------------------
  // Quando os DOIS lutadores estão agarrando ao mesmo tempo e os inícios dos
  // agarrões ocorrem dentro de "janelaMs" um do outro, o agarrão é "techado":
  // ninguém toma dano nem é arremessado; ambos entram em THROW_TECH e voltam ao
  // neutro após "duracaoMs". Ajuste a dificuldade da defesa mudando janelaMs.
  throwTech: {
    janelaMs: 280, // janela (ms) entre os dois agarrões para haver tech
    duracaoMs: 420, // duração (ms) da animação de tech antes de voltar ao neutro
    empurrao: 150, // recuo (px/s) simétrico aplicado aos dois ao separar
    alcance: 130, // distância máx. (px, centro a centro) para o clash valer
  },

  /* --- ESPECIAL DEFENSIVO: BACKDASH (esquiva para trás) --------------------
     Segundo especial, focado em MOBILIDADE defensiva. Acionado por
     ESPECIAL + TRÁS (direção relativa ao facing: olhando p/ direita, "trás" é
     esquerda; olhando p/ esquerda, "trás" é direita). Recuo rápido e evasivo.
     Exclusivo do SPRITE definido em "exclusivoPersonagem" (o personagem P2).
     NÃO consome a barra de especial (é mobilidade, não o super-projétil), NÃO
     causa dano e NÃO empurra o oponente — apenas afasta quem o executa.
     Para dar ANIMAÇÃO PRÓPRIA: adicione assets/sprites/<p>/backdash_*.png e uma entrada
     "animacoes.backdash" no manifest.json; sem isso, reaproveita a pose "run".
     Todos os parâmetros abaixo são livremente configuráveis. */
  backdash: {
    exclusivoPersonagem: "p2", // só este PERSONAGEM (sprite) executa o dash
    vel: 720, // px/s — bem acima de velAndar(200) e velCorrer(290): é evasivo
    distancia: 190, // px percorridos antes de encerrar automaticamente
    duracao: 0.26, // s — teto de tempo (encerra mesmo sem fechar a distância)
    cooldownMs: 550, // ms entre dois dashes (0 = sem cooldown)
    invulneravel: true, // i-frames durante o dash (esquiva de verdade)
  },

  /* --- ESPECIAL OFENSIVO: DASH FRONTAL / INVESTIDA (FRENTE + ESPECIAL) ------
     Contraparte AGRESSIVA do backdash, EXCLUSIVA do personagem P1. Acionado por
     ESPECIAL + FRENTE (direção relativa ao facing: olhando p/ direita, "frente" é
     direita; olhando p/ esquerda, "frente" é esquerda). O lutador AVANÇA rápido
     contra o oponente percorrendo uma distância significativa, claramente mais
     veloz que correr (velCorrer=290). NÃO consome a barra de especial (é
     mobilidade, não o super-projétil) e NÃO tem hitbox próprio: ao encostar no
     oponente, a SEPARAÇÃO DE CORPOS padrão (_resolverColisaoCorpos) já o empurra,
     e o clamp de mundo (_fisica) impede atravessar paredes/limites — reaproveitando
     toda a colisão existente. Para ANIMAÇÃO PRÓPRIA: adicione
     assets/sprites/<p>/dash_*.png + "animacoes.dash" no manifest; sem isso,
     reaproveita a pose "run" (corrida). Todos os parâmetros são configuráveis. */
  dashFrente: {
    exclusivoPersonagem: "p1", // só o P1 executa a investida
    vel: 760, // px/s — investida agressiva, acima de correr(290)
    distancia: 280, // px percorridos antes de encerrar (alcance significativo)
    duracao: 0.42, // s — teto de tempo (encerra mesmo sem fechar a distância)
    cooldownMs: 600, // ms entre duas investidas (0 = sem cooldown)
    invulneravel: false, // i-frames durante a investida (ofensivo: padrão sem)
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

/* ===========================================================================
   TELA-TÍTULO (START) — identidade visual + linha do tempo da cinemática.
   >>> AJUSTE FINO DA ABERTURA AQUI <<<. Todos os tempos em SEGUNDOS, medidos a
   partir do início da FASE "intro". A intro inteira é pulável com qualquer
   tecla (ver Jogo._algumInput) e nunca passa de START_TIMING.introTotal.
   =========================================================================== */
const START_TIMING = {
  introTotal: 3.0, // duração máxima da intro antes de cair no título
  flashRaio: 0.85, // instante do raio que "revela" o salão (flash branco)
  logoCai: 1.0, // o logo começa a despencar do topo
  impacto: 1.3, // o logo crava: clarão + tremor de tela (screen shake)
  tagline: 1.75, // a tagline entra (slam)
  pressKey: 2.3, // "PRESSIONE QUALQUER TECLA" começa a piscar
  ociosoAttract: 10, // s sem input no título → entra em attract mode
  attractPorSlide: 3.5, // s que cada retrato fica no slideshow do attract
  saida: 0.5, // duração da transição título → menu (flash + fade)
};
// Teclas que NÃO contam como "qualquer tecla" (toggles globais de debug/CRT,
// teclas do navegador) — assim F1/F2 não pulam a intro nem avançam o título.
const START_IGNORAR_TECLAS = new Set([
  "F1", "F2", "F3", "F5", "F11", "F12",
]);

/* IDENTIDADE VISUAL — paleta de 3 cores dominantes + 1 acento neon (roxo
   elétrico). Centralizada para que logo, menu e atmosfera fiquem coerentes. */
const PALETA = {
  preto: "#0a0815", // fundo dominante
  carmesim: "#c81e2b", // corpo do logo / perigo
  carmesimClaro: "#ff5a6e",
  carmesimEscuro: "#5a0a12",
  ouro: "#ffd34d", // dourado envelhecido (acentos, títulos)
  acento: "#b15cff", // ROXO ELÉTRICO — cor de acento neon (plasma/glow)
  acentoClaro: "#d9a9ff",
  texto: "#cfc6e0",
  textoFraco: "#9b90b5",
};
const VERSAO = "v0.3.0";
const CREDITOS = "© 2026 · MANSÃO FIGHT · SAMUEL vs VITOR";

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

