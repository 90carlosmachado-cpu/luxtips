# LuxTips — comparação prospetiva da regra de informação

## Estado em 24-10-2026

Publicação e ativação passiva autorizadas pelo utilizador em 24-10-2026 e realizadas às 09:42:54 de Lisboa (08:42:54 UTC). `INFORMATION_COMPARISON_MODE=shadow` foi confirmada no Worker; sem essa variável o código mantém-se desligado. Não há resultados de eficácia prospetiva antes da conclusão de jogos novos.

Commit da integração: `7945f79d5c14b23b28a91cdc5daaebadd23da292`. Worker ativo a 100%: `c91037f9-2628-446c-b75a-64509efcc9ca`. SHA256 do módulo publicado e da compilação local: `e3bca34d74e24665e1d6cc7516c92bd86006e3313bad0a3d31eda32b99723ff1`.

Verificação após publicação: API pública HTTP 200, modelo `luxtips-events-xg-elo020-live-v4`, política `winner-1x2-v1`, probabilidade mínima 60%, odd mínima 1,25, EV mínimo 3% e até três jogos por dia. Cron por minuto, quatro segredos, D1, Browser, namespace do relay, migração `v1-football-relay` e CPU 30.000 ms preservados. Nenhuma migração D1 foi aplicada.

O motor, probabilidades, limiares públicos, odds, ranking e publicações mantêm o comportamento atual. A integração acrescenta metadados de avaliação quando se ativa expressamente o modo passivo. Não liga os motores supervisionado/independente rejeitados na investigação anterior.

## Experiência fixa

- Identificador: `information-asymmetric6-prospective-v1`.
- Versão estatística: a versão atual do contexto, sem misturar outras versões.
- Competições: 39, 140, 78, 135 e 61, as cinco ligas estudadas.
- Regra antiga: amostra mínima 12 do componente de 180 dias.
- Candidata: mantém admissões antigas; casos novos exigem favorito com massa ponderada >=12, adversário com >=6 jogos reais e massa ponderada >=4. Atividade avaliada relativamente à última jornada da liga, evitando penalizar pausas de verão comuns.
- Probabilidade de vitória >=60%, odds >=1,25, validade da cotação e EV conservador >=3% continuam separados da condição de informação.

Não são coeficientes novos escolhidos depois dos resultados futuros. A política é a selecionada no desenvolvimento da fase anterior. Os resultados retrospetivos anteriores não são contabilizados como novos casos prospetivos.

## O que será registado

O ciclo `refreshContextForecasts` tem um gancho explícito, condicionado a `INFORMATION_COMPARISON_MODE=shadow`. Apenas atua nas últimas 24 horas antes do início e nas cinco ligas suportadas.

Guarda um snapshot da primeira previsão válida, mesmo que falte preço. Guarda separadamente a primeira observação com odd válida, se chegar depois. A segunda não substitui as probabilidades da primeira. A escolha do registo com preço depende da disponibilidade e validade da odd, sem exigir que o EV seja positivo ou que a probabilidade posterior seja maior.

Cada snapshot contém identidade do jogo e início, versão, probabilidades, amostra original, informação das duas equipas, decisões antiga/nova, bloqueios, odds originais, referência de mercado, divergência dos componentes, relógios das fontes e digest SHA256. O contrato original da previsão tem de estar verificado, e o perfil reconstruído tem de corresponder à amostra e às contagens realmente usadas pelo motor.

Verificação do primeiro ciclo real: três capturas válidas e duas falhas na Bundesliga revelaram que o histórico do motor também contém rótulos AET/PEN. O normalizador já utiliza `score.fulltime` nesses jogos, não golos do prolongamento ou desempate. A revisão do gravador aceita esses mesmos resultados de 90 minutos para reproduzir fielmente o fit, regista `statusCounts` e mantém a definição FT original dos helpers de investigação. As falhas anteriores ficam preservadas; a revisão permite nova tentativa sem reescrever linhas.

O primeiro registo pode indicar falta de dados, preço expirado ou ausência de valor; esses casos são preservados. Não há aposta executada nem prognóstico público criado pela experiência.

## Armazenamento e funcionamento

Reutiliza o campo `evaluation.informationComparison` nas novas linhas do ledger imutável `openfoot_context_forecasts`, já escrito pelo ciclo. Não cria tabelas, não altera triggers e não reescreve linhas antigas.

Antes de acrescentar a comparação, lê os snapshots existentes do mesmo jogo/início/versão. Depois de existir a primeira previsão e o primeiro preço válido, não cria novos snapshots experimentais. Enquanto falta preço, o modo passivo não força recálculos repetidos com os mesmos inputs; um novo recibo de odds permite a captura posterior.

