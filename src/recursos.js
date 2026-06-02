"use strict";

/* ===========================================================================
   1) CARREGADOR DE RECURSOS
   O manifest foi DIVIDIDO em vários arquivos (assets/manifest.json é só o
   índice; cada lutador vive em assets/data/players/<p>.json e a lista de mapas
   em assets/data/mapas.json). carregarManifest() lê o índice, resolve as
   referências em paralelo e devolve um objeto com a MESMA forma de antes
   ({ frameSize, mapa, mapas:[...], players:{p1:{...},...} }), então nada
   downstream (Recursos, CatalogoMapas, Fighter) precisou mudar.
   =========================================================================== */

// Lê um JSON via fetch; cai para XMLHttpRequest se o fetch falhar (alguns
// navegadores bloqueiam fetch de arquivos locais via file://).
async function lerJSON(caminho) {
  try {
    const resp = await fetch(caminho, { cache: "no-cache" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } catch (e) {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", caminho, true);
      xhr.onload = () => {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("Falha ao ler " + caminho));
      xhr.send();
    });
  }
}

// Resolve um campo que pode ser ou um caminho (string, relativo a assets/) ou
// já o próprio valor inline. Mantém compatibilidade: dá para voltar a colar o
// objeto/array direto no manifest.json que continua funcionando.
function resolverRef(valor, padrao) {
  if (typeof valor === "string") return lerJSON(`assets/${valor}`);
  return Promise.resolve(valor !== undefined ? valor : padrao);
}

async function carregarManifest() {
  const indice = await lerJSON("assets/manifest.json");

  // Resolve a lista de mapas e cada lutador referenciado, tudo em paralelo.
  const refsPlayers = indice.players || {};
  const chaves = Object.keys(refsPlayers);
  const [mapas, ...playersResolvidos] = await Promise.all([
    resolverRef(indice.mapas, []),
    ...chaves.map((k) => resolverRef(refsPlayers[k], {})),
  ]);

  const players = {};
  chaves.forEach((k, i) => {
    players[k] = playersResolvidos[i];
  });

  // Devolve o manifest completo montado, na forma esperada pelo resto do código.
  return { ...indice, mapas, players };
}

function carregarImagem(caminho) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ img, ok: true });
    img.onerror = () => resolve({ img, ok: false });
    img.src = caminho;
  });
}

class Recursos {
  constructor(manifest) {
    this.manifest = manifest;
    this.frameW = manifest.frameSize ? manifest.frameSize[0] : 256;
    this.frameH = manifest.frameSize ? manifest.frameSize[1] : 256;
    this.dados = {};
    this.faltando = 0;
    // Retratos da tela de seleção (fotos reais), por personagem.
    this.retratos = {};
    // Imagem de fundo da arena (largura = MUNDO_L x altura = ALTURA).
    // Opcional: se não existir, o cenário procedural é usado como fallback.
    this.mapa = null;
  }

  async precarregar() {
    const tarefas = [];

    // Retratos para a seleção de personagem. O ARQUIVO vem do manifest
    // (players.<p>.retrato), ficando em assets/retratos/. Se o campo faltar ou
    // a imagem não existir, o retrato fica null (a tela usa um placeholder).
    for (const pers of Object.keys(this.manifest.players)) {
      const arq = this.manifest.players[pers].retrato;
      if (!arq) {
        this.retratos[pers] = null;
        continue;
      }
      tarefas.push(
        carregarImagem(`assets/retratos/${arq}`).then((res) => {
          this.retratos[pers] = res.ok ? res.img : null;
        }),
      );
    }

    // Fundo da arena. O ARQUIVO vem do manifest ("mapa"); assim dá para trocar
    // de mapa só editando o JSON, sem mexer no código. Se o campo faltar, usa
    // "arena.png". Carregamento opcional: se o arquivo faltar, cai no procedural.
    const arquivoMapa = this.manifest.mapa || "arena.png";
    tarefas.push(
      carregarImagem(`assets/mapas/${arquivoMapa}`).then((res) => {
        this.mapa = res.ok ? res.img : null;
      }),
    );

    for (const player of Object.keys(this.manifest.players)) {
      this.dados[player] = {};
      const anims = this.manifest.players[player].animacoes;
      for (const nomeAnim of Object.keys(anims)) {
        const meta = anims[nomeAnim];
        const registro = { meta, frames: new Array(meta.frames) };
        this.dados[player][nomeAnim] = registro;
        for (let i = 0; i < meta.frames; i++) {
          const caminho = `assets/sprites/${player}/${nomeAnim}_${i}.png`;
          tarefas.push(
            carregarImagem(caminho).then((res) => {
              if (!res.ok) this.faltando++;
              registro.frames[i] = res;
            }),
          );
        }
      }
    }
    await Promise.all(tarefas);

    // ESCALONABILIDADE DAS ANIMAÇÕES: conta quantos quadros REALMENTE carregaram,
    // numa sequência contígua a partir do índice 0 ("framesReais"). A animação
    // reproduz só esses quadros presentes. Assim você pode declarar um "frames"
    // MAIOR no JSON (ex.: 4) e ir adicionando os PNGs intermediários aos poucos:
    // enquanto faltam arquivos, o jogo usa os que existem, sem quadros quebrados.
    // O "frames" declarado continua valendo como TETO e para a duração lógica
    // do golpe (recovery), que não muda conforme você preenche a arte.
    for (const player of Object.keys(this.dados)) {
      for (const nomeAnim of Object.keys(this.dados[player])) {
        const reg = this.dados[player][nomeAnim];
        let reais = 0;
        while (
          reais < reg.frames.length &&
          reg.frames[reais] &&
          reg.frames[reais].ok
        ) {
          reais++;
        }
        reg.meta.framesReais = reais;
      }
    }
  }

  nome(player) {
    const p = this.manifest.players[player];
    return p && p.nome ? p.nome : player.toUpperCase();
  }
  // Ficha de apresentação (tela SELECT) mesclada sobre FICHA_PADRAO: o manifest
  // vence e o default preenche o que faltar (atributos campo a campo também).
  ficha(player) {
    const p = this.manifest.players[player];
    const f = (p && p.ficha) || {};
    return {
      ...FICHA_PADRAO,
      ...f,
      atributos: { ...FICHA_PADRAO.atributos, ...(f.atributos || {}) },
      lore: f.lore && f.lore.length ? f.lore : FICHA_PADRAO.lore,
    };
  }
  // Frame data dos golpes deste personagem (bloco "golpes" do manifest).
  // Pode vir vazio/parcial; montarGolpes() completa com os defaults do CONFIG.
  golpes(player) {
    const p = this.manifest.players[player];
    return (p && p.golpes) || {};
  }
  tem(player, anim) {
    return !!(this.dados[player] && this.dados[player][anim]);
  }
  // Como tem(), mas exige que o 1º quadro tenha REALMENTE carregado (arquivo
  // presente). Útil para golpes opcionais (ex.: soco_baixo): se o sprite não
  // existir, o chamador cai num fallback em vez de desenhar um placeholder.
  temSprite(player, anim) {
    const reg = this.dados[player] && this.dados[player][anim];
    return !!(reg && reg.frames[0] && reg.frames[0].ok);
  }
  meta(player, anim) {
    return this.tem(player, anim) ? this.dados[player][anim].meta : null;
  }
  frame(player, anim, indice) {
    if (!this.tem(player, anim)) return null;
    return this.dados[player][anim].frames[indice] || null;
  }
  // Retrato (foto) do personagem para a tela de seleção; null se ausente.
  retrato(player) {
    return this.retratos[player] || null;
  }
}

