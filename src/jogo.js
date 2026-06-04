"use strict";

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

    this.tela = TELAS.APRESENTA;
    this.apresenta = { t: 0, fase: "fadein" }; // intro do estúdio
    this.start = this._estadoStartInicial(); // estado da tela-título (intro/attract)
    this.modoRevealT0 = 0; // marco temporal do staggered reveal do menu MODO
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
    this.flash = { a: 0, cor: "255,255,255", vel: 3.2 }; // clarão de transição global
    this.textoTech = null; // rótulo "TECH!" temporário ao defender agarrão
    this.cameraX = 0; // deslocamento horizontal da câmera no mundo (px)
    this.menuIndex = 0; // navegação da tela MODO
    this.dificuldadeIndex = 0; // navegação da tela DIFICULDADE
    this.configIndex = 0; // navegação da tela CONFIG
    this.telaAnteriorConfig = TELAS.MODO; // para onde ESC leva ao sair das configs

    // Pause da luta (overlay sobre a partida congelada).
    this.pausado = false;
    this.pauseModo = "menu"; // "menu" | "confirmarSair"
    this.pauseIndex = 0; // item do menu de pause
    this.pauseConfirmIndex = 1; // 0 = Sim, 1 = Não (começa em Não)

    this.p1 = null;
    this.p2 = null;

    // Seleção de mapa / VS Screen (NOVO).
    this.selecaoMapa = null; // instância de SelecaoMapa enquanto em TELAS.MAPA
    this.mapaEscolhido = null; // descritor do mapa confirmado
    this.vs = null; // estado da VS Screen enquanto em TELAS.VS
    this.select = null; // estado da tela SELECT (cursores, timers, efeitos)
    this.crt = true; // filtro CRT (scanlines + vinheta) — alternável com F2

    window.addEventListener("keydown", (e) => {
      if (e.code === "F1") {
        e.preventDefault();
        this.debug = !this.debug;
      }
      if (e.code === "F2") {
        e.preventDefault();
        this.crt = !this.crt;
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
    this.textoTech = null;
    this.pausado = false;
    this.pauseModo = "menu";
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
    // Música começa ao chegar na tela START (após a intro do estúdio).
    // Se por algum motivo não houver APRESENTA, toca imediatamente.
    if (this.tela !== TELAS.APRESENTA) this.musica.tocar("menu");

    let anterior = performance.now();
    const passo = (agora) => {
      let dt = (agora - anterior) / 1000;
      anterior = agora;
      if (dt > 0.05) dt = 0.05;

      this._atualizar(dt);
      this._desenhar();
      this._desenharFlashGlobal(dt); // clarão de transição sobre QUALQUER tela

      this.entrada.confirmar = false;
      this.entrada.voltar = false;
      this.entrada.bordas.length = 0;
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  _atualizar(dt) {
    // --- Intro do estúdio ---
    if (this.tela === TELAS.APRESENTA) {
      this._atualizarApresenta(dt);
      this.entrada.limparPendentes();
      return;
    }
    // --- Telas de menu ---
    if (this.tela === TELAS.START) {
      this._atualizarStart(dt);
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
      this._atualizarSelect(dt);
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
        this._entrarModo();
      }
      this.entrada.limparPendentes();
      return;
    }

    // ----- Tela de LUTA -----
    // Pause: enquanto pausado, a luta fica congelada e só o menu responde.
    if (this.pausado) {
      this._atualizarPause();
      this.entrada.limparPendentes();
      return;
    }
    // ESC abre o menu de pause (exceto na transição de fim de round).
    if (this.entrada.voltar && this.faseRound !== "fim") {
      this.pausado = true;
      this.pauseModo = "menu";
      this.pauseIndex = 0;
      this.somUI.tocar("navegar");
      this.entrada.voltar = false;
      this.entrada.limparPendentes();
      return;
    }

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
      // Throw tech ANTES de resolver golpes: se ambos estão agarrando, o agarrão
      // é cancelado antes que qualquer um aplique dano/arremesso.
      this._resolverThrowTech();
      this._resolverGolpes();
      this._atualizarProjeteis(dt);
      this.particulas.atualizar(dt);
      if (this.textoTech && this.textoTech.t > 0) this.textoTech.t -= dt;

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

  /* =========================================================================
     TELA "MANSÃO STUDIOS APRESENTA" — intro do estúdio antes do menu.
     Fases: fadein → hold → fadeout → (transição para START).
     Pulável a qualquer momento (após 0.5 s para evitar clique acidental).
     ========================================================================= */
  _atualizarApresenta(dt) {
    const A = this.apresenta;
    const T_FADEIN = 0.7,
      T_HOLD = 4,
      T_FADEOUT = 0.7;
    A.t += dt;

    const gp = this.gamepad.ler();
    // Só permite skip após 0.5 s (evita pular por tecla pressionada antes).
    const tecla = A.t > 0.5 && this._algumInput(gp);

    if (A.fase === "fadein") {
      if (A.t >= T_FADEIN) {
        A.fase = "hold";
        A.t = 0;
      }
      if (tecla) {
        A.fase = "fadeout";
        A.t = 0;
      }
      return;
    }
    if (A.fase === "hold") {
      if (A.t >= T_HOLD || tecla) {
        A.fase = "fadeout";
        A.t = 0;
      }
      return;
    }
    if (A.fase === "fadeout") {
      if (A.t >= T_FADEOUT) {
        this.apresenta = { t: 0, fase: "fadein" }; // reseta para segurança
        this.tela = TELAS.START;
        this.musica.tocar("menu"); // inicia música do menu agora
      }
      return;
    }
  }

  _desenharApresenta(ctx) {
    const A = this.apresenta;
    const T_FADEIN = 0.7,
      T_FADEOUT = 0.7;

    let alpha = 1;
    if (A.fase === "fadein") alpha = Math.min(1, A.t / T_FADEIN);
    else if (A.fase === "fadeout") alpha = Math.max(0, 1 - A.t / T_FADEOUT);

    // Fundo preto absoluto (sem textura de jogo).
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // Scanlines sutis para reforçar o tom retrô.
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = "#000000";
    for (let y = 0; y < ALTURA; y += 2) ctx.fillRect(0, y, LARGURA, 1);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.imageSmoothingEnabled = false;

    // Linha principal — "— MANSÃO STUDIOS —"
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px 'Courier New', monospace";
    try {
      ctx.letterSpacing = "4px";
    } catch (e) {}
    ctx.fillText("— MANSÃO STUDIOS —", LARGURA / 2, ALTURA / 2 - 14);

    // Subtítulo — "APRESENTA"
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "bold 17px 'Courier New', monospace";
    try {
      ctx.letterSpacing = "7px";
    } catch (e) {}
    ctx.fillText("APRESENTA", LARGURA / 2, ALTURA / 2 + 18);
    try {
      ctx.letterSpacing = "0px";
    } catch (e) {}

    ctx.restore();
  }

  /* =========================================================================
     TELA-TÍTULO (START) — máquina de estados da abertura.
     Fases: "intro" (cinemática) → "titulo" (PRESS ANY KEY) → "attract" (demo de
     retratos após ociosidade) → "saindo" (transição para o menu). Qualquer
     tecla pula a intro, dispara o início pelo título e sai do attract.
     ========================================================================= */
  _estadoStartInicial() {
    return {
      fase: "intro", // "intro" | "titulo" | "attract" | "saindo"
      t: 0, // tempo decorrido NA FASE atual (s)
      ocioso: 0, // tempo sem input no título (dispara attract aos 10s)
      attractIdx: 0, // índice do retrato atual no slideshow do attract
      flashImpacto: 0, // 1→0: clarão + tremor do impacto do logo
      bateu: false, // trava: o impacto do logo só dispara uma vez
    };
  }

  // Dispara um clarão de transição (cor "r,g,b"). vel = taxa de decaimento.
  _flash(cor = "255,255,255", vel = 3.2) {
    this.flash.cor = cor;
    this.flash.vel = vel;
    this.flash.a = 1;
  }

  // Desenha e decai o clarão de transição global (acima de qualquer tela).
  _desenharFlashGlobal(dt) {
    if (this.flash.a <= 0) return;
    this.ctx.fillStyle = `rgba(${this.flash.cor},${this.flash.a})`;
    this.ctx.fillRect(0, 0, LARGURA, ALTURA);
    this.flash.a = Math.max(0, this.flash.a - dt * this.flash.vel);
  }

  // Entra na tela MODO rearmando o staggered reveal dos itens (baixo→cima).
  _entrarModo(index = 0) {
    this.menuIndex = index;
    this.modoRevealT0 = performance.now();
    this.tela = TELAS.MODO;
  }

  // "Qualquer tecla" (teclado, ENTER/ESC ou gamepad), ignorando toggles globais
  // (F1 debug, F2 CRT, etc.) para que eles não pulem a intro nem avancem a tela.
  _algumInput(gp) {
    const borda = this.entrada.bordas.some((c) => !START_IGNORAR_TECLAS.has(c));
    return (
      borda ||
      this.entrada.confirmar ||
      this.entrada.voltar ||
      (gp && (gp.confirm || gp.back))
    );
  }

  _atualizarStart(dt) {
    const S = this.start;
    const T = START_TIMING;
    S.t += dt;
    if (S.flashImpacto > 0)
      S.flashImpacto = Math.max(0, S.flashImpacto - dt * 3);
    const gp = this.gamepad.ler();
    const tecla = this._algumInput(gp);

    if (S.fase === "intro") {
      // No instante do impacto, dispara clarão + tremor (uma única vez).
      if (!S.bateu && S.t >= T.impacto) {
        S.bateu = true;
        S.flashImpacto = 1;
      }
      // Pulável a qualquer momento; ou termina sozinha em introTotal.
      if (tecla || S.t >= T.introTotal) {
        S.fase = "titulo";
        S.t = 0;
        S.ocioso = 0;
      }
      return;
    }

    if (S.fase === "titulo") {
      if (tecla) {
        this._sairDoTitulo();
        return;
      }
      S.ocioso += dt;
      if (S.ocioso >= T.ociosoAttract) {
        S.fase = "attract";
        S.t = 0;
        S.attractIdx = 0;
      }
      return;
    }

    if (S.fase === "attract") {
      if (tecla) {
        S.fase = "titulo";
        S.t = 0;
        S.ocioso = 0;
        return;
      }
      if (S.t >= T.attractPorSlide) {
        S.t = 0;
        S.attractIdx = (S.attractIdx + 1) % PERSONAGENS.length;
      }
      return;
    }

    if (S.fase === "saindo") {
      // Ao fim da transição (flash + fade), abre o menu com staggered reveal.
      if (S.t >= T.saida) this._entrarModo(0);
      return;
    }
  }

  // Dispara a saída do título para o menu: garante áudio (1º gesto), toca o
  // som de confirmação e a música do menu, e entra na transição "saindo".
  _sairDoTitulo() {
    this.audio.garantir();
    this.somUI.tocar("confirmar");
    this.musica.tocar("menu");
    this.start.fase = "saindo";
    this.start.t = 0;
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
      this.start = this._estadoStartInicial(); // replay da cinemática de abertura
      this.tela = TELAS.START;
      return;
    }

    if (this.entrada.confirmar) {
      this.somUI.tocar("confirmar");
      if (this.menuIndex === 0) {
        // 1 Jogador → tela intermediária de dificuldade (entra "socando": flash).
        this._flash("255,255,255", 3.4);
        this.dificuldadeIndex = 1; // começa selecionado em Médio
        this.tela = TELAS.DIFICULDADE;
      } else if (this.menuIndex === 1) {
        // 2 Jogadores → direto para seleção de personagem.
        this._flash("255,255,255", 3.4);
        this.modo = "2p";
        this._iniciarSelect();
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
      this._entrarModo(0);
      return;
    }

    if (this.entrada.confirmar) {
      const dificuldades = ["facil", "medio", "dificil"];
      this.modo = "1p";
      this.dificuldade = dificuldades[this.dificuldadeIndex];
      this.somUI.tocar("confirmar");
      this._iniciarSelect();
    }
  }

  /* =========================================================================
     TELA SELECT — grade arcade com cursores INDEPENDENTES de P1 e P2.
     Estado em this.select: cursores (índice na grade SELECT_CELULAS), timers de
     animação (intro/transição/flash), partículas de confirmação e contagem
     regressiva de "ficha". this.escolha continua sendo o índice em PERSONAGENS
     (definido só na confirmação) para a VS Screen / criação dos lutadores.
     ========================================================================= */
  _iniciarSelect() {
    this.escolha = { p1: 0, p2: 1 };
    this.confirmado = { p1: false, p2: false };
    this.select = {
      cursor: { p1: 0, p2: 1 }, // célula sob cada cursor (índice em SELECT_CELULAS)
      prevCursor: { p1: 0, p2: 1 }, // célula anterior (para a transição do preview)
      trans: { p1: 1, p2: 1 }, // 0→1: progresso do flash de troca de preview
      flash: { p1: 0, p2: 0 }, // s restantes do glitch de confirmação
      intro: 0.7, // s restantes da animação de entrada (cortinas + flash)
      timer: TEMPO_SELECT, // contagem regressiva ("insira uma ficha")
      saindo: 0, // s restantes do selo "PRONTOS!" antes de ir ao mapa
      particulas: [], // faíscas leves disparadas na confirmação
    };
    this.tela = TELAS.SELECT;
  }

  // Índice em PERSONAGENS sob o cursor do slot; -1 se a célula não é jogável.
  _persDoCursor(slot) {
    const cel = SELECT_CELULAS[this.select.cursor[slot]];
    return cel && cel.tipo === "pers" ? PERSONAGENS.indexOf(cel.pers) : -1;
  }

  // Move o cursor de um slot na grade (wrap em linha/coluna). Retorna se mudou.
  _moverCursorSelect(slot, kl, kr, ku, kd, gp) {
    const cols = SELECT_COLS,
      linhas = SELECT_LINHAS,
      n = SELECT_CELULAS.length;
    const i = this.select.cursor[slot];
    const col = i % cols,
      lin = Math.floor(i / cols);
    let novo = i;
    if (this.entrada.borda(kl) || (gp && gp.left))
      novo = lin * cols + ((col + cols - 1) % cols);
    else if (this.entrada.borda(kr) || (gp && gp.right))
      novo = lin * cols + ((col + 1) % cols);
    else if (this.entrada.borda(ku) || (gp && gp.up))
      novo = ((lin + linhas - 1) % linhas) * cols + col;
    else if (this.entrada.borda(kd) || (gp && gp.down))
      novo = ((lin + 1) % linhas) * cols + col;
    if (novo >= n) novo = n - 1; // grade cheia (3×2); guarda por segurança
    if (novo === i) return false;
    this.select.prevCursor[slot] = i;
    this.select.cursor[slot] = novo;
    this.select.trans[slot] = 0; // dispara o flash de transição do preview
    return true;
  }

  // Confirma a escolha de um slot. forcado=true (timeout) aceita células
  // bloqueadas caindo no 1º lutador; senão, lock recusa a confirmação.
  _confirmarSelect(slot, forcado = false) {
    const S = this.select;
    const cel = SELECT_CELULAS[S.cursor[slot]];
    let idx;
    if (cel.tipo === "pers") {
      idx = PERSONAGENS.indexOf(cel.pers);
    } else if (cel.tipo === "random") {
      idx = Math.floor(Math.random() * PERSONAGENS.length);
      // Move o cursor para o lutador sorteado (feedback visual do "?").
      S.cursor[slot] = SELECT_CELULAS.findIndex(
        (c) => c.tipo === "pers" && PERSONAGENS.indexOf(c.pers) === idx,
      );
      S.trans[slot] = 0;
    } else {
      if (!forcado) {
        this.somUI.tocar("voltar"); // slot bloqueado: rejeita
        return;
      }
      idx = 0;
    }
    this.escolha[slot] = idx;
    this.confirmado[slot] = true;
    S.flash[slot] = 0.45; // glitch/flash de confirmação
    this.somUI.tocar("selecionar");
    // Faíscas temáticas no painel do jogador.
    const cor = SELECT_TEMA[slot].cor;
    const px = slot === "p1" ? 150 : LARGURA - 150;
    for (let k = 0; k < 26; k++) {
      const ang = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 260;
      S.particulas.push({
        x: px,
        y: 250,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - 80,
        vida: 0.5 + Math.random() * 0.35,
        vidaMax: 0.85,
        raio: 1.5 + Math.random() * 2.5,
        cor,
      });
    }
  }

  _atualizarSelect(dt) {
    const S = this.select;
    const gp = this.gamepad.ler();

    // Avanço dos timers de animação.
    if (S.intro > 0) S.intro = Math.max(0, S.intro - dt);
    for (const s of ["p1", "p2"]) {
      if (S.trans[s] < 1) S.trans[s] = Math.min(1, S.trans[s] + dt * 4.5);
      if (S.flash[s] > 0) S.flash[s] = Math.max(0, S.flash[s] - dt);
    }
    // Partículas de confirmação (gravidade leve + atrito).
    for (const p of S.particulas) {
      p.vida -= dt;
      p.vx *= Math.pow(0.25, dt);
      p.vy += 700 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    S.particulas = S.particulas.filter((p) => p.vida > 0);

    // Selo "PRONTOS!" → após o hold, segue para a seleção de estágio.
    if (S.saindo > 0) {
      S.saindo = Math.max(0, S.saindo - dt);
      if (S.saindo === 0) this._irParaSelecaoMapa();
      return; // congela a interação durante o selo
    }

    // ESC/B: cancela a(s) confirmação(ões) ou volta para a tela MODO.
    if (this.entrada.voltar || gp.back) {
      if (this.confirmado.p1 || this.confirmado.p2) {
        this.confirmado.p1 = false;
        this.confirmado.p2 = false;
        this.somUI.tocar("voltar");
      } else {
        this.somUI.tocar("voltar");
        this._entrarModo(this.menuIndex);
      }
      return;
    }

    let houveInput = false;

    // --- P1: WASD + Soco (F); Enter também confirma quem falta. ---
    if (!this.confirmado.p1) {
      if (this._moverCursorSelect("p1", "KeyA", "KeyD", "KeyW", "KeyS", gp)) {
        houveInput = true;
        this.somUI.tocar("personagem");
      }
      if (
        this.entrada.borda(TECLAS.p1.soco) ||
        (this.modo === "1p" && (this.entrada.confirmar || gp.confirm))
      ) {
        houveInput = true;
        this._confirmarSelect("p1");
        // Em 1p, o mesmo keypress não pode vazar para a fase 2 (seleção da CPU)
        // neste mesmo frame. Reseta o timer e encerra o update deste tick.
        if (this.modo === "1p") { S.timer = TEMPO_SELECT; return; }
      }
    }

    if (this.modo === "2p") {
      // --- P2: setas + Soco (J). ---
      if (!this.confirmado.p2) {
        if (
          this._moverCursorSelect(
            "p2",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          )
        ) {
          houveInput = true;
          this.somUI.tocar("personagem");
        }
        if (this.entrada.borda(TECLAS.p2.soco)) {
          houveInput = true;
          this._confirmarSelect("p2");
        }
      }
      // Enter (atalho): confirma o primeiro que ainda falta.
      if (this.entrada.confirmar) {
        houveInput = true;
        if (!this.confirmado.p1) this._confirmarSelect("p1");
        else if (!this.confirmado.p2) this._confirmarSelect("p2");
      }
    } else {
      // 1 Player fase 2: P1 já confirmou e agora escolhe o personagem da CPU.
      if (this.confirmado.p1 && !this.confirmado.p2) {
        if (this._moverCursorSelect("p2", "KeyA", "KeyD", "KeyW", "KeyS", gp)) {
          houveInput = true;
          this.somUI.tocar("personagem");
        }
        if (
          this.entrada.borda(TECLAS.p1.soco) ||
          this.entrada.confirmar ||
          (gp && gp.confirm)
        ) {
          houveInput = true;
          this._confirmarSelect("p2");
        }
      }
    }

    // Contagem regressiva de "ficha": reinicia a cada input; ao zerar, auto-confirma.
    if (houveInput) {
      S.timer = TEMPO_SELECT;
    } else {
      S.timer = Math.max(0, S.timer - dt);
      if (S.timer === 0) {
        if (!this.confirmado.p1) this._confirmarSelect("p1", true);
        else if (!this.confirmado.p2) this._confirmarSelect("p2", true);
      }
    }

    // Ambos prontos → dispara o selo "PRONTOS!" (payoff) antes do estágio.
    if (this.confirmado.p1 && this.confirmado.p2 && S.saindo === 0) {
      S.saindo = 0.85;
      this.somUI.tocar("confirmar");
    }
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
    if (
      this.entrada.borda("KeyA") ||
      this.entrada.borda("ArrowLeft") ||
      gp.left
    )
      moveu = sel.mover(-1, 0) || moveu;
    if (
      this.entrada.borda("KeyD") ||
      this.entrada.borda("ArrowRight") ||
      gp.right
    )
      moveu = sel.mover(1, 0) || moveu;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp") || gp.up)
      moveu = sel.mover(0, -1) || moveu;
    if (
      this.entrada.borda("KeyS") ||
      this.entrada.borda("ArrowDown") ||
      gp.down
    )
      moveu = sel.mover(0, 1) || moveu;
    if (moveu) this.somUI.tocar("navegar"); // sfx de mover cursor (sfx_cursor_move)

    // Confirmar: ENTER/Espaço, A do gamepad ou o soco do P1 (F).
    if (
      this.entrada.confirmar ||
      gp.confirm ||
      this.entrada.borda(TECLAS.p1.soco)
    ) {
      this.somUI.tocar("confirmar"); // sfx de confirmar (sfx_confirm)
      // resolverEscolha() sorteia um mapa real quando o cursor está em "ALEATÓRIO".
      this._confirmarMapa(sel.resolverEscolha());
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
      VS_TIMING.entrada +
      VS_TIMING.confronto +
      VS_TIMING.round +
      VS_TIMING.flash;
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
      // Voltando ao menu principal: refaz o staggered reveal destacando
      // "Configurações" (item de onde se veio). Da pausa, volta para a LUTA.
      if (this.telaAnteriorConfig === TELAS.MODO) this._entrarModo(2);
      else this.tela = this.telaAnteriorConfig;
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

  // --- Menu de PAUSE: Continuar / Configurações / Sair para o menu ---
  _atualizarPause() {
    if (this.pauseModo === "confirmarSair") {
      this._atualizarPauseConfirmar();
      return;
    }

    const opcoes = 3; // 0 Continuar, 1 Configurações, 2 Sair
    const ant = this.pauseIndex;
    if (this.entrada.borda("KeyW") || this.entrada.borda("ArrowUp"))
      this.pauseIndex = (this.pauseIndex + opcoes - 1) % opcoes;
    if (this.entrada.borda("KeyS") || this.entrada.borda("ArrowDown"))
      this.pauseIndex = (this.pauseIndex + 1) % opcoes;
    if (this.pauseIndex !== ant) this.somUI.tocar("navegar");

    // ESC retoma a luta.
    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.pausado = false;
      return;
    }

    if (this.entrada.confirmar) {
      if (this.pauseIndex === 0) {
        // Continuar.
        this.somUI.tocar("voltar");
        this.pausado = false;
      } else if (this.pauseIndex === 1) {
        // Configurações: reaproveita a tela CONFIG; ao sair dela (ESC) volta
        // para a LUTA, que continua pausada e reabre este menu.
        this.somUI.tocar("confirmar");
        this.telaAnteriorConfig = TELAS.LUTA;
        this.configIndex = 0;
        this.tela = TELAS.CONFIG;
      } else {
        // Sair para o menu: pede confirmação antes.
        this.somUI.tocar("confirmar");
        this.pauseModo = "confirmarSair";
        this.pauseConfirmIndex = 1; // padrão seguro: "Não"
      }
    }
  }

  // --- Confirmação "Sair da partida?" (Sim / Não) ---
  _atualizarPauseConfirmar() {
    const ant = this.pauseConfirmIndex;
    if (
      this.entrada.borda("KeyA") ||
      this.entrada.borda("ArrowLeft") ||
      this.entrada.borda("KeyD") ||
      this.entrada.borda("ArrowRight")
    ) {
      this.pauseConfirmIndex = this.pauseConfirmIndex === 0 ? 1 : 0;
    }
    if (this.pauseConfirmIndex !== ant) this.somUI.tocar("navegar");

    // ESC cancela e volta ao menu de pause.
    if (this.entrada.voltar) {
      this.somUI.tocar("voltar");
      this.pauseModo = "menu";
      return;
    }

    if (this.entrada.confirmar) {
      if (this.pauseConfirmIndex === 0) {
        this._sairParaMenu(); // Sim
      } else {
        this.somUI.tocar("voltar"); // Não
        this.pauseModo = "menu";
      }
    }
  }

  // Encerra a partida e retorna ao menu principal.
  _sairParaMenu() {
    this.somUI.tocar("confirmar");
    this.pausado = false;
    this.pauseModo = "menu";
    this.musica.tocar("menu");
    this._entrarModo();
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

  /* THROW TECH — defesa de agarrão (vale para os dois lados ao mesmo tempo).
     Dispara quando AMBOS estão no estado GRAB, perto o bastante e com os inícios
     dos agarrões dentro de CONFIG.throwTech.janelaMs um do outro. Resultado:
     ninguém toma dano nem é arremessado; os dois entram em THROW_TECH e voltam
     ao neutro. Roda ANTES de _resolverGolpes, então cancela o agarrão antes que
     ele aplique qualquer efeito. Não toca em combos/bloqueios/outros estados. */
  _resolverThrowTech() {
    const a = this.p1;
    const b = this.p2;
    // Só há clash se os dois estiverem efetivamente agarrando.
    if (a.estado !== ESTADOS.GRAB || b.estado !== ESTADOS.GRAB) return false;
    // Os agarrões precisam ter começado dentro da janela um do outro.
    const janela = CONFIG.throwTech.janelaMs / 1000;
    if (Math.abs(a.estadoTempo - b.estadoTempo) > janela) return false;
    // E estar no alcance de agarrão (evita tech "à distância" por coincidência).
    if (Math.abs(a.x - b.x) > CONFIG.throwTech.alcance) return false;

    // Clash! Cancela os dois agarrões simultaneamente.
    a.techThrow(b.x);
    b.techThrow(a.x);

    // Feedback de "tech break": faíscas no ponto médio, som e um tremor leve.
    const mx = (a.x + b.x) / 2;
    const my = CHAO_Y - 110;
    this.particulas.faiscas(
      mx,
      my,
      CONFIG.particulas.faiscasBloqueio + 4,
      "#ffe9a8",
      200,
    );
    this.audio.bloqueio();
    this.hitStop = Math.max(this.hitStop, 0.05);
    this._tremor(CONFIG.gameFeel.shakeHit * 0.5);
    this.textoTech = { t: 0.7, x: mx, y: my - 30 }; // rótulo "TECH!" temporário
    return true;
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

    // Intro do estúdio (tela preta minimalista, antes de qualquer menu).
    if (this.tela === TELAS.APRESENTA) {
      this._desenharApresenta(ctx);
      return;
    }

    // Telas de menu (sem shake da luta). Fundo unificado do "salão da mansão".
    if (this.tela === TELAS.START) {
      this._desenharStart(ctx); // desenha o próprio fundo + cinemática
      return;
    }
    if (this.tela === TELAS.MODO) {
      this._desenharFundoMansao(ctx);
      this._desenharModo(ctx);
      this._crtOverlay(ctx);
      return;
    }
    if (this.tela === TELAS.DIFICULDADE) {
      this._desenharFundoMansao(ctx);
      this._desenharDificuldade(ctx);
      this._crtOverlay(ctx);
      return;
    }
    if (this.tela === TELAS.SELECT) {
      this._desenharSelect(ctx); // fundo arcade próprio (cobre toda a tela)
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
      this._desenharFundoMansao(ctx);
      this._desenharConfig(ctx);
      this._crtOverlay(ctx);
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
    // Rótulo "TECH!" no ponto do clash de agarrão (sobe e some).
    if (this.textoTech && this.textoTech.t > 0) {
      const tt = this.textoTech;
      const alpha = Math.min(1, tt.t / 0.4);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ffe9a8";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 3;
      ctx.font = "bold 28px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      const y = tt.y - (0.7 - tt.t) * 40; // sobe conforme o tempo passa
      ctx.strokeText("TECH!", tt.x, y);
      ctx.fillText("TECH!", tt.x, y);
      ctx.restore();
    }
    ctx.restore();

    // HUD e textos centrais (fora do shake).
    this._desenharHUD(ctx);
    if (this.faseRound === "anuncio") this._desenharAnuncio(ctx);
    if (this.faseRound === "fim") this._desenharFimRound(ctx);
    if (this.pausado) this._desenharPause(ctx);
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
  /* TELA-TÍTULO — render por fase. Hierarquia visual (do mais forte ao mais
     fraco): LOGO > PRESSIONE QUALQUER TECLA > tagline > atmosfera > rodapé.
     O fundo nunca compete com o texto (escurecido + vinheta). */
  _desenharStart(ctx) {
    const S = this.start;
    const T = START_TIMING;
    const now = performance.now();

    // ATTRACT MODE: slideshow dos lutadores (demo enquanto ninguém joga).
    if (S.fase === "attract") {
      this._desenharAttract(ctx);
      this._crtOverlay(ctx);
      return;
    }

    // Tremor de tela no impacto do logo (apenas durante o baque).
    const sh = S.flashImpacto * 12;
    ctx.save();
    if (sh > 0.4)
      ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);

    this._desenharFundoMansao(ctx);

    // ---- LOGO: aparece só depois que começa a cair (durante a intro) ----
    let mostrarLogo = true;
    let logoY = 150;
    let escala = 1;
    let glow = 0.85 + 0.25 * Math.sin(now / 380);

    if (S.fase === "intro") {
      if (S.t < T.logoCai) {
        mostrarLogo = false; // ainda só atmosfera + raio
      } else if (S.t < T.impacto) {
        // QUEDA: ease-in (acelera) do topo até a posição final.
        const k = (S.t - T.logoCai) / (T.impacto - T.logoCai);
        const ke = k * k;
        logoY = -130 + (150 + 130) * ke;
        escala = 1.15 - 0.15 * ke;
        glow = 0.5;
      } else {
        // SETTLE: pequena oscilação amortecida ao cravar.
        const b = S.t - T.impacto;
        logoY = 150 - 16 * Math.exp(-9 * b) * Math.cos(20 * b);
        escala = 1 + 0.1 * Math.exp(-9 * b) * Math.cos(20 * b);
        glow = 0.6 + S.flashImpacto * 0.8;
      }
    } else if (S.fase === "saindo") {
      glow = 1 + S.t / T.saida; // o logo "esquenta" ao sair
    }

    if (mostrarLogo) this._desenharLogo(ctx, LARGURA / 2, logoY, escala, glow);

    // ---- TAGLINE (slam-in: entra grande e fecha) ----
    const taglineVis =
      (S.fase === "intro" && S.t >= T.tagline) ||
      S.fase === "titulo" ||
      S.fase === "saindo";
    if (mostrarLogo && taglineVis) {
      let ta = 1,
        tsc = 1;
      if (S.fase === "intro") {
        const k = Math.min(1, (S.t - T.tagline) / 0.25);
        ta = k;
        tsc = 1.4 - 0.4 * k;
      }
      ctx.save();
      ctx.globalAlpha = ta;
      ctx.translate(LARGURA / 2, 212);
      ctx.scale(tsc, tsc);
      ctx.textAlign = "center";
      ctx.fillStyle = PALETA.acentoClaro;
      ctx.font = "bold 22px 'Segoe UI', sans-serif";
      try {
        ctx.letterSpacing = "6px";
      } catch (e) {}
      ctx.fillText("O JOGO DE LUTA DA MANSÃO", 0, 0);
      try {
        ctx.letterSpacing = "0px";
      } catch (e) {}
      ctx.restore();
    }

    // ---- "PRESSIONE QUALQUER TECLA" (pisca em loop, estilo arcade) ----
    const pressVis =
      (S.fase === "intro" && S.t >= T.pressKey) || S.fase === "titulo";
    if (pressVis && Math.floor(now / 450) % 2 === 0) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.shadowColor = PALETA.acento;
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 28px 'Segoe UI', sans-serif";
      ctx.fillText("PRESSIONE QUALQUER TECLA", LARGURA / 2, 432);
      ctx.restore();
    }

    // ---- Rodapé: créditos (esq) + versão (dir), discretos (fonte mono) ----
    ctx.fillStyle = "rgba(155,144,181,0.6)";
    ctx.font = "12px 'Segoe UI', monospace";
    ctx.textAlign = "left";
    ctx.fillText(CREDITOS, 16, ALTURA - 14);
    ctx.textAlign = "right";
    ctx.fillText(VERSAO, LARGURA - 16, ALTURA - 14);

    ctx.restore(); // fim do bloco sujeito ao tremor

    // ---- Clarão do IMPACTO do logo (branco-frio sobre tudo) ----
    if (S.flashImpacto > 0) {
      ctx.fillStyle = `rgba(220,225,255,${0.7 * S.flashImpacto})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
    // ---- Flash do RAIO da intro (revela o salão por um instante) ----
    if (S.fase === "intro" && S.t >= T.flashRaio && S.t < T.flashRaio + 0.18) {
      const k = 1 - (S.t - T.flashRaio) / 0.18;
      ctx.fillStyle = `rgba(255,255,255,${0.8 * k})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }

    // ---- CRT: scanlines + vinheta (alternável com F2) ----
    this._crtOverlay(ctx);

    // ---- Transição de SAÍDA p/ o menu: clarão que sobe e segura até o corte ----
    if (S.fase === "saindo") {
      const a = Math.min(1, (S.t / T.saida) * 2);
      ctx.fillStyle = `rgba(240,235,255,${a})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
  }

  /* Filtro CRT compartilhado por todas as telas de menu: scanlines leves +
     vinheta radial. Alternável com F2 (this.crt). */
  _crtOverlay(ctx) {
    if (!this.crt) return;
    this._scanlines(ctx);
    const vg = ctx.createRadialGradient(
      LARGURA / 2,
      ALTURA / 2,
      ALTURA * 0.34,
      LARGURA / 2,
      ALTURA / 2,
      ALTURA * 0.82,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, LARGURA, ALTURA);
  }

  /* FUNDO "SALÃO DA MANSÃO EM RUÍNAS" — 4 planos de parallax (janela > parede
     > colunas > piso) + candelabros, poeira e relâmpago ocasional. Totalmente
     procedural e SEM estado (lê só o relógio), então é reutilizável atrás de
     qualquer tela de menu sem alocar nada. O parallax é uma oscilação suave
     (sway) — dá profundidade sem rolagem infinita num interior fechado. */
  _desenharFundoMansao(ctx) {
    const t = performance.now() / 1000;
    const sway = Math.sin(t * 0.18) * 10; // px de oscilação base

    // Relâmpago ocasional (stateless, dois períodos quase-primos p/ irregularidade).
    const i1 = t % 7.3,
      i2 = t % 4.1;
    let raio = 0;
    if (i1 < 0.16) raio = Math.max(raio, Math.pow(1 - i1 / 0.16, 1.3));
    if (i2 < 0.08) raio = Math.max(raio, 0.6 * Math.pow(1 - i2 / 0.08, 1.3));

    // Base — gradiente do interior escuro.
    const g = ctx.createLinearGradient(0, 0, 0, ALTURA);
    g.addColorStop(0, "#160e22");
    g.addColorStop(0.55, "#0b0814");
    g.addColorStop(1, "#06040b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // ===== PLANO 1 (fundo): janela com céu noturno + relâmpago =====
    const wx = LARGURA / 2 + sway * 0.3;
    const wy = 54,
      ww = 300,
      wh = 210;
    const cu = (a, b) => Math.round(a + (b - a) * raio);
    ctx.fillStyle = `rgb(${cu(26, 210)},${cu(28, 205)},${cu(48, 235)})`;
    ctx.fillRect(wx - ww / 2, wy, ww, wh);
    if (raio > 0.45) {
      // Bolt (raio) recortado pela janela.
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx - ww / 2, wy, ww, wh);
      ctx.clip();
      ctx.globalAlpha = Math.min(1, (raio - 0.45) * 3);
      ctx.strokeStyle = "#eaf0ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let bx = wx + Math.sin(t * 30) * 20,
        by = wy;
      ctx.moveTo(bx, by);
      for (let k = 0; k < 6; k++) {
        bx += Math.sin(t * 50 + k * 2.3) * 26;
        by += wh / 6;
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Caixilho em cruz + moldura da janela.
    ctx.fillStyle = "#0a0712";
    ctx.fillRect(wx - 4, wy, 8, wh);
    ctx.fillRect(wx - ww / 2, wy + wh / 2 - 4, ww, 8);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#0a0712";
    ctx.strokeRect(wx - ww / 2, wy, ww, wh);
    // Luz do relâmpago invadindo o salão (tinge de roxo — o acento).
    if (raio > 0) {
      ctx.fillStyle = `rgba(150,140,255,${0.16 * raio})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }

    // ===== PLANO 2 (parede): retratos rasgados + rachaduras =====
    ctx.save();
    ctx.translate(sway * 0.6, 0);
    ctx.fillStyle = "rgba(30,22,46,0.55)";
    ctx.fillRect(-20, 150, LARGURA + 40, 230);
    for (const [qx, qy] of [
      [120, 210],
      [LARGURA - 150, 230],
      [250, 300],
    ]) {
      ctx.save();
      ctx.translate(qx, qy);
      ctx.rotate(Math.sin(qx) * 0.06); // torto, mas determinístico
      ctx.fillStyle = "#120c1e";
      ctx.fillRect(-34, -44, 68, 88);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(120,96,40,0.5)"; // dourado envelhecido
      ctx.strokeRect(-34, -44, 68, 88);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(420, 150);
    ctx.lineTo(440, 230);
    ctx.lineTo(415, 300);
    ctx.lineTo(450, 360);
    ctx.moveTo(700, 160);
    ctx.lineTo(685, 250);
    ctx.stroke();
    ctx.restore();

    // ===== PLANO 3 (colunas) — emolduram as laterais =====
    const off3 = sway * 0.95;
    const coluna = (cx) => {
      const cg = ctx.createLinearGradient(cx - 26, 0, cx + 26, 0);
      cg.addColorStop(0, "#0d0a16");
      cg.addColorStop(0.5, "#241a38");
      cg.addColorStop(1, "#0d0a16");
      ctx.fillStyle = cg;
      ctx.fillRect(cx - 26, 90, 52, CHAO_Y - 90);
      ctx.fillStyle = "#2c2046";
      ctx.fillRect(cx - 34, 86, 68, 16); // capitel
      ctx.fillRect(cx - 34, CHAO_Y - 14, 68, 14); // base
    };
    coluna(70 + off3);
    coluna(LARGURA - 70 + off3);

    // ===== CANDELABROS — chamas tremeluzentes (aditivo, halo roxo) =====
    const chama = (fx, fy) => {
      const fl =
        0.6 + 0.4 * Math.sin(t * 11 + fx) + 0.2 * Math.sin(t * 23 + fx);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 60 + fl * 18);
      fg.addColorStop(0, "rgba(255,180,90,0.5)");
      fg.addColorStop(0.4, "rgba(177,92,255,0.18)");
      fg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, 60 + fl * 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,210,120,0.85)";
      ctx.beginPath();
      ctx.ellipse(fx, fy, 5 + fl, 12 + fl * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    chama(150 + off3, 250);
    chama(LARGURA - 150 + off3, 250);

    // ===== PLANO 4 (frente): piso de mármore rachado =====
    const fgp = ctx.createLinearGradient(0, CHAO_Y, 0, ALTURA);
    fgp.addColorStop(0, "#1a1330");
    fgp.addColorStop(1, "#08060f");
    ctx.fillStyle = fgp;
    ctx.fillRect(0, CHAO_Y, LARGURA, ALTURA - CHAO_Y);
    ctx.fillStyle = "rgba(177,92,255,0.2)"; // linha de destaque (acento)
    ctx.fillRect(0, CHAO_Y, LARGURA, 3);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(300, CHAO_Y + 6);
    ctx.lineTo(360, ALTURA);
    ctx.moveTo(620, CHAO_Y + 4);
    ctx.lineTo(580, ALTURA);
    ctx.moveTo(480, CHAO_Y + 8);
    ctx.lineTo(500, ALTURA);
    ctx.stroke();

    // ===== POEIRA FLUTUANTE (motes lentos, aditivo) =====
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 42; i++) {
      const s = i * 97.13;
      const vel = 6 + (i % 5) * 3;
      const yy = ALTURA - ((t * vel + s * 11) % (ALTURA + 40));
      const xx = ((s * 53) % LARGURA) + Math.sin(t * 0.5 + i) * 18;
      ctx.globalAlpha = 0.06 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.7 + i));
      ctx.fillStyle = i % 4 === 0 ? PALETA.acentoClaro : "#d8cff0";
      ctx.beginPath();
      ctx.arc(xx, yy, 0.8 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* LOGO "MANSÃO FIGHT" — tipografia pesada (900) com material composto:
     relevo escuro + corpo metálico carmesim (bisel central) + bisel dourado no
     topo + arcos de plasma roxo (acento) + contorno. (cx,cy) é o centro; escala
     e glow são animados pela cinemática. */
  _desenharLogo(ctx, cx, cy, escala, glow) {
    const txt = "MANSÃO FIGHT";
    const now = performance.now();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(escala, escala);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 70px 'Segoe UI', sans-serif";
    try {
      ctx.letterSpacing = "8px";
    } catch (e) {}

    // 1) Relevo/sombra de base com glow de plasma roxo pulsante.
    ctx.save();
    ctx.shadowColor = PALETA.acento;
    ctx.shadowBlur = 26 * glow + 14;
    ctx.fillStyle = "#160a1e";
    ctx.fillText(txt, 0, 6);
    ctx.restore();

    // 2) Corpo metálico carmesim (gradiente vertical com linha de bisel).
    const grad = ctx.createLinearGradient(0, -44, 0, 44);
    grad.addColorStop(0.0, PALETA.carmesimClaro);
    grad.addColorStop(0.46, PALETA.carmesim);
    grad.addColorStop(0.5, "#7a0f18");
    grad.addColorStop(0.54, PALETA.carmesim);
    grad.addColorStop(1.0, PALETA.carmesimEscuro);
    ctx.fillStyle = grad;
    ctx.fillText(txt, 0, 0);

    // 3) Bisel dourado: highlight só na faixa superior das letras.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-LARGURA, -60, LARGURA * 2, 26);
    ctx.clip();
    ctx.fillStyle = "rgba(255,211,77,0.7)";
    ctx.fillText(txt, 0, -1);
    ctx.restore();

    // 4) Arcos elétricos de plasma (acento) varrendo o logo.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = PALETA.acentoClaro;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = Math.max(0, 0.5 + 0.5 * Math.sin(now / 120));
    for (let a = 0; a < 2; a++) {
      ctx.beginPath();
      let ex = -210 + ((now / 6 + a * 200) % 420);
      ctx.moveTo(ex, -20);
      for (let k = 0; k < 5; k++) {
        ex += 16;
        ctx.lineTo(ex, -20 + Math.sin(now / 60 + k + a) * 18);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 5) Contorno escuro para "cravar" o logo no fundo.
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a0712";
    ctx.strokeText(txt, 0, 0);

    try {
      ctx.letterSpacing = "0px";
    } catch (e) {}
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  /* Ícone de CHAMA animado (cursor temático à esquerda do item selecionado no
     menu). Gota dupla (carmesim + dourado) com halo roxo pulsante. */
  _iconeChama(ctx, x, y, s, agora) {
    const fl = 0.5 + 0.5 * Math.sin(agora / 90);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(177,92,255,${0.25 + 0.15 * fl})`;
    ctx.beginPath();
    ctx.arc(0, 0, s * (1.1 + 0.15 * fl), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.moveTo(0, -s * (1.1 + 0.2 * fl));
    ctx.quadraticCurveTo(s * 0.7, -s * 0.2, 0, s * 0.9);
    ctx.quadraticCurveTo(-s * 0.7, -s * 0.2, 0, -s * (1.1 + 0.2 * fl));
    ctx.fillStyle = PALETA.carmesim;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.quadraticCurveTo(s * 0.4, -s * 0.1, 0, s * 0.5);
    ctx.quadraticCurveTo(-s * 0.4, -s * 0.1, 0, -s * 0.7);
    ctx.fillStyle = PALETA.ouro;
    ctx.fill();
    ctx.restore();
  }

  /* ATTRACT MODE — slideshow dos lutadores após ~10s de ociosidade. Mostra o
     retrato (ou o sprite idle como fallback), nome, cidade e estilo, com fade
     de entrada/saída por slide. Qualquer tecla volta ao título. */
  _desenharAttract(ctx) {
    const S = this.start;
    const t = performance.now() / 1000;
    this._desenharFundoMansao(ctx);
    ctx.fillStyle = "rgba(6,4,12,0.5)";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    const pers = PERSONAGENS[S.attractIdx % PERSONAGENS.length];
    const k = S.t / START_TIMING.attractPorSlide;
    const fade = Math.max(0, Math.min(1, Math.min(k, 1 - k) * 6));

    ctx.save();
    ctx.globalAlpha = fade;
    const bw = 280,
      bh = 340,
      bx = LARGURA / 2 - bw / 2,
      by = 70;
    ctx.fillStyle = "#0a0712";
    ctx.fillRect(bx - 6, by - 6, bw + 12, bh + 12);
    const foto = this.recursos.retrato(pers);
    if (foto) {
      this._desenharThumb(ctx, foto, bx, by, bw, bh);
    } else {
      ctx.fillStyle = "#140d1f";
      ctx.fillRect(bx, by, bw, bh);
      const fr = this.recursos.frame(pers, "idle", 0);
      if (fr && fr.ok) {
        const dw = this.recursos.frameW * 1.2;
        const dh = this.recursos.frameH * 1.2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fr.img, LARGURA / 2 - dw / 2, by + bh - dh, dw, dh);
      }
    }
    ctx.strokeStyle = PALETA.acento;
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);

    const ficha = this.recursos.ficha(pers);
    ctx.textAlign = "center";
    ctx.shadowColor = PALETA.acento;
    ctx.shadowBlur = 16;
    ctx.fillStyle = PALETA.ouro;
    ctx.font = "900 40px 'Segoe UI', sans-serif";
    ctx.fillText(
      this.recursos.nome(pers).toUpperCase(),
      LARGURA / 2,
      by + bh + 48,
    );
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETA.texto;
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      ficha.cidade + "  ·  " + ficha.estilo,
      LARGURA / 2,
      by + bh + 74,
    );
    ctx.restore();

    ctx.textAlign = "center";
    ctx.fillStyle =
      Math.floor(t * 2) % 2 === 0 ? PALETA.acentoClaro : PALETA.textoFraco;
    ctx.font = "bold 14px 'Segoe UI', monospace";
    ctx.fillText(
      "— APRESENTANDO OS LUTADORES —   PRESSIONE QUALQUER TECLA",
      LARGURA / 2,
      ALTURA - 22,
    );
  }

  // ---- Tela de configurações -----------------------------------------------
  // Overlay do menu de PAUSE sobre a luta congelada.
  _desenharPause(ctx) {
    // Escurece a cena.
    ctx.fillStyle = "rgba(8,6,16,0.66)";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    if (this.pauseModo === "confirmarSair") {
      this._desenharPauseConfirmar(ctx);
      return;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd34d";
    ctx.font = "bold 52px 'Segoe UI', sans-serif";
    ctx.fillText("PAUSA", LARGURA / 2, 150);

    const opcoes = ["Continuar", "Configurações", "Sair para o Menu"];
    const itemH = 64;
    const startY = 250;
    for (let i = 0; i < opcoes.length; i++) {
      const sel = i === this.pauseIndex;
      const cy = startY + i * itemH;
      if (sel) {
        ctx.fillStyle = "rgba(255,211,77,0.12)";
        ctx.fillRect(LARGURA / 2 - 220, cy - 26, 440, 48);
      }
      ctx.fillStyle = sel ? "#ffd34d" : "#cfc6e0";
      ctx.font = sel
        ? "bold 30px 'Segoe UI', sans-serif"
        : "26px 'Segoe UI', sans-serif";
      ctx.fillText(sel ? `▸  ${opcoes[i]}  ◂` : opcoes[i], LARGURA / 2, cy + 6);
    }

    ctx.fillStyle = "#9b90b5";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ navega  •  ENTER confirma  •  ESC retoma",
      LARGURA / 2,
      478,
    );
  }

  // Caixa de confirmação "Sair da partida?".
  _desenharPauseConfirmar(ctx) {
    const bw = 540,
      bh = 230;
    const bx = LARGURA / 2 - bw / 2;
    const by = ALTURA / 2 - bh / 2;

    ctx.fillStyle = "rgba(20,16,38,0.96)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "#ffd34d";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px 'Segoe UI', sans-serif";
    ctx.fillText("Sair da partida?", LARGURA / 2, by + 64);

    ctx.fillStyle = "#9b90b5";
    ctx.font = "18px 'Segoe UI', sans-serif";
    ctx.fillText("O progresso da luta será perdido.", LARGURA / 2, by + 100);

    const labels = ["Sim", "Não"];
    const bwBtn = 160,
      bhBtn = 52;
    const gap = 40;
    const totalW = bwBtn * 2 + gap;
    const startX = LARGURA / 2 - totalW / 2;
    const btnY = by + bh - 78;
    for (let i = 0; i < 2; i++) {
      const sel = i === this.pauseConfirmIndex;
      const x = startX + i * (bwBtn + gap);
      ctx.fillStyle = sel
        ? i === 0
          ? "rgba(224,48,32,0.30)"
          : "rgba(54,210,58,0.22)"
        : "rgba(255,255,255,0.05)";
      ctx.fillRect(x, btnY, bwBtn, bhBtn);
      ctx.strokeStyle = sel ? (i === 0 ? "#e03020" : "#36d23a") : "#5a5070";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, btnY, bwBtn, bhBtn);
      ctx.fillStyle = sel ? "#ffffff" : "#cfc6e0";
      ctx.font = sel
        ? "bold 24px 'Segoe UI', sans-serif"
        : "22px 'Segoe UI', sans-serif";
      ctx.fillText(labels[i], x + bwBtn / 2, btnY + bhBtn / 2 + 8);
    }

    ctx.fillStyle = "#9b90b5";
    ctx.font = "15px 'Segoe UI', sans-serif";
    ctx.fillText(
      "←/→ escolhe  •  ENTER confirma  •  ESC cancela",
      LARGURA / 2,
      by + bh + 28,
    );
  }

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

  // ---- Tela de seleção de modo (menu principal) ----------------------------
  // Staggered reveal de BAIXO para CIMA ao entrar, cursor de chama temático no
  // item selecionado e separador de grupos (jogo | configurações).
  _desenharModo(ctx) {
    const now = performance.now();
    const rev = (now - this.modoRevealT0) / 1000; // s desde a entrada na tela
    ctx.textAlign = "center";

    // Título com brilho roxo pulsante.
    ctx.save();
    ctx.shadowColor = PALETA.acento;
    ctx.shadowBlur = 18 + 8 * Math.sin(now / 400);
    ctx.fillStyle = PALETA.ouro;
    ctx.font = "900 46px 'Segoe UI', sans-serif";
    ctx.fillText("MODO DE JOGO", LARGURA / 2, 100);
    ctx.restore();

    const opcoes = [
      { label: "1 JOGADOR", sub: "Enfrente a inteligência artificial" },
      { label: "2 JOGADORES", sub: "Partida local entre dois jogadores" },
      { label: "CONFIGURAÇÕES", sub: "Ajuste volume e outras opções" },
    ];
    const n = opcoes.length;
    const baseY = 200;
    const passo = 76;

    // Separador de GRUPOS entre "2 JOGADORES" (jogo) e "CONFIGURAÇÕES".
    const sepRev = Math.max(0, Math.min(1, (rev - 0.05) / 0.4));
    if (sepRev > 0) {
      const sy = baseY + 1.5 * passo + 6;
      ctx.save();
      ctx.globalAlpha = sepRev * 0.6;
      const sg = ctx.createLinearGradient(
        LARGURA / 2 - 200,
        0,
        LARGURA / 2 + 200,
        0,
      );
      sg.addColorStop(0, "rgba(177,92,255,0)");
      sg.addColorStop(0.5, PALETA.acento);
      sg.addColorStop(1, "rgba(177,92,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(LARGURA / 2 - 200, sy, 400, 2);
      ctx.restore();
    }

    for (let i = 0; i < n; i++) {
      // O item mais EMBAIXO entra primeiro (atraso maior p/ itens de cima).
      const atraso = (n - 1 - i) * 0.09;
      const ap = Math.max(0, Math.min(1, (rev - atraso) / 0.28));
      if (ap <= 0) continue;
      const ease = 1 - Math.pow(1 - ap, 3);
      const y = baseY + i * passo + (1 - ease) * 26;
      const sel = i === this.menuIndex;

      ctx.save();
      ctx.globalAlpha = ease;
      if (sel) {
        ctx.fillStyle = "rgba(177,92,255,0.12)";
        ctx.fillRect(LARGURA / 2 - 250, y - 28, 500, 50);
        ctx.fillStyle = PALETA.acento;
        ctx.fillRect(LARGURA / 2 - 250, y - 28, 4, 50); // faixa lateral
        this._iconeChama(ctx, LARGURA / 2 - 212, y - 4, 12, now);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = sel ? PALETA.ouro : PALETA.texto;
      ctx.font = sel
        ? "900 32px 'Segoe UI', sans-serif"
        : "bold 26px 'Segoe UI', sans-serif";
      ctx.fillText(opcoes[i].label, LARGURA / 2, y);
      ctx.fillStyle = sel ? PALETA.acentoClaro : "rgba(207,198,224,0.45)";
      ctx.font = "14px 'Segoe UI', sans-serif";
      ctx.fillText(opcoes[i].sub, LARGURA / 2, y + 22);
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = PALETA.textoFraco;
    ctx.font = "15px 'Segoe UI', sans-serif";
    ctx.fillText(
      "W/S ou ↑/↓ escolher  •  ENTER confirma  •  ESC volta ao título",
      LARGURA / 2,
      470,
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(155,144,181,0.5)";
    ctx.font = "12px 'Segoe UI', monospace";
    ctx.fillText(VERSAO, LARGURA - 16, ALTURA - 14);
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
  /* =========================================================================
     TELA SELECT — RENDERIZAÇÃO ARCADE (estilo MK II / SF Alpha / KOF '98).
     Regiões: [topo] título + contador de ficha; [esquerda] painel P1 (azul);
     [direita] painel P2/CPU (vermelho); [centro] grade de lutadores com dois
     cursores; [rodapé] dicas + indicador de espelho. Overlays: cortinas de
     entrada, selo "PRONTOS!", scanlines/vinheta (CRT alternável com F2).
     ========================================================================= */

  // Imagem completa do estágio de origem de um personagem (ao fundo do preview).
  _imagemEstagio(arquivo) {
    const mapas = (this.catalogo && this.catalogo.mapas) || [];
    const m = mapas.find((x) => x.arquivo === arquivo);
    return m ? m.full : null;
  }

  // Fundo animado: gradiente púrpura profundo + raios pulsantes + brasas subindo.
  _fundoSelect(ctx, agora) {
    const g = ctx.createLinearGradient(0, 0, 0, ALTURA);
    g.addColorStop(0, "#140e26");
    g.addColorStop(0.55, "#0a0815");
    g.addColorStop(1, "#05030c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // Raios geométricos pulsantes irradiando do centro (padrão de arena).
    const cx = LARGURA / 2,
      cy = ALTURA * 0.46;
    const pulso = 0.5 + 0.5 * Math.sin(agora / 600);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.05 + 0.04 * pulso;
    ctx.translate(cx, cy);
    ctx.rotate(agora / 9000);
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.fillStyle = i % 2 === 0 ? SELECT_TEMA.ouro : SELECT_TEMA.p1.cor;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-26, 900);
      ctx.lineTo(26, 900);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Brasas subindo (procedurais, baseadas no tempo — sem estado).
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 34; i++) {
      const semente = i * 127.3;
      const vel = 24 + (i % 7) * 9;
      const yy =
        ALTURA - (((agora / 1000) * vel + semente * 13) % (ALTURA + 60));
      const xx = ((semente * 71) % LARGURA) + Math.sin(agora / 700 + i) * 14;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(agora / 400 + i));
      ctx.globalAlpha = a * (yy / ALTURA);
      ctx.fillStyle = i % 3 === 0 ? SELECT_TEMA.ouro : "#ff7a3a";
      ctx.beginPath();
      ctx.arc(xx, yy, 1 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Barra de atributo segmentada (0–5) com rótulo à esquerda.
  _barraAtributo(ctx, cx, y, rotulo, valor) {
    const left = cx - 110;
    ctx.textAlign = "left";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#cfc6e0";
    ctx.fillText(rotulo, left, y + 10);
    const segs = 5,
      sw = 18,
      gap = 4;
    const barW = segs * sw + (segs - 1) * gap;
    const bx = cx + 110 - barW;
    for (let i = 0; i < segs; i++) {
      const x = bx + i * (sw + gap);
      const ativo = i < valor;
      ctx.fillStyle = ativo ? SELECT_TEMA.ouro : "#241d3a";
      ctx.fillRect(x, y, sw, 11);
      if (ativo) {
        ctx.fillStyle = "rgba(255,255,255,0.35)"; // brilho no topo
        ctx.fillRect(x, y, sw, 3);
      }
      ctx.strokeStyle = "#0a0712";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, 10);
    }
  }

  // Linha de estrelas de dificuldade (1–5), preenchidas em dourado.
  _estrelasDificuldade(ctx, cx, y, n) {
    const left = cx - 110;
    ctx.textAlign = "left";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#cfc6e0";
    ctx.fillText("DIFICULDADE", left, y + 11);
    ctx.font = "14px 'Segoe UI', sans-serif";
    const estrelas = "★★★★★";
    const w = ctx.measureText(estrelas).width;
    const bx = cx + 110 - w;
    ctx.fillStyle = "#241d3a";
    ctx.fillText(estrelas, bx, y + 12);
    ctx.fillStyle = SELECT_TEMA.ouro;
    ctx.fillText("★★★★★".slice(0, n), bx, y + 12);
  }

  // Painel lateral de PREVIEW de um jogador (foto + estágio + ficha completa).
  _painelSelect(ctx, slot, cx, agora) {
    const S = this.select;
    const tema = SELECT_TEMA[slot];
    const cel = SELECT_CELULAS[S.cursor[slot]];
    const confirmado = this.confirmado[slot];
    const ehCPU = slot === "p2" && this.modo === "1p";
    const blink = Math.floor(agora / 250) % 2 === 0;

    // Faixa indicadora (sempre visível) no topo do painel.
    ctx.textAlign = "center";
    ctx.font = "bold 16px 'Segoe UI', sans-serif";
    const titulo = slot === "p1" ? "P1" : ehCPU ? "CPU" : "P2";
    const cpuEscolhendo = ehCPU && this.confirmado.p1 && !this.confirmado.p2;
    let rotulo;
    if (confirmado) rotulo = `${titulo} — PRONTO!`;
    else if (ehCPU && !cpuEscolhendo) rotulo = `${titulo} — AGUARDE`;
    else rotulo = `${titulo} — ESCOLHA SEU LUTADOR`;
    ctx.fillStyle = confirmado ? "#36d23a" : tema.cor;
    if (!confirmado && !blink) ctx.fillStyle = tema.brilho;
    ctx.fillText(rotulo, cx, 102);

    // Caixa do retrato com moldura temática.
    const bw = 220,
      bh = 178,
      bx = cx - bw / 2,
      by = 116;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    // Fundo: estágio de origem (escurecido) OU gradiente neutro.
    if (cel.tipo === "pers") {
      const palco = this._imagemEstagio(this.recursos.ficha(cel.pers).estagio);
      if (palco && palco.width) {
        this._desenharThumb(ctx, palco, bx, by, bw, bh);
        ctx.fillStyle = "rgba(8,5,20,0.5)";
        ctx.fillRect(bx, by, bw, bh);
      } else {
        ctx.fillStyle = "#0c0a18";
        ctx.fillRect(bx, by, bw, bh);
      }
      // Foto real do lutador (cover), com sprite idle como fallback.
      const foto = this.recursos.retrato(cel.pers);
      if (foto && foto.width) {
        const escala = Math.max(bw / foto.width, bh / foto.height);
        const dw = foto.width * escala,
          dh = foto.height * escala;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(foto, cx - dw / 2, by + (bh - dh) / 2, dw, dh);
      } else {
        const fr = this.recursos.frame(cel.pers, "idle", 0);
        if (fr && fr.ok) {
          ctx.imageSmoothingEnabled = false;
          const dh = bh * 1.15,
            dw = dh;
          if (slot === "p2") {
            ctx.translate(cx, 0);
            ctx.scale(-1, 1);
            ctx.translate(-cx, 0);
          }
          ctx.drawImage(fr.img, cx - dw / 2, by + bh - dh, dw, dh);
        }
      }
    } else if (cel.tipo === "random") {
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, "#241a3a");
      g.addColorStop(1, "#0c0a18");
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw, bh);
      const p = 0.6 + 0.4 * Math.sin(agora / 280);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = tema.cor;
      ctx.shadowBlur = 26 * p;
      ctx.fillStyle = SELECT_TEMA.ouro;
      ctx.font = "900 110px 'Segoe UI', monospace";
      ctx.fillText("?", cx, by + bh / 2);
      ctx.shadowBlur = 0;
      ctx.textBaseline = "alphabetic";
    } else {
      // Bloqueado: cadeado.
      ctx.fillStyle = "#0c0a18";
      ctx.fillRect(bx, by, bw, bh);
      this._desenharCadeado(ctx, cx, by + bh / 2 - 6, 46, "#5a4a7a");
    }
    // Flash de transição ao trocar de lutador.
    if (S.trans[slot] < 1) {
      ctx.fillStyle = `rgba(255,255,255,${(1 - S.trans[slot]) * 0.85})`;
      ctx.fillRect(bx, by, bw, bh);
    }
    // Glitch de confirmação: fatias coloridas deslocadas + flash.
    if (S.flash[slot] > 0) {
      const f = S.flash[slot] / 0.45;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const sy = by + Math.random() * (bh - 14);
        ctx.fillStyle = i % 2 === 0 ? tema.cor : SELECT_TEMA.ouro;
        ctx.globalAlpha = 0.5 * f;
        ctx.fillRect(
          bx + (Math.random() - 0.5) * 16,
          sy,
          bw,
          5 + Math.random() * 8,
        );
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(255,255,255,${0.5 * f})`;
      ctx.fillRect(bx, by, bw, bh);
    }
    ctx.restore();

    // Moldura ornamentada (dupla borda + cantos pixel), verde quando confirmado.
    const corBorda = confirmado ? "#36d23a" : tema.cor;
    ctx.strokeStyle = "#0a0712";
    ctx.lineWidth = 6;
    ctx.strokeRect(bx - 3, by - 3, bw + 6, bh + 6);
    ctx.strokeStyle = corBorda;
    ctx.lineWidth = 3;
    ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
    this._cantosPixel(ctx, bx - 4, by - 4, bw + 8, bh + 8, 4, corBorda);

    // ----- Ficha textual abaixo do retrato -----
    ctx.textAlign = "center";
    if (cel.tipo === "pers") {
      const info = this.recursos.ficha(cel.pers);
      // Nome estilizado (sombra dura + brilho temático).
      ctx.save();
      ctx.shadowColor = tema.forte;
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 26px 'Segoe UI', sans-serif";
      ctx.fillText(
        this.recursos.nome(cel.pers).toUpperCase(),
        cx,
        by + bh + 30,
      );
      ctx.restore();
      // Cidade + estilo de luta.
      ctx.fillStyle = SELECT_TEMA.ouro;
      ctx.font = "bold 12px 'Segoe UI', sans-serif";
      ctx.fillText(info.cidade, cx, by + bh + 48);
      ctx.fillStyle = tema.brilho;
      ctx.fillText(info.estilo, cx, by + bh + 64);
      // Barras de atributo.
      const aY = by + bh + 78;
      this._barraAtributo(ctx, cx, aY, "FORÇA", info.atributos.forca);
      this._barraAtributo(
        ctx,
        cx,
        aY + 17,
        "VELOC.",
        info.atributos.velocidade,
      );
      this._barraAtributo(ctx, cx, aY + 34, "DEFESA", info.atributos.defesa);
      this._barraAtributo(
        ctx,
        cx,
        aY + 51,
        "ESPECIAL",
        info.atributos.especial,
      );
      this._estrelasDificuldade(ctx, cx, aY + 70, info.dificuldade);
      // Frase de lore.
      ctx.textAlign = "center";
      ctx.fillStyle = "#9b90b5";
      ctx.font = "italic 12px 'Segoe UI', sans-serif";
      ctx.fillText(info.lore[0], cx, aY + 92);
      if (info.lore[1]) ctx.fillText(info.lore[1], cx, aY + 107);
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = "900 24px 'Segoe UI', sans-serif";
      ctx.fillText(
        cel.tipo === "random" ? "ALEATÓRIO" : "BLOQUEADO",
        cx,
        by + bh + 32,
      );
      ctx.fillStyle = "#9b90b5";
      ctx.font = "13px 'Segoe UI', sans-serif";
      ctx.fillText(
        cel.tipo === "random" ? "O destino escolhe por você" : "EM BREVE",
        cx,
        by + bh + 54,
      );
    }
  }

  // Cadeado simples (slot bloqueado) centrado em (cx, cy).
  _desenharCadeado(ctx, cx, cy, s, cor) {
    ctx.save();
    ctx.strokeStyle = cor;
    ctx.fillStyle = cor;
    ctx.lineWidth = s * 0.12;
    // Arco superior.
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.18, s * 0.28, Math.PI, 0);
    ctx.stroke();
    // Corpo.
    ctx.fillRect(cx - s * 0.42, cy, s * 0.84, s * 0.6);
    // Furo da chave.
    ctx.fillStyle = "#0c0a18";
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.24, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Geometria de uma célula da grade (índice → retângulo em tela).
  _retCelulaSelect(idx) {
    const cellW = 92,
      cellH = 92,
      gap = 14;
    const totalW = SELECT_COLS * cellW + (SELECT_COLS - 1) * gap;
    const startX = LARGURA / 2 - totalW / 2;
    const startY = 212;
    const col = idx % SELECT_COLS,
      lin = Math.floor(idx / SELECT_COLS);
    return {
      x: startX + col * (cellW + gap),
      y: startY + lin * (cellH + gap),
      w: cellW,
      h: cellH,
    };
  }

  // Grade central de lutadores + dois cursores independentes.
  _gradeSelect(ctx, agora) {
    const S = this.select;
    for (let idx = 0; idx < SELECT_CELULAS.length; idx++) {
      const cel = SELECT_CELULAS[idx];
      const { x, y, w, h } = this._retCelulaSelect(idx);
      const tira = 16; // faixa de nome
      const th = h - tira;

      // Conteúdo da célula.
      if (cel.tipo === "pers") {
        const foto = this.recursos.retrato(cel.pers);
        if (foto && foto.width) {
          this._desenharThumb(ctx, foto, x, y, w, th);
        } else {
          const fr = this.recursos.frame(cel.pers, "idle", 0);
          ctx.fillStyle = "#0c0a18";
          ctx.fillRect(x, y, w, th);
          if (fr && fr.ok) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(fr.img, x, y - 6, w, th + 12);
          }
        }
        // Faixa do primeiro nome.
        ctx.fillStyle = "#1a1430";
        ctx.fillRect(x, y + th, w, tira);
        ctx.fillStyle = "#cfc6e0";
        ctx.font = "bold 11px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        const primeiro = this.recursos
          .nome(cel.pers)
          .split(" ")[0]
          .toUpperCase();
        ctx.fillText(primeiro, x + w / 2, y + th + 12);
      } else if (cel.tipo === "random") {
        this._desenharCelulaAleatoria(ctx, x, y, w, th, agora);
        ctx.fillStyle = "#1a1430";
        ctx.fillRect(x, y + th, w, tira);
        ctx.fillStyle = SELECT_TEMA.ouro;
        ctx.font = "bold 11px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("?", x + w / 2, y + th + 12);
      } else {
        ctx.fillStyle = "#100c1e";
        ctx.fillRect(x, y, w, th);
        this._desenharCadeado(ctx, x + w / 2, y + th / 2 - 4, 30, "#4a3d6a");
        ctx.fillStyle = "#1a1430";
        ctx.fillRect(x, y + th, w, tira);
        ctx.fillStyle = "#6a5d8a";
        ctx.font = "bold 10px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("EM BREVE", x + w / 2, y + th + 12);
      }

      // Borda pixel base.
      ctx.strokeStyle = "#3a2f4f";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      this._cantosPixel(ctx, x, y, w, h, 3, "#5a4a7a");
    }

    // Cursores (desenhados por cima): P2 mais externo p/ ficar visível no clone.
    // Em 1P o cursor da CPU também aparece, indicando a escolha do oponente.
    this._cursorSelect(ctx, "p2", agora);
    this._cursorSelect(ctx, "p1", agora);
  }

  // Cursor animado de um jogador sobre sua célula atual.
  _cursorSelect(ctx, slot, agora) {
    if (
      slot === "p2" &&
      this.modo === "1p" &&
      !this.confirmado.p2 &&
      this.confirmado.p1
    )
      return;
    const S = this.select;
    const tema = SELECT_TEMA[slot];
    const { x, y, w, h } = this._retCelulaSelect(S.cursor[slot]);
    const confirmado = this.confirmado[slot];
    // P1 colado na célula; P2 um pouco mais externo (visível mesmo sobreposto).
    const out = slot === "p1" ? 3 : 7;
    const osc = confirmado
      ? 0
      : Math.round(2 * (0.5 + 0.5 * Math.sin(agora / 150)));
    const cx = x - out - osc,
      cy = y - out - osc,
      cw = w + (out + osc) * 2,
      ch = h + (out + osc) * 2;
    const piscar = Math.floor(agora / 110) % 2 === 0;
    let cor = tema.cor;
    if (confirmado) cor = "#36d23a";
    else if (piscar) cor = tema.brilho;
    ctx.strokeStyle = cor;
    ctx.lineWidth = 4;
    ctx.strokeRect(cx, cy, cw, ch);
    this._cantosPixel(ctx, cx, cy, cw, ch, 4, cor);

    // Etiqueta do jogador na quina.
    const tag = slot === "p1" ? "1P" : "2P";
    ctx.fillStyle = cor;
    ctx.fillRect(cx - 2, cy - 16, 24, 16);
    ctx.fillStyle = "#0a0712";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(tag, cx + 10, cy - 4);

    // Selo "PRONTO" quando confirmado.
    if (confirmado) {
      ctx.save();
      ctx.translate(cx + cw / 2, cy + ch / 2);
      ctx.rotate(-0.18);
      ctx.fillStyle = "rgba(54,210,58,0.9)";
      ctx.fillRect(-44, -13, 88, 26);
      ctx.fillStyle = "#06210a";
      ctx.font = "900 16px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PRONTO", 0, 6);
      ctx.restore();
    }
  }

  // Overlays finais: cortinas de entrada, selo "PRONTOS!", scanlines/vinheta.
  _overlaySelect(ctx, agora) {
    const S = this.select;

    // Selo "LUTADORES PRONTOS!" antes de seguir para o estágio.
    if (S.saindo > 0) {
      const f = 1 - S.saindo / 0.85; // 0→1
      ctx.fillStyle = `rgba(0,0,0,${0.35 * f})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
      const jit = (Math.random() - 0.5) * 6 * (1 - f); // tremor glitch inicial
      ctx.save();
      ctx.textAlign = "center";
      ctx.translate(LARGURA / 2 + jit, ALTURA / 2);
      ctx.shadowColor = SELECT_TEMA.ouro;
      ctx.shadowBlur = 28;
      ctx.fillStyle = "#fff";
      ctx.font = "900 56px 'Segoe UI', sans-serif";
      ctx.fillText("PRONTOS!", 0, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = SELECT_TEMA.ouro;
      ctx.font = "bold 20px 'Segoe UI', sans-serif";
      ctx.fillText("PREPAREM-SE PARA LUTAR", 0, 38);
      ctx.restore();
    }

    // Cortinas de entrada (abrem do centro) + flash inicial.
    if (S.intro > 0) {
      const prog = S.intro / 0.7; // 1→0
      const halfW = (LARGURA / 2) * prog;
      ctx.fillStyle = "#05030c";
      ctx.fillRect(0, 0, halfW, ALTURA);
      ctx.fillRect(LARGURA - halfW, 0, halfW, ALTURA);
      // Bordas brilhantes das cortinas.
      ctx.fillStyle = SELECT_TEMA.ouro;
      ctx.fillRect(halfW - 3, 0, 3, ALTURA);
      ctx.fillRect(LARGURA - halfW, 0, 3, ALTURA);
      const flash = Math.max(0, prog - 0.55) * 2.2;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, flash)})`;
        ctx.fillRect(0, 0, LARGURA, ALTURA);
      }
    }

    // Filtro CRT (alternável com F2): scanlines + vinheta.
    if (this.crt) {
      this._scanlines(ctx);
      const vg = ctx.createRadialGradient(
        LARGURA / 2,
        ALTURA / 2,
        ALTURA * 0.35,
        LARGURA / 2,
        ALTURA / 2,
        ALTURA * 0.78,
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
  }

  _desenharSelect(ctx) {
    const S = this.select;
    if (!S) return;
    const agora = performance.now();

    this._fundoSelect(ctx, agora);

    // Título com brilho pulsante.
    const pulso = 0.55 + 0.45 * Math.sin(agora / 350);
    ctx.save();
    ctx.textAlign = "center";
    ctx.shadowColor = SELECT_TEMA.ouro;
    ctx.shadowBlur = 24 * pulso;
    ctx.fillStyle = SELECT_TEMA.ouro;
    ctx.font = "900 40px 'Segoe UI', sans-serif";
    const tituloSelect =
      this.modo === "1p" && this.confirmado.p1 && !this.confirmado.p2
        ? "ESCOLHA O OPONENTE"
        : "ESCOLHA SEU LUTADOR";
    ctx.fillText(tituloSelect, LARGURA / 2, 56);
    ctx.restore();

    // Contador de "ficha" (centro, abaixo do título). Pisca em vermelho no fim.
    const seg = Math.ceil(S.timer);
    const urgente = seg <= 10;
    const bw = 70,
      bx = LARGURA / 2 - bw / 2,
      by = 68;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bx, by, bw, 30);
    ctx.strokeStyle = urgente ? "#ff5a5a" : SELECT_TEMA.ouro;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, 30);
    ctx.textAlign = "center";
    ctx.fillStyle =
      urgente && Math.floor(agora / 250) % 2 === 0 ? "#ff5a5a" : "#fff";
    ctx.font = "900 22px 'Segoe UI', monospace";
    ctx.fillText(String(seg).padStart(2, "0"), LARGURA / 2, by + 23);
    if (urgente && !this.confirmado.p1) {
      ctx.fillStyle =
        Math.floor(agora / 300) % 2 === 0 ? SELECT_TEMA.ouro : "#ff5a5a";
      ctx.font = "bold 12px 'Segoe UI', sans-serif";
      ctx.fillText("INSIRA UMA FICHA!", LARGURA / 2, by + 46);
    }

    // Painéis de preview (laterais) e grade central.
    this._painelSelect(ctx, "p1", 150, agora);
    this._painelSelect(ctx, "p2", LARGURA - 150, agora);
    this._gradeSelect(ctx, agora);

    // Partículas de confirmação (faíscas temáticas).
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of S.particulas) {
      ctx.globalAlpha = Math.max(0, p.vida / p.vidaMax);
      ctx.fillStyle = p.cor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.raio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Indicador de ESPELHO/CLONE quando ambos miram o mesmo lutador.
    const i1 = this._persDoCursor("p1"),
      i2 = this._persDoCursor("p2");
    if (i1 >= 0 && i1 === i2) {
      ctx.textAlign = "center";
      ctx.fillStyle =
        Math.floor(agora / 200) % 2 === 0 ? SELECT_TEMA.ouro : "#fff";
      ctx.font = "900 18px 'Segoe UI', sans-serif";
      ctx.fillText("— ESPELHO! —", LARGURA / 2, 432);
    }

    // Rodapé com o mapeamento de teclas.
    ctx.textAlign = "center";
    ctx.fillStyle = "#9b90b5";
    ctx.font = "13px 'Segoe UI', sans-serif";
    const dica =
      this.modo === "2p"
        ? "P1: WASD + F   •   P2: ← ↑ → ↓ + J   •   ESC cancela/volta   •   F2 CRT"
        : "WASD para mover   •   F / ENTER confirma   •   ESC volta   •   F2 CRT";
    ctx.fillText(dica, LARGURA / 2, ALTURA - 16);

    this._overlaySelect(ctx, agora);
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

  // Desenha a imagem do mapa PREENCHENDO a célula (modo "cover"): escala para
  // cobrir todo o retângulo e recorta o excedente (sem barras pretas). Como os
  // mapas são bem largos (1920×540), isso mostra o miolo do estágio cheio na
  // célula. O clip garante que o excedente não vaze para fora da borda.
  _desenharThumb(ctx, img, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    if (img && img.width) {
      const escala = Math.max(w / img.width, h / img.height); // COVER
      const dw = img.width * escala;
      const dh = img.height * escala;
      ctx.imageSmoothingEnabled = true; // downscale suave fica melhor
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
    ctx.restore();
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

  // Desenha o miolo da célula "ALEATÓRIO": fundo escuro + "?" grande pulsante.
  _desenharCelulaAleatoria(ctx, x, y, w, h, agora) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#241a3a");
    g.addColorStop(1, "#0c0a18");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    const pulso = 0.6 + 0.4 * Math.sin(agora / 280);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#5cd6ff";
    ctx.shadowBlur = 22 * pulso;
    ctx.fillStyle = "#ffd34d";
    ctx.font = `900 ${Math.floor(h * 0.6)}px 'Segoe UI', monospace`;
    ctx.fillText("?", x + w / 2, y + h / 2);
    ctx.restore();
    ctx.textBaseline = "alphabetic";
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

    const celulas = sel.celulas; // mapas + célula "ALEATÓRIO"
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

    for (let idx = 0; idx < celulas.length; idx++) {
      const col = idx % cols;
      const lin = Math.floor(idx / cols);
      const x = areaX + col * (cellW + gap);
      const y = startY + lin * (cellH + gap);
      const m = celulas[idx];
      const ehSel = idx === sel.indice;
      const thumbH = cellH - tiraNome;

      if (m.aleatorio) {
        // Célula "ALEATÓRIO": tile escuro com um "?" grande pulsante (estilo arcade).
        this._desenharCelulaAleatoria(ctx, x, y, cellW, thumbH, agora);
      } else {
        // Miniatura preenchendo a célula (cover, recortando o excedente).
        this._desenharThumb(ctx, m.full, x, y, cellW, thumbH);
      }

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
        this._cantosPixel(
          ctx,
          x - 3,
          y - 3,
          cellW + 6,
          cellH + 6,
          4,
          on ? "#ffffff" : "#5cd6ff",
        );
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
    this._barraEspecial(
      ctx,
      LARGURA - 30 - w,
      y + h + 4,
      w,
      8,
      this.p2.especial,
      true,
    );
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
