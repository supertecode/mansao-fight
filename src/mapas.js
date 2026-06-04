"use strict";

/* ===========================================================================
   1b) CATÁLOGO DE MAPAS — (1) MÓDULO DE DADOS de mapas
   Descobre os mapas em TEMPO DE EXECUÇÃO sem nomes hardcoded no código: tenta
   carregar assets/mapas/arena1.png, arena2.png, ... via Image.onload, parando
   após uma sequência de ausências. (Um navegador não consegue listar pastas
   offline, então a "varredura" é feita por tentativa de carregamento.)
   O manifest.json pode, OPCIONALMENTE, trazer um array "mapas" só para nomear
   bonito cada arquivo (id/nome) — mas a LISTA em si vem da varredura.

   Cada mapa expõe:  id, nome (exibição), arquivo, caminho (imagem completa),
   caminhos[] (camadas para parallax futuro), full (Image), caminhoThumb e
   thumb (miniatura em <canvas>, gerada da imagem cheia com letterbox).
   =========================================================================== */

// Gera uma MINIATURA (canvas) a partir da imagem cheia, preservando a proporção
// de aspecto com letterbox preto. Evita precisar de arquivos de thumb separados.
function gerarMiniatura(img, maxW, maxH) {
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = maxH;
  const cx = c.getContext("2d");
  cx.fillStyle = "#000";
  cx.fillRect(0, 0, maxW, maxH);
  if (img && img.width) {
    const escala = Math.min(maxW / img.width, maxH / img.height);
    const dw = img.width * escala;
    const dh = img.height * escala;
    cx.imageSmoothingEnabled = true; // downscale suave fica melhor na miniatura
    cx.drawImage(img, (maxW - dw) / 2, (maxH - dh) / 2, dw, dh);
  }
  return c;
}

class CatalogoMapas {
  constructor(manifest) {
    this.manifest = manifest;
    this.mapas = [];
  }

  async descobrir(onProgresso) {
    // Metadados opcionais por arquivo (nome de exibição), vindos do manifest.
    const meta = {};
    if (Array.isArray(this.manifest.mapas)) {
      for (const m of this.manifest.mapas)
        if (m && m.arquivo) meta[m.arquivo] = m;
    }

    const MAX_PROBE = 64; // teto de segurança da varredura
    const MAX_GAP = 2; // tolera buracos na numeração (ex.: arena1, arena3...)
    const achados = [];
    const vistos = new Set();
    let faltasSeguidas = 0;

    // (a) Varredura por padrão arena<N>.png — descoberta automática real.
    let probeCount = 0;
    for (let i = 1; i <= MAX_PROBE && faltasSeguidas <= MAX_GAP; i++) {
      const arquivo = `arena${i}.png`;
      const caminho = `assets/mapas/${arquivo}`;
      const res = await carregarImagem(caminho);
      probeCount++;
      if (res.ok) {
        faltasSeguidas = 0;
        vistos.add(arquivo);
        achados.push(
          this._descritor(arquivo, caminho, res.img, meta[arquivo], achados.length + 1),
        );
      } else {
        faltasSeguidas++;
      }
      // Progresso aproximado: cada tentativa avança; para 5 mapas + 2 falhas ≈ 7 probes.
      if (onProgresso) onProgresso(Math.min(0.9, probeCount / (probeCount + MAX_GAP)));
    }

    // (b) Inclui mapas declarados no manifest que NÃO seguem o padrão arena<N>.
    if (Array.isArray(this.manifest.mapas)) {
      for (const m of this.manifest.mapas) {
        if (!m || !m.arquivo || vistos.has(m.arquivo)) continue;
        const caminho = `assets/mapas/${m.arquivo}`;
        const res = await carregarImagem(caminho);
        if (res.ok) {
          vistos.add(m.arquivo);
          achados.push(this._descritor(m.arquivo, caminho, res.img, m, achados.length + 1));
        }
      }
    }

    this.mapas = achados;
    if (onProgresso) onProgresso(1.0);
    return this.mapas;
  }

  _descritor(arquivo, caminho, img, meta, ordem) {
    meta = meta || {};
    const baseId = arquivo.replace(/\.[^.]+$/, "");
    return {
      id: meta.id || baseId,
      nome: String(meta.nome || `ARENA ${ordem}`).toUpperCase(),
      arquivo,
      caminho, // caminho da imagem COMPLETA
      caminhos: [caminho], // camadas extras (parallax) caberiam aqui no futuro
      full: img, // Image já carregada da imagem completa
      caminhoThumb: caminho, // a miniatura é gerada da imagem cheia
      thumb: gerarMiniatura(img, 320, 180), // <canvas> 16:9 com letterbox
    };
  }
}

