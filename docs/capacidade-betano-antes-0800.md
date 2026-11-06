# Vagas de prognósticos Betano antes das oito

Correção autorizada e publicada na versão52523417-2e45-4fa7-8e8c-b249fa509f5f.

O Arsenal continuava em openfoot_current_picks com probabilidade histórica alta, mas desaparecera da lista visível porque a odd Betano1,18ficara abaixo do mínimo1,20. Ocupava uma das três vagas técnicas e impedia que Dortmund, Roma e Bayern coexistissem. A Roma tinha substituído o Bayern, sem poder ocupar o lugar invisível.

O publisher agora consulta a última cotação Betano verificável de cada seleção existente, antes de calcular a capacidade e os candidatos. Se o preço estiver confirmado abaixo de1,20e tiver menos de seis horas, arquiva operacionalmente a seleção antes das08h do seu dia e retira-a da lista no mesmo lote atómico. O snapshot original não é alterado nem apagado. O lugar fica disponível para qualquer candidato que cumpra os critérios normais, sem baixar limiares ou exigir probabilidade superior à do prognóstico já inelegível.

Preço em falta, expirado, de outra casa, noutro mercado/kickoff ou observado no futuro não permite retirar um jogo. A última cotação recuperada para1,20ou mais prevalece sobre preços antigos inferiores. Depois das08h Lisboa não há libertação por preço. O relógioSQL, a lease de publicação, a versão da publicação original e lockedAt da lista são revalidados na escrita, incluindo corridas na fronteira das08h.

Validação:129testes históricos+76de produção,205no total, passaram. Novos testes reproduzem o lugar invisível com favorito90%/odd1,18e candidato72% elegível, confirmam coexistência dos três jogos, preservação após08h, proteção perante preços em falta/antigos, corrida de relógio SQL e recuperação da cotação. Sintaxe, hashes e compilação Wrangler dry-run passaram.

Não altera o Big Odds, a calibração, o modelo probabilístico, a recolha de odds, os limites de chamadas nem a regra de três prognósticos.
