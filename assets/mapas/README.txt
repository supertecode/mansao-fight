MAPAS DA ARENA
==============

O jogo carrega automaticamente o arquivo:

    assets/mapas/arena.png

Se o arquivo NÃO existir, o jogo usa um cenário procedural (gradiente + chão)
cobrindo a arena inteira. Ou seja: dá pra jogar sem o PNG, ele é opcional.

ESPECIFICAÇÃO DO ASSET
----------------------
- Largura : 1920 px  (= CONFIG.arena.larguraMundo — a arena INTEIRA)
- Altura  :  540 px  (= CONFIG.arena.altura — igual à tela, NÃO rola na vertical)
- Formato : PNG
- Chão    : os pés dos lutadores ficam em y = 486 (CONFIG.arena.chaoY).
            O piso deve estar nessa mesma altura ao longo de TODA a largura,
            senão o lutador "flutua" em parte do mapa.

A tela mostra uma "janela" de 960 px por vez. A câmera segue o meio dos dois
lutadores: andar pra direita revela a parte direita; pra esquerda, a esquerda.
Não estique a imagem manualmente — desenhe tudo na proporção natural em 1920x540.

QUER UMA ARENA MAIOR/MENOR?
---------------------------
Mude CONFIG.arena.larguraMundo em game.js e exporte o PNG com essa mesma
largura (sempre múltiplo de 960 fica ideal). Ex.: 2880 = 3 telas de largura.

PARALLAX (opcional, avançado)
-----------------------------
Para profundidade, dá pra usar camadas que rolam em velocidades diferentes.
Não está implementado ainda — peça que eu adiciono se quiser.
