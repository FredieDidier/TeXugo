<p align="center"><img src="web/assets/logo.svg" width="120" alt="TeXugo"></p>

<h1 align="center">TeXugo</h1>
<p align="center"><i>Bravo com os erros, manso com você.</i></p>

TeXugo é um editor LaTeX local para Mac. Os arquivos ficam no seu disco, a compilação usa o seu TeX Live e nada vai para a nuvem. Serve para papers, apêndices online, slides em Beamer, ementas, provas, listas de exercícios, relatórios, pareceres e cartas.

## O que ele faz melhor

- **Várias abas, cada uma com o seu botão Compilar.** A aba mostra o documento raiz a que o arquivo pertence. Quando o arquivo entra em mais de um documento (por exemplo, `sections/body.tex` em `paper.tex` e em `paper_wp.tex`), um seletor deixa você escolher qual compilar.
- **Compilar tudo.** O botão do topo (⌘⇧↵) compila todos os documentos das abas abertas, cada um uma vez só, e diz quantos são ("Compilar os 2 documentos"). Passando o mouse, um balão lista quais documentos e que abas entram em cada um.
- **Zero `??` com `\externaldocument`.** Quando o paper importa os rótulos do apêndice (`xr`/`xr-hyper`) e o apêndice importa os do paper, compilar um arquivo sozinho deixa `??` no PDF. O TeXugo compila o grupo inteiro na ordem certa e repete até os rótulos se estabilizarem. Ele também sobrevive a `.aux` apagados e a `.bbl` órfãos, que fazem o `latexmk` rodar o BibTeX antes do LaTeX.
- **Cada `??` vem com o motivo.** O painel Problemas lista as referências e citações indefinidas e diz a causa provável: rótulo inexistente, rótulo que está noutro documento sem `\externaldocument`, chave que não existe em nenhum `.bib`. Os erros do LaTeX vêm com uma dica em português e a linha certa.
- **Linha do tempo da compilação.** Mostra o que está rodando, em que passada e por quê ("rótulos de paper.tex mudaram").
- **PDF ao lado, uma aba por documento.** O PDF recarrega no mesmo ponto depois de compilar. SyncTeX: ⌘J leva do código ao PDF, e um clique duplo no PDF leva à linha do código. Há um modo escuro só para a tela. Num PDF compilado fora do TeXugo, sem SyncTeX, o app explica o motivo e oferece compilar.
- **Editor de verdade.** CodeMirror com destaque de LaTeX, autocompletar de `\ref`/`\cref` (a partir dos rótulos do projeto), de `\cite` (a partir das chaves do `.bib`) e de ambientes, snippets de figura, tabela e slide, `\end{…}` automático, ⌘B/⌘I e comentário com ⌘/.
- **Arquivos mudados fora do app** (git pull, Claude Code, outro editor) recarregam sozinhos. Se você tiver alterações não salvas, o app pergunta antes de sobrescrever.
- **Git e GitHub.** Status, diff, commit, pull e push no painel lateral, usando o git do sistema e as credenciais que o GitHub Desktop já configurou. Ao abrir um repositório, o TeXugo completa o `.gitignore` com os auxiliares do LaTeX (`.aux`, `.log`, `.fls`…), para eles não aparecerem nos commits.
- **Slides:** botão "Apresentar" para Beamer (tela cheia, um slide por vez, setas e clique) e um modo em que o PDF acompanha o cursor do editor.
- **Submissão:** ZIP que compila sozinho. Leva o `.bbl` no lugar do `.bib`, como o arXiv pede; traz para dentro os arquivos de fora da pasta do documento (como `../analysis/figuras`), com os caminhos ajustados só nas cópias; e, antes de dizer que está pronto, extrai o ZIP numa pasta vazia e compila como o arXiv faz, apontando erro, `??`, arquivo faltando ou arquivo lido de fora. checagem de anonimato para double-blind (nomes, e-mails, `\thanks`, agradecimentos, links do GitHub/OSF, comentários com nome, metadado de autor do PDF); revisão de estilo com ChkTeX; contagem de palavras com texcount.
- **Formatar documento** (⌥⇧F) com o `latexindent` do TeX Live, numa edição só que o ⌘Z desfaz. Funciona mesmo no MacTeX, cujo `latexindent` costuma quebrar por falta do módulo Perl `File::HomeDir`: o TeXugo traz um substituto mínimo. Um `localSettings.yaml` na pasta do documento tem prioridade.
- **Médico do TeX:** mostra o estado da instalação e, quando a compilação reclama de um `.sty` ou `.cls` que falta, descobre o pacote do TeX Live que tem o arquivo e o instala com um clique. A senha de administrador é digitada na janela do próprio macOS. Se o TeX Live for de um ano anterior (congelado), usa o arquivo final daquele ano, o único que ainda aceita instalações.
- **Markdown** abre renderizado como no GitHub (Visualizar / Lado a lado / Código).
- **Editor dividido** (⌘⌥\\ ou o botão de colunas na barra do documento): outro arquivo ao lado, como o artigo e o apêndice, ou dois trechos do mesmo arquivo. O que se digita de um lado aparece no outro na hora; ⌘S, ⌘↵ e ⌘J funcionam nos dois.
- **PDF numa janela separada**, para outro monitor, com SyncTeX entre as janelas.
- **Clonar do GitHub** direto como projeto novo.
- **Modelos (10):** artigo, artigo + apêndice online, slides Beamer (tema "Toca"), ementa de disciplina, prova (pontos somados, quadro de notas e gabarito com uma linha), lista de exercícios (soluções só na versão do professor), parecer, carta, relatório (capa, sumário executivo, gráfico e tabela) e documento em branco. Com a interface em inglês, os modelos saem em inglês.
- **Português ou inglês:** a interface inteira, inclusive menus, dicas e mensagens de erro, troca de idioma em Preferências → Idioma.
- **Tela inicial** (clique no logo ou na casinha): modelos, abrir pasta, clonar do GitHub e projetos recentes.
- **Preferências:** fonte, tamanho e espaçamento do editor e da visualização de Markdown; tema; compilar ao salvar.
- Busca no projeto, estrutura do documento (seções, slides, rótulos), paleta de comandos (⌘K), abertura rápida (⌘P), contagem de palavras, temas claro e escuro.

