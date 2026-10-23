# Revisão de robustez e avaliação — 22-10-2026

## Comparação inicial e estado

Base: main `1fe4e4f293ad1295b16da769753ec902ede03aae`.
Em 22-10-2026, 20:52 UTC, HTML público igual ao da main, SHA-256:
`24b38e947e1d33f8750babd0d6dbbb0eb69487012ccbb73846d729508c07ecd4`.
Saúde pública: release v6, modelo contextual v2, política de mercados independentes.
A ligação administrativa foi reposta pelo utilizador. V7 publicada às 21:19 UTC,
com autorização explícita, deployment `4404f1b4-f523-4519-96a0-460bb212032b`.
Módulo remoto idêntico ao build local (508407 caracteres, FNV-1a64
`1cfbfef08f58574a`). Bindings/segredos/relay preservados; sem migrações novas.
A main GitHub continua na base indicada; esta revisão não tem commit/push.

## Publicação e pendentes

O veto global de `missingCurrent` foi substituído por prontidão por dia em
`readiness.mjs`. O primeiro pendente inicia uma espera máxima de 15 min, que não
se prolonga por novas falhas. Outros dias continuam independentes. Com o conjunto
pronto, ou terminado o prazo, ordenam-se os candidatos armazenados desse dia,
independentemente do lote ou da ordem do chamador. Depois do prazo, os ausentes
continuam pendentes. Recuperações só ocupam vagas, sem substituir publicações.
Não se garante que um jogo indisponível até ao prazo não fosse melhor: esta
limitação é explícita, em vez de bloquear indefinidamente toda a janela.

Falhas por jogo são isoladas e registadas. Entradas antigas sem o contrato de
seleção atualizado aguardam recálculo. Bulk não é um veto global. Foram removidas
as truncagens aos primeiros 150 jogos no cálculo/conjunto de publicação.

`policy.mjs` centraliza amostra, probabilidade, preço, fonte, identidade, mercado,
relógios, divergência e EV. O caminho legado de publicação delega no atual. Lease
própria e INSERT condicionado protegem repetições/concorrência. Alternativas
suplementares antigas contam para a capacidade. As tabelas e os triggers de
arquivo/revisões/publicações não foram alterados.

Preservado: Lisboa hoje +2 dias; três jogos/dia; uma seleção/jogo; várias
alternativas; 60% vitória/70% alternativa; amostra 12; odd 1,25; idade <6h; EV >=3%
após divergência do próprio mercado. Sem depender do favorito 1X2 nem forçar vagas.
Divergência entre componentes não é intervalo estatístico de confiança.

## Odds

`odds.mjs` distingue `incomplete_response`, `market_unavailable`, `quote_expired`
e `temporary_failure`. Uma página por trabalho; continuações alternam com trabalhos
normais sem acrescentar pedidos por ciclo. Algumas odds recentes não fazem passar
uma resposta parcial por completa. Os caches antigos sem prova de paginação
completa não impedem uma recolha verificada.

Uma ausência relevante tem uma tentativa adicional após 15 min; ausência repetida
fica em cache até 3h. Falhas transitórias aguardam 5 min e respeitam também o
cooldown global. Uma cotação prestes a expirar antecipa o próximo trabalho.
Nenhuma tentativa renova a hora original de preços antigos. Receção da resposta
e início do pedido são relógios distintos. Odds recebidas durante uma chamada
são avaliadas no momento de conclusão.

Validam-se nomes exatos, seleção, casa, fixture e relógios. Não se usam odds
inferidas de probabilidades, de outros jogos ou de mercados parciais. Registam-se
os candidatos observados e o preço exato de cada publicação, evitando duplicar
todas as linhas de todas as casas. Cache, quotas e gate existentes mantêm-se.

## Protocolo estatístico antecipado

Contrato `prospective-inputs-v1`; política `first-valid-final24h-v1`.
Modelo v2 e pesos mantidos. Snapshots antigos sem o contrato não são usados para
simular o passado, mesmo quando têm o nome v2.

- Previsões: primeira previsão válida nas últimas 24h, por jogo/início/versão.
  Recálculos posteriores nunca substituem a observação escolhida.
- Publicadas: primeira seleção realmente publicada por jogo/início/versão, no
  snapshot imutável próprio; não precisa de estar no horizonte 24h. Arquivar não
  apaga a existência histórica de uma publicação para avaliação.
