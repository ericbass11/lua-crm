---
impacto: nada_mudou
secao: corrigido
titulo: Atualizar o banco preserva o escopo de funis fechado pelo administrador
---

Reaplicar o baseline não preenche permissões explicitamente vazias a partir do
histórico do agente. O preenchimento histórico ocorre somente quando a coluna
de escopo é criada pela primeira vez. A migration histórica permanece intacta;
o novo guard não desfaz ampliações feitas anteriormente por versões antigas.
