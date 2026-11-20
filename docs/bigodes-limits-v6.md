# Bigodes — limites v6

## Estado

Alteração pedida e autorizada para publicação em 20/11/2026.
Publicada às 17:29:21 de Lisboa, com a migração 0012 aplicada e verificada.
Versão ativa: `9cf26958-ba8d-4e47-ab54-037ce2da0273`, a 100%.
Deploy: `f8a05410-62a9-45b3-b2f5-46872481b0aa`.
Código: `1dfdd0a91d14cc568a33559e0eed3e8d31b8988e`, integrado sobre a
main atual `f967ad0d18b0281e3e2e0e66091fdbd20397a942`.

A versão anterior era `9ce582f6-1f4f-47f5-9b18-6b2dcb96fb75`.
Os 29 módulos remotos coincidiam com a base do repositório antes da publicação.
Foram substituídos apenas os três módulos de modelo, otimizador e publicação;
os restantes 26 conservaram exatamente os mesmos SHA-256.

## Alteração de política

| Critério | v5 | v6 ativa |
|---|---:|---:|
| Odd total mínima | 8 | 2 |
| Odd total máxima | 15 | Sem máximo |
| Número mínimo de jogos | 5 | 2 |
| Número máximo de jogos | 12 | Sem máximo |

Identificador: `bigodes-quality-betano-v6`.
Otimizador: `exact-branch-bound-quality-v3`.
Objetivo: `max_legs_then_probability`, conforme clarificação do utilizador sobre
a inclusão de Lorient–Rennes quando os quatro jogos passam os critérios.
`maxOdd:null` e `maxLegs:null` representam a ausência de máximo, inclusive
nos snapshots e na API. Não são convertidos em outro teto fixo.

Mantêm-se a odd individual mínima 1,20, a probabilidade individual mínima 75%,
a referência Betano mínima 70%, a divergência máxima de 15 pontos percentuais,
a probabilidade conjunta mínima 20%, o retorno esperado individual não negativo
e o retorno esperado conjunto mínimo 3%. Continuam a ser exigidos preços reais,
evidência suficiente, relógios coerentes, uma seleção por jogo e equipas distintas.
As probabilidades, o modelo estatístico e a mistura modelo/Betano não mudaram.

O objetivo passa a ser incluir o maior número de jogos que respeite todos os
critérios individuais e conjuntos. Entre combinações com o mesmo número de
jogos, prefere-se a maior probabilidade conjunta estimada; em empate, a menor
odd e uma ordem estável das identidades. A pesquisa continua depois de atingir
dois jogos e odd 2. A probabilidade conjunta mínima 20% e o retorno esperado
conjunto mínimo 3% continuam a poder excluir uma extensão do boletim.
O orçamento de pesquisa mantém-se em um milhão de nós; uma pesquisa incompleta
continua sem permitir publicação.
Produtos de odds não representáveis como números finitos são rejeitados.
O mínimo total é verificado sobre o produto real, sem arredondar valores abaixo
de 2 para os tornar elegíveis.

Mantêm-se o horizonte de três dias, a geração às 08:00 de Lisboa e um boletim
ativo de cada vez. O seletor e os defaults antigos usados apenas nos testes
históricos conservam as regras da respetiva época.

## Persistência e histórico

`0012_bigodds_flexible_limits.sql` substitui a restrição SQL `8–15` por `odd>=2`.
Como SQLite não permite editar diretamente esse CHECK, a migração copia as três
tabelas Bigodes, preserva todas as colunas e relações, substitui-as numa transação
e recria os mesmos índices, triggers de imutabilidade e a view das seleções.
As chaves estrangeiras permanecem ativas.

A publicação verifica as identidades dos jogos com uma lista JSON e usa nove
parâmetros na instrução principal, independentemente do tamanho do boletim.
O boletim e todas as suas seleções são gravados em duas instruções na mesma
transação. A consulta dos horários também usa uma lista JSON.

As podas do otimizador usam um máximo otimista do número de jogos ainda possível,
calculado pelas melhores probabilidades restantes. Só se compara com a
probabilidade do melhor boletim quando já não é possível aumentar o número de
jogos. O objetivo histórico de máxima probabilidade permanece disponível para
reproduções explícitas, sem se aplicar às novas publicações v6.

## Reprodução da decisão de 20/11/2026

Fonte: snapshot D1 `bigodds:decision:6588625f-225f-488c-b91a-dbbc6cd2186d`,
com corte em `2026-11-20T08:00:00Z`. Foram usados os 600 candidatos originais,
sem obter odds posteriores nem alterar o registo da decisão.

| Data e hora de Lisboa | Jogo | Seleção | Odd do snapshot |
|---|---|---|---:|
| 21/11, 15:30 | NEC Nijmegen – PSV Eindhoven | Mais de 2,5 golos | 1,32 |
| 21/11, 20:00 | Telstar – PEC Zwolle | Mais de 1,5 golos | 1,23 |
| 22/11, 16:15 | Lorient – Rennes | Mais de 1,5 golos | 1,30 |
| 22/11, 17:30 | Osasuna – Málaga | 1X | 1,24 |

