# LuxTips 2

Análise probabilística de futebol com API-Football, Cloudflare Workers e D1. O Excel deixa de ser a fonte operacional. Projeto independente, sem integração com outros sistemas.

## Arquitetura

- Worker `luxtips`: serve a interface e a API pública de leitura; executa sincronização programada.
- D1 `luxtips-analysis`: jogos, cache persistente, quotas, resultados e previsões imutáveis.
- Sem KV, R2, serviços de IA generativa ou novos planos pagos.
- Seis competições iniciais: Portugal (94), Inglaterra (39), Espanha (140), Alemanha (78), Itália (135) e França (61).
- Sincronização aos minutos 07 e 37 de cada hora, em UTC. A época atual é descoberta na API.
- Cache: cobertura 24 h; histórico da época 24 h; jogos próximos 30 min; odds 3 h; lesões 6 h; alinhamentos 30 min. Histórico de épocas anteriores é carregado no arranque. Jogos sem alterações não voltam a ser escritos em D1.
- Limite local de 600 pedidos/dia, partilhado atomicamente em D1, com reserva para as atualizações essenciais antes das consultas de odds, lesões e alinhamentos. O plano consultado permite 7.500/dia e 300/minuto, estando ativo até 07/11/2026. Isto é uma observação de 18/10/2026, não uma garantia de renovação.
- A consulta pública nunca origina chamadas à API-Football. Os erros não registam a chave, cabeçalhos ou corpos das respostas externas.

## Modelo e decisões estatísticas

Poisson independente com forças ofensiva e defensiva por equipa, ajuste aos adversários, médias casa/fora da competição, regularização e decaimento temporal com meia-vida de 180 dias. O histórico é limitado a três anos. Os golos estimados pelo modelo não são xG medidos por eventos.

Foram comparadas três configurações em desenvolvimento: meia-vida 180 dias; mesma configuração com Elo; meia-vida 365 dias. A pequena melhoria do Elo não ultrapassou o limiar de materialidade de Brier de 0,001, pelo que o modelo mais simples foi mantido. O Elo aparece apenas como contexto. Não foram introduzidos fatores de lesões, descanso, motivação ou formações com pesos arbitrários. Ausências e alinhamentos, quando fornecidos, são apresentados como contexto.

A seleção exige amostra efetiva mínima de 12 jogos por equipa, probabilidade ≥65%, melhoria de Brier face à referência simples global e por competição, intervalo normal de 95% da diferença de Brier acima de zero, e grupo de calibração com ≥100 casos e desvio máximo de 8 pontos percentuais. Estes filtros são exploratórios e exigem confirmação prospetiva; não demonstram rentabilidade, nem corrigem dependência entre jogos ou comparações múltiplas.

A fiabilidade apresentada é a frequência observada no grupo histórico correspondente, acompanhada de amostra e intervalo de Wilson; não é uma percentagem de confiança inventada para o jogo individual. A qualidade dos dados diz respeito à amostra de resultados disponível e não representa cobertura integral de todas as estatísticas da API.

Com odds reais recentes, o valor esperado é `probabilidade × odd − 1`; a seleção exige EV ≥3%. Sem odds reais não é calculado valor. Odds de várias casas não são misturadas para criar uma probabilidade implícita supostamente sem margem. As probabilidades do modelo não são misturadas com o mercado.

## Validação executada

Dados reais recolhidos na API-Football em 18/10/2026: 6.584 jogos concluídos disponíveis nas épocas 2023–2026. Desenvolvimento na época 2024 e teste na época 2025 (2025/26), com 1.835 jogos elegíveis após o filtro de amostra. O conjunto de 2026 não foi usado para escolher configurações ou medir o teste de 2025.

Walk-forward diário: cada previsão histórica usa apenas resultados com pelo menos duas horas de antecedência relativamente às 00:00 UTC do dia do jogo. A escolha entre configurações usa os mesmos jogos elegíveis para todas as alternativas. Não foram usados estados atuais de classificações, lesões ou odds para prever o passado.

