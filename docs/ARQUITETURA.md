# Mansão Fight — Arquitetura Técnica

> Documento de referência do **paradigma de implementação atual**, atualizado após
> a introdução do **sistema de Cenário** (camadas de parallax + NPCs de fundo).
> Versão do jogo: `v0.3.1`.

---

## 1. Visão geral do paradigma

Mansão Fight é um jogo de luta 1v1 (estilo Mortal Kombat) escrito em **JavaScript
vanilla puro**, renderizado em **Canvas 2D**, **sem framework, sem bundler e sem
etapa de build**. O paradigma se apoia em três pilares:

1. **Scripts clássicos em escopo global, carregados em ordem.** Não há módulos ES
   (`import`/`export`). Cada arquivo em `src/*.js` é um `<script>` clássico
   listado em ordem de dependência no `index.html`; todos compartilham o mesmo
   escopo global, então cada arquivo enxerga as classes/constantes declaradas nos
   anteriores.
2. **Data-driven.** Comportamento, balanceamento, animações, fichas de
   personagem, lista de mapas e (agora) camadas de cenário vêm de **arquivos JSON**
   em `assets/`. O código decide *qual* dado usar; os *valores* moram nos dados.
   Dado ausente nunca quebra o jogo — há defaults que preenchem campo a campo.
3. **Imediato (immediate-mode rendering).** A cada quadro o canvas é totalmente
   redesenhado a partir do estado atual. Não há retenção de cena nem DOM de jogo.

```
Browser  ──carrega──▶  index.html  ──ordena──▶  src/*.js (escopo global)
                                                     │
                          assets/*.json  ──alimenta──┘  (manifest, players, mapas)
                          assets/*.png/mp3 ─────────────┘  (sprites, arenas, áudio)
```

### Filosofia de robustez
- **Defaults que mesclam campo a campo:** `montarGolpes()`, `FICHA_PADRAO`,
  `Recursos.ficha()` etc. mesclam o JSON do personagem sobre um default global.
  Faltou um campo? Cai no default. Nunca quebra.
- **Assets opcionais e escalonáveis:** sprites ausentes viram placeholders ou são
  simplesmente ignorados; é possível declarar mais quadros de animação no JSON do
  que existem em disco e ir adicionando a arte aos poucos (ver §8).

---

## 2. Estrutura de arquivos

```
mansao-fight/
├── index.html              # Único entry point; lista os <script> em ordem
├── style.css               # Centralização do canvas + estilo do filtro CRT
├── serve.py / jogar.bat    # Servidor de desenvolvimento local (no-cache)
├── serve.json              # Headers de deploy estático (Vercel)
│
├── src/                     # Lógica (scripts clássicos, ordem importa)
│   ├── config.js            # CONFIG (balanceamento) + constantes derivadas + montarGolpes
│   ├── constantes.js        # TECLAS, PERSONAGENS, FICHA_PADRAO, ESTADOS, temas
│   ├── recursos.js          # carregarManifest/lerJSON + classe Recursos (assets)
│   ├── mapas.js             # CatalogoMapas (varredura de arenas) + miniaturas + _carregarExtras
│   ├── cenario.js           # ★ NOVO: Cenario, CamadaCenario, NpcCenario (parallax + NPCs)
│   ├── animator.js          # Animator (avanço de quadros pelo fps do manifest)
│   ├── controles.js         # Entrada, GamepadNav, ControleTeclado, ControleIA
│   ├── particulas.js        # Partículas (faíscas, rastro, poeira)
│   ├── audio.js             # AudioFX (Web Audio), MusicaFX, SomUI
│   ├── projetil.js          # Projetil (reta + parabólico)
│   ├── fighter.js           # Fighter (estado, física, vida, hitbox/hurtbox, combos)
│   ├── selecao.js           # colideAABB, TELAS, SelecaoMapa, VS_TIMING, CONFIGS
│   ├── jogo.js              # Jogo (telas, rounds, HUD, hit stop, shake, game loop)
│   └── main.js              # iniciar() — boot: carrega tudo e arranca o loop
│
└── assets/
    ├── manifest.json        # ÍNDICE: frameSize, mapa default, refs de mapas e players
    ├── data/
    │   ├── mapas.json        # Lista de arenas (+ camadas/npcs opcionais — ver §11)
    │   └── players/p*.json   # Por personagem: ficha, animações (frame data), golpes
    ├── sprites/<p>/          # Quadros de animação: idle_0.png, walk_0.png, ...
    ├── retratos/             # Fotos da tela de seleção
    ├── mapas/                # Arenas: arena1.png ... (1920×540) + camadas de parallax
    ├── cenarios/             # ★ NOVO: sprites de NPC de fundo: <sprite>_0.png, _1.png...
    └── audio/                # musica_*.mp3, sfx_*.mp3
```

