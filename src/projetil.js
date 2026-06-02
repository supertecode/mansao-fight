"use strict";

/* ===========================================================================
   7) PROJÉTIL — viaja na horizontal (ou em ARCO/PARÁBOLA), deixa rastro, some
   na borda/no chão/ao acertar.

   TRAJETÓRIA: por padrão o projétil anda em linha reta na horizontal. Se a
   config tiver "gravidade" > 0 (ver CONFIG.projetilPorPersonagem), ele ganha
   velocidade vertical inicial "vy" e é puxado por "gravidade" a cada segundo,
   descrevendo um ARCO — a fireball PARABÓLICA do P1 nasce daqui sem que P2/P3
   sejam afetados. Colisão (caixa()) e dano permanecem idênticos aos da reta.
   =========================================================================== */

class Projetil {
  constructor(dono, tipo) {
    const base = PROJETEIS[tipo] || PROJETEIS.fireball;
    // Override por PERSONAGEM (sprite): mescla campo a campo sobre o tipo base.
    // É o que torna a fireball parabólica EXCLUSIVA do P1 (mesmo padrão de
    // montarGolpes): sem override, "over" é undefined e usa-se o projétil padrão.
    const over =
      (CONFIG.projetilPorPersonagem[dono.personagem] || {})[tipo] || null;
    const cfg = over ? { ...base, ...over } : base;

    this.dono = dono;
    this.tipo = tipo;
    this.dano = cfg.dano;
    this.cor = cfg.cor;
    this.facing = dono.facing;

    // Velocidade horizontal: "vx" (arco) tem prioridade; senão usa "vel" (reta).
    // O facing converte para o lado correto da tela (vale p/ ambos os lados).
    const velH = cfg.vx != null ? cfg.vx : cfg.vel;
    this.vx = velH * this.facing;

    // --- Componentes da PARÁBOLA (0 quando o projétil é reto) ---------------
    // gravidade > 0 ativa o arco; vy é a velocidade vertical inicial (sobe se <0).
    this.gravidade = cfg.gravidade || 0;
    this.vy = cfg.vy || 0;
    // Tempo de vida opcional (s): rede de segurança para o projétil sumir mesmo
    // que, por configuração, ele não cruze nenhuma borda. null = sem limite.
    this.tempoVida = cfg.tempoVida != null ? cfg.tempoVida : null;

    this.x = dono.x + this.facing * 70;
    this.y = CHAO_Y - 132;
    this.raio = cfg.raio;
    this.vivo = true;
    this.t = 0;
    this.tRastro = 0; // acumulador para soltar o rastro
  }

  atualizar(dt) {
    this.t += dt;

    // Integração da física: na reta, gravidade=0 e vy=0 (comportamento antigo
    // intacto). Na parábola, a gravidade acelera vy e o projétil curva o arco.
    if (this.gravidade) this.vy += this.gravidade * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

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

    // Some ao sair dos LIMITES do jogo: laterais (sempre) e, no arco, também ao
    // tocar o chão ou subir demais. Some também ao estourar o tempo de vida.
    if (this.x < -40 || this.x > MUNDO_L + 40) this.vivo = false;
    if (this.gravidade && (this.y > CHAO_Y + 10 || this.y < -240))
      this.vivo = false;
    if (this.tempoVida != null && this.t >= this.tempoVida) this.vivo = false;
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

