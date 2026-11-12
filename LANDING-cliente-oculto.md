# Landing page — LUA CRM · Cliente Oculto

> **O que é este arquivo:** o briefing completo para construir a landing page de venda do LUA CRM,
> com o módulo **Cliente Oculto** como carro-chefe. Traz posicionamento, público, copy pronta seção
> a seção, estrutura visual, tratamento de objeções e — importante — a **origem de cada número**,
> separando o que o produto **mede** do que ele **assume**. Entregue isto a um designer, a um dev ou
> a uma IA construtora de páginas.
>
> Tudo que está aqui foi conferido contra o código (`lib/mystery/*`, `app/app/mystery/*`). Onde há
> ressalva, ela está escrita. Leia a seção **"Antes de publicar"** no fim — há três decisões suas que
> precedem a página.

---

## 1. A tese

Todo CRM com IA vende a mesma coisa: *"atenda melhor no WhatsApp"*. É uma promessa sobre o futuro,
e o prospect precisa acreditar em você para comprá-la.

O Cliente Oculto inverte a venda. Em vez de prometer, ele **prova** — e prova sobre o negócio **do
próprio prospect**, com o relógio dele, antes de qualquer reunião. Uma IA se passa por cliente,
conversa de verdade pelo WhatsApp da empresa-alvo, cronometra cada resposta e devolve um laudo em
PDF com o número exato: *"vocês levam 41 minutos até oferecer um horário; isso custa X por mês"*.

O laudo não é um brinde. **É o pitch.** Chega no WhatsApp do vendedor pronto para ser encaminhado, e
a empresa auditada já entra no funil de prospecção da ferramenta, com um argumento de venda escrito
sob medida a partir dos problemas reais encontrados na conversa dela.

**A frase que resume:** *o CRM que consegue o próprio cliente.*

---

## 2. Para quem é a página

### Público primário — quem revende e presta serviço

Agências de marketing, consultorias de vendas, integradores de WhatsApp, setters e closers que
vendem automação para pequenos e médios negócios. É o público que o módulo foi construído para
servir: para eles, o Cliente Oculto é uma **máquina de prospecção fria**, não um relatório interno.

**A dor deles:** prospecção fria não converte porque a mensagem é genérica. Ninguém responde
*"posso te mostrar uma IA que atende seu WhatsApp?"*. Mas todo mundo abre um PDF que diz o nome da
empresa dele na capa e mostra, com hora e minuto, onde ele perdeu um cliente ontem.

### Público secundário — quem opera e quer auditar a própria casa

Clínicas, franquias, redes com várias unidades, gestores comerciais com equipe de atendimento. Para
eles o módulo é **controle de qualidade**: descobrir como a própria equipe atende quando ninguém está
olhando, e o laudo vira pauta de reunião — não pitch.

> Duas dores diferentes, dois blocos de copy diferentes. A página deve levar o público primário no
> caminho principal e oferecer o secundário como segunda porta (ver seção 9).

---

## 3. Como o módulo funciona de verdade

Escreva a copy a partir daqui — não invente etapa que não existe.

**1 · Você monta a persona.** Nome, objetivo (*"agendar uma avaliação"*), história de fundo
(*"primeira vez na clínica, quer saber preços e horários à tarde"*) e tom. Informa o WhatsApp da
empresa-alvo, o nome dela e para qual número o laudo deve ser entregue. Cidade e UF são preenchidas
sozinhas a partir do DDD.

**2 · A IA abre a conversa.** A primeira mensagem é **gerada na hora, diferente a cada campanha** —
não existe texto fixo. Isso é anti-spam de propósito: mensagem de abertura repetida entre empresas é
padrão que a Meta reconhece e bloqueia.

**3 · Ela se comporta como cliente, não como robô.** Mensagens curtas, uma ideia por vez, revelando o
caso aos poucos. Ritmo humano de digitação. Ela **reage** — quem conduz, pergunta, qualifica e
oferece horário tem que ser a empresa. Se a empresa não conduz, isso também é um dado.

