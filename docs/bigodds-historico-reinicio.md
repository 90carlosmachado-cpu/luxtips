# Reinício do histórico Big Odds

Pedido explícito em6/11/2026: começar a acompanhar apenas o boletim atual. Publicado na versão e0ccf26d-8c18-4830-87b2-006da34fa02f.

O estado privado bigodds:history_reset guarda startAt1793967401328 e keepTicketId2e32a273-4ad8-44d2-b43b-a0d533f05f15. A API, paginação e estatísticas consideram apenas boletins criados a partir desse instante. O boletim atual continua ativo, com9seleções e odd8,29587314917969. Estado verificado:1boletim,0ganhos,0perdidos,0anulados,1ativo. A interface ignora boletins antigos carregados quando deteta o novo início.

Não foram apagados snapshots técnicos nem resultados. Continuam disponíveis exclusivamente para resolução, imutabilidade e restrições de reutilização, sem contaminar o histórico visível ou as estatísticas reiniciadas. Não foi gerado nem substituído qualquer boletim nesta operação. Futebol inalterado.

As seleções de vitória agora mostram o nome da equipa: Benfica vence, em vez de Visitante vence, e o equivalente para a equipa da casa. Trata-se apenas de apresentação; o snapshot original mantém-se imutável.

63testes de produção passaram, incluindo isolamento das estatísticas, paginação, preservação do boletim atual e liquidação após reinício. Sintaxe, hashes e compilação dry-run passaram. API200 e página390px sem overflow confirmadas; texto Benfica vence presente e Visitante vence ausente do boletim atual.
