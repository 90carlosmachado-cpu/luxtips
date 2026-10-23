# Luxtips

- Comunicar em PT-PT. Seguir as instruções globais do utilizador.
- O `index.html` da raiz é legado. O Worker atual foi recuperado em
  `recovered/worker.mjs`; a entrada de desenvolvimento é `src/worker.mjs`.
- Não refatorar o bundle recuperado. O teste verifica apenas as alterações
  localizadas previstas em `scripts/legacy-hook.mjs` e as exportações adicionais.
- Manter dez competições. Só as cinco em `src/openfoot/config.mjs` recebem xG.
- Não usar probabilidades/odds derivadas da OpenFoot como preços de casas.
- Identidades ambíguas, resultados divergentes e dados xG em falta devem falhar
  de forma fechada; não adivinhar equipas nem substituir valores em falta por zero.
- Novas ligações entre fornecedores requerem evidência em vários jogos e revisão
  da correspondência. Registo em `src/openfoot/team-links.mjs`.
- O enriquecimento é experimental. Não alterar prognósticos públicos ou promover
  o modelo sem validação e pedido explícito.
- O utilizador autorizou o modo real em 22-10-2026: `OPENFOOT_MODE=live` usa xG
  em novas previsões com cobertura suficiente e preserva as seleções já publicadas.
- O utilizador pediu explicitamente também o contexto diretamente em produção,
  sem fase de comparação: `PREDICTION_CONTEXT_MODE=live`. A recolha e os modelos
  estão em `src/context/`; guardar relógios de origem e declarar dados em falta.
- Âmbito final explícito: expulsões, evolução do marcador, lesões/onzes, xG sem
  penáltis e bolas paradas. Versão `luxtips-events-xg-live-v2`. Não ativar
  efeitos de descanso/jogadores dos helpers antigos sem novo pedido.
- `refreshContextForecasts` recalcula sem depender do backfill legado. Pode
  acrescentar previsões ao ledger e renovar caches; nunca reescrever publicações.
- A política contextual exige retorno esperado >=3% depois de reservar a
  divergência entre componentes; isto não equivale a um intervalo de confiança.
- Dados novos ficam em `openfoot_*`; o recálculo autorizado pode acrescentar
  previsões em `forecasts` e renovar caches operacionais.
- Publicações originais são imutáveis (triggers UPDATE/DELETE). Para pedidos de
  arquivo usar `openfoot_publication_archives`; novas publicações usam revisões e
  vistas `openfoot_current_*`, sem desligar os triggers originais.
- Não ler ou imprimir `.dev.vars`, `*.dev.vars`, `.env*` em saídas de ferramentas.
  Os scripts de validação podem usá-los em memória sem mostrar credenciais.
- Testes: `npm test`, `npm run check`; compilação sem publicar:
  `npx wrangler deploy --dry-run --outdir dist`.
- Operação atual: Workers Paid, CPU 30000 ms; cron por minuto, dados/contexto/
  cinco previsões sequenciais. Leituras públicas não iniciam manutenção.
- Todos os pedidos API-Football passam por `context/provider.mjs`, gate D1 único.
  Transporte Container privado configurado; não regressar ao fetch direto sem verificar
  as limitações do IP de saída. Não contornar quotas do fornecedor.
- Entrada de publicação: `src/cloudflare-entry.mjs`, que exporta `FootballRelay`.
  Namespace DO SQLite e aplicação Containers `luxtips-football-relay`, política
  `durable_object`. Manter metadata `containers: [{class_name:'FootballRelay'}]`
  em uploads manuais. Nunca passar segredos em metadados da imagem ou no código.
- O utilizador autorizou corrigir e publicar a operação completa. Orçamento local
  6000/dia dentro do Pro 7500; não confundir quotas operacionais com critérios.
- Só mercados já elegíveis podem ocupar lugares de publicação. Preservar mínimos
  60%/70%, odd >=1,25, frescura <6h e EV conservador >=3%.
- `scripts/refresh-football-local.mjs` é recuperação manual; o funcionamento normal
  não depende deste computador. Credenciais locais permanecem excluídas do Git.
- Não criar commits, push, aplicar migrações remotas ou publicar automaticamente.

- Correção autorizada em 22-10-2026: modelo v2, seleção independente por mercado
  em `context/selection.mjs`; até três jogos/dia, alternativas sem limite adicional
  e uma seleção por jogo. Mantém 60%/70%, odd 1,25, frescura <6h, amostra 12 e
  EV >=3%; reserva agora específica do mercado. xG parcial usa pesos por equipa
  e nunca inventa observações em falta. Não reutilizar o publisher legado no modo real.

