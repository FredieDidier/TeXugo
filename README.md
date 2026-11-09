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
- **Submissão:** ZIP que compila sozinho. Leva o `.bbl` no lugar do `.bib`, como o arXiv pede; traz para dentro os arquivos de fora da pasta do documento (como `../analysis/figuras`), com os caminhos ajustados só nas cópias; e, antes de dizer que está pronto, extrai o ZIP numa pasta vazia e compila como o arXiv faz, apontando erro, `??`, arquivo faltando ou arquivo lido de fora. **Checar antes de submeter**: anonimato para double-blind (nomes, e-mails, `\thanks`, agradecimentos, links do GitHub/OSF, caminhos absolutos com o seu usuário, comentários com nome, metadado de autor do PDF) e fontes do PDF (Type 3 e fontes não embutidas, que muitas revistas recusam); revisão de estilo com ChkTeX; contagem de palavras com texcount.
- **Adicionar referência** (⌥⌘R): cole um DOI, um link ou ID do arXiv, ou parte do título. O TeXugo busca no Crossref e no arXiv, mostra as opções, grava a entrada limpa no `.bib` do documento (chave no estilo `deschenes2011climate`, working paper do NBER com número) e já cita no cursor (`\citet` com natbib; dentro de um `\cite{}` aberto, só acrescenta a chave). Se o DOI já está no `.bib`, usa a chave que existe.
- **Cartão da citação**: passe o mouse sobre uma chave dentro de `\cite{}` e veja título, autores, ano e periódico, com links para o DOI, o arXiv, o Google Scholar e a entrada no `.bib`. Chave que não existe aparece em vermelho no cartão, com atalho para adicioná-la.
- **Colar tabela**: células copiadas do Excel, Numbers ou Google Sheets viram uma tabela `booktabs` ao colar num `.tex` (colunas de números centralizadas, `***` em sobrescrito, `_`, `%`, `$` e `&` escapados). Dentro de um `tabular` já aberto, entram só as linhas. Para CSV, use a paleta: *Colar tabela (Excel, CSV) como LaTeX*.
- **Formatar documento** (⌥⇧F) com o `latexindent` do TeX Live, numa edição só que o ⌘Z desfaz. Funciona mesmo no MacTeX, cujo `latexindent` costuma quebrar por falta do módulo Perl `File::HomeDir`: o TeXugo traz um substituto mínimo. Um `localSettings.yaml` na pasta do documento tem prioridade.
- **Médico do TeX:** mostra o estado da instalação e, quando a compilação reclama de um `.sty` ou `.cls` que falta, descobre o pacote do TeX Live que tem o arquivo e o instala com um clique. A senha de administrador é digitada na janela do próprio macOS. Se o TeX Live for de um ano anterior (congelado), usa o arquivo final daquele ano, o único que ainda aceita instalações.
- **Markdown** abre renderizado como no GitHub (Visualizar / Lado a lado / Código).
- **Detector de vícios de escrita** (tiques de IA), em português e inglês, sem IA e sem internet. Sublinha em roxo o vocabulário que os modelos usam muito mais que pessoas (com a época de cada palavra: *delve* em 2023–24, *showcasing* e *enhance* com o GPT‑5, *quietly* e *load-bearing* em 2025–26), travessões, “não só X, mas também Y”, gerúndio comentando a frase, “vale ressaltar que”, conclusões anunciadas, restos de conversa com o chatbot, Markdown colado no LaTeX, decalques (“the present study”, “endereçar o problema”), vírgula antes do “e” e Títulos Com Maiúsculas em português, e frases longas e encadeadas. Passando o mouse, diz o motivo, o que fazer e a fonte. Ignora o que não é texto: comentários, matemática, `\cite`, `\label`, preâmbulo, tabelas. O relatório (clique no contador da barra de status) cobre o documento inteiro, com mediana e percentis do tamanho das frases. As regras e as fontes ficam em `web/src/vicios/rules.js`, com a data da lista; são candidatos a revisar, não prova de autoria.
- **Reescrever com IA, usando o seu Claude Code.** Selecione um trecho e clique com o botão direito: Revisar, Polir, Humanizar (tirar tiques de IA, usando os vícios sublinhados como pista), Encurtar, Traduzir para o inglês, Fluidez e coesão, Deixar mais formal. O TeXugo chama o `claude` instalado no seu Mac, na pasta do projeto, com a sua conta e as suas skills (como a de escrita), e só com permissão de ler arquivos e carregar skills: ele nunca edita nada sozinho. A resposta aparece como diferença palavra a palavra, com uma nota do que mudou; Aceitar troca o trecho numa edição só (⌘Z desfaz). Um `estilo.md` na pasta do projeto tem prioridade sobre tudo; sem ele, vale um guia de estilo padrão.
- **Modelo e esforço do Claude.** No painel Claude, dois menus escolhem o modelo (Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 5.5) e o esforço (baixo, médio, alto, extra, máximo); o padrão é Opus 5.5 com esforço médio. A escolha vale para o painel, para o Claude Code no terminal e para as ações de IA na seleção. Trocar no meio de uma conversa continua a mesma conversa. Se o seu Claude Code for antigo demais para o modelo, o painel diz para rodar `claude update`. Mods do Claude Code que você tenha instalado, como o `jev-model-router` (que escolhe o esforço de cada mensagem), aparecem no painel: a linha de status do mod fica acima da caixa de mensagem e cada decisão aparece na conversa.
- **Terminal e Claude Code dentro do TeXugo.** Painel inferior, aba Terminal (⌃`): terminais de verdade na pasta do projeto, vários ao mesmo tempo, que continuam rodando se a janela recarregar. O botão **Claude Code** abre o seu `claude` ligado ao TeXugo pelo mesmo protocolo que o VS Code usa: o Claude vê a seleção em tempo real, as abas abertas e, como diagnósticos, os erros de compilação e os `??` da última compilação; cada edição que ele propõe aparece no TeXugo como diferença palavra a palavra para Aceitar ou Recusar, e ao aceitar ele grava e a aba recarrega (⌘Z desfaz). Arquivo com alterações não salvas não é sobrescrito: o TeXugo recusa e avisa. Botão direito → **Mencionar no Claude Code** põe o arquivo e as linhas no prompt. Compilar não tira você do terminal. Na primeira vez, o Claude Code pede para você entrar na sua conta.
- **Editor dividido** (⌘⌥\\ ou o botão de colunas na barra do documento): outro arquivo ao lado, como o artigo e o apêndice, ou dois trechos do mesmo arquivo. O que se digita de um lado aparece no outro na hora; ⌘S, ⌘↵ e ⌘J funcionam nos dois.
- **PDF numa janela separada**, para outro monitor, com SyncTeX entre as janelas.
- **Clonar do GitHub** direto como projeto novo.
- **Modelos (12), em pares por tema:** pesquisa (artigo; artigo + apêndice online; resposta aos pareceristas, com cada comentário num quadro, a resposta e a "mudança no texto"; parecer; projeto de pesquisa para edital ou tese; relatório), ensino (slides Beamer com o tema "Toca"; ementa de disciplina; prova com pontos somados, quadro de notas e gabarito com uma linha; lista de exercícios com soluções só na versão do professor) e outros (carta; documento em branco). Artigo e artigo + apêndice têm **formato do periódico**: Padrão (working paper), AEA (AER, AEJ, Insights: espaço duplo, JEL, aer.bst), Elsevier (JDE, JPubE, JUE, JEEM: elsarticle com highlights e JEL) e Econometrica (ecta.bst). Com a interface em inglês, os modelos saem em inglês.
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

Para que cada commit reinstale o app sozinho (em segundo plano; o macOS avisa quando terminar, e o log fica em `out/auto-install.log`):

```bash
git config core.hooksPath .githooks
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
| ⌥⌘R | Adiciona referência por DOI, arXiv ou título |
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
