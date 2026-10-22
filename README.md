# Luxtips — integração OpenFootAPI

## Estado atual — 22-10-2026

Modelo ativo `luxtips-events-xg-live-v2`, publicado por autorização explícita.
Importados 4484 jogos com xG e 1560 detalhes validados de remates/acontecimentos.
Mantém dez competições e acrescenta xG às cinco principais quando existe cobertura.
O detalhe usa xG sem penáltis, jogo corrido/bolas paradas, evolução do marcador e
exclusão de jogos com expulsões conhecidas. Lesões e onzes são contexto disponível;
não existe ainda um impacto individual quantificado nas probabilidades.
Comparações de modelos estão desativadas no modo real. A avaliação prospetiva do
novo modelo está pendente; os resultados antigos não demonstram a sua precisão.
Ver `docs/contexto-em-producao.md` para regras, cobertura e limitações atuais.
Foram aplicadas as quatro migrações. Os 54 testes, verificação estática e compilação
passaram. Cron por minuto com trabalhos sequenciais e cinco cálculos por bloco;
xG conserva os minutos 7/37. Janela de hoje e dois dias seguintes.
Workers Paid confirmado, limite de CPU 30000 ms. As leituras públicas não iniciam
trabalhos de manutenção: evita cancelamento após a resposta e concorrência por visitas.
API-Football usa um relay privado num Container Cloudflare `lite`, controlado por
Durable Object. A chave fica no ambiente de execução do processo Node. Imagem
gerida `cloudflare/debian-trixie`, sem Docker local nem dependências adicionais.
Desliga após 60 segundos de inatividade. O custo usa as franquias do Workers Paid
e eventual consumo adicional de Containers; consultar o painel da conta.
O fetch do Worker e o ensaio Browser Run receberam limites; Browser Run permanece
apenas como implementação alternativa inativa. Não é o transporte de produção.
Gate D1 único, espaçamento de 1,2 segundos no relay, backoff, 6000 pedidos/dia
dentro do Pro 7500; contexto até 1500/dia. A sequência completa tem uma lease
expirável para evitar concorrência entre ciclos e chamadas administrativas.
Seleção `independent-markets-v1`: cada mercado é avaliado diretamente, sem
exigir favorito à vitória. Até três jogos por dia, um mercado por jogo;
permite várias alternativas. Divergência calculada para o próprio mercado;
xG com peso por equipa proporcional à amostra/cobertura/recência.
mantém 60% vencedor, 70% alternativa, odd >=1,25, idade <6h e EV conservador >=3%.
Atualização manual validada: 3188 jogos da época, 50 consultas de odds e 68
registos de contexto, sem erros. Dados e relógios reais importados em produção.

As secções abaixo conservam o registo da implementação inicial; os números e
comportamentos históricos entretanto substituídos não descrevem o estado atual.

Publicada em modo real em 22-10-2026, por pedido explícito do utilizador.
Versão inicial Cloudflare: `055eb916-0afb-4120-abb0-82aeb47071c3`.
Versão após arquivo pedido pelo utilizador: `30e0ee75-364d-4716-b1a9-c1bde8ec0a93`.
Domínio verificado: `https://luxtips.90carlosmachado.workers.dev`.

## Base recuperada

O GitHub `90carlosmachado-cpu/luxtips`, branch `main`, contém apenas o HTML antigo
(commit `f467af9`, 24-01-2026). Não corresponde ao Worker atual.

`recovered/worker.mjs` é uma cópia do código publicado no Worker `luxtips`, recuperada
da API Cloudflare. SHA-256: `5b3ab885b0235b34782831d47ed3f3e179285d090dd4ff8e6ee75ee1ecb5ba30`.
Versão ativa observada: `e923b8b3-d909-478f-accb-478c69344593`.
No fim da implementação a versão ativa passou a
`9b0ef18a-c146-4f46-82ea-e312b1225fed`, por atualização do segredo OpenFoot.
O conteúdo do código continuou igual: 334481 caracteres, FNV-1a64
`3c19ca0e0e56309d`, comparado localmente e na API Cloudflare.
`src/legacy-worker.mjs` preserva o bundle com três alterações localizadas e
verificadas por `scripts/legacy-hook.mjs`: hook de enriquecimento antes da seleção,
calibração antiga desativada para probabilidades com xG e versão própria no ledger.
Acrescenta também exportações de funções para comparação controlada. Não é uma recuperação dos
ficheiros originais de desenvolvimento: trata-se do bundle publicado.