- Revisão v7 em produção: política central em `context/policy.mjs`; publicação por dia,
  espera máxima 15 min sem prorrogação, prontidão em `context/readiness.mjs`.
  Ordenar todo o conjunto D1 do dia, nunca apenas o lote do chamador. Todos os
  caminhos, incluindo o legado, delegam no publisher atual e na sua lease.
- Odds em `context/odds.mjs`: paginação retomável, uma página/trabalho, continuação
  alternada com trabalhos normais; quatro estados distintos e retentativas limitadas.
  Não inferir clocks, fonte ou mercado; preservar preço e observação originais.
- O utilizador autorizou agora comparação PASSIVA com referência simples, sem
  alterar recomendações. Contrato/protocolo em `context/evaluation.mjs`. Usar
  primeira previsão válida nas últimas 24h e snapshot próprio das publicações;
  não reconstruir snapshots antigos, não atribuir métricas de outras versões.
  Estatística interna por mercado/competição e n; ROI apenas teórico pré-jogo.
- V7 publicada em 22-10-2026, 21:19 UTC: deployment
  `4404f1b4-f523-4519-96a0-460bb212032b`. Módulo remoto idêntico ao build local;
  bindings, namespace do relay, migração e segredos preservados. Sem commit/push
  desta revisão até à publicação. Ver `docs/revisao-robustez.md`.
- Investigação de 23-10-2026: `scripts/research-strength*.mjs`, offline e sem
  pedidos pagos. Candidato com prior 4 escolhido em 2024, verificado em 2025/26;
  dados retrospetivos e probabilidades não equivalem a odds/ROI. Não promover
  silenciosamente nem atribuir estes resultados ao modelo contextual completo.
- V8 publicada com autorização explícita em 23-10-2026, 07:48 UTC, versão
  `e2123062-1636-4279-973c-7a493d05512a`, modelo
  `luxtips-events-xg-prior4-live-v3`. `openfoot/strength.mjs` aplica prior 4 só
  à força base e ao ajuste xG nas cinco ligas suportadas; outras ligas e fits de
  detalhes continuam com prior 8. Não alterar limiares nem atribuir resultados
  antigos à v3. Helpers de investigação preservam explicitamente o prior do estudo.
- Correção de reagendamentos publicada na v8: jogos com equipas/identidade
  iguais invalidam apenas a cache de previsão, para permitir novo cálculo/xG.
  Mudanças de identidade continuam excluídas e registadas. Nunca reescrever as
  publicações ou snapshots antigos para acompanhar o novo início.
- Calibração investigada a pedido do utilizador: `scripts/calibration-research.mjs`
  e `research-calibration*.mjs` são apenas offline, nunca importar no Worker.
  Alpha 1,07 treinado em 2024/25 reduz parcialmente o viés em 2025/26, mas
  intervalos globais incluem zero e há regressão ligeira na Premier League.
  Sem promoção. Ver `docs/calibracao-favoritos.md`; não ajustar coeficientes
  para fazer aparecer seleções, não reduzir a reserva ou alterar critérios.

- Melhoria local de 23-10-2026 autorizada: objetivo exclusivo H/A (vitórias 1X2).
  Runtime/legacy e cron passam WINNER_MARKETS ao publisher; helpers genéricos
  preservam testes da política histórica. Não publicar automaticamente.
- Política de publicação winner-1x2-v1: até três vitórias/dia, mesmos critérios
  de amostra, preço, probabilidade e EV. Análises informativas não ocupam vagas.
  Alternativas antigas mantêm-se imutáveis no histórico e não consomem a nova
  capacidade de vitórias; nunca duplicar um jogo já publicado sem arquivo explícito.
- Não confundir v9 (release/interface/política) com novo modelo estatístico.
  CONTEXT_VERSION mantém v3; probabilidades e parâmetros não foram promovidos.
- Cache de odds conserva trios H/D/A completos por casa e timestamp, além do
  preço selecionado. Não promover raw caches sem verifiedReceipt. Novos
  snapshots de avaliação guardam comparação prospetiva emparelhada com mercado.

- V9 publicada com autorização explícita em 23-10-2026, 09:59 UTC; versão
  `e5b8b8de-ed6d-4290-b785-aee15587ac5f`. Sincronização GitHub autorizada
  depois da verificação em produção. Ver `docs/vitorias-1x2.md`.
