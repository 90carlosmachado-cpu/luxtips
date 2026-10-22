# Contexto em produção — 22-10-2026

Ativação pedida explicitamente pelo utilizador, sem fase comparativa.
Versão final: `luxtips-events-xg-live-v2`. Nenhum compromisso de maior taxa de acerto.

O utilizador delimitou o âmbito final: expulsões, evolução do marcador,
lesões/onzes, xG sem penáltis e por bolas paradas. Pressão, progressão de bola e
qualidade pós-remate são objeto de auditoria de cobertura. Descanso e efeitos
numéricos individuais de jogadores deixaram de integrar a versão ativa.

O cálculo conserva força ofensiva/defensiva, adversários, fator casa, mistura
temporal e xG. Jogos com expulsões confirmadas são excluídos do ajuste de força.
Uma amostra recente completa permite ajustar separadamente xG de jogo corrido
e de bolas paradas, retirando penáltis. O efeito do marcador usa taxas empíricas
por estado empatado/a ganhar/a perder e exposição em minutos, com fatores
limitados a 0,75–1,25. Os dois modelos sem penáltis são somados, acrescentando a
taxa observada de golos de penálti da liga para voltar à previsão de golos totais.
O detalhe entra com peso amostraEfetiva/(amostraEfetiva+40), limitado a 35%.
São aproximações observacionais não calibradas prospetivamente, ativadas por
pedido explícito. Não confundir estes limites com coeficientes demonstrados.

O detalhe exige >=30 jogos completos na liga, >=12 jogos limpos por equipa,
amostra efetiva >=12 e observação recente até 45 dias. O xG total usa agora peso por equipa: até 50%, multiplicado pela
fração de amostra até 12 jogos e cobertura até 70%, com redução para dados
mais antigos que 45 dias e exclusão após 90 dias. Só observações com identidade,
resultado e relógios reconciliados entram. A ausência numa equipa não desativa
o xG da outra; jogos sem observações não recebem xG inventado. Os acontecimentos têm de reconciliar o
marcador final e os penáltis têm de corresponder a remates identificados. A ordem
dentro do mesmo minuto permanece desconhecida salvo um remate de golo
inequivocamente associado ao acontecimento. A parte ambígua fica sem correção.
Os jogos com dados incompletos conservam o modelo de xG total disponível.

Lesões e onzes são informação contextual com relógio de origem, visível na
estrutura já usada pelo site. Um onze confirmado prevalece sobre um boletim
contraditório. Não há nesta versão quantificação causal do impacto individual
de uma ausência, nem probabilidades inventadas de disponibilidade.

Odds: conservar casa, mercado, seleção, relógio do fornecedor e primeira recolha.
O consenso 1X2 retira a margem dentro de cada casa e instante; não juntar
cotações de casas diferentes para retirar uma margem fictícia. A primeira e
última cotação observada não são apresentadas como abertura/fecho oficiais.
A publicação exige odd >=1,25, odds reais recentes, os limiares de probabilidade
existentes, e pelo menos 3% de retorno esperado depois de descontar a maior
divergência entre os componentes temporais. Esta reserva não mede todo o erro
nem constitui intervalo estatístico de confiança.

Recolha: API-Football existente, cache com relógio explícito,
máximo de 10 pedidos por execução e 1500/dia, dentro do orçamento global de
6000/dia, inferior ao Pro de 7500/dia. Nenhuma nova subscrição de dados ou chave.
Workers Paid foi ativado pelo utilizador. O transporte final é um Container
Cloudflare `lite`, ligado ao Durable Object `FootballRelay`. A chave é fornecida
apenas no ambiente de execução do Node, sem a incluir no código, imagem ou URL.
O relay só aceita os endpoints desportivos necessários, não segue redirecionamentos,
preserva os cabeçalhos reais de limites e desliga após 60 segundos de inatividade.
A imagem gerida `cloudflare/debian-trixie` evita Docker local e dependências novas.
Gate global com intervalo de 1,2 segundos e lease da sequência completa; backoff
do fornecedor respeitado. Consumo de Containers segundo as franquias do Paid e
eventuais excedentes. O ensaio Browser Run não é o transporte ativo.
Cron por minuto: dados, contexto e cinco cálculos sequenciais. Nenhum pedido
público inicia tarefas em background que dependam do limite HTTP de 30 segundos.
A auditoria avançada fica limitada a uma tentativa diária para não atrasar onzes.
Falhas individuais de endpoints avançam a fila e voltam no ciclo seguinte;
limites partilhados preservam o cursor e respeitam backoff. XG mantém orçamento e cobertura:
>=12 jogos, >=70% do histórico de três anos, observação recente até 45 dias.
Uma importação manual separada recolhe os últimos 20 jogos disponíveis de cada
equipa atual, com remates e acontecimentos. Os totais originais são preservados;
detalhes novos são acrescentados a `openfoot_match_details`, sem reescrever
observações anteriores ou fingir que foram recolhidos no passado. Novos jogos
recolhem xG e acontecimentos pelo importador normal.

Limitações que permanecem: encaixe tático completo, pressão/progressões,
post-shot xG, meteorologia e estado real
do relvado, viagens/altitude, qualidade causal de jogadores, cenários
probabilísticos fiáveis de minutos e regras específicas de eliminatórias.
Não se afirma ter implementado integralmente o sistema ideal do texto.
Ausência de dados permanece explícita nos riscos e metadados.

Tabelas aditivas `openfoot_context_*` e `openfoot_market_quotes`, com
triggers de imutabilidade e limites pré-jogo. Recalcular caches/previsões
operacionais está autorizado; conservar os ledgers de publicação originais.
A recolha comparativa de xG é desativada em modo live.

Estado protegido: `GET /api/admin/openfoot?context=1`. A auditoria por liga em
`openfoot_coverage_audit` distingue campos numéricos reais de ausências, erros
de acesso e aproximações. Uma resposta limitada por quota não prova ausência de
uma métrica. Remates, posse, passes e defesas não equivalem às métricas avançadas.

Métricas próprias
Brier/log loss apenas para previsões realmente registadas antes do início,
sem comparação de modelos. Não herdar métricas do modelo antigo como evidência
do modelo contextual. Reversão: desativar `PREDICTION_CONTEXT_MODE` e
`OPENFOOT_MODE`, preservando todos os dados.

## Seleção independente de mercados — correção autorizada

`context/selection.mjs` avalia cada mercado de forma independente do favorito
1X2. Mantém 60% para vitórias, 70% para alternativas, amostra efetiva >=12, odd
>=1,25, odds de idade <6h e EV conservador >=3%. A divergência é agora calculada
para o próprio mercado, incluindo mercados adicionais de golos. A seleção usa
a maior probabilidade conservadora, depois EV, com até três jogos por dia e
uma seleção por jogo. Várias alternativas são permitidas; handicaps continuam
excluídos por não haver validação da convenção de sinal das odds do fornecedor.
Publicações existentes permanecem imutáveis. Nenhuma garantia de maior acerto.
