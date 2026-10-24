# LuxTips — substituir o bloqueio de amostra, 24-10-2026

## Decisão desta fase

Política escolhida só no desenvolvimento: **asymmetric6**. Aumenta a cobertura com as probabilidades originais, mas **não cumpriu todo o protocolo de validação**: a avaliação posterior tem apenas dois candidatos recuperados, abaixo dos 30 exigidos. Não promover como política de recomendações validada. Implementação isolada em `src/lux/information-policy.mjs`, sem import no Worker.

O diagnóstico atual recupera os cinco favoritos ocultados pela amostra como candidatos informativos. Nenhum satisfaz todos os outros requisitos de preço no snapshot consultado. Isso distingue claramente informação insuficiente, ausência de preço atual e valor da aposta.

## Regras fixadas antes do teste

Todas as políticas mantêm vitória H/A >=60%. São extensões: preservam a admissão pelo critério antigo e avaliam novos casos abaixo de 12. Não alteram as probabilidades, o preço mínimo, o EV, os recibos ou o histórico.

| Política | Requisito novo de informação |
|---|---|
| legacy12 | Massa temporal mínima 12 no componente de 180 dias |
| aligned12 | Massa ponderada dos dois horizontes >=12 para ambas as equipas |
| balanced8 | Ambas com >=8 jogos reais e massa ponderada >=8 |
| asymmetric6 | Favorito com massa ponderada >=12; adversário com >=6 jogos e massa ponderada >=4 |

Massa ponderada = 23,4027% × massa180 + 76,5973% × massa365. São pesos do núcleo atual. Não confundir massa com ESS de Kish ou com uma probabilidade de acerto.

Para os casos novos, a idade do último jogo de cada equipa não pode exceder em mais de 45 dias a idade do último resultado da liga. Assim uma pausa comum de verão de 80 dias não é confundida com uma equipa desatualizada. Esse limite é uma hipótese operacional, não uma constante estatística universal.

Os limites 8, 6 e 4 são candidatos explícitos de investigação. Não foram justificados pelo desejo de preencher o site, nem são apresentados como estatisticamente comprovados. Identidade, história ausente, relógios e distribuição inválidos não são compensados por uma percentagem alta.

### Escolha e critérios

- Desenvolvimento: 1.755 jogos de 2024/25. Maximizar cobertura sujeito a >=30 candidatos recuperados, limite inferior Wilson95 do acerto recuperado >50%, acerto global >=base−2 pontos e ECE <=base+2 pontos. Desempate pela ordem de registo. Baseline se nenhuma alternativa passar.
- Confirmação: 802 jogos anteriores a janeiro de 2026. Política fixa, sem afinação.
- Avaliação posterior: 952 jogos de janeiro em diante, 2025/26. Política fixa.
- Auditoria: 346 jogos de 2026/27 já observados em estudos anteriores.
- Aprovação exploratória exige, em confirmação **e** avaliação, >=30 recuperados, acerto recuperado >=60%, limite inferior do bootstrap da diferença de acerto >−5 pontos e ECE <=base+2 pontos.

As margens são critérios operacionais declarados antes da execução, não garantias de segurança financeira. Períodos já examinados; não é um teste final intocado. Protocolo, hash dos inputs e escolha guardados antes dos resultados posteriores.

## Resultados — sem odds/EV e sem limite diário

| Período | Critério antigo: vitórias/candidatos | Acerto antigo | Novo: vitórias/candidatos | Acerto novo | Só recuperados | IC95% recuperados |
|---|---:|---:|---:|---:|---:|---:|
| Desenvolvimento | 320/488 | 65.6% | 351/531 | 66.1% | 31/43 (72.1%) | [57.3%, 83.3%] |
| Confirmação | 126/165 | 76.4% | 149/201 | 74.1% | 23/36 (63.9%) | [47.6%, 77.5%] |
| Avaliação posterior | 177/265 | 66.8% | 179/267 | 67.0% | 2/2 (100.0%) | [34.2%, 100.0%] |
| Auditoria 2026/27 | 47/59 | 79.7% | 56/71 | 78.9% | 9/12 (75.0%) | [46.8%, 91.1%] |

O maior ganho ocorre no início das épocas, quando chegam equipas com pouco histórico na liga. Na confirmação, a cobertura sobe de 165 para 201 candidatos (+21,8%) e o acerto desce de 76,4% para 74,1%. Os 36 novos casos acertam 23 (63,9%). Não é melhoria do motor probabilístico: é uma mudança de conjunto selecionado.

Na auditoria 2026/27, recupera 12 candidatos e acerta nove; o intervalo é largo. Na avaliação posterior só recupera dois, ambos ganhos. Esses dois jogos não validam a regra. Não agrupar seletivamente períodos para esconder esta insuficiência.

### Calibração e incerteza da diferença

ECE é a média dos desvios absolutos em quatro faixas fixas de probabilidade, ponderada por tamanho. Menor é melhor. Comparações sobre conjuntos diferentes não provam que as probabilidades individuais tenham melhorado.

| Período | ECE antigo | ECE novo | IC95% da diferença de acerto, novo−antigo |
|---|---:|---:|---:|
| Confirmação | 8.5% | 4.8% | [-4.7%, 0.4%] |
| Avaliação posterior | 3.5% | 3.4% | [0.0%, 0.7%] |
| Auditoria | 11.0% | 10.2% | [-5.0%, 3.1%] |

