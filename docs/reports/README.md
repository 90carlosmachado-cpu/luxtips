# Relatórios guardados em 23-10-2026

Snapshots de análise e verificação; não representam estado atualizado em tempo
real. As horas e épocas constam dos próprios relatórios.

- `Publicacao-LuxTips-v8-verificacao.json`: verificação da publicação v8.
- `LuxTips-auditoria-favoritos.{html,json}`: odds, cobertura histórica e viés.
- `LuxTips-calibracao-favoritos.{html,json}`: teste de calibração offline,
  candidato não promovido; a produção continua sem essa calibração.
- `Melhoria-LuxTips-regularizacao.html` e `Estudo-forca-xG-resultados.json`:
  investigação que antecedeu a regularização prior4 da v8.
- `Estudo-xG-LuxTips.html` e `Estudo-xG-resultados.json`: estudo exploratório de xG.

Os scripts de investigação estão em `scripts/research-*.mjs`. Os seus snapshots
de entrada históricos e ficheiros operacionais em `work/` são locais e excluídos
do Git, tal como credenciais e dados de execução. Um clone novo consegue executar
os testes e compilar; repetir integralmente estudos históricos requer os inputs
identificados em cada protocolo, não incluídos nestes relatórios de resultados.

O caminho `../../outputs` usado pelos scripts refere-se ao workspace original.
As cópias nesta pasta preservam os resultados desse workspace sem os recalcular.
