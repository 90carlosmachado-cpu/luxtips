# Calibração do modelo atual Big Odds

Teste temporal em 6 de novembro de 2026, sem alteração das probabilidades públicas. Modelo xG90 prior2 exatamente igual ao publicado. Previsões calculadas às08h Lisboa do dia, ou antes do início para jogos que arrancam antes das08h, com resultados e xG apenas quando já observados. Não se usaram os resultados dos jogos alvo no modelo.

Treino2024–2025:6448 jogos. Avaliação2026:2659 jogos,106com xG efetivamente disponível no respetivo relógio. Os dados de xG históricos foram recolhidos em outubro2026; não foram retrodatados para fingir cobertura em2024/25.

Foi ajustado um único coeficiente de temperatura multiclass, limitado a0,5–2, por minimização da Log Loss no treino. Alpha=0,8550454785. Portanto, este modelo pediu suavização, não um aumento automático da confiança nos favoritos.

Na avaliação2026, Log Loss1,028886→1,026144 e Brier0,616795→0,615157. O intervalo95% por bootstrap semanal da diferença de Log Loss é[-0,005570;+0,000191], incluindo zero. Nos106casos com xG, Log Loss0,994310→0,999849 e Brier0,592795→0,596729: ambas pioram.

O critério pré-definido de promoção falhou. A calibração NÃO está ativa no Worker. Não se aplicou a temperatura aos mercados de golos ou às duplas hipóteses. Os dados2026 já tinham sido vistos em pesquisas anteriores: o teste é uma separação temporal, não uma avaliação prospetiva intocada. O protocolo e todos os resultados estão em protocol.json e results.json.

Reprodução a partir da raiz do repositório:

```sh
node research/bigodds-calibration-current/build.mjs
python research/bigodds-calibration-current/evaluate.py
```

Dependências Python: NumPy e SciPy. predictions.json contém as probabilidades e os resultados utilizados, sem credenciais. O xG é condicionado aos relógios reais de observação; o estudo não pode ser equiparado às reconstruções antigas por tempo do evento.
