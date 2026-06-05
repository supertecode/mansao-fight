"use strict";

/* ===========================================================================
   11) INICIALIZAÇÃO
   =========================================================================== */

// Desenha a tela de carregamento diretamente no canvas.
// Usa bloco de caracteres Unicode para a barra (█/░) — efeito pixel-art nativo.
function _desenharCarregando(ctx, progresso, agora) {
  const W = LARGURA, H = ALTURA;

  // --- Fundo escuro ---
  ctx.fillStyle = PALETA.preto;
  ctx.fillRect(0, 0, W, H);

  // Vinheta radial suave nas bordas
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.12, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.58)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";

  // --- Título MANSÃO FIGHT ---
  ctx.save();
  ctx.fillStyle = PALETA.ouro;
  ctx.shadowColor = PALETA.ouro;
  ctx.shadowBlur = 26;
  ctx.font = "bold 44px 'Courier New', monospace";
  try { ctx.letterSpacing = "5px"; } catch (e) {}
  ctx.fillText("MANSÃO FIGHT", W / 2, 194);
  try { ctx.letterSpacing = "0px"; } catch (e) {}
  ctx.restore();

  // Linha decorativa abaixo do título
  ctx.save();
  ctx.strokeStyle = PALETA.acento;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 108, 214);
  ctx.lineTo(W / 2 + 108, 214);
  ctx.stroke();
  ctx.restore();

  // --- "CARREGANDO..." pulsando com fade in/out suave ---
  const pulse = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(agora / 340));
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px 'Courier New', monospace";
  try { ctx.letterSpacing = "5px"; } catch (e) {}
  ctx.fillText("CARREGANDO...", W / 2, 272);
  try { ctx.letterSpacing = "0px"; } catch (e) {}
  ctx.restore();

  // --- Barra de progresso com blocos Unicode (estilo pixel-art) ---
  const NUM_BLOCOS = 32;
  const preenchidos = Math.floor(progresso * NUM_BLOCOS);

  ctx.font = "15px 'Courier New', monospace";
  const charW = ctx.measureText("█").width; // largura de um bloco cheio
  const baraTotalW = charW * NUM_BLOCOS;
  const baraX = (W - baraTotalW) / 2;
  const baraY = 408;

  // Blocos vazios — fundo escuro/roxo
  ctx.save();
  ctx.textAlign = "left";
  ctx.fillStyle = "#251840";
  ctx.fillText("░".repeat(NUM_BLOCOS), baraX, baraY);

  // Blocos preenchidos — dourado
  if (preenchidos > 0) {
    ctx.fillStyle = PALETA.ouro;
    ctx.fillText("█".repeat(preenchidos), baraX, baraY);
  }
  ctx.restore();

  // Percentual abaixo da barra
  ctx.save();
  ctx.fillStyle = PALETA.textoFraco;
  ctx.font = "11px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.fillText(Math.floor(progresso * 100) + "%", W / 2, baraY + 22);
  ctx.restore();
}

async function iniciar() {
  const canvas = document.getElementById("tela");
  const ctx = canvas.getContext("2d");
  const aviso = document.getElementById("aviso");

  // ---- Inicia o loop de animação da tela de carregamento ----
  let progresso = 0;
  let carregando = true;

  (function loopLoading(agora) {
    if (!carregando) return;
    _desenharCarregando(ctx, progresso, agora);
    requestAnimationFrame(loopLoading);
  })(0);

  // Etapa 1: manifest JSON (0 → 5%)
  let manifest;
  try {
    manifest = await carregarManifest();
    progresso = 0.05;
  } catch (e) {
    carregando = false;
    aviso.classList.remove("oculto");
    aviso.innerHTML =
      "Não foi possível carregar <b>assets/manifest.json</b>.<br><br>" +
      "Alguns navegadores bloqueiam leitura de arquivos via <b>file://</b>.<br>" +
      "Abra o projeto com um servidor local (ex.: a extensão <b>Live Server</b> " +
      "do VS Code) ou use o Firefox.";
    console.error("Falha ao carregar manifest:", e);
    return;
  }

  // Etapa 2: sprites + áudio em paralelo (5% → 85%)
  // O áudio começa a baixar junto com os sprites; quando ambos terminam o
  // progresso avança. Numa máquina lenta isso garante que o áudio já está em
  // buffer antes de o jogador interagir com qualquer coisa.
  const recursos = new Recursos(manifest);
  const musica = new MusicaFX();
  const somUI = new SomUI();

  // Progresso de sprites (peso 80%) e áudio (peso 0% na barra — paralelo mas
  // sem bloquear visualmente; resolve antes de avançar para a etapa 3).
  let audioCarregado = false;
  const promessaAudio = Promise.all([musica.precarregar(), somUI.precarregar()])
    .then(() => { audioCarregado = true; });

  await recursos.precarregar((p) => {
    progresso = 0.05 + p * 0.80;
  });
  if (recursos.faltando > 0) {
    console.warn(
      `Assets ausentes: ${recursos.faltando} (serão exibidos como placeholders).`,
    );
  }

  // Etapa 3: descobrir mapas da pasta (85% → 100%)
  const catalogo = new CatalogoMapas(manifest);
  await catalogo.descobrir((p) => {
    progresso = 0.85 + p * 0.15;
  });
  console.info(`Mapas descobertos: ${catalogo.mapas.length}`);

  progresso = 1.0;

  // Aguarda o áudio ficar pronto (normalmente já terminou junto com os sprites;
  // numa máquina lenta pode levar mais alguns ms, mas nunca mais de 8s).
  await promessaAudio;
  if (!audioCarregado) console.warn("Áudio não carregou a tempo — tentando mesmo assim.");

  // Pequena pausa para mostrar barra cheia antes de avançar
  await new Promise((r) => setTimeout(r, 380));

  carregando = false;

  // ---- Inicia o jogo (instâncias de áudio pré-carregadas passadas direto) ----
  const jogo = new Jogo(canvas, recursos, catalogo, musica, somUI);
  jogo.rodar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciar);
} else {
  iniciar();
}
