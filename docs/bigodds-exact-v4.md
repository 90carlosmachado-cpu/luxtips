# Big Odds — otimizador exato v4

Autorização explícita do titular em 14/11/2026: commit, publicação, reinício do histórico e ciclo extraordinário.

Política: `bigodds-exact-ev-betano-v4`. Odds 8–15, 5–12 seleções, uma por jogo, sem repetir equipas. Preserva o cálculo de probabilidades xg90/prior2 e mistura 50/50; preserva direção analítica antes do preço. Mercados e fonte executável Betano mantidos. Combos estimados não são cotações e não entram na publicação.

O runtime usa `analyzeTicketExact`, mantém alternativas por jogo, exige EV individual >=0 e EV conjunto >=3%. Limites condicionais às probabilidades fornecidas e à independência: não são prova de rentabilidade ou calibração. Pesquisa incompleta devolve search_limit sem publicação. O seletor sequencial antigo permanece apenas para replay histórico.

O publisher revalida preços/probabilidades/equipas/EV. Decisões guardam todos os candidatos em `openfoot_state` (`bigodds:decision:<uuid>`) e diagnóstico `bigodds:last_selection`, incluindo quando não existe boletim. Regras 08h e um boletim ativo permanecem.

Integração baseada no código remoto da versão `1bddff44-14ed-4cb1-a37d-db3803b4d3ce`, não no bundle antigo do GitHub. `nations-league.mjs` é uma cópia exata de uma dependência já ativa que faltava em production no repositório; não altera Futebol. Não publicar o restante bundle antigo do repositório por cima do remoto.

Validação local: 16 testes do pacote de auditoria (incluindo 1000 conjuntos aleatórios vs enumeração independente), mais 10 testes de integração SQLite do runtime, todos aprovados. Executados em Node 22.16.0; o projeto recomenda Node >=24. Suite integral histórica e build Wrangler não executados neste ambiente. Testes de integração versionados: `node --test production/tests/bigodds-exact-integration.test.mjs`.

Publicação: substituir somente bigodds.mjs e bigodds-model.mjs e acrescentar bigodds-optimizer.mjs por content PUT, preservando os outros módulos, configuração e segredos. Validar hashes após publicação. Estado final e versão de deployment devem ser registados após confirmação.

Reinício autorizado: preservar triggers e snapshots imutáveis, guardar recuperação, retirar os boletins antigos da apresentação/contadores com history_reset e marcá-los como replaced para permitir a reutilização dos jogos ainda futuros. Não apagar fisicamente a evidência. Arquivar o ativo e anular pendentes antigos, sem alterar resultados Futebol. Enfileirar uma única manual_rebuild com a política nova e verificar manual_result pelo requestId. Não forçar aposta quando não existir múltipla elegível.
