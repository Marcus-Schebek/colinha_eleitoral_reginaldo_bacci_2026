# Colinha Bacci 2026 — Vercel

Projeto configurado para Vercel com Functions Node.js clássicas (`req, res`).

## Desenvolvimento

```powershell
npx vercel dev
```

Teste:

```text
http://localhost:3000/api/candidates/lookup?uf=RS&office=DEPUTADO_FEDERAL&number=1245
```

## Deploy

```powershell
npx vercel
```

A Function está configurada para a região `gru1` (São Paulo).

O lookup consulta o TSE através da Function e devolve o status/corpo original quando o TSE responde erro, inclusive 403.