**4 · Ela para no ponto certo.** Assim que a empresa oferece um horário concreto, a IA agradece, diz
que confirma depois e encerra. **Nunca confirma o agendamento** — a agenda de quem foi auditado não
é bagunçada, e ninguém fica esperando um paciente que não existe. Teto rígido de 40 mensagens por
campanha.

**5 · O laudo sai sozinho.** Dois PDFs — o relatório e a transcrição completa com carimbo de hora em
cada fala — entregues no WhatsApp que você indicou, e sempre baixáveis pela tela.

**6 · A empresa vira lead.** Ela entra no funil de prospecção em **Auditado**, com um argumento de
venda gerado a partir dos problemas reais que apareceram na conversa dela, e caminha por
*Qualificado → Contato → Proposta → Negociação → Fechado / Perdido*.

**7 · O conjunto vira inteligência.** Com várias auditorias na base, a tela responde perguntas sobre
todas de uma vez: *"quais empresas demoram mais para responder e valem uma abordagem?"*

---

## 4. O que o laudo contém

Use esta lista para desenhar o mockup do PDF no hero — é a estrutura literal do arquivo gerado.

| Seção | Conteúdo |
|---|---|
| Capa | **Relatório de Atendimento — Cliente Oculto** · *Avaliação técnica e imparcial do atendimento* · nome da empresa avaliada em bloco destacado |
| Dados da Interação | Dia da semana, data, horário de início e término |
| Tempo de Resposta | Tempo médio da empresa **medido** × referência da IA |
| Tempo Total do Atendimento | Do primeiro contato até a oferta de horário × referência da IA |
| Qualidade da Comunicação | Até 8 problemas encontrados nas falas **da empresa**, cada um com a **citação literal**, o problema e uma sugestão profissional |
| Impacto Operacional | Tempo perdido por atendimento · projeção diária, semanal e mensal · economia potencial em % |
| Conclusão | Um parágrafo consultivo que reconhece o desempenho real, expõe o custo e contrasta com a IA |
| PDF 2 | Transcrição completa, fala a fala, com data e hora em cada linha |

A seção de **Qualidade da Comunicação** é a mais subestimada e a que mais vende: ela devolve ao dono
do negócio a frase exata que o atendente dele escreveu. Isso é impossível de contestar e
desconfortável de ignorar.

---

## 5. De onde vem cada número — leia antes de escrever qualquer promessa

Esta é a seção que protege a página de uma promessa que você não consegue sustentar.

### Medido de verdade, por auditoria

- **Tempo médio de resposta da empresa** — média dos intervalos entre cada mensagem da IA e a
  resposta seguinte da empresa. Vem dos carimbos de hora reais.
- **Tempo total até a oferta de horário** — do primeiro contato até o momento em que um horário foi
  oferecido.
- **Quantidade de mensagens** de cada lado.
- **Os problemas de comunicação** — extraídos da transcrição real, com citação literal.

Estes números são seus para usar sem medo. São fatos sobre a conversa que aconteceu.

### Referência fixa do produto — **não** é medição

- **3 segundos** (resposta da IA) e **5 minutos** (atendimento completo) são **constantes definidas
  no produto**, usadas como termo de comparação no laudo. Não são medidas na instalação de ninguém.
- A **economia potencial em %** é calculada a partir delas: `(tempo real − 5 min) ÷ tempo real`.
  O tempo real é medido; o teto de comparação é a constante.

### Projeção com premissa embutida

- **Perda diária, semanal e mensal** assumem **10 atendimentos por dia**, 7 dias por semana, 28 dias
  no mês. É uma premissa razoável, mas é premissa — e o laudo já a declara na linha
  *"Perda diária projetada (10/dia)"*.