## Rodar

Precisa do [MacTeX](https://tug.org/mactex/) (ou outro TeX Live com `latexmk`) e do Node 20 ou mais novo.

```bash
npm install
npm start
```

Para desenvolver no navegador, sem o Electron (usa preferências próprias, separadas das do app instalado):

```bash
npm run serve
```

Para gerar o `out/TeXugo.app` (arraste para Aplicativos; se já houver um TeXugo lá, ele é atualizado):

```bash
npm run package
```

Testes do motor de compilação e dos modelos:

```bash
npm test
```

## Atalhos

| Atalho | O que faz |
|---|---|
| ⌘↵ | Compila o documento da aba |
| ⌘⇧↵ | Compila tudo que está aberto |
| ⌘S / ⌥⌘S | Salva a aba / todas |
| ⌘J | Mostra no PDF o trecho do cursor |
| clique duplo no PDF | Vai para a linha do código |
| ⌥⇧F | Formata o documento (latexindent) |
| ⌘P | Abre um arquivo |
| ⌘K | Paleta de comandos |
| ⌘⇧F | Busca no projeto |
| ⌘\\ | Mostra ou esconde a barra lateral |
| ⌘⌥\\ | Divide o editor ou fecha a divisão |
| ⌃Tab | Próxima aba |

## Como funciona

- `server/`: servidor local em Node. Cuida de arquivos, compilação (`build.js`), leitura do log (`logparse.js`), SyncTeX e git. Só aceita conexões de `127.0.0.1` com um token gerado a cada abertura do app.
- `web/`: interface (CodeMirror 6 + pdf.js), empacotada com esbuild em `dist/`.
- `server/doctor.js`: Médico do TeX e `latexindent`; `server/submission.js`: ZIP e checagem de anonimato; `server/templates/`: os modelos (versão em inglês em `<modelo>/en/`).
- `web/src/i18n.js`: tradução da interface para o inglês.
- `electron/`: a janela do Mac, os menus, o seletor de pastas e o "mover para o Lixo".
