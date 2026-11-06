# Algoritmo do Big Odds

Regras de seleção e funcionamento do boletim

Este documento explica o algoritmo específico do Big Odds no LuxTips: os dados utilizados, o cálculo das probabilidades, a escolha das seleções, a publicação diária e a resolução dos resultados. Inclui os parâmetros exatos e as limitações conhecidas para permitir a sua análise e reprodução.

A referência é a versão publicada em 6 de novembro de 2026, identificada como bigodds-xg90-prior2-market50-no-unders-v1. A documentação foi conferida com o código dessa versão. A correção da reutilização de jogos retirados e o limite de duas seleções por mercado não fazem parte desta versão ativa.

### Objetivo

Gerar uma única múltipla com odd total entre 8 e 15 e entre 5 e 12 seleções, privilegiando a probabilidade estimada de acerto entre os boletins que a rotina efetivamente constrói. Pode reunir jogos de hoje, amanhã e depois de amanhã, sempre na hora de Lisboa.

O algoritmo não garante uma taxa de acerto nem encontra necessariamente a melhor combinação matemática de todas as seleções disponíveis. Usa uma construção por ordenação de probabilidades, detalhada na página 6.

| Parâmetro | Valor ativo |
| --- | --- |
| Publicação normal | 08h00 de Europe/Lisbon |
| Horizonte | Hoje e os dois dias seguintes |
| Seleções | 5 a 12 com um único jogo por seleção |
| Odd total | 8 a 15 |
| Odd mínima por seleção | 1,20 |
| Probabilidade mínima por seleção | 50% após mistura com o mercado |
| Boletins simultâneos | No máximo um ativo |
| Casa de apostas | Uma única casa em cada boletim |

### Como consultar

Páginas 2 e 3: dados e mercados. Páginas 4 e 5: fórmulas e odds. Página 6: construção do boletim. Página 7: horário, histórico e resultados. Página 8: simulações e estado das alterações.

## Dados utilizados e validação

### Jogos candidatos

A rotina procura jogos ainda não iniciados, com estado NS, sem resultado registado e com início a mais de 60 segundos do instante de publicação. Confirma o identificador, a data e as duas equipas antes de gravar o boletim. Um jogo que já começou não pode entrar numa publicação normal, mesmo que tenha sido permitido em testes antigos.

As competições são configuráveis em LEAGUES. Na ausência dessa configuração, o código usa os identificadores 94, 39, 140, 78, 135, 61, 88, 2, 3 e 848: Portugal, Inglaterra, Espanha, Alemanha, Itália, França, Países Baixos, Champions League, Liga Europa e Conference League. A lista efetiva depende da configuração do Worker.

### Histórico para estimar a força

São utilizados jogos terminados em FT desde 1 de janeiro de 2023, dentro das ligas configuradas. O histórico é separado por liga e por condição: a equipa da casa é avaliada pelos seus jogos em casa e a visitante pelos seus jogos fora. Não existe um número fixo dos últimos cinco ou dez jogos.

Só entram resultados disponíveis até ao instante da análise e jogos cujo início ocorreu há pelo menos duas horas. Quando existem simultaneamente um resultado na tabela de resultados e outro nos dados do jogo, têm de coincidir. A espera de duas horas é uma condição de elegibilidade; não prova, por si só, a hora real do apito final.

### Dados de xG

O xG é consultado nos detalhes históricos já recolhidos em openfoot_match_details. Cada registo tem de corresponder ao identificador, liga, início e resultado do jogo histórico. Os valores das duas equipas devem ser números entre 0 e 20. O instante de observação tem de coincidir com o registo, ser posterior ao início do jogo e não ultrapassar a análise.

Por jogo histórico é aceite apenas o primeiro registo válido, ordenado pela hora de observação. Não são inventados valores de xG para jogos sem dados. O nome da tabela não é, por si só, uma garantia da origem externa; o algoritmo consome os dados que o processo de recolha lá validou e guardou.

