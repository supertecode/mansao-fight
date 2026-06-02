"use strict";

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
    // Usa a contagem EFETIVA de quadros (só os sprites que carregaram), caindo
    // para o "frames" declarado se ainda não foi calculada. Permite declarar mais
    // quadros no JSON do que existem em disco e ir adicionando a arte aos poucos.
    const total =
      this.meta.framesReais != null ? this.meta.framesReais : this.meta.frames;
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

