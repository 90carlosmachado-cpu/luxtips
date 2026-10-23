# Contexto e operação do LuxTips

## Estado de publicação

Modelo publicado: `luxtips-events-xg-prior4-live-v3`, release
`2026-10-23-strength-reschedule-v8`, publicada em 23-10-2026, 07:48 UTC. Ver
[revisao-robustez.md](revisao-robustez.md) para alterações, protocolo e validação.
Mistura temporal e peso máximo do xG mantidos. Regularização da força base/xG
reduzida de 8 para 4 nas cinco ligas com xG, por pedido explícito do utilizador.
Outras ligas e modelos de detalhe mantêm prior 8. A melhoria retrospetiva é
modesta e não demonstra rentabilidade futura. Avaliação prospetiva própria da v3,
sem reutilizar métricas nem reescrever publicações das versões anteriores.

Jogos reagendados com a mesma identidade deixam de ficar presos à cache antiga:
recalculam para o novo início e voltam a consultar fontes correspondentes a esse
início. Publicações/snapshots existentes são preservados. Mudanças de identidade
continuam excluídas com motivo interno.

## Dados e cálculo mantidos

Dez competições; só Premier League, La Liga, Bundesliga, Serie A e Ligue 1 usam
OpenFootAPI/FotMob. Correspondências entre fornecedores exigem identidade e
resultados reconciliados, sem associações aproximadas ou xG inventado.

Mantém força ofensiva/defensiva, adversários, fator casa e mistura temporal.
XG total tem peso por equipa até 50%, multiplicado pela fração de amostra até
12 jogos e cobertura até 70%. Reduz-se após 45 dias e exclui-se após 90 dias.
Dados insuficientes de uma equipa não anulam automaticamente o xG da outra.

Detalhes: >=30 jogos completos na liga, >=12 jogos limpos por equipa, amostra
efetiva >=12 e dados recentes até 45 dias. Usam-se xG sem penáltis, jogo corrido,
bolas paradas e evolução do marcador. Partidas com expulsões confirmadas são
excluídas do ajuste de força. Estados empatado/a ganhar/a perder usam exposição
em minutos e fatores empíricos limitados a 0,75–1,25. Acrescenta-se a taxa observada
de golos de penálti da liga. O detalhe tem peso amostra/(amostra+40), até 35%.
São aproximações observacionais, sem eficácia prospetiva demonstrada.

Lesões/onzes são contexto; não têm efeito individual arbitrário nas probabilidades.
Um onze confirmado prevalece sobre boletins contraditórios. Pressão/progressões,
qualidade pós-remate, meteorologia, impacto causal de jogadores e cenários de
minutos não estão implementados. Posse, passes, remates e defesas não substituem
essas métricas. Ausência de dados permanece explícita.

## Operação preservada

Cloudflare Paid, CPU até 30000 ms. Cron por minuto; leituras públicas sem trabalhos
de manutenção. API-Football usa Container privado `FootballRelay`, imagem gerida
`cloudflare/debian-trixie`, chave apenas no ambiente de execução. Desliga após
60 s de inatividade. Gate global D1, espaçamento de 1,2 s e backoff. Não regressar
a fetch direto ou Browser Run sem verificar as limitações de saída já encontradas.

Quotas: API-Football 6000/dia, contexto até 1500/dia e OpenFoot 500/dia. XG nos
minutos 7/37. Nenhuma nova subscrição, serviço ou aumento de recursos/limites.
Os consumos faturados não foram aferidos nesta revisão local.

## Seleção, odds e avaliação

A revisão local centraliza critérios, remove o veto global e implementa recolha
paginada com estados explícitos. Mantém 60%/70%, amostra 12, odd 1,25, idade <6h,
EV conservador >=3%, até três jogos/dia e uma seleção/jogo. O prazo de espera de
15 min é por dia; não bloqueia outros dias nem reescreve publicações existentes.

Odds têm casa, mercado, seleção, relógio do fornecedor e instante de observação.
Primeira/última cotação observada não são abertura/fecho oficiais. Odds derivadas
de probabilidades não são preços de casas. A divergência específica do mercado
não é intervalo de confiança nem garantia de acerto.

Protocolo estatístico antecipado, calibração, comparação passiva, ROI teórico,
limites e exclusões estão documentados em [revisao-robustez.md](revisao-robustez.md).
Os ledgers `openfoot_context_forecasts`, fontes e publicações mantêm imutabilidade.
O relatório atual é protegido em `GET /api/admin/openfoot?context=1`. Os resultados
antigos não são atribuídos ao modelo atual. Não há comparação técnica na página.
