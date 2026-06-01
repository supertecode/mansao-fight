# 🥊 Mansão Fight!

Jogo de luta 1v1 em 2D estilo arcade (Mortal Kombat / Street Fighter), feito em
**JavaScript vanilla** — sem frameworks, sem bundler, sem etapa de build. Roda
direto no navegador a partir de um servidor local simples.

Lutadores, atributos, golpes, animações e arenas são **dirigidos por dados**
(arquivos JSON em `assets/data/`): dá para balancear o jogo e adicionar conteúdo
sem mexer na lógica.

---

## ▶️ Como jogar

O jogo precisa de um **servidor local** (o navegador bloqueia a leitura dos
arquivos `.json`/imagens via `file://`). Há três jeitos:

| Forma                    | Como                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Mais fácil (Windows)** | Dê duplo-clique em **`jogar.bat`**. Ele acha Python/Node automaticamente, sobe o servidor e abre o navegador. |
| **Python**               | `python serve.py` e abra <http://localhost:8000/index.html>                                                   |
| **VS Code**              | Extensão **Live Server** → "Open with Live Server" no `index.html`                                            |

> Deixe a janela do servidor aberta enquanto joga. Para parar, feche-a.

O primeiro carregamento leva alguns segundos (pré-carrega todos os sprites).

---

## 🎮 Controles

| Ação           | Jogador 1 | Jogador 2 |
| -------------- | :-------: | :-------: |
| Andar / Correr |  `A` `D`  |  `←` `→`  |
| Pular          |    `W`    |    `↑`    |
| Agachar        |    `S`    |    `↓`    |
| Soco           |    `F`    |    `J`    |
| Chute          |    `G`    |    `K`    |
| Projétil       |    `H`    |    `L`    |
| Agarrão        |    `C`    |    `N`    |
| Especial       |    `V`    |    `M`    |
| Defender       |    `R`    |    `P`    |
| Provocar       |    `T`    |    `Y`    |

Variações: **agachar + soco** = soco baixo · **agachar + chute** = chute baixo ·
**agachar + defender** = defesa baixa · **especial + trás** = backdash (esquiva).
Suporte a **gamepad** nos menus.

No modo 1 jogador o oponente é controlado por **IA** com 3 dificuldades.

---

## 👤 Lutadores

|        | Personagem     | Cidade                  | Estilo                 |
| ------ | -------------- | ----------------------- | ---------------------- |
| **P1** | Samuel Silva   | Iguape — SP             | Jiu-Jitsu Faixa Branca |
| **P2** | Vítor De Sordi | Santana do Itararé — PR | Luta Deitado           |
| **P3** | Erick Barbosa  | Iguape — SP             | Otaku Gamer            |

Mais 5 arenas selecionáveis (UTFPR, Mansão Broxa, Arena do Joia, Cavan77,
Quarto do Pit) + opção de mapa aleatório.

---

## 📁 Estrutura do projeto

```
mansao-fight/
├── index.html          Página única; carrega os scripts de src/ em ordem
├── style.css           Centralização do canvas + filtro CRT
├── serve.py            Servidor local de dev (sem cache)
├── serve.json          Cabeçalhos de cache (deploy estático / Vercel)
├── jogar.bat           Atalho Windows: sobe o servidor e abre o jogo
│
├── src/                Lógica do jogo (antigo game.js dividido em módulos)
│   ├── config.js         CONFIG (balanceamento) + constantes derivadas
│   ├── constantes.js     TECLAS, PERSONAGENS, ESTADOS, temas da seleção
│   ├── recursos.js       Carregamento do manifest e dos assets (Recursos)
│   ├── mapas.js          CatalogoMapas (descoberta de arenas) + miniaturas
│   ├── animator.js       Avanço de quadros pelo fps do manifest
│   ├── controles.js      Entrada (teclado), gamepad, controle humano e IA
│   ├── particulas.js     Faíscas, rastro, poeira
│   ├── audio.js          Efeitos (Web Audio), músicas e sons de UI
│   ├── projetil.js       Bolas de energia (fireball / special / super)
│   ├── fighter.js        Lutador: física, estados, vida, hitbox, combos
│   ├── selecao.js        Colisão AABB, telas, seleção de mapa, menu de config
│   ├── jogo.js           Orquestra telas, rounds, HUD e o game loop
│   └── main.js           Boot: carrega tudo e inicia o loop
│
└── assets/
    ├── manifest.json     Índice: aponta para os dados abaixo
    ├── data/
    │   ├── mapas.json        Lista das arenas (arquivo + nome)
    │   └── players/
    │       ├── p1.json       Ficha + animações + golpes do Samuel
    │       ├── p2.json       … do Vítor
    │       └── p3.json       … do Erick
    ├── sprites/<p>/       Quadros de animação (idle_0.png, walk_0.png, …)
    ├── retratos/          Fotos da tela de seleção (silva/vitor/erick.png)
    ├── mapas/             Fundos das arenas (arena1.png … arena5.png)
    └── audio/             Músicas e efeitos sonoros (.mp3)
```

### Por que `<script>` clássicos (e não `type="module"`)?

Os arquivos de `src/` são carregados como scripts clássicos **na ordem** definida
no `index.html`. Eles compartilham o mesmo escopo global, então uma classe/const
de um arquivo enxerga as dos arquivos anteriores. `main.js` (o último) dá o boot.
Isso mantém o projeto **sem build** e cada arquivo focado em uma responsabilidade.

---

## 🔧 Customização (sem tocar na lógica)

### Balanceamento

Quase tudo que afeta o "feel" do jogo (gravidade, velocidades, frame data dos
golpes, dano, knockback, IA, áudio, partículas…) está no objeto **`CONFIG`** no
topo de [`src/config.js`](src/config.js). Os valores ali são o **padrão**; cada
lutador pode sobrescrever os próprios golpes no JSON dele.

### Editar um lutador

Abra `assets/data/players/<p>.json`:

- **`ficha`** — dados cosméticos da tela de seleção (cidade, estilo, lore, barras de atributo, dificuldade).
- **`animacoes`** — para cada animação: nº de `frames`, `fps`, `loop` e `framesAtivos` (quais quadros causam dano).
- **`golpes`** — frame data por golpe (`startup`, `ativo`, `recovery`, `dano`, `knockback`, `alcance`, `altura`, etc.). Campos ausentes herdam o padrão do `CONFIG`.

### Adicionar uma arena

1. Coloque o PNG em `assets/mapas/` como `arenaN.png` (veja a spec em
   [`assets/mapas/README.txt`](assets/mapas/README.txt) — 1920×540, chão em y=486).
2. Opcional: dê um nome bonito em `assets/data/mapas.json`.

A lista de mapas é descoberta em tempo de execução (varredura `arena1.png`,
`arena2.png`, …), então basta o arquivo existir.

### Adicionar um lutador

1. Crie a pasta de sprites `assets/sprites/p4/` com os quadros.
2. Crie `assets/data/players/p4.json` (use um existente de modelo) e a foto em `assets/retratos/`.
3. Registre `"p4"` em `players` no `assets/manifest.json` e em `PERSONAGENS`
   (e numa célula de `SELECT_CELULAS`) em [`src/constantes.js`](src/constantes.js).

> As animações **não** são fixadas no código — vêm do manifest. Sprites/golpes
> opcionais (ex.: `soco_baixo`, `special`, `backdash`) caem num _fallback_
> quando ausentes, então o jogo nunca quebra por dado faltando.

---

## 🛠️ Tecnologia

JavaScript vanilla · Canvas 2D · Web Audio API · Gamepad API · sem dependências.