### Dados que não entram diretamente neste modelo

O Big Odds não acrescenta componentes próprios de Elo, lesões, onze inicial, árbitro, notícias, motivação, cantos ou confrontos diretos. O preço da casa pode refletir parte dessa informação, mas o algoritmo não a analisa separadamente. As regras do separador de futebol não são automaticamente herdadas pelo Big Odds.

## Mercados admitidos

| Código | Seleção | Condição para acertar |
| --- | --- | --- |
| 1 | Casa vence | Golos da casa superiores aos do visitante |
| 2 | Visitante vence | Golos do visitante superiores aos da casa |
| 1X | Casa ou empate | Casa não perde |
| X2 | Visitante ou empate | Visitante não perde |
| O15 | Mais de 1,5 golos | Pelo menos 2 golos |
| O25 | Mais de 2,5 golos | Pelo menos 3 golos |
| O35 | Mais de 3,5 golos | Pelo menos 4 golos |
| BY | Ambas marcam | As duas equipas marcam |
| BN | Ambas não marcam | Pelo menos uma equipa fica sem marcar |

Todos estes mercados são avaliados quando existem odds válidas e informação suficiente para calcular a referência de mercado. Não existe uma restrição que obrigue a escolher golos, nem uma distribuição obrigatória entre ligas ou mercados.

### Combinações de vitória ou dupla hipótese com golos

O motor matemático consegue calcular 1 + mais de 1,5, 2 + mais de 1,5, 1X + mais de 1,5 e X2 + mais de 1,5. Porém, estes quatro mercados não constam da lista ativa de publicação e o adaptador de odds não os mapeia. Por isso, não entram atualmente nos boletins.

Não são produzidas odds de combinações multiplicando preços de mercados relacionados. Uma odd estimada desse modo não é aceite para publicação. Ativar estes mercados exige preços reais e uma correspondência verificada com a seleção exata do fornecedor.

### Mercados excluídos

O empate isolado é utilizado na normalização do mercado 1X2, mas não é uma seleção publicável. O mercado 12 e os mercados de menos de 1,5, 2,5 ou 3,5 golos estão excluídos da lista ativa. Os unders podem existir como contraparte para retirar a margem das odds de overs, sem serem selecionados.

### Por que podem aparecer muitos mercados de golos

Para cada jogo e casa, fica apenas o mercado elegível com maior probabilidade final. Como não há quota de diversidade, vários jogos podem ficar com o mesmo mercado. A presença frequente de golos resulta desta regra e dos dados disponíveis; não demonstra que golos sejam sempre o mercado mais provável em qualquer jogo.

## Modelo de golos e utilização do xG

### Peso temporal e amostra

Para um jogo histórico, a idade em dias é contada desde o início acrescido de duas horas. O peso é w = 2 elevado a menos idade dividida por 90. Um jogo com 90 dias de idade tem metade do peso de um jogo acabado de se tornar elegível; com 180 dias, um quarto.

Em cada grupo, W é a soma dos pesos, GF a soma ponderada dos golos marcados e GA a soma ponderada dos golos sofridos. A amostra simples é o número de jogos; a amostra ponderada é W. São conceitos distintos.

### Referência da liga com golos reais

Para os jogos em casa da liga: BH = (GF da liga em casa + 30) / (W da liga + 20). Para os visitantes: BA = (GF da liga fora + 24) / (W da liga + 20). Os termos 30/20 e 24/20 correspondem a referências iniciais de 1,5 e 1,2 golos, que diminuem de importância à medida que aumenta o histórico.

### Estimativa quando o xG não é suficiente

Cada média de equipa é suavizada com prior 2: média ajustada = (soma ponderada + 2 × referência da liga) / (W + 2). O prior funciona como duas observações de referência; reduz a instabilidade de amostras pequenas.