> **Regra de copy:** na página, apresente 3s/5min como **"o padrão que a IA entrega"** — nunca como
> *"medimos e comprovamos em X clientes"*, a não ser que você tenha essa medição em mãos. E se citar
> a economia mensal, mantenha a premissa visível (*"considerando 10 atendimentos/dia"*). Um número
> com a premissa exposta é mais forte que um número redondo que o prospect desconfia.

---

## 6. Estrutura da página, com copy

### Seção 1 — Hero

**Headline (recomendada):**
> ### Descubra em quanto tempo seu concorrente responde no WhatsApp. Antes de ligar para ele.

**Alternativas para teste A/B:**
- *O CRM que consegue o próprio cliente.*
- *Uma IA liga para o seu prospect fingindo ser cliente. E volta com a prova de que ele precisa de você.*
- *Pare de prometer que a IA atende melhor. Mostre quanto o atendimento dele está custando.*

**Subheadline:**
> O Cliente Oculto do LUA CRM conversa pelo WhatsApp da empresa que você quer prospectar, se passando
> por um cliente real. Cronometra cada resposta, registra cada erro de atendimento e devolve um laudo
> em PDF com o nome dela na capa — pronto para você mandar. A empresa já entra no seu funil, com o
> argumento de venda escrito.

**CTA primário:** `Ver um laudo real` → abre o PDF de exemplo
**CTA secundário:** `Rodar uma auditoria grátis` → captura o WhatsApp de um alvo do próprio visitante

**Visual:** o PDF do laudo em perspectiva, com o bloco "Empresa avaliada" e o número de tempo médio
legíveis. Ao lado, um print da conversa no WhatsApp — mensagens curtas, humanas, com horário
visível. O contraste entre "conversa comum" e "documento técnico" é o argumento inteiro, sem texto.

---

### Seção 2 — O problema

**Título:** *Prospecção fria não morre por falta de lead. Morre por falta de motivo.*

> Você já sabe que o WhatsApp do seu prospect é lento. Ele também sabe — de forma vaga, do jeito que
> a gente sabe que devia dormir mais.
>
> O que ninguém tem é o número. Quanto tempo, exatamente, um cliente esperou ontem? Qual foi a frase
> que o atendente escreveu? Quantos agendamentos foram embora no silêncio entre a pergunta e a
> resposta?
>
> Sem esse número, sua abordagem é opinião contra opinião. Com ele, é um documento.

---

### Seção 3 — Como funciona

Quatro cards, na ordem, com ícone e uma linha de apoio. Use a mecânica da seção 3 deste briefing.

1. **Você monta a persona** — nome, objetivo e a história de quem está procurando o serviço. Leva um minuto.
2. **A IA conversa** — abertura única a cada campanha, mensagens curtas, ritmo humano. Ela reage; quem conduz é a empresa.
3. **Ela para no horário oferecido** — agradece, diz que confirma depois e encerra. Nenhuma agenda alheia é bagunçada.
4. **O laudo chega no seu WhatsApp** — relatório e transcrição, prontos para encaminhar.

**Linha de fechamento da seção:**
> Do clique ao PDF, sem você digitar uma mensagem.

---

### Seção 4 — O laudo (a seção que converte)

**Título:** *O que chega no seu WhatsApp*

Layout de duas colunas: à esquerda, a lista de seções do PDF (tabela da seção 4 deste briefing); à
direita, o PDF real, rolável ou em carrossel de páginas.

**Destaque em caixa, ao lado de "Qualidade da Comunicação":**
> Aqui está a parte que muda a reunião: o laudo devolve **a frase exata** que o atendente escreveu,
> o problema dela e a versão profissional. Não é uma opinião sobre o atendimento. É a transcrição
> dele.

**Micro-CTA:** `Baixar um laudo de exemplo (PDF)`

---

### Seção 5 — Do laudo à venda

**Título:** *A auditoria termina onde a maioria das ferramentas começa*

