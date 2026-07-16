<div align="center">

# 🛠️ DeskcommCRM

**CRM operacional multi-tenant para e-commerce, com IA conversacional nativa, WhatsApp via WAHA e LGPD by-design.**

[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%2BAuth%2BStorage-3ecf8e?logo=supabase)](https://supabase.com)
[![Tailwind](https://img.shields.io/badge/Tailwind-CSS-38bdf8?logo=tailwindcss)](https://tailwindcss.com)
[![License: TBD](https://img.shields.io/badge/license-TBD-lightgrey)](#licença)

[**📘 Setup Guide**](docs/SETUP.md) · [**🏗️ Arquitetura**](ARCHITECTURE.md) · [**🤝 Contribuir**](CONTRIBUTING.md) · [**📋 PRDs**](docs/prd/) · [**🗺️ Roadmap**](docs/stories/epics/MASTER.md)

</div>

---

> ### ☁️ Rode este CRM em produção com 1 comando
>
> O DeskcommCRM foi desenvolvido em **parceria com a HostGator**: o [`hostgator-setup-kit/`](hostgator-setup-kit/)
> instala o CRM completo (app + WAHA + banco) numa VPS com um único comando, e o
> [runbook de produção](docs/runbooks/waha-hostgator.md) já assume esse ambiente.
>
> **[👉 Assinar a VPS HostGator com desconto da parceria](https://www.hostgator.com.br/52708-141-3-52.html)** —
> datacenter em São Paulo, ideal pro WhatsApp rodando 24/7. *(link de parceiro — assinar por ele apoia o projeto e sai mais barato)*

## ✨ O que é

DeskcommCRM unifica **atendimento humano**, **chatbot com RAG por tenant**, **gestão de pedidos** e **pipeline de pós-venda** numa única plataforma. Canal primário: **WhatsApp via WAHA**. Multi-tenant desde o dia 1. LGPD nativa.

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
git clone https://github.com/melgarafael/DeskcommCRM.git
cd DeskcommCRM

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
DeskcommCRM/
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

Abra uma [issue](https://github.com/melgarafael/DeskcommCRM/issues) com:
- Versão do Node, pnpm e SO.
- Output do `/api/v1/health`.
- Stack trace ou screenshot.
- Steps to reproduce.

Pra **vulnerabilidades de segurança**, **NÃO abra issue pública**. Mande email pra `security@deskcomm.app` (a definir) ou DM ao mantenedor.

---

## 🗺️ Roadmap (alto nível)

- ✅ **Fase 1 — MVP (8–12 semanas)**: Auth, multi-tenancy, inbox WhatsApp, kanban, customer 360, RAG, integração Nuvemshop, LGPD.
- 🔜 **Fase 1.5 — Hardening (+4–8 semanas)**: observability, performance, anti-banimento avançado.
- 🔜 **Fase 2 — Escala**: MCP público, identity probabilística, integrações VTEX/Shopify, modo SaaS direto.

Detalhe wave-by-wave: [`docs/stories/epics/MASTER.md`](docs/stories/epics/MASTER.md).

---

## 💬 Comunidade

- **Discussões:** [GitHub Discussions](https://github.com/melgarafael/DeskcommCRM/discussions) — pra perguntas, ideias, showcase.
- **Issues:** [GitHub Issues](https://github.com/melgarafael/DeskcommCRM/issues) — bugs e tasks.
- **Twitter / X:** [@rafaelmelgaco](https://twitter.com) (a confirmar).

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
  [Issues](https://github.com/melgarafael/DeskcommCRM/issues) ou
  [Discussions](https://github.com/melgarafael/DeskcommCRM/discussions). Não há SLA nem
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

### Features novas
| Data | Feature |
|---|---|
| 14-15/07 | **Agendamento Google Calendar** (migration 0029): integração por Service Account (chave cifrada AES-GCM), UI em Configurações→Integrações, tools `crm_check_availability` (com `start_date`), `crm_schedule_meeting`, `crm_list_scheduled_meetings`, `crm_reschedule_meeting`, `crm_cancel_meeting`. Guarda contra `calendar_id='primary'` (agenda do robô). |
| 15/07 | **Follow-up automático** (migration 0030): sequência configurável por inatividade (Configurações→Follow-up) — etapas com delay+tom, janela anti-ban, ciclo que zera quando o cliente responde; mensagens geradas pela IA com o contexto real da conversa; funciona com IA ou humano atendendo (sem a IA assumir); cron `followup-dispatcher` 1/min. |
| 15/07 | **Limpar histórico** (botão admin na conversa): apaga mensagens, zera handoff/atribuição — a IA recomeça do zero. |
| 15/07 | **Watchdog channel-health** (cron 5/min): engine≠NOWEB → incidente crítico; sessão DB=WORKING divergente do WAHA → corrige status + incidente. |
| 15/07 | **Item "Credenciais IA"** no menu lateral. |
| 15/07 | **Guardrail de deploy** (`scripts/safe-deploy.sh` + hook Claude Code): build gate → health gate → rollback automático. Deploy direto bloqueado. |

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
| 16/07 | **Rebrand + design system azul + layout do inbox**: nome → **Lua CRM** (sidebar, login, títulos); paleta migrada de verde "sage" para **azul** (accent blue; dark mode em **navy** profundo) nos tokens de `globals.css`. Inbox: shell agora `h-dvh` + `overflow-hidden` (janela nunca rola; scroll só nos painéis internos) — removida a barra de rolagem de página e o `h-[calc(100vh-3.5rem)]` frágil; `main` sem `p-6` (cada página já tem o seu; corrige padding-duplo). Filtros: `TabsList` virou flex-wrap — "Não atribuídos" não estoura mais o componente. |
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
