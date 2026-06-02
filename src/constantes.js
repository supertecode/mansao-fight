"use strict";

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
const PERSONAGENS = ["p1", "p2", "p3"];

/* ===========================================================================
   FICHA DE APRESENTAÇÃO DOS LUTADORES — (1) MÓDULO DE DADOS da seleção.
   Metadados puramente cosméticos da tela SELECT (não afetam o balanceamento):
   cidade, estilo, frase de lore, barras de atributo (0–5), dificuldade (1–5) e
   o "estágio de origem" (arquivo do mapa exibido ao fundo do preview).

   >>> EDITE A FICHA NO manifest.json <<< (players.<p>.ficha). O objeto abaixo é
   só o DEFAULT: cada campo ausente no manifest cai aqui, então a tela nunca
   quebra por dado faltando (mesmo padrão de montarGolpes()). Recursos.ficha()
   mescla o manifest sobre estes valores. */
const FICHA_PADRAO = {
  cidade: "ORIGEM DESCONHECIDA",
  estilo: "ESTILO LIVRE",
  lore: ["Um lutador de história ainda não contada."],
  atributos: { forca: 3, velocidade: 3, defesa: 3, especial: 3 },
  dificuldade: 3,
  estagio: null,
};

// Cores de tema da seleção (P1 azul elétrico, P2 vermelho sangue + dourado neon).
const SELECT_TEMA = {
  p1: { cor: "#5cd6ff", forte: "#1b6fff", brilho: "#9fe8ff" },
  p2: { cor: "#ff6a6a", forte: "#c81e2b", brilho: "#ffb0b0" },
  ouro: "#ffd34d",
  fundo: "#0a0815",
};

/* Células da GRADE de seleção (estilo arcade MK/SF). A grade é fixa em 3×2:
   3 lutadores jogáveis + 1 slot ALEATÓRIO ("?") + 2 slots BLOQUEADOS (cadeado,
   "EM BREVE"). tipo ∈ {"pers","random","lock"}. */
const SELECT_CELULAS = [
  { tipo: "pers", pers: "p1" },
  { tipo: "pers", pers: "p2" },
  { tipo: "pers", pers: "p3" },
  { tipo: "random" },
  { tipo: "lock" },
  { tipo: "lock" },
];
const SELECT_COLS = 3;
const SELECT_LINHAS = Math.ceil(SELECT_CELULAS.length / SELECT_COLS);
const TEMPO_SELECT = 30; // segundos até o auto-confirm ("insira ficha")

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
  // Defesa de agarrão: ambos cancelam o agarrão simultâneo e ficam presos
  // brevemente nesta pose antes de voltar ao neutro. NÃO é estado livre (input
  // não o sobrescreve) NEM estado de golpe (sem hitbox/janela de cancelamento).
  THROW_TECH: "throw_tech",
  // Especial defensivo do P2: recuo rápido evasivo (ESPECIAL + TRÁS). Como o
  // THROW_TECH, é um estado TRAVADO: não é livre (o input não o interrompe) nem
  // de golpe (sem hitbox). Volta ao neutro sozinho ao fim da distância/duração.
  BACKDASH: "backdash",
  // Especial ofensivo do P1: investida rápida para FRENTE (ESPECIAL + FRENTE).
  // Espelha o BACKDASH (estado travado, sem hitbox próprio), mas avança contra o
  // oponente. Encerra sozinho ao percorrer a distância/duração configurada.
  DASH: "dash",
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

