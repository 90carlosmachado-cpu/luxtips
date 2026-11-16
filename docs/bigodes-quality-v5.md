# Bigodes — qualidade da seleção v5

## Estado

Correção implementada e validada localmente em 16 de novembro de 2026, sobre o
GitHub `main` em `5572c324dbaac27f88c9458236db295d5ded0226`, no ramo
`fix/bigodes-quality-20261116`. O titular autorizou explicitamente, em 16 de
novembro, o commit e push, a publicação e o arquivo do boletim ativo, preservando
o histórico. Publicação confirmada às 08:58 de Lisboa, versão Cloudflare
`9ce582f6-1f4f-47f5-9b18-6b2dcb96fb75`, com 100% do tráfego. Código sincronizado
no GitHub em `2aeb28b1728a6db27bfd7718148b92c0f31af0d7`.

Política nova: `bigodes-quality-betano-v5`. A versão anterior era
`bigodds-exact-ev-betano-v4`. O manifesto foi atualizado após confirmar os hashes
dos 29 módulos ativos, todos idênticos ao código validado.

## Problema corrigido

O seletor anterior otimizava corretamente o produto das probabilidades, mas
admitia seleções com 50%, sem mínimo conjunto independente do retorno esperado.
O modelo das seleções usava médias por competição e condição casa/fora, sem
ajuste à força dos adversários nem partilha do restante histórico oficial.
Consequentemente, a otimização podia ser exata e a confiança dos inputs estar
sobreavaliada. O boletim de 16 de novembro foi reproduzido a partir dos candidatos
guardados às 08:00, sem alterar dados ou cotações.

## Modelo das seleções

`production/bigodds-strength.mjs` ajusta forças ofensivas e defensivas partilhadas
por equipa, considerando os adversários e o ambiente de golos de cada competição.
Usa Mundial, Europeu, Nations League e qualificações oficiais disponíveis
(`1,4,5,32,960`). Amigáveis, resultados posteriores ao corte, valores em falta e
resultados finais de prolongamentos/penáltis não entram como resultados de 90 minutos.

A regularização é oito e a meia-vida temporal 365 dias, fixadas antes da avaliação.
O historial cobre até três anos. Não há ajustes escolhidos para fazer entrar as
seleções de hoje. Duplicações não contam duas vezes e identidades/resultados
contraditórios excluem o jogo. Ausência de histórico não gera probabilidades
publicáveis a partir das médias da competição.

O campo legado `neutral` podia significar apenas estádio desconhecido. Agora só
`neutralVerified` permite considerá-lo confirmado. Torneios finais do Mundial e
Europeu usam um pressuposto explícito de neutralidade, salvo confirmação contrária;
preserva-se também a regra já existente para a fase final da Nations League.
Isto não afirma conhecer o local real nem o efeito de país anfitrião.

Os clubes mantêm o cálculo de golos/xG anterior, com validação adicional da
evidência. A alteração de força por adversário foi validada para seleções, sem
atribuir essa melhoria estatística às restantes competições.

## Política de publicação

| Critério | v5 |
|---|---:|
| Odd total | 8–15 |
| Seleções | 5–12, uma por jogo, sem repetir equipas |
| Probabilidade individual usada na seleção | ≥75% |
| Referência Betano sem margem | ≥70% |
| Diferença absoluta modelo–referência | ≤15 pontos percentuais |
| Probabilidade conjunta estimada | ≥20% |
| Preço | Betano verificada, nunca estimado |
| Mistura | 50% modelo + 50% referência Betano |
| Retorno esperado individual | ≥0% |
| Retorno esperado conjunto | ≥3%, conservado como validação adicional |

Os limiares são decisões explícitas de política de risco, não intervalos de
confiança calibrados. O mínimo conjunto de 20% é aplicado ao produto das
estimativas sob independência; não significa uma taxa observada de um acerto
em cinco. Com odd mínima oito, já implica retorno estimado de pelo menos 60%,
pelo que a condição adicional de 3% é matematicamente redundante nesse âmbito.
É uma política exigente e pode deixar vários ciclos sem boletim.

Evidência mínima: oito jogos e peso temporal acumulado quatro por equipa. Nas
seleções, o último jogo oficial deve ter até 180 dias. Nos clubes, até 90 dias,
com pelo menos três jogos e peso um na condição casa/fora usada pelo modelo.
Os relógios do modelo, dos resultados e dos preços são verificados. Uma cotação
de dupla hipótese deve ter o mesmo relógio do trio 1/X/2 usado como referência.

Os critérios são reaplicados no publisher antes de qualquer escrita. Ter uma
odd atrativa não permite contornar qualidade individual, amostra ou mínimo conjunto.
O otimizador continua a preferir maior probabilidade conjunta entre as combinações
admitidas; não muda de lado apenas porque o preço do lado favorito é baixo.

## Resultado no boletim de 16 de novembro

Replay com os relógios reais e os 216 candidatos da decisão original:

| Seleção anterior | Estimativa anterior | Estimativa nova |
|---|---:|---:|
| Bósnia–Roménia, 1X | 82,4% | 66,7% |
| Polónia–Suécia, 1X | 76,1% | 70,0% |
| Macedónia do Norte–Eslovénia, +1,5 | 72,1% | 64,7% |
| Hungria–Irlanda do Norte, X2 | 66,2% | 56,1% |
| Ucrânia–Geórgia, X2 | 65,7% | 54,4% |

