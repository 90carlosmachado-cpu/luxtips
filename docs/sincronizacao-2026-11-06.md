# Sincronização do LuxTips em 6 de novembro de 2026

## Referência confirmada

O repositório estava na revisão `178feede06aaa661d39753487dce555f4e21e34c`, de 24 de outubro. Foram recuperados diretamente do Cloudflare os 18 módulos do Worker `luxtips`, versão `8a39a26a-2b74-4308-a83b-49bdebe3f13d`, publicado em 6 de novembro às 10h38 UTC. Os módulos ficam em `production/` com os respetivos hashes SHA256 em `production/manifest.json`.

A configuração `wrangler.jsonc` aponta agora para `production/integration.js`. Preserva o nome, conta, data de compatibilidade, D1, browser, relay privado com Containers, limites, variáveis, cron e binding de serviço existentes. O serviço externo `luxtips-nba-sim` é uma dependência histórica preservada, não um módulo deste Worker. O separador público de NBA foi substituído por Big Odds.

Esta tarefa não publicou nenhum Worker, não executou migrações e não gerou um novo boletim. A mudança no GitHub não altera por si só a versão em produção.

## Conteúdo e separação de versões

- `production/`: código completo dos módulos publicados, sem reformatar nem reconstruir o bundle a partir de fontes antigas.
- `production/tests/`: testes de futebol e Big Odds da política v1, incluindo os dados para reproduzir a paridade numérica com xG.
- `src/`, `recovered/`, testes e documentos anteriores: preservados como histórico e ferramentas de investigação. Não são a entrada atual.
- `migrations/0010_bigodds.sql`: estrutura Big Odds utilizada na versão publicada.
- `docs/production-schema-2026-11-06.sql`: snapshot da estrutura completa D1, sem linhas de dados. Serve de referência; não é uma migração automática nem deve ser executado sobre uma base existente. Inclui a estrutura aditiva 0011 já presente remotamente, mas não usada pela v1.
- `pending/bigodds-withdrawn-reuse/`: patch independente da correção ainda não publicada, com três testes adicionais e a migração 0011 para reprodução numa base nova.
- `research/`: código e relatórios compactos das simulações. Arquivos grandes de entradas e matrizes permanecem nos estudos entregues, ligados no README dessa pasta.

O limite de dois prognósticos por mercado não foi aplicado. A correção da reutilização de jogos retirados também não foi aplicada aos módulos publicados. Não existe um comando de recálculo pendente desta sincronização.

## Validação

- 129 testes históricos e 54 testes da versão publicada passaram.
- A paridade numérica cobre 278 janelas de jogos e os dez boletins de referência da candidata histórica. Isto verifica implementação; não prova taxas de acerto futuras.
- `npm run check`: sintaxe histórica e integridade dos 18 módulos passaram.
- `npm run build:check`: Wrangler compilou a entrada atual com `--dry-run` sem publicar, preservando relay, D1, browser e serviço.
- Patch pendente aplicado e verificado numa cópia isolada: 57 testes passaram. Mantido fora da entrada ativa até nova autorização de publicação.
- Varredura dos novos módulos, estudos e patch sem correspondências para padrões conhecidos de tokens ou chaves privadas. Nenhum ficheiro de variáveis local foi incluído.

## Segredos e dados

Os valores de `ADMIN_TOKEN`, `API_FOOTBALL_KEY`, `AUTH_PASSWORD`, `OPENFOOT_API_KEY` e `PWA_VAPID_JWK` continuam exclusivamente nos secrets do Worker. O GitHub contém apenas os nomes. Os dados D1 de jogos, odds, assinaturas push, boletins e resultados não são exportados nesta tarefa. Para recuperar a operação, são necessários a base D1 e os bindings/segredos existentes; o repositório é a fonte do código, não uma cópia dos dados operacionais.

Não executar `wrangler deploy`, aplicar migrações ou utilizar o comando administrativo de geração sem um pedido explícito. Para trabalhar localmente: Node 24 ou superior, `npm ci`, `npm test`, `npm run check` e `npm run build:check`.
