# Atualização em 6 de novembro de 2026

A correção foi agora aplicada e publicada na versão `4afd058a-d21a-4952-b6e1-cce8a8b89e78`, com autorização explícita para implementação e novo ciclo. O patch abaixo fica como registo histórico; NÃO aplicar novamente. O estado anterior é conservado abaixo.

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