As amostras passam de cinco/seis jogos na condição para 16–22 jogos oficiais
por equipa. As cinco seleções são rejeitadas por qualidade, não por falta
artificial de histórico. Um jogo passa os critérios individuais e não existe
boletim elegível. A versão nova não substituiria os jogos por escolhas mais
arriscadas para completar a odd.

Este é um replay local. A operação autorizada de arquivo e o novo ciclo têm
verificação própria, sem alterar os dados usados nesta reprodução.

## Validação

- `npm run test:production`: **157 testes aprovados, zero falhas**.
- Subconjunto de Bigodes/modelo/qualidade/integração: **77 testes aprovados**,
  incluídos nos 157, sem contar duas vezes.
- Verificação independente do otimizador contra enumeração completa em 40
  conjuntos com o mínimo conjunto e os novos filtros.
- Verificação SQLite do caminho nacional, com os 717 resultados reais,
  incluindo competições oficiais e conversão de booleanos.
- Compilação Wrangler **4.151.3** com `deploy --dry-run`: aprovada, sem publicação.
- Sintaxe dos módulos alterados e `git diff --check`: aprovados.

Foram preservados o boletim único ativo, a geração às 08:00 de Lisboa, a
liquidação dos resultados, os snapshots imutáveis, a reutilização apenas após
substituição autorizada e o funcionamento do Telegram. A falha anterior do
harness de UI foi corrigida fornecendo os helpers reais já presentes na página.
Após recuperar o runtime ativo, o harness de ranking recebeu também os três
símbolos reais da Nations League que esse runtime importa. Nenhuma asserção foi
alterada. A suite completa voltou a passar os 157 testes sobre estes bytes finais.

Na análise visual do Bigodes, o número principal passa a ser a probabilidade
usada na decisão, rotulada corretamente; o valor do modelo puro fica separado.
As amostras nacionais são identificadas como jogos oficiais, sem as confundir
com amostras exclusivamente em casa ou fora.

## Evidência estatística e limites

O estudo cronológico emparelhado está em
`research/bigodes-quality-20261116/README.md`, com dados, previsões e hashes.

Nos 142 jogos da Nations League de 2026, o Brier 1X2 passou de 0,624659 para
0,562967 (redução de 9,9%) e o log loss de 1,038271 para 0,949218 (redução de
8,6%). Os parâmetros não foram ajustados aos resultados desse período.

Isto não é um aumento de 9,9 pontos percentuais na taxa de acerto. É menor erro
das probabilidades do modelo. Ambas marcam/não marcam regrediu ligeiramente,
de Brier 0,240587 para 0,241002; o relatório inclui também esse resultado.

683 dos 717 resultados foram importados mais de um dia depois do jogo. A
avaliação histórica é uma reconstrução por evento, com resultados disponíveis
em início+duas horas apenas numa cópia de investigação. O runtime conserva os
relógios reais. Sem odds históricas contemporâneas válidas, não foi demonstrada
a taxa de acerto de múltiplas, a calibração da mistura 50/50 ou rentabilidade.

Reprodução offline:

```sh
node scripts/validate-bigodes-quality.mjs
npm run test:production
```

## Publicação autorizada

O preflight confirmou a versão ativa `610ad941-f018-484c-8b6c-2a53ae59b0be`,
com 27 módulos. Os quatro módulos alterados pelo Bigodes correspondiam exatamente
à base Git. Três módulos já publicados divergiam do repositório e foram recuperados
sem alterações: `production-worker.mjs` (integração da Nations League),
`football-list.mjs` (guarda de identidade) e `front-office.mjs` (nova linha final).
Essa sincronização evita perder código que já estava em produção.

A publicação usa a substituição de conteúdo, preservando configuração e todos
os módulos alheios à correção. São alterados quatro módulos e acrescentados dois.
Não foi necessária migração de esquema. A versão ativa e os hashes remotos foram
confirmados antes da atualização do manifesto.

O deploy por si só conserva o boletim ativo. O arquivo e o novo ciclo autorizados
usam `bigodds:manual_rebuild`, mantendo os snapshots e resultados originais.
O histórico não é reiniciado e só haverá nova múltipla se existir uma combinação
elegível. O arquivo não edita nem apaga cartões já enviados ao Telegram.

## Confirmação operacional — 16 de novembro, 09:06 de Lisboa

- Deploy `24191167-b0c0-4b50-8482-55a1ce0b7af0`, versão indicada acima, ativo a 100%.
- Nova execução independente da suite: 157 testes aprovados, zero falhas.
- Comando autorizado consumido pelo cron. O boletim
  `1cd1cf54-9b9e-48fe-ad29-e61689710e59` ficou arquivado como substituído.
- Resultado real do ciclo: `no_eligible_ticket`, um jogo e uma seleção elegíveis.
  A decisão usa `bigodes-quality-betano-v5`, com limites 75%/70%/15 pp/20%.
- Comparação com a cópia anterior à publicação: nove snapshots de boletins e
  66 snapshots de seleções preservados byte a byte. Os resultados dos restantes
  boletins e seleções e o início do histórico público mantiveram-se.
- Verificação da app: «Sem boletim em curso»; histórico com uma perdida,
  uma substituída e zero em curso. O boletim arquivado não entra na taxa de acerto.

Evidência verificável: `docs/evidence/bigodes-quality-v5/release.json` e
`production/manifest.json`. A próxima janela normal continua às 08:00 de Lisboa.