**Ordem de carregamento no `index.html`** (a dependência flui de cima para baixo):

```
config → constantes → recursos → mapas → cenario → animator → controles
       → particulas → audio → projetil → fighter → selecao → jogo → main
```

`cenario.js` foi inserido logo após `mapas.js` (consome os descritores de mapa que
`mapas.js` produz) e antes de `animator.js`. Depende apenas de globais já
definidos: `MUNDO_L`, `ALTURA`, `CHAO_Y` (config) e `carregarImagem` (recursos).

---

## 3. Fluxo de boot (`main.js`)

`iniciar()` é assíncrona e roda assim que o DOM está pronto:

```
1. Inicia o loop visual da tela de CARREGANDO (barra Unicode █/░).
2. carregarManifest()                     →   5%   (lê assets/manifest.json + refs)
3. Recursos.precarregar()                 →  85%   (sprites + retratos + mapa default,
                                                     em paralelo com o áudio)
4. CatalogoMapas.descobrir()              → 100%   (varre arena1.png, arena2.png, ...
                                                     e CARREGA camadas/NPCs de cada mapa)
5. Aguarda áudio + 380ms de barra cheia.
6. new Jogo(canvas, recursos, catalogo, musica, somUI).rodar()
```

Se o `manifest.json` não carregar (ex.: aberto via `file://` no Chrome), exibe um
aviso pedindo um servidor local — daí existirem `jogar.bat` / `serve.py`.

---

## 4. Loop principal (`Jogo.rodar`)

