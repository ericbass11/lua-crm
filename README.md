<div align="center">

# 🛠️ LUA CRM

**CRM operacional multi-tenant com IA conversacional nativa, WhatsApp via WAHA e LGPD by-design.**

Criado por **Eric Souza**.

[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%2BAuth%2BStorage-3ecf8e?logo=supabase)](https://supabase.com)
[![Tailwind](https://img.shields.io/badge/Tailwind-CSS-38bdf8?logo=tailwindcss)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[**📘 Setup Guide**](docs/SETUP.md) · [**🏗️ Arquitetura**](ARCHITECTURE.md) · [**🤝 Contribuir**](CONTRIBUTING.md) · [**📋 PRDs**](docs/prd/) · [**🗺️ Roadmap**](docs/stories/epics/MASTER.md)

</div>

---

> ### ☁️ Rode este CRM em produção com 1 comando
>
> O LUA CRM foi desenvolvido em **parceria com a HostGator**: o [`hostgator-setup-kit/`](hostgator-setup-kit/)
> instala o CRM completo (app + WAHA + banco) numa VPS com um único comando, e o
> [runbook de produção](docs/runbooks/waha-hostgator.md) já assume esse ambiente.
>
> **[👉 Assinar a VPS HostGator com desconto da parceria](https://www.hostgator.com.br/52708-141-3-52.html)** —
> datacenter em São Paulo, ideal pro WhatsApp rodando 24/7. *(link de parceiro — assinar por ele apoia o projeto e sai mais barato)*

## ✨ O que é

LUA CRM unifica **atendimento humano**, **chatbot com RAG por tenant**, **gestão de pedidos** e **pipeline de pós-venda** numa única plataforma. Canal primário: **WhatsApp via WAHA**. Multi-tenant desde o dia 1. LGPD nativa.

> **Modo atual:** BPO interno (uma operadora atende N tenants).
> **Modo futuro:** SaaS direto pra lojistas.

### Diferenciais

- 🤖 **IA operando o atendimento** com RAG por tenant — não é chatbot decorativo, é triagem real.
- 🛒 **E-commerce-native** — vocabulário desenhado pro ciclo *Carrinho abandonado → Pago → Enviado → Entregue → Pós-venda*.
- 🇧🇷 **LGPD by-design** — webhooks `customer/redact` e `customer/data_request` da Nuvemshop como contrato de primeira-classe; anonimização preferida sobre delete; audit append-only com retenção 5 anos.
- 🔌 **MCP-ready** (Fase 2) — exporta capabilities pro ecossistema de agentes.
- 🏢 **Multi-tenant de verdade** — RLS em toda tabela tenant-aware, teste de isolamento como gate de CI.

---

## 🚀 Quickstart (5 minutos pra ver rodando)

```bash
# 1. Clone
git clone https://github.com/ericbass11/lua-crm.git
cd lua-crm

# 2. Node 20 + pnpm
nvm use                    # ou instale Node 20+
npm install -g pnpm
pnpm install

# 3. Env vars
cp .env.example .env.local
# Edite .env.local — guia completo em docs/SETUP.md

# 4. WAHA local (opcional em dev sem WhatsApp)
docker compose up -d

# 5. Migrations Supabase
supabase link --project-ref <seu-ref>
supabase db push

# 6. Sobe o app
pnpm dev
```

App: <http://localhost:3000> · Health check: <http://localhost:3000/api/v1/health>

> 🆕 **Primeira vez? Não pula etapa.** [`docs/SETUP.md`](docs/SETUP.md) é o tutorial completo passo a passo de **todas as integrações** (Supabase, WAHA, Anthropic, Upstash, Sentry, Resend, Nuvemshop) — feito pra quem nunca configurou nada disso antes. ~60–90 min do zero ao app rodando.

---

## 🧱 Stack

| Camada | Escolha | Por quê |
|---|---|---|
| **Frontend** | Next.js 15 App Router + TypeScript estrito | Server Components + Route Handlers no mesmo repo |
| **Estilo** | Tailwind + shadcn/ui (`new-york`, neutral) | Customizável sem lock-in |
| **DB** | Supabase (Postgres + RLS + `vector`) | Multi-tenant nativo, embedding pra RAG |
| **Auth** | Supabase Auth via `@supabase/ssr` | Cookie SameSite=Strict, HttpOnly |
| **Realtime** | Supabase Realtime | postgres_changes + broadcast |
| **Storage** | Supabase Storage (URLs assinadas) | Bucket privado `whatsapp-media` |
| **WhatsApp** | WAHA Plus (engine NOWEB) | Multi-tenant, retry, S3 |
| **Filas** | `event_log` table + workers (cron) | Sem Inngest/Trigger no MVP |
| **Rate limit** | Upstash Redis (sliding window) | Serverless, free tier suficiente |
| **AI** | Vercel AI Gateway (Anthropic primário, OpenAI embeddings) | Fallback automático, ZDR |
| **Validação** | Zod | Input externo, env, payloads |
| **Observability** | Sentry (com `beforeSend` sanitizado) | Sem PII no breadcrumb |
| **Hospedagem** | Vercel (app) + Hostgator VPS Turing/SP (WAHA) | Edge + dedicado pra WhatsApp; datacenter Brasil |

Detalhes: [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 📁 Estrutura

```
lua-crm/
├── app/                    # Next.js App Router
│   ├── (admin)/            # Rotas super-admin (impersonate, tenants)
│   ├── (public)/           # Login, recovery
│   ├── app/                # Rotas autenticadas (inbox, kanban, contacts, audit)
│   └── api/v1/             # API REST canônica
├── components/             # React (ui/, empty/, feedback/, shell/)
├── lib/                    # supabase/, waha/, ai/, api/, logger.ts, env.ts
├── hooks/
├── supabase/migrations/    # SQL versionado
├── tests/{e2e,unit}/
├── scripts/                # seeds, qa-waves, manutenção
├── docs/                   # PRDs, specs, stories, SETUP.md
├── workers/                # consumers de event_log
└── tasks/                  # backlog ativo
```

---

## 🧪 Testes

```bash
pnpm typecheck     # tsc --noEmit (estrito)
pnpm lint          # eslint next/core-web-vitals
pnpm test:unit     # Vitest
pnpm test:e2e      # Playwright (requer dev server)
```

CI roda todos antes de merge. **Teste de isolamento RLS é gate obrigatório** — cria 2 tenants e verifica não-vazamento.

---

## ⌨️ Atalhos de teclado

- `Tab` / `Shift+Tab` — navegação focável (login, formulários, kanban cards)
- `Enter` — confirma ações primárias
- `Esc` — fecha dialogs/sheets

Documentação completa de keyboard shortcuts vem com EPIC-04 (kanban) e EPIC-03 (inbox).

---

## 📚 Documentação

| Doc | O que tem |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | **Setup completo passo a passo** de todas as integrações |
| [`CLAUDE.md`](CLAUDE.md) | Convenções não-negociáveis (leitura obrigatória pra contribuir) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Visão de 1 página da arquitetura |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Fluxo PR + epic-executor |
| [`docs/prd/`](docs/prd/) | PRDs (master, platform, customer 360, WhatsApp, pipeline, IA-RAG, Nuvemshop) |
| [`docs/specs/`](docs/specs/) | Specs técnicas detalhadas (schema SQL, payloads exatos) |
| [`docs/business-rules/`](docs/business-rules/) | Regras de negócio fora do código |
| [`docs/stories/epics/MASTER.md`](docs/stories/epics/MASTER.md) | Plano de execução wave-by-wave |
| [`docs/DEPLOY-CHECKLIST.md`](docs/DEPLOY-CHECKLIST.md) | Preflight pré-go-live |
| [`docs/runbooks/waha-hostgator.md`](docs/runbooks/waha-hostgator.md) | Runbook completo de WAHA em produção (VPS Hostgator) |

---

## 🤝 Contribuindo

Esse projeto é open source pra comunidade. Toda contribuição é bem-vinda — desde fix de typo em doc até epic novo.

**Antes de abrir PR:**

1. Leia [`CLAUDE.md`](CLAUDE.md) (~5 min) — convenções não-negociáveis (multi-tenancy, RLS, audit, LGPD).
2. Leia [`CONTRIBUTING.md`](CONTRIBUTING.md) — fluxo de branches, commits, epic-executor.
3. Identifique o epic em [`docs/stories/epics/MASTER.md`](docs/stories/epics/MASTER.md).

**Fluxo curto:**

```bash
git checkout -b feat/EPIC-XX-short-slug
# implementa + testes
pnpm typecheck && pnpm lint && pnpm test:unit
git commit -m "feat(EPIC-XX): descrição"
# abre PR
```

**Definition of Done:** typecheck zero, lint zero, testes relevantes verdes, RLS testada se toca tabela tenant-aware, audit log emitido em mutações, sem `console.log` esquecido. Detalhes em [`CLAUDE.md`](CLAUDE.md#definition-of-done).

---

## 🐛 Reportando bugs

Abra uma [issue](https://github.com/ericbass11/lua-crm/issues) com:
- Versão do Node, pnpm e SO.
- Output do `/api/v1/health`.
- Stack trace ou screenshot.
- Steps to reproduce.

Pra **vulnerabilidades de segurança**, **NÃO abra issue pública**. Mande email pra `security@lua-crm.example` (a definir) ou DM ao mantenedor.

---

## 🗺️ Roadmap (alto nível)

- ✅ **Fase 1 — MVP (8–12 semanas)**: Auth, multi-tenancy, inbox WhatsApp, kanban, customer 360, RAG, integração Nuvemshop, LGPD.
- 🔜 **Fase 1.5 — Hardening (+4–8 semanas)**: observability, performance, anti-banimento avançado.
- 🔜 **Fase 2 — Escala**: MCP público, identity probabilística, integrações VTEX/Shopify, modo SaaS direto.

Detalhe wave-by-wave: [`docs/stories/epics/MASTER.md`](docs/stories/epics/MASTER.md).

---

## 💬 Comunidade

- **Discussões:** [GitHub Discussions](https://github.com/ericbass11/lua-crm/discussions) — pra perguntas, ideias, showcase.
- **Issues:** [GitHub Issues](https://github.com/ericbass11/lua-crm/issues) — bugs e tasks.
- **Criador e mantenedor:** [Eric Souza](https://github.com/ericbass11).

---

## 📜 Licença

Distribuído sob a licença **MIT** — veja [`LICENSE`](LICENSE). Você pode usar, modificar
e distribuir livremente, inclusive comercialmente. O software é fornecido **"como está",
sem garantias** (ver cláusula de isenção no `LICENSE`).

---

## 🛟 Suporte & responsabilidades (self-host)

Este é um projeto **self-host**: cada pessoa roda o CRM na **própria infraestrutura**
(VPS, banco Supabase e chave de IA próprios). Isso implica:

- **Suporte é comunitário e "as-is".** Dúvidas e bugs entram como
  [Issues](https://github.com/ericbass11/lua-crm/issues) ou
  [Discussions](https://github.com/ericbass11/lua-crm/discussions). Não há SLA nem
  suporte garantido — é open source mantido por boa vontade.
- **Você é responsável pela sua instalação.** Atualizações não são automáticas
  (`bash hostgator-setup-kit/update.sh` quando quiser), e manter/backup do seu servidor
  é com você.
- **LGPD — atenção:** quem **hospeda** a instância é o **controlador** dos dados pessoais
  ali tratados (clientes, conversas, pedidos), com as obrigações legais decorrentes. Os
  mantenedores do projeto **não têm acesso** aos seus dados e **não são** controladores
  nem operadores da sua instância.
- **Telemetria (Sentry):** por padrão, erros **anonimizados** (CPF/telefone/e-mail
  removidos) são enviados ao Sentry da comunidade pra ajudar a corrigir bugs que afetam
  todos. Para **desligar**, use `SENTRY_DSN=off` no `.env`; para enviar ao **seu** Sentry,
  use `SENTRY_DSN=<seu-dsn>`. Ver [`lib/sentry/dsn.ts`](lib/sentry/dsn.ts).

---

## 🙏 Agradecimentos

- **WAHA** ([devlikeapro](https://waha.devlikeapro.com/)) — engine WhatsApp.
- **Supabase** — Postgres + Auth + Storage + Realtime numa stack só.
- **Vercel** — hosting + AI Gateway.
- **Anthropic** (Claude) — IA conversacional.
- **shadcn/ui** — base de componentes.
- Comunidade brasileira de e-commerce que validou as primeiras hipóteses.

---

<div align="center">

**Built with ☕ in Brasil** · **Made for the community**

</div>

---

## 📒 Melhorias desta instalação (changelog local — 2026-07)

> Toda melhoria feita nesta instalação DEVE ser registrada aqui (regra do guardrail no CLAUDE.md).

### Redesign visual — design system "Indigo" (branch `redesign/design-system`, em andamento)
| Data | Mudança |
|---|---|
| 27/07 | **Novo design system baseado no Figma "Buzzy CRM"** (acento índigo `#514ef3`, cantos maiores, botões pill, sombras suaves). Só estilo — nenhuma lógica/rota tocada. Arquivos: `app/globals.css` (tokens runtime — accent índigo 11-stops, radius md/lg/xl 10/16/20, badge índigo), `components/ui/{button,card,badge,input,table}.tsx` (button pill; card 20px+sombra; badge encorpado; input 10px; table linhas arejadas + hover via token + header uppercase), `components/shell/Sidebar.tsx` (item ativo arredondado+sombra, hover índigo, logo em quadrado escuro). `typecheck`/`lint` verdes; nada quebrado. |
| 27/07 | **Dashboard reconstruído no layout do Figma** (`app/app/dashboard/_components/DashboardClient.tsx`): 3 colunas (hero índigo em gradiente com taxa de conversão + stat cards "Conversas"/"Leads" com badge de ícone pastel · funil + gráfico por horário · concentração de leads + painel de IA). Toda a busca de dados (`/api/v1/dashboard/metrics`), seletor de período e gráfico recharts **preservados** — só a apresentação mudou. |

### Correções de bugs do produto
| Data | Correção |
|---|---|
| 15/07 | **Realtime consertado de vez**: cookie HttpOnly deixava o supabase-js do browser sem sessão → toda subscription nascia `anon` e a RLS filtrava 100% dos eventos (inbox/kanban só atualizavam no F5 em qualquer instalação). Fix: rota `GET /api/v1/auth/realtime-token` + `useRealtimeChannel` autentica o canal antes do subscribe + renovação a cada 30min. Diagnóstico: `select claims_role from realtime.subscription` deve ser `authenticated`. |
| 14/07 | **event_log destravado** (migration 0028): dispatcher grava `status='processed'` mas o check só aceitava `done` → todo evento de IA travava em `processing`. |
| 15/07 | **Motor WAHA forçado NOWEB**: a imagem lê `WHATSAPP_DEFAULT_ENGINE` (default WEBJS baked-in) e ignorava `WAHA_DEFAULT_ENGINE` do compose → WEBJS dropava TODAS as mensagens após restart. Compose agora seta as duas vars; imagem pinada por digest. |
| 15/07 | **Portões de intervenção humana** no dispatcher mcp_agent (`skipped_human_active`): bloqueado → force_human → bot_silenced → atribuído a humano. Assumir = IA cala; Liberar = IA volta. |
| 15/07 | **Contexto de runtime injetado** no agente: conversation_id, nome/WhatsApp do cliente, data/hora atual (a IA pedia "nome cadastrado" ao próprio cliente). |
| 15/07 | **Markdown→WhatsApp** (`lib/waha/format.ts`): `**negrito**`→`*negrito*` etc. nas saídas da IA. |
| 15/07 | **Despausar mcp_agent** republica a última versão automaticamente; **Arquivar** liberado para agente default (limpa a flag). |
| 15/07 | **Excluir conexões WhatsApp** (botão + DELETE API): desconecta do WAHA; preserva histórico como "Parado" se houver conversas (FK RESTRICT). |
| 24/07 | **`event-log-drain` não rodava no cron (CRÍTICO)**: o container `scheduler` foi criado antes de o `event-log-drain` ser adicionado ao crontab do compose — o crontab é gravado no start do container, então o scheduler rodava só os crons antigos, **sem o drain**. Efeito: eventos assíncronos (respondedor do Cliente Oculto, laudo, indexação RAG, workers LGPD) só processavam por disparo manual. Fix: `docker compose up -d --force-recreate scheduler` (regenera o crontab atual). Verificar `crontab -l` no scheduler após mudar o compose. |
| 24/07 | **Cliente Oculto: insights de venda (Fase 3, migration 0041) + abas na UI**: cada empresa auditada ganha um `insight` de venda gerado por LLM a partir do laudo real (gargalo → impacto → como a Lua CRM resolve → gancho), automático ao concluir + regenerável (botão "insight" no card/lista). "Perguntar aos laudos" (Q&A) sintetiza padrões entre as empresas (alimenta o LLM com os dados estruturados; embeddings ficam pra quando o volume crescer). UI de /app/mystery reorganizada em **abas** (Nova auditoria · Kanban). |
| 24/07 | **CRM de prospecção no módulo Cliente Oculto (migration 0040)**: cada empresa auditada vira um lead pra vender o Agente de IA da Lua CRM. `mystery_shopper_campaigns` ganhou `stage` (funil Auditado→Qualificado→Contato→Proposta→Negociação→Fechado/Perdido), `city`/`state` (UF derivada do DDD), `notes` e `analysis` (JSONB — laudo estruturado p/ RAG). UI em /app/mystery: KPIs (auditadas, economia média, resposta média, fechados, conversão) + **Kanban** (colunas por etapa, mover via seletor) + **Lista** (empresa, WhatsApp, cidade/UF, economia, resp. média, etapa, laudo/transcrição). Empresa entra em "Auditado" ao concluir a auditoria. Falta a Fase 3 (RAG/insights de venda sobre os laudos). |
| 24/07 | **Abertura do Cliente Oculto sempre única (anti-spam Meta)**: a 1ª mensagem era fixa (só o objetivo variava) → risco de bloqueio por padrão de spam. Agora é **gerada pela IA a cada campanha** (temperatura 1 + estilo aleatório de um pool), quebrada em mensagens curtas; fallback determinístico variado (saudação × pedido × emoji) se o LLM falhar. Cada empresa recebe uma abertura diferente. |
| 24/07 | **Laudo rebrand Lua CRM + empresa em destaque**: "Cloudia" (era só exemplo do modelo) trocado por **Lua CRM** em todo o laudo/pdf/prompt de análise; o nome da empresa avaliada saiu do subtítulo para um **bloco próprio destacado** (rótulo "EMPRESA AVALIADA" + nome grande em azul). |
| 24/07 | **Encerramento + laudo do Cliente Oculto confiáveis**: (a) o LLM às vezes produzia a fala de fechamento mas esquecia o flag `should_end`/`target_offered_slot` → a campanha ficava `running` pra sempre e o laudo nunca era gerado. Backstop determinístico: se a IA disser o roteiro de fim ("vou confirmar / te retorno"), encerra mesmo sem o flag (marca `slot_offered_at` pelo timestamp da última msg do alvo). (b) A entrega do laudo por WhatsApp agora resolve o chatId do destinatário via `checkExists` (mesmo 9º dígito/LID do envio), senão "enviava" sem entregar. Laudo sempre baixável na UI mesmo se a entrega falhar. |
| 24/07 | **Cliente Oculto responde "picado" (várias mensagens curtas)**: a persona agora retorna `messages[]` (1–4 mensagens curtas) em vez de um bloco; o motor envia cada uma com pacing humano (~1.2–2.8s + jitter), como uma pessoa digita. Fallback quebra bloco em frases se o LLM devolver texto único. |
| 24/07 | **Resposta via LID roteada pelo telefone (Cliente Oculto)**: o WhatsApp entrega respostas com identidade **LID** (`<lid>@lid`, privacidade), que não bate com o `target_chat_id` (telefone). Resultado: a IA não entrava na conversa. Fix: no `handleMysteryShopperInbound`, além do `from`, extraímos o telefone real de `_data.key.remoteJidAlt` (`<phone>@s.whatsapp.net`) e casamos por ele, com tolerância ao 9º dígito BR (canoniza 13→12). Validado real: Clínica Novo Sorriso respondeu via LID, a IA capturou e respondeu de forma humanizada. |
| 24/07 | **Inbound do Cliente Oculto casado com o alvo (migration 0038)**: o número do oculto é um WhatsApp real — qualquer contato pode mandar mensagem. O ingest atribuía QUALQUER inbound à campanha ativa (a IA reagiria ao contato errado, e poderia responder ao alvo real reagindo a mensagem de terceiro). Fix: `mystery_shopper_campaigns.target_chat_id` (JID real do alvo, resolvido via check-exists) + `handleMysteryShopperInbound` só captura se os dígitos do remetente casarem com o alvo; de terceiro, ignora. |
| 24/07 | **9º dígito BR no envio do Cliente Oculto**: o JID do WhatsApp de muitos números BR é `55DDXXXXXXXX@c.us` (SEM o 9), mas o código gerava `55DD9XXXXXXXX@c.us` → a WAHA aceitava o `sendText` (201) mas a mensagem nunca era entregue (log `USync fetch yielded no results for pending PNs`) e não aparecia no chat. Fix: `WahaClient.checkExists` (`/api/contacts/check-exists`) resolve o chatId REAL e valida a existência no WhatsApp; o motor usa isso na validação de início (erro claro `target_not_on_whatsapp` se não existe) e em cada envio. |
| 22/07 | **PDF (react-pdf) consertado no server standalone**: o Next App Router bundla código server com o React vendorizado dele (canary 19), incompatível com o `react-reconciler` do `@react-pdf/renderer` (react 18.3.1) → `renderToBuffer` quebrava com "React error #31" (e depois "reading 'S'"). Fix: `next.config.ts` externaliza a árvore `@react-pdf/*` + `react-reconciler`, e `lib/mystery/pdf.ts` monta os elementos com `createRequire(process.cwd())` (react real do node_modules, o mesmo do react-pdf) via `createElement` — nunca o React vendorizado. **Conserta também o export LGPD** (mesmo renderer). Provado end-to-end (laudo+transcrição gerados e no bucket). |
| 21/07 | **`safe-deploy.sh` com rollback consertado**: o script tinha nomes hardcoded do rebrand (`lua-crm-app-1` / `lua-crm-app:*`) que não batiam com o container/imagem reais (`deskcommcrm-app-1` / `deskcomm-app:local`) → o snapshot de rollback falhava em silêncio e um build quebrado ficaria sem rede de segurança. Agora resolve o container via `docker compose ps -q app` e a tag-alvo via `APP_IMAGE` do `.env` — snapshot/rollback à prova de rename. |

### Features novas
| Data | Feature |
|---|---|
| 14-15/07 | **Agendamento Google Calendar** (migration 0029): integração por Service Account (chave cifrada AES-GCM), UI em Configurações→Integrações, tools `crm_check_availability` (com `start_date`), `crm_schedule_meeting`, `crm_list_scheduled_meetings`, `crm_reschedule_meeting`, `crm_cancel_meeting`. Guarda contra `calendar_id='primary'` (agenda do robô). |
| 15/07 | **Follow-up automático** (migration 0030): sequência configurável por inatividade (Configurações→Follow-up) — etapas com delay+tom, janela anti-ban, ciclo que zera quando o cliente responde; mensagens geradas pela IA com o contexto real da conversa; funciona com IA ou humano atendendo (sem a IA assumir); cron `followup-dispatcher` 1/min. |
| 15/07 | **Limpar histórico** (botão admin na conversa): apaga mensagens, zera handoff/atribuição — a IA recomeça do zero. |
| 15/07 | **Watchdog channel-health** (cron 5/min): engine≠NOWEB → incidente crítico; sessão DB=WORKING divergente do WAHA → corrige status + incidente. |
| 15/07 | **Item "Credenciais IA"** no menu lateral. |
| 22/07 | **Cliente/Paciente Oculto — Fases 2–4 (módulo completo)**: **motor** (`lib/mystery/engine.ts`) — inicia campanha (dispara 1ª msg pela sessão do oculto), respondedor-persona acionado a cada resposta do alvo (evento `mystery_shopper.reply_received` consumido pelo `event-log-drain`, reusa o LLM BYO do agente publicado da org), conduz até a **oferta de horário** e encerra SEM confirmar; cap de 40 msgs + varredura de stall (45min) no mesmo drain. **Laudo** (`lib/mystery/report.ts` + `metrics.ts` + `pdf.tsx`) — métricas dos timestamps (tempo médio/total, perda, projeção 10/dia, economia % — benchmarks Cloudia fixos 3s/5min), análise de qualidade por LLM, 2 PDFs (relatório + transcrição) via `@react-pdf/renderer`, upload no Storage e entrega ao número cadastrado via `sendFile` (best-effort; laudo sempre baixável na UI). **UI** em `/app/mystery` (admin): conectar número dedicado (QR), iniciar auditoria (persona + alvo + destino), listar campanhas e baixar laudos. `channel-sessions` aceita `purpose`. 19 testes unitários (métricas batem o modelo 09/12). |
| 22/07 | **Cliente/Paciente Oculto — Fase 1 (fundação, migration 0036)**: módulo onde a IA vira o *cliente* e audita o atendimento humano de uma empresa-alvo. Esta fase entrega a base (dormente até a Fase 2): `channel_sessions.purpose` ('inbound'/'mystery_shopper'), tabelas `mystery_shopper_campaigns` (1 running por sessão) e `mystery_shopper_messages` (isoladas do inbox), `WahaClient.sendFile` (envio de PDF via URL) e o **desvio de roteamento** no `lib/waha/ingest.ts`: inbound numa sessão de oculto NÃO cria contato/conversa nem aciona o bot-da-empresa — só captura na campanha ativa. Decisões: para antes de fechar horário real · disparo manual · branding Cloudia fixo. Provado no DB (RLS, unique de campanha ativa). |
| 22/07 | **Criar e excluir pipelines no kanban** (sem migration): página `/app/kanban` ganhou botão "Novo pipeline" (cria o funil com etapas padrão Novo·Em andamento·Ganhou·Perdido, slug único auto-gerado) e exclusão por pipeline. Exclusão **só quando não há nenhum lead** (checagem no app + backstop da FK `crm_leads.pipeline_id` ON DELETE RESTRICT; etapas somem via cascade). Se o pipeline excluído era o padrão e sobra outro, promove o de menor posição a padrão. Server actions admin-only (`createPipeline`/`deletePipeline`); botão de excluir desabilitado com a contagem de leads na UI. |
| 21/07 | **Auditoria à prova de adulteração (hash chain, migration 0035)**: `api_audit_log` ganhou `prev_hash`/`entry_hash`/`chain_seq` + trigger `trg_audit_hash_chain` (BEFORE INSERT, SECURITY DEFINER, advisory lock por org) que encadeia SHA-256 de cada linha sobre a anterior. Alterar OU apagar qualquer linha antiga quebra a verificação das posteriores — `select * from fn_verify_audit_chain('<org>')` retorna a 1ª linha quebrada (vazio = íntegra). Backfill idempotente das 10.315 linhas existentes; provado (detecta UPDATE e DELETE); app não precisou de rebuild (o trigger preenche transparente — confirmado gravando `ai.dispatcher_run` já hasheado). Dá base pro "provar o que a IA fez e quando". |
| 21/07 | **Gate anti-alucinação de preço + motor de guardrails de saída** (`lib/ai/runtime/guardrails.ts`, sem migration): o runtime agora avalia a resposta ANTES de enviar (agent.ts §16). **Gate de preço sempre ligado** — extrai valores monetários do texto final e, se algum não aparece em fonte verificada (system prompt do tenant + trechos do RAG + resultado de tools), **descarta a resposta e escala em silêncio pra humano** (`source=guardrail`, reason `low_confidence`, detalhe em metadata). Também ativa os guardrails configuráveis que eram letra morta: `regex_output_block` e `rag_must_hit` (o campo `ai_agents.guardrails` finalmente é lido). Viés pró-segurança: na dúvida, bloqueia. 13 testes unitários. |
| 15/07 | **Guardrail de deploy** (`scripts/safe-deploy.sh` + hook Claude Code): build gate → health gate → rollback automático. Deploy direto bloqueado. |
| 21/07 | **Envio ativo / "Nova conversa"** (sem migration): botão no topo do Inbox abre diálogo (número + mensagem + nome opcional). `POST /api/v1/conversations` normaliza o telefone p/ E.164 (`lib/phone.ts`, default DDI +55), resolve o canal WORKING (auto se houver só um; seletor se >1), reusa as RPCs atômicas `fn_upsert_wa_contact`/`fn_upsert_wa_conversation` (mesmo dedup do inbound — número existente não duplica), envia a 1ª mensagem via `sendMessageHandler` e **adiciona o contato ao funil padrão (1ª etapa) automaticamente** (`source=whatsapp_active`; reusa lead aberto existente). Ao concluir, abre a conversa no chat. |

### Operação local (Windows)
- Stack: `docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up -d` · app em `http://localhost:3000`
- Banco: Supabase local (`npx supabase start` — não sobe sozinho após reboot)
- Deploy de mudanças: **somente** `bash scripts/safe-deploy.sh`
| 15/07 | **Tags de conversa por IA** (migration 0031): catálogo em Configurações→Tags (nome + descrição "quando aplicar" + cor), tool `crm_tag_conversation` (valida contra o catálogo), catálogo injetado no contexto do agente, badges na conversa em tempo real. DELETE da tag limpa as conversas. |
| 15/07 | **Gestão de funil pela IA — Fase 1** (migration 0032): `crm_stages.ai_criteria` ("quando o lead deve estar nesta etapa"); runtime injeta funil+critérios+lead atual do contato; IA cria o card na etapa certa, move entre etapas com evidência (reason), marca Ganhou/Perdido e mantém campos estratégicos via tool nova `crm_set_lead_fields` (merge validado; respeita schema declarativo do pipeline). Pipeline "Leads" seedado com 6 etapas SDR. |
| 15/07 | **Fix: tools de lead liberadas pro runtime** — `crm_create_lead`/`crm_update_lead`/`crm_move_lead_stage` exigiam role `manager` (herança do desenho p/ operadores via API) e barravam a IA (`Role 'agent' insufficient`), impedindo a criação do card no Kanban. Agora `agent`, como as demais tools do runtime. Guidance endurecida: IA não inventa owner/prazo/valor. |
| 15/07 | **Kanban UX**: duplo clique no card abre o modal de edição; campo de tags virou seletor do catálogo (`TagPicker`: chips clicáveis + criação inline que grava direto no catálogo de Configurações→Tags). Aplicado em editar e novo lead. Runtime: encadeamento obrigatório agendou→moveu card p/ Call agendada; prompt de fechamento assertivo (proibido "se quiser" ao propor call). |
| 15/07 | **Gestão de funil pela IA — Fase 2**: (1) editor de **critério de IA por etapa** em Configurações→Pipelines (server action `updateStageCriteria`); (2) **campos estratégicos declarados** no pipeline Leads (segmento, orçamento, urgência, dor, objeções, próximo passo, decisor, resumo, score) — seção editável no modal do lead, tipos text/textarea/select/number/boolean; `custom_fields` agora aceito no PATCH de lead (merge parcial) + GET `/api/v1/pipelines/[id]`; (3) **score + urgência visíveis no card** do Kanban (★ score colorido + badge de urgência). IA e humano editam os mesmos campos. |
| 16/07 | **Modais responsivos (fix de base)**: `DialogContent` ganhou `w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain` — nenhum modal ultrapassa mais os limites da tela (conteúdo alto rola dentro do modal); vale para todos os diálogos do sistema de uma vez. |
| 16/07 | **Gestão de lead pela IA — Fase 3**: (1) **briefing pré-call** — `crm_schedule_meeting` aceita `contact_id` e o servidor injeta os campos estratégicos do lead (segmento, dor, orçamento, resumo…) na descrição do evento, entregando ao comercial um briefing pronto; (2) **follow-up ciente do funil** — o dispatcher carrega etapa+campos do lead e adequa o tom do reengajamento (quente puxa ação, frio reaquece com valor); (3) **score contínuo** — instrução reforçada para recalcular o score a cada interação (sobe/desce conforme a conversa). Preenchimento retroativo fica como ação gated (operação em massa). |
| 16/07 | **Card do Kanban**: passou a exibir nome + telefone do lead (join do contato no board route); removidos o valor (R$) e o avatar de dono "00" (owner era UUID zerado da IA). |
| 16/07 | **Rebrand + design system azul + layout do inbox**: nome → **LUA CRM** (sidebar, login, títulos); paleta migrada de verde "sage" para **azul** (accent blue; dark mode em **navy** profundo) nos tokens de `globals.css`. Inbox: shell agora `h-dvh` + `overflow-hidden` (janela nunca rola; scroll só nos painéis internos) — removida a barra de rolagem de página e o `h-[calc(100vh-3.5rem)]` frágil; `main` sem `p-6` (cada página já tem o seu; corrige padding-duplo). Filtros: `TabsList` virou flex-wrap — "Não atribuídos" não estoura mais o componente. |
| 16/07 | **Configurações reorganizada em abas por categoria** (`SettingsHub`): Conta · Organização · IA & Automação · Canais & Integrações · Conformidade & Segurança. **Credenciais de IA** e **LGPD** saíram da barra lateral e agora vivem dentro de Configurações (grupos IA e Conformidade). Cards gateados por papel; grupo sem item visível não aparece. |
| 16/07 | **IA multimodal (áudio + imagem)**: mensagens de voz do cliente são transcritas (OpenAI Whisper) e imagens são descritas (visão gpt-4o-mini); o texto vai pro `body` (a IA entende e aparece no inbox). `lib/ai/runtime/media.ts`, ligado no runtime quando o body vem vazio. |
| 16/07 | **Alerta de handoff ao time** (migration 0033): `notification_settings` (webhook por org) + `notifyHandoff` no Step 6 do handoff-orchestrator (POST Slack/Discord/n8n/custom com motivo, contato e link). UI em Configurações → Conta → Notificações. Sem isto, handoff ficava parado sem ninguém saber. |
| 16/07 | **RAG ligado no runtime da Lua v2**: `lib/ai/runtime/rag.ts` recupera trechos da base de conhecimento ativa do agente (embed da pergunta → `retrieve_top_k_chunks`) e injeta no contexto para respostas ancoradas nos docs da empresa. Degrada a no-op sem KB ativa ou sem chave de embedding. Pré-requisitos p/ ativar: setar `OPENAI_API_KEY`/`AI_GATEWAY_API_KEY` no .env + criar/ativar base de conhecimento em Agentes IA → Conhecimento. |
| 16/07 | **Handoff por WhatsApp + Nota da IA**: (1) alerta de handoff agora também via WhatsApp — número(s) do time recebem, pelo próprio número do negócio (WAHA), o motivo + link + resumo da conversa (campo `resumo` do lead, fallback última msg). Config em Configurações → Conta → Notificações (migration 0034 `handoff_whatsapp_number`). (2) **Nota da IA** no painel direito do inbox: resumo + campos estratégicos do lead + etapa do funil + score, para o humano assumir já com contexto. |
| 16/07 | **Removida a tabela placeholder de notificações** (toggles disabled que não faziam nada); sobra o alerta de handoff real. **Fix: painel do inbox (CRMSidePanel) lia leads/pedidos/atividade via supabase-js do browser** — que não autentica no PostgREST (cookie httpOnly) e retornava sempre vazio ("Sem leads"). Agora busca via `GET /api/v1/contacts/[id]/crm-context` (server, RLS por sessão). Com isso a seção **Nota da IA** passa a aparecer de fato. |
| 16/07 | **Painel (Dashboard)** — nova tela inicial do app (`/app` → `/app/dashboard`, item "Painel" no topo da sidebar). KPIs (conversas, leads, conversão, % resolvido pela IA, respostas da IA, follow-ups), funil de leads por etapa + distribuição de score (quente/morno/frio), e **gráfico de mensagens recebidas por horário** com destaque comercial×fora (recharts). Seletor de período 7/30/90d. API `GET /api/v1/dashboard/metrics` (server, agrega das tabelas existentes; janela comercial vem de followup_settings). |
| 16/07 | **RAG acessível + agente default corrigido**: a tela de Conhecimento (`/app/ai/knowledge/sources`) gerencia a base do agente *default* — mas o default era a "Lua" (rag_bot legada), não a Lua v2 que roda. Corrigido (Lua v2 agora é default). Adicionado card **"Base de conhecimento"** em Configurações → IA & Automação (antes não havia link para a tela). OPENAI_API_KEY já ativo p/ embeddings. |
| 16/07 | **Fix crítico p/ RAG: driver do event_log criado** — a rota `/api/v1/cron/event-log-drain` (referenciada no código mas **nunca implementada**) e ausente do scheduler significava que `knowledge_source.updated` (indexação da base) e eventos LGPD **nunca eram processados**. Criada + agendada (1/min). Registra SÓ rag-indexer + lgpd (não o pipeline de IA legado) e filtra por event_type → não colide com o agent-dispatcher (zero risco de resposta duplicada). Backoff + dead após 5 tentativas. Sem isto, nenhum documento seria indexado por mais que o usuário subisse. |
| 16/07 | **Editor de FAQ real na base de conhecimento** — os botões da tela de Conhecimento eram todos placeholder (`disabled` + toast "em breve"), sem forma de adicionar conteúdo. Criado `FaqEditorDialog`: cadastra perguntas/respostas → POST cria a fonte FAQ + itens → emite `knowledge_source.updated` → event-log-drain indexa (embeddings) → ativa a KB na Lua v2. Slots Política/Conversas/Catálogo seguem "em breve" (dependem de upload/opt-in/nuvemshop). |