Bootstrap emparelhado por semanas, 2.000 reamostragens, semente 918273, recalculando os rácios em cada reamostragem. Intervalos condicionados à política escolhida, sem ajuste a todas as comparações exploratórias. Não equivalem a prova geral de não inferioridade.

### Limite ilustrativo de três candidatos por dia

Ordenação estática por probabilidade, desempate por hora e id, dias Europe/Lisbon. Não reproduz o ranking por probabilidade conservadora, odds ou a publicação imutável ao longo do dia.

| Período | Antigo: vitórias/seleções | Novo: vitórias/seleções | Entradas novas | Candidatos antigos deslocados |
|---|---:|---:|---:|---:|
| Desenvolvimento | 217/310 | 228/327 | 27 | 10 |
| Confirmação | 95/117 | 99/124 | 24 | 17 |
| Avaliação posterior | 122/176 | 123/177 | 2 | 1 |
| Auditoria | 40/48 | 45/53 | 8 | 3 |

O critério sem limite nunca remove um candidato que antes passava. Com três vagas, novos jogos podem substituir candidatos menos prováveis no ranking hipotético. A política de substituir publicações já feitas não foi alterada nem simulada.

## Casos atuais — snapshot de 24/10/26, 09:18:11, Lisboa

Leitura de 9.859 resultados e dos detalhes disponíveis, apenas para diagnóstico. A reconstrução respeitou o corte de cada previsão, as observações de detalhes conhecidas, as identidades e os resultados, removendo jogos com expulsões segundo o motor ativo. A massa180 reconstruída coincide com a massa efetivamente guardada em **cinco de cinco casos**, tolerância 1e−8. Isso valida a composição da amostra nestes exemplos, não todas as camadas probabilísticas.

| Jogo | Vitória estimada | Jogos reais casa/fora | Massa ponderada casa/fora | Novo critério de informação | Bloqueio posterior no snapshot |
|---|---:|---:|---:|---|---|
| RB Leipzig–SV Elversberg | 63.8% | 100/7 | 35.09/5.30 | Passa | EV conservador -6.1% à odd 1.48 |
| Atletico Madrid–Deportivo La Coruna | 65.8% | 105/6 | 35.00/5.43 | Passa | Odd expirada |
| Atalanta–Frosinone | 60.9% | 106/34 | 35.40/8.98 | Passa | Odd expirada |
| Toulouse–Estac Troyes | 67.7% | 94/7 | 31.83/6.42 | Passa | Odd expirada |
| Sporting CP–Academico Viseu | 77.9% | 102/8 | 36.50/7.13 | Passa | Odd expirada |

O Sporting está fora das cinco ligas do backtest: a aplicação da regra a esse caso é apenas um diagnóstico, sem validação quantitativa na Liga Portugal. Todos os resultados são preços e estados do instante capturado, não odds executáveis garantidas agora. Não foram renovadas odds, disparados ciclos ou feitas escritas remotas.

Estes jogos poderiam tornar-se análises informativas pela regra candidata, com aviso de informação limitada. A transformação em recomendação continua dependente de todos os filtros e da validação do método. A ausência de EV não volta a ser usada para esconder análises informativas.

## Limitações e próximo passo concreto

Não houve treino novo nem inflação de probabilidades. A base continua a ser a reconstrução exploratória do núcleo Elo/xG em cinco ligas, sem o motor completo de acontecimentos e sem disponibilidade histórica das fontes provada. Sem odds históricas adequadas, não há avaliação de EV, comparação financeira com mercado ou ROI.

Uma consulta atual encontrou sete jogos terminados com snapshots v4 declarados válidos à captura, insuficientes para uma conclusão. A contagem não equivale a sete registos que passaram toda a validação de avaliação; não foram usados para estimar acerto nesta fase.

Ficou preparado `src/lux/information-snapshot.mjs`: constrói um snapshot sem efeitos de escrita, com a decisão antiga/nova, probabilidades, perfil de informação, preços, referência de mercado, relógios e digest SHA256. Exige o contrato de avaliação original verificado, histórico compatível com as contagens e massa realmente usadas e fontes conhecidas antes do corte. Recusa fonte posterior, histórico divergente e captura depois do início.

O passo operacional seguinte é integrar esse registo numa comparação prospetiva com a regra fixa, exigir novos candidatos recuperados suficientes e manter perdas no histórico. A recolha ou publicação automática dessa comparação **não foi ativada**. Não substituir o bloqueio público com estes resultados limitados.

## Código e reprodução

- `src/lux/information-policy.mjs`: requisitos e escolha apenas no desenvolvimento.
- `src/lux/information-preview.mjs`: diagnóstico dos bloqueios posteriores, sem publicação.
- `src/lux/information-snapshot.mjs`: registo prospetivo preparado e testado, sem integração automática.
- `tests/information-policy.test.mjs`: fronteiras, relógios, pausas de verão, favorito/adversário e separação de preço/EV.
- `node scripts/research-information-policy.mjs`: protocolo, escolha fixa e comparação.
- `node scripts/report-information-policy.mjs`: este relatório e preview do snapshot guardado.

Requer os extratos locais em `work/model-comparison/`, `work/lux-evidence/features.json` e o snapshot de leitura em `work/information-policy/current-preview.json`. Resultados por competição, entrantes como favorito/adversário, calibração e decisões jogo a jogo em `work/information-policy/results.json`.