> A empresa auditada não vira um arquivo. Vira um lead.
>
> Ela entra no funil em **Auditado** e caminha até **Fechado**. Junto com ela vem um argumento de
> venda gerado a partir do laudo dela — o gargalo que apareceu, o que aquilo custa, como você
> resolve e por onde começar a conversa.
>
> Com várias auditorias na base, você para de olhar empresa por empresa e passa a perguntar ao
> conjunto: *quais delas demoram mais para responder e valem uma abordagem esta semana?*

**Visual:** o Kanban de prospecção com as colunas reais — Auditado · Qualificado · Contato · Proposta
· Negociação · Fechado / Perdido — e os KPIs no topo: **auditadas · economia média · resposta média ·
fechados · conversão**.

---

### Seção 6 — O CRM inteiro (a segunda metade da oferta)

**Título:** *E quando o cliente fecha, a ferramenta que vendeu é a que atende*

Nesta seção o Cliente Oculto sai do palco. Blocos curtos, uma linha cada:

- **Agentes de IA que operam o CRM** — atendem, qualificam e movem o lead no funil. Não é chatbot decorativo.
- **Nada morre no silêncio** — follow-up automático em conversa esfriada, radar do que está prestes a morrer sem resposta.
- **WhatsApp de duas formas** — por QR code (multi-número, com proteção anti-banimento) ou pelo canal oficial da Meta.
- **Escolha sua IA** — OpenAI, Anthropic ou OpenRouter, trocável pela tela.
- **Marca própria** — a instalação inteira sai com o seu nome, seu logo e sua cor. O cliente final nunca vê a nossa marca.
- **Seus dados no seu servidor** — instalação self-hosted, com instalação e atualização por um comando.
- **Multi-tenant e LGPD desde o primeiro dia** — isolamento entre clientes testado no CI, auditoria append-only.

**Linha de fechamento:**
> O Cliente Oculto abre a porta. O CRM é o que mantém o cliente do outro lado dela.

---

### Seção 7 — Marca própria (bloco dedicado, para o público primário)

**Título:** *Venda como se fosse seu. Porque é.*

> A instalação inteira carrega o seu nome, o seu logo e a sua cor — nas telas, nos e-mails, no
> favicon. Seu cliente entra numa ferramenta que é sua, e a única marca que ele conhece é a que está
> no seu contrato.

---

### Seção 8 — Prova

Escolha os que você **de fato tiver**. Uma prova real vale mais que cinco genéricas.

- **Laudo real anonimizado**, aberto na página, sem formulário na frente.
- **Print da conversa** que gerou aquele laudo — é o que faz o visitante entender que é conversa de verdade.
- **Vídeo de 60 segundos:** persona sendo preenchida → conversa acontecendo → PDF chegando no WhatsApp.
- **Contador honesto**, se você tiver volume: *"N auditorias rodadas · tempo médio encontrado: X"*.
- **Depoimento**, se houver, com nome e empresa. Sem isso, prefira não ter seção de depoimento a ter uma inventada.

---

### Seção 9 — Segunda porta (público secundário)

**Título:** *Não quer prospectar — quer saber como sua própria equipe atende?*

> Aponte o Cliente Oculto para o seu próprio WhatsApp. O laudo vira pauta de reunião de equipe, com
> a frase literal que foi escrita ao cliente e o tempo real que ele esperou. Rede com várias
> unidades: uma auditoria por unidade, mesmo critério, comparação lado a lado.

**CTA:** `Auditar minha própria equipe`

---

### Seção 10 — Objeções

Formato de acordeão. As três primeiras são as que realmente travam a venda.

**"Isso é legal?"**
> Cliente oculto é uma prática de mercado consolidada — a diferença aqui é que quem conversa é uma
> IA, e não uma pessoa contratada. A conversa acontece pelo canal público de atendimento da empresa,
> exatamente como qualquer cliente faria. Nenhum agendamento é confirmado e nenhuma agenda é
> ocupada. *(Ajuste este texto com o seu jurídico antes de publicar — ver seção 12.)*

