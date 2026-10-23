# LuxTips

## Foco exclusivo em vitórias 1X2

V9 publicada com autorização explícita em 23-10-2026, 09:59 UTC.
Inclui a correção v10: análises mantêm-se visíveis com odds expiradas,
assinaladas sem recomendação e sem EV atual.
Ver [âmbito, validação e transição](docs/vitorias-1x2.md). A descrição da v8
abaixo conserva o estado anteriormente publicado.

Prognósticos em Cloudflare Workers/D1, API-Football e OpenFootAPI/FotMob.
Dez competições; xG nas cinco principais. Cartões simples: jogo, seleção,
odd registada e estado.

## Versões verificadas

Base da revisão: main `1fe4e4f293ad1295b16da769753ec902ede03aae`.
Antes da revisão, o HTML público coincidia com essa main (release v6).
A release `2026-10-23-strength-reschedule-v8` foi publicada em 23-10-2026,
07:48 UTC. O módulo remoto coincide integralmente com a compilação local.
Modelo: `luxtips-events-xg-prior4-live-v3`. Regularização 4 no ajuste de força das
cinco ligas com xG; peso xG até 50%, mistura temporal e ajustes de detalhe mantidos.
Restantes cinco competições com regularização 8. Critérios, fornecedores,
subscrições, bindings e quotas preservados. A sincronização integral com o GitHub
foi solicitada em 23-10-2026; inclui código, testes, documentação e relatórios.

Relatórios preservados: [docs/reports](docs/reports/README.md). A calibração dos
favoritos continua exclusivamente em investigação offline, sem ativação no Worker;
ver [a análise](docs/calibracao-favoritos.md). Credenciais, bases de dados e
ficheiros operacionais locais não fazem parte do repositório.

## Seleção

Estudo histórico offline solicitado em 23-10-2026: `node scripts/research-xg.mjs`
e `node scripts/research-xg-report.mjs`. Usa apenas ficheiros já existentes em
`work/`, sem chamadas pagas ou escritas em produção. Congela protocolo e escolha
no período de desenvolvimento antes de avaliar a época atual. É um estudo
exploratório de sensibilidade da mistura golos/xG, não validação do modelo
contextual completo nem backtest de apostas: disponibilidade histórica dos dados
e odds pré-jogo não estão comprovadas. Não promover a variante que vencer no
teste depois de consultar esse teste. Ver os avisos e dimensões das amostras no
relatório gerado em `../../outputs/Estudo-xG-LuxTips.html`.

Investigação adicional: `node scripts/research-strength.mjs`,
`node scripts/research-strength-upcoming.mjs` e
`node scripts/research-strength-report.mjs`. Compara regularização 4/8/16,
mantendo xG e critérios. O relatório inclui resultados negativos, incerteza por
blocos, épocas já observadas e limites de disponibilidade histórica/odds.
As previsões futuras de investigação têm versões próprias e revisões arquivadas
localmente; não são recomendações públicas.

Correção de 23-10 publicada na v8: recuperar o
recálculo após reagendamento com a mesma identidade, preservando os snapshots
e publicações anteriores. A avaliação da v3 usa apenas os novos snapshots;
as publicações existentes mantêm o seu modelo e os seus dados originais.

- Hoje e os dois dias seguintes, no calendário de Lisboa.
- Até três jogos/dia; uma seleção/jogo; várias alternativas permitidas.
- Vitória >=60%; alternativa >=70%; amostra efetiva >=12.
- Odd real >=1,25; idade <6h; observação anterior à publicação e início.
- EV >=3% após a divergência específica do mercado. Esta divergência não é
  intervalo de confiança nem taxa de acerto demonstrada.
- Mercados independentes do favorito 1X2. Sem preenchimento artificial de vagas.

Um dia com entradas pendentes aguarda até 15 minutos, sem bloquear outros dias
nem prolongar o prazo por novas tentativas. Depois avalia todo o conjunto
disponível, ordenado em conjunto. Recuperações só ocupam vagas livres; publicações
existentes nunca são substituídas. Todas as entradas convergem na mesma política,
lease e INSERT condicionado. Arquivo e revisões mantêm-se imutáveis.

## Operação

Entrada `src/cloudflare-entry.mjs`; módulos atuais em `src/context/` e
`src/openfoot/`. O `index.html` da raiz é histórico. O original está em
`recovered/worker.mjs`; `scripts/legacy-hook.mjs` e `scripts/current-ui.mjs`
geram `src/legacy-worker.mjs`. Não editar bundles à mão.

Cron por minuto: dados, contexto e cinco cálculos sequenciais. Continuações de
odds paginadas alternam com trabalhos normais, sem aumentar trabalhos/pedidos
por ciclo. A página consulta dados a cada cinco minutos. Leituras públicas não
iniciam manutenção. XG mantém os minutos 7/37.

Odds distinguem resposta incompleta, mercado indisponível, cotação expirada e
falha temporária. Retentativas limitadas, cache negativa e renovação antes da
expiração. Nomes exatos, identidade, casa, preço e relógios são preservados;
handicap fica excluído até validação da convenção de sinal do fornecedor.

Mantém Container privado `FootballRelay`, gate D1, espaçamento 1,2 s e backoff.
Quotas existentes: API-Football 6000/dia dentro de Pro 7500; contexto 1500/dia;
OpenFoot 500/dia. Não criar serviços nem aumentar limites.

## Avaliação própria

Protocolo em [docs/revisao-robustez.md](docs/revisao-robustez.md).
A primeira previsão válida nas últimas 24h por jogo/início/versão entra na
avaliação de previsões. A seleção publicada é avaliada no seu próprio snapshot.
Snapshots guardam versão, referência passiva, hash de entradas, contagens,
features/estimativas e relógios. Não duplicam o arquivo bruto a cada cálculo.

Brier binário, Log Loss binária e calibração em dez intervalos fixos por mercado
e competição, com n. Referência: frequência histórica de cada evento na competição,
guardada no mesmo instante. Não altera recomendações nem afina pesos/limiares.
Snapshots antigos sem o novo contrato de proveniência não são reconstruídos.

Após novos resultados, o trabalho existente atualiza um resumo no máximo uma
vez por dia. O diagnóstico protegido permite atualização a pedido. ROI é teórico
à odd pré-jogo registada; não há registo de apostas executadas. Não existe painel
técnico na página principal nem atribuição de métricas antigas à versão atual.

## Desenvolvimento

Node >=24: `npm ci`, `npm test`, `npm run check`.
Compilar sem publicar: `npx wrangler deploy --dry-run --outdir dist`.
São necessárias as quatro migrações existentes; esta revisão não acrescenta tabelas.
Diagnóstico: `GET /api/admin/openfoot?context=1`, protegido por `ADMIN_TOKEN`.

Segredos apenas no Cloudflare/ficheiros locais ignorados. Preservar D1, os quatro
segredos e bindings, incluindo `containers: [{class_name:'FootballRelay'}]` em
uploads manuais. Não fazer commit/push/deploy sem autorização. Para reverter,
usar a versão anterior do Worker, preservando os dados e ledgers.
