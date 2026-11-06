# Versão xG publicada —06/11/2026,10:38UTC

Política bigodds-xg90-prior2-market50-no-unders-v1. Implementada a candidata sem unders: meia-vida90dias,prior2,xG com mínimo2 jogos ponderados por condição e20 na liga;50%modelo e50%referência da casa sem margem. Sem xG suficiente,fallback para golos com os mesmos parâmetros. Mesmos5–12jogos,odd8–15,horário08h,horizonte3dias e uma única múltipla ativa.

Validação:54testes passaram. Modelo JavaScript coincide com o Python nas278janelas e o seletor50/50 reproduz os dez boletins e6/10 resultados históricos da candidata. Testes de xG inválido/futuro/duplicado/divergente,fallback,odds,publicação,arquivo,comando extraordinário de utilização única e regressão futebol.

A pedido explícito,o boletim ativo antigo foi arquivado como Substituído;publicações e histórico mantidos. Comando interno temporário em openfoot_state,bigodds:manual_rebuild,consumido atomicamente pelo cron;sem endpoint público ou novo segredo. O resultado fica em bigodds:manual_result. Comandos expirados ou de outra política não arquivam dados. O horário normal não mudou.

Novo boletim criado às10:39:10UTC:10seleções,Bet365,odd8,42778279936,7com xG e3fallback,para7e8novembro. Não foram reutilizados jogos dos boletins anteriores. Apenas um boletim ativo. Odds recentes e jogos futuros verificados.

Verificadas páginas desktop/móvel,análise com origem dos dados,50/50,arquivo Substituído,APIs futebol/histórico200,18módulos remotos e bindings preservados. Sem nova migração. A taxa histórica permanece exploratória;estes testes validam a implementação,não provam uma taxa futura.

Ver BigOdds-publicacao-xg.json e BigOdds-tests-xg.txt. Dados de referência incluídos em tests/xg-replay-data.json.

## Registo das versões anteriores

Ordenação publicada em 06/11/2026 às09:36UTC, versão45f7351f-30f8-47eb-a10b-c28ab1928388. Apenas apresentação: jogos Big Odds por kickoff/fixtureId, boletins históricos pelo primeiro jogo, cartões do histórico futebol por kickoff/fixtureId. Verificação pública:Big Odds19:00,19:30,19:45,20:00,20:00;histórico cronológico;hook histórico futebol presente.

Atualização visual 06/11/2026 09:16 UTC: histórico expandido mostra diretamente os cartões; sem cabeçalho ou odd duplicados. Casa incluída no resumo. Versão ff591f62-89af-4d25-9316-00ba18e384e1.

# Atualização visual — 06/11/2026,09:13UTC

Análise apenas por cartão. Prognósticos com o mesmo tamanho do futebol:17px móvel/18px desktop. Histórico fechado por boletim com estado,data,número de seleções/certas e odd total;expande todos os cartões. Mantém abertura e nós ao atualizar. Verificado em navegador real390px/1440px,sem overflow.30testes passaram.Sem mudanças de seleção/horário/dados. Versão8c26331f-8176-4aa7-83b3-504f841f2e3e.

# Atualização publicada — 06/11/2026, 08:53 UTC

Versão 6b66a1d5-6279-4236-9420-d8e19ec40eab; política bigodds-goals4-daily0800-v3.

Página simplificada. Análise recolhida do boletim e por cartão com as probabilidades, odds, golos esperados pelo modelo (não xG), amostras e hora. Sem contexto externo inventado. Usa stableDom do futebol, preservando cartões, emblemas e análises abertas. Faixas de seleção alinhadas; nomes limitados a duas linhas.

Geração apenas no cron das 08:00 de Lisboa, dentro dessa primeira minuta, sem recuperação tardia. Tentativa única por dia, com claim atómico em openfoot_state; sem migração. Boletim ativo na fronteira das 08h faz ignorar esse dia. Mesmo que perca depois, só há tentativa no dia seguinte. Os resultados continuam a ser atualizados durante o dia. Sem boletim elegível/falha: não tenta novamente nesse dia.

