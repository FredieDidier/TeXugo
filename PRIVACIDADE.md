# Privacidade no TeXugo

<p><b>Português</b> · <a href="PRIVACY.md">English</a></p>

O TeXugo roda no seu computador. Os seus arquivos ficam no seu disco, e a compilação usa o seu próprio TeX. O TeXugo não tem servidor, não pede conta, não coleta estatísticas de uso e não manda nada para o autor do app.

Alguns recursos, todos opcionais, falam com serviços de fora. A tabela diz quais, quando e o que vai em cada caso.

## O que sai do computador

| Para onde | Quando | O que vai | Como evitar |
|---|---|---|---|
| Anthropic, pelo **seu** Claude Code | Ações de IA no texto, painel do Claude, parecer, resposta aos pareceristas | O trecho escolhido e o contexto em volta. No parecer vai o paper inteiro, e na resposta vão os pareceres que você colar. Vai também tudo o que o agente ler no projeto | Não usar os recursos de IA |
| Crossref (`api.crossref.org`) | Adicionar referência, verificar referências | O DOI, o título e o primeiro autor de cada entrada | Não usar esses dois recursos |
| OpenAlex (`api.openalex.org`) | Os mesmos | O título | O mesmo |
| arXiv (`export.arxiv.org`) | Adicionar referência pelo identificador do arXiv | O identificador | O mesmo |
| LanguageTool online (`api.languagetool.org`) | Só se você escolher o servidor online nas Preferências | Os parágrafos do texto | O padrão é o servidor local, no seu computador |
| Remoto do Git (GitHub ou outro) | Ao abrir o projeto (`fetch`), e em pull, push, Sincronizar e clonar | O que o Git manda normalmente | Usar um projeto sem remoto |
| Espelhos do TeX Live | Médico do TeX, ao procurar e instalar um pacote | O nome dos pacotes | Não usar o Médico do TeX |
| LanguageTool (`languagetool.org`) | Só se você clicar em *Baixar* no corretor avançado de inglês (Preferências → Corretor) | O pedido de download dos n-gramas (9 GB). Nenhum texto seu vai junto | Não baixar |
| Homebrew | Instalar o LanguageTool pelo botão | O que o `brew` manda normalmente | Instalar à mão |
| Google (dicionários do Chromium) | No Windows e no Linux, na primeira vez que o corretor ortográfico do sistema é usado | O pedido de download do dicionário | Usar no Mac, que usa o dicionário do macOS |

As consultas a Crossref, OpenAlex e arXiv mandam o cabeçalho `User-Agent: TeXugo (LaTeX editor; https://github.com/FredieDidier/TeXugo)`. Ele identifica o app, não a pessoa que o usa.

As ações de IA usam o Claude Code que **você** instalou e com a **sua** conta. O TeXugo não tem chave própria nem intermedia a conversa. O que a Anthropic faz com o que recebe segue a política da sua conta Claude.

## O que fica no computador

- **`state.json`**, na pasta de dados do app: projetos recentes, preferências, dicionário pessoal e as pastas em que você disse confiar.
- **A biblioteca de papers**, também na pasta de dados do app: os PDFs e o texto extraído deles.
- **Os n-gramas do corretor avançado**, se você baixar, e as **cópias das abas não salvas** (para recuperar o trabalho se o app cair), também na pasta de dados do app. As cópias somem quando você salva ou descarta.
- **`.texugo/`**, em cada projeto. Fica fora do Git e guarda a prévia ao vivo, os PDFs de diferenças, as versões enviadas, os pareceres gerados e o estado das anotações e do checklist de replicação.
- **`.git/texugo-visit.json`**: a marca da sua última visita às novidades dos coautores.
- **`~/.claude/ide/<porta>.lock`**, só enquanto um Claude Code está ligado ao app.

## O que vai junto com o projeto

- **`.texugo-comments/`**, em cada projeto, **entra no commit**. Assim os coautores veem os comentários no texto. Cada comentário leva o nome do autor (o `user.name` do Git), o texto e a data. **Não leva e-mail.** Comentários antigos que ainda tinham e-mail podem ser limpos pela paleta, em "Remover e-mails dos comentários".

## Projetos de outras pessoas

Um projeto pode trazer um `latexmkrc`, que o latexmk executa ao compilar, ou uma pasta `.claude/`, com configurações que o Claude Code executa. Na primeira vez que você abre uma pasta assim, ou quando um desses arquivos chega com o projeto aberto, o TeXugo pergunta se você confia em quem fez o projeto. Enquanto você não confirmar, o Claude Code roda só com as suas configurações, não com as do projeto.
