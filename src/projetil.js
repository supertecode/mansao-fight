"use strict";

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

