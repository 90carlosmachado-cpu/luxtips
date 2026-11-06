# Auditoria operacional LuxTips — 6 de novembro de 2026

Verificação realizada aproximadamente entre 16h59 e 17h06 UTC (Lisboa). Versão ativa: `655bd887-860b-4870-b5cf-b6df30a4ea32`; commit de referência: `16dc675`.

## Conclusão

O site e os processos automáticos estavam operacionais durante a inspeção. Foram identificadas três fragilidades reproduzíveis em cenários de atraso, reagendamento e rede sem resposta. Nenhuma se manifestava no boletim ativo durante esta auditoria. Não se recomenda considerar a operação completamente fechada antes de resolver estes cenários.

Auditoria em leitura na produção: sem alterar prognósticos, probabilidades, odds, subscrições, resultados ou horários; sem novo ciclo manual, migração ou deploy. Testes e reproduções executados localmente.

## Achados por prioridade

### 1. Prioridade alta — o ciclo geral pode fazer perder a janela diária Big Odds

Referências: `production/integration.js:327–336`, `production/bigodds.mjs:113–140` e `:171–174`.

A integração aguarda a recolha e o cálculo de futebol e sincroniza a lista antes de chamar `syncBigOdds`. A função só aceita executar/publicar durante o minuto das 08:00 de Lisboa. Às 08:01, mesmo que o evento tenha sido agendado para as 08:00, já devolve `outside_daily_window`. Se o cálculo ultrapassar o minuto após reclamar a tentativa, pode devolver `daily_window_expired` sem deixar um resultado terminal atualizado na chave diária.

Evidência: a telemetria das últimas 24h incluía um ciclo agendado com duração de 87 400 ms. A reprodução local confirmou que um evento das 08:00 processado com esse atraso já não tem uma janela válida. Os testes existentes também confirmam que a publicação após o minuto é recusada. Isto demonstra a fragilidade, não prova que tenha falhado uma publicação real às 08h.

Impacto: num dia sem boletim ativo, um atraso técnico pode deixar o dia vazio apesar de existirem candidatos elegíveis. O boletim atual mantém-se válido.

Recomendação: separar a decisão das 08h da manutenção lenta, preservar um snapshot/corte temporal das 08h, registar o estado terminal da tentativa e permitir recuperação técnica idempotente dessa mesma execução. A recuperação não deve escolher dados de uma hora posterior nem gerar dois boletins. Não é necessário alterar os mercados, probabilidades ou critérios.

### 2. Prioridade média — um jogo reagendado pode manter o boletim ativo indefinidamente

Referência: `production/bigodds.mjs:54–75`.

A liquidação compara o horário atual do jogo com o snapshot e ignora a seleção se o horário mudou. Esta proteção evita usar resultados de uma identidade temporal diferente, mas não existe neste fluxo uma saída operacional automática ou um estado específico de revisão. Mesmo depois de o jogo reagendado terminar, a seleção pode continuar pendente e manter o boletim ativo.

Evidência: reprodução local com cinco seleções, quatro ganhas e uma reagendada já terminada com resultado confirmado. Depois de `settleBigOdds`, ficaram uma seleção pendente e o boletim ativo. Na produção atual: zero jogos do boletim ativo com horário diferente e zero seleções pendentes de jogos já terminados.

Impacto: se nenhuma outra seleção perder, o bloqueio de boletim único pode impedir novas gerações nos dias seguintes.

Recomendação: sinalizar reagendamentos e implementar uma resolução explícita segundo a regra aplicável da casa, preservando snapshot e identidade. Não resolver como ganho/perdido nem anular arbitrariamente.

### 3. Prioridade média — pedido de rede pendente bloqueia a atualização do separador Big Odds

Referência: `production/bigodds-view.mjs:49–54`.

O `fetch` do Big Odds não tem timeout explícito. Enquanto aguarda, `loading` fica verdadeiro; os disparos seguintes de atualização não fazem novo pedido. O `finally` só liberta o estado quando o pedido terminar ou falhar.

Evidência: execução do cliente com rede que mantém o pedido pendente; após dois disparos do temporizador continuava a existir apenas um pedido, sem `AbortSignal`. Falhas que rejeitam normalmente já têm tratamento; o problema é a ausência de resposta.

Impacto: a página pode continuar a apresentar informação antiga sem conseguir recuperar autonomamente, até a rede/navegador terminar o pedido ou a página ser recarregada.

Recomendação: timeout/abort no pedido e na leitura da resposta, libertação de `loading`, conservação dos cartões anteriores e repetição limitada com mensagem clara.

## Verificações aprovadas

