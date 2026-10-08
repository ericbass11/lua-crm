---
impacto: nada_mudou
secao: corrigido
titulo: O ensaio de instalação fresca prepara o playbook oficial antes do atendimento
---

O ensaio automatizado de instalação fresca agora executa o bootstrap oficial do
playbook de plataforma antes de testar o primeiro atendimento. A suíte não sobe
o worker nem seus consumidores: usa o mesmo seed idempotente do boot, preservando
qualquer ponteiro existente e exigindo que o DSN PostgreSQL corresponda à porta
publicada do banco efêmero já ligado ao app e ao gateway verificados.

As verificações do recibo de atendimento e da ativação explícita permanecem.
