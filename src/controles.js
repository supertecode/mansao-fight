"use strict";

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
    this.queroBaixo = false; // intenção de soltar um soco baixo (agacha + soco)
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

    // (d) Mixup baixo: agacha e, assim que estiver agachado, solta o soco baixo
    // (AGACHAR+SOCO). Espalhar por 2 frames garante que estado==CROUCH ao atacar.
    if (this.queroBaixo) {
      this.segura.add("agacha");
      if (f.estado === ESTADOS.CROUCH) {
        this.fila.push("soco");
        this.queroBaixo = false;
      }
    }
  }

  _decidir(f, op, ad, dirOp) {
    const c = this.cfg;
    const opAtacando = ESTADOS_GOLPE.has(op.estado);
    const barraCheia = f.especial >= CONFIG.especial.custo;
    // Reavalia o mixup baixo a cada decisão (não fica agachado indefinidamente).
    this.queroBaixo = false;

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
        else if (r < 0.5) this.queroBaixo = true; // soco baixo (mixup)
        else if (r < 0.74) this.fila.push("soco");
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

