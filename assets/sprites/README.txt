ANIMACOES DOS LUTADORES — COMO DEIXAR MAIS FLUIDO
=================================================

Cada lutador tem uma pasta de sprites aqui: p1/, p2/, p3/ ...
Os quadros de uma animacao seguem o padrao:

    <animacao>_<indice>.png        (indice comeca em 0)

Exemplos:  idle_0.png   walk_0.png walk_1.png walk_2.png   punch_0.png punch_1.png punch_2.png

As animacoes sao ESCALONAVEIS: da pra deixar um golpe/movimento mais fluido
adicionando quadros intermediarios, UMA animacao de cada vez, sem quebrar o jogo
e sem mexer na logica. O segredo e que o NUMERO DE SPRITES e' independente do
gameplay (ver secao "POR QUE NAO QUEBRA").


PASSO A PASSO (exemplo: deixar o SOCO mais fluido, de 3 para 5 quadros)
----------------------------------------------------------------------
1) Desenhe os quadros intermediarios e salve em sequencia, sem pular numero:
       assets/sprites/p1/punch_0.png
       assets/sprites/p1/punch_1.png
       assets/sprites/p1/punch_2.png
       assets/sprites/p1/punch_3.png   (novo)
       assets/sprites/p1/punch_4.png   (novo)

2) Abra o JSON do lutador:  assets/data/players/p1.json
   Na animacao correspondente, ajuste o campo "frames":

       "punch": { "frames": 5, "fps": 20, "loop": false }

3) Aumente o "fps" PROPORCIONALMENTE para manter a MESMA DURACAO.
   Mais quadros no mesmo tempo = mais fluido (e nao mais lento).
       Antes:  3 quadros @ 12 fps = 0,25 s
       Depois: 5 quadros @ 20 fps = 0,25 s   (mesma duracao, mais suave)
   Conta rapida do fps novo:  fps_novo = fps_antigo * (frames_novo / frames_antigo)
   Se voce NAO aumentar o fps, a animacao apenas fica mais lenta.

Pronto. Nao precisa mexer em codigo. Da pra fazer isso aos poucos, uma
animacao por vez, para cada lutador separadamente.


POR QUE NAO QUEBRA (as 3 garantias)
-----------------------------------
1) FUNCIONA COM QUALQUER QUANTIDADE (2, 4, 5...). A animacao reproduz apenas os
   sprites que REALMENTE existem em disco, em sequencia a partir do _0. Voce pode
   declarar "frames": 5 no JSON e ir adicionando os PNGs aos poucos: enquanto
   faltam arquivos, o jogo usa os que ja existem, sem quadro quebrado no meio.

2) O DANO NAO SE MEXE. O momento em que o golpe acerta vem do "frame data" do
   golpe (startup/ativo, em 60 fps de referencia) — NAO do numero de sprites.
   Por isso adicionar quadros intermediarios deixa a animacao mais bonita sem
   mudar QUANDO o golpe conecta nem o equilibrio do jogo.

3) A DURACAO LOGICA (recovery) usa o "frames" DECLARADO no JSON, entao o tempo de
   recuperacao do golpe e' estavel enquanto voce preenche a arte.


SE O VISUAL SAIR DE SINCRONIA COM O GOLPE
-----------------------------------------
Como o dano e' cronometrado pelo frame data, pode acontecer de o impacto sair um
pouco antes/depois do quadro em que o sprite "estende" o golpe. Ajuste no JSON:
  - "fps" da animacao  -> muda a velocidade/duracao do desenho.
  - "startup" do golpe (bloco "golpes" do JSON) -> adianta/atrasa o momento do dano.
Os dois juntos deixam o impacto batendo certinho com o quadro que voce quer.


CAMPOS DA ANIMACAO (no JSON do lutador)
---------------------------------------
  "frames" : quantos quadros a animacao tem (quantos <animacao>_N.png existem).
  "fps"    : quadros por segundo (velocidade do desenho).
  "loop"   : true = repete (idle/walk/run); false = toca uma vez (golpes/hit).

OBS: o campo "framesAtivos" que aparece em alguns JSONs e' LEGADO e hoje e'
IGNORADO. O timing do dano vem sempre do frame data do golpe. Pode remove-lo.


ESPECIFICACAO DO SPRITE
-----------------------
- Tamanho do quadro: 256 x 256 px (CONFIG.frameSize), PNG com transparencia.
- O personagem deve ficar centralizado e "de pe" sobre a mesma linha de chao em
  todos os quadros, senao ele "treme" durante a animacao.
- Animacoes/golpes opcionais (ex.: soco_baixo, special, backdash): se os sprites
  nao existirem, o jogo cai num fallback (reaproveita outra pose) e nao quebra.
