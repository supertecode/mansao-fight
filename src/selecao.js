"use strict";

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
    // Células da grade = mapas reais + uma célula extra "ALEATÓRIO" no fim
    // (estilo arcade "?" / RANDOM). Só aparece se houver mapas para sortear.
    this.celulas = mapas.length
      ? [...mapas, { aleatorio: true, nome: "ALEATÓRIO" }]
      : [...mapas];
    this.indice = 0;
    this._calcularGrade();
  }

  // Grade responsiva: acomoda a quantidade de células (ex.: 4→4×1, 6→3×2,
  // 12→4×3). Até 4 por linha em quantidades pequenas; acima, formato quadrado.
  _calcularGrade() {
    const n = Math.max(1, this.celulas.length);
    let cols = Math.min(4, n);
    if (n > 4) cols = Math.min(5, Math.ceil(Math.sqrt(n)));
    this.cols = cols;
    this.linhas = Math.ceil(n / cols);
  }

  // Célula sob o cursor (pode ser um mapa ou a célula "ALEATÓRIO").
  get atual() {
    return this.celulas[this.indice] || null;
  }

  // Resolve a escolha: se for "ALEATÓRIO", sorteia um mapa real; senão devolve
  // o próprio mapa. Retorna null só se não houver mapa algum.
  resolverEscolha() {
    const c = this.atual;
    if (c && c.aleatorio) {
      if (!this.mapas.length) return null;
      return this.mapas[Math.floor(Math.random() * this.mapas.length)];
    }
    return c;
  }

  // Move o cursor com WRAP nas bordas. dx/dy ∈ {-1,0,1}. Retorna se mudou.
  mover(dx, dy) {
    const n = this.celulas.length;
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
   Total = 0.5 + 4.25 + 1.2 + 0.05 = 6.0s.
     entrada   : lutadores deslizam das bordas até o centro.
     confronto : idle se encarando + fundo scrollando + "VS" pulsando.
     round     : "ROUND N" entra com zoom-in.
     flash     : flash branco rápido (ref. SF2) antes de revelar o estágio.
   scrollPxFrame fica entre 0.3 e 0.8 px/frame (convertido p/ px/s no update).
   =========================================================================== */
const VS_TIMING = {
  entrada: 0.5,
  confronto: 4.25,
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

