# LuxTips 2

Análise probabilística de futebol com API-Football, Cloudflare Workers e D1. O Excel deixa de ser a fonte operacional. Projeto independente, sem integração com outros sistemas.

## Arquitetura

- Worker `luxtips`: serve a interface e a API pública de leitura; executa sincronização programada.
- D1 `luxtips-analysis`: jogos, cache persistente, quotas, resultados e previsões imutáveis.
- Sem KV, R2, serviços de IA generativa ou novos planos pagos.
- Seis competições iniciais: Portugal (94), Inglaterra (39), Espanha (140), Alemanha (78), Itália (135) e França (61).
- Sincronização aos minutos 07 e 37 de cada hora, em UTC. A época atual é descoberta na API.
- Cache: cobertura 24 h; histórico da época 24 h; jogos próximos 30 min; odds 3 h; lesões 6 h; alinhamentos 30 min. Histórico de épocas anteriores é carregado no arranque.
- Limite local de 600 pedidos/dia, partilhado atomicamente em D1. O plano consultado permite 7.500/dia e 300/minuto, estando ativo até 07/11/2026. Isto é uma observação de 18/10/2026, não uma garantia de renovação.
- A consulta pública nunca origina chamadas à API-Football. Os erros não registam a chave, cabeçalhos ou corpos das respostas externas.

## Modelo e decisões estatísticas

Poisson independente com forças ofensiva e defensiva por equipa, ajuste aos adversários, médias casa/fora da competição, regularização e decaimento temporal com meia-vida de 180 dias. O histórico é limitado a três anos. Os golos estimados pelo modelo não são xG medidos por eventos.

Foram comparadas três configurações em desenvolvimento: meia-vida 180 dias; mesma configuração com Elo; meia-vida 365 dias. A pequena melhoria do Elo não ultrapassou o limiar de materialidade de Brier de 0,001, pelo que o modelo mais simples foi mantido. O Elo aparece apenas como contexto. Não foram introduzidos fatores de lesões, descanso, motivação ou formações com pesos arbitrários. Ausências e alinhamentos, quando fornecidos, são apresentados como contexto.

A seleção exige amostra efetiva mínima de 12 jogos por equipa, probabilidade ≥65%, melhoria de Brier face à referência simples global e por competição, intervalo normal de 95% da diferença de Brier acima de zero, e grupo de calibração com ≥100 casos e desvio máximo de 8 pontos percentuais. Estes filtros são exploratórios e exigem confirmação prospetiva; não demonstram rentabilidade, nem corrigem dependência entre jogos ou comparações múltiplas.

A fiabilidade apresentada é a frequência observada no grupo histórico correspondente, acompanhada de amostra e intervalo de Wilson; não é uma percentagem de confiança inventada para o jogo individual. A qualidade dos dados diz respeito à amostra de resultados disponível e não representa cobertura integral de todas as estatísticas da API.

Com odds reais recentes, o valor esperado é `probabilidade × odd − 1`; a seleção exige EV ≥3%. Sem odds reais não é calculado valor. Odds de várias casas não são misturadas para criar uma probabilidade implícita supostamente sem margem. As probabilidades do modelo não são misturadas com o mercado.

## Validação executada

Dados reais recolhidos na API-Football em 18/10/2026: 6.584 jogos concluídos disponíveis nas épocas 2023–2026. Desenvolvimento na época 2024 e teste na época 2025 (2025/26), com 1.835 jogos elegíveis após o filtro de amostra. O conjunto de 2026 não foi usado para escolher configurações ou medir o teste de 2025.

Walk-forward diário: cada previsão histórica usa apenas resultados com pelo menos duas horas de antecedência relativamente às 00:00 UTC do dia do jogo. A escolha entre configurações usa os mesmos jogos elegíveis para todas as alternativas. Não foram usados estados atuais de classificações, lesões ou odds para prever o passado.

| Evento binário |  Brier | Referência da competição | Log Loss | Desvio de calibração |
| -------------- | -----: | -----------------------: | -------: | -------------------: |
| Vitória casa   | 0,2140 |                   0,2458 |    0,616 |               1,8 pp |
| Vitória fora   | 0,1871 |                   0,2138 |    0,555 |               3,1 pp |
| Mais 2,5 golos | 0,2466 |                   0,2471 |    0,686 |               3,9 pp |
| Ambas marcam   | 0,2488 |                   0,2480 |    0,691 |               3,0 pp |

Valores mais baixos de Brier e Log Loss são melhores. A referência usa médias de golos da competição, sem força das equipas; não é o mercado de apostas. O relatório completo, com amostras, acerto binário, grupos de calibração e métricas por competição, está em `src/validation.json` e na interface.

Recomendações elegíveis: vitória casa, vitória fora, casa/empate e empate/fora, com filtros adicionais. Vitória fora e casa/empate estão suspensas em Espanha por não ultrapassarem o critério por competição. Empate, sem empate, totais e ambas marcam permanecem como probabilidades informativas, com recomendações suspensas. Cantos, cartões, handicaps e empate anula aposta não foram implementados como recomendações por falta de validação adequada.