O HTML antigo na raiz foi preservado. O Worker atual serve o HTML incluído no
bundle. Não alterar nem publicar o projeto Pages como parte desta integração.

## Arquivo de seleções visíveis

Em 22-10-2026 o utilizador pediu para retirar as duas seleções futuras da vista
e permitir novo cálculo. Os triggers originais proíbem UPDATE/DELETE das
publicações. Essas proteções foram preservadas. A migração
`0002_publication_archive.sql` acrescenta marcadores de arquivo, revisões imutáveis
e vistas de publicações ativas. As leituras e os limites diários usam essas vistas;
novos ciclos acrescentam revisões sem substituir o registo original. Um teste
verifica exclusão, preservação do histórico, recálculo do mesmo jogo e deduplicação.

Foram arquivados Utrecht–PEC Zwolle (1552199) e Stuttgart–Mönchengladbach
(1575196); a cache desses dois cálculos e da lista pública foi invalidada.
O domínio real confirmou zero seleções visíveis e oito registos históricos
preservados. Há também cópia integral em `meta`, chave
`archive:published-reset:2026-10-22:1792679072242`.

Os dois cálculos retirados ainda eram do modelo anterior. O modo real permite
xG, mas a importação inicial não tinha cobertura suficiente para o aplicar.
Não confundir `OPENFOOT_MODE=live` com confirmação de que uma previsão específica
usou xG: verificar `prediction.xgEnrichment.active` e a versão da previsão.

## Comportamento

- Mantém as dez competições: 94,39,140,78,135,61,88,2,3,848.
- Recolhe xG apenas em Inglaterra, Espanha, Alemanha, Itália e França.
- API-Football continua a fornecer jogos, resultados, odds e contexto existentes.
- OpenFoot `/matches/{id}/xg` fornece medições históricas de remates. Não usar os
  valores derivados de `/context` nem as suas odds calculadas como odds reais.
- O modo `shadow` calcula previsões experimentais em tabelas próprias. Não altera
  a publicação, o histórico existente nem os filtros de seleção.
- O modo `live` foi autorizado em 22-10-2026: as novas previsões usam xG quando
  passam os limiares de cobertura; os restantes casos usam o modelo anterior.
- Publicações já existentes não são substituídas. A recolha é gradual.

## Correspondência e dados

Mapeamento exige competição, época, equipas, posição casa/fora, horário e resultado
regulamentar compatíveis. Nomes desconhecidos são comparados apenas após
normalização de acentos/pontuação. Não existe correspondência aproximada por nome.
O registo revisto contém 94 ligações de equipas suportadas por pelo menos três
jogos coincidentes e sem outro identificador concorrente. Evidência em
`docs/evidence/team-links.json`. Novas equipas com nomes diferentes ficam pendentes.

No arquivo real 2025/26, 1750 dos 1752 jogos OpenFoot foram associados. Dois ficaram
sem correspondência e foram excluídos; ver `docs/evidence/mapping-validation.json`.
Isto valida a identidade dos jogos, não a disponibilidade de xG em todos eles.
O xG pago foi consultado e validado em um jogo por cada liga.

Valores em falta nunca são convertidos em zero. Totais xG são reconciliados com os
remates, com tolerância de arredondamento. São conservados fornecedor, licença,
hora de recolha e resultado de referência. São rejeitados dados inconsistentes,
jogos ainda em curso e prolongamentos. As respostas observadas identificam a
origem FotMob e a licença `Unlicensed-Beta (owner-approved factual data)`;
a especificação descreve o serviço como beta e sem SLA de disponibilidade.