Horizonte: hoje, amanhã e D+2. Mantidos critérios estatísticos, odds8–15/5–12seleções, boletim atual e histórico. Não força diversidade de mercados.

48 testes passaram. Incluem 08h, DST, concorrência, boletim ativo/sem elegíveis, D+2/D+3 e liquidação durante o dia. Verificação real em navegador desktop1440px e móvel390px: sem overflow, faixas alinhadas, cartões/imagens/análises preservados ao atualizar. APIs futebol/histórico200;18 módulos remotos coincidem e bindings preservados.

A próxima execução real das 08h ainda não ocorreu após esta publicação; fronteiras e concorrência verificadas localmente. Ver BigOdds-publicacao-v3.json e BigOdds-tests-v3.txt.

## Registo da versão anterior

# LuxTips — Big Odds

Publicada com autorização explícita em 05/11/2026 às 17:46:57 UTC. Versão 8a21c85e-e63f-4deb-9068-be7a68a84126. Migração aditiva aplicada; verificadas página, API, Boletim, Histórico, futebol, PWA e redirecionamento NBA. Ver BigOdds-publicacao.json.
Base: versão Cloudflare 1c92a882-c3a6-4f9f-8927-14a9e0c41ca8, publicada em 05/11/2026 às 07:18 UTC, confirmada na API nesta sessão. O bundle do modelo de futebol não foi alterado. Não publicar o GitHub main antigo por cima desta versão.

## Comportamento

- Navegação Futebol / Big Odds / Como funciona. `/nba` redireciona para `/big-odds`; `/api/nba` devolve 410. Dados e Worker NBA mantidos, sem apagar histórico. Removidas as opções/avisos NBA da PWA e a recolha NBA no emissor de notificações existente. Não acrescenta notificações Big Odds nem reutiliza consentimentos NBA para outro serviço.
- Big Odds: Boletim e Histórico, cartões com emblemas, datas de Lisboa, prognóstico, odd por seleção, odd total, casa, resultado final e situação de cada seleção. Taxa por múltipla ganha/perdida; anuladas separadas. Paginação do histórico e estados de carregamento/erro/vazio.
- 5–12 seleções, odd total 8–15, uma casa por boletim e um mercado por jogo. Odds reais de API-Football, menos de seis horas; sem preços de combos estimados. Apenas mercados com identidade do fornecedor mapeada/verificada. Totais/BTTS exigem o par completo com o mesmo relógio; resultado/dupla hipótese exigem o trio 1X2 da casa. Mercados combo sintéticos dos estudos não entram em publicação.
- Horizonte de hoje e amanhã, calendário Europe/Lisbon. Publicação na hora real do ciclo, nunca reconstituída às 08h. Apenas jogos NS com mais de 60 segundos até ao início. A exceção para jogos já começados foi autorizada para a simulação local anterior, não para novos boletins públicos.
- Uma única múltipla ativa, protegida por índice único D1, inserção condicional e transação para boletim + seleções. Se houver corrida de publicação, nunca ficam duas ativas. Identidade/estado do jogo são revalidados no SQL da publicação.
- Nova múltipla apenas após a anterior ganhar, ficar anulada ou ter a primeira seleção definitivamente perdida. Um golo ou resultado provisório não fecha uma aposta de menos golos. Mesmo após uma perda precoce, os jogos restantes continuam a receber resultado no histórico.
- Um jogo já incluído num boletim não volta a entrar noutro, mesmo que ainda esteja por começar quando o anterior perde. A restrição é global por fixture_id, também entre ciclos concorrentes.
- Seleções, preços e análise publicados ficam imutáveis. A resolução só acrescenta estado/resultado. Divergências de identidade/marcador, reagendamentos e AET/PEN sem resultado confirmado aos 90 minutos ficam pendentes; não se inventa liquidação.

## Modelo e alteração da regra