Falhas de captura são registadas com motivo genérico e isoladas do cálculo/publicação. Sem a variável ativada, o gancho não faz consultas da experiência nem acrescenta dados ao resultado. Ativar o modo sobre uma previsão já em cache permite uma captura sem esperar por uma mudança do modelo.

## Avaliação

`currentInformationComparison(db)` faz apenas leituras e calcula o relatório. Pode limitar o número de jogos mais recentes entre 1 e 2.000 (500 por defeito); lê os snapshots desses jogos, não um corte arbitrário de linhas que possa esconder a primeira observação.

Valida o digest, contrato, versão, identidades, relógios e decisões recalculadas antes de pontuar. Duplicados posteriores, capturas depois do início, reagendamentos incompatíveis, jogos sem resultado FT, resultados com início ainda futuro e dados inconsistentes são excluídos com contagem por motivo.

Métricas:

- Brier e log loss 1X2 em todas as primeiras previsões válidas.
- Acerto, cobertura, Brier/log loss binários e calibração para candidatos informativos antigos, novos e recuperados.
- Os mesmos indicadores para os candidatos que cumprem os requisitos de preço, no seu próprio snapshot, com denominador de cobertura explícito.
- Comparação com mercado sem margem apenas nos mesmos jogos com referência válida conhecida antes do corte.
- Retorno teórico de uma unidade apenas no grupo com todos os requisitos de preço, usando a odd efetivamente capturada; inclui perdas. Não calcula retorno das análises informativas.
- Resultados por competição, dimensão das amostras, exclusões e registos individuais usados na pontuação.

Não simula as três vagas diárias, a publicação ao longo do dia, disponibilidade da odd numa conta pessoal, impostos ou execução. Uma cotação válida pode ter EV negativo; esse primeiro preço é preservado mesmo se outra cotação posterior passasse o filtro. A experiência não mede todas as oportunidades intradiárias.

## Leitura offline

Exportar apenas os registos prospetivos reais, incluindo `created_at`, `data` e o fixture atual em `current`. O avaliador aceita esses campos como JSON ou objetos. Exemplo:

```sh
node scripts/evaluate-information-comparison.mjs work/information-prospective/rows.json work/information-prospective/report.json
```

O script não tem ligações remotas, não lê credenciais e não reconstrói snapshots de jogos já terminados. Precisa dos registos previamente capturados. É possível indicar uma versão estatística como quarto argumento, para avaliar uma versão isolada.

## Validação local e limites

Os testes usam resultados sintéticos e SQLite em memória. Verificam que uma perda permanece no retorno, que a previsão posterior mais favorável não substitui a primeira, que odds expiradas não bloqueiam a captura posterior do primeiro preço válido e que a comparação mantém amostras emparelhadas com o mercado.

O teste do ciclo completo verifica igualdade das probabilidades, `winnerTip` e avaliação de seleção com o modo passivo ligado e desligado. Também verifica retenção da cache, ativação sobre uma cache anterior, isolamento de falhas de armazenamento e leitura dos registos imutáveis.

Verificação inicial: 128 testes na versão isolada e 145 no workspace completo. A revisão de compatibilidade AET/PEN acrescenta um teste de regressão, incluindo a verificação de que golos de prolongamento não entram no histórico normalizado. `npm run check` e a compilação `wrangler deploy --dry-run` verificam também a revisão. O bundle contém a comparação passiva e não contém os motores independente/supervisionado de investigação.

Estes testes demonstram o funcionamento do mecanismo, não eficácia preditiva ou rentabilidade real. Essa eficácia só poderá ser avaliada com jogos novos depois da ativação.

## Ativação proposta para revisão

1. Publicar a instrumentação e respetivos testes, mantendo o motor e a política de recomendações.
2. Ativar exclusivamente `INFORMATION_COMPARISON_MODE=shadow`; preservar as restantes variáveis, bindings e segredos.
3. Verificar uma captura anterior ao início, integridade do registo e igualdade das decisões públicas.
4. Acompanhar cobertura, falhas de captura e resultados das duas regras sem alterar os critérios a meio.
5. Avaliar pelo menos 30 candidatos recuperados novos como primeiro ponto de revisão, com intervalos e análise por competição. Esse número é um mínimo operacional para revisão, não prova suficiente de vantagem.

Desativar a variável interrompe novas capturas; os snapshots já guardados continuam imutáveis. A ativação e o deploy foram autorizados explicitamente pelo utilizador.
