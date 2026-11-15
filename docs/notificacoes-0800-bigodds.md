# Notificações de Futebol e Big Odds

Desde 15 de novembro de 2026, o push web está desativado em produção e os avisos
mantêm-se no Telegram. As rotas `/api/push/*` devolvem 410 e as subscrições antigas
são canceladas quando o dispositivo executa o cliente ou service worker atualizado.
Ver [registo da publicação](evidence/site-cleanup-2026-11-15/release.json).
O texto seguinte documenta o funcionamento histórico.

Publicado: 6 de novembro de 2026.

- Um resumo dos prognósticos do próprio dia após o bloqueio das 08h, em Europe/Lisbon (inclui mudança de hora).
- Novas entradas após as 08h para o próprio dia geram um aviso por seleção; jogos de dias futuros não geram avisos antecipados.
- As seleções já incluídas no resumo não repetem aviso individual. Odds atualizadas e reentradas com a mesma identidade não repetem avisos.
- Um novo boletim Big Odds ativo gera apenas “Existe uma nova Big Odds disponível.”, com ligação ao boletim. A manutenção do mesmo boletim não repete aviso.
- As subscrições existentes de Futebol recebem ambos os tipos de aviso.
- A mudança não envia notificações antigas. Os avisos têm uma janela de entrega/repetição de uma hora; novas entradas expiram também ao início do jogo. Entrega pelo sistema push do dispositivo.
- Os avisos correm depois da sincronização dos prognósticos e do Big Odds; entregas bem-sucedidas ficam registadas por dispositivo e evento.

Validação: 129 testes anteriores e 84 de produção passaram; sintaxe, hashes e build de publicação verificados. Novos testes cobrem bloqueio, verão/inverno, novas entradas, primeiro jogo tardio de um dia vazio, duplicações, atualizações de odds, migração e repetição após falha do fornecedor.
