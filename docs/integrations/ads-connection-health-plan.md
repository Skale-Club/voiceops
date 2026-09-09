# Saúde das conexões de anúncios — plano de conserto

> Escrito em 2026-09-09 depois de três reconexões do Meta que "não funcionaram". Elas
> funcionaram. O que está quebrado é o campo que diz se funcionaram.

## O defeito, com a evidência de hoje

`ads_connections.status` guarda duas coisas que não têm nada a ver uma com a outra:

| Valor | O que significa hoje | Natureza |
|---|---|---|
| `active` | conta escolhida pelo admin para aparecer no workspace | **seleção** |
| `available` | conectada, mas o admin ainda não optou por ela | **seleção** |
| `error` | a plataforma rejeitou a credencial | **saúde** |
| `revoked` | previsto na `CHECK`, nenhum escritor usa (o disconnect apaga a linha) | **saúde** |

Quando uma conta entra em `error`, o valor de seleção que ela tinha (`active` ou
`available`) é **sobrescrito e perdido**. E o retorno do login do Facebook
(`src/app/api/ads/meta/callback/route.ts`, linha 87) faz de propósito:

```ts
status: existingStatus.get(account.id) ?? 'available',
connection_error: null,
```

A intenção do comentário acima dessa linha é boa: não fazer todas as contas aparecerem
de uma vez. O efeito colateral é que **`error` também é preservado**. Reconectar renova o
token, apaga a mensagem de erro, e deixa o status em `error` para sempre. O callback do
Google (`src/app/api/ads/google/callback/route.ts`, linha 82) tem exatamente a mesma linha.

Medido em produção hoje, 2026-09-09:

- 42 linhas Meta e 20 Google, **todas** em `error`. Nenhuma `active`, nenhuma `available`.
- Depois da reconexão das 14:12 UTC, `token_expires_at` das linhas Meta passou de
  2026-08-02/08-14 para **2026-11-08**. O token é novo.
- `connection_error` e `last_error_at` continuaram com o valor de **2026-08-23**.
- O banner mudou de "The access token expired" para o texto genérico "The stored access
  token was rejected". Isso é a prova definitiva: o callback rodou e zerou
  `connection_error` (por isso o banner caiu no texto de fallback), mas `status` ficou
  `error` (por isso o banner ainda aparece).

Agravantes encontrados no caminho:

1. `markConnectionHealthy` (`src/lib/ads/connection-health.ts`, linha 95) recupera uma
   conta gravando `status: 'active'`. Ou seja, o erro de informação acontece nas duas
   direções: entrar em `error` perde a seleção, e sair de `error` **força** a seleção.
   Uma conta que o admin escondeu de propósito reaparece quando a credencial se recupera.
2. Nada no caminho do Meta chama `withConnectionHealth`. O Google chama em
   `api/ads/google/campaigns` e `reports`; os quatro chamadores de `src/lib/ads/meta-api.ts`
   (`api/ads/meta/campaigns`, `api/ads/meta/reports`, `lib/copilot/tools/ads.ts`,
   `lib/mcp/tools/ads.ts`) não. Uma conexão Meta nunca se recupera sozinha, e um erro de
   credencial no meio de um relatório não marca nada.
3. Dezessete pontos de leitura decidem "posso usar esta conexão?" com
   `status === 'active'`, misturando de novo seleção e saúde: as páginas de campanhas,
   adsets, CAPI, relatórios, `ai-accounts.ts`, `journey-db.ts`, `snapshot-daily.ts`, o
   formulário e as actions de Meta Audience, e `lib/meta/audience-provider.ts`
   (`CONNECTION_INACTIVE`). Hoje isso funciona por acidente: como `error` sobrescreve
   `active`, "active" implica "saudável". Ao separar os dois, cada um desses pontos
   precisa passar a exigir os dois.

Este é o espelho do problema perseguido ontem no Xmail. Lá, um número dizia "saudável" sem
medir nada. Aqui, um campo diz "quebrado" com a coisa funcionando. Os dois enganam quem lê,
e os dois têm a mesma cura: um campo, um significado.

## O desenho

`status` passa a significar **só seleção**: `active` ou `available`. Uma coluna nova,
`health`, passa a significar **só saúde**: `ok`, `error` ou `revoked`. E uma coluna gerada,
`usable`, responde à pergunta que os dezessete leitores fazem, num lugar só:

```sql
usable boolean GENERATED ALWAYS AS (status = 'active' AND health = 'ok') STORED
```

Quem quer listar contas para o admin escolher lê `status`. Quem quer mostrar o banner lê
`health`. Quem quer chamar a API da plataforma lê `usable`. Nenhum escritor toca no campo
do outro.

## Fases

### Fase 1 — Migração `1300_ads_connection_health.sql`

