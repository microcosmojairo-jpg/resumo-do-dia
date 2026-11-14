# Resumo do Dia

App pessoal e gratuito com as principais notícias das últimas 24 horas (das 6:00 de ontem às 5:59 de hoje), pronto todo dia às 6:00.

## Como funciona
- **Robô (`robo/buscar_noticias.py`)**: roda sozinho no GitHub às 6:00 (horário da Bahia). Lê os feeds RSS oficiais de `robo/fontes.json`, com no máximo 2 tentativas de 10 segundos por fonte. Se uma fonte falhar, ele pula. Junta a mesma notícia de veículos diferentes, escolhe "As 3 do dia" (as que mais veículos publicaram) e grava o resultado em `dados/`. Guarda só os últimos 7 dias.
- **Sem notícia inventada**: não usa inteligência artificial. O app mostra exatamente o título e o trecho que o veículo publicou, mais o link para a matéria original.
- **App (`index.html`, `app.js`, `estilo.css`)**: abre no navegador do celular e pode ser instalado na tela inicial. Tem o botão "Ouvir" (voz do próprio celular), configurações (Boas notícias, Meus temas, fontes, tamanho da letra), histórico de 7 dias e funciona sem internet depois de aberto uma vez.

## Tarefas comuns
- **Rodar agora**: aba *Actions* → *Resumo das 6h* → *Run workflow*.
- **Tirar ou pôr uma fonte**: edite `robo/fontes.json` e mude `"ativa"` para `false` ou `true`.

## Cuidados legais
Mostra só título, trecho do feed e link, sempre com o nome do veículo. Não copia matérias inteiras, não usa logotipos e não contorna paywall. Não coleta dados pessoais (veja `privacidade.html`).
