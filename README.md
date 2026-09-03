# Descadastrar (ActiveCampaign)

Página interna para buscar lead por telefone e/ou e-mail no ActiveCampaign e, ao confirmar, aplicar a tag `descadastrar`.

## Requisitos

- Node.js 18+
- Credenciais ActiveCampaign

## Setup local

```bash
cd descadastrar
cp .env.example .env
# edite ACTIVECAMPAIGN_API_URL e ACTIVECAMPAIGN_API_KEY
npm install
npm start
```

Abra: http://127.0.0.1:3847/

## Variáveis de ambiente

| Var | Descrição |
|---|---|
| `ACTIVECAMPAIGN_API_URL` | Base da API (ex.: `https://xxxx.api-us1.com`) |
| `ACTIVECAMPAIGN_API_KEY` | Api-Token (nunca no frontend) |
| `PORT` | Porta HTTP (default `3847`) |
| `BASE_PATH` | Prefixo de path (ex.: `/descadastrar` em prod) |
| `DESCADASTRAR_TAG_NAME` | Nome da tag (default `descadastrar`) |
| `DESCADASTRAR_USER` | Login (default `admin`) |
| `DESCADASTRAR_PASS` | Senha (default `admin`) |

Aliases: `ACTIVE_API_BASE`, `ACTIVE_API_TOKEN`.

## Deploy VPS + nginx (`/descadastrar`)

1. Copie a pasta `descadastrar/` para a VPS e configure `.env` com `BASE_PATH=/descadastrar`.
2. Rode com systemd/pm2, ex.: `node server.js` na porta local (ex. `3847`).
3. Nginx:

```nginx
location /descadastrar/ {
  proxy_pass http://127.0.0.1:3847/descadastrar/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Recomenda-se restringir acesso (basic auth no nginx) em domínio público.

## API

- `POST ${BASE_PATH}/api/buscar` — `{ "email"?, "telefone"? }`
- `POST ${BASE_PATH}/api/descadastrar` — `{ "contactId" }`