Resultado local: ótimo comprovado para o objetivo e os inputs, quatro jogos,
odd total `2.6172432`, probabilidade conjunta estimada `0.4077482142790559`
e retorno esperado estimado `0.06717624113400178`. Os quatro jogos
individualmente elegíveis entram na múltipla; a pesquisa terminou em nove nós.

A preparação inicial mantinha a maximização da probabilidade como objetivo
principal e escolhia três jogos, odd `2.013264` e probabilidade estimada
`0.5281604271171538`. Lorient–Rennes, com probabilidade individual estimada
`0.772015837128614`, era elegível, mas acrescentá-lo reduzia o produto das
probabilidades. A clarificação do utilizador altera essa prioridade, sem
alterar as estimativas ou abrandar os filtros. As probabilidades não representam
uma taxa de acerto observada.
Esta reprodução não é um boletim publicado nem uma confirmação das odds atuais.

## Verificação

- `npm run test:production`: 175 testes aprovados, zero falhas.
- `npm run build:check`: compilação e empacotamento aprovados com Wrangler
  4.151.3 e `--dry-run`, sem upload.
- Sintaxe dos três módulos alterados e `git diff --check`: aprovados.
- `npm run check:production`: 29 módulos com hashes íntegros e sintaxe válida,
  usando o manifesto atualizado após a confirmação remota.
- Cobertura dirigida: dois jogos, odd exatamente 2 e valores imediatamente
  abaixo/acima; odd acima de 15; pesquisa com 13 jogos; publicação/leitura com
  101 jogos; serialização dos máximos `null`; manutenção dos filtros de qualidade,
  rotina das 08:00, imutabilidade, identidade e atomicidade.
- Extensão para quatro jogos depois de atingir os mínimos; regressão dirigida
  à inclusão de Lorient; escolha da maior probabilidade entre boletins com o
  mesmo número de jogos; exclusão do oitavo jogo quando a probabilidade conjunta
  cai abaixo de 20%; comparação com enumeração independente em 40 conjuntos.
- Migração ensaiada localmente sobre uma cópia de leitura dos registos reais:
  nove boletins, 22 seleções legadas e 44 seleções posteriores. Todas as linhas
  permaneceram idênticas, com zero violações de chaves estrangeiras e integridade
  SQLite `ok`. SHA-256 antes e depois:
  `4d5fc670421b5ad06e2410f9d9a7a740f1e5805e48b902d85bfa6ac417ec3b91`.
- Testes de rollback após substituição das tabelas e de referências externas
  inesperadas preservam integralmente dados e proteções.
- Revisão independente do otimizador: 700 casos com os dois objetivos e
  576 668 combinações enumeradas; 88 casos adicionais nas fronteiras numéricas
  da probabilidade conjunta. Sem divergências nem bloqueios de publicação.

## Publicação verificada

A migração 0012 foi executada num único pedido D1 `/query`, com os 25 comandos
aprovados e transação implícita. Não existia tabela `d1_migrations`; o registo
da aplicação fica na evidência desta publicação, sem criar estruturas adicionais.

A comparação integral antes/depois confirmou nove boletins, 22 seleções legadas
e 44 posteriores exatamente iguais, bem como os 34 estados Bigodes. Mantêm-se
os índices, os seis triggers de imutabilidade, a view e as relações, com zero
violações de chaves estrangeiras. A restrição SQL ativa é `CHECK(odd>=2)`.
Hash canónico do histórico antes/depois nesta verificação:
`0ccd6c846ad1d7b503155f31844c2f2161cb1d971696e4a1da69b98f7af06994`.

O Worker foi publicado pelo endpoint de substituição exclusiva do conteúdo.
Os 29 hashes ativos coincidem com o código validado; as configurações,
bindings e agendamentos permanecem iguais. O cron continua a executar a rotina
existente, que gera o Bigodes às 08:00 de Lisboa.

A publicação não executou um ciclo extraordinário nem alterou a fronteira do
histórico público. A próxima seleção normal está prevista para 21/11/2026 às 08:00.

A API pública respondeu HTTP 200 com política v6, objetivo
`max_legs_then_probability`, mínimos 2 e máximos `null`. O boletim atual,
o histórico visível, o resumo e a fronteira do histórico permanecem iguais.
O feed continua sem boletim em curso e sem entradas posteriores à fronteira
pública existente; os nove boletins anteriores mantêm-se na base de dados.

Ver [evidência da publicação e hashes ativos](evidence/bigodes-limits-v6/release.json).

A página `/big-odds` também respondeu HTTP 200. Após o carregamento com
JavaScript, mostrou o título Bigodes, o estado atualizado às 17:30 e
«Sem boletim em curso», sem mensagens de erro. A verificação pública aprovou
os 15 critérios definidos para esta publicação.
