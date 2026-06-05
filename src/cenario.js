"use strict";

/* ===========================================================================
   CENÁRIO (PALCO) — fundo da arena em CAMADAS para PARALLAX + NPCs de fundo.

   Substitui o desenho de imagem ÚNICA por uma pilha de CAMADAS, cada uma com um
   fator de PARALLAX:
     parallax = 1.0  -> plano do gameplay (move junto com a câmera);
     parallax < 1.0  -> mais distante (rola mais devagar = profundidade);
     parallax > 1.0  -> primeiro plano (passa NA FRENTE dos lutadores).
   Camadas com "frente": true são desenhadas DEPOIS dos lutadores (desenharFrente).

   COMPATÍVEL COM O QUE JÁ EXISTE: se o mapa NÃO declara "camadas", o Cenário usa
   a IMAGEM ÚNICA (mapa.full ou o fallback recursos.mapa) como uma só camada
   parallax=1.0 — renderização idêntica à de antes. Sem nenhuma imagem, cai no
   fundo PROCEDURAL (o mesmo de _desenharArena antigo).

   COMO ADICIONAR PARALLAX/NPCs A UM MAPA (sem tocar no código) — em
   assets/data/mapas.json, no objeto do mapa:
     {
       "arquivo": "arena1.png",
       "nome": "UTFPR",
       "camadas": [
         { "arquivo": "arena1_ceu.png",     "parallax": 0.2 },
         { "arquivo": "arena1_predios.png", "parallax": 0.5 },
         { "arquivo": "arena1.png",         "parallax": 1.0 },
         { "arquivo": "arena1_grade.png",   "parallax": 1.15, "frente": true }
       ],
       "npcs": [
         { "sprite": "torcedor", "x": 420, "y": 486, "parallax": 0.6,
           "frames": 2, "fps": 6, "escala": 1.0, "flip": false }
       ]
     }
   Cada PNG de camada deve ter a largura do MUNDO (MUNDO_L x ALTURA, ex. 1920x540),
   igual ao asset de arena atual. Sprites de NPC ficam em
   assets/cenarios/<sprite>_<i>.png (i = 0,1,2... contíguos).
   =========================================================================== */

// Coloca uma camada no MUNDO de forma que ela role a uma fração "parallax" da
// câmera. Como o mundo já está transladado por -cameraX na hora do desenho, pôr a
// camada em worldX = cameraX*(1-parallax) faz sua posição na TELA virar
// -cameraX*parallax: parallax 1.0 => fixa no mundo; <1.0 => rola mais devagar.
function offsetParallax(cameraX, parallax) {
  return cameraX * (1 - (parallax != null ? parallax : 1.0));
}

// Uma CAMADA de fundo: imagem do tamanho do mundo desenhada com seu parallax.
class CamadaCenario {
  constructor(img, parallax, frente) {
    this.img = img;
    this.parallax = parallax != null ? parallax : 1.0;
    this.frente = !!frente;
  }

  desenhar(ctx, cameraX) {
    if (!this.img || !this.img.width) return;
    const x = offsetParallax(cameraX, this.parallax);
    ctx.drawImage(this.img, x, 0, MUNDO_L, ALTURA);
  }
}

// NPC de fundo: sprite estático ou em loop simples, posicionado no mundo com seu
// próprio parallax. Não interage com a luta — é puramente decorativo (torcida,
// passantes, etc.). Anima por timer próprio (independe do Animator dos lutadores).
class NpcCenario {
  constructor(def, frames) {
    def = def || {};
    this.x = def.x != null ? def.x : MUNDO_L / 2; // posição no MUNDO (centro do sprite)
    this.y = def.y != null ? def.y : CHAO_Y; // base do sprite (os "pés")
    this.parallax = def.parallax != null ? def.parallax : 1.0;
    this.escala = def.escala != null ? def.escala : 1.0;
    this.flip = !!def.flip; // espelha horizontalmente (vira o NPC para o outro lado)
    this.fps = def.fps || 6;
    this.frente = !!def.frente; // se true, é desenhado na frente dos lutadores
    this.frames = frames || []; // Array<Image> já carregadas
    this.frame = 0;
    this.timer = 0;
  }

