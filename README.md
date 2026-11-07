<p align="center"><img src="web/assets/logo.svg" width="120" alt="TeXugo"></p>

<h1 align="center">TeXugo</h1>
<p align="center"><i>O bicho que cava até achar a referência. Zero <code>??</code> no seu PDF.</i></p>

TeXugo é um editor LaTeX local para Mac. Os arquivos ficam no seu disco, a compilação usa o seu TeX Live e nada vai para a nuvem. Serve para papers, apêndices online, slides em Beamer, ementas, pareceres e cartas.

## O que ele faz melhor

- **Várias abas, cada uma com o seu botão Compilar.** A aba mostra o documento raiz a que o arquivo pertence. Quando o arquivo entra em mais de um documento (por exemplo, `sections/body.tex` em `paper.tex` e em `paper_wp.tex`), um seletor deixa você escolher qual compilar.
- **Compilar tudo.** Um botão (⌘⇧↵) compila todos os documentos das abas abertas, cada um uma vez só.
- **Zero `??` com `\externaldocument`.** Quando o paper importa os rótulos do apêndice (`xr`/`xr-hyper`) e o apêndice importa os do paper, compilar um arquivo sozinho deixa `??` no PDF. O TeXugo compila o grupo inteiro na ordem certa e repete até os rótulos se estabilizarem. Ele também sobrevive a `.aux` apagados e a `.bbl` órfãos, que fazem o `latexmk` rodar o BibTeX antes do LaTeX.
- **Cada `??` vem com o motivo.** O painel Problemas lista as referências e citações indefinidas e diz a causa provável: rótulo inexistente, rótulo que está noutro documento sem `\externaldocument`, chave que não existe em nenhum `.bib`. Os erros do LaTeX vêm com uma dica em português e a linha certa.
- **Linha do tempo da compilação.** Mostra o que está rodando, em que passada e por quê ("rótulos de paper.tex mudaram").
- **PDF ao lado, uma aba por documento.** O PDF recarrega no mesmo ponto depois de compilar. SyncTeX: ⌘J leva do código ao PDF, e um clique duplo no PDF leva à linha do código. Há um modo escuro só para a tela.
- **Editor de verdade.** CodeMirror com destaque de LaTeX, autocompletar de `\ref`/`\cref` (a partir dos rótulos do projeto), de `\cite` (a partir das chaves do `.bib`) e de ambientes, snippets de figura, tabela e slide, `\end{…}` automático, ⌘B/⌘I e comentário com ⌘/.
- **Arquivos mudados fora do app** (git pull, Claude Code, outro editor) recarregam sozinhos. Se você tiver alterações não salvas, o app pergunta antes de sobrescrever.
- **Git e GitHub.** Status, diff, commit, pull e push no painel lateral, usando o git do sistema e as credenciais que o GitHub Desktop já configurou.
- **Slides:** botão "Apresentar" para Beamer (tela cheia, um slide por vez, setas e clique) e um modo em que o PDF acompanha o cursor do editor.
- **Submissão:** ZIP que compila sozinho (leva o `.bbl` no lugar do `.bib`, como o arXiv pede, e avisa quando uma figura está fora da pasta do documento); checagem de anonimato para double-blind (nomes, e-mails, `\thanks`, agradecimentos, links do GitHub/OSF, comentários com nome, metadado de autor do PDF); revisão de estilo com ChkTeX; contagem de palavras com texcount.
- **Modelos:** artigo, artigo + apêndice online, slides Beamer (tema "Toca"), ementa de disciplina, parecer, carta e documento em branco.
- Busca no projeto, estrutura do documento (seções, slides, rótulos), paleta de comandos (⌘K), abertura rápida (⌘P), contagem de palavras, temas claro e escuro.

## Rodar

Precisa do [MacTeX](https://tug.org/mactex/) (ou outro TeX Live com `latexmk`) e do Node 20 ou mais novo.

```bash
npm install
npm start
```

Para desenvolver no navegador, sem o Electron:

```bash
npm run serve
```

Para gerar o `out/TeXugo.app` (arraste para Aplicativos):

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
| ⌘P | Abre um arquivo |
| ⌘K | Paleta de comandos |
| ⌘⇧F | Busca no projeto |
| ⌘\\ | Mostra ou esconde a barra lateral |
| ⌃Tab | Próxima aba |

## Como funciona

- `server/`: servidor local em Node. Cuida de arquivos, compilação (`build.js`), leitura do log (`logparse.js`), SyncTeX e git. Só aceita conexões de `127.0.0.1` com um token gerado a cada abertura do app.
- `web/`: interface (CodeMirror 6 + pdf.js), empacotada com esbuild em `dist/`.
- `electron/`: a janela do Mac, os menus, o seletor de pastas e o "mover para o Lixo".