A intensidade de golos da casa é BH × força atacante da casa × fragilidade defensiva do visitante. A força atacante é a média ajustada de golos marcados em casa dividida por BH; a fragilidade é a média ajustada de golos sofridos fora dividida por BH. Para o visitante, aplica-se a mesma lógica com BA, golos marcados fora e golos sofridos pela equipa da casa em casa.

### Quando e como o xG substitui as forças de equipa

O xG só é usado se a amostra ponderada da liga for pelo menos 20 e cada equipa tiver pelo menos 2 jogos ponderados na respetiva condição casa ou fora. As médias de xG da liga, em casa e fora, têm ainda de ser positivas. Se alguma condição falhar, todo o jogo usa o modelo de golos reais.

Quando há amostra suficiente, as forças de ataque e defesa são calculadas com xG marcado e sofrido, suavizado com prior 2 e dividido pela média de xG da liga na condição relevante. A intensidade final continua ancorada em BH e BA, calculados com golos reais. Portanto, xgWeight = 1 significa usar inteiramente o xG nas forças relativas das equipas; não significa eliminar os golos reais de todo o cálculo.

Exemplo ilustrativo: se BH = 1,5, a força atacante da casa for 1,2 e a fragilidade visitante for 1,1, a intensidade da casa será 1,5 × 1,2 × 1,1 = 1,98 golos. Não se trata de um resultado observado.

## Probabilidades e referência das odds

### Distribuição dos resultados

Cada intensidade de golos é limitada ao intervalo de 0,15 a 4,5 para calcular a distribuição de Poisson. Para uma intensidade λ, a probabilidade de k golos é exp(−λ) × λ elevado a k / k!. O algoritmo calcula de 0 a 20 golos para cada equipa.

A probabilidade de um resultado i–j é o produto das probabilidades das duas equipas, assumindo independência entre os respetivos golos. A matriz é normalizada pela massa calculada. A probabilidade de cada mercado é a soma dos resultados em que esse mercado acerta. Por exemplo, mais de 1,5 soma todos os resultados com pelo menos dois golos.

### Validade das odds reais

As odds têm origem identificada como API-Football e são separadas por jogo e casa de apostas. O instante do fornecedor tem de ser posterior a análise menos seis horas, não pode ultrapassar o instante em que a odd foi observada e essa observação não pode ultrapassar a análise. A observação tem ainda de ser anterior ao início do jogo.

A odd tem de ser superior a 1 e coincidir com a data de início do jogo. Por mercado e casa, fica o registo com instante do fornecedor mais recente; em empate, o mais recentemente observado. Antes de publicar, a frescura é novamente verificada contra a hora efetiva de publicação.

### Retirar a margem da casa

Para vitória ou dupla hipótese, são obrigatórias as três odds 1, X e 2 da mesma casa e com o mesmo instante do fornecedor. Calcula-se q1 = 1/odd1, qX = 1/oddX e q2 = 1/odd2. Cada probabilidade justa é q dividido pela soma q1 + qX + q2. Para 1X somam-se as probabilidades justas de 1 e X; para X2, as de X e 2.

Para golos e ambas marcam são exigidas as duas faces do mercado, na mesma casa e no mesmo instante: over e under da mesma linha, ou sim e não. A probabilidade justa da seleção é (1/odd da seleção) / [(1/odd da seleção) + (1/odd da contraparte)].

### Probabilidade usada para escolher

Probabilidade final = 50% × probabilidade do modelo + 50% × probabilidade justa do mercado. Esta mistura aplica-se também aos jogos sem xG suficiente. Um mercado sem referência completa ou sem probabilidade calculável pelo modelo é rejeitado.

Exemplo ilustrativo: 80% no modelo e 72% na referência da casa produzem 76% na decisão. A seleção ainda precisa de odd real de pelo menos 1,20. Não há um filtro adicional obrigatório de valor esperado positivo ou vantagem mínima sobre o mercado.

## Construção e escolha do boletim

### Primeiro a direção da equipa

