"use strict";

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

