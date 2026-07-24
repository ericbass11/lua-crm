/**
 * lib/mystery/pdf.ts — renderers dos 2 anexos do Cliente Oculto (laudo Lua
 * + transcrição), layout espelhando o modelo (branding Lua fixo).
 *
 * IMPORTANTE — por que `require` em runtime e `createElement` (sem JSX/TSX):
 * o Next App Router bundla código server com o React VENDORIZADO dele (canary
 * 19), cujo símbolo de elemento difere do `react.element` do react-pdf (react
 * 18.3.1). JSX compilado pelo Next criaria elementos "React 19" que o reconciler
 * do react-pdf (React 18) rejeita → "React error #31". Carregando react +
 * @react-pdf/renderer via `require` de runtime (node_modules, o MESMO react do
 * react-pdf) e montando a árvore com createElement, os elementos são compatíveis
 * (provado no container). `eval("require")` escapa o bundler do Next/Turbopack.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";

// require REAL do node (não o do bundler): resolve react/@react-pdf do
// node_modules em disco (react 18.3.1 — o MESMO que o react-pdf externo usa),
// nunca o React vendorizado (19) que o Next injeta. Base = cwd do container
// (/app), onde vive o node_modules do standalone.
const nodeRequire: NodeRequire = createRequire(process.cwd() + "/__mystery_pdf__.js");

export interface ReportQualityIssue {
  quote: string;
  problem: string;
  suggestion: string;
}

export interface ReportData {
  targetName: string;
  dateLabel: string;
  attendantName: string;
  targetAvgResponseLabel: string;
  totalLabel: string;
  qualityIssues: ReportQualityIssue[];
  impact: {
    lostPerServiceLabel: string;
    dailyLabel: string;
    weeklyLabel: string;
    monthlyLabel: string;
    economyPercent: string;
  };
  conclusion: string;
}

export interface TranscriptLine {
  at: string;
  role: "Paciente" | "Clínica";
  text: string;
}

export interface TranscriptData {
  targetName: string;
  lines: TranscriptLine[];
}

function pdfLib() {
  const React = nodeRequire("react");
  const rp = nodeRequire("@react-pdf/renderer");
  const h = (type: any, props: any, ...children: any[]) =>
    React.createElement(type, props, ...children);
  const styles = rp.StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
    title: { fontSize: 17, fontWeight: "bold", marginBottom: 2, color: "#111827" },
    subtitle: { fontSize: 9, color: "#6b7280", marginBottom: 10 },
    targetBox: {
      marginBottom: 16, padding: 10, backgroundColor: "#eff6ff", borderLeft: "3pt solid #1d4ed8",
    },
    targetLabel: { fontSize: 8, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
    targetName: { fontSize: 16, fontWeight: "bold", color: "#1d4ed8" },
    sectionTitle: {
      fontSize: 12, fontWeight: "bold", marginTop: 14, marginBottom: 6, color: "#1d4ed8",
      borderBottom: "1pt solid #dbeafe", paddingBottom: 3,
    },
    row: { flexDirection: "row", marginBottom: 2 },
    label: { color: "#6b7280", width: 210 },
    value: { flex: 1 },
    issueBlock: { marginBottom: 8, paddingBottom: 6, borderBottom: "0.5pt dashed #e5e7eb" },
    quote: { fontStyle: "italic", color: "#374151", marginBottom: 2 },
    problem: { color: "#b91c1c" },
    suggestion: { color: "#065f46" },
    para: { marginBottom: 6, textAlign: "justify" },
    aboutBox: { marginTop: 12, padding: 8, backgroundColor: "#f8fafc", border: "0.5pt solid #e2e8f0" },
    cta: { marginTop: 8, color: "#1d4ed8", fontWeight: "bold" },
    footer: {
      position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#9ca3af",
      borderTop: "0.5pt solid #e5e7eb", paddingTop: 4,
    },
    turn: { marginBottom: 6 },
    turnMeta: { fontSize: 8, color: "#9ca3af" },
    rolePaciente: { color: "#1d4ed8", fontWeight: "bold" },
    roleClinica: { color: "#111827", fontWeight: "bold" },
  });
  return { rp, h, styles };
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const { rp, h, styles } = pdfLib();
  const { Document, Page, Text, View } = rp;

  const kv = (label: string, value: string) =>
    h(View, { style: styles.row }, h(Text, { style: styles.label }, label), h(Text, { style: styles.value }, value));

  const doc = h(
    Document,
    null,
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.title }, "Relatório de Atendimento — Cliente Oculto"),
      h(Text, { style: styles.subtitle }, "Avaliação técnica e imparcial do atendimento"),
      h(
        View,
        { style: styles.targetBox },
        h(Text, { style: styles.targetLabel }, "Empresa avaliada"),
        h(Text, { style: styles.targetName }, data.targetName),
      ),

      h(Text, { style: styles.sectionTitle }, "Dados da Interação"),
      kv("Data / horário:", data.dateLabel),
      kv("Nome da atendente:", data.attendantName),

      h(Text, { style: styles.sectionTitle }, "Tempo de Resposta"),
      kv("Tempo médio da clínica:", data.targetAvgResponseLabel),
      kv("Lua CRM (IA):", "3 segundos"),

      h(Text, { style: styles.sectionTitle }, "Tempo Total do Atendimento"),
      kv("Até a oferta de horário:", data.totalLabel),
      kv("Lua CRM (IA):", "5 minutos"),

      h(Text, { style: styles.sectionTitle }, "Qualidade da Comunicação"),
      ...(data.qualityIssues.length === 0
        ? [h(Text, null, "Nenhum problema relevante identificado.")]
        : data.qualityIssues.map((it, i) =>
            h(
              View,
              { key: String(i), style: styles.issueBlock },
              h(Text, { style: styles.quote }, `“${it.quote}”`),
              h(Text, { style: styles.problem }, `Problema: ${it.problem}`),
              h(Text, { style: styles.suggestion }, `Sugestão: ${it.suggestion}`),
            ),
          )),

      h(Text, { style: styles.sectionTitle }, "Impacto Operacional"),
      kv("Tempo perdido por atendimento:", data.impact.lostPerServiceLabel),
      kv("Perda diária projetada (10/dia):", data.impact.dailyLabel),
      kv("Perda semanal:", data.impact.weeklyLabel),
      kv("Perda mensal:", data.impact.monthlyLabel),
      kv("Economia potencial com a Lua CRM:", `${data.impact.economyPercent}%`),

      h(Text, { style: styles.sectionTitle }, "Conclusão"),
      h(Text, { style: styles.para }, data.conclusion),

      h(
        View,
        { style: styles.aboutBox },
        h(Text, { style: { fontWeight: "bold", marginBottom: 3 } }, "Sobre a Lua CRM"),
        h(
          Text,
          { style: styles.para },
          "A Lua CRM é uma plataforma inteligente que transforma a comunicação entre clínicas, " +
            "laboratórios e hospitais e seus pacientes. Integrando inteligência artificial e " +
            "atendimento humanizado, automatiza agendamentos, responde no WhatsApp 24 horas por dia, " +
            "envia lembretes, integra sistemas e otimiza processos — tudo em um único lugar.",
        ),
        h(Text, { style: styles.cta }, "Fale com nosso time comercial e receba uma demonstração personalizada."),
      ),

      h(View, { style: styles.footer, fixed: true }, h(Text, null, "Cliente Oculto com IA · Relatório gerado automaticamente pela Lua CRM")),
    ),
  );

  return (await rp.renderToBuffer(doc)) as Buffer;
}

export async function renderTranscriptPdf(data: TranscriptData): Promise<Buffer> {
  const { rp, h, styles } = pdfLib();
  const { Document, Page, Text, View } = rp;

  const doc = h(
    Document,
    null,
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.title }, "Transcrição — Cliente Oculto"),
      h(Text, { style: styles.subtitle }, `Conversa completa com ${data.targetName}`),
      ...data.lines.map((l, i) =>
        h(
          View,
          { key: String(i), style: styles.turn },
          h(Text, { style: styles.turnMeta }, `[${l.at}]`),
          h(
            Text,
            null,
            h(Text, { style: l.role === "Paciente" ? styles.rolePaciente : styles.roleClinica }, `${l.role}: `),
            l.text,
          ),
        ),
      ),
      h(View, { style: styles.footer, fixed: true }, h(Text, null, "Cliente Oculto com IA · Transcrição gerada automaticamente pela Lua CRM")),
    ),
  );

  return (await rp.renderToBuffer(doc)) as Buffer;
}