`requestAnimationFrame` com **delta time** limitado a 50 ms (evita "espiral da
morte" se a aba perder foco):

```js
passo(agora):
  dt = clamp((agora - anterior)/1000, 0, 0.05)
  this._atualizar(dt)         // estado
  this._desenhar()            // render imediato
  this._desenharFlashGlobal() // clarão de transição sobre qualquer tela
  limpa eventos de borda da Entrada (confirmar/voltar/bordas)
```

A separação `_atualizar` / `_desenhar` é clássica (update → render). Não há
fixed-timestep nem interpolação: a física integra direto com `dt` variável.

---

## 5. Máquina de estados de telas

O campo `Jogo.tela` (valores do enum `TELAS` em `selecao.js`) é o estado de mais
alto nível. Tanto `_atualizar` quanto `_desenhar` ramificam por ele:

```
APRESENTA ─▶ START ─▶ MODO ─▶ DIFICULDADE ─▶ SELECT ─▶ MAPA ─▶ VS ─▶ LUTA ─▶ VITORIA
 (intro)    (título)  (1P/2P)   (IA)        (personagem)(arena)      │
                                                                     ├─ faseRound: "anuncio" → "lutando" → "fim"
                                                                     └─ PAUSE (overlay, congela a luta)
                              CONFIG  (overlay acessível do menu ou do pause)
```

**Sub-estado da luta** (`Jogo.faseRound`): `"anuncio"` (≈1,6 s "ROUND N") →
`"lutando"` (gameplay) → `"fim"` (congela antes do próximo round / vitória).

> ⚠️ **Débito técnico central:** `jogo.js` é um *god-class* (~2500 linhas). Toda a
> lógica e o desenho de **todas** as telas vivem em ramificações dentro de
> `_atualizar`/`_desenhar`. Não há classe `Tela` base. Esta é a principal
> candidata a refatoração (extrair cada tela para sua própria classe) antes de
> ampliações grandes como o modo história.

---

## 6. Modelo de dados (data-driven)

`assets/manifest.json` é só o **índice** e referencia os demais por caminho:

```json
{
  "frameSize": [256, 256],
  "mapa": "arena1.png",
  "mapas": "data/mapas.json",
  "players": { "p1": "data/players/p1.json", "p2": "...", "p3": "..." }
}
```

`carregarManifest()` resolve essas referências em paralelo e devolve um objeto com
a forma final (`{ frameSize, mapa, mapas:[...], players:{...} }`), de modo que o
resto do código não sabe se o dado veio inline ou de arquivo separado.

- **`players/p*.json`** — por personagem: `nome`, `retrato`, `ficha` (cosmético:
  cidade, estilo, lore, atributos 0–5, dificuldade, estágio de origem),
  `animacoes` (frame data: `frames`, `fps`, `loop`) e `golpes` (overrides de
  `CONFIG.golpes`).
- **`mapas.json`** — array de arenas; cada item pode opcionalmente trazer
  `camadas` e `npcs` (ver §11).

### `CONFIG` (em `config.js`) — fonte única de balanceamento
Centraliza **todos** os números de "feel": física da arena, movimento, regras de
luta, frame data dos golpes (startup/ativo/recovery/dano/knockback/alcance),
projéteis, barra de especial, combos e anti-combo-infinito, throw tech, dashes,
game feel (hit stop, shake, flash), partículas, áudio, vídeo (CRT) e IA por
dificuldade. Constantes derivadas (`LARGURA`, `MUNDO_L`, `CHAO_Y`, `GRAVIDADE`,
`VIDA_MAX`, ...) são extraídas para manter o resto do código legível.

---

## 7. Recursos e animação

### `Recursos` (`recursos.js`)
Pré-carrega tudo: retratos, mapa default (`recursos.mapa`) e, para cada
personagem, cada quadro de cada animação (`assets/sprites/<p>/<anim>_<i>.png`).
Expõe consultas: `frame(player, anim, i)`, `meta(player, anim)`,
`tem`/`temSprite`, `nome`, `ficha`, `golpes`, `retrato`.

### `Animator` (`animator.js`)
Avança o quadro pelo `fps` declarado no manifest, com `loop` opcional.

### Escalabilidade de animações
Durante o preload, `Recursos` conta quantos quadros **realmente** carregaram numa
sequência contígua a partir do índice 0 e guarda em `meta.framesReais`. A animação
reproduz só esses. Assim dá para **declarar `frames: 5` no JSON e fornecer só 3
PNGs** — o jogo usa os 3 sem quebrar, e você adiciona os intermediários depois.

> **Desacoplamento crucial:** o *timing* do dano (startup/ativo/recovery) vem
> SEMPRE do frame data em 60 fps de referência (`CONFIG.golpes`), **independente
> de quantos sprites a animação tem**. Adicionar quadros de fluidez não muda
> *quando* o golpe acerta.

---

## 8. Fighter (`fighter.js`)

Não há herança entre personagens. Cada `Fighter` é composição de:
- **slot** (`p1`/`p2`): qual layout de teclado;
- **personagem** (`p1`/`p2`/`p3`): qual conjunto de sprites/golpes;
- **controle**: `ControleTeclado` (humano) ou `ControleIA`.

**Máquina de estados** (`ESTADOS` em `constantes.js`): `idle, walk, jump, crouch,
punch, kick, fireball, block, grab, special, hit, knockdown, getup, ko` (+
especiais travados: throw tech, backdash, dash).

**Colisão:** `hurtbox()` (AABB de quem apanha, dividida em região alta/baixa para
validar defesa alta vs. baixa) e hitbox dinâmica (só existe nos quadros ativos do
golpe). `colideAABB` (em `selecao.js`) é o teste de sobreposição de retângulos
usado em corpo-a-corpo, golpes e projéteis.

**Sistemas de luta:** combos com janela de cancelamento e *damage/pushback
scaling*, anti-combo-infinito (knockdown forçado), throw tech (agarrão mútuo),
dash ofensivo (P1) e backdash com i-frames (P2), barra de especial/super,
invencibilidade no wakeup. Todos parametrizados em `CONFIG`.

---

## 9. Mundo e câmera

```
            MUNDO_L = 1920 px  (largura total da arena)
 0 ┌──────────────────────────────────────────────────────────┐
   │                                                            │
   │        ┌───────────────────────────┐                      │
   │        │   TELA / CÂMERA = 960 px   │  ← desliza no mundo  │
   │        └───────────────────────────┘                      │
   │  cameraX                                                   │
   └──────────────────────────────────────────────────────────┘ ALTURA=540
                       CHAO_Y = 486 (pés dos lutadores)
```

- `Jogo.cameraX` é o deslocamento horizontal da janela dentro do mundo.
- `_alvoCamera()` centraliza o ponto médio entre os dois lutadores, com **clamp**
  em `[0, MUNDO_L - LARGURA]` para nunca mostrar fora da arena.
- `_atualizarCamera(dt)` faz *easing* até o alvo: `cameraX += (alvo - cameraX) *
  min(1, dt*8)` (segue a luta sem solavancos).
- No desenho da luta: `ctx.translate(-round(cameraX), 0)` desloca **o mundo
  inteiro** sob a tela; tudo que é desenhado em coordenadas de mundo aparece no
  lugar certo. O screen shake soma um pequeno `translate` aleatório por cima.

---

## 10. Renderização da luta (ordem de desenho)

Dentro do contexto transladado pela câmera (tela de LUTA e de VITÓRIA):

```
ctx.save()
  [shake]  ctx.translate(jitter)
  ctx.translate(-cameraX, 0)
    _desenharArena(ctx)        →  Cenario.desenharFundo()   ← camadas de FUNDO + NPCs de fundo
    p1.desenhar(); p2.desenhar()
    projeteis[].desenhar()
    particulas.desenhar()
    [TECH! label]
    _desenharArenaFrente(ctx)  →  Cenario.desenharFrente()  ← camadas/NPCs de PRIMEIRO PLANO
ctx.restore()
[CRT] _scanlines(ctx)          ← pós-processamento sobre o mundo
_desenharHUD(ctx)              ← HUD/anúncios/pause: nítidos, FORA da câmera e do CRT
```

---

## 11. ★ Sistema de Cenário (parallax + NPCs) — `cenario.js`

Substitui o desenho de **imagem única** do mapa por uma **pilha de camadas**, cada
uma com um fator de **parallax**. Introduzido como primeira peça da refatoração
("Fase 0") para destravar parallax e NPCs de fundo do roadmap de expansão.

### 11.1 Classes

| Classe | Papel |
|--------|-------|
| `CamadaCenario` | Uma camada de imagem do tamanho do mundo, com `parallax` e flag `frente`. |
| `NpcCenario`    | Sprite decorativo posicionado no mundo, anima em loop por timer próprio (independe do `Animator`). |
| `Cenario`       | O palco: agrega camadas e NPCs, separando **fundo** (atrás dos lutadores) de **frente** (na frente). |

### 11.2 Matemática do parallax

O mundo já está transladado por `-cameraX` no momento do desenho. Para uma camada
rolar a uma **fração** `p` da câmera, ela é desenhada em:

```
worldX = cameraX * (1 - p)        // offsetParallax(cameraX, p)
```

Assim sua posição **na tela** vira `worldX - cameraX = -cameraX * p`:

| `parallax` | Comportamento | Uso típico |
|-----------:|---------------|------------|
| `0.0`      | fixo na tela (não rola) | céu distante |
| `< 1.0`    | rola mais devagar que a câmera | fundos de profundidade |
| `1.0`      | move junto com a câmera (plano do gameplay) | a arena em si |
| `> 1.0` + `frente:true` | rola mais rápido, **na frente** dos lutadores | grades, vegetação à frente |

> **Garantia de cobertura:** para camadas com largura = `MUNDO_L` e
> `0 ≤ parallax ≤ 1`, o offset máximo nunca abre buracos nas bordas visíveis da
> câmera (demonstrável: `cameraX·parallax ≤ MUNDO_L − LARGURA` em todo o intervalo).
> Por isso **todo PNG de camada deve ter o tamanho do mundo (1920×540)**, igual ao
> asset de arena atual.

### 11.3 Pipeline de desenho

```
Cenario.desenharFundo(ctx, cameraX):
    se há camadasFundo  →  desenha cada uma com seu parallax
    senão se imagemUnica →  drawImage(img, 0,0, MUNDO_L, ALTURA)   ← COMPAT (igual a antes)
    senão                →  Cenario.desenharProcedural(ctx)        ← fallback sem arte
    desenha npcsFundo (com parallax)

Cenario.desenharFrente(ctx, cameraX):
    desenha npcsFrente, depois camadasFrente
```

`Cenario.atualizar(dt)` só avança os timers de animação dos NPCs.

### 11.4 Compatibilidade retroativa (importante)

O sistema é **aditivo e sem regressão**:

- Mapa **sem** `camadas` declaradas → o `Cenario` usa `mapa.full` (a imagem única)
  como camada parallax 1.0. Render **idêntico** ao anterior.
- Sem `mapa.full` → usa o fallback `recursos.mapa` (mapa default do manifest).
- Sem imagem alguma → fundo **procedural** (o mesmo do antigo `_desenharArena`,
  agora em `Cenario.desenharProcedural`).
- Como o `mapas.json` atual **não declara** camadas/NPCs, nada muda visualmente
  até que se adicione a arte. Imagens ausentes são silenciosamente ignoradas.

### 11.5 Carga dos dados (`mapas.js`)

`CatalogoMapas` continua **descobrindo arenas por varredura** (`arena1.png`,
`arena2.png`, ... via tentativa de `Image.onload`, parando após 2 ausências
seguidas). Para cada arena descoberta, `_carregarExtras(desc, meta)`:

- Lê `meta.camadas[]` e carrega cada PNG de `assets/mapas/`, preenchendo
  `desc.camadas = [{ img, parallax, frente }]`.
- Lê `meta.npcs[]` e carrega os quadros `assets/cenarios/<sprite>_<i>.png` em
  sequência contígua (para no primeiro ausente), preenchendo
  `desc.npcs = [{ def, frames:[Image,...] }]`.

### 11.6 Integração no `Jogo` (`jogo.js`)

- `this.cenario` é inicializado `null` no construtor.
- Montado em `_confirmarMapa(mapa)` e no caminho "sem mapa" de
  `_irParaSelecaoMapa()`: `new Cenario(mapa, this.recursos.mapa)`.
- Atualizado no loop logo após `_atualizarCamera(dt)` (anima NPCs durante
  `anuncio`/`lutando`/`fim`).
- `_desenharArena` delega a `cenario.desenharFundo`; `_desenharArenaFrente`
  (novo) chama `cenario.desenharFrente` após os lutadores nas telas LUTA e
  VITÓRIA. Se `cenario` for `null`, mantém o comportamento legado (imagem única
  ou procedural).

### 11.7 Como ativar (sem tocar em código)

Em `assets/data/mapas.json`, no objeto do mapa:

```json
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
```

Campos de NPC: `sprite` (prefixo dos PNGs em `assets/cenarios/`), `x`/`y` (posição
no mundo; `y` é a base/"pés"), `parallax`, `frames`, `fps`, `escala`, `flip`
(espelha), `frente` (desenha na frente dos lutadores).

---

## 12. Input (`controles.js`)

Três camadas:

1. **`Entrada`** — escuta `keydown`/`keyup` da janela, mantém o `Set` de teclas
   pressionadas e *buffers* de eventos de borda (confirmar/voltar/navegação).
2. **`GamepadNav`** — lê a Gamepad API com detecção de borda (um evento por
   pressionada). **Hoje cobre apenas a navegação de menus** — mapear os botões
   para as ações de luta é trabalho da Fase 1 do roadmap.
3. **`ControleTeclado` / `ControleIA`** — traduzem para intenções do `Fighter`.
   O teclado mapeia por slot via a tabela `TECLAS`; a IA observa o mundo e decide
   um plano (aproximar/recuar/defender/esperar) a cada ~0,3–0,9 s conforme a
   dificuldade em `CONFIG.ia`.

---

## 13. Áudio, partículas e pós-processamento

- **`audio.js`** — `AudioFX` sintetiza efeitos via Web Audio API; `MusicaFX` e
  `SomUI` tocam MP3s (faixas e sons de UI). Volumes em `CONFIG.audio`.
- **`particulas.js`** — faíscas/rastro/poeira com blend aditivo; alocadas sob
  demanda (sem pooling).
- **CRT** — `_scanlines()` aplica scanlines + vinheta sobre o mundo quando
  `CONFIG.video.crt` está ligado. HUD e textos centrais ficam **acima** do CRT.

---

## 14. Pontos de extensão e débito técnico

**Fortalezas do paradigma**
- Data-driven de ponta a ponta: balancear, trocar arte ou adicionar mapa = editar
  JSON/assets, sem tocar no código.
- Timing de golpe desacoplado da contagem de sprites (arte incremental).
- Zero dependências e zero build: recarregar o navegador aplica mudanças na hora.
- Cenário em camadas pronto para profundidade visual sem custo para mapas legados.

**Débito técnico / limites conhecidos**
- **`jogo.js` é um god-class (~2500 linhas)** sem abstração de "tela" — maior
  obstáculo para o modo história e para crescer o número de telas/fluxos.
- **Sem sistema de habilidades plugável:** moves especiais hoje dependem de
  `exclusivoPersonagem`/condicionais; escalar para 10 personagens pede um array de
  habilidades declarado por personagem no JSON.
- **Gamepad só nos menus** (falta o mapeamento de combate + rumble).
- **Sem build desktop** (Electron/Tauri previstos no roadmap).
- Render sempre redesenha tudo (sem dirty-rect); partículas/projéteis sem pooling.
  Aceitável na escala atual.

> Roadmap de expansão (controle, build desktop, 10 personagens, parallax/NPCs,
> modo história) e a ordem das fases estão fora deste documento — esta referência
> cobre **como o jogo funciona hoje**, após o sistema de Cenário.