Importação retomável: checkpoint e página são gravados numa transação. A época
atual é atualizada após a primeira importação de até três épocas. Limites iniciais:
20 pedidos por execução, 500/dia e espera persistente após HTTP 429. Os registos xG
importados servem como cache persistente; a segunda execução não os consulta outra
vez. Erros não apagam dados nem propagam mensagens que possam conter segredos.

## Modelo experimental

Mantém os parâmetros e a mistura multiescala do modelo publicado. Apenas substitui
os alvos históricos de treino por `50% golos + 50% xG` quando existe observação
validada. O peso de 50% é uma hipótese inicial, não uma calibração demonstrada.
Requer pelo menos 12 jogos com xG por equipa, 70% de cobertura do histórico elegível
e um jogo com xG nos últimos 45 dias. Caso contrário, abstém-se.

Cada previsão conserva a previsão publicada e um controlo recalculado com o mesmo
histórico e a mesma hora, mas sem xG. O relatório compara Brier multiclasse e log
loss em pares prospetivos. Não promove modelos automaticamente nem afirma lucro.
As observações recolhidas hoje não são apresentadas como informação disponível no
passado. Não há ainda evidência prospetiva de melhoria.

## Desenvolvimento e validação

Node.js 24+. Wrangler é apenas uma dependência de desenvolvimento, fixada no
lockfile. Nenhuma nova dependência de execução.

```powershell
npm ci
npm test
npm run check
npx wrangler deploy --dry-run --outdir dist
npx wrangler dev --local --port 8791
```

`npm run probe:openfoot` valida o plano e recolhe amostras pagas.
`node scripts/verify-history.mjs` verifica todas as páginas da época 2025/26.
`node scripts/pilot-local.mjs` ensaia a importação paga em SQLite na memória.
Os ficheiros em `work/` são locais e estão excluídos do Git.
As fixtures de teste preservam apenas dados desportivos e atribuição; não contêm
chaves, identificadores da subscrição ou respostas de autenticação.

## Configuração e publicação

Segredos existentes: `ADMIN_TOKEN`, `API_FOOTBALL_KEY`, `AUTH_PASSWORD` e
`OPENFOOT_API_KEY`. Nunca os escrever na configuração, no Git ou nos relatórios.
Para ensaios locais, usar `.dev.vars`; `.dev.vars`, `*.dev.vars` e `.env*` estão
ignorados. Nenhuma chave precisa de ser enviada pelo chat.

Antes de publicar, voltar a confirmar a versão ativa e os bindings remotos para
não substituir trabalho de outra sessão. Preservar todos os segredos e manter
as dez competições, cron `7,37 * * * *` e orçamento API-Football existentes.
O orçamento local de 600 pedidos/dia foi copiado do Worker, não do limite
comercial do plano; não foi aumentado nesta alteração.

Foi aplicada `migrations/0001_openfoot_shadow.sql` à D1 existente e publicado
o Worker com `OPENFOOT_MODE=live`. A migração cria apenas tabelas e
índices próprios; não modifica tabelas operacionais. A importação inicial será
gradual. Desativar com `OPENFOOT_MODE=disabled`, preservando os dados recolhidos.

Diagnóstico, protegido pelo `ADMIN_TOKEN`:

- `GET /api/admin/openfoot`: importação, cobertura e previsões guardadas.
- `GET /api/admin/openfoot?report=1`: comparação prospetiva por liga e global.

Confirmar no domínio real que as rotas públicas conservam o comportamento, que o
novo diagnóstico rejeita pedidos não autenticados e que o cron recolhe xG.
Essas verificações passaram: saúde/página/jogos HTTP 200, diagnóstico HTTP 401,
dez competições, quatro segredos e cron preservados; primeiras observações xG
gravadas em produção. Os testes automatizados são agora 27 e passaram.
Não publicar novas alterações sem autorização explícita.
