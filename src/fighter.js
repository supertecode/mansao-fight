"use strict";

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

    // --- Backdash defensivo (ESPECIAL + TRÁS, exclusivo do personagem P2) ---
    this.backdashCooldown = 0; // s restantes até liberar outro dash (0 = pronto)
    this.backdashDur = 0; // s — duração efetiva do dash em curso (distância/vel ∨ duracao)
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

  // O golpe atual está nos quadros ativos (causando dano)?
  // O TIMING vem SEMPRE do frame data (startup/ativo, em 60fps de referência),
  // medido a partir do início do estado — portanto INDEPENDENTE de quantos
  // sprites a animação tem. É isso que torna as animações escalonáveis: dá para
  // adicionar quadros intermediários (mais fluidez) sem mudar QUANDO o golpe
  // acerta. Se o visual sair de sincronia com o golpe ao adicionar frames,
  // ajuste o "fps" da animação (mantendo a duração) e/ou o "startup" no golpe.
  // OBS: "framesAtivos" no manifest virou LEGADO e não afeta mais o timing.
  _golpeAtivo() {
    const frames60 = this.estadoTempo * 60;
    const fd = this.golpes[this.golpeAtual];
    if (fd && fd.startup != null && fd.ativo != null) {
      return frames60 >= fd.startup && frames60 < fd.startup + fd.ativo;
    }
    // Sem frame data (ex.: super-projétil na pose "item"): janela padrão para o
    // disparo acontecer mesmo assim.
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
      case ESTADOS.PUNCH: {
        // Variantes do soco (punch_step, soco_baixo, ...) usam o sprite de
        // mesmo nome se existir; senão reaproveitam "punch". Assim um golpe
        // novo funciona pela FRAME DATA mesmo antes de ganhar arte própria.
        const g = this.golpeAtual || "punch";
        return r.temSprite(this.personagem, g) ? g : "punch";
      }
      case ESTADOS.KICK:
        return this.golpeAtual || "kick";
      case ESTADOS.THROW_TECH:
        // Sem arte própria de tech: cai para uma pose de recuo/guarda existente.
        return fb("throw_tech", fb("tech", fb("block", "hit")));
      case ESTADOS.BACKDASH:
        // Anim dedicada se existir (assets/sprites/<p>/backdash_*.png + manifest);
        // senão reaproveita uma pose de movimento/recuo já presente no sprite.
        return fb("backdash", fb("dash", fb("run", fb("block", "walk"))));
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
  // movendo  = andando/correndo (usa o passo "punch_step").
  // agachado = em postura baixa (AGACHAR+SOCO) -> dispara o SOCO BAIXO.
  // O nome escolhido vira o golpeAtual: tanto a FRAME DATA (this.golpes[nome])
  // quanto a animação saem dele, então um novo golpe baixo é só uma entrada
  // a mais em CONFIG.golpes/manifest — sem tocar nesta função.
  iniciarSoco(movendo, agachado) {
    let golpe = "punch";
    if (agachado && this.golpes["soco_baixo"]) golpe = "soco_baixo";
    else if (movendo && this.recursos.tem(this.personagem, "punch_step"))
      golpe = "punch_step";
    this.irPara(ESTADOS.PUNCH, true, golpe);
  }

  iniciarChute(agachado, noAr) {
    let anim = "kick";
    if (noAr && this.recursos.tem(this.personagem, "kick_jump"))
      anim = "kick_jump";
    else if (agachado && this.recursos.tem(this.personagem, "kick_mid"))
      anim = "kick_mid";
    // Personagem sem o sprite "kick" em pé (ex.: p3/Erick): usa o avanço "lunge"
    // como chute padrão; sem isso o estado KICK travaria (meta nulo nunca termina).
    if (!this.recursos.tem(this.personagem, anim)) {
      if (this.recursos.tem(this.personagem, "lunge")) anim = "lunge";
      else if (this.recursos.tem(this.personagem, "kick_mid")) anim = "kick_mid";
    }
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

  // THROW TECH: agarrão cancelado por agarrão simultâneo do oponente. Nenhum
  // dano, nenhum arremesso — só um recuo simétrico e a pose de tech. Volta ao
  // neutro sozinho via _transicoes (estado THROW_TECH não é livre nem de golpe).
  techThrow(origemX) {
    this.irPara(ESTADOS.THROW_TECH, true);
    const dir = this.x <= origemX ? -1 : 1; // afasta-se de quem estava à frente
    this.vx = dir * CONFIG.throwTech.empurrao;
    // O tech "quebra" qualquer combo em andamento dos dois lados.
    this.comboRecebido = 0;
    this.comboResetTimer = 0;
  }

  // NOVO: especial (gasta a barra cheia; lança o super-projétil na pose "special").
  iniciarEspecial() {
    this.especial = 0;
    this.irPara(ESTADOS.SPECIAL, true, "super"); // "super" = tipo de projétil
    this.jogo.audio.especial();
  }

  /* ESPECIAL DEFENSIVO (P2): dash rápido para TRÁS (esquiva). -------------------
     "Trás" é relativo ao facing — o lutador sempre recua mantendo a orientação
     (encarando o oponente), pois BACKDASH não é estado livre e o facing fica
     congelado durante o movimento. Não gasta a barra de especial nem causa dano;
     reutiliza this.invencivel (mesma flag do wakeup) para os i-frames. O dash é
     dirigido por velocidade constante (sem atrito — ver _fisica) e encerra
     sozinho ao percorrer a distância/duração configurada (ver _transicoes). */
  iniciarBackdash() {
    const cfg = CONFIG.backdash;
    const tras = -this.facing; // oposto de para onde olha = recuo relativo
    this.irPara(ESTADOS.BACKDASH, true);
    this.vx = tras * cfg.vel;
    this.backdashCooldown = cfg.cooldownMs / 1000;
    // Encerra no que vier primeiro: fechar a distância OU estourar a duração.
    this.backdashDur = Math.min(cfg.duracao, cfg.distancia / cfg.vel);
    if (cfg.invulneravel)
      this.invencivel = Math.max(this.invencivel, this.backdashDur);
    this.jogo.audio.pulo(); // "whoosh" leve de esquiva (reaproveita o som de pulo)
  }

  // Pode iniciar o backdash? Exclusivo do personagem configurado, só no chão e
  // com o cooldown zerado. Não depende da barra de especial (é mobilidade).
  podeBackdash() {
    return (
      this.personagem === CONFIG.backdash.exclusivoPersonagem &&
      this.noChao &&
      this.backdashCooldown <= 0
    );
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
    if (this.backdashCooldown > 0) this.backdashCooldown -= dt;
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
        // Cancelamento em combo parte sempre de uma pose de ataque (em pé):
        // não há agachamento aqui, então soco alto padrão.
        this.iniciarSoco(false, false);
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
      // ESPECIAL + TRÁS = backdash defensivo (P2). Checado ANTES do super: o
      // mesmo botão "especial" vira dash QUANDO se está segurando a direção de
      // recuo. Como é distinguido pela direção, não conflita com o super (sem
      // direção) nem com o Fireball (que é outra tecla, "projetil"). Não custa
      // barra, então independe de this.especial.
      const segurandoTras =
        (this.facing === 1 && querEsq) || (this.facing === -1 && querDir);
      // Para o personagem do dash, ESPECIAL+TRÁS é RESERVADO ao backdash: se
      // estiver em cooldown (ou no ar), o comando é absorvido sem virar super —
      // assim o jogador nunca gasta a barra cheia por engano ao tentar esquivar.
      const querBackdash =
        acoes.includes("especial") &&
        segurandoTras &&
        this.personagem === CONFIG.backdash.exclusivoPersonagem;
      if (querBackdash) {
        if (this.podeBackdash()) this.iniciarBackdash();
        return;
      }
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
        // AGACHAR+SOCO = soco baixo (mesma convenção do AGACHAR+CHUTE = kick_mid).
        this.iniciarSoco(querEsq || querDir, agachado);
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

    if (
      this.estado !== ESTADOS.WALK &&
      this.estado !== ESTADOS.JUMP &&
      this.estado !== ESTADOS.BACKDASH
    ) {
      // No chão e fora do andar/dash: desacelera rápido (empurrões, hit stun…).
      this.vx *= Math.pow(0.0008, dt);
      if (Math.abs(this.vx) < 4) this.vx = 0;
    }
    // BACKDASH: velocidade constante — o movimento é encerrado por _transicoes
    // (distância/duração), não pelo atrito. Mantém o recuo nítido e previsível.
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
      case ESTADOS.THROW_TECH:
        // Trava na pose pela duração configurada (a pose de fallback costuma ter
        // 1 quadro e "terminar" no ato), depois volta ao neutro.
        if (this.estadoTempo >= CONFIG.throwTech.duracaoMs / 1000)
          this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.BACKDASH:
        // Encerra o dash ao percorrer a distância/duração (o que vier primeiro,
        // já resolvido em backdashDur) e retorna ao neutro, zerando o impulso.
        if (this.estadoTempo >= this.backdashDur) {
          this.vx = 0;
          this.irPara(ESTADOS.IDLE, true);
        }
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

