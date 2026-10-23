# Elo em produção — 23-10-2026

Ativação expressamente pedida pelo utilizador. Não é uma promoção baseada em
superioridade estatística demonstrada. O objetivo de publicação continua a ser
vitórias da casa/fora em 1X2.

## Motor

Modelo `luxtips-events-xg-elo020-live-v4`, release
`2026-10-23-elo020-v11`. `LIVE_ELO_WEIGHT=0.2` em
`src/openfoot/strength.mjs`, aplicado nas dez competições. Mantêm-se o prior 4
nas cinco ligas com xG, prior 8 nas restantes, pesos temporais e ajustes de
contexto/detalhes. Os helpers offline conservam Elo zero por omissão.

É o ajuste Elo já existente no motor, não uma mistura de 20% das probabilidades:

- Rating inicial 1500, K=20, vantagem da casa 60 pontos na atualização.
- Atualização sequencial apenas com resultados reais elegíveis anteriores ao corte.
- `delta = clip((Elo_casa - Elo_fora)/400, -1, 1)`.
- Intensidades de golos multiplicadas por `exp(0.2*delta)` para casa e
  `exp(-0.2*delta)` para fora, antes do Poisson e das camadas seguintes.
- O componente xG usa os mesmos ratings calculados dos resultados reais;
  resultados sintéticos da mistura de golos/xG nunca atualizam esses ratings.
- Os fits separados de bolas paradas/jogo corrido mantêm os parâmetros anteriores.

O Elo pode aumentar a probabilidade do favorito ou reduzi-la quando discorda
da força estimada pelos golos; não garante probabilidades superiores a 70%.

## Publicação e avaliação

Critérios preservados: amostra efetiva 12, probabilidade 60%, odd mínima 1,25,
preço com menos de seis horas, EV conservador mínimo 3%, até três vitórias/dia.
Análises informativas e recomendações continuam separadas. A versão própria
impede misturar a avaliação prospetiva com a v3 anterior.

Arquivo pedido para 23, 24 e 25 de outubro, por marcadores em
`openfoot_publication_archives`. Os ledgers e snapshots originais são preservados.
Publicação temporariamente suspensa por lease durante o recálculo do conjunto
completo, para evitar preencher as vagas com o primeiro lote parcial.

## Verificação

109 testes passaram, incluindo normalização, âmbito nas dez competições,
exclusão de resultados futuros, fallback sem xG e ratings baseados nos resultados
reais quando o xG inverte a direção do resultado. `npm run check` e compilação
Wrangler sem publicação concluídos.

Deploy 23-10-2026 11:56:46 UTC, versão
`9a2ecc8c-331b-44a7-9e17-5dd5c6720556` a 100%. Módulo remoto idêntico ao build
local (521841 caracteres, FNV-1a64 `ac47f7fd826ed01e`). Bindings, segredos,
Container, cron e limite CPU preservados.

Oito publicações arquivadas: duas de sexta, três de sábado e três de domingo.
Antes do arquivo: published_picks=10, published_alternatives=2,
openfoot_pick_revisions=16; nenhum desses registos foi apagado ou alterado.

## Novo ciclo e resultado público

Às 12:04 UTC, todos os 64 jogos da janela 23–25/10 estavam na versão v4,
sem falhas no ciclo. Foram concluídos 13 lotes manuais de cálculo, além do cron;
a lease de publicação só foi libertada após confirmar zero caches de versão antiga.

Após libertação, a API pública respondeu HTTP 200 com 64 jogos recolhidos,
64 calculados, 15 análises visíveis e uma recomendação publicada: vitória do
Utrecht sobre o PEC Zwolle, 24/10, probabilidade 66,55%, odd 1,68 (1xBet,
observada 23/10 08:53:15 UTC). EV conservador 7,33%, depois de reservar 2,66
pontos percentuais de divergência entre componentes. É o valor calculado pelas
regras existentes, não uma demonstração de lucro real.

Confirmada também a apresentação na interface de sábado. Os 10 registos
originais em published_picks e dois em published_alternatives mantiveram-se;
as revisões passaram de 16 para 17 pela nova publicação, sem reescrever anteriores.

As 64 distribuições H/D/A somam 1 dentro da tolerância 1e-9; 64/64 caches
registam Elo 0,2 e 47/64 incluem enriquecimento xG ativo. Há odds expiradas ou
incompletas em parte de domingo: as análises permanecem visíveis, sem transformar
preços antigos em recomendações. Mantém-se a espera máxima da política e a
avaliação parcial após o prazo, sem baixar critérios.