Base goals4: Poisson, golos marcados/sofridos por equipa e papel casa/fora na liga, prior 4 e meia-vida de 180 dias. Usa os resultados históricos efetivamente presentes nas fixtures, incluindo os antigos que não têm entrada na tabela de liquidação de prognósticos; quando existem ambas as fontes, exige concordância. Dados disponíveis até ao ciclo, sem resultados do jogo alvo. Não usa xG nem Elo nesta candidata e não altera o modelo do separador Futebol.

Escolhe primeiro o sentido casa/fora pela análise; se o lado preferido ficar excluído pela odd mínima, não admite o lado contrário. A seguir escolhe o melhor mercado por jogo/casa e os prefixos até 12 jogos com odd 8–15, preferindo maior probabilidade conjunta do modelo. É uma heurística, não uma enumeração de todas as combinações. Nenhuma probabilidade conjunta é apresentada como taxa de acerto validada.

A versão sequencial v2 incorpora a correção do Milan e a restrição de não sobreposição. Portanto os 6/11 da procura retrospetiva não se aplicam automaticamente a esta política. O histórico público começa vazio; não importa as 11 múltiplas nem o ciclo reconstruído da manhã. Estratégia explicitamente em avaliação.

## Validação

`node --test tests/bigodds.test.mjs tests/daily-ranking.test.mjs`

23 testes Big Odds + 18 de regressão do futebol: transação/rollback, exclusão de jogos anteriores, fecho antecipado, todos ganhos/anulados, fontes futuras/divergentes, resultados AET, frescura das odds, correção do Milan, preços reais, unicidade por casa/jogo, histórico/paginação, rotas, cliente de boletim/histórico/erro, relógio Lisboa e ciclo completo com histórico sem ledger de prognósticos. Comparação numérica com o código Python goals4 original, tolerância 1e-11.

Ensaio de leitura em D1 em 05/11/2026, 17:39 UTC: 10 892 jogos históricos, 42 fixtures futuras, 8 444 recibos de odds e 3 347 candidatos; encontrou um boletim de 7 seleções, odd 8,12348, Betano. Não publicou nem apostou. A disponibilidade e os preços têm de ser recalculados no momento da publicação; esse boletim de ensaio não é uma recomendação atual.

Sintaxe e dependências relativas verificadas. Cliente executado em ambiente DOM simulado. Após publicação, verificação em Chromium remoto através da API Cloudflare Browser Rendering: desktop 1440 px e móvel 390 px, sete cartões, sem overflow horizontal e navegação/histórico funcionais. Primeiro boletim gerado pelo cron às 17:49 UTC: sete seleções, Betano, odd 8,33864859648, jogos de 5 e 6 de novembro. Todos ainda por começar na publicação; odds abaixo de seis horas. Ainda sem resultados finais Big Odds.

## Ativação quando autorizada

1. Confirmar que versão e módulos remotos continuam iguais à base guardada; preservar quaisquer alterações entretanto publicadas.
2. Aplicar a migração aditiva `migrations/0010_bigodds.sql`. Não altera tabelas futebol/NBA. Não aplicar novamente as migrações antigas incluídas para os testes.
3. Publicar a entrada `integration.js` com os módulos existentes e novos `bigodds.mjs`, `bigodds-model.mjs`, `bigodds-view.mjs`. Preservar bindings, segredos, namespace e metadata Containers/FootballRelay, cron e compatibilidade Cloudflare atuais.
4. Verificar futebol/API/histórico/PWA; `/nba` deve redirecionar; Big Odds/Boletim/Histórico devem responder. Aguardar o cron para gerar o primeiro boletim elegível, sem forçar preços ou jogos já iniciados.
5. Verificar no D1 no máximo um ticket ativo, preços/casa/jogos da publicação e ausência de jogos repetidos. A evolução de resultados exige acompanhar jogos reais; não alegar que já foi verificada.

Recuperação: repor apenas os módulos guardados em `bigodds-baseline/` na versão Cloudflare anterior preserva as tabelas e dados Big Odds para retoma. Não apagar tabelas nem histórico para reverter interface.
