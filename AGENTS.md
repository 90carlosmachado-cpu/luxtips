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
  penáltis e bolas paradas. Versão `luxtips-events-xg-live-v1`. Não ativar
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