| Evento binário |  Brier | Referência da competição | Log Loss | Desvio de calibração |
| -------------- | -----: | -----------------------: | -------: | -------------------: |
| Vitória casa   | 0,2140 |                   0,2458 |    0,616 |               1,8 pp |
| Vitória fora   | 0,1871 |                   0,2138 |    0,555 |               3,1 pp |
| Mais 2,5 golos | 0,2466 |                   0,2471 |    0,686 |               3,9 pp |
| Ambas marcam   | 0,2488 |                   0,2480 |    0,691 |               3,0 pp |

Valores mais baixos de Brier e Log Loss são melhores. A referência usa médias de golos da competição, sem força das equipas; não é o mercado de apostas. O relatório completo, com amostras, acerto binário, grupos de calibração e métricas por competição, está em `src/validation.json` e na interface.

Recomendações elegíveis: vitória casa, vitória fora, casa/empate e empate/fora, com filtros adicionais. Vitória fora e casa/empate estão suspensas em Espanha por não ultrapassarem o critério por competição. Empate, sem empate, totais e ambas marcam permanecem como probabilidades informativas, com recomendações suspensas. Cantos, cartões, handicaps e empate anula aposta não foram implementados como recomendações por falta de validação adequada.

Não há odds históricas adequadas neste conjunto: **ROI não calculado e vantagem sobre casas de apostas não demonstrada**. Não existem snapshots comparáveis do modelo anterior, pelo que não foi executada comparação direta. O acerto binário de cada evento ao limiar de 50% não é a taxa de acerto dos prognósticos selecionados.

## Previsões e avaliação contínua

O primeiro registo preliminar é conservado. A análise operacional pode ser atualizada na cache; a previsão final é fixada na primeira sincronização dentro da última hora anterior ao jogo. O intervalo de 30 minutos é uma cadência de tentativa, não uma garantia de disponibilidade do fornecedor.

A base rejeita previsões com data de criação posterior ao início e bloqueia UPDATE/DELETE de snapshots. Os resultados regulamentares são associados separadamente. Jogos adiados com horário alterado não são avaliados com o horário antigo. Não se inventam previsões finais retroativas quando o processo falha antes do início.

O histórico mostra as últimas 1.000 previsões finais liquidadas e calcula Brier, Log Loss e calibração continuamente. As métricas históricas de backtest são separadas das métricas prospetivas. A nova evidência não altera automaticamente hiperparâmetros: esse ajuste exige nova validação cronológica.

## Segurança e operação

Segredos exigidos no Worker: `API_FOOTBALL_KEY` e `ADMIN_TOKEN`. Nunca os colocar em HTML, Git, parâmetros de URL ou ficheiros distribuídos. O token administrativo pode ser substituído no painel Cloudflare ou com `wrangler secret put ADMIN_TOKEN`; o valor não é incluído neste repositório.

Endpoints:

- `GET /api/games`: análises dos próximos sete dias.
- `GET /api/history`: previsões finais liquidadas e métricas prospetivas.
- `GET /api/validation`: relatório histórico reproduzível.
- `GET /api/health`: resultado da última sincronização.
- `POST /api/admin/sync`: sincronização pontual, com `Authorization: Bearer <ADMIN_TOKEN>`. O parâmetro opcional `?force=1` verifica a recolha direta sem ignorar a quota diária.
- `GET /api/admin/provider`: diagnóstico restrito do plano e limites, sem dados da conta ou valores da chave.

O acesso público de leitura é intencional. CORS permite a página GitHub do projeto; a interface no Worker usa a mesma origem. A autenticação administrativa verifica o token por comparação dos hashes em tempo constante. CSP restringe origens de scripts, pedidos e enquadramento. A cache desatualizada é assinalada; a seleção é suspensa quando os dados da recolha estão desatualizados ou a análise apresentada tem mais de duas horas.

Em caso de limite da API ou falha de rede, não aumentar o plano: consultar `/api/health`, o diagnóstico autenticado e a quota em D1. Manter a última cache com indicação de desatualização. A paginação não tratada de um endpoint causa recusa explícita; não se apresenta uma resposta parcial como completa.

## Reproduzir