Verificar que `1300` é o próximo número livre listando `supabase/migrations/` (hoje o
último é `1299_xmail_imported_at.sql`). Aplicar só com `npx supabase db push`, conforme o
`CLAUDE.md` deste repo.

1. `ALTER TABLE ads_connections ADD COLUMN IF NOT EXISTS health text NOT NULL DEFAULT 'ok'`
   com `CHECK (health IN ('ok','error','revoked'))`.
2. Backfill, na mesma transação, **antes** de estreitar `status`:
   - `status = 'error'` e token vencido ou nulo → `health = 'error'`, `status = 'available'`.
   - `status = 'error'` e token válido → `health = 'ok'`, `status = 'available'`.
     Provisório e declarado como tal: o token existe e não venceu, mas ninguém o
     exercitou. A primeira chamada real (fase 4) corrige `health` se estiver errado.
   - `status = 'revoked'` → `health = 'revoked'`, `status = 'available'`.
   A seleção anterior dessas linhas foi destruída pelo defeito; **não inventar**. Todas
   voltam como `available` e o admin escolhe de novo pelo diálogo "Select ad accounts",
   que já existe. Registrar no cabeçalho da migração que isso é perda de informação
   causada pelo bug, não decisão de produto.
3. `DROP CONSTRAINT IF EXISTS ads_connections_status_check` e recriar com
   `status IN ('active','available')`. Só depois do backfill, senão a própria migração
   viola a restrição nova.
4. `ADD COLUMN IF NOT EXISTS usable boolean GENERATED ALWAYS AS (...) STORED` e índice
   `(org_id, platform) WHERE usable`.
5. `src/types/database.ts` atualizado nas três colunas.

Idempotente: `IF NOT EXISTS` em tudo, `DROP ... IF EXISTS` na constraint, backfill com
`WHERE` que não reprocessa linha já migrada.

### Fase 2 — Escritores

- `api/ads/meta/callback/route.ts` e `api/ads/google/callback/route.ts`: preservar
  `status` (seleção) exatamente como hoje, e gravar `health: 'ok'`,
  `connection_error: null`, `last_error_at: null`, `last_verified_at: now()`. O callback
  acabou de listar as contas com o token novo, então **este é um momento de verificação
  real**, não uma suposição.
- `markConnectionError`: gravar `health: 'error'` e o erro; **não tocar em `status`**.
- `markConnectionHealthy`: gravar `health: 'ok'` e `last_verified_at`; **não tocar em
  `status`**; remover o filtro `.eq('status','error')`, que passa a ser
  `.eq('health','error')`.
- `_actions/account-selection.ts`: continua escrevendo só `status`. Sem mudança, mas
  ganha um teste que garante que ele não zera `health`.
- `api/ads/meta/disconnect/route.ts` apaga a linha; `revoked` fica na `CHECK` de `health`
  apenas se algum escritor passar a usá-lo. Se nenhum usar, tirar da `CHECK` e do tipo.

### Fase 3 — Leitores

Os dezessete pontos que hoje fazem `.eq('status','active')` ou
`c.status === 'active'` para decidir se podem **usar** a conexão passam a usar
`.eq('usable', true)` / `c.usable`. A lista, para ninguém escapar:
`ads/page.tsx`, `ads/google/page.tsx`, `ads/campaigns/page.tsx`, `ads/adsets/page.tsx`,
`ads/google/campaigns/page.tsx`, `ads/capi/actions.ts`, `lib/ads/ai-accounts.ts` (2),
`lib/ads/journey-db.ts`, `lib/ads/snapshot-daily.ts`, `api/ads/google/campaigns`,
`api/ads/google/reports`, `api/ads/meta/campaigns`, `api/ads/meta/reports`,
`settings/integrations/meta-audience/actions.ts` (linha 160),
`meta-audience-form.tsx` (linhas 65, 188–189), `lib/meta/audience-provider.ts` (linha 113).

Os que listam para **seleção** continuam em `status`: `manage-accounts-dialog.tsx`,
`account-selection.ts`, e o `capi-config-form.tsx`, que mostra o status entre parênteses e
passa a mostrar `health` quando não for `ok`.

`connection-health-banner.tsx`: `broken = health === 'error'`. O aviso de expiração
próxima (`daysUntilExpiry`, `EXPIRY_WARNING_DAYS = 7`) fica como está.

### Fase 4 — API do Meta com saúde

Envolver os quatro chamadores de `meta-api.ts` em `withConnectionHealth`, como o Google
já faz. As funções de `meta-api.ts` recebem `(adAccountId, accessToken)` e não conhecem a
organização, então o envoltório fica no chamador, que tem `orgId`. Alternativa aceitável:
uma `withMetaConnection(orgId, adAccountId, op)` em `lib/ads/` para não repetir quatro
vezes. `isAuthError` decide o que é rejeição de credencial; limite de taxa e 5xx continuam
passando sem marcar nada, como o comentário da função já exige.

