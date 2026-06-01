"use strict";

/* ===========================================================================
   11) INICIALIZAÇÃO
   =========================================================================== */

async function iniciar() {
  const canvas = document.getElementById("tela");
  const aviso = document.getElementById("aviso");

  let manifest;
  try {
    manifest = await carregarManifest();
  } catch (e) {
    aviso.classList.remove("oculto");
    aviso.innerHTML =
      "Não foi possível carregar <b>assets/manifest.json</b>.<br><br>" +
      "Alguns navegadores bloqueiam leitura de arquivos via <b>file://</b>.<br>" +
      "Abra o projeto com um servidor local (ex.: a extensão <b>Live Server</b> " +
      "do VS Code) ou use o Firefox.";
    console.error("Falha ao carregar manifest:", e);
    return;
  }

  const recursos = new Recursos(manifest);
  await recursos.precarregar();
  if (recursos.faltando > 0) {
    console.warn(
      `Assets ausentes: ${recursos.faltando} (serão exibidos como placeholders).`,
    );
  }

  // (1) DADOS DE MAPAS: varre assets/mapas/ e monta o catálogo em runtime.
  const catalogo = new CatalogoMapas(manifest);
  await catalogo.descobrir();
  console.info(`Mapas descobertos: ${catalogo.mapas.length}`);

  const jogo = new Jogo(canvas, recursos, catalogo);
  jogo.rodar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciar);
} else {
  iniciar();
}