**"Vou ser bloqueado no WhatsApp?"**
> A abertura é gerada na hora e é diferente a cada auditoria — não existe mensagem-padrão repetida,
> que é o padrão que a Meta reconhece como disparo em massa. As mensagens saem em ritmo humano, e
> cada campanha tem teto rígido. Ainda assim: use um número dedicado à auditoria, separado do número
> de atendimento.

**"E se a empresa não responder?"**
> A campanha fica aberta e o tempo continua correndo. Silêncio também é resultado — e costuma ser o
> mais vendável de todos.

**"Preciso saber programar?"**
> Não. Instalação por um comando no servidor, e a auditoria é um formulário de sete campos.

**"Funciona fora de clínica?"**
> A mecânica é a mesma para qualquer negócio que agenda pelo WhatsApp — imobiliária, estética,
> oficina, escritório. *(Leia a ressalva da seção 12 antes de afirmar isso na página.)*

---

### Seção 11 — Oferta e fechamento

Deixe o modelo comercial explícito. A página perde conversão quando o visitante não sabe se aquilo é
assinatura, licença ou serviço.

**Estrutura sugerida — preencha com seus números:**

| | |
|---|---|
| **O que é** | Licença de uso do LUA CRM instalado no seu servidor, com marca própria |
| **Para quem revende** | Uma instalação por cliente, sua marca, seu preço |
| **Incluso** | Cliente Oculto · agentes de IA · WhatsApp · CRM completo · instalação e atualização |
| **Modelo** | *(mensal / anual / licença perpétua — decida antes de publicar)* |
| **Garantia** | *(sugestão: a primeira auditoria roda antes de você pagar)* |

**Fechamento:**
> ### Escolha uma empresa que você quer como cliente. Nós te mandamos o motivo dela dizer sim.
>
> `Rodar minha primeira auditoria`

A oferta mais forte disponível é essa: **rode a primeira auditoria no prospect do visitante, de
graça, na frente dele.** O produto se demonstra sozinho, e o lead chega com o laudo na mão.

---

## 7. Formulário de captura

Peça pouco, mas peça o que faz a demonstração acontecer.

| Campo | Obrigatório | Por quê |
|---|---|---|
| Seu WhatsApp | Sim | É por onde o laudo chega — e é o canal de venda |
| WhatsApp da empresa que você quer auditar | Sim | Sem isso não há demonstração |
| Nome da empresa | Sim | Vai na capa do laudo |
| Seu nome | Sim | — |
| E-mail | Não | Só se você for nutrir por e-mail |
| Segmento | Não | Ajuda a calibrar a persona |

**Microcopy sob o botão:**
> Rodamos a auditoria e mandamos o laudo no seu WhatsApp. Sem cartão, sem reunião marcada.

---

## 8. Tom de voz

- **Concreto acima de adjetivo.** "41 minutos até oferecer um horário" derrota "atendimento lento" em qualquer teste.
- **Números com origem.** Sempre que um número aparecer, o visitante deve conseguir dizer de onde ele veio.
- **Sem superlativo vazio.** Corte "revolucionário", "inovador", "disruptivo", "solução completa", "o melhor do mercado".
- **Português direto**, frases curtas, segunda pessoa.
- **Nunca desprezar a empresa auditada.** O laudo é respeitoso com quem foi medido — a página deve ser também. Quem lê a página é, muitas vezes, alguém que já foi o auditado.

---

## 9. Requisitos técnicos da página

- **Mobile primeiro.** Este produto é vendido no WhatsApp; a maior parte do tráfego chega pelo celular.
- **PDF de exemplo aberto**, sem formulário na frente. O laudo é o produto — escondê-lo mata a conversão.
- **Peso leve.** Se o vídeo passar de alguns segundos para carregar, use um GIF ou uma sequência de imagens.
- **CTA fixo no rodapé em mobile**, com o mesmo texto do hero.
- **Rastreamento por seção** — saber onde o visitante para de rolar vale mais que o total de visitas.