Não há odds históricas adequadas neste conjunto: **ROI não calculado e vantagem sobre casas de apostas não demonstrada**. Não existem snapshots comparáveis do modelo anterior, pelo que não foi executada comparação direta. O acerto binário de cada evento ao limiar de 50% não é a taxa de acerto dos prognósticos selecionados.

## Previsões e avaliação contínua

O primeiro registo preliminar é conservado. A análise operacional pode ser atualizada na cache; a previsão final é fixada na primeira sincronização dentro da última hora anterior ao jogo. O intervalo de 30 minutos é uma cadência de tentativa, não uma garantia de disponibilidade do fornecedor.

A base rejeita previsões com data de criação posterior ao início e bloqueia UPDATE/DELETE de snapshots. Os resultados regulamentares são associados separadamente. Jogos adiados com horário alterado não são avaliados com o horário antigo. Não se inventam previsões finais retroativas quando o processo falha antes do início.

O histórico mostra as últimas 1.000 previsões finais liquidadas e calcula Brier, Log Loss e calibração continuamente. As métricas históricas de backtest são separadas das métricas prospetivas. A nova evidência não altera automaticamente hiperparâmetros: esse ajuste exige nova validação cronológica.

## Segurança e operação

Segredos exigidos no Worker: `API_FOOTBALL_KEY` e `ADMIN_TOKEN`. Nunca os colocar em HTML, Git, parâmetros de URL ou ficheiros distribuídos. O token administrativo pode ser substituído no painel Cloudflare ou com `wrangler secret put ADMIN_TOKEN`; o valor não é incluído neste repositório.

Endpoints:

- `GET /api/games`: análises dos próximos sete dias.
- `GET /api/history`: previsões finais liquidadas e métricas prospetivas.
- `GET /api/validation`: relatório histórico reproduzível.
- `GET /api/health`: resultado da última sincronização.
- `POST /api/admin/sync`: sincronização pontual, com `Authorization: Bearer <ADMIN_TOKEN>`.
- `GET /api/admin/provider`: diagnóstico restrito do plano e limites, sem dados da conta ou valores da chave.

O acesso público de leitura é intencional. CORS permite a página GitHub do projeto; a interface no Worker usa a mesma origem. A autenticação administrativa verifica o token por comparação dos hashes em tempo constante. CSP restringe origens de scripts, pedidos e enquadramento. A cache desatualizada é assinalada; a seleção é suspensa quando os dados da recolha estão desatualizados ou a análise apresentada tem mais de duas horas.

Em caso de limite da API ou falha de rede, não aumentar o plano: consultar `/api/health`, o diagnóstico autenticado e a quota em D1. Manter a última cache com indicação de desatualização. A paginação não tratada de um endpoint causa recusa explícita; não se apresenta uma resposta parcial como completa.

## Reproduzir

Requisitos: Node 24 e Python 3. A chave é fornecida apenas por variável de ambiente `API_FOOTBALL_KEY`.

```sh
npm ci
python scripts/download.py
npm run backtest
npm run build
npm test
npx wrangler deploy --dry-run
```

A aquisição faz 30 pedidos: cobertura e quatro épocas para seis competições. Os dados brutos e as previsões individuais ficam em `data/`, ignorado pelo Git. `src/validation.json` inclui um hash SHA-256 do conjunto normalizado para detetar alterações da fonte. Uma recolha futura pode diferir por correções do fornecedor e por novos jogos de 2026.

O teste funcional de sincronização usa dados sintéticos identificados como tal; não é usado para alegações de precisão. O backtest usa exclusivamente os dados reais acima. Os 13 testes automatizados cobrem distribuição de probabilidades, separação temporal, amostra insuficiente, liquidação regulamentar, EV, odds, intervalos, imutabilidade, autenticação, cache, quotas, erros e sincronização com liquidação.

Publicação futura, apenas quando autorizada:

```sh
npx wrangler d1 migrations apply luxtips-analysis --remote
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

A configuração aponta exclusivamente para o Worker e a D1 do LuxTips. Não altera os outros projetos da conta. A fonte anterior pode ser recuperada pelo commit original `f467af92bd182bc9033b0d86b32e1d11b663929d`; não reutilizar a antiga chave de proxy publicada no HTML como credencial administrativa.

## Fontes técnicas

- https://www.api-football.com/documentation-v3
- https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

## Estado verificado nesta entrega (18/10/2026)

A interface e o processamento foram publicados no Worker existente. A primeira sincronização de cálculo em produção terminou com 54 jogos analisados nas seis competições, usando a cache inicial preenchida com os dados reais recolhidos diretamente da API nesta sessão. A ligação de leitura do plano respondeu corretamente a partir do Worker, mas as consultas de competições a partir do Worker devolveram erros de limite por minuto, mesmo com quota disponível na consulta direta. Por isso, **a atualização automática integral em produção ainda não está validada**. O aviso de carga inicial em cache permanece visível até existir uma recolha direta de jogos bem-sucedida.

O cron de 30 em 30 minutos está configurado; não foi aumentada a frequência nem contratado qualquer plano adicional. Os dados da cache conservam as datas de recolha originais; não se renovou artificialmente a sua validade. Após expiração, o fallback assinala desatualização e suspende recomendações. A resolução da resposta de limite do fornecedor ao Worker é o bloqueio operacional restante. A classificação deste estado como uma plataforma totalmente autónoma seria incorreta.
