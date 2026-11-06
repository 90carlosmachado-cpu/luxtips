# Odds Betano e prioridade de recolha

Pedido explícito em6/11/2026: usar apenas Betano em futebol e Big Odds, atualizar preços sem retirar seleções bloqueadas e priorizar publicados mais dez candidatos seguintes. Versão final publicada:2fbe3451-79c5-4bc1-b480-f586aa9da8a3.

## Preços e seleções

Preços executáveis de futebol e novas publicações Big Odds exigem Betano. O consenso de probabilidades do futebol continua a usar o conjunto de casas anteriormente validado; a alteração é à casa dos preços de execução, não uma recalibração do modelo. Os preços dos combos continuam passivos e não publicáveis.

O novo módulo betano-prices.mjs consulta as cotações reais já recebidas, por jogo, kickoff, mercado e seleção exatos. Não usa preços de outra casa, observações futuras ou odds recolhidas durante o jogo. Mantém campos originais de publicação imutáveis e acrescenta currentQuote/currentOdd no feed Big Odds e registeredQuote nos cartões de futebol, sem reescrever o banco de snapshots.

A apresentação mostra Betano, hora da fonte e preço mais recente, mesmo que tenha descido abaixo de1,20 depois da publicação. Se não houver preço, mostra indisponível; se ultrapassar seis horas, marca desatualizado. O total Big Odds é o produto dos preços Betano apresentados: se alguma cotação faltar, fica indisponível; se alguma estiver expirada, o total fica marcado como desatualizado. Depois do início do jogo conserva apenas o último preço pré-jogo guardado, não odds em direto.

Às08h Lisboa bloqueiam-se as seleções do dia, não os preços. Amanhã eD+2 continuam substituíveis até às08h dos respetivos dias. O boletim Big Odds ativo mantém as mesmas nove seleções. A odd original8,29587314917969 da Pinnacle fica apenas no snapshot técnico; a apresentação verificou9,568124712754885 da Betano, marcado desatualizado pela cotação antiga do Torino–Lecce. Não foi executado outro ciclo nem apagado histórico nesta tarefa.

## Metas de recolha

- Jogos publicados no futebol e no boletim Big Odds ativo:15minutos quando a recolha está pronta.
- Dez jogos não publicados com maior probabilidade de vitória estimada nas previsões disponíveis:30minutos.
- Restantes jogos:180minutos.

O ranking dos dez usa as probabilidades causais disponíveis, com a referência de mercado quando válida, sem resultados futuros. Filtra ligas configuradas e jogosNS futuros. Uma seleção publicada tem prioridade mesmo que não possua uma previsão recente em cache. O grupo publicado considera as publicações técnicas ainda válidas, pelo que pode incluir um cartão temporariamente sem preço elegível.

A rotina continua a correr por minuto. No máximo duas execuções prioritárias consecutivas, depois uma execução normal para não bloquear resultados/estatísticas. Cada lote prioritário faz no máximo três recolhas, sem iniciar uma nova recolha após30segundos do início do lote. Cooldowns, locks, falhas e orçamento do fornecedor continuam ativos. Os intervalos são metas e podem atrasar com latência, paginação ou indisponibilidade. A página consulta os dados por minuto; isso não força uma chamada ao fornecedor a cada visita.

## Orçamento diário

Limite do fornecedor confirmado nos headers:7500chamadas/dia,300/minuto. Mantido DAILY_BUDGET=6000. No momento do cálculo havia66jogos futuros no horizonte,12publicados e10candidatos seguintes. Estimativa conservadora para24horas com conjunto constante e uma página por recolha:

| Grupo | Conta | Chamadas por dia |
|---|---|---:|
|12publicados|12×96|1152|
|10seguintes|10×48|480|
|44restantes|44×8|352|
|Total odds||1984|
|Reserva de planeamento para outras recolhas||1500|
|Total planeado||3484|

A reserva não é uma medição das chamadas sem odds; serve como margem. Nos seis dias completos anteriores, o consumo total registado ficou entre994e1635chamadas/dia. O dia6/11estava em776à hora da consulta. Estes totais antigos já incluem a recolha de odds antiga e não foram somados novamente. Paginação, falhas e crescimento do conjunto podem elevar o consumo; o travão6000permanece a proteção efetiva. O limite é diário, não mensal.

## Validação e operação

129testes históricos+71de produção passaram. Os novos testes verificam atualização abaixo do preço mínimo sem perder a seleção bloqueada, ausência de fallback, cotação indisponível/expirada, clocks e kickoff, total independente do snapshot, rejeição de nova publicação de outra casa e prioridades15/30min com dez candidatos. A sintaxe e o build dry-run passaram. O frontend de futebol foi gerado do HTML real e o JavaScript compilado sem erro.

API futebol confirmou Betano nos cartões. API Big Odds200 e interface móvel390px foram verificadas com preços, timestamps, total e aviso de preço expirado; sem overflow. A navegação direta da ferramenta de renderização para a raiz teve falha de ligação, mas a respostaHTTP da raiz foi confirmada200a partir da mesma origem. Os módulos publicados foram comparados com a origem local. A primeira execução da nova prioridade recolheu WillemII–PECZwolle e guardou priorityRunCount1com oddsPriority0.

A Roma foi arquivada às14h42pelo ranking dos três melhores de amanhã e substituída pelo Bayern antes da alteração Betano: probabilidades reavaliadas67,48%e68,08%, respetivamente. A odd Betano antiga não foi, por si só, a causa da substituição. O Arsenal deixou de estar visível quando a odd Betano1,18não cumpria o mínimo1,20, antes do bloqueio de amanhã.
