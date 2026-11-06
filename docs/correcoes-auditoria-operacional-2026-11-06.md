# Correções operacionais — 6 de novembro de 2026

Estado: publicadas e verificadas em produção. Versão: `bd0f8795-2bba-4e93-a3d4-ceb92cb94fcd`. Base publicada: `655bd887-860b-4870-b5cf-b6df30a4ea32`. Algoritmo de seleção e boletim em produção não alterados.

## Execução diária das 08h

O Big Odds passa a correr antes da manutenção de futebol. A execução agendada para as 08h pode terminar numa janela técnica até às 08h15, sempre com corte dos dados às 08h: histórico, xG e recibos de odds posteriores ficam excluídos. A publicação volta a validar relógios, frescura, jogos ainda não iniciados e exclusividade do boletim ativo.

A tentativa diária é reclamada com comparação do estado anterior. Uma lease de dois minutos protege o cálculo; falhas transitórias permitem até três tentativas no total. Um ciclo seguinte só recupera uma tentativa já reclamada para as 08h: não inventa uma nova seleção às 08h01 ou ao meio-dia. Tentativas sem candidatos, dias com boletim em curso e sucessos são terminais. Execuções interrompidas ficam com resultado explícito quando esgotam tentativas ou a janela. Uma publicação confirmada prevalece sobre perda de resposta.

## Reagendamentos

O snapshot original permanece imutável. O feed acrescenta o horário atual e sinaliza o reagendamento no cartão.

Para a mesma identidade de equipas/jogo, um adiamento dentro da janela de 24h deixa de impedir a leitura do resultado final confirmado. O resultado deve corresponder ao horário novo e não pode usar prolongamento/penáltis como resultado de 90 minutos.

Passadas 24h do horário original, uma seleção ainda adiada sem realização ou reagendada para além desse prazo é anulada com odd efetiva 1,00. A anulação só afeta essa seleção; as restantes continuam a ser resolvidas e o boletim pode fechar. A odd original e os snapshots continuam guardados. A publicação continua a impedir reutilização de jogos de boletins comuns anulados/perdidos.

Referência consultada: regra geral publicada pela Betano, atualizada em 26/06/2026: https://support.betano.pt/hc/pt/articles/16445377804189-O-que-acontece-se-o-jogo-em-que-apostei-for-adiado-ou-cancelado . O artigo estabelece 24h para realização e distingue esse prazo do apuramento oficial do resultado. As regras específicas completas no site não puderam ser consultadas por devolverem 403. A correção trata adiamentos dos mercados de jogo já suportados; não implementa mercados de qualificação/vencedor de competição, nem infere resultados de jogos abandonados ou identidades divergentes.

## Rede sem resposta

Os pedidos do separador Big Odds passam a ter prazo de 15 segundos, abrangendo a ligação e a leitura do JSON. O pedido é abortado e o estado de carregamento libertado mesmo quando a rede fica pendente. Conservam-se cartões existentes e a mensagem de falha; o temporizador normal ou o botão de repetição pode recuperar. O tratamento aplica-se também ao carregamento de páginas de histórico.

## Validação

- 129 testes históricos e 93 de produção: 222 aprovados, zero falhas.
- Casos acrescentados: atraso de 87,4s com odds posteriores excluídas, tentativa recuperada e limite de retentativas, lease interrompida e expirada, reagendamento dentro/fora de 24h, adiamento sem hora nova, preservação dos snapshots, odd 1 de anulações, rede pendente antes/depois dos headers e recuperação, ordem real do cron.
- Sintaxe e integridade dos 20 módulos do candidato validadas contra manifesto temporário; compilação Wrangler sem publicação aprovada.
- O manifesto do repositório permanece a identificar a versão efetivamente publicada. Só será atualizado depois da publicação verificada.
- Publicação autorizada pelo utilizador e verificada: quatro módulos alterados coincidem com o candidato. Snapshot do boletim atual preservado por comparação SHA-256 antes/depois. Sem migrações ou novo ciclo manual. Código sincronizado com GitHub após verificação.