Requisitos: Node 24 e Python 3. A chave é fornecida apenas por variável de ambiente `API_FOOTBALL_KEY`.

```sh
npm ci
python scripts/download.py
npm run backtest
npm run build
npm test
npx wrangler deploy --dry-run
```

A aquisição faz 30 pedidos: cobertura e quatro épocas para seis competições. Os dados brutos e as previsões individuais ficam em `data/`, ignorado pelo Git. `src/validation.json` inclui um hash SHA-256 do conjunto normalizado para detetar alterações da fonte. Uma recolha futura pode diferir por correções do fornecedor e por novos jogos de 2026.

O teste funcional de sincronização usa dados sintéticos identificados como tal; não é usado para alegações de precisão. O backtest usa exclusivamente os dados reais acima. Os 13 testes automatizados cobrem distribuição de probabilidades, separação temporal, amostra insuficiente, liquidação regulamentar, EV, odds, intervalos, imutabilidade, autenticação, cache, quotas, erros e sincronização com liquidação.

Publicação futura, apenas quando autorizada:

```sh
npx wrangler d1 migrations apply luxtips-analysis --remote
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

A configuração aponta exclusivamente para o Worker e a D1 do LuxTips. Não altera os outros projetos da conta. A fonte anterior pode ser recuperada pelo commit original `f467af92bd182bc9033b0d86b32e1d11b663929d`; não reutilizar a antiga chave de proxy publicada no HTML como credencial administrativa.

## Fontes técnicas

- https://www.api-football.com/documentation-v3
- https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

## Estado verificado nesta entrega (18/10/2026)

A interface e o processamento foram publicados no Worker existente. A primeira sincronização de cálculo em produção terminou com 54 jogos analisados nas seis competições, usando uma carga inicial de dados reais recolhidos diretamente da API nesta sessão. Uma verificação posterior confirmou recolhas diretas de jogos no Worker para Portugal, Inglaterra e França. Noutras consultas houve erros de limite por minuto e foi usada a cache. A renovação direta das seis competições numa execução integral ainda não foi confirmada.

O cron de 30 em 30 minutos está configurado; não foi aumentada a frequência nem contratado qualquer plano adicional. Os dados da cache conservam as datas de recolha originais; não se renovou artificialmente a sua validade. Uma falha de atualização não transforma dados dentro da validade em dados expirados. O fallback sinaliza falhas da fonte e suspende recomendações quando a cache utilizada já expirou. A interface distingue estas situações. A redução das respostas intermitentes de limite do fornecedor é a limitação operacional restante.

Os 13 testes locais passaram, incluindo repetição da sincronização, novo horário de jogo, imutabilidade e liquidação. O workflow do primeiro commit também passou no GitHub. A interface publicada foi testada no navegador para listagem, filtro de competição, análise detalhada e relatório histórico. A validação visual num telemóvel físico não foi executada.

## Seleção de favoritos (v2)

A vitória simples elegível tem prioridade sobre uma dupla hipótese com maior probabilidade. Mantêm-se probabilidade mínima de 65%, amostra efetiva, evidência por competição e filtros de valor. Na vitória simples, intervalos adjacentes de calibração podem ser agregados até 30 pontos percentuais, com pelo menos 100 casos; a escolha do intervalo usa apenas amostras e probabilidades, nunca resultados. A frequência histórica descreve o intervalo completo e não substitui a probabilidade individual. A agregação é uma alteração exploratória que exige acompanhamento prospetivo.

A página inicial apresenta apenas recomendações recentes de jogos futuros. Mostra nomes das equipas, odds reais quando disponíveis e o limiar de odd calculado para 3% de valor esperado estimado. Sem odds, o valor fica expressamente por confirmar.

`node scripts/selection-review.js` reproduz a comparação retrospetiva das políticas a partir dos ficheiros gerados pelo backtest. `src/selection-review.json` contém os resultados reais; não é um novo teste independente e não mede ROI. As versões antigas permanecem imutáveis; para evitar duplicações, o histórico avalia a última previsão final registada antes do jogo, por encontro e horário.

## Prognósticos de vencedor (v3, comportamento atual)

O prognóstico desportivo é distinto da recomendação de valor: escolhe a equipa com maior probabilidade no 1X2, desde que supere empate e adversário. A apresentação destaca no máximo três por dia de Lisboa por probabilidade, sem ajustar pesos para incluir nomes específicos. Não exige 65% nem odd positiva para prever um vencedor. O campo `winnerTip` guarda este prognóstico; `recommendation` mantém os filtros mais exigentes de seleção de mercados/valor. Odds desfavoráveis são identificadas e não escondem a previsão de vencedor. Probabilidade inferior a 50% recebe a indicação «Vantagem curta».

Mantém histórico mínimo de 12 jogos efetivos. Cache com até 24h permite prognóstico provisório quando a atualização falha; mostra idade real e aviso. Além de 24h, ou sem data verificável, o prognóstico é suspenso. Dados em atraso não originam previsões finais: estas aguardam atualização válida antes do início. Os snapshots antigos não são reescritos. O histórico distingue o acerto de `winnerTip` do mercado recomendado anterior.

`node scripts/winner-review.js`: avaliação cronológica das probabilidades históricas já guardadas e seleção fixa de até três por dia. O relatório `src/winner-review.json` inclui acerto, Brier, Log Loss, ECE, intervalos e desempenho por competição. Não é um novo período independente, não simula a disponibilidade histórica da API e não mede ROI.

`node scripts/compare-score-models.js`: experiência separada com sete correções de resultados baixos inspiradas em Dixon–Coles (1997), selecionadas em 2024 e avaliadas em 2025. O resultado é guardado em `src/score-model-research.json`; não altera automaticamente o modelo de produção.

O histórico da v3 também inclui o último prognóstico provisório anterior ao jogo quando não houve final, evitando excluir precisamente os jogos com falhas da fonte. Cada revisão preliminar é acrescentada ao registo; após existir final desta versão, essa previsão fica congelada. A simulação dos três destaques históricos usa o corte diário original; a apresentação ao vivo pode mudar antes do jogo com novos dados. O histórico prospetivo avalia todos os prognósticos guardados, separadamente dessa simulação.

Na apresentação, os destaques exigem probabilidade de vitória de pelo menos 50%: a vitória é pelo menos tão provável como empate e derrota somados. Favoritos relativos abaixo de 50% continuam consultáveis numa secção distinta de «Vantagem curta», sem serem apresentados como escolhas fortes. O relatório contém ambos os perfis; a interface apresenta a simulação `majority` para os destaques.

## Revisão de utilização e dados (18/10/2026)

A apresentação e a API pública estão limitadas a hoje e aos dois dias seguintes no calendário de Lisboa, incluindo mudanças de hora. Só jogos ainda não iniciados, com horário/equipas coincidentes com o registo atual e estado NS podem aparecer. As três abas de dia e os cartões compactos deixam as estatísticas, riscos e calibração em «Ver análise». Erros na atualização preservam os dados ainda válidos; os detalhes abertos não fecham na atualização automática.

As gravações das fixtures respeitam a data efetiva da fonte, impedindo que o histórico diário em cache reponha resultados ou horários antigos sobre uma consulta recente. O cache novo guarda explicitamente essa data, mantendo compatibilidade com os registos anteriores. Falhas de uma competição não interrompem as restantes. A liquidação também considera jogos com resultado recebido fora da janela curta. Jogos adiados ou com horário entretanto alterado deixam de expor a previsão antiga. A saúde pública tem limite de uma hora para considerar uma sincronização atual.

O Worker permite a mini app embutida exclusivamente na sua própria origem e em https://web.telegram.org. Endpoints administrativos mantêm autenticação; os diagnósticos não devolvem textos de erro externos que possam conter informação sensível. Não foram alterados os modelos nem os pesos nesta revisão. A recolha de calendário pode continuar a manter uma semana em cache, mas o processamento dos prognósticos e a consulta pública respeitam os três dias.

## LuxG (18/10/2026)

LuxG apresenta a distribuição de marcadores do modelo Poisson com ataque/defesa ajustados aos adversários, ponderação temporal, regularização e vantagem caseira. As médias não são arredondadas para prever o resultado: os três modos da distribuição conjunta são calculados diretamente, cada um com a sua probabilidade. As faixas de golos são os intervalos inteiros contíguos mais curtos com pelo menos 80% da massa marginal, não intervalos de confiança dos parâmetros. Sem dados de remates, não se afirma medir xG por eventos. Todos os mercados continuam derivados das mesmas intensidades. A extensão de apresentação aplicada a caches antigos usa apenas as médias já registadas, sem alterar os seus timestamps, probabilidades ou snapshots.

Pesquisa reproduzível: `node scripts/luxg-dataset.js`, `python scripts/luxg-train.py`, `python scripts/luxg-joint.py`, `python scripts/luxg-evaluate.py`. Dependências científicas: NumPy 2.3.5, SciPy 1.17.0. Usam os ficheiros reais em `data/normalized.json`, excluídos do Git, com hash no relatório. Os relatórios/protocolos iniciais são preservados. Foram exploradas 45 variantes (18 iniciais, 18 com elegibilidade alinhada e nove correções conjuntas), incluindo Elo, resíduos recentes, casa/fora, descanso, correlação de resultados baixos, dispersão e inflação de zeros. As variáveis de treino são presequenciais: só jogos concluídos pelo menos duas horas antes do corte diário. A ausência de odds históricas impede ROI.

Nenhum candidato passou o critério prévio de desenvolvimento; por isso as probabilidades atuais foram preservadas. No teste final 2026, 285 jogos elegíveis: modelo ativo Brier 1X2 0,57709; Log Loss 1X2 0,97206; Log Loss marcador 2,99119; acerto do marcador modal 10,88%; um dos três marcadores 31,23%; MAE dos golos 0,948. O melhor experimental teve Log Loss marcador 2,97795 e Brier 0,57112; a diferença emparelhada de Log Loss foi 0,01324, IC bootstrap por semana 95% [0,00571; 0,02019], apenas nove blocos. Esse resultado não reabre a seleção: o candidato continua experimental. Não é evidência de rentabilidade. Os intervalos centrais discretos nos relatórios Python e os intervalos mínimos apresentados pela aplicação são construções diferentes, ambas identificadas; não comparar a sua cobertura diretamente.

Referência metodológica: Dixon & Coles (1997), DOI 10.1111/1467-9876.00065. O modelo ativo é Poisson independente ajustado a adversários; as correções inspiradas nessa literatura foram experiências rejeitadas, não uma reprodução integral do artigo. Implementação numérica: documentação oficial `scipy.optimize.minimize`.

## Vencedor com combinação temporal (18/10/2026)

O cálculo ativo passa a `winner-multiscale-v1`. Combina distribuições Poisson completas (não médias de golos arredondadas) ajustadas aos adversários, com meias-vidas de 180 e 365 dias. Os pesos atuais são 0,234026708854492 e 0,765973291145508, aprendidos exclusivamente em épocas anteriores à de 2026. A seleção do grau de regularização usa a época anterior; o teste cronológico aninhado usa 2025 e 2026. O modelo de 90 dias e o de maior regularização foram candidatos, mas receberam peso nulo. Todos os mercados derivados e os cenários de marcador permanecem probabilisticamente coerentes com a mistura. A elegibilidade mantém a amostra efetiva do componente de 180 dias.

Nesta pesquisa, nove correções multinomiais diretas melhoraram Log Loss mas reduziram o acerto dos destaques: 333/464 contra 334/464; não foram adotadas. As três combinações temporais predefinidas foram uma extensão de desenvolvimento posterior. Resultado da política selecionada: 335/459 (72,98%) contra 334/464 (71,98%). Em 2.120 jogos, Brier 1X2 0,58658 contra 0,58821; Log Loss 0,98546 contra 0,98780. Melhoria de Log Loss 0,002340; IC bootstrap por semana [0,000507; 0,004156], 48 blocos. A diferença no acerto é pequena, os conjuntos selecionados diferem e não foi estabelecida significância estatística dessa diferença. Não são números garantidos para apostas futuras.

**Limite da evidência:** as épocas já tinham sido observadas nas pesquisas anteriores. Esta é reavaliação retrospetiva, não um novo teste independente. O bootstrap não corrige o efeito de investigar múltiplos modelos. A adoção cumpre o protocolo desta experiência dirigida ao vencedor, mas exige confirmação prospetiva. O protocolo LuxG anterior, dirigido ao marcador, continua preservado e não foi alterado retroativamente.

Reprodução: gerar `data/luxg-training.json` com `node scripts/luxg-dataset.js`; executar `python scripts/winner-direct.py`; `node scripts/winner-multiscale-dataset.js`; `python scripts/winner-multiscale.py`; `python scripts/winner-export.py`. Os dois protocolos, relatórios e coeficientes estão versionados. Dependências científicas são as mesmas NumPy/SciPy já documentadas. Referências: https://scikit-learn.org/stable/modules/calibration.html e https://arxiv.org/abs/1910.12656 (calibração multinomial; o modelo ativo usa mistura convexa).

O Worker guarda a probabilidade nova e a do Poisson anterior em cada snapshot novo; `/api/history.modelComparison` compara ambas apenas nesses registos anteriores ao jogo e já liquidados. Não recalcula o passado. A comparação inclui todos os jogos registados, não só os três destaques diários. Endpoints públicos preservam os relatórios antigos identificados como legado e incluem `winnerModel` para a versão ativa. Alternativas de mercados deixaram de gerar recomendações na versão nova por não terem validação específica para a nova política.

A página principal mostra apenas até três vencedores por dia, confronto e hora; mantém aviso curto quando a fonte está atrasada. Estatísticas e a evidência ficam em Histórico/Desempenho, fora dos cartões. Não força três escolhas quando não existem favoritos elegíveis. `scripts/recalculate-cache.js` permite uma migração autorizada dos jogos futuros já em cache, sem chamadas à API nem alteração da data da fonte, acrescentando snapshots preliminares da nova versão.

## Política diária de mercado (daily-market-v1)

A lista mantém a ordenação dos favoritos e até três jogos por dia de Lisboa.
Uma única seleção por dia pode passar de vitória para vitória ou empate: escolhe-se,
entre os três favoritos, o maior ganho de probabilidade, que corresponde à probabilidade
do empate. Os restantes mercados continuam a ser vencedores. A reserva é persistida
em `daily_markets`, com data única, jogo, horário, lado e previsão originais. Não é
reciclada depois do início, cancelamento ou mudança de favorito. Revisões posteriores
preservam o lado reservado e os registos anteriores; não alteram resultados passados.

Reprodução: `python scripts/daily-market.py`, com os mesmos dados e dependências da
investigação multiescala descrita acima. Protocolo em `scripts/daily-market-protocol.json`;
resultados em `src/daily-market-research.json`. Compararam-se três políticas fixas:
só vencedores, proteção do empate e maior ganho entre dupla hipótese, totais e ambas
marcam. A escolha foi feita na época anterior a cada avaliação; ambas escolheram a
proteção do empate. Nos mesmos 459 jogos: 335 acertos (73,0%) só vencedores; 368
(80,2%) com 199 proteções em 199 dias. É uma mudança do evento previsto, não uma
melhoria de 7,2 pontos na previsão de vencedores. É desenvolvimento retrospetivo em
dados já observados, não um novo teste independente. Intervalo bootstrap por dia de
95% para a taxa: 76,7–83,5%; não demonstra um mínimo de 80%. Em 2025: 310/388
(79,9%); em 2026: 58/71 (81,7%). Não existem odds históricas para calcular ROI.
A simulação seleciona uma lista diária; não simula atrasos da API nem mudanças da
lista ao longo do dia. Estas diferenças exigem avaliação prospetiva.

Aplicar `migrations/0002_daily_markets.sql` à base D1 existente antes de publicar o
Worker. Não adiciona recursos, chamadas à API-Football ou subscrições. O cron existente
reserva e regista os mercados; a interface lê apenas os registos. O histórico distingue
`displayTip`/`displayHit` da previsão original `winnerTip`/`winnerHit`. O historial geral
inclui também jogos fora dos três destaques e não deve ser comparado diretamente com
os 459 jogos da investigação. A fiabilidade da dupla hipótese não reutiliza a calibração
do vencedor e não é apresentada como uma confiança garantida de 80%.

## Investigação de mercados e seleção com preço mínimo (daily-market-v3-priced)

**Regra atual:** apenas preços reais de pelo menos **1,25**, com atualização da casa
há menos de seis horas. Sem preço verificado, a seleção não é publicada. O filtro
vale também para vencedores; podem existir menos de três seleções. O limite de uma
alternativa diária permanece. As reservas antigas ficam intactas, mas um mercado que
já não cumpre o preço é retirado da apresentação; não abre uma segunda reserva diária.
O modelo de probabilidades não mudou. O filtro de preço altera a população de jogos:
**não há backtest válido desta regra**, por falta de odds históricas adequadas. Os 85,2%
abaixo pertencem exclusivamente à pesquisa anterior SEM o filtro. A interface mostra
esta distinção e o preço/casa de cada seleção, em vez de apresentar a taxa antiga como
expectativa atual. Os testes de paridade Python/JS usam preços sintéticos identificados
como tal apenas para testar código; não são dados históricos nem prova de rentabilidade.

A escolha alternativa diária compara dupla hipótese, totais de golos, ambas marcam,
golos por equipa e handicap asiático +1,5 sem devolução. Continua a existir no máximo
uma alternativa por dia; as outras seleções mantêm o vencedor. Os mercados adicionais
vêm da mesma mistura de Poisson já congelada (média ponderada das distribuições,
nunca Poisson da média). Não foram acrescentados cantos ou cartões sem dados adequados.

`python scripts/market-expansion.py` reproduz a avaliação usando os dados anteriores.
Protocolo em `scripts/market-expansion-protocol.json`: 28 combinações de quatro famílias
de mercados e listas de três, quatro ou cinco jogos, com limiares de 65%, 70% ou 75%
para os jogos adicionais. Os três favoritos anteriores são sempre mantidos. A pesquisa
foi alargada após autorização para testar outros mercados; continua a ser desenvolvimento
retrospetivo. A escolha usa a época anterior; avaliação exterior em 2025 e 2026. O
script exporta `src/market-expansion-research.json` e exemplos sem resultados finais
em `tests/market-expansion-golden.json` para comparar JS com a matriz conjunta em Python.

Nos mesmos 459 jogos, a nova regra teve **391 acertos (85,2%)**, contra 368 (80,2%)
da regra de uma dupla hipótese. Em 2025: 325/388 (83,8%); em 2026: 66/71 (93,0%).
Bootstrap emparelhado por dia, 2 000 repetições: diferença de taxa com intervalo de
95% de +2,46 a +7,41 pontos percentuais; intervalo da nova taxa de 82,1 a 88,2%.
Estas épocas já tinham sido observadas em investigação anterior. A pesquisa repetida
limita a evidência; o intervalo não incorpora toda essa seleção e não é prova de um
mínimo futuro de 80%. A melhoria inclui eventos mais abrangentes que vencer o jogo.
Não há odds históricas adequadas nem ROI demonstrado. Exige confirmação prospetiva.

Dos 199 mercados alternativos históricos: 97 eram mais de 0,5 golos (91 acertos),
59 uma das equipas marcar menos de três golos (57) e 43 handicap +1,5 do favorito (42).
São contagens descritivas da política completa; não justificam percentagens garantidas.
Os dados por competição constam do relatório. A expansão do número de jogos não
passou o seu critério separado: a seleção cronológica não acrescentou jogos no período
exterior avaliado. Mantém-se o limite de **três**, sem concluir que quatro ou cinco
seriam necessariamente piores.

**Taxa de acerto não equivale a qualidade da aposta.** Foi observada, por exemplo,
odd de 1,04 para mais de 0,5 golos em dados reais em cache. Este preço exige cerca de
96,2% de acerto para equilíbrio sem custos; 85,2% agregados entre vários mercados não
comprovam valor nesse mercado. A investigação sem preço otimiza a taxa pedida pelo utilizador e não
é uma estratégia com lucro validado. O preço de 1,04 fica excluído na regra atual. Odds reais e valor esperado estimado ficam
separados da probabilidade; `recommendation` continua vazio sem validação de valor.

Aplicar a migração `0003_market_choices.sql` uma vez antes da publicação. Alarga os
mercados admissíveis, preservando todos os campos das reservas existentes e a tabela
original como arquivo imutável. As reservas já feitas (incluindo hoje/amanhã) não são
recalculadas para trocar de mercado: a nova política atua em datas ainda não reservadas.
As odds usam apenas os nomes completos observados na API, com uma única casa de
apostas escolhida pela maior cobertura de mercados válidos. Não mistura preços de
casas ou partes do jogo. Ausência de preço não é convertida numa odd inventada. Não
muda o plano, a quota, o cron nem cria chamadas externas adicionais.

### Odds e permanência diária (18/10/2026)

As consultas de odds são independentes das consultas de lesões e alinhamentos.
`fixtureOdds` percorre até dez páginas por jogo, contabilizando cada chamada no
orçamento existente (600/dia). Uma falha num jogo não suspende as outras competições.
As respostas completas são guardadas em cache, sem inventar preços ou alterar
credenciais. Erros de quota guardam apenas diagnóstico sanitizado em D1.

A migração `0004_published_picks.sql` acrescenta um registo imutável de seleções
publicadas. O mercado, a probabilidade e a **odd registada** ficam fixos; o estado e o
resultado vêm da ficha atual do jogo. As seleções do dia permanecem até à meia-noite
de Lisboa, mesmo com preços expirados, início do jogo ou derrota. Depois continuam
arquivadas. Há até três novas seleções diárias e no máximo uma alternativa; vitórias
podem repetir-se. Recuperações explícitas de registos anteriores à migração são
marcadas `recovered` e não contam como novas escolhas nem prova prospetiva.

A tabela `maintenance_jobs` aceita tarefas `refresh-odds` criadas apenas pelo plano
de controlo autenticado de D1. Um pedido de leitura executa uma tarefa já autorizada,
com aquisição atómica; não permite ao público criar tarefas ou escolher consultas.
O cron mantém a cadência original. A correção não constitui validação da taxa de acerto.

A recuperação de preços em falta pede especificamente `bet=1` (Match Winner),
sem repetir consultas cujas odds já estão válidas. Ao receber `rateLimit`/HTTP 429,
o cliente respeita uma pausa global de pelo menos 60 segundos (ou Retry-After,
até 300 segundos); as respostas em cache continuam disponíveis. Não altera plano
nem contorna o limite do fornecedor.

### Alternativa efetivamente publicada

A migração `0005_published_alternatives.sql` preserva as vitórias publicadas e permite
uma alternativa adicional quando a escolha original já foi divulgada. Para novos
jogos, a alternativa é selecionada primeiro, e os restantes lugares são vitórias.
O limite global é uma alternativa efetivamente publicada por data, incluindo jogos
iniciados/concluídos. Uma reserva antiga em `daily_markets` não consome esse limite.
A escolha exige preço real >=1,25, maior probabilidade estimada que vencer e valor
esperado positivo segundo o modelo; estes critérios não constituem validação de lucro.
Handicap fica fora da publicação automática até a correspondência entre os rótulos
e a liquidação do preço ser verificada. As probabilidades históricas permanecem intactas.
A seleção e a odd originais nunca são substituídas. Uma alternativa acrescentada a um
jogo já publicado é identificada e avaliada separadamente; pode fazer a lista desse
dia exceder os três lugares iniciais, sem implicar evidência de melhoria de volume.

### Hora de atualização na interface

O cabeçalho apresenta `health.sync.at` com dia/mês e hora de Lisboa, distinguindo
sincronização parcial, falha ou atraso superior a uma hora. Não usa a data imutável
do prognóstico publicado. O cron continua nos minutos 7 e 37 de cada hora; a página
consulta os dados a cada cinco minutos e quando volta a ficar visível (incluindo a
mini app). Os limites da API podem deixar uma sincronização parcialmente atualizada.