  atualizar(dt) {
    if (this.frames.length <= 1) return;
    const dur = 1 / this.fps;
    this.timer += dt;
    while (this.timer >= dur) {
      this.timer -= dur;
      this.frame = (this.frame + 1) % this.frames.length;
    }
  }

  desenhar(ctx, cameraX) {
    const img = this.frames[this.frame];
    if (!img || !img.width) return;
    const x = this.x + offsetParallax(cameraX, this.parallax);
    const dw = img.width * this.escala;
    const dh = img.height * this.escala;
    if (this.flip) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -dw / 2, this.y - dh, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(img, x - dw / 2, this.y - dh, dw, dh);
    }
  }
}

// O PALCO da luta: monta-se a partir do descritor de mapa do CatalogoMapas.
// Separa fundo (atrás dos lutadores) e frente (na frente deles).
class Cenario {
  // mapa = descritor do CatalogoMapas (pode ser null/sem extras).
  // imagemFallback = recursos.mapa (imagem única já carregada no boot).
  constructor(mapa, imagemFallback) {
    this.camadasFundo = [];
    this.camadasFrente = [];
    this.npcsFundo = [];
    this.npcsFrente = [];
    this.imagemUnica = null; // usada quando não há camadas declaradas

    // Camadas: se o mapa declara uma pilha, usa-a; senão, imagem única (compat).
    if (mapa && Array.isArray(mapa.camadas) && mapa.camadas.length) {
      for (const c of mapa.camadas) {
        const cam = new CamadaCenario(c.img, c.parallax, c.frente);
        (cam.frente ? this.camadasFrente : this.camadasFundo).push(cam);
      }
    } else if (mapa && mapa.full) {
      this.imagemUnica = mapa.full;
    } else if (imagemFallback) {
      this.imagemUnica = imagemFallback;
    }

    // NPCs de fundo (opcionais).
    if (mapa && Array.isArray(mapa.npcs)) {
      for (const n of mapa.npcs) {
        const npc = new NpcCenario(n.def, n.frames);
        (npc.frente ? this.npcsFrente : this.npcsFundo).push(npc);
      }
    }
  }

  atualizar(dt) {
    for (const n of this.npcsFundo) n.atualizar(dt);
    for (const n of this.npcsFrente) n.atualizar(dt);
  }

  // FUNDO — camadas distantes + NPCs de fundo. Desenhado SOB a translação da
  // câmera (o chamador já aplicou ctx.translate(-cameraX, 0)).
  desenharFundo(ctx, cameraX) {
    if (this.camadasFundo.length) {
      for (const c of this.camadasFundo) c.desenhar(ctx, cameraX);
    } else if (this.imagemUnica) {
      // A imagem é esticada para ocupar o mundo inteiro (MUNDO_L x ALTURA).
      ctx.drawImage(this.imagemUnica, 0, 0, MUNDO_L, ALTURA);
    } else {
      Cenario.desenharProcedural(ctx);
    }
    for (const n of this.npcsFundo) n.desenhar(ctx, cameraX);
  }

  // FRENTE — NPCs e camadas que passam NA FRENTE dos lutadores (parallax > 1).
  // Desenhado depois dos lutadores, ainda sob a translação da câmera.
  desenharFrente(ctx, cameraX) {
    for (const n of this.npcsFrente) n.desenhar(ctx, cameraX);
    for (const c of this.camadasFrente) c.desenhar(ctx, cameraX);
  }

  // Fundo PROCEDURAL (fallback) — mesmo visual do antigo _desenharArena quando
  // não há imagem de mapa: cobre o MUNDO inteiro (MUNDO_L x ALTURA).
  static desenharProcedural(ctx) {
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
}