Nos mercados 1, 2, 1X e X2, a direção é fixada antes do filtro de odd mínima e usa apenas o modelo, sem a mistura com o mercado. Se Pmodelo(1X) for maior ou igual a Pmodelo(X2), a direção é casa; caso contrário, visitante. Só ficam as seleções da direção escolhida. Em igualdade, prevalece casa.

Esta regra impede que a procura de uma odd mais alta leve a escolher o lado contrário ao preferido pelo modelo na mesma análise. Não é uma regra de diversidade de mercados e não constitui uma avaliação separada de valor.

### Um mercado por jogo e por casa

Eliminam-se os mercados não admitidos, odds estimadas, odds inferiores a 1,20 e probabilidades finais inferiores a 50%. Para cada par jogo e casa de apostas, conserva-se apenas a seleção com maior probabilidade final. Em igualdade exata, usa-se a ordem alfabética do código do mercado.

### Ordenar e testar os primeiros jogos

Dentro de cada casa, os jogos são ordenados por probabilidade final decrescente. Os empates são resolvidos pelo identificador do jogo e depois pelo código do mercado. A rotina multiplica progressivamente as odds e acumula o logaritmo das probabilidades, até um máximo de 12 seleções.

A partir da quinta seleção, um prefixo da lista é candidato se a odd total estiver entre 8 e 15. Se ultrapassar 15, a procura nessa casa termina. Não se salta um jogo para experimentar outro de odd menor e não se trocam mercados para conseguir encaixar mais seleções.

### Comparar candidatos

Entre os prefixos elegíveis de todas as casas, vence o de maior soma dos logaritmos das probabilidades, equivalente ao maior produto das probabilidades individuais. A odd do boletim é o produto das odds registadas. Em empate exato, fica o primeiro candidato encontrado na ordem determinística das casas.

O produto das probabilidades é um critério interno de comparação, assente em independência entre seleções. Não equivale a uma taxa de acerto demonstrada. Dentro de uma lista com probabilidades inferiores a 100%, adicionar seleções reduz esse produto; por isso, a rotina tende a preferir o primeiro prefixo elegível.

### Alcance e limites da pesquisa

A seleção é gulosa: escolhe primeiro o melhor mercado individual por jogo e depois testa prefixos. Não pesquisa todas as combinações possíveis de jogos e mercados. Não existe limite por liga, país, dia ou mercado, nem penalização própria para correlações entre seleções. Se nenhum prefixo cumprir as condições, não é publicado boletim.

A ordem de apresentação é cronológica, por dia e hora do jogo. Essa ordenação visual é independente da ordenação por probabilidade utilizada para construir o boletim.

## Publicação e gestão do histórico

### Ciclo diário às oito horas

O processamento agendado corre a cada minuto, mas só pode gerar normalmente um novo boletim no minuto das 08h00 de Europe/Lisbon. Há um registo único por dia que impede repetir a tentativa. Se não houver boletim elegível, não existe uma tentativa automática mais tarde nesse dia. Se o processamento sair desse minuto antes da publicação, o boletim não é publicado.

O sistema verifica se havia um boletim em curso na fronteira das 08h00 antes de atualizar a resolução dos jogos. Se havia, mantém-no e ignora a geração desse dia. Mesmo que se confirme uma perda depois das 08h00, a próxima tentativa normal fica para o dia seguinte. Não existe substituição contínua do boletim ativo por um novo boletim mais forte.

### Publicação consistente e exceção manual

Antes de gravar, o sistema volta a confirmar número de seleções, produto das odds, mercados, casa única, datas, equipas e disponibilidade dos jogos. A escrita é feita em lote e exige que não exista outro boletim ativo. O boletim guarda uma fotografia dos dados e probabilidades usados na decisão.

Existe um comando administrativo de utilização única para substituir um boletim e gerar outro fora das 08h00. Tem prazo de validade e exige que a versão pedida coincida com a política ativa. Não existe um pedido público do site que permita ultrapassar esta regra. Esta exceção não faz parte do ciclo diário normal.