| Área | Evidência observada |
| --- | --- |
| Código publicado | Os hashes dos 20 módulos remotos coincidem com o manifesto local. |
| Cron | Agendamento `* * * * *`, com atividade recente e listas sincronizadas. |
| Pipeline | Recolha de dados, contexto e recálculo com estado `ok`; sem falhas por jogo no último recálculo consultado. |
| Health | `/api/health`: HTTP 200, `ready=true`, origem válida, sincronização recente. |
| Locks | Sem locks operacionais presos; cooldown antigo do fornecedor já expirado. |
| Quotas | API-Football: 966 chamadas na leitura das 17h00, abaixo de 6000/dia; dias anteriores consultados entre 994 e 1635. Os contadores continuam a evoluir. |
| Odds prioritárias | Os 12 jogos futuros únicos publicados entre futebol/Big Odds tinham estado de recolha `ready`; exemplos recentes renovados nos minutos anteriores. Isto é consulta ao fornecedor, não garantia de alteração do preço na origem. |
| Futebol | Quatro prognósticos apresentados, todos Betano e com preços `ready`; três em 07/11 e um em 08/11. Nenhum dia futuro com mais de três lugares técnicos. |
| Bloqueio | Lista de hoje bloqueada; amanhã e D+2 ainda desbloqueados. Testes cobrem fronteira das 08h, concorrência e preservação de seleções bloqueadas. |
| Publicação pré-jogo | Zero publicações correntes com `published_at >= kickoff`. |
| Histórico futebol | 42 entradas: 38 resolvidas e quatro pendentes; zero duplicados no feed e zero resultados em falta nas entradas resolvidas. |
| Resultados | Zero jogos não terminados há mais de três horas nos últimos sete dias, excluindo estados de adiamento/suspensão/cancelamento. |
| Big Odds | Exatamente um boletim ativo, nove seleções; histórico visível só com o boletim atual, conforme reset. Preços apresentados Betano, total observado 9,49508559. |
| Preservação do boletim | O snapshot original do atual é anterior à mudança para Betano e mantém a casa original; a apresentação atual usa recibos Betano. Isto é esperado, não uma troca de origem silenciosa. |
| Liquidação atual | Zero seleções pendentes de jogos terminados e zero divergências de horário no boletim ativo. |
| Interface | Futebol a 1440 e 390 px; Big Odds a 390 px; sem overflow horizontal nos estados verificados. |
| Navegação | Dias com contagens, histórico de futebol com 42 cartões, análises abrem, histórico Big Odds abre e mostra estado vazio correto. |
| Ordenação | Cartões de futebol e nove seleções Big Odds por data/hora. A API Big Odds preserva ordem do snapshot; o cliente faz a ordenação de apresentação corretamente. |
| Estabilidade | Análise aberta e nó do cartão Big Odds preservados depois de atualização em segundo plano. |
| Logos | Seis imagens dos três jogos de amanhã carregadas na verificação móvel de futebol; sem imagens quebradas no estado inicial Big Odds consultado. |
| APIs | `/api/games`, `/api/history`, `/api/big-odds`, configuração push, manifest e service worker responderam 200. |
| Erros de entrada | Cursor inválido/fora do formato no Big Odds: 400; API NBA retirada: 410. |
| Administração | Endpoints de recálculo e OpenFoot sem autenticação responderam 401, sem executar operações. |
| Push | Configuração ativa; uma subscrição; último ciclo sem falhas; zero entregas com cinco tentativas esgotadas na consulta. Nenhum aviso antigo disparado pela migração. |
| Cache PWA | Dados/API não são guardados para apresentar prognósticos antigos offline. O service worker usa rede e página offline própria. |
| Testes | 129 históricos + 84 de produção = 213 passaram; zero falhas. Sintaxe, hashes e compilação sem publicação passaram. |

## Telemetria e desempenho

Na amostra de telemetria das últimas 24h, os ciclos agendados observados tiveram resultado `ok`; não apareceram exceções/limites de CPU nos grupos retornados. Houve um grupo de pedidos HTTP cancelados, que não permite atribuir causa ao servidor. A observabilidade está amostrada a 10%; contagens devolvidas podem ser extrapoladas e ausência de erros na amostra não prova ausência absoluta de erros.

Máximos observados: ciclo agendado com 87,4 s de duração e 1,863 s de CPU (não necessariamente a mesma invocação). Pedidos públicos medidos nesta auditoria: aproximadamente 0,84 s Big Odds, 0,99 s futebol e 1,69 s histórico, sem teste de carga. O histórico devolveu cerca de 366 mil caracteres para 42 entradas; convém acompanhar o crescimento e considerar paginação/projeção de campos se aumentar.

A base D1 tinha aproximadamente 2,04 GB. Não há indicação de falha de armazenamento na consulta; não foi realizada limpeza, `VACUUM` ou verificação integral onerosa da base.

Havia um registo recente de importação histórica com `ambiguous_penalty_event`; o último sync estava `ok`. Trata-se de rejeição conservadora de dados ambíguos, não de prova de avaria do site ou dos prognósticos publicados.

## Limitações

- Esta auditoria não mede nem valida a qualidade preditiva do algoritmo; mantém-se fechado e inalterado.
- A nova política de notificações foi publicada após as 08h de hoje. Está coberta por testes e o cron novo já correu, mas não se observou ainda uma entrega real do próximo resumo diário no iPhone do utilizador. Não foi enviado push artificial.
- Os riscos de reagendamento e de rede pendente foram reproduzidos localmente; não estavam a ocorrer no boletim atual.
- O histórico Big Odds não tinha boletins resolvidos visíveis; expansão/paginação de boletins antigos é coberta por testes locais, não por uma demonstração com dados reais após o reset.
- Verificação do navegador por DOM e estado; não é um ensaio em todos os modelos de telemóvel nem uma auditoria de acessibilidade ou de segurança exaustiva.
- Sem alterações de produção, commits ou push nesta auditoria.

## Próximo passo recomendado

Corrigir os três casos de recuperação operacional, por esta ordem, acrescentando testes das falhas reproduzidas e verificando em produção. Preservar o algoritmo, as seleções existentes, a regra de boletim único, os relógios de origem e as publicações imutáveis.
