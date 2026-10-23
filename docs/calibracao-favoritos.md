# Calibração dos favoritos — investigação de 23-10-2026

Pedido: testar a subestimação sem reduzir critérios ou alterar produção.

`scripts/calibration-research.mjs` contém exclusivamente investigação offline.
Não é importado pelo Worker. Aplica temperatura multiclass, com um coeficiente
global limitado a 0,5–2, grelha 0,01, minimizando Log Loss de 2024/25.
Não foram acrescentados modelos de previsão, indicadores ou fornecedores.

Reprodução a partir do snapshot existente, sem pedidos pagos:

```powershell
node scripts/research-calibration.mjs
node scripts/research-calibration-upcoming.mjs
node scripts/research-calibration-report.mjs
node --test tests/calibration-research.test.mjs
```

Entradas: `work/research-strength/predictions.json` (núcleo prior4/xG50 já
estudado) e `work/research-calibration/upcoming.json` (snapshot D1 em leitura).
O protocolo é guardado antes do ajuste, com hash da fonte. Não inclui segredos.
O segundo comando requer o snapshot local e usa o respetivo relógio, não o atual.
O relatório está em `outputs/LuxTips-calibracao-favoritos.{json,html}` no workspace.

Resultado: alpha 1,07 ajustado em 1543 jogos de 2024/25. Em 1557 jogos de
2025/26 com amostra >=12, Log Loss passa de 0,991942 a 0,990883 e Brier
multiclass de 0,590537 a 0,589754. Nos mesmos 269 favoritos originais >=60%,
probabilidade média 67,43% ->69,48%, observação 75,84%; Brier binário
0,190618 ->0,187622 e Log Loss binária 0,570422 ->0,563872.

A melhoria é parcial. Intervalos pareados por semana, fixo e mensal, incluem
zero na diferença de Log Loss global. Premier League e Brier dos empates pioram
ligeiramente. O teste mensal usa só jogos concluídos antes de cada mês; não se
reajustou o método em função da avaliação. Os 37 casos de 2026/27 são descritivos.

Snapshot futuro: 47 jogos das cinco ligas, zero vitórias elegíveis antes e depois.
Usa `assessMarket` original, relógios e preços originais; reserva nunca diminui.
Não simula publicação ou capacidade diária. Outras cinco competições intocadas.

Limites: reconstrução histórica sem prova integral dos relógios de disponibilidade;
2025/26 e 2026/27 já vistos anteriormente; núcleo não equivale à v3 contextual;
sem ROI histórico; temperatura 1X2 não calibra conjuntamente a grelha de golos.
Não aumentar o coeficiente nem criar exceções por liga com estes resultados.
Decisão: candidato offline, sem promoção ou alteração dos critérios.

Referência metodológica: https://proceedings.mlr.press/v70/guo17a.html.
