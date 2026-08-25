<div align="center">

🇧🇷 Português · [🇺🇸 English](README.en.md) · [🇪🇸 Español](README.es.md)

# 🛠️ DeskcommCRM — o Sistema Operacional de Vendas com IA, open source, pro WhatsApp

**Agentes de IA que atendem, qualificam e vendem no WhatsApp — dentro de um CRM open source rodando no seu servidor.**
**Sem mensalidade, sem feature travada, seus dados com você. A alternativa aberta a Kommo, Octadesk e Intercom.**

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%2BAuth%2BStorage-3ecf8e?logo=supabase)](https://supabase.com)
[![Self-hosted](https://img.shields.io/badge/self--hosted-1%20comando-orange)](hostgator-setup-kit/)
[![CI](https://github.com/melgarafael/DeskcommCRM/actions/workflows/ci.yml/badge.svg)](https://github.com/melgarafael/DeskcommCRM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[**⚡ Instalar**](#-instalar-na-sua-vps-o-caminho-principal) · [**🔄 Atualizar**](#-atualizar) · [**🧭 Visão**](VISION.md) · [**🏗️ Arquitetura**](ARCHITECTURE.md) · [**🤝 Contribuir**](CONTRIBUTING.md) · [**🗺️ Roadmap**](#%EF%B8%8F-roadmap)

</div>

---

> ### ☁️ Rode este CRM em produção com 1 comando
>
> O DeskcommCRM foi desenvolvido em **parceria com a HostGator**: o [`hostgator-setup-kit/`](hostgator-setup-kit/)
> instala o CRM completo (app + WhatsApp + banco) numa VPS com um único comando, e o
> [runbook de produção](docs/runbooks/waha-hostgator.md) já assume esse ambiente.
>
> **[👉 Assinar a VPS HostGator com desconto da parceria](https://www.hostgator.com.br/52708-141-3-52.html)** —
> datacenter em São Paulo, ideal pro WhatsApp rodando 24/7. *(link de parceiro — assinar por ele apoia o projeto e sai mais barato)*
>
> **Ainda não tem servidor?** Rode isto **no seu computador** (macOS, Linux ou WSL). Ele diz
> qual plano contratar — com os números do runbook, não um "depende" — e te devolve o
> comando certo pro seu caso:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/melgarafael/DeskcommCRM/main/hostgator-setup-kit/comecar.sh | bash
> ```
>
> *(prefere ler antes de executar? clone o repo e rode `bash hostgator-setup-kit/comecar.sh` —
> ele não instala nada sem você confirmar.)*

---

## ⚡ Instalar na sua VPS (o caminho principal)

### 1. Entre na sua VPS

Abra o **Terminal** no seu computador (no Windows, o **PowerShell**; no Mac ou Linux, o
**Terminal**) e conecte com o IP e a porta que a hospedagem te mandou por e-mail:

```bash
ssh -p PORTA root@SEU_IP
```

Troque `PORTA` e `SEU_IP` pelos seus. Se a hospedagem não mencionou porta nenhuma, é a padrão
(22) e você pode omitir: `ssh root@SEU_IP`.

Ele pede a senha. **Ao digitar, não aparece nada na tela — nem asteriscos.** Isso não é
travamento: é o terminal escondendo a senha. Digite (ou cole) e dê Enter.

> Na primeira conexão ele pergunta `Are you sure you want to continue connecting?` — responda
> `yes`. É o servidor se apresentando pela primeira vez.

### 2. Rode o instalador

Já dentro da VPS:

```bash
git clone https://github.com/melgarafael/DeskcommCRM.git
cd DeskcommCRM
bash hostgator-setup-kit/install.sh
```

É isso. **Você não instala Node, nem pnpm, nem compila nada** — a imagem do app já vem pronta.
Se faltar Docker, o instalador pergunta e instala sozinho.

### O que você precisa ter em mãos

| Item | Onde conseguir |
|---|---|
| **VPS com Docker** | [HostGator](https://www.hostgator.com.br/52708-141-3-52.html) (parceria) — ou qualquer VPS com Docker. 4 GB de RAM recomendados |
| **Domínio** | Um registro **A** apontando pro IP da VPS (ex.: `crm.suaempresa.com.br`) |
| **Banco** | Conta grátis no [supabase.com](https://supabase.com) — 3 chaves + connection string do **Session pooler** |
| **IA** | Uma chave de **OpenRouter**, **Anthropic** ou **OpenAI** — o instalador pergunta qual você quer |
| **WhatsApp** | Seu número, conectado por QR code no onboarding (ou o canal oficial da Meta) |

> 💡 **O Supabase pode ser criado pelo próprio instalador.** Exporte um
> `SUPABASE_ACCESS_TOKEN` antes de rodar e ele cria o projeto, espera o banco ficar saudável,
> busca as 4 credenciais e descobre o host do pooler testando conexão real — sem copiar e colar.

### O que o instalador faz por você

Ele **pergunta só o que é seu** (domínio, chaves, senha do admin), **valida cada resposta antes
de seguir** — chave errada ele recusa na hora, não três passos depois — e cuida do resto:

1. Gera todos os segredos técnicos sozinho (você não inventa senha nenhuma).
2. Cria as extensões do Postgres e aplica o schema completo (`supabase/baseline.sql`).
3. Cria o primeiro admin com o e-mail e a senha que você escolheu.
4. Sobe a stack inteira com **HTTPS automático** e confere a saúde no fim.
5. Instala o **cron das automações** (sem ele, as regras QUANDO/SE/ENTÃO ficam paradas na fila)
   e o **agente de atualização**, que é o que faz o botão "Atualizar agora" existir na tela.

**Rodar de novo não quebra nada** — o `install.sh` é idempotente: não duplica cron, não recria
usuário, retoma de onde parou.

> **Modo não-interativo:** copie `.env.hostgator.example` para `.env`, preencha e rode
> `bash hostgator-setup-kit/install.sh --yes`.

### Outra hospedagem? (Hostinger, Coolify, Dokploy, CapRover…)

Funciona. Se a sua VPS já vem com um **proxy reverso próprio** ocupando as portas 80/443, o
instalador **detecta isso sozinho** e publica o CRM através dele, em vez de tentar subir um
Caddy que não caberia. Num caso específico — proxy em `--network host`, como faz a Hostinger —
ele **pergunta em vez de adivinhar**, porque publicar atrás do proxy errado instala "com
sucesso" um site mudo. Detalhes em [`hostgator-setup-kit/README.md`](hostgator-setup-kit/README.md#vps-que-já-vem-com-proxy-próprio-hostinger-coolify-dokploy).

### Primeiro acesso

Abra `https://<seu-domínio>` (o cadeado leva ~1 min pra aparecer), entre com o admin, e tenha o
**Google Authenticator** ou **Authy** à mão *se* você quiser ligar a verificação em duas etapas — ela é **opcional** e fica em Configurações › Segurança; o primeiro login **não** a exige. No onboarding,
escaneie o QR code com o WhatsApp do seu número.

### 🤖 Prefere que uma IA instale pra você?

Jogue a pasta `hostgator-setup-kit/` no chat do **Claude Code** rodando dentro da VPS e diga
*"instala o DeskcommCRM pra mim"*. Ele lê o [`CLAUDE.md`](hostgator-setup-kit/CLAUDE.md) do kit
— que traz o passo a passo e as armadilhas já mapeadas — e conduz tudo em português.

---

## 🔄 Atualizar

Saiu versão nova? Há dois caminhos, e o primeiro **não exige terminal**.

### Pela tela (recomendado)

Quando existe versão nova, o rodapé do menu lateral acende **"Nova versão"** — só pro dono do
servidor, porque avisar quem não pode atualizar é ruído. Clique e você cai em
**Configurações → Atualização**, que mostra o que muda, faz **backup do banco sozinha** e
acompanha cada fase (backup → código → banco → no ar) até terminar. Nada de SSH.

Se a versão nova subir quebrada, o agente **volta pra imagem anterior sozinho** e grava essa
volta no `.env` — sem isso, o próximo restart traria o app quebrado de novo, em silêncio.

> Por baixo: o app só registra o pedido; quem executa é o agente que o `install.sh` deixou na
> sua VPS, num cron que confere **a cada 5 minutos** — então a atualização começa em até 5
> minutos depois do clique. Se esse agente estiver fora do ar, a tela avisa
> **"Atualização automática indisponível"** e mostra o comando abaixo — ela não finge que deu certo.

### Pelo terminal

```bash
cd /caminho/do/DeskcommCRM
bash hostgator-setup-kit/update.sh
```

O comando faz, nesta ordem: (1) confere se há mesmo versão nova — se não houver, sai na hora;
(2) **faz backup do banco antes de tocar em qualquer coisa**; (3) baixa o código novo;
(4) atualiza o banco re-aplicando o `baseline.sql`, que é idempotente e **auto-curativo**
(conserta sozinho dados bagunçados por versões antigas); (5) puxa a imagem nova do app;
(6) confere a saúde no fim.

**O alvo é a última versão publicada** (`v1.2.3`), não o topo da `main` — atualizar leva sempre
a uma versão marcada e descrita no [`CHANGELOG.md`](CHANGELOG.md), nunca a um commit não testado.
Ele **recusa** voltar pra uma versão anterior à instalada (isso desligaria coisas que você já tem);
pra isso existe `--force`, de propósito.

**Coisas normais que você vai ver:** um monte de `already exists` / `multiple primary keys` na
parte do banco — **é esperado e inofensivo**, são coisas que já existiam. O script filtra esse
ruído e mostra `✓ banco atualizado`. Se aparecer `⚠ avisos que não são os esperados`, aí sim
guarde a mensagem.

**Deu ruim?** `bash hostgator-setup-kit/restore.sh` volta pro backup.
**Quer só diagnosticar?** `bash hostgator-setup-kit/healthcheck.sh`.

> ⚠️ **Numa instalação antiga que ainda não tem o agente da tela**, rode `update.sh` **duas
> vezes**: a primeira execução ainda é a do script velho (que baixa o novo); a segunda instala
> o agente e liga o botão.

Passo a passo em linguagem simples: [`docs/ATUALIZANDO.md`](docs/ATUALIZANDO.md).

### Outros comandos do kit

| Script | Função |
|---|---|
| `install.sh` | Instala tudo (idempotente — pode rodar de novo) |
| `update.sh` | Atualiza pra versão nova, com backup automático |
| `backup.sh` | Backup do banco + sessões de WhatsApp |
| `restore.sh` | Restaura um backup |
| `reset-password.sh` | Redefine a senha de um usuário |
| `reset-mfa.sh` | Remove o MFA de quem perdeu o celular |
| `healthcheck.sh` | Diagnóstico de todos os serviços de uma vez |

> **Backup importa:** o plano grátis do Supabase **não faz backup sozinho**. Vale agendar
> `backup.sh` no cron diariamente. O `update.sh` já roda um backup antes de cada atualização.

---

## ✨ O que é

**Deskcomm** vem de **Desk** (mesa) + **comm** (comércio): **o comercial de mesa** — toda a operação de vendas do seu negócio numa mesa só, operada por pessoas e agentes de IA juntos.

O projeto nasceu como CRM de e-commerce e a comunidade o levou muito além: hoje roda em **clínicas, imobiliárias, infoprodutos, agências, lojas e prestadores de serviço** — qualquer negócio que vende pelo WhatsApp. O produto acompanhou essa virada e virou um **sistema operacional de vendas**: agentes de IA com RAG por tenant atendem, qualificam, movem leads no funil, disparam automações e sabem a hora de passar pra um humano — com o CRM inteiro exposto via **MCP** pros agentes operarem de verdade. A história completa está em [`VISION.md`](VISION.md).

### Diferenciais

- 🤖 **Agentes de IA que operam o CRM** — RAG por tenant, skills que o agente executa sozinho durante o atendimento, memória da operação, análise de sentimento, handoff IA→humano auditado, IA como assignee de primeira classe e teto de gasto por organização. Não é chatbot decorativo: o agente atende, qualifica e move o funil.
- 🔁 **Nada morre no silêncio** — follow-up que retoma a conversa esfriada (com tempo adaptativo e gatilhos por etapa do funil), radar do que está em risco de morrer sem resposta, e central de avisos pro que precisa de decisão humana.
- 🧠 **Agentes que se auto-aprimoram** — conversas resolvidas viram conhecimento novo; a tela de **Evolução da IA** mostra se o agente está melhorando, onde erra e o que falta ensinar; **Propostas** são melhorias que a IA sugere pra si mesma, aplicáveis como versão nova — sempre com gate humano.
- 🧩 **Multi-nicho por design** — vocabulário configurável por pipeline: lead vira *Cliente*, *Paciente* ou *Comprador*; won vira *Pago*, *Agendado* ou *Fechado*. O mesmo core serve e-commerce (nosso berço, com integração Nuvemshop), clínica, imobiliária ou infoproduto.
- 💬 **WhatsApp de duas formas** — por **QR code** (WAHA, multi-número, com anti-banimento: throttle + jitter + janela de horário) ou pelo **canal oficial da Meta** (Cloud API, com templates aprovados e sincronizados). Mídia via Storage, STOP detection.
- 🔀 **Escolha sua IA** — OpenRouter, Anthropic ou OpenAI, decidido na instalação e trocável depois pela tela, **por parte do sistema** (o que conversa não precisa ser o que indexa).
- 👥 **Governança de atendimento** — RBAC server-side de verdade, atribuição/transferência auditada, fila com rodízio, roteamento automático por intenção e escopo de visualização por papel.
- 🏢 **Multi-tenant + LGPD by-design** — RLS em toda tabela tenant-aware com teste de isolamento como gate de CI; anonimização preferida sobre delete; audit append-only com retenção 5 anos.
- 🖥️ **Self-hosted de verdade** — seus dados na sua VPS; instalação e atualização com 1 comando (ou 1 clique); sem versão paga, sem feature travada.

### 🔌 Webhooks & Automações

Todo tenant pode criar **fontes de captação**: um endereço público (`/api/v1/webhooks/in/<token>`) que recebe leads de landing pages, formulários próprios ou ferramentas como Zapier/n8n via POST (JSON ou `application/x-www-form-urlencoded`) e já entra direto no funil/estágio escolhido — sem código, sem integração customizada por tenant. Em cima dessas fontes (e dos outros eventos do CRM — lead mudou de etapa, ganhou tag, chegou mensagem no WhatsApp), o tenant monta **automações**: regras no formato QUANDO/SE/ENTÃO que disparam ações como adicionar tag, mover o lead no funil, atribuir a um atendente, mandar uma mensagem de WhatsApp ou avisar outro sistema via webhook de saída.

Na UI, tudo mora em **Webhooks** na sidebar (visível só pra quem tem papel `manager`/`admin`). A tela tem três abas: **Receber dados** (criar fonte, copiar o endereço/formulário pronto, disparar um lead de teste, ver os últimos recebimentos), **Automações** (montar a regra, que sempre nasce pausada até você revisar e ligar) e **Atividade** (timeline de cada execução, com o resultado de cada ação e reenvio manual quando uma chamada externa falha).

Por baixo, cada evento vira uma linha em `event_log` — nenhum trigger de banco faz chamada HTTP diretamente. Quem drena essa fila é a rota `/api/v1/cron/event-log-drain`, chamada a cada minuto. **O `install.sh`/`update.sh` já configuram esse cron sozinhos** — sem ele, as automações são criadas normalmente mas nunca rodam.

---

## 🖥️ O que você opera (as telas)

| Grupo | Telas |
|---|---|
| **Atendimento** | **Inbox** (conversas de WhatsApp, você e a IA lado a lado) · **Radar** (quem esfriou e ainda está aberto) · **Respostas rápidas** |
| **CRM** | **Kanban** (onde cada negócio está no funil) · **Contatos** · **Funis** (etapas, vocabulário do negócio e motivos de perda) |
| **Agente de IA** | **Agentes** · **Follow-ups** · **Roteadores** · **Provedores** e **Credenciais** · **Conhecimento** (RAG) · **Memória** · **Skills** · **Casos** · **Alertas** · **Propostas** · **Execuções** · **Uso e orçamento** |
| **Canais** | **Conexões** (QR ou canal oficial da Meta, com saúde, reconexão e templates) · **Nuvemshop** · **Webhooks** |
| **Análise** | **Desempenho** (funil e performance por atendente) · **Evolução da IA** · **Audit Log** |
| **Organização** | **Equipe** · **Distribuição de atendimento** · **Organização** · **LGPD** · **API Tokens** · **Segurança** (MFA, códigos de recuperação, sessões) · Perfil, Notificações, Billing |

Toda tela tem porta na navegação — o CI reprova tela que existe mas em que só se chega digitando a URL.

---

## 🧱 Stack

| Camada | Escolha | Por quê |
|---|---|---|
| **Frontend** | Next.js 16 App Router (Turbopack) + React 19 + TypeScript 6 estrito | Server Components + Route Handlers no mesmo repo |
| **Estilo** | Tailwind + shadcn/ui (`new-york`, neutral) | Customizável sem lock-in |
| **DB** | Supabase (Postgres + RLS + `vector`) | Multi-tenant nativo, embedding pra RAG |
| **Auth** | Supabase Auth via `@supabase/ssr` | Cookie SameSite=Strict, HttpOnly |
| **Realtime** | Supabase Realtime | postgres_changes + broadcast |
| **Storage** | Supabase Storage (URLs assinadas) | Bucket privado `whatsapp-media` |
| **WhatsApp** | WAHA Plus (engine NOWEB) + Meta Cloud API | QR pra começar rápido; canal oficial pra escala |
| **Filas** | `event_log` table + workers (cron) | Trigger de banco nunca faz HTTP |
| **Rate limit** | Upstash Redis (sliding window) | Serverless, free tier suficiente |
| **AI** | Vercel AI SDK v7 — OpenRouter, Anthropic, OpenAI e Google | Instalador pergunta qual; troca depois pela tela |
| **Validação** | Zod | Input externo, env, payloads |
| **Observability** | Sentry (scrub em erro, transação, span e breadcrumb) | Telemetria opt-in no install |
| **Hospedagem** | VPS com Docker (HostGator/SP na parceria) | App + WhatsApp + workers na sua máquina |

Detalhes: [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 🧑‍💻 Desenvolvimento (só pra contribuir com o código)

> ⚠️ **Se você quer USAR o CRM, não é aqui** — use o [instalador da VPS](#-instalar-na-sua-vps-o-caminho-principal).
> Esta seção é pra quem vai mexer no código.

```bash
git clone https://github.com/melgarafael/DeskcommCRM.git
cd DeskcommCRM

nvm use                     # Node 22
npm install -g pnpm && pnpm install

cp .env.example .env.local  # guia completo em docs/SETUP.md

docker compose up -d        # WAHA local (opcional em dev sem WhatsApp)

# Schema: aplique o baseline, NÃO as migrations.
# As migrations 0001-0009 e 0013 são stubs `SELECT 1;` — a cadeia não sobe do zero.
# O schema real vive no baseline.sql, o mesmo que o install.sh aplica na VPS.
# `supabase db push` "passa" e deixa o banco vazio.
supabase link --project-ref <seu-ref>

# Num projeto Supabase NOVO, habilite antes as extensões que o schema usa —
# sem elas o baseline para em `type public.vector does not exist`.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c \
  'create extension if not exists vector with schema public;
   create extension if not exists citext with schema public;
   create extension if not exists pg_trgm with schema public;'

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline.sql

pnpm dev
```

App: <http://localhost:3000> · Health check: <http://localhost:3000/api/v1/health>

[`docs/SETUP.md`](docs/SETUP.md) é o tutorial completo de **todas as integrações** (Supabase, WAHA, provedores de IA, Upstash, Sentry, Resend, Nuvemshop) — ~60–90 min do zero ao app rodando.

---

## 📁 Estrutura

```
DeskcommCRM/
├── app/                    # Next.js App Router
│   ├── (admin)/            # Rotas super-admin (impersonate, tenants)
│   ├── (public)/           # Login, recovery
│   ├── app/                # Rotas autenticadas: inbox, radar, kanban, contacts,
│   │                       #   connections, ai/*, integrations, metrics, lgpd,
│   │                       #   audit, team, settings
│   └── api/v1/             # API REST canônica (196 route handlers)
├── components/             # React (ui/, inbox/, kanban/, shell/, ...)
├── lib/                    # supabase/, waha/, channels/, ai/, agent-engine/,
│                           #   api/, routing/, navigation/, env.ts
├── workers/                # consumers de event_log (IA, RAG, LGPD, mídia, rotinas)
├── supabase/migrations/    # SQL versionado (+ baseline.sql pro self-host)
├── tests/{e2e,unit,invariants,shell}/
├── scripts/                # seeds, qa-waves, manutenção
├── docs/                   # PRDs, specs, runbooks, SETUP.md, ATUALIZANDO.md
└── hostgator-setup-kit/    # instalação e atualização self-host
```

---

## 🧪 Testes

```bash
pnpm typecheck     # tsc --noEmit (estrito)
pnpm lint          # eslint next/core-web-vitals
pnpm test:unit     # Vitest (NÃO inclui tests/invariants/**)
pnpm test:db       # Postgres efêmero + baseline install/update + invariantes
pnpm test:e2e      # Playwright (requer dev server)
```

**Estes checks são obrigatórios** pra mergear na `main`. A lista abaixo já disse "quatro" e depois "cinco" — **meça, não confie nela**:

```bash
gh api repos/melgarafael/DeskcommCRM/branches/main/protection \
  --jq '.required_status_checks.contexts|join(", ")'
# em 2026-08-14: verify, build-and-size, invariants, e2e, imagens-ok
```


| Check | O que faz |
|---|---|
| `verify` | typecheck + lint + `lint:channels` + `test:unit` + `test:shell` |
| `invariants` | sobe um Postgres limpo, aplica o `baseline.sql` em modo **install** e depois em modo **update** — as duas passadas com `ON_ERROR_STOP=1`, que é o que torna a segunda uma prova de idempotência e não só um "terminou" —, e roda os invariantes de RBAC, atribuição, escopo, roteamento, follow-up, webhooks e automações |
| `build-and-size` | `pnpm build` em Node 22 |
| `e2e` | sobe Supabase local, aplica o `baseline.sql` e roda **48 das 49 specs** Playwright pelo frontend |
| `imagens-ok` | reprova quando qualquer uma das três imagens Docker (`app`, `worker`, `scheduler`) não constrói — é o artefato que o self-hoster instala |

A única spec fora do `e2e` é `vps-fresh-onboarding` — ela precisa de WAHA + Redis + Resend + Nuvemshop de verdade. Ela é a **P0** da nossa doutrina de QA visual, então `e2e` verde **não** prova a jornada de instalação fresca; essa se prova numa VPS.

Entre os invariantes está o **teste de isolamento RLS**: cria 2 organizações, simula os claims JWT pelo mesmo caminho `auth.uid()` / `fn_user_org_ids()` que as policies de produção usam, e prova que um usuário da org A enxerga **zero linhas** da org B em `conversations`, `messages`, `contacts` e `crm_leads`. Antes disso, um caso de controle prova que as linhas da org B realmente existem — sem ele, o teste passaria com a tabela vazia.

---

## 📚 Documentação

| Doc | O que tem |
|---|---|
| [`hostgator-setup-kit/README.md`](hostgator-setup-kit/README.md) | **Instalação self-host** — o kit, os scripts, as hospedagens com proxy próprio |
| [`docs/ATUALIZANDO.md`](docs/ATUALIZANDO.md) | **Como atualizar** sua instalação, em linguagem simples |
| [`VISION.md`](VISION.md) | **Visão e posicionamento** — o que o projeto é, no que acredita e pra onde vai |
| [`CHANGELOG.md`](CHANGELOG.md) | O que mudou em cada versão — **leia a seção da versão antes de atualizar** |
| [`docs/SETUP.md`](docs/SETUP.md) | Setup de desenvolvimento, passo a passo de todas as integrações |
| [`docs/white-label.md`](docs/white-label.md) | **Instalar para clientes** — trocar a marca, uma instalação por cliente vs compartilhada, revenda |
| [`docs/runbooks/waha-hostgator.md`](docs/runbooks/waha-hostgator.md) | Runbook de WAHA em produção (dimensionamento, recuperação) |
| [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) | Deploy em produção |
| [`CLAUDE.md`](CLAUDE.md) | Convenções não-negociáveis (leitura obrigatória pra contribuir) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Visão de 1 página da arquitetura |
| [`docs/index.md`](docs/index.md) | Índice dos 157 documentos, com regra de precedência |
| [`docs/prd/`](docs/prd/) · [`docs/specs/`](docs/specs/) | PRDs e specs técnicas (schema SQL, payloads, MCP, governança) |

---

## 🤝 Contribuindo

Esse projeto é open source pra comunidade. Toda contribuição é bem-vinda — desde fix de typo em doc até feature nova.

**Antes de abrir PR:**

1. Leia [`CLAUDE.md`](CLAUDE.md) (~5 min) — convenções não-negociáveis (multi-tenancy, RLS, audit, LGPD).
2. Leia [`CONTRIBUTING.md`](CONTRIBUTING.md) — fluxo de branches, commits, epic-executor.
3. Siga o [Código de Conduta](CODE_OF_CONDUCT.md).

**Fluxo curto:**

```bash
git checkout -b feat/short-slug
# implementa + testes
pnpm typecheck && pnpm lint && pnpm lint:channels && pnpm test:unit && pnpm test:shell && pnpm build
pnpm test:db   # precisa de Docker — é o job `invariants`, obrigatório no merge
git commit -m "feat(escopo): descrição"
# abre PR — o template já traz o checklist de Definition of Done
```

Essas duas linhas são **tudo o que dá para rodar na sua máquina**, de propósito: rodar só metade e
descobrir o resto como surpresa vermelha depois de horas de espera é a pior primeira experiência
que este repositório sabe entregar.

Dois gates obrigatórios **não** cabem aí e só rodam no CI: o `e2e` (precisa de Supabase local) e
o `imagens-ok` (constrói as três imagens Docker). Verde na sua máquina não é verde no merge.

**Definition of Done:** typecheck zero, lint zero, testes relevantes verdes, RLS testada se toca tabela tenant-aware, audit log emitido em mutações, migration versionada **+ apêndice no `baseline.sql`** se muda schema (senão a mudança não chega em quem se auto-hospeda). Detalhes em [`CLAUDE.md`](CLAUDE.md#definition-of-done).

---

## 🐛 Reportando bugs

Abra uma [issue](https://github.com/melgarafael/DeskcommCRM/issues/new/choose) — o template pede o que precisamos (ambiente, `/api/v1/health`, steps). Rodar `bash hostgator-setup-kit/healthcheck.sh` e colar a saída ajuda muito.

Pra **vulnerabilidades de segurança**, **NÃO abra issue pública** — use o [relato privado de vulnerabilidades](https://github.com/melgarafael/DeskcommCRM/security/advisories/new). Detalhes em [`SECURITY.md`](SECURITY.md).

---

## 🗺️ Roadmap

### ✅ Entregue

- **Fundação & plataforma** — auth (MFA pra admin), multi-tenancy com RLS + teste de isolamento, RBAC 4 papéis, audit log append-only, onboarding de tenant.
- **Atendimento WhatsApp** — inbox 3 painéis em tempo real, conexões multi-número por **QR (WAHA)** ou **canal oficial da Meta** (templates aprovados e sincronizados), mídia via Storage, anti-banimento (throttle + jitter + janela de horário), STOP detection.
- **CRM & pedidos** — kanban com vocabulário configurável por nicho (fractional indexing), gestão de funis pela tela, customer 360, contatos, tags, integração Nuvemshop.
- **IA nativa** — agentes com RAG por tenant (pgvector), **skills** que o agente executa sozinho, **memória da organização**, roteador de intenção por número, análise de sentimento, handoff IA→humano, teto de gasto por org, MCP server interno.
- **Escolha de provedor de IA** — OpenRouter, Anthropic ou OpenAI, decidido na instalação e trocável por parte do sistema pela tela.
- **Follow-up vivo** — retomada de conversa esfriada com tempo adaptativo, gatilhos por etapa do funil e por caso, fila com rodízio, e o Radar do que corre risco de morrer sem resposta.
- **LGPD** — export e redact via workers, anonimização em cascata, consentimento auditado.
- **Self-host** — `hostgator-setup-kit` (app + WhatsApp + banco com 1 comando), `baseline.sql` auto-curativo, **atualização pela tela** com backup automático, runbook de produção.
- **Webhooks & automação** — fontes de captação + regras QUANDO/SE/ENTÃO + gatilhos pra sistemas externos.
- **Governança de atendimento** — RBAC server-side em toda a API, atribuição e transferência auditadas (IA como assignee de 1ª classe), visualização por papel (RLS) + métricas por atendente, roteamento automático com fila e painel de gestão, e contrato de governança pra agentes de IA externos ([`docs/specs/14`](docs/specs/14-contrato-governanca-agentes-externos.md)).
- **Operação visível** — motivo da retenção anti-ban traduzido na conversa, central de avisos com severidade, aviso de mensagem presa, controle de proteção de envio (janela/ritmo/teto), capacidades declaradas do agente e propostas do flywheel aplicáveis como versão nova (com gate humano).

### 🔮 Próximo

- **MCP público** — capabilities do CRM expostas pro ecossistema de agentes: plugue o agente que quiser e ele opera o Deskcomm.
- **Templates por nicho** — pipelines e vocabulários prontos pra clínica, imobiliária, infoproduto e serviços (e-commerce já entregue).
- **Integrações** — VTEX e Shopify via adapter pattern (Nuvemshop já entregue).
- **Identity probabilística** — unificação de contatos entre canais.

---

## 💬 Comunidade

- **Discussões:** [GitHub Discussions](https://github.com/melgarafael/DeskcommCRM/discussions) — pra perguntas, ideias, showcase.
- **Issues:** [GitHub Issues](https://github.com/melgarafael/DeskcommCRM/issues) — bugs e tasks.
- **Instagram:** [@melgarafael](https://www.instagram.com/melgarafael)
- **YouTube:** [youtube.com/@melgarafael](https://www.youtube.com/@melgarafael)

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
- **Você é responsável pela sua instalação.** Atualizações não são automáticas (você clica
  ou roda `update.sh` quando quiser), e manter/backup do seu servidor é com você.
- **LGPD — atenção:** quem **hospeda** a instância é o **controlador** dos dados pessoais
  ali tratados (clientes, conversas, pedidos), com as obrigações legais decorrentes. Os
  mantenedores do projeto **não são** controladores nem operadores da sua instância, e não
  têm acesso ao seu banco, ao seu WhatsApp nem ao seu storage. A única coisa que pode sair
  da sua máquina para nós é o relatório de erro descrito abaixo — e só se você deixar.
- **Telemetria (Sentry):** o `install.sh` **pergunta** durante a instalação e respeita a
  sua resposta; em modo não-interativo, sem `SENTRY_DSN` definido, a telemetria fica
  **desligada**. Se você aceitar o Sentry da comunidade, o que é enviado são **relatórios
  de erro** (stack trace) com CPF, telefone e e-mail substituídos, cabeçalhos sensíveis
  removidos, e token de webhook/convite redigido da URL — **sem** rastreamento de
  performance e **sem** replay de sessão, que ficam em 0 nesse caminho. Para desligar a
  qualquer momento: `SENTRY_DSN=off` no `.env`. Para mandar ao **seu** Sentry (aí sim com
  performance e replay): `SENTRY_DSN=<seu-dsn>`. O que é redigido, e por quê, está em
  [`lib/sentry/scrub.ts`](lib/sentry/scrub.ts); a resolução do DSN em
  [`lib/sentry/dsn.ts`](lib/sentry/dsn.ts).

---

## 🙏 Agradecimentos

- **WAHA** ([devlikeapro](https://waha.devlikeapro.com/)) — engine WhatsApp.
- **Supabase** — Postgres + Auth + Storage + Realtime numa stack só.
- **HostGator** — parceria de infraestrutura que tornou o self-host de 1 comando possível.
- **Anthropic**, **OpenAI** e **OpenRouter** — os provedores de IA que o CRM sabe usar.
- **shadcn/ui** — base de componentes.
- A comunidade que nos levou do e-commerce pra clínicas, imobiliárias, infoprodutos e além — vocês definiram o que este projeto é.

---

<div align="center">

**Built with ☕ in Brasil** · **Made for the community**

Siga o desenvolvimento: [Instagram](https://www.instagram.com/melgarafael) · [YouTube](https://www.youtube.com/@melgarafael)

</div>

---

## 📒 Melhorias desta instalação (changelog local — 2026-07/08)

> Toda melhoria feita nesta instalação DEVE ser registrada aqui (regra do guardrail no CLAUDE.md).

### Sincronização com o upstream DeskcommCRM
| Data | Mudança |
|---|---|
| 19/08 | **Atualização para a tag `v1.4.1` (208 commits, 348 arquivos).** Parou na **release publicada**, não no topo da `main`: a doutrina de packaging deste repo diz que `latest` é o topo da `main` e quem quer release usa `stable`, e o que está na `main` além da v1.4.1 é a 1.5.0 ainda **sem tag**. **O que entra:** onboarding reescrito em 6 passos (você monta o funcionário, a chave de IA é testada com resposta real, o funil nasce do **seu ramo** e você vê ele atender antes de terminar) · marca própria **pela tela** (Administração › Marca, sem `.env` e sem rebuild) · sistema usável no celular · seis causas medidas de "a IA publicada não responde" · o banco passa a se podar sozinho (poda da fila + expurgo do audit, com `retention.sweep_run` registrando a própria erosão) · importação de planilha CSV · responder "em cima" de uma mensagem · compartilhar contato. **Preservado nosso:** Cliente Oculto, Google Calendar, guardrails de preço, follow-up, tags, hash chain de auditoria, "Nova conversa", notificações de handoff, design system Indigo e a marca LUA CRM — `lib/mystery`, `lib/google`, `lib/mcp/tools/calendar.ts` e `lib/ai/runtime/guardrails.ts` não foram tocados por uma linha sequer do upstream. **14 conflitos**, resolvidos pelo mesmo critério: onde era *comportamento × estilo*, ficou o comportamento deles com os tokens do Indigo; onde os dois lados acrescentaram coisas diferentes no mesmo ponto, ficaram as duas (o `lib/waha/client.ts` terminou com os **quatro** métodos — `checkExists`/`sendFile` nossos e `checkContactExists`/`sendContactVcard` deles —, porque os contratos divergem de propósito: o nosso devolve `null` em falha, já que o Cliente Oculto precisa desistir em silêncio, e o deles lança, porque o vcard precisa distinguir "não existe" de "a checagem falhou"). **Duas decisões que MUDAM comportamento:** (1) `settings/notifications` ficou com a **nossa** tela — a do upstream ainda é placeholder "em breve" com switches desativados; (2) **arquivar o agente padrão passa a ser RECUSADO** (`cannot_archive_default`, regra do upstream com teste): esta fork arquivava e liberava a marca de padrão junto, comportamento que veio de um commit de sync genérico sem justificativa escrita — quem quiser arquivar o padrão promove outro a padrão antes. **Dois defeitos que só apareceram depois do merge:** `Button` importado em dobro no `InboxLayout`, e `lib/notify/handoff.ts` quebrado porque o upstream tornou `organizationId` obrigatório em todo envelope de saída (PR #284) e nossa notificação de handoff, sendo feature da fork, ficou fora da varredura deles. **Verificação:** `typecheck` zerado, `lint` 0 erros, `test:unit` **5433/5433** (duas falhas investigadas e descartadas como flake de carga — `sem-marcador-de-conflito` e `pdf-extractor` estouram o timeout de 15s na suíte cheia e passam em 2s isolados; a varredura por marcador foi refeita à mão, zero), banco local atualizado pelo `baseline.sql` em modo update com **0 erros**. Backup: `backup/pre-upstream-sync-v141-2026-08-25`. |
| 19/08 | **Nossas migrations mudaram de faixa: 0161–0175 → 0901–0915.** Não foi colisão pontual, foi um bloco condenado: as 15 migrations locais de julho ocupavam 0161–0175, o upstream tomou 0161–0168 nesta release e o 1.5.0 já traz um 0173. Renumerar o upstream só empurraria o problema (ele continua andando para 0169+); renumerar as nossas para uma faixa própria encerra o assunto. O **timestamp não foi tocado** — é ele a identidade que o Supabase usa em `schema_migrations`, então **nada re-aplica** em banco nenhum, nem aqui nem na Oracle; só o `NNNN` e a linha do MANIFEST mudaram. Os novos números sobem junto com a ordem de aplicação. É o caminho que o próprio `tests/unit/manifest-x-migrations.test.ts` manda seguir ("renumerar como se fez, não readicionar filtro"). Conferido: zero números duplicados, invariante verde (6/6), nenhuma referência órfã no repo, e os rótulos do apêndice do `baseline.sql` que citam 0161–0168 são do upstream e continuam corretos. |
| 18/08 | **Atualização local com `upstream/main` até `277f9c04` (v1.3.0).** O merge incorpora 1.181 commits da referência e preserva as extensões desta instalação (LUA CRM, Cliente Oculto, agenda, tags, follow-up e proteção de envio). A compatibilização acrescenta as tools locais ao catálogo MCP atual, centraliza o seletor do número do Cliente Oculto, agenda o `followup-dispatcher`, alinha o tema ao mecanismo white-label e elimina colisões de número/timestamp das migrations sem trocar a identidade das migrations já aplicadas neste fork. A suíte também passou a ser determinística no Windows (caminhos, CRLF, processo filho e Redis externo isolado). Branch de recuperação: `backup/pre-upstream-sync-2026-08-18`. |
| 28/07 | **Merge do upstream `melgarafael/DeskcommCRM` (963 commits, divergência desde 10/07).** Este repo é um clone do DeskcommCRM com `origin` re-apontado; o merge trouxe os módulos que faltavam, com 914 arquivos novos limpos e 46 conflitos resolvidos à mão. **Módulos novos:** `lib/agent-engine` (harness de IA — guardrails, pacing, spinning, flywheel, golden-candidates) + `workers/agent-worker`; `lib/leads` + `/app/radar` (score com evidência e âncora, atividades no barramento, estado de risco, relógio do silêncio, reativação); `lib/automation` + `lib/webhooks` + `/app/webhooks` (regras de automação e fontes de webhook com segredo cifrado); `lib/routing` + `/app/metrics` (distribuição por atendente, disponibilidade, métricas); `lib/messaging/media` + composer/mídia do inbox + `/app/templates` (mídia multimodal, templates, notas, snooze); fluxos de follow-up (`/app/ai/followups`), casos humanos e memória da org; `lib/branding.ts` (marca por `.env`, sem rebuild); 49 migrations e 56 arquivos de invariante de banco. **Preservado nosso:** design system Indigo, Cliente Oculto, Google Calendar, notificações, `followup_settings`, hash chain de auditoria, `tag_definitions`, "Nova conversa", excluir conexão, limpar histórico e a marca LUA CRM (agora via `APP_NAME`). **Verificação:** `typecheck` zerado, `lint` sem erros, `build` ok, `test:unit` 1070/1072 (as 2 falhas não são do merge: uma é `execFileSync("npx")` que não roda no Windows, a outra é um invariante que já está vermelho no HEAD do upstream), `test:db` **verde** (install fresh + re-apply idempotente + 364 invariantes). |
| 28/07 | **`event_log.status` de volta ao vocabulário canônico (migration 0085).** Colisão real entre as duas linhagens de schema: nossa 0028 havia **alargado** o `event_log_status_check` para aceitar `'processed'`; o upstream consertou o mesmo bug pelo outro lado (o dispatcher passou a gravar `'done'`) e criou um invariante que exige que `'processed'`/`'failed'` sejam **rejeitados**. Com o dispatcher agora vindo do upstream, nenhum escritor grava `'processed'` — a constraint volta a fechar. Forward-fix (a 0028 já está aplicada em produção), dados migrados antes da constraint (`processed`→`done`, `failed`→`dead`). |
| 28/07 | **Crons que faltavam no compose self-host.** `routing-worker`, `attendant-heartbeat` e `risk-watcher` existiam como rota mas não eram agendados — no upstream quem os dispara é o `vercel.ts`, e o `docker-compose.prod.yml` (nosso caminho de deploy) ficou sem. Sem cron, roteamento e radar de risco seriam código morto. Agendados: routing-worker 1min, attendant-heartbeat 5min, risk-watcher 15min (cadência sugerida pelo próprio comentário de deploy da rota). O routing-worker é no-op enquanto `settings.routing.mode` é `manual` (default). |
| 28/07 | **Correção do nome da var de engine do WAHA.** A entrada de 15/07 abaixo dizia "compose agora seta as duas vars"; o correto é **só** `WHATSAPP_DEFAULT_ENGINE` — `WAHA_DEFAULT_ENGINE` não existe no WAHA e o upstream tem um invariante (`tests/unit/waha-engine-config.test.ts`) que proíbe o nome errado. `.env.hostgator.example` atualizado junto. |

### Redesign visual — design system "Indigo" (branch `redesign/design-system`, em andamento)
| Data | Mudança |
|---|---|
| 27/07 | **Novo design system baseado no Figma "Buzzy CRM"** (acento índigo `#514ef3`, cantos maiores, botões pill, sombras suaves). Só estilo — nenhuma lógica/rota tocada. Arquivos: `app/globals.css` (tokens runtime — accent índigo 11-stops, radius md/lg/xl 10/16/20, badge índigo), `components/ui/{button,card,badge,input,table}.tsx` (button pill; card 20px+sombra; badge encorpado; input 10px; table linhas arejadas + hover via token + header uppercase), `components/shell/Sidebar.tsx` (item ativo arredondado+sombra, hover índigo, logo em quadrado escuro). `typecheck`/`lint` verdes; nada quebrado. |
| 27/07 | **Dashboard reconstruído no layout do Figma** (`app/app/dashboard/_components/DashboardClient.tsx`): 3 colunas (hero índigo em gradiente com taxa de conversão + stat cards "Conversas"/"Leads" com badge de ícone pastel · funil + gráfico por horário · concentração de leads + painel de IA). Toda a busca de dados (`/api/v1/dashboard/metrics`), seletor de período e gráfico recharts **preservados** — só a apresentação mudou. |

### Correções de bugs do produto
| Data | Correção |
|---|---|
| 19/08 | **A outra metade do bug de CRLF: os FONTES também, e ela reprovava a suíte inteira.** O `.gitattributes` de ontem forçava LF só em `.sh`/`Dockerfile*`/`.yml`, porque o sintoma conhecido era o contêiner em crashloop. O sync com a v1.4.1 trouxe `tests/unit/marca-logo-spec-ancora-a-rota.test.ts`, que **lê** um `.spec.ts` como texto e procura `\n}\n` para achar o fim de uma função; com CRLF o arquivo tem `\r\n}\r\n`, o casamento nunca acontece e a suíte reprova — só no Windows, nunca no CI, que é o pior lugar para uma divergência morar. Medido: **375 de 400** arquivos `.ts`/`.tsx` amostrados estavam com CRLF nesta árvore. Fix: `eol=lf` no glob do `.gitattributes` e 2627 arquivos normalizados em disco. Seguro porque os blobs no git **já eram LF** (o projeto é escrito em Linux) — a conversão alinha a árvore de trabalho com exatamente o que o CI enxerga sem tocar no histórico, e o `git diff` confirmou **zero** mudança de conteúdo nos 2627. Nenhum arquivo versionado precisa de CRLF (não há `.bat`, `.cmd` nem `.ps1`). **Nota de método:** a receita usual de renormalização (`git rm --cached -r . && git reset --hard`) teria apagado as 14 resoluções de conflito, porque o merge ainda não estava commitado — a conversão foi feita direto em disco, sem operação de git. |
| 18/08 | **O sync com o upstream reverteu em silêncio o conserto de 29/07 e o `scheduler` voltou a ser cego.** A entrada de 29/07 abaixo acrescentou `-L /dev/stderr` ao `crond` no `command:` inline do `docker-compose.prod.yml`. O upstream depois moveu a lista de crons para `docker/scheduler/entrypoint.sh` (uma boa mudança — tira o `apk add` de todo start) e o arquivo novo termina em `exec crond -f -l 2`, **sem a flag**. Sem ela o busybox crond escreve em syslog, e não há syslogd na imagem alpine: `docker logs` vazio, contêiner `healthy` (o healthcheck é `pgrep crond`, que não sabe se algum cron disparou), e cron fora do agendamento indistinguível de cron rodando — exatamente o buraco que custou dias de `event-log-drain` parado. Restaurada a flag, agora com o porquê escrito no arquivo para o próximo sync não a perder de novo. Provado: crontab de 17 linhas visível no boot, execuções aparecendo linha a linha, e as rotas respondendo `200` com o segredo e `403` sem ele (`recover-stuck-messages`, `event-log-drain`, `followup-dispatcher`, `agent-dispatcher`). **Ressalva conhecida:** `crond -l 2` imprime a linha de comando de cada execução, e nela vai o `INTERNAL_SECRET` — o segredo fica legível em `docker logs`. É o mesmo trade-off aceito em 29/07 (sem log de execução não há como saber se o cron roda), mas vale decidir de propósito: em VPS, quem lê `docker logs` lê o segredo. |
| 18/08 | **Build no Windows produzia um `scheduler` em crashloop — e o repo não tinha `.gitattributes`.** Com `core.autocrlf=true` (padrão do Git for Windows) e nenhuma regra de fim de linha no repo, o checkout grava CRLF em **todos** os 29 `.sh`. O `docker/scheduler/entrypoint.sh` entra na imagem com shebang `#!/bin/sh\r`, e o Linux procura um interpretador chamado `sh\r`. O sintoma esconde a causa: o contêiner responde `exec /usr/local/bin/entrypoint.sh: no such file or directory` sobre um arquivo que está lá e é executável. Medido aqui: `Restarting (255)` em laço, e com ele **nenhum cron rodava** — `recover-stuck-messages`, follow-up, orçamento de IA, roteamento. E a falha é silenciosa: o `app` sobe saudável, então o health gate do `safe-deploy.sh` passa verde por cima de um scheduler morto. Fix na causa: `.gitattributes` com `* text=auto` e `eol=lf` explícito em `*.sh`/`*.bash`/`Dockerfile*`/`*.yml` — vale para qualquer clone Windows, não só para esta máquina. Verificado: os 29 scripts com 0 bytes CR, imagem reconstruída, `deskcommcrm-scheduler-1` `Up (healthy)`. `pnpm test:shell` fica com 1 falha só no Windows (`.env continua 600`): neste filesystem `chmod 600` vira 644, é limitação do ambiente e passa no CI Linux. |
| 29/07 | **O `scheduler` era cego: `docker logs` vazio mesmo com os crons rodando.** O busybox crond sem `-L` escreve em **syslog**, e não há syslogd na imagem `alpine` — então toda execução ia para o vazio e não havia como saber se o cron estava disparando. Isso já custou caro nesta instalação: a entrada de 24/07 registra o `event-log-drain` fora do crontab por dias sem ninguém notar, justamente porque não havia como notar. Fix: `exec crond -f -l 2 -L /dev/stderr` no `docker-compose.prod.yml`. Agora `docker logs deskcommcrm-scheduler-1` mostra o crontab parseado no boot e uma linha por execução. Verificado: 5 rodadas dos crons de 1 min + 1 de cada `*/5` (incluindo os novos `attendant-heartbeat` e `channel-health`), cadência exata, sem repetição. |
| 29/07 | **Serviço `worker` (agent-engine) precisa subir junto do app — a IA não responde sem ele.** Descoberto no ensaio: a sincronização com o upstream **aposentou o dispatcher nativo** — `GET /api/v1/cron/agent-dispatcher` virou no-op permanente (`native dispatcher retired (Fase 0)`) e o **único** consumidor de `ai_agent.dispatch_requested` passou a ser o container `worker` (`Dockerfile.worker`). Antes do merge a IA respondia dentro do próprio app, via cron; depois, quem responde é esse serviço separado, que nunca havia sido construído aqui. **Consequência para o deploy: subir a versão nova sem o `worker` faz a IA parar de responder em silêncio** — as mensagens entram na fila e ninguém as atende. Construído e no ar local (`docker compose build worker` + `up -d worker`), healthcheck em `:8787/healthz` verde. O aviso `ai_gateway_key_missing` no boot do worker é inofensivo: refere-se ao caminho legado (`ai-response-worker`), e o acionamento real vem do `lib/waha/ingest.ts`, que emite `ai_agent.dispatch_requested` direto ao receber a mensagem. |
| 29/07 | **Aquecimento de número usava a data errada, e configurar a Proteção de envio PIORAVA o limite (migration 0086)**: `channel_knobs.number_activated_at` é `not null default now()` e nada preenchia a coluna — a linha nascia com a data do 1º salvamento da tela, e é dela que o motor deriva a idade do número para o warm-up. Um número conectado há semanas voltava ao degrau mais conservador (**20 envios/dia**) justamente por ter a proteção configurada, e o teto do CRM ficava inalcançável (efetivo = `min(warm-up, daily_message_limit)`). Nas 3 conexões desta instalação o teto era 250 e o real era 20/dia. Fix em três partes: (1) `PUT /api/v1/ai/pacing` preenche a data a partir do `created_at` da conexão **só quando cria a linha** — linha existente nunca é sobrescrita, para que salvar janela/ritmo não reinicie o relógio do aquecimento; (2) migration 0086 corrige linhas existentes, e **só anda para trás** (`where number_activated_at > created_at`) — data anterior é declaração deliberada do operador e fica intocada; (3) campo "Número ativo desde" na tela, para o caso de número que já enviava por outro sistema, com aviso de que informar data mais antiga libera limites maiores. Os degraus do warm-up não mudaram — é conserto de contagem, não afrouxamento. Motor (`lib/agent-engine/**`) intocado. Provado na base real com `BEGIN/ROLLBACK`: idade vista pelo motor 0 dias → 15 dias (teto 20 → 200/dia). Coberto por `tests/unit/pacing-form.test.ts` (25 casos) + `test:db` verde (364 invariantes). |
| 29/07 | **"Proteção de envio" (anti-ban) devolvia 422 sem dizer o motivo** — bug no módulo que veio do upstream, achado usando a tela de Conexões. Os campos "Ritmo entre envios" e "variação de até" são em **segundos**, mas o schema limita a `KNOB_BOUNDS.intervalMaxMs` (600.000 ms = **600 s**): digitar 2497 mandava 2.497.000 ms e o Zod recusava. Três defeitos somados: (1) esses dois inputs eram os únicos sem `max` — janela e teto diário já usavam `bounds`, então a tela convidava ao valor que a API recusa; (2) `ApiError.details` traz o campo e o limite, mas o `catch` mostrava só "Campos inválidos.", jogando o diagnóstico fora; (3) `Number("1,2")` é `NaN` e `Math.round(NaN)` virava `null` no JSON — e `null` significa "usar o padrão do motor", então **decimal com vírgula (o jeito pt-BR) revertia o campo ao default em silêncio**, com o operador achando que salvou. Fix: `lib/ai/pacing-form.ts` (leitura dos campos com vírgula aceita, `NaN` como erro explícito e teto validado na unidade do campo) + `max` nos inputs + limite dito no texto de ajuda + `details` do 422 exibido no toast. Coberto por `tests/unit/pacing-form.test.ts` (14 casos, incluindo o valor exato que causou o bug). |
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