### Metadados

```
Título:     Cliente Oculto por IA para WhatsApp | LUA CRM
Descrição:  Uma IA se passa por cliente no WhatsApp da empresa que você quer prospectar,
            cronometra o atendimento e devolve um laudo em PDF pronto para enviar.
            A empresa já entra no seu funil.
OG image:   O PDF do laudo em perspectiva, com o nome de uma empresa exemplo legível.
```

### Palavras-chave

`cliente oculto whatsapp` · `auditoria de atendimento whatsapp` · `avaliar atendimento da concorrência`
· `crm com ia para whatsapp` · `prospecção com inteligência artificial` · `white label crm whatsapp`
· `tempo de resposta whatsapp`

---

## 10. Antes de publicar — três decisões suas

Estas três coisas precedem a página. Duas são de conteúdo, uma é de produto.

### 1. O laudo hoje fala língua de clínica

No código, o relatório e a transcrição usam vocabulário fixo de saúde: os papéis na transcrição são
**"Paciente"** e **"Clínica"**, e a análise instrui o modelo a agir como *"consultor sênior de
atendimento em saúde"*. A conclusão fala em "avaliações que viram consultas".

**Consequência direta:** se a landing prometer "funciona para imobiliária, oficina e escritório", o
laudo que o lead receber vai chamar a imobiliária de "Clínica". A promessa se desmonta no
primeiro entregável.

**Suas opções, em ordem de esforço:**
- **(a) Vender para o nicho que já funciona** — clínicas, odontologia, estética. A página fica mais
  forte, não mais fraca: copy de nicho converte melhor que copy genérica, e o laudo já está afiado
  para esse público. **É a minha recomendação para a primeira versão.**
- **(b) Generalizar o módulo antes** — trocar o vocabulário fixo por rótulos derivados do segmento
  informado na campanha. É uma mudança contida, no `report.ts` e no `pdf.ts`. Me peça e eu faço.
- **(c) Publicar genérico assumindo o desalinhamento** — não recomendo. O produto entrega menos do
  que a página promete, e o primeiro laudo entregue é justamente o momento de maior atenção do lead.

### 2. Os 3 segundos e os 5 minutos precisam de lastro

São constantes do produto usadas como comparativo, não medições. Se a página os apresentar como
desempenho comprovado, você precisa de uma medição real para sustentar. **Duas saídas honestas:** ou
meça o tempo de resposta da sua própria instalação e publique esse número, ou apresente-os como o
padrão que a IA entrega — sem alegar amostra.

### 3. O jurídico precisa ver a seção de objeções

Cliente oculto é prática legítima e antiga, mas três pontos específicos merecem revisão de quem
entende: a IA **não revela que é IA** e inventa dados plausíveis de persona; a transcrição contém
falas de um funcionário identificável da empresa auditada (dado pessoal, LGPD); e há os termos de
uso do WhatsApp sobre automação. Nada disso bloqueia o produto — mas a redação da página é onde a
exposição aparece. Leve a **seção 10 deste briefing** ao seu jurídico antes de publicar.

---

## 11. Ordem de construção sugerida

Se for construir por partes, esta ordem entrega valor a cada passo:

1. **Hero + laudo de exemplo aberto + formulário.** Só isso já vende — é a oferta inteira em uma tela.
2. **Como funciona + Do laudo à venda.** Responde "como" e "e depois?".
3. **Objeções.** Destrava quem entendeu e travou.
4. **CRM completo + marca própria.** Justifica o preço.
5. **Prova.** Entra quando você tiver prova de verdade — não antes.

---

*Briefing conferido contra o código em 2026-08-19. Módulo: `lib/mystery/` · tela: `/app/mystery`.*
