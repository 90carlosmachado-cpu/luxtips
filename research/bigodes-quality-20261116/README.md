# Bigodes — validação do modelo de seleções

## Resultado

O modelo de ataque/defesa ajustado à força dos adversários reduziu o erro médio
das probabilidades 1X2 na reconstrução cronológica disponível. Isto valida uma
melhoria do modelo nesta amostra; não demonstra uma taxa de acerto futura de
múltiplas, rentabilidade ou calibração integral.

| Avaliação 2026 | Modelo anterior | Modelo novo |
| --- | ---: | ---: |
| Jogos Nations League emparelhados | 142 | 142 |
| Brier 1X2, soma das três classes | 0,624659 | 0,562967 |
| Log loss 1X2 | 1,038271 | 0,949218 |

A redução relativa foi de aproximadamente 9,9% no Brier e 8,6% no log loss.
Os intervalos de 95% para a diferença novo−anterior, obtidos por bootstrap de
18 dias de jogos completos, foram [−0,09385; −0,03017] e
[−0,13505; −0,04405], respetivamente. Estes intervalos dependem das hipóteses
do bootstrap; não são intervalos para a probabilidade de ganhar um boletim.

Em 120 desses jogos, ambas as equipas cumpriam os mínimos de oito jogos, peso
efetivo quatro e recência de 180 dias. A melhoria mantém-se nesse subconjunto:
Brier 0,620651→0,563829 e log loss 1,032964→0,950909. Os restantes 22 jogos
falharam a regra de recência de pelo menos uma equipa.

Os mercados 1X2, dupla hipótese e overs tiveram menor Brier nesta amostra.
Ambas marcam/não marcam tiveram uma pequena regressão: 0,240587→0,241002
no conjunto completo. Os resultados por mercado e bandas de probabilidade
estão em `results.json`, sem selecionar apenas os favoráveis.

## Protocolo

- 717 resultados oficiais disponíveis das competições 1, 4, 5, 32 e 960;
  excluídos amigáveis e resultados finais com prolongamento/penáltis.
- 2023 serve de aquecimento; 179 jogos Nations League de 2024–2025 constituem
  o período de desenvolvimento descritivo; 142 jogos de 2026 são a avaliação.
- Prior oito e meia-vida de 365 dias fixados antes de executar a avaliação;
  não houve procura de parâmetros nem escolha com base nos resultados de 2026.
- Previsão às 08:00 de Lisboa do dia de cada jogo. Só resultados com início
  mais duas horas anterior ou igual ao corte entram no treino. Jogos no mesmo
  dia usam o mesmo estado, sem conhecer os resultados desse dia.
- O modelo anterior usa apenas histórico Nations League e a versão histórica
  congelada `production/tests/fixtures/bigodds-model-before.mjs`.
- O candidato usa forças por equipa comuns aos jogos oficiais e ajustadas aos
  adversários. Os torneios finais Mundial/Europeu são tratados como neutros por
  pressuposto explícito, salvo confirmação contrária.

**Limitação de disponibilidade:** 683 dos 717 resultados foram importados mais
de um dia depois do jogo. A avaliação substitui os relógios apenas numa cópia
local de investigação por início+duas horas. É uma reconstrução por evento,
não uma alegação de que esses dados estavam disponíveis no sistema à data.

Não foram fornecidas odds históricas contemporâneas válidas. Assim, este estudo
não valida a mistura 50/50 com Betano, a seleção de boletins, a independência
entre jogos ou o retorno financeiro. As bandas de calibração têm amostras
limitadas; os intervalos de Wilson são aproximações binomiais. A dependência
entre equipas pode não ficar inteiramente refletida pelo bootstrap por dia.

## Verificação do boletim de 16 de novembro

O diagnóstico independente do snapshot das 08:00 usa os relógios de importação
reais. Com os controlos de risco em análise — probabilidade individual 75%,
referência de mercado 70%, divergência máxima de 15 pontos, probabilidade
conjunta 20%, odd 8–15 e cinco a doze jogos — apenas um jogo passa os filtros
individuais. Não há boletim elegível. Nenhuma publicação foi alterada.

Esses limites são decisões de política de risco, não percentagens empiricamente
garantidas nem limites inferiores de confiança. O mínimo de 20% é um critério
aplicado ao produto das estimativas do modelo sob a hipótese de independência
entre jogos; não é uma taxa calibrada de acerto. São matematicamente compatíveis:
o exemplo exclusivamente sintético de oito probabilidades de 82%, odds de 1,30,
modelo 89% e mercado 75% produz odd 8,157 e probabilidade conjunta 20,44%.
O exemplo não representa cotações reais nem uma recomendação de aposta.

## Reproduzir

```sh
node scripts/validate-bigodes-quality.mjs
```

Os ficheiros de entrada estão preservados neste diretório: `national-history.json`
contém os 717 resultados e os relógios de importação reais; `decision-snapshot.json`
contém os 216 candidatos com apenas os campos necessários ao diagnóstico.
São exportações de leitura da auditoria, sem segredos. O snapshot compacto
preserva também o hash da exportação de origem e a chave da decisão.

O protocolo e o relatório guardam os hashes das entradas; o relatório guarda
também os hashes dos dois modelos e do script. `predictions.json` contém as
previsões emparelhadas usadas nos cálculos. As opções `--history`, `--snapshot`
e `--out` permitem repetir com outros caminhos sem editar o código. O script
não acede à rede nem escreve em produção e não é importado pelo Worker.
