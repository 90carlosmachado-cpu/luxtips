# Correção pendente da reutilização de jogos

Esta alteração NÃO está publicada no Worker. O código ativo está em `production/`.
O patch permite reutilizar jogos apenas de boletins explicitamente substituídos, sem reescrever snapshots. Mantém um só boletim ativo.

A migração aditiva 0011 já existe no D1 remoto, vazia e sem utilização pela v1. O patch inclui a migração para reproduzir a alteração numa base nova. Não reaplicar cegamente em produção.

Para rever localmente, numa branch separada e com a árvore limpa:

```sh
git apply --check pending/bigodds-withdrawn-reuse/implementation.patch
git apply pending/bigodds-withdrawn-reuse/implementation.patch
npm run test:production
```

57 testes passaram antes desta sincronização. A publicação foi bloqueada por falta de autorização explícita para esse novo deploy. A autorização para sincronizar o GitHub não é autorização para publicar esta correção. Nenhum comando de recálculo fica pendente.