- Só resultados FT com identidade/início reconciliados. Adiamentos, novos
  adversários e extra-tempo/penáltis não são tratados como FT.
- Registam-se hash de entradas, contagem do treino, versão/cutoff e máximos de
  disponibilidade de histórico, fixture, xG, detalhes e contexto. O snapshot inclui
  features/estimativas e odds utilizadas, sem copiar integralmente todo o arquivo.
  Disponibilidade desconhecida ou posterior ao cutoff exclui a avaliação.
- Referência passiva: frequência histórica de cada evento na competição, calculada
  apenas com jogos terminados/disponíveis antes do cutoff e guardada com a previsão.
  Não altera recomendações nem é reconstruída depois de conhecido o resultado.
- Brier e Log Loss são binários por mercado, incluindo H, D e A separadamente;
  não são a soma multicategoria 1X2. Log Loss limita numericamente probabilidades
  a [1e-15,1-1e-15]. Calibração: dez intervalos fixos, média prevista, frequência
  observada, n e ECE. Amostras pequenas não fundamentam afinação automática.
- Agrupamento por mercado e competição, sempre com n. A comparação tem subconjunto
  emparelhado explícito, com as mesmas partidas/instantes nos dois lados. Uma
  referência incompleta não é comparada à média de um universo diferente.
- ROI exige preço original, casa, mercado e observação pré-publicação/pré-início,
  odd >=1,25 e idade <6h. Uma unidade teórica por seleção; não são apostas executadas.
  Não se estimam odds históricas em falta.

O trabalho existente de resultados atualiza um resumo interno no máximo uma vez
por 24h quando há novas liquidações. Diagnóstico protegido atualizado a pedido.
Âmbito explícito: 2000 jogos liquidados com snapshot canónico e 2000 publicações
recentes; o limite acompanha o relatório. Resumos são cache operacional; snapshots
e publicações continuam imutáveis. Não há novo fornecedor, tarefa agendada ou
serviço pago, nem aumento de limites. Consumo real não foi medido em produção.

## Interface e verificação

Mantém cartões simples. Sem seleções distingue análise concluída/atualização por
dia; dias sem jogos ficam concluídos. Erros técnicos não são interpolados na página.
Ordenação e histórico aceitam alternativas sem `winnerTip`. Histórico identifica
modelo atual/anterior. Não se apresentam estudos antigos como evidência atual,
tabelas técnicas de comparação ou percentagens de confiança inventadas.

75 testes locais, incluindo 21 cenários novos: falhas parciais, prazos, ordem,
recuperação, concorrência, repetições, imutabilidade, odds paginadas/expiradas,
retentativas, relógios, EV em todos os caminhos e avaliação sem dados futuros.
O script real da interface foi executado com DOM simulado. Leases/INSERTs foram
exercitados em SQLite local; não é uma validação distribuída do D1 remoto nem
um teste de navegador/dispositivo. Executar também `npm run check` e compilação.

Não validados: carga distribuída prolongada, consumo medido e desempenho
estatístico futuro. Não há novas migrações,
dependências, subscrições ou alterações ao bundle original recuperado.

Referências: [D1 e atomicidade](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[calibração e scoring](https://scikit-learn.org/stable/modules/calibration.html),
[API-Football](https://www.api-football.com/documentation-v3).

A publicação volta a validar preço/relógios no instante real de escrita. O INSERT
usa também o relógio SQLite e o estado/identidade atuais do jogo para rejeitar
mudanças entre ordenação e publicação. Caches antigos sem recibo verificado não
são promovidos a preços auditados: só a recolha verificada habilita novas seleções.
O adaptador de fixtureOdds também converge nesta recolha, sem vias alternativas
que renovem artificialmente o instante de observação de respostas em cache.

## Verificação após publicação

32/32 jogos futuros recalculados. Recolha real em todos: 13 ready e 19 com
odds expiradas no fornecedor, sem falhas temporárias. Hoje/amanhã concluídos;
sábado aguarda odds com prazo máximo até 22:34:25 de Lisboa, sem bloquear
outros dias. Cinco seleções existentes mantidas (duas sexta, três sábado).
64 snapshots com contrato prospetivo válido e zero clocks após o início;
avaliação nova ainda sem jogos liquidados. Interface real verificada no Edge,
sem erros de consola. Agenda de minuto a minuto e bindings confirmados.
Acesso temporário de manutenção revogado, rotas protegidas devolvem 401.
Não foi feito commit/push desta revisão.