### Resultados e fecho

Uma seleção é resolvida quando há resultado final FT coerente com o jogo guardado e com o resultado registado. Os mercados são de tempo regulamentar; resultados AET ou PEN não são resolvidos por este caminho. Estados CANC, AWD e WO anulam a seleção. Outros estados ficam pendentes até existirem dados tratados por estas regras.

Um único erro fecha imediatamente o boletim como perdido. As restantes seleções continuam a receber resultados no histórico. Sem erros, o boletim fecha quando não existem seleções pendentes: fica anulado se todas forem anuladas e ganho se existir pelo menos uma ganha. A odd registada original não é recalculada neste módulo quando há seleções anuladas; não deve ser lida como pagamento final da casa.

### Reutilização de jogos na versão publicada

A versão v1 exclui qualquer jogo já registado em bigodds_legs, incluindo jogos de boletins explicitamente substituídos. Esta restrição é mais ampla do que a regra pretendida de evitar boletins simultâneos. Explica por que alguns jogos de hoje ficaram indisponíveis após a substituição do boletim anterior.

A correção preparada permite reutilizar jogos de boletins marcados como substituídos, preservando o histórico original e a regra de um único ativo. Ainda não está publicada. Jogos de boletins normalmente ganhos, perdidos ou anulados continuam excluídos nessa correção.

## Simulações e estado das alterações

### Resultados históricos da candidata com xG

A candidata atual usa meia vida de 90 dias, prior 2, xG quando suficiente, mistura de 50% com a referência da casa e exclusão de unders. A pesquisa alargada avaliou 1 026 432 configurações finitas. Não representa todas as regras matematicamente possíveis.

| Simulação | Sem limite por mercado | Máximo de duas |
| --- | --- | --- |
| Boletins sobrepostos | 6 ganhos em 10 — 60% | 1 ganho em 8 — 12,5% |
| Um único boletim ativo | 3 ganhos em 4 — 75% | 1 ganho em 4 — 25% |

No teste de duas seleções por mercado, a quota foi aplicada ao código exato: mais de 1,5 e mais de 2,5 contam como mercados distintos. Quando a quota ficava cheia, o jogo era saltado, sem trocar a sua seleção para um mercado menos provável. Os restantes critérios foram mantidos. Em dois dias deixou de haver boletim elegível.

As odds médias dos boletins sobrepostos foram 9,17 sem limite e 10,05 com limite. No cenário de um boletim ativo, foram 8,77 e 9,92, respetivamente. O limite piorou esta comparação e não foi aplicado em produção.

### Como interpretar os números

Os boletins sobrepostos podem partilhar jogos e, por isso, os resultados não são independentes. O cenário sequencial aproxima a hora de disponibilidade do resultado ao início acrescido de duas horas; não reproduz os instantes históricos reais de resolução. Ambas as contagens são simulações, não boletins reais publicados com essas taxas.

A amostra é pequena e já foi explorada para escolher regras. A seleção de uma boa candidata entre muitas configurações aumenta o risco de sobreajuste ao passado. Estes resultados não são uma validação independente, não demonstram uma melhoria garantida com xG e não sustentam uma promessa de 60% ou 75% no futuro.

### Estado documentado

| Componente | Estado de referência |
| --- | --- |
| Modelo com xG e referência das odds | Publicado como política v1 |
| Máximo de duas seleções por mercado | Simulado e não aplicado |
| Reutilização de jogos de boletins substituídos | Preparada e testada mas não publicada |
| Combinações de vitória ou dupla hipótese com golos | Não publicáveis na versão ativa |

### Fontes técnicas

Código de referência: bigodds-model.mjs e bigodds.mjs da versão publicada, preservados antes da correção de reutilização; componente bigodds-view.mjs para a apresentação. Resultados: bigodds-market-cap/results.json e respetivos testes de reprodução. O identificador da política na página 1 distingue esta documentação das alterações locais ainda pendentes.
