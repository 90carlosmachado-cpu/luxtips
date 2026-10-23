# Publicação v8 — 23-10-2026

Publicada com autorização explícita às 08:48 de Lisboa (07:48 UTC).
Versão Cloudflare `e2123062-1636-4279-973c-7a493d05512a`, 100% do tráfego.
Release `2026-10-23-strength-reschedule-v8`.
Modelo `luxtips-events-xg-prior4-live-v3`.

## Âmbito

- Regularização da força base e do ajuste xG: 4 nas cinco ligas suportadas.
- Peso máximo do xG: 50%; cobertura, recência e rampa de 12 jogos mantidas.
- Outras cinco competições e ajustes detalhados de remates/acontecimentos: prior 8.
- Componentes temporais, limiares, odds reais, backoff e quotas mantidos.
- Reagendamentos com a mesma identidade renovam só a cache mutável de previsão.
  Mudanças de equipas/identidade são excluídas com motivo interno explícito.
- A avaliação tem versão própria. Não se atribuem as métricas antigas à v3.

## Verificação

85/85 testes; sintaxe, correspondência do bundle recuperado, compilação e
verificação de segredos (105 ficheiros, zero exposições) concluídas.
Módulo remoto idêntico ao build local: 510006 caracteres,
FNV-1a64 `b07205a7117cb14a`. Sem novas migrações ou dependências.

64/64 jogos futuros da janela de Lisboa recalculados: 47 com prior 4 e 17 com
prior 8. 64 snapshots da v3 com contrato de avaliação válido e zero registos
posteriores ao início. Toulouse–Troyes confirmado no início canónico de 25-10,
com xG ativo e prior 4, deixando a previsão antiga intacta no ledger.

Segredos, namespace do relay, bindings, quotas, CPU 30000 ms e agenda de minuto
a minuto confirmados. Rotas protegidas devolvem 401; acesso temporário de
manutenção revogado após os recálculos. Saúde pública operacional, sem falhas
nos recálculos verificados.

## Arquivo pedido durante a publicação

Inicialmente preservaram-se as oito seleções ativas. O utilizador pediu depois
explicitamente o seu arquivo para libertar lugares para o novo ciclo.

Foram acrescentados oito marcadores em `openfoot_publication_archives`, com
motivo `user-requested-new-prior4-cycle-2026-10-23`, sob a lease de publicação.
Não se apagou nem atualizou qualquer publicação original. Os 20 registos dos
quatro ledgers existentes antes da publicação mantiveram exatamente os seus
hashes, calculados sobre todos os campos antes da truncagem do conector.

O novo ciclo já publicou revisões próprias da v3 para domingo. As mesmas
seleções podem voltar a ser escolhidas se continuarem elegíveis; o arquivo não
obriga a trocar mercados nem a preencher lugares.

## Limites

A melhoria estudada é retrospetiva e modesta, sem prova de ROI nem teste cego
integral com dados/odds disponíveis na altura. Não houve ensaio de carga
distribuída prolongado nem validação em dispositivo móvel físico.
Esta entrega publicou o Worker; não incluiu commit/push no GitHub.
