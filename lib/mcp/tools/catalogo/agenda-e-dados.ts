/**
 * Capacidades locais de agenda e enriquecimento comercial.
 *
 * Este arquivo declara somente os textos apresentados a quem configura o
 * agente. O contrato tecnico e a descricao enviada ao modelo continuam nos
 * handlers de `calendar.ts`, `tags.ts` e `lead-fields.ts`.
 */
import { declararTools } from "./tipos";

export const TOOLS_AGENDA_E_DADOS = declararTools([
  {
    name: "crm_check_availability",
    category: "read",
    rotulo: "Consultar horários disponíveis",
    explicacao:
      "Mostra os próximos horários livres da agenda da empresa antes de combinar uma reunião com o cliente.",
    oQueToca: "Agenda da empresa",
    risco: "seguro",
    pacotes: ["agenda_google"],
  },
  {
    name: "crm_schedule_meeting",
    category: "write",
    rotulo: "Marcar uma reunião",
    explicacao:
      "Cria uma reunião na agenda da empresa no horário que já foi confirmado com o cliente.",
    oQueToca: "Agenda da empresa",
    risco: "atencao",
    pacotes: ["agenda_google"],
  },
  {
    name: "crm_list_scheduled_meetings",
    category: "read",
    rotulo: "Ver reuniões marcadas",
    explicacao:
      "Lista as próximas reuniões que o assistente marcou para a equipe acompanhar os compromissos assumidos.",
    oQueToca: "Agenda da empresa",
    risco: "seguro",
    pacotes: ["agenda_google"],
  },
  {
    name: "crm_reschedule_meeting",
    category: "write",
    rotulo: "Remarcar uma reunião",
    explicacao:
      "Troca o horário de uma reunião existente depois que o novo horário foi confirmado com o cliente.",
    oQueToca: "Agenda da empresa",
    risco: "atencao",
    pacotes: ["agenda_google"],
  },
  {
    name: "crm_cancel_meeting",
    category: "write",
    rotulo: "Cancelar uma reunião",
    explicacao:
      "Remove uma reunião da agenda da empresa depois que o cancelamento foi confirmado com o cliente.",
    oQueToca: "Agenda da empresa",
    risco: "atencao",
    pacotes: ["agenda_google"],
  },
  {
    name: "crm_tag_conversation",
    category: "write",
    rotulo: "Marcar uma conversa",
    explicacao:
      "Adiciona ou remove marcadores já cadastrados para facilitar a organização e a busca das conversas.",
    oQueToca: "Organização das conversas",
    risco: "atencao",
    pacotes: ["organizar", "atender"],
  },
  {
    name: "crm_set_lead_fields",
    category: "write",
    rotulo: "Atualizar dados da oportunidade",
    explicacao:
      "Guarda na oportunidade as informações comerciais descobertas durante a conversa, sem apagar os demais dados.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["vender"],
  },
]);
