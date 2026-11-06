# Big Odds v2 operacional

Publicação autorizada em6/11/2026 às12h15UTC, versão4afd058a-d21a-4952-b6e1-cce8a8b89e78. Mantidos os bindings, secrets, relayContainers, configuração, quotas e probabilidades existentes. Os19módulos remotos foram comparados integralmente com os módulos locais depois da publicação.

A política passa a bigodds-xg90-prior2-market50-no-unders-v2 apenas pela reutilização de jogos de boletins marcados explicitamente como substituídos. Não muda o modelo, o ranking, as odds mínimas, a lista de mercados ou os limites do boletim. O histórico continua imutável por boletim. Boletins normalmente perdidos/ganhos/anulados continuam a bloquear os seus jogos. A estrutura aditiva0011já existia remotamente, vazia; não foi reaplicada.

O adaptador passou a guardar Result/Total Goals e Results/Both Teams Score, incluindo contrapartes. Os códigos passivos são excluídos da seleção de odds e o Big Odds não os mapeia como mercados públicos. Os registos são os preços reais da casa e preservam os relógios originais; só são recolhidos dentro das chamadas operacionais existentes, sem chamadas de fornecedor adicionais. Não são fabricados grupos ou contrapartes em falta.

A calibração foi testada antes de decidir a promoção, com6448jogos em2024–25 para treino e2659em2026 para avaliação, incluindo106com xG causal. Alpha0,855045; melhoria global pequena e intervalo semanal95% incluindo zero; piora no subconjunto com xG. Logo, não foi promovida. Protocolo e resultados completos em research/bigodds-calibration-current/.

Validação:129testes históricos+61de produção, incluindo arquivo passivo, ausência de influência dos combos nos preços selecionáveis, snapshots imutáveis e reutilização. Sintaxe, hashes e build Wrangler em dry-run passaram. Não foi implementada a segunda janela diária: permanece08h Europe/Lisbon. A execução extraordinária foi autorizada pelo utilizador nesta tarefa.

## Resultado do ciclo extraordinário

Ciclo confirmado às12h16UTC, pedido owner-authorized-v2-1793967333563 consumido uma vez e sem comando pendente. Boletim anterior arquivado como substituído, sem perda de histórico. Novo boletim2e32a273-4ad8-44d2-b43b-a0d533f05f15:9seleções,odd8,29587314917969,Pinnacle. Três jogos usam xG e seis o fallback por amostra insuficiente. Uma seleção veio do boletim substituído inicial e quatro do boletim anterior, todas ainda futuras. Há exatamente um boletim ativo.

WillemII–PECZwolle de hoje entrou novamente. A recolha passiva já registou37odds Result/Total Goals e15Results/Both Teams Score na primeira verificação, sem as tornar selecionáveis. API Big Odds HTTP200, interface móvel390px sem overflow. Os dados detalhados da verificação estão em docs/evidence/bigodds-v2/cycle.json.
