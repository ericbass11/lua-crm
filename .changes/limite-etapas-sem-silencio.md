---
impacto: capacidade_nova
secao: corrigido
titulo: Consultas repetidas não terminam atendimento sem sinal
---
O agente reconhece buscas vazias declaradas pelo catálogo e contém repetições. Se atingir o limite de etapas sem tentar responder, pode emitir um único aviso neutro pela cadeia normal de envio. Bloqueios de segurança permanecem; recusas ou falhas do aviso geram um alerta na Central. Falha exclusiva desse aviso não repete a geração. A prévia distingue o aviso de uma resposta concluída.
