# Foco em vitórias 1X2 — implementação local

Base: main 9316e243db2b40ae51606d9d9aefe65c777b19fd.
Âmbito autorizado em 23-10-2026: melhorar a plataforma com foco em vitórias
casa/fora. Implementação inicial sem alterações remotas; deploy autorizado depois pelo utilizador.
Sincronização com o GitHub autorizada depois do deploy; sem migrações.
Release local: `2026-10-23-winner-focus-v9`; modelo estatístico continua
`luxtips-events-xg-prior4-live-v3`, sem alteração de probabilidades, pesos,
prior, reserva ou limiares. Não há nova taxa de acerto ou ROI demonstrado.

## Resultado funcional

- `/api/games` em modo live usa apenas SELECT e devolve recomendações publicadas
  de H/A e `winnerAnalyses`, uma análise por jogo. Não inicia manutenção nem
  escreve caches. `Cache-Control: no-store` evita dados de elegibilidade antigos.
- Interface distingue recomendações publicadas de vitórias prováveis informativas.
  Odd, casa, hora, probabilidade do modelo e referência sem margem são visíveis;
  o detalhe explica a reserva, EV e odd mínima sem promover análise a aposta.
- Uma análise é exibida com amostra >=12, fontes/relógios válidos, odd real
  >=1,25 com menos de seis horas e favorito >=60% no modelo ou no mercado
  validado. Se só o mercado atingir 60%, a origem é explícita e a recomendação
  continua a exigir os 60% no modelo e todos os restantes critérios originais.
- Não se calibra automaticamente a probabilidade pelo mercado. A disponibilidade
  do consenso não implica preço acessível numa casa nem vantagem rentável.
- Novas publicações feitas pelo cron ou pelo publisher legado são só H/A, até
  três por dia. Mercados de golos deixam de concorrer. Helpers genéricos mantêm
  a política anterior exclusivamente para regressão/reprodução explícita.
- Alternativas já publicadas não são apagadas nem arquivadas automaticamente.
  Ficam no histórico e não consomem lugares da nova capacidade de vitórias.
  Um jogo já publicado continua protegido de uma segunda seleção, mesmo se
  a antiga for de golos. Libertar esses jogos exige arquivo explícito posterior.
- Publicações de vitória permanecem visíveis no seu dia após início/expiração
  da odd, preservando o snapshot. Análises não publicadas expiram ao início ou
  quando a odd perde frescura; não são adicionadas ao histórico de recomendações.
- Prontidão `partial_available` deixa de prolongar o estado de atualização do
  ecrã quando o prazo de espera já terminou.

## Odds e referência de mercado

`retainedQuotes` mantém observações H/D/A por bookmaker e provider timestamp,
além das melhores odds usadas pela seleção. `saveQuotes` persiste esses dados
com os relógios originais, incluindo paginação e reinícios. A recolha passa a
avaliar disponibilidade de H/A; ausência de mercados de golos não cria retentativas
num produto dedicado a vitórias.

`marketReference` normaliza cada trio completo da mesma casa/instante e depois
calcula a média das probabilidades. Cada casa tem só um voto (último trio completo
válido). Não junta seleções de timestamps diferentes e rejeita preços divergentes
para a mesma seleção/casa/instante. A referência tem relógios explícitos.

Caches antigas que só guardaram melhores preços não se transformam magicamente
em trios completos. A referência recupera gradualmente nas próximas recolhas
verificadas. Respostas brutas não verificadas não são convertidas em recibos válidos.
A assinatura de inputs inclui a referência para evitar reter uma cache sem ela
quando só os trios disponíveis mudaram e o melhor preço ficou igual.

## Avaliação prospetiva

Os novos snapshots registam a referência de mercado disponível no corte.
`marketComparison` compara modelo e mercado nos mesmos eventos válidos, com
Brier, Log Loss e calibração binária por H/D/A e competição. Ausência de referência
não vira zero nem provoca reconstrução de um snapshot antigo. A referência
original de frequências da liga continua disponível separadamente.

Não se afirma uma melhoria estatística do motor por corrigir o site. A avaliação
prospetiva e a reprodução dos scripts externos continuam necessárias para
escolher entre Poisson/xG, mercado, Elo, Dixon–Coles e regressão supervisionada.
Não foram recebidos scripts ou resultados brutos do estudo Perplexity; não se
promove um substituto com base nas métricas não reproduzidas desse PDF.
O registo automático de odds de fecho/CLV ainda não foi implementado nesta fase.

## Validação

Testes: `npm test`; consistência do bundle: `npm run check`.
Compilação local: `npx wrangler deploy --dry-run --outdir <pasta-temporaria>`.
Sem alterações a dependências, configuração ou migrações.

Os testes específicos cobrem trios por casa, normalização, paginação, proveniência,
relógios, amostra, vitórias visitantes, discrepância modelo/mercado, EV negativo
visível apenas como análise, API sem escritas, publicação 1X2 pelas duas entradas,
capacidade independente de alternativas antigas, imutabilidade e interface real
executada com respostas simuladas. Resultado local: 105/105 testes passaram; sintaxe/bundle e compilação dry-run
passaram. O ensaio visual em Chromium ficou indisponível: o ambiente não tinha
browser instalado e a transferência devolveu ficheiros inválidos. O JavaScript
real da página foi executado e validado com DOM/respostas simulados; desktop e
mobile em navegador real continuam pendentes antes da publicação.

## Transição e publicação futura

Antes de publicar: confirmar HEAD e deployment remotos, rever diff, preservar
bindings/segredos/relay e pedir autorização explícita para deploy. Não há migração.
Depois de autorizado e publicado: verificar API/HTML, cron, primeiras recolhas de
trios completos e primeiras decisões H/A, sem forçar recomendações. Se não houver
EV, a lista de recomendações pode continuar vazia; os favoritos elegíveis ficam
visíveis na análise. Fazer rollback de código se houver regressão operacional,
sem reescrever o histórico.

## Publicação autorizada — 23-10-2026

V9 publicada às 10:59 de Lisboa, 100% do tráfego. Versão Cloudflare
`e5b8b8de-ed6d-4290-b785-aee15587ac5f`; deployment
`7cb1241e-2a99-4144-97e4-108e931692c9`. Módulo remoto idêntico ao build:
518963 caracteres; FNV-1a64 `fb4c3a88e982213b`.

Preservados todos os bindings (incluindo namespace FootballRelay), quatro
segredos, migração DO existente, CPU 30000 ms, observabilidade e cron por minuto.
Não se aplicaram migrações nem se arquivaram publicações. A execução automática
pós-deploy confirmou `winner-1x2-v1`, cinco recálculos no lote, zero falhas e
prontidão completa nos três dias.

O site foi aberto e verificado no Edge: novo título, recomendações separadas
da análise, dez competições e Stuttgart visível como análise informativa.
A referência sem margem continua dependente das próximas recolhas verificadas
de trios completos; não foram inventados recibos para preencher caches antigas.
A rede do executor devolveu 403 ao domínio público; a inspeção pelo navegador
confirmou o acesso e renderização reais.