Com isso, uma conexão Meta se recupera sozinha na primeira chamada bem-sucedida, e o
backfill provisório da fase 1 se corrige sem intervenção.

### Fase 5 — Testes

- `tests/ads-connection-health.test.ts`: `markConnectionError` não toca em `status`;
  `markConnectionHealthy` não toca em `status` e limpa `health`; `withConnectionHealth`
  recupera de `error` para `ok` sem mudar a seleção.
- `tests/meta-oauth-actions.test.ts`: o callback preserva `active`/`available` e grava
  `health: 'ok'` mesmo para uma linha que estava em `error`. Mesmo teste para o Google.
- Novo teste da coluna gerada, no projeto de banco do release gate se ele cobrir
  `ads_connections`; se não, um teste puro da regra `active && ok` no helper que a
  espelha em TypeScript.
- Meta Audience: `configReady` exige `usable`, não `status`.

`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` sem erro novo (o repo tem
~139 erros pré-existentes em `tests/**`, documentados). `eslint --max-warnings 0` nos
arquivos tocados. Não rodar a suíte inteira: há suítes que batem no banco vivo.

### Fase 6 — Deploy e destravamento

`dev` → `main` só quando você mandar, como combinado. A migração é aplicada **antes** do
código, porque o deploy não aplica migração e o código novo lê `health` e `usable`.

Depois do deploy, o caminho é o que a interface já tem, sem cirurgia no banco:

1. Ads → Meta Ads: o banner some, porque `health` das linhas Meta é `ok`.
2. "Select ad accounts": escolher **Skale Club | U$** (`act_244922277802045`), que é a
   conta natural para barbearias em Massachusetts. A escolha é sua; a conta vira `active`
   e, com `health = 'ok'`, `usable`.
3. Configurações → Integrações → Meta Audience: o seletor passa a mostrar só contas
   `usable`; o nome "Skale Club - Xcraper Prospects" e o escopo "All Xcraper prospects"
   já estão preenchidos. Marcar a confirmação de direito de uso dos dados é declaração
   legal sua; eu não marco.
4. Criar a audiência em modo dry-run primeiro, como o próprio formulário sugere, e ler o
   resultado antes da gravação real.

As 20 linhas do Google continuam `health = 'error'` com razão: os tokens venceram em
junho. O mesmo botão Reconnect, na aba Google Ads, resolve, e desta vez o status vai
refletir o resultado.

## Custo e risco

Um commit por fase, todos na `dev`. A migração é aditiva até o passo 3, onde estreita a
`CHECK` de `status`; o backfill na mesma transação garante que nenhuma linha viola.
O maior risco está na fase 3: um leitor esquecido em `status === 'active'` passa a usar
uma credencial rejeitada, porque `error` não sobrescreve mais `active`. Por isso a lista
é nominal, e a coluna gerada existe: um único lugar define "usável".

## Este é o segundo conserto desta área

O commit `b36d2aaa` (2026-08-21), intitulado **"fix(ads): fix connection health"**, é onde a
conflação nasceu. Ele acrescentou `'error'` à mesma coluna que já guardava a seleção de
contas do admin. Foi entregue com 71 testes em 7 suítes, build e lint limpos, e a mensagem
dizia, corretamente, que passava a detectar credencial morta em vez de deixar o status em
`active`.

Ele acertou a metade que dá para testar de fora: **detectar** a rejeição e mostrar o
banner. Não fechou o ciclo, que é **sair** do estado de erro. A função de recuperação
(`markConnectionHealthy`) nasceu naquele mesmo commit e, no caminho do Meta, nunca foi
chamada por ninguém.

Dois dias depois, em 2026-08-23, todas as 62 linhas entraram em `error`. Essa data ainda
estava gravada em `last_error_at` quando este plano foi escrito, duas semanas e várias
reconexões depois.

O efeito para quem usa: cada reconexão **funcionava** — o token era renovado — e o alarme
continuava na tela, porque nada no sistema tinha permissão de dizer "melhorou". O usuário
pediu o conserto várias vezes e recebeu, a cada vez, a resposta de que estava consertado.
O defeito é bom em se esconder: ele se parece exatamente com o problema que ele não é.

**A armadilha desta área, escrita para a próxima pessoa: declarar vitória na detecção.**
Um teste que prova que um erro pode ser marcado não prova nada sobre a recuperação. O
guarda contra uma terceira rodada é o teste de ida e volta em
`tests/ads-connection-health.test.ts`, no `describe` "Round trip: a reconnect must fix
health AND preserve the prior selection": ele parte de uma conexão presa em erro, aplica um
callback bem-sucedido, e exige as duas coisas — que a saúde volte a `ok` **e** que a
seleção anterior continue intacta, tanto para uma conta visível quanto para uma escondida.
Se algum dia esse `describe` for removido ou afrouxado, é sinal de que a terceira rodada
começou.
