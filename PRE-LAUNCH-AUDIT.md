# Auditoria de pré-lançamento do TeXugo

Data: 11/11/2026. Commit auditado: `49fb21f` (branch `main`, árvore limpa). Versão no `package.json`: 0.1.0.
Auditor: Claude Fable 5.2. Leitor previsto: Fredie e o Opus 5.5, que vai implementar.

Nenhum arquivo do repositório foi alterado. Este relatório é o único arquivo novo.

## Itens já corrigidos

Marcados com ✅ e **CORRIGIDO** no título. Feitos em 11/11/2026, na passada de design, UX e acessibilidade (Claude Fable 5.2): **B1, B2, B3, I14, D1 e D6**. Cada um traz uma linha "Estado" com o que foi feito, como foi verificado e o que sobrou. O resto do relatório segue pendente.

## Segunda passada de UX (11/11/2026)

Feita no app Electron real, com perfil e projeto temporários (modelo *Artigo + apêndice*, textos neutros), em 1480×870, 1200×760, 1000×640 e 900×560, tema claro e escuro, português e inglês. Capturas por `capturePage`, teclado por eventos reais (`sendInputEvent`), contraste calculado sobre as cores computadas de cada texto visível, árvore de acessibilidade lida pelo protocolo do Chromium. **Nenhum bloqueador mudou de estado nesta passada.** Os achados novos levam a letra U; todos os listados abaixo estão corrigidos, com teste.

| # | Problema encontrado na tela | Correção | Arquivos | Validação |
|---|---|---|---|---|
| U1 | Na largura padrão (1480), com um arquivo de seção aberto, a barra do documento cortava os botões de autoria e de dividir o editor (634 px disponíveis, 686 ocupados). O rótulo "Documento" nunca sumia: a regra mirava um nó de texto. No tamanho mínimo, o chip de erro sumia antes de botões secundários. | Limiares novos por *container query*; o veredito da compilação (erro, ??) é o último a sair; rótulos encolhem antes de qualquer botão. | `web/styles.css` | `test:ui`: nenhum controle cortado nos quatro tamanhos |
| U2 | No tamanho mínimo, 6 dos 9 botões da barra do PDF ficavam fora da tela e "/ 1" quebrava em duas linhas. | A barra do PDF esconde por ordem de uso conforme estreita; página e zoom ficam. | `web/styles.css`, `web/src/main.js` | idem |
| U3 | "Largura da página" aparecia ligada, mas o PDF não se reajustava ao redimensionar a janela ou arrastar um divisor (página cortada). | `ResizeObserver` no visualizador refaz o ajuste e mantém a posição de leitura. | `web/src/pdfview.js` | `test:ui`: largura da página = largura do painel nos quatro tamanhos |
| U4 | Textos errados: "citaçãoões", "1 páginas", "1 avisos", "1 alterações", "1 palavras". Em inglês, o primeiro caía em português (o padrão de tradução esperava o texto certo), e a contagem de palavras acima de 999 também. | Plurais corrigidos; padrões de tradução aceitam singular e milhar. | `web/src/bottom.js`, `web/src/main.js`, `web/src/i18n.js` | `test:ui` e conferência na tela |
| U5 | Regressão de D6: todo erro de compilação deixava um aviso fixo sobre o painel Problemas, que já mostra o mesmo erro, e o aviso continuava lá depois de corrigir e recompilar. | O aviso de compilação some sozinho e é retirado quando a compilação seguinte começa. Os demais erros (salvar, Git) seguem fixos. | `web/src/dom.js`, `web/src/main.js` | conferido no app; `test:ui` cobre o erro fixo de D6 |
| U6 | ⌘K não achava arquivos, embora o campo do topo diga "Buscar arquivo ou comando ⌘K"; clicar nele abria outra coisa que o atalho. "body" casava com "Biblioteca de papers" (letras soltas) e Enter abria a biblioteca. | Uma busca só: comandos e arquivos na mesma lista, em grupos; `>` restringe a comandos. Correspondência por letras soltas só vale se forem próximas ou iniciais. O campo do topo mostra ⌘P, que é o que o clique faz. | `web/src/palette.js`, `web/src/fuzzy.js` (novo), `web/src/main.js` | `test/fuzzy.test.js` (4 testes), `test:ui` |
| U7 | Estrutura vazia no arquivo principal de um paper dividido em seções ("Nenhuma seção"), que é o caso do próprio modelo do app. | A Estrutura mostra o documento inteiro (raiz e `\input`), e cada item abre o arquivo certo. | `web/src/sidebar.js` | `test:ui` |
| U8 | Histórico do Git: o hash se sobrepunha à mensagem. O texto de ajuda do campo de commit era cortado. | Coluna do hash com largura própria; ajuda curta no campo e completa na dica. | `web/styles.css`, `web/src/sidebar.js` | medido no app (sem sobreposição) |
| U9 | Aba Revisão abria com um botão preenchido em cada linha (8 chamadas principais empilhadas). | Botão preenchido só onde há algo esperando (notas abertas, commits novos, pendências). | `web/src/revisao.js` | conferido no app: 1 preenchido, 16 comuns |
| U10 | Tela inicial: os recentes eram os do momento em que o app abriu (o projeto da sessão não aparecia); o aviso de TeX ausente ficava abaixo dos 14 modelos, fora da tela; nenhum acesso a Preferências nem a idioma. | Recentes lidos na hora; aviso de TeX no topo quando falta algo; *Preferências* e a troca *Português · English*, cada nome na sua língua. | `web/src/welcome.js`, `web/styles.css`, `web/src/dom.js` | `test:ui` |
| U11 | Primeira abertura sempre em português, qualquer que fosse o idioma do sistema. | Perfil novo (sem idioma, sem recentes) segue o idioma do sistema; perfis existentes não mudam. | `web/src/main.js`, `server/index.js` | conferido com perfil novo num sistema em pt-BR; o ramo em inglês não foi exercitado nesta máquina |
| U12 | Fechar um diálogo aberto pela paleta deixava o foco na página, onde nenhuma tecla faz nada. | O foco volta ao editor quando quem abriu o diálogo não existe mais. | `web/src/dom.js`, `web/src/main.js` | `test:ui` |
| U13 | Contraste medido abaixo de 4,5:1: "2 ??" e "zero ??" na barra de status (3,5), "não citada" (3,5), letras de estado do Git (3,5), "??" do aviso (3,4), contadores (4,2 no claro; 2,5 a 3,0 no escuro), filtro desligado de Problemas (4,0), "1 vício" (4,0). | Textos coloridos passam a usar os tons de texto; contadores com fundo e cor próprios por tema; filtro desligado sem esmaecer. | `web/styles.css`, `web/src/main.js`, `web/src/bottom.js` | medição refeita: sobram só o "ugo" da marca e o ✻ decorativo |
| U14 | Abas de PDF eram botões dentro de uma lista de abas, sem setas; fechar aba de PDF e o campo de página não tinham nome; F6 caía no botão "Novo arquivo" em vez da lista. | `role="tab"`, setas, Home/End e Delete nas abas de PDF; nomes acessíveis; F6 vai à lista ou ao campo de busca. | `web/src/main.js` | `test:ui`: nenhum controle visível sem nome |
| U15 | Em inglês: rótulos dos seletores nativos ("Abrir", "Comparar"…), "Atalhos (⌘?)", um modelo e um comando em português (parte de I9). | Traduzidos. | `electron/main.js`, `web/src/i18n.js` | varredura do texto visível em inglês em 8 telas: nada em português |
| U16 | Exemplo do campo de título ("Darker Evenings") não era neutro. | "Título do trabalho". | `web/src/welcome.js`, `web/src/i18n.js` | leitura |

**Revalidação dos itens da primeira passada**, agora por teste automático (`npm run test:ui`, 36 checagens no Electron real): B1 (fechar e ⌘Q com *Cancelar*: a janela fica, o servidor responde e salvar funciona), B2 (recente com aba suja pergunta; *Cancelar* mantém), B3 (conflito com *Ver diferenças* e *Ficar com a do disco*; foco fora do botão destrutivo; commit salva antes), I14 (renomear pasta: a aba acompanha e salva no caminho novo; antes só conferido por leitura), D1 (F6, nomes acessíveis, foco devolvido) e D6 (erro fica até fechar). Não coberto por teste: B1 com *Salvar tudo e fechar* e *Descartar* (validados à mão na primeira passada), Sincronizar e Pull contra remoto.

**Limitações desta passada.** VoiceOver não foi ligado (exige mudar ajustes do sistema): a leitura por leitor de tela foi inferida da árvore de acessibilidade do Chromium. O anel de foco não pôde ser fotografado porque a janela de teste roda sem o foco do sistema; a regra CSS foi conferida por leitura. Windows e Linux não foram vistos. Painéis que dependem de conta ou de dados externos (conversa com o Claude, parecer, Zotero, corretor) foram vistos só no estado vazio.

**O que ainda pede trabalho de design** (não corrigido aqui):

- ✅ **FEITO (12/11).** Barra do PDF e barra de atividades: quando um botão só de ícone recebe foco pelo teclado, um rótulo com o nome dele aparece ao lado (web/src/focustip.js). Com o mouse, continua a dica de sempre.
- ✅ **FEITO (12/11).** O botão "Ir ao trecho no código" da barra do PDF, que só mostrava um aviso, saiu (dois cliques no PDF já levam ao código).
- ✅ **FEITO (12/11).** A paleta vazia mostra os comandos usados por último e depois nove grupos: Compilar, Editar, Escrita, Projeto e arquivos, Referências, Coautores, Revisão e submissão, Claude, Janela e ajuda. Com texto digitado, a busca continua numa lista só, por relevância.
- ✅ **FEITO (12/11).** As Preferências ganharam cinco abas (Aparência, Escrita, Corretor, Compilação, Geral), com setas para trocar de aba e uma busca que procura em todas, nos rótulos e nos nomes das opções. A aba aberta fica guardada.
- ✅ **FEITO (12/11).** As três seções da aba Revisão (Coautores, Pareceristas, Antes de enviar) recolhem. O estado fica guardado por seção, e o cabeçalho mostra quantas linhas pedem atenção.
- ✅ **FEITO (12/11).** O bloco do `.gitignore` agora cobre `*.pdf` (documentos e figuras, por decisão do autor), `*.bbl` e a pasta de saída do `latexmkrc`. O que já estava no Git continua lá. Teste em test/gitignore.test.js.
- ✅ **FEITO (12/11).** Os modelos de artigo e de projeto agora citam Card e Krueger (1994) e Imbens e Lemieux (2008), com frases neutras, no lugar das referências sobre horário de verão.
- ✅ **FEITO (12/11).** Nenhum texto de lista ou rótulo fica abaixo de 12 px. Os 37 usos de 11 e 11,5 px do CSS e 6 do JavaScript passaram para 12 px, e a etiqueta de documento na árvore foi para 11 px. Ficam menores só os selos numéricos da barra de atividades e o ponto de aba suja.
- ✅ **FEITO (12/11).** "Mostrar no Finder", "Abrir no Preview", "Lixo do macOS" e "Instale o MacTeX" viram "Mostrar na pasta", "Abrir no leitor de PDF", "lixeira do sistema" e "TeX Live" fora do Mac (`IS_MAC`, `OPEN_PDF`, `TRASH_NOTE` em web/src/dom.js). Não visto em Windows nem Linux.

## Como ler

Cada achado traz uma classificação, a gravidade, a evidência, o impacto para quem usa, a correção recomendada, o esforço e um critério de aceite.

| Classificação | Significado |
|---|---|
| **Confirmado (execução)** | Reproduzi o comportamento rodando o código do repositório numa pasta temporária. |
| **Confirmado (leitura)** | O código faz isso sem ambiguidade, mas não exercitei o fluxo inteiro na interface. |
| **Risco potencial** | Há um caminho plausível para o problema, não demonstrado. Inclui tudo de Windows e Linux, que não testei. |
| **Sugestão** | Melhoria sem defeito associado. |

Gravidade: crítica (perda de trabalho ou execução indevida de código), alta, média, baixa.
Esforço: **P** (até meio dia), **M** (1 a 2 dias), **G** (3 dias ou mais). É a estimativa para uma sessão de implementação com revisão sua.

## O que foi feito e o que não foi

Li por inteiro `electron/`, `server/index.js`, `util.js`, `platform.js`, `terminal.js`, `project.js`, `build.js`, `live.js`, `git.js`, `agent.js`, `ai.js`, `ide.js`, `grammar.js`, `doctor.js`, `comments.js`, `coauthors.js`, `compare.js`, `submission.js`, `web/src/main.js`, `api.js`, `markdown.js`, `live.js`, `changes.js`, os scripts de empacotamento e o hook. Li por trechos os demais módulos do servidor e da interface, guiado por buscas (escritas em disco, comandos executados, chamadas de rede, HTML bruto).

Rodei, sempre em pasta temporária e com perfil próprio:

- `npm test`: 94 testes na auditoria original (98 depois da segunda passada de UX), todos passam, cerca de 55 s. Com `--experimental-test-coverage` para medir cobertura.
- O servidor local contra um projeto de teste: token, guarda de caminhos, escrita em link simbólico, `close()`.
- O app Electron de verdade (`electron/main.js` importado por um roteiro) com uma aba suja: fechar a janela, sair com ⌘Q, trocar de projeto.
- `git.js` contra um remoto local com dois clones.
- `BuildManager` em projetos com `latexmkrc`.
- Medições de `lineChanges`, das varreduras de projeto e de `news()` num projeto sintético de 6 mil arquivos.
- Uma varredura das strings em português sem tradução.
- `npm audit` e as versões publicadas das dependências.

Não testei: Windows e Linux; push e pull contra o GitHub real; Overleaf; uma conversa real com o Claude Code (não gastei a sua conta); instalação de pacotes pelo Médico do TeX; leitor de tela; a aparência da interface (não tirei capturas). O desempenho foi medido por função, não com o app aberto num paper grande.

## Resumo

O TeXugo está funcionalmente rico e o núcleo é cuidadoso: token por sessão, janela em sandbox, escrita atômica com checagem de conflito, ações de IA só de leitura, guardas contra compilação travada. Os testes existentes passam e cobrem bem a lógica pura.

O que impede o lançamento hoje são sete pontos. Quatro deles fazem o usuário perder trabalho ou acreditar num resultado falso, e têm correção pequena:

1. ✅ **CORRIGIDO.** Com alteração não salva, a janela se recusa a fechar sem dizer por quê; depois de ⌘Q, **não dá mais para salvar** (B1).
2. ✅ **CORRIGIDO.** Abrir outro projeto **descarta** as alterações não salvas sem perguntar (B2).
3. ✅ **CORRIGIDO.** Commit, Sincronizar e Pull ignoram o que não foi salvo, e o salvamento seguinte pode desfazer o que veio do coautor (B3).
4. Projeto com `latexmkrc` gera DVI no lugar de PDF, ou diz "ok, zero ??" sem ter lido o log (B4).

Os outros três são de distribuição: assinatura e notarização no Mac (B5), Electron sete versões atrás com avisos de segurança altos (B6) e ausência de licença e de avisos de terceiros (B7).

A maior lacuna de QA é estrutural: `server/index.js` (toda a API), `git.js`, `terminal.js`, o Electron e cerca de 40 dos 50 módulos da interface não têm nenhum teste. Os quatro defeitos acima moram exatamente aí.

Contagem: 7 bloqueadores, 17 importantes, 10 desejáveis. Corrigidos até 12/11/2026: 3 bloqueadores (B1, B2, B3), 11 importantes (I1, I3, I4, I5, I7, I11, I12, I13, I14, I15, I16), 9 desejáveis (D1, D2, D3, D4, D5, D6, D7, D9, D10).

---

# Parte 1. Bloqueadores de lançamento

## ✅ B1. Fechar ou sair com alterações não salvas: a janela trava e o salvamento morre — **CORRIGIDO**

- ✅ **Estado: corrigido em 11/11/2026.** `electron/main.js` trata `will-prevent-unload` com o diálogo de três botões (*Salvar tudo e fechar*, *Descartar*, *Cancelar*), traduzido por `L()`; `server.close()` saiu de `before-quit` e foi para `will-quit`; a página salva tudo e pede o fechamento pela ponte nova `closeSaved`. Verificado no app Electron real com aba suja, com o roteiro do Apêndice A e o diálogo respondido por código: fechar + Cancelar mantém a janela; ⌘Q + Cancelar mantém a janela e `/api/hello` responde 200; ⌘Q + Salvar grava o arquivo e o processo termina. **Falta:** transformar esse roteiro em teste automático (item 2, fumaça).

- **Classificação:** confirmado (execução). **Gravidade:** crítica. **Esforço:** P.
- **Evidência:**
  - [web/src/main.js:1620](web/src/main.js:1620): o `beforeunload` cancela o fechamento quando há aba suja.
  - `electron/main.js` não trata `will-prevent-unload`. No Electron, cancelar o `beforeunload` não abre diálogo nenhum: a janela só não fecha.
  - [electron/main.js:210](electron/main.js:210): `app.on('before-quit', () => server && server.close())`. O `before-quit` dispara antes de as janelas decidirem se fecham.
  - [server/index.js:901](server/index.js:901): `close()` mata terminais, agentes, LanguageTool, observadores de arquivo e o servidor HTTP.
  - Resultado do roteiro no app real, com uma aba suja:
    ```
    after win.close(): destroyed = false | will-prevent-unload fired = 1 | modal/dialog in page = false
    after app.quit():  window still open = true | before-quit fired = 1 | will-quit fired = 0
    save attempt from the page after the cancelled quit => FAILED: Failed to fetch
    file on disk still has original text = true
    ```
- **Impacto:** quem aperta ⌘Q com trabalho não salvo fica com a janela aberta, sem aviso, e com um app que não salva mais, não compila e não tem terminal. A única saída é copiar o texto à mão ou forçar o encerramento e perder tudo. O botão vermelho sozinho só confunde (a janela não fecha e nada explica), mas o ⌘Q destrói o caminho de salvar. O futuro "Atualizar agora" (item 6) vai chamar `app.quit()` e cair no mesmo defeito.
- **Correção recomendada:**
  1. Em `createWindow`, tratar `win.webContents.on('will-prevent-unload', …)` com `dialog.showMessageBoxSync(win, …)` de três botões: *Salvar tudo e fechar*, *Descartar*, *Cancelar*. *Descartar* chama `event.preventDefault()` (no Electron isso libera o fechamento). *Salvar* manda um comando à página (`menu: 'saveAllThenClose'`), que roda `saveAll()` e, se deu certo, limpa `dirty` e chama `window.close()`. *Cancelar* não faz nada.
  2. Mover `server.close()` de `before-quit` para `will-quit`, que só dispara quando todas as janelas já fecharam.
  3. Os rótulos do diálogo precisam passar por `L()` (inglês e português).
- **Critério de aceite:** teste de ponta a ponta no Electron (ver Apêndice A) em que, com aba suja, `app.quit()` seguido de *Cancelar* deixa `fetch('/api/hello')` respondendo 200; com *Salvar*, o arquivo no disco contém o texto novo e o processo termina.

## ✅ B2. Abrir outro projeto descarta alterações não salvas — **CORRIGIDO**

- ✅ **Estado: corrigido em 11/11/2026.** `confirmLeave()` em `web/src/main.js` pergunta (*Salvar*, *Descartar*, *Cancelar*, com a lista dos arquivos) no começo de `openProject` e, antes de o servidor criar a pasta, em criar projeto e clonar (`web/src/welcome.js`). Verificado no navegador: com aba suja, clicar num recente mostra o diálogo e *Cancelar* mantém o projeto e a aba suja.

- **Classificação:** confirmado (execução). **Gravidade:** crítica. **Esforço:** P.
- **Evidência:** [web/src/main.js:1359](web/src/main.js:1359): `openProject` zera `S.tabs` sem olhar `dirty`. Nenhum dos chamadores verifica: [welcome.js:57](web/src/welcome.js:57) (recentes), [welcome.js:135](web/src/welcome.js:135) (modelo novo), [welcome.js:212](web/src/welcome.js:212) (clonar), [main.js:1654](web/src/main.js:1654) (Abrir pasta). No app real:
  ```
  project A open, dirty tab: true | editor has UNSAVED-WORK: true
  clicked recent project B: true | confirmation dialog shown: false | title now: qproj2 — TeXugo | dirty tabs: 0
  editor still has UNSAVED-WORK: false | on disk has it: false
  ```
- **Impacto:** um clique num projeto recente apaga o que não foi salvo, sem pergunta e sem volta.
- **Correção recomendada:** no início de `openProject`, se houver aba suja, mostrar o mesmo diálogo de três opções de `closeTab` (*Salvar tudo*, *Descartar*, *Cancelar*) e só seguir depois da resposta. Como criar projeto e clonar chamam `openProject` no fim, a pergunta deve vir antes de o servidor criar a pasta: extrair um `confirmLeaveProject()` e chamá-lo no começo dos três fluxos.
- **Critério de aceite:** o roteiro acima passa a mostrar o diálogo; *Cancelar* mantém o projeto A com a aba suja; *Salvar tudo* grava e troca.

## ✅ B3. Commit, Sincronizar e Pull ignoram o que não foi salvo, e o "Sobrescrever" desfaz o trabalho do coautor — **CORRIGIDO**

- ✅ **Estado: corrigido em 11/11/2026, as duas partes.** (1) Commit, Sincronizar, Pull, Push e *Baixar* das Novidades chamam `saveAll()` antes do Git e não seguem se o salvamento falhar ou for cancelado. (2) O conflito de salvamento virou um diálogo com *Ver diferenças* (disco contra a aba, por palavras), *Ficar com a do disco*, *Sobrescrever com a minha* e *Cancelar*; o foco inicial nunca cai no botão destrutivo; aba limpa só recarrega. Verificado no navegador com um arquivo alterado por fora. **Falta:** a quarta saída opcional, *Juntar* (`git merge-file`), e o teste de `git.js` com remoto local.

- **Classificação:** confirmado (leitura; a sequência decorre do código, não a exercitei na interface). **Gravidade:** alta. **Esforço:** P para a parte 1, M para a parte 2.
- **Evidência:**
  - [web/src/sidebar.js:378](web/src/sidebar.js:378) (Commit), [sidebar.js:428](web/src/sidebar.js:428) (Sincronizar), [sidebar.js:440](web/src/sidebar.js:440) (Pull) e [news.js:184](web/src/news.js:184) (Baixar) chamam o Git sem `saveAll()`. Compilar salva antes ([main.js:754](web/src/main.js:754)); o Git, não.
  - [server/git.js:102](server/git.js:102): `sync` faz commit do que está no disco, `pull --rebase` e push.
  - [web/src/main.js:712](web/src/main.js:712): quando o arquivo mudou no disco, o salvamento só oferece *Sobrescrever* ou cancelar.
- **Sequência que perde trabalho:** `paper.tex` aberto com edições não salvas → Sincronizar → o commit sai sem essas edições → o pull traz mudanças do coautor em `paper.tex` → o aviso "mudou no disco" aparece → ⌘S → *Sobrescrever* → o arquivo volta ao conteúdo de antes do pull mais as edições do usuário. O próximo Sincronizar publica a reversão. O texto do coautor continua no histórico, mas some do documento sem que ninguém perceba.
- **Impacto:** a colaboração por Git é o recurso mais anunciado do app. Hoje ela tem um caminho curto para reverter o coautor, e o usuário acha que "sincronizou" algo que ficou só na tela.
- **Correção recomendada:**
  1. (P) `await app.saveAll()` antes de `gitCommit`, `gitSync` e `gitPull` nos quatro lugares; se o salvamento falhar ou for cancelado, não chamar o Git.
  2. (M) Trocar o diálogo de conflito por três saídas: *Ver diferenças* (o diff entre o disco e a aba, que `web/src/diff.js` já sabe desenhar), *Ficar com a do disco* (recarrega e descarta as minhas) e *Sobrescrever*. Uma quarta, *Juntar*, pode usar `git merge-file` com três versões (a que a aba carregou, a do disco, a da aba); guarde a versão carregada em `t.loadedText` para isso.
- **Critério de aceite:** teste de `git.js` com remoto local (ver Apêndice A) em que a edição não salva entra no commit do Sincronizar; teste de interface em que o conflito oferece recarregar.

## ✅ B4. Projeto com `latexmkrc`: DVI no lugar de PDF e "ok, zero ??" sem ler o log — **CORRIGIDO**

- **Estado (12/11/2026):** completo. `server/outdirs.js` lê o rc. Atribuições literais são lidas direto; expressões em Perl são perguntadas ao próprio latexmk (`latexmk -e`), com cache pela data do rc. Sem `$pdf_mode`, o TeXugo passa a flag do motor. Log, PDF, `.aux`, `.fls`, `.bbl` e SyncTeX são procurados em `$out_dir`/`$aux_dir` no build, nos `.aux` de documentos externos (que também entram no `TEXINPUTS`, para o `\externaldocument` achar), na prévia ao vivo, no ZIP de submissão (`.bbl` e `.aux` vão para o lado do `.tex`), no R&R e nas versões enviadas. O SyncTeX inverso resolve o arquivo a partir da pasta do `.tex`. Saída 0 sem log vira erro. Testes: três em test/build.test.js (sem `$pdf_mode`; `$out_dir` literal; Perl com `$aux_dir`, documento externo, ZIP e SyncTeX) e um em test/live.test.js.

- **Classificação:** confirmado (execução). **Gravidade:** alta. **Esforço:** P a M.
- **Evidência:**
  - [server/build.js:258](server/build.js:258): quando existe `latexmkrc` ou `.latexmkrc` e o motor é o padrão, o TeXugo não passa `-pdf`. Um rc que não define `$pdf_mode` faz o latexmk gerar DVI.
  - [server/build.js:183](server/build.js:183): log, PDF e `.aux` são procurados ao lado do `.tex`. Não há nenhum tratamento de `$out_dir` ou `$aux_dir` (busca por `out_dir|aux_dir` em `server/` não retorna nada).
  - Caso 1, `.latexmkrc` só com `$bibtex_use = 2;`: saiu `paper.dvi`, nenhum PDF, `pdf: null`.
  - Caso 2, `latexmkrc` com `$out_dir = "build";` e um `\ref{missing}` no texto: `{"ok":true,"status":"ok","pdf":null,"undefinedRefs":0}`. O log estava em `build/` e não foi lido.
- **Impacto:** quem chega com um `latexmkrc` (comum entre usuários experientes e em projetos vindos do Overleaf) não consegue um PDF e não recebe explicação. No caso 2 o app afirma "zero ??", que é a promessa central do produto, sem ter verificado.
- **Correção recomendada:**
  1. Ler o rc. Se ele não tiver `$pdf_mode`, passar a flag do motor como hoje se faz sem rc.
  2. Descobrir a pasta de saída. O caminho mais robusto é perguntar ao próprio latexmk, por exemplo `latexmk -e 'print "TEXUGO_OUT=$out_dir\nTEXUGO_AUX=$aux_dir\n"; exit;'` (confirme na documentação da versão instalada que `-e` roda depois dos rc). O plano B é uma expressão regular para o caso literal simples. Guardar o resultado em `info.outDir` e usar em `stem(doc)` para log, PDF, `.aux`, `.fls` e SyncTeX. `auxFingerprint`, `sourceFiles` (submissão), `live.js` e `sync` leem os mesmos caminhos.
  3. Nunca devolver `status: 'ok'` sem log: se o processo saiu com 0 e o log não foi achado, o estado é "não sei", com uma mensagem que diga onde procurei.
- **Critério de aceite:** dois testes novos em `test/build.test.js` com os casos acima: PDF encontrado e `undefinedRefs.length === 1`.

## B5. Distribuição no Mac: assinatura ad hoc, sem notarização, só Apple Silicon

- **Classificação:** confirmado (leitura e inspeção do pacote). **Gravidade:** alta. **Esforço:** M, mais uma decisão sua.
- **Evidência:** [scripts/package-mac.mjs:57](scripts/package-mac.mjs:57) assina com `codesign --sign -`. O script copia o `Electron.app` de `node_modules`, que tem a arquitetura da máquina que empacota: `out/TeXugo.app/Contents/MacOS/TeXugo` é `Mach-O 64-bit executable arm64`. Não há Developer ID, runtime endurecido, entitlements, notarização nem `.dmg`.
- **Impacto:** um `.dmg` baixado do site é barrado pelo Gatekeeper. No macOS 15 em diante não há mais o atalho de clicar com Control e abrir: a pessoa precisa ir a Ajustes → Privacidade e Segurança, o que para o público do app equivale a "não abre". Macs Intel não rodam o binário. E o "Atualizar agora" do item 6 depende de assinatura válida (o atualizador do Electron no Mac recusa pacote não assinado).
- **Decisão sua:** entrar no Apple Developer Program (US$ 99 por ano). Sem ele, o lançamento no Mac exige instruções de contorno na página de download e o botão de atualização vira "Baixar a versão nova".
- **Correção recomendada:** trocar o script manual por `electron-builder`, que resolve de uma vez os itens 2, 6 e 9 do roteiro: `.dmg` universal (ou dois, arm64 e x64), runtime endurecido, notarização, `.exe` (NSIS), `.AppImage`, recompilação do `node-pty` e os arquivos `latest*.yml` que o `electron-updater` lê. É uma troca do empacotador (73 linhas), não do app. O hook `post-commit` pode continuar chamando `npm run package` com um alvo `--dir` para a instalação local. Ver o item 9 na Parte 4.
- **Critério de aceite:** `spctl -a -vv TeXugo.app` responde "accepted, source=Notarized Developer ID"; o `.dmg` abre num Mac limpo, Intel e Apple Silicon, sem passar pelos Ajustes.

## ✅ B6. Electron 38 está sete versões atrás e tem avisos de segurança altos — **CORRIGIDO**

- ✅ **Estado (13/11/2026):** Electron 45.3.1 (Node 24.22, `node:sqlite` presente) e katex 0.19.1. `npm audit --omit=dev`: 0 vulnerabilidades. 134 testes e 42 checagens do roteiro de fumaça verdes, no Mac. Não conferido: `titleBarOverlay` no Windows e `fs.watch` recursivo no Linux (ficam com a CI do item 2). O zip do Electron 38 saiu do cache.

- **Classificação:** confirmado (`npm view`, `npm audit`). **Gravidade:** alta. **Esforço:** P a M.
- **Evidência:** instalado 38.8.6; a última publicada é 45.3.0. `npm audit` lista `electron` como *high* para `<=42.11.15` (três avisos, dois de uso de memória liberada). O Electron mantém as três versões maiores mais recentes, então a 38 não recebe correção.
- **Impacto:** o app desenha PDFs e Markdown que chegam de coautores com um Chromium de mais de um ano. Os avisos listados tocam recursos que o TeXugo não usa (janela fora da tela, textura compartilhada, imagem da área de transferência), então a exploração direta é improvável. O risco real é lançar um app público sobre uma base sem correções e com `npm audit` vermelho logo de saída.
- **Correção recomendada:** subir para a versão maior estável corrente antes de empacotar, rodar os testes e o roteiro de fumaça. Pontos a conferir na subida: `node:sqlite` (usado em `server/zotero.js`), `titleBarOverlay` no Windows, `fs.watch` recursivo no Linux, e o `node-pty` (N-API, deve seguir funcionando). Atualizar junto `katex` (0.16.11 tem dois avisos moderados; a 0.19.1 está publicada). `esbuild` e `extract-zip` aparecem no audit, mas são só de desenvolvimento.
- **Critério de aceite:** `npm audit --omit=dev` sem *high*; 94 testes verdes; roteiro de fumaça verde.

## ✅ B7. Licenças: o repositório não tem LICENSE e o pacote não leva os avisos de terceiros — **CORRIGIDO**

- **Estado (12/11/2026):** `LICENSE` MIT na raiz. `scripts/notices.mjs` gera `THIRD-PARTY-NOTICES.txt` (33 pacotes: dependências, Electron, pdf.js e o que o esbuild embute) e roda a cada `npm run package`. O pacote leva LICENSE, os avisos e `LICENSES.chromium.html`. Ajuda → Licenças abre o arquivo. `test/notices.test.js` falha se faltar algum pacote. Não conferido no app instalado.

- **Classificação:** confirmado (inspeção). **Gravidade:** alta (jurídica). **Esforço:** P.
- **Evidência:** o `package.json` declara MIT, mas não existe `LICENSE` na raiz. `node_modules/electron/dist/LICENSE` e `LICENSES.chromium.html` ficam ao lado do `Electron.app` e não entram em `out/TeXugo.app`. O `dist/app.js` embute CodeMirror, Lezer, marked, xterm e KaTeX (MIT) e o pdf.js (Apache 2.0) sem o texto das licenças. Os CMaps da Adobe e as fontes padrão do pdf.js vão com os seus arquivos de licença (o `cpSync` recursivo os leva), e os modelos não trazem `.bst` nem `.cls` de terceiros, o que é bom.
- **Impacto:** MIT, BSD e Apache exigem que o aviso de copyright acompanhe a redistribuição. Publicar o instalador sem eles descumpre as licenças das dependências.
- **Correção recomendada:** criar `LICENSE` (MIT, com o seu nome e o ano). Gerar `THIRD-PARTY-NOTICES.txt` por script a partir do `package-lock.json`, só com o que vai no pacote: `electron` (mais o `LICENSES.chromium.html` copiado para `Resources/`), `ws`, `node-pty`, os pacotes `@codemirror/*` e `@lezer/*`, `marked`, `@xterm/*`, `katex` e suas fontes, `pdfjs-dist` com CMaps e fontes. Mostrar o arquivo em Ajuda → Licenças. O LanguageTool e o TeX não são distribuídos pelo app, então não entram.
- **Critério de aceite:** teste que falha se um pacote de `dependencies`, ou embutido pelo esbuild, não estiver no arquivo de avisos.

---

# Parte 2. Importantes

Corrigir antes do lançamento se couber; nenhum, sozinho, impede lançar.

## ✅ I1. Salvar um arquivo que é link simbólico quebra o link; a permissão do arquivo se perde — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** `writeKeepingLink` em `server/util.js` resolve o link, grava o temporário ao lado do arquivo real e copia o modo; `write` usa ela. Teste em `test/writelink.test.js` (link mantido, arquivo compartilhado recebe o texto, 755 preservado). As gravações de `.bib` do servidor (I3) ainda não usam a função.

- **Classificação:** confirmado (execução). **Gravidade:** média a alta. **Esforço:** P.
- **Evidência:** [server/index.js:226](server/index.js:226) grava em `p + '.texugo-tmp'` e renomeia por cima de `p`. Teste: `refs.bib` como link para `shared/library.bib` → depois de um salvamento, `stillLink: false` e o arquivo compartilhado não recebeu a entrada nova. Um `run.sh` com modo 755 voltou com 644.
- **Impacto:** manter um `.bib` central ligado por link em cada projeto é prática comum. Depois do primeiro ⌘S o projeto passa a ter uma cópia solta e o usuário não é avisado.
- **Correção:** resolver `fs.realpathSync(p)` quando o arquivo existe e gravar o temporário ao lado do destino real; copiar o modo com `fs.chmodSync(tmp, st.mode)` antes de renomear.
- **Aceite:** o teste acima passa a dar `stillLink: true`, `sharedHasB: true` e modo 755.

## ✅ I2. Não há recuperação do que não foi salvo quando o app cai — **CORRIGIDO**

- **Estado (12/11/2026):** a cada 20 s, e quando a janela perde o foco, as abas sujas são copiadas para `<dados do app>/recovery/<hash do projeto>/` (server/recovery.js, web/src/recovery.js), nunca para dentro do projeto. Ao abrir um projeto com cópias diferentes do disco, aparece *Recuperar alterações não salvas*, com o diff de cada arquivo, e os botões *Recuperar*, *Depois* e *Descartar as cópias*. Recuperar põe o texto na aba como alteração não salva. As cópias somem ao salvar ou ao descartar no diálogo de saída, e uma cópia igual ao disco é apagada sozinha. Testado no navegador: depois de digitar, derrubar o servidor e reabrir, a oferta veio com o texto certo; recuperar e salvar apagou a cópia. Teste em test/recovery.test.js. Não testado: matar o app Electron de verdade.

- **Classificação:** risco potencial (não observei queda). **Gravidade:** média a alta. **Esforço:** M.
- **Evidência:** o texto não salvo vive só na memória da janela. Não há salvamento automático nem cópia de recuperação. A prévia ao vivo ([web/src/live.js](web/src/live.js)) atualiza o PDF sem salvar, o que convida a ficar muito tempo sem ⌘S.
- **Impacto:** falta de luz, travamento da janela ou encerramento forçado levam o trabalho da sessão.
- **Correção:** a cada 20 a 30 segundos, e ao perder o foco, gravar as abas sujas em `<dados do app>/recovery/<hash do projeto>/` (nunca dentro do projeto, para não sujar o Git). Ao abrir um projeto com cópias mais novas que o disco, oferecer *Recuperar* com o diff. Apagar a cópia ao salvar ou descartar. Não é salvamento automático no arquivo do usuário, e isso é de propósito: quem usa Git e compila ao salvar não quer gravações que não pediu.
- **Aceite:** matar o processo com aba suja e reabrir mostra a oferta de recuperação com o texto certo.

## ✅ I3. O servidor escreve em `.bib` por baixo do editor — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** `addToBib`, `applyFixes` e `importBib` gravam por `writeKeepingLink` (temporário, renomear, link e modo mantidos). *Adicionar referência* agora recusa com o `.bib` aberto e sujo, como Verificar e Zotero já faziam. Não aplica a mudança no próprio editor; pede para salvar antes. `npm test` verde; não exercitei na interface.

- **Classificação:** confirmado (leitura). **Gravidade:** média. **Esforço:** P.
- **Evidência:** [server/refs.js:188](server/refs.js:188) (`addToBib`), [server/refcheck.js:209](server/refcheck.js:209) (`applyFixes`) e [server/zotero.js:188](server/zotero.js:188) (`importBib`) gravam direto no disco, sem temporário. Verificar e Zotero exigem o `.bib` salvo ([references.js:60](web/src/references.js:60), [zotero.js:53](web/src/zotero.js:53)); *Adicionar referência* ([web/src/refs.js:38](web/src/refs.js:38)) não confere.
- **Impacto:** com o `.bib` aberto e sujo, a referência adicionada pela busca vai para o disco, o editor avisa o conflito e o *Sobrescrever* a apaga.
- **Correção:** uma única função `writeProjectFile(p, text)` no servidor (temporário, renomear, `selfWrites`, a mesma do item I1) usada pelos três; e, na interface, salvar a aba do `.bib` antes ou aplicar a mudança no próprio editor quando ele está aberto.
- **Aceite:** adicionar referência com o `.bib` sujo mantém as edições e a referência.

## ✅ I4. O Sincronizar chama de "conflito" o que não é — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** `pull --rebase --autostash`; só se fala em conflito quando há `rebase-merge` ou `rebase-apply` na pasta do Git; outras falhas saem como "O pull falhou (não foi conflito): …" com a causa do Git. Os dois casos do Apêndice A reproduzidos num repositório temporário: o primeiro sincroniza, o segundo mostra o erro de acesso. Mensagens traduzidas.

- **Classificação:** confirmado (execução). **Gravidade:** média. **Esforço:** P.
- **Evidência:** [server/git.js:113](server/git.js:113): qualquer falha do `pull --rebase` vira "O pull achou mudanças que conflitam com as suas". Reproduzi dois casos sem conflito nenhum:
  - Um arquivo no commit e outro modificado fora dele: `error: cannot pull with rebase: You have unstaged changes`.
  - Remoto inacessível: `Please make sure you have the correct access rights and the repository exists`.
- **Impacto:** o usuário é mandado para o terminal resolver um conflito que não existe; no primeiro caso o app fica nesse estado até alguém fazer commit do resto.
- **Correção:** usar `pull --rebase --autostash`; só falar em conflito quando houver rebase em andamento (pasta `rebase-merge` ou `rebase-apply`, ou `git status` com caminhos `UU`); para rede e permissão, mostrar a causa real.
- **Aceite:** os dois casos do Apêndice A deixam de devolver a mensagem de conflito.

## ✅ I5. ZIP de submissão ignora arquivos quando alguma pasta do caminho começa com "tex" — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** `isSystemTex` em `server/submission.js` decide pelas raízes do `kpsewhich -var-value` (TEXMFROOT, TEXMFDIST, TEXMFLOCAL, TEXMFSYS*, TEXMFVAR, TEXMFCONFIG, TEXMFHOME, com e sem resolver links), com cache; sem kpsewhich, só nomes de pasta inteiros. `test/submission.test.js` agora roda dentro de uma pasta `tex/` e passa.

- **Classificação:** confirmado (execução da expressão). **Gravidade:** média a alta para quem é afetado. **Esforço:** P.
- **Evidência:** [server/submission.js:13](server/submission.js:13): `SYSTEM_TEX = /\/(texmf|texlive|TeX)[^/]*\//i`. Por não diferenciar maiúsculas, casa com `/tex/`, `/textos/`, `/texts/` e `/TeXugo/`. Todos os quatro caminhos de teste deram `true`, entre eles `/Users/a/Dropbox/tex/paper/mystyle.sty`. O filtro age em [submission.js:34](server/submission.js:34) (o arquivo sai do ZIP) e em [submission.js:165](server/submission.js:165) (o vazamento de caminho absoluto deixa de ser apontado).
- **Impacto:** num projeto dentro de `~/Documents/tex/`, o ZIP perde tudo o que só o `.fls` conhece (`.sty` e `.cls` locais, figuras por `\graphicspath`, `\input` montado por macro). A checagem final avisa que falta arquivo, então a falha não é silenciosa, mas o usuário não tem como consertar sem renomear a pasta. O teste atual passa porque roda em diretório temporário.
- **Correção:** decidir o que é do sistema pela raiz do TeX, não pelo nome: `kpsewhich -var-value TEXMFROOT` (e `TEXMFDIST`, `TEXMFLOCAL`, `TEXMFHOME`), com cache; um arquivo é do sistema se estiver dentro de uma dessas raízes.
- **Aceite:** o teste de `test/submission.test.js` repetido dentro de uma pasta chamada `tex/`.

## ✅ I6. O limite de 3.000 arquivos `.tex` esconde documentos — **CORRIGIDO**

- **Estado (12/11/2026):** `listTexFiles` agora percorre em largura e marca `truncated`; quando corta, os rótulos e macros dos arquivos incluídos pelos documentos são lidos primeiro. O projeto de teste (3.100 tabelas) acha `writing/paper.tex` e `sec:intro`. Quando o limite corta, a interface avisa uma vez por projeto.

- **Classificação:** confirmado (execução). **Gravidade:** média. **Esforço:** P a M.
- **Evidência:** [server/project.js:57](server/project.js:57): `listTexFiles` percorre em profundidade, em ordem alfabética, e para em 3.000. Projeto de teste com 3.100 tabelas em `analysis/output/` e o paper em `writing/`: `documents found: []`, `rootsFor(sections/intro.tex): []`, `labels found: 0`.
- **Impacto:** em projeto empírico com muitas tabelas geradas, a aba de uma seção aparece como "fora de qualquer documento", sem botão de compilar, e o autocompletar de `\ref` e `\cite` fica vazio. O arquivo principal ainda compila porque é a própria raiz.
- **Correção:** percorrer em largura, para as pastas rasas entrarem antes; ao procurar documentos, ler só o começo de cada arquivo (já é assim) e não contar no limite as pastas que só têm fragmentos; avisar na interface quando o limite cortou a varredura (`listTree` já devolve `truncated`, `listTexFiles` não).
- **Aceite:** o projeto de teste acima encontra `writing/paper.tex` e o rótulo `sec:intro`.

## ✅ I7. Markdown desenhado com HTML bruto; o CSP é a única barreira — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** `web/src/sanitize.js` limpa a saída do `marked` por lista de etiquetas e atributos (sem `script`, `style`, `form`, `base`, `iframe`, `on*`, `javascript:`; `class` só `language-*`; sem `id`). O CSP vai também por cabeçalho, com `base-uri`, `form-action`, `object-src`, `frame-src` e `frame-ancestors` em `'none'`; `X-Content-Type-Options: nosniff` em toda resposta; `/file` com `Content-Security-Policy: sandbox`; o WebSocket recusa outra origem. Testes: `test/security.test.js` (cabeçalhos, origem) e o teste de interface abre um `.md` com `<script>`, `<img onerror>`, `<base>`, `<style>`, `<form>` e `javascript:` e só o texto aparece. `'unsafe-inline'` em `style-src` ficou (a interface usa estilos em linha).

- **Classificação:** risco potencial. **Gravidade:** média. **Esforço:** P.
- **Evidência:** [web/src/markdown.js:29](web/src/markdown.js:29): `el.innerHTML = front + marked.parse(text)` sem sanitizar (o painel do agente, em [web/src/agent.js:39](web/src/agent.js:39), descarta HTML; a prévia de Markdown não). O que impede um `<script>` ou um `onerror` de um `.md` clonado de rodar é o CSP em `<meta>` de [web/index.html:6](web/index.html:6) (`script-src 'self'`). Sem ele, um script na página tem o token e, com o token, o terminal. Lacunas medidas: o servidor não manda CSP nem `X-Content-Type-Options` por cabeçalho (`cspHeader: null`, `nosniff: null`); `/file` devolve um `.html` do projeto como `text/html` na mesma origem, sem CSP; o CSP não tem `base-uri`, `form-action`, `object-src` nem `frame-src`; `<style>` passa (`'unsafe-inline'`) e permite redesenhar a interface a partir de um `.md`.
- **Impacto:** hoje não achei caminho que execute código. É uma defesa de camada única num ponto em que a falha vira execução de comandos.
- **Correção:** sanitizar a saída do `marked` (DOMPurify, ou o mesmo `renderer: { html: () => '' }` do painel do agente mais uma lista de etiquetas permitidas); mandar o CSP também por cabeçalho HTTP, com `base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`; em `/file`, responder com `Content-Security-Policy: sandbox` e `X-Content-Type-Options: nosniff`; conferir `Origin` no WebSocket (só a própria origem), o que também protege o modo `--dev`, cujo token é fixo (`dev`).
- **Aceite:** um `.md` de teste com `<script>`, `<img onerror>`, `<base>`, `<style>` e `<form>` rende só o texto; teste de API confirma os cabeçalhos.

## ✅ I8. Abrir e usar um projeto de terceiros executa código do projeto — **CORRIGIDO**

- **Estado (12/11/2026):**
  1. *Teste do hook*, com Claude Code 2.1.321: projeto com `.claude/settings.json` com hooks `SessionStart` e `UserPromptSubmit` que criam arquivos. `claude -p` sem a flag: **os dois hooks rodaram**, sem nenhuma pergunta. Com `--setting-sources user`: nenhum rodou, e as 63 skills do usuário continuaram carregadas (`applied-micro-paper-writing` entre elas).
  2. `server/trust.js`: as pastas confiáveis ficam em `state.json` (`trusted`). Na primeira execução desta versão, as pastas que já estavam nos recentes entram como suas, e os projetos criados por modelo do TeXugo também. A primeira abertura de uma pasta que traz `latexmkrc`, `.latexmkrc` ou `.claude/` com configurações mostra o aviso "Confia neste projeto?". *Cancelar* deixa a pasta fechada e pergunta de novo na próxima vez; *Confio, abrir* grava a resposta. Isso foi conferido na tela: o aviso aparece, *Cancelar* volta à tela inicial, e depois de *Confio* ele não aparece mais.
  3. Em pasta sem confiança, as ações de IA, o parecer, o R&R e o painel do Claude rodam com `--setting-sources user`, e o latexmk não é chamado para calcular `$out_dir` em Perl fora de uma compilação.
  4. O cartão de permissão mostra os campos inteiros, com rolagem, para toda ferramenta que não é de edição.
  - Testes em test/trust.test.js. Também com o projeto aberto: um `latexmkrc` ou `.claude/` que chegue por pull, Sincronizar ou terminal dispara o aviso na hora. *Cancelar* fecha o projeto, perguntando antes pelo que não foi salvo. Conferido na tela.

- **Classificação:** risco potencial (inerente às ferramentas; não testei exploração). **Gravidade:** média. **Esforço:** P a M.
- **Evidência:**
  - Compilar roda `latexmk`, que executa o Perl de um `latexmkrc` da pasta ([server/build.js:237](server/build.js:237)). É assim em qualquer editor que use latexmk. O TeXugo não passa `-shell-escape`, o que é correto.
  - As ações de IA rodam `claude -p` na pasta do projeto ([server/ai.js:88](server/ai.js:88), [server/agent.js:50](server/agent.js:50)). No modo `-p` o Claude Code carrega as configurações do projeto sem o diálogo de confiança. Um `.claude/settings.json` clonado pode trazer hooks e regras de permissão. Não testei; a versão instalada (2.1.321) tem a opção `--setting-sources`.
  - No painel, `Read`, `Grep`, `Glob` e `LS` rodam sem pedir ([agent.js:28](server/agent.js:28)) e não se limitam à pasta do projeto.
  - O cartão de permissão corta em 400 caracteres os campos das ferramentas que não são Bash nem edição ([agent.js:196](server/agent.js:196)); o usuário aprova um `WebFetch` ou uma ferramenta MCP vendo só o começo.
- **Impacto:** clonar um repositório desconhecido e clicar em Compilar ou em Revisar pode rodar comandos de quem fez o repositório. Para o uso típico (projetos próprios e de coautores) o risco é baixo, mas o app tem botão de clonar do GitHub.
- **Correção:**
  1. Testar o caso do hook: projeto com `.claude/settings.json` e um hook `SessionStart` que cria um arquivo; rodar uma ação de IA; ver se o arquivo aparece. Se aparecer, passar `--setting-sources user` nas execuções de uma tacada (`ai.js`) e confirmar que as skills do usuário continuam carregando.
  2. Na primeira abertura de uma pasta que traz `latexmkrc`, `.latexmkrc` ou `.claude/` e que o TeXugo não criou, um aviso único: "Este projeto traz configurações que executam comandos ao compilar ou ao usar IA. Abra só se confia em quem o fez." Guardar a resposta por pasta em `state.json`.
  3. No cartão de permissão, mostrar o valor inteiro (com rolagem) em vez de cortar.
- **Aceite:** o teste do hook documentado com o resultado; o aviso aparece uma vez por pasta.

## ✅ I9. Interface em inglês: sobram mensagens em português — **CORRIGIDO**

- **Estado (12/11/2026):** `test/i18n.test.js` virou a varredura do Apêndice A. Ele lê todo literal de `web/src` e `server` com cara de português, preenche os buracos dos templates com valores de teste (plurais inclusive) e falha no que `tr()` não traduz. Uma segunda parte confere frases reais montadas no código (`RUNTIME`), e uma terceira confere os rótulos dos menus e diálogos nativos contra `MENU_EN`. A primeira rodada achou 261 literais. Depois de tirar os falsos positivos (prompts em inglês, SQL, listas de palavras), sobraram cerca de 150 mensagens reais, e todas ganharam tradução: 82 frases fixas e cerca de 70 padrões. As exceções estão em `test/i18n-allow.txt`, cada grupo com o motivo. Uma comparação frase a frase com o dicionário anterior mostrou que nenhuma tradução que já existia mudou. Fora do dicionário: o servidor conhece o idioma (`server/lang.js`, vindo das preferências), e com ele saem no idioma da interface a mensagem automática de commit, a nota das ações de IA, o pedido de senha do Médico do TeX, o parecer exportado em Markdown e o `LANG` dos terminais (com `en_US.UTF-8` quando falta `pt_BR`). As datas e os números seguem o idioma (`locale()`), e a mensagem que a Revisão manda ao painel do Claude também. Passada manual em inglês, no navegador: pasta inexistente ("Folder not found."), compilação com `??` e `.bib` quebrado, todos os painéis da barra lateral e as cinco abas das Preferências, sem português na tela (exceto "Português" no seletor de idioma, de propósito). Não testado: a interface sem rede.

- **Classificação:** confirmado (varredura e amostra). **Gravidade:** média. **Esforço:** M.
- **Evidência:** o desenho da tradução ([web/src/i18n.js](web/src/i18n.js)) é um dicionário de frase em português para frase em inglês, mais padrões. O que não está no dicionário aparece em português. A varredura achou 1.059 literais com cara de português; depois de tirar os falsos positivos (os módulos que usam `L(pt, en)`, as palavras-chave da paleta, o menu nativo), sobram cerca de 90 mensagens do servidor e algumas dezenas de frases montadas na interface. Conferidas por busca direta, sem tradução: "Commit inválido.", "Escolha um arquivo .bib.", "Esta pasta não é um repositório Git.", "Já há uma ação de IA em andamento.", "compilação parada: …". Fora do dicionário por construção:
  - Rótulos dos diálogos nativos em [electron/main.js:137](electron/main.js:137) a 158 ("Abrir", "Comparar", "Ler anotações", "Adicionar", "Importar", "LaTeX, ZIP ou pasta").
  - A nota das ações de IA, pedida sempre em português ([server/ai.js:69](server/ai.js:69)).
  - A mensagem automática de commit, sempre "Atualiza …" ([server/git.js:82](server/git.js:82)), que vai para o histórico compartilhado.
  - O pedido de senha do Médico do TeX ([server/doctor.js:113](server/doctor.js:113)).
  - `LANG` padrão `pt_BR.UTF-8` nos terminais ([server/terminal.js:54](server/terminal.js:54)), que muda o idioma do Git e de outros programas e gera aviso de locale onde ele não existe.
  - Datas e números com formato fixo do Brasil: [server/coauthors.js:261](server/coauthors.js:261), [web/src/main.js:534](web/src/main.js:534), [main.js:1258](web/src/main.js:1258), [sidebar.js:455](web/src/sidebar.js:455).
  - "Mostrar no Finder" e "Abrir no Preview" no Windows e no Linux.
- **Correção:** o servidor precisa saber o idioma: mandar `lang` no `hello` e guardar em memória, ou devolver códigos de erro e montar a frase na página. Para o que é frase fixa, basta completar o dicionário. O essencial é o teste: transformar a varredura do Apêndice A em `test/i18n.test.js`, que falha quando aparece literal em português sem tradução, com uma lista explícita de exceções (regras de vícios, prompts, palavras-chave da paleta).
- **Aceite:** o teste novo verde; uma passada manual pela interface em inglês provocando erros (pasta inexistente, `.bib` errado, sem rede).

## ✅ I10. Digitação lenta em arquivos de 1.000 a 2.000 linhas — **CORRIGIDO**

- **Estado (12/11/2026):** a LCS quadrática de `lineChanges` virou um diff de Myers, O((N+M)·D), sobre ids de linha. Duas edições em 2.000 linhas ficam bem abaixo de 4 ms por tecla (teste em test/changes.test.js), e o atalho que marcava o intervalo todo como alterado só entra depois de 2.000 edições separadas. Num teste com 20 mil pares aleatórios, o número de linhas marcadas é sempre igual ao do código antigo; em casos ambíguos, uma linha pode passar de "alterada" para "nova" ou o contrário, e as duas leituras são válidas.

- **Classificação:** confirmado (medição por função). **Gravidade:** média. **Esforço:** P a M.
- **Evidência:** [web/src/changes.js:65](web/src/changes.js:65): `changesField` recalcula, a cada tecla, o diff de linhas entre o texto e a linha de base (o estado na abertura ou na última compilação). `lineChanges` é uma LCS quadrática sobre o trecho entre a primeira e a última linha alteradas. Com uma edição perto do começo e outra perto do fim:

  | Linhas do arquivo | Tempo por tecla |
  |---|---|
  | 1.000 | 21 ms |
  | 1.900 | 41 ms |
  | 2.000 | 46 ms |
  | 5.000 | 0,9 ms (cai no atalho) |
  | 20.000, uma edição | 3,5 ms |

  O quadro de 60 Hz dura 16 ms. Acima de 2.000 por 2.000 linhas vale o atalho de [changes.js:25](web/src/changes.js:25), que é rápido mas marca todas as linhas do intervalo como alteradas, o que está errado. A opção de desligar as marcas só as esconde por CSS ([main.js:1670](web/src/main.js:1670)); a conta continua.
- **Impacto:** num paper de arquivo único, depois de mexer na introdução e na conclusão sem compilar, cada tecla custa de um a três quadros.
- **Correção:** tirar a conta do caminho da tecla. Opção simples: um `ViewPlugin` que recalcula com 150 ms de espera. Opção melhor: manter as marcas de forma incremental (mapear as existentes pela mudança e marcar as linhas tocadas) e refazer o diff completo só quando a linha de base muda. Não incluir o campo quando a opção está desligada.
- **Aceite:** teste de tempo no estilo de "fast enough to run while typing" de `test/vicios.test.js`: menos de 4 ms por transação em 2.000 linhas.

## ✅ I11. O README promete "nada vai para a nuvem", e não é isso que o código faz — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** A frase dos dois READMEs agora diz que os arquivos e a compilação são locais e lista os serviços externos opcionais (Anthropic pelo Claude Code, Crossref, OpenAlex, arXiv, remoto do Git, Médico do TeX, LanguageTool online). Falta a página de privacidade (item 8) e tirar "para Mac" quando Windows e Linux saírem.

- **Classificação:** confirmado (leitura). **Gravidade:** média. **Esforço:** P.
- **Evidência:** [README.md:7](README.md:7). O app fala com serviços externos em vários recursos; a lista completa está no Apêndice B.
- **Impacto:** é uma afirmação pública de privacidade que não se sustenta. O trabalho de pessoas com papers inéditos e pareceres confidenciais passa pela Anthropic quando usam as ações de IA.
- **Correção:** trocar a frase por algo exato ("os arquivos ficam no seu disco e a compilação é local; alguns recursos opcionais consultam serviços externos, listados na página de privacidade") e publicar a página (item 8). Aproveitar para tirar "para Mac" das descrições quando Windows e Linux saírem.

## ✅ I12. Lista de modelos do Claude desatualizada e repetida em três lugares — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** Lista única `MODEL_LIST` em `server/agent.js`, com Fable 5.2, entregue pelo `hello` (`models`); a página a recebe por `setClaudeModels`. READMEs atualizados. Quem tinha `claude-fable-5-1` salvo volta ao padrão (Opus 5.5). `npm test` verde; não abri o menu na interface.

- **Classificação:** confirmado (leitura). **Gravidade:** baixa a média. **Esforço:** P.
- **Evidência:** `claude-fable-5-1` em [server/agent.js:18](server/agent.js:18), [web/src/agent.js:15](web/src/agent.js:15) e [README.md:51](README.md:51). O modelo atual é o Fable 5.2 (`claude-fable-5-2`).
- **Correção:** uma lista só, no servidor, entregue pelo `hello`. Entra no desenho do item 4 (cada agente declara os seus modelos).

## ✅ I13. "Nova janela" reabre o mesmo projeto; não há instância única — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** "Nova janela" (menu e página) abre a tela inicial (`?welcome=1`). `requestSingleInstanceLock()`: a segunda execução passa a pasta para a primeira (`second-instance`) e sai. `open-file` que chega antes do servidor fica guardado e abre quando ele sobe. O argumento da linha de comando vale quando é uma pasta que não é a do próprio app. Verificado no Electron com perfil temporário: a segunda execução saiu na hora e a primeira abriu a pasta passada. A janela nova na tela inicial e o `open-file` antecipado não foram exercitados.

- **Classificação:** confirmado (leitura). **Gravidade:** baixa a média. **Esforço:** P.
- **Evidência:** [electron/main.js:108](electron/main.js:108) cria a janela sem caminho; [web/src/main.js:1699](web/src/main.js:1699) abre o projeto mais recente, que é o da janela de onde se veio. Ficam duas janelas com cópias separadas dos mesmos arquivos. Não há `app.requestSingleInstanceLock()`; no Windows e no Linux, abrir o app de novo sobe um segundo servidor que escreve no mesmo `state.json`. [main.js:202](electron/main.js:202): um `open-file` que chega antes de o servidor subir é descartado. [main.js:194](electron/main.js:194): o filtro `!/electron/i` ignora qualquer pasta com "electron" no caminho.
- **Correção:** janela nova abre a tela inicial (parâmetro `?welcome=1`); trava de instância única com `second-instance` abrindo janela; guardar o caminho pendente do `open-file`; trocar o filtro do argv por "é um diretório".

## ✅ I14. Renomear uma pasta deixa as abas abertas com o caminho antigo — **CORRIGIDO**

- ✅ **Estado: corrigido em 11/11/2026.** `rename` em `web/src/sidebar.js` troca o prefixo em todas as abas, raízes (`t.root`, `t.roots`), PDFs, `savedRoots`, pastas expandidas e estado de compilação. Conferido por leitura; não exercitei o fluxo na interface.

- **Classificação:** confirmado (leitura). **Gravidade:** baixa a média. **Esforço:** P.
- **Evidência:** [web/src/sidebar.js:211](web/src/sidebar.js:211) atualiza só a aba cujo caminho é o do item renomeado. Abas de arquivos dentro da pasta renomeada, a raiz do documento (`t.root`), `S.savedRoots` e as abas de PDF ficam com o caminho velho; salvar falha com "Não salvou" (a pasta não existe mais).
- **Correção:** ao renomear, trocar o prefixo em todas as abas, raízes, PDFs e em `savedRoots`, e chamar `refreshRoots`.

## ✅ I15. Depois de instalar o TeX, o app continua dizendo que falta — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** `refreshTools()` em `server/util.js` limpa o cache do `which` e recalcula os caminhos extras; `hello({ refresh: true })` chama, e a tela inicial pede assim toda vez que se desenha. Teste em `test/writelink.test.js`. O assistente do item 5 deve usar o mesmo `refresh`.

- **Classificação:** confirmado (leitura). **Gravidade:** média para o item 5. **Esforço:** P.
- **Evidência:** [server/util.js:101](server/util.js:101): `whichCache` nunca é limpo. [util.js:12](server/util.js:12): `EXTRA_PATHS` é calculado uma vez, na carga do módulo, e é ele que descobre a pasta do TeX Live pelo ano.
- **Impacto:** o assistente de primeira abertura vai mandar instalar o MacTeX, a pessoa instala, clica em "verificar de novo" e nada muda até reiniciar.
- **Correção:** `refreshTools()` que limpa o cache e recalcula os caminhos; o `hello` e o assistente chamam com `refresh: true`.

## ✅ I16. Servidores do LanguageTool ficam órfãos — **CORRIGIDO**

- ✅ **Estado: corrigido em 12/11/2026.** O servidor iniciado fica registrado em `<dados do app>/languagetool.pid` (PID e porta); ao subir, o app reaproveita o registrado se responde ou o encerra se não; `stop()` apaga o registro; `process.on('exit')` encerra. Mantive `detached` porque o encerramento usa o grupo do processo. Não testei com o LanguageTool real. Os órfãos que já existem continuam: o `pkill` abaixo limpa.

- **Classificação:** confirmado (observado nesta máquina). **Gravidade:** média. **Esforço:** P.
- **Evidência:** [server/grammar.js:212](server/grammar.js:212) sobe o servidor com `detached: true`; só `close()` o encerra. Durante a auditoria havia **15 processos Java do LanguageTool** com pai 1, ligados havia entre 17 horas e 1 dia e 8 horas, em portas aleatórias, com o TeXugo fechado. Nenhum veio dos meus testes (desliguei o corretor nos perfis de teste).
- **Impacto:** cada sessão que termina sem a limpeza (travamento, encerramento forçado, o hook que troca o app, `npm run serve` interrompido) deixa uma JVM para trás. Com os n-gramas do item 1, cada uma mapeia gigabytes.
- **Correção:** gravar o PID e a porta em `<dados do app>/languagetool.pid`; ao subir, encerrar o que estiver registrado e ainda vivo, ou reaproveitar se responder; não usar `detached` e encerrar o filho em `process.on('exit')`. Para limpar os que estão aí agora, se quiser:
  ```bash
  pkill -f 'languagetool.*--port'
  ```

**Complemento de I16 (12/11/2026).** No Mac, fechar a última janela deixava o app no Dock com o LanguageTool (Java) rodando; e uma queda do app deixava o Java órfão até a próxima abertura. Agora: o LanguageTool para depois de 10 minutos sem checagem (`TEXUGO_LT_IDLE_MS`; o relógio pausa durante uma checagem) e volta sozinho em segundos na checagem seguinte; fechar a última janela no Mac encerra o LanguageTool e a prévia ao vivo (`idle()` em `server/index.js`); no Mac e no Linux, um vigia em `sh` encerra o Java quando o processo do app some. Verificado: `kill -9` no processo pai encerrou o Java em menos de 8 s; com 3 s de espera, o servidor parou e reabriu na checagem seguinte. No Windows a queda ainda deixa o Java órfão até a próxima abertura.

## I17. Riscos de Windows e Linux já visíveis no código

- **Classificação:** risco potencial (não testado nesses sistemas). **Gravidade:** média. **Esforço:** M.
- **Evidência, por arquivo:**
  - [server/build.js:276](server/build.js:276) e [server/live.js:178](server/live.js:178): `detached: true` sem `windowsHide: true` abre uma janela de console a cada compilação no Windows. ✅ **FEITO (12/11):** `windowsHide: true` em build.js, live.js e grammar.js.
  - [server/build.js:233](server/build.js:233): `new Promise(async …)`; um `fs.rmSync` que falhe (arquivo travado, comum no Windows) deixa a promessa sem resolver, e a fila de compilação para até reiniciar. ✅ **FEITO (12/11):** `_latexmk` virou `async`; o erro chega ao `_start`, que encerra a compilação com falha e segue a fila.
  - [server/index.js:139](server/index.js:139): o filtro do observador usa `/`; no Windows os eventos de `.git\` não são filtrados. [web/src/main.js:1533](web/src/main.js:1533): `'/.texugo-comments/'`, mesmo problema. ✅ **FEITO (12/11):** o servidor troca `\` por `/` antes do filtro; o cliente aceita os dois separadores.
  - [server/compare.js:190](server/compare.js:190): `BIBINPUTS: docDir + ':'` (no Windows o separador é `;`). ✅ **FEITO (12/11):** `path.delimiter`, também em `BSTINPUTS`.
  - [server/refs.js:200](server/refs.js:200): `bibsOf` manipula caminhos como texto com `/`. ✅ **FEITO (12/11):** `path.dirname` e `path.resolve`.
  - [server/submission.js:58](server/submission.js:58): `isInDir` com `path.sep` contra caminhos do `.fls`, que usam `/`; e `/dev/` fixo. ✅ **FEITO (12/11):** `isInDir` por `path.relative`; `/dev/` e `nul` checados no caminho original do `.fls`.
  - [server/git.js:59](server/git.js:59): `git diff --no-index -- /dev/null`. ✅ **SEM MUDANÇA (12/11):** o Git reconhece o texto `/dev/null` nesse comando em todos os sistemas (no Windows também `nul`); `os.devNull` (`\\.\nul`) seria pior. Conferir na CI do Windows.
  - [server/index.js:171](server/index.js:171): `home: process.env.HOME`, indefinido no Windows. ✅ **FEITO (12/11):** `os.homedir()`.
  - [server/ai.js:36](server/ai.js:36) e [agent.js:184](server/agent.js:184): `kill('SIGTERM')` no `cmd.exe` que embrulha o `claude.cmd` não encerra o processo filho. ✅ **FEITO (12/11):** `killTree` (`taskkill /T /F` no Windows).
  - `node-pty` 1.1.0 traz binários prontos para macOS e Windows, não para Linux: o AppImage exige compilar na CI.
  - `latexdiff` e `latexindent` dependem de Perl; no MiKTeX ele não vem.
  - `spellcheck: true` em [electron/main.js:41](electron/main.js:41): no Windows e no Linux o Chromium baixa os dicionários de um servidor do Google (no Mac usa o do sistema). Entra na página de privacidade ou se desliga. ✅ **FEITO:** já consta em PRIVACIDADE.md e PRIVACY.md (linha Google).
- **Correção:** tratar na etapa 2 de Windows e Linux; o teste de fumaça do item 2 pega a maior parte.

---

# Parte 3. Melhorias desejáveis

| # | Achado | Evidência | Classificação | Esforço |
|---|---|---|---|---|
| ✅ D1 | **CORRIGIDO (11/11/2026), com ressalvas.** Feito: tudo o que tem clique é alcançável e acionável pelo teclado (`h()` em `dom.js`), setas nas listas, abas e menus, F6 entre as áreas, anel de foco único, diálogos com `role="dialog"`, foco preso e devolvido, Esc só no de cima, chaves liga/desliga focáveis, `prefers-reduced-motion`, cores de texto a 4,5:1, textos de 10 px subiram. Falta: teste com leitor de tela (VoiceOver) e as fontes de 11 a 12 px, que ficaram. Texto original: **Acessibilidade.** Quase não há ARIA; abas, linhas da árvore e listas são `div` com clique, sem foco pelo teclado; botões não têm anel de foco; os diálogos não têm `role="dialog"`, não prendem o foco nem o devolvem; a interface usa fontes de 10 a 12,5 px; não há `prefers-reduced-motion`. O zoom do menu Visualizar atenua o tamanho. | 2 ocorrências de `aria-`/`role`/`tabindex` em toda a interface (em `dom.js`); `:focus` só para campos em [web/styles.css:61](web/styles.css:61); `modal` em [web/src/dom.js:217](web/src/dom.js:217) | Confirmado (leitura) | M |
| ✅ D2 | **CORRIGIDO (12/11/2026).** No máximo 6 commits processados ao mesmo tempo em `news()`. Texto original: **`news()` dispara cerca de 3 processos `git` por commit, todos de uma vez.** 120 commits: 1,5 s e uns 360 processos. No Windows, onde criar processo é caro, vira segundos. Limitar a 6 ao mesmo tempo. | [server/coauthors.js:218](server/coauthors.js:218) | Confirmado (medição) | P |
| ✅ D3 | **CORRIGIDO (12/11/2026).** Trava por projeto em `server/ai.js`; Cancelar encerra só a ação do projeto da janela. Texto original: **Uma ação de IA por vez no app inteiro.** A resposta aos pareceristas (até 30 min) bloqueia "Revisar o trecho" em todas as janelas com "Já há uma ação de IA em andamento". Trava por projeto, ou fila visível. | [server/ai.js:31](server/ai.js:31), [ai.js:86](server/ai.js:86), [rr.js:143](server/rr.js:143) | Confirmado (leitura) | P |
| ✅ D4 | **CORRIGIDO (12/11/2026).** Pausa = maior entre 700 ms e metade da última passada. Texto original: **Prévia ao vivo com pausa fixa de 700 ms.** Em paper cuja passada leva 10 s, o motor roda sem parar enquanto se digita. Pausa proporcional à última passada (por exemplo, o maior entre 700 ms e metade dela). | [web/src/live.js:7](web/src/live.js:7) | Sugestão | P |
| ✅ D5 | **CORRIGIDO (12/11/2026).** Commit e Sincronizar perguntam antes de incluir arquivo novo acima de 50 MB (`largeNewFiles` em `server/git.js`; "Incluir mesmo assim" repete com `force`). Verificado com um arquivo de 60 MB num repositório temporário. Texto original: **Sincronizar faz `git add -A`.** Uma pasta de dados fora do `.gitignore` entra no commit; arquivo acima de 100 MB faz o push falhar com o commit já feito. Avisar antes quando houver arquivo novo acima de uns 50 MB. | [server/git.js:74](server/git.js:74), [git.js:106](server/git.js:106) | Risco potencial | P |
| ✅ D6 | **CORRIGIDO (11/11/2026).** Todo aviso de erro fica na tela até ser fechado (botão ×, `role="alert"`); os demais pausam sob o mouse; mensagem repetida substitui a anterior. Texto original: **Erros importantes somem em 8 a 10 s.** Falha de sincronização, de commit e de salvamento aparecem só num aviso temporário. Manter até fechar, ou guardar numa lista. | [web/src/sidebar.js:432](web/src/sidebar.js:432), [main.js:730](web/src/main.js:730) | Confirmado (leitura) | P |
| ✅ D7 | **CORRIGIDO (12/11/2026), menos os fusíveis.** `createProject` recusa nome com barra, `.` ou `..`; `comments.list` ignora `file` fora do projeto; a guarda de caminho resolve links e recusa os que apontam para fora da pasta pessoal ou para pasta oculta dela (`~/.ssh`, `~/.aws`), mantendo o `.bib` compartilhado em `~/Dropbox` do I1; revisão do Git começando com `-` é recusada; `readBody` corta a conexão acima de 50 MB. Testes em `test/security.test.js`. Falta: fusíveis do Electron (`RunAsNode`), que pedem `@electron/fuses` no empacotamento; fica com B5/B6. Texto original: **Defesa em profundidade** (nada explorável sem o token): `createProject` aceita `name` com `../` (reproduzi a pasta criada fora do destino); `comments.list` lê `c.file` sem conferir se está no projeto ([comments.js:63](server/comments.js:63), reproduzido); a guarda de caminho não resolve links, então um link para fora do projeto é lido (reproduzido); `source.rev` de `compare.js:58` pode começar com `-`; `readBody` não interrompe a requisição acima de 50 MB; fusíveis do Electron no padrão (`RunAsNode` ligado). | [server/index.js:502](server/index.js:502), [util.js:110](server/util.js:110) | Confirmado, impacto baixo | P |
| D8 | **O servidor roda no processo principal do Electron com E/S síncrona.** Num projeto de 6 mil arquivos: árvore 69 ms, documentos 89 ms, símbolos 277 ms, cada um travando menus e janelas. Aceitável hoje. Se crescer, mover para `utilityProcess`. Não recomendo mexer antes do lançamento. | medições do Apêndice A | Sugestão | G |
| ✅ D9 | **CORRIGIDO (12/11/2026).** Preferências → Geral: "Parar uma compilação que fica sem progresso por (segundos)", de 30 a 3.600, padrão 180; a variável `TEXUGO_STALL_MS` continua valendo. Texto original: **Parada por 180 s sem saída.** Passos longos e silenciosos são raros, mas o limite só muda por variável de ambiente. Expor nas Preferências se alguém reclamar. | [server/build.js:271](server/build.js:271) | Risco potencial | P |
| ✅ D10 | **CORRIGIDO (12/11/2026).** `pct()` em `server/rr.js` escapa `%` solto (e quebra de linha) no texto do modelo dentro de `\todo`, `\change` e da lista de mudanças; teste em `test/writelink.test.js`. Texto original: **`\todo{…}` e `\change{…}` da resposta aos pareceristas recebem o texto do modelo sem escape.** Um `%` vindo do Claude comenta o fecha-chave e quebra a compilação do `response.tex`. | [server/rr.js:127](server/rr.js:127) | Confirmado (leitura) | P |

---

# Parte 4. Os nove itens do roteiro, com direção para a implementação

Esta parte é para o Opus 5.5. Ordem sugerida no fim.

## Regras de trabalho para quem implementa

1. Um achado por commit, com o teste que o reproduz escrito antes da correção. Você faz o commit; o Fredie faz o push.
2. Sem reescrita ampla. As correções da Parte 1 cabem em menos de 150 linhas cada.
3. Exemplos e testes nunca saem dos papers do Fredie, e a interface não usa siglas que só existem no Brasil.
4. Toda frase nova da interface entra em português e em inglês no mesmo commit.
5. Antes de usar a opção de linha de comando de uma ferramenta externa (latexmk, codex, gemini, opencode, electron-builder, LanguageTool), rode o `--help` da versão instalada ou leia a documentação atual. Várias dessas interfaces mudam rápido, e o que está aqui vem da minha leitura até meados de 2026.
6. Corrija B1, B2 e B3 antes de qualquer item novo. Os itens 3, 4 e 6 pioram esses defeitos se vierem antes.

## ✅ Item 1. Corretor avançado de inglês (n-gramas, 8 GB) como download opcional — **FEITO**

- **Estado (12/11/2026):** os fatos foram conferidos em `languagetool.org/download/ngram-data/`. O `ngrams-en-20150817.zip` tem 8.961.853.713 bytes e, descompactado, 15.401.820.145 bytes, em `en/1grams`, `en/2grams` e `en/3grams`, segundo o índice do zip lido por faixa de bytes, sem baixar o arquivo. O servidor aceita `Range` e manda `ETag`. Não há n-gramas para português. `server/ngrams.js` cuida dos estados `absent`, `downloading`, `paused`, `unpacking`, `ready` e de erro. O download vai para `.partial`, retoma com `Range` e `If-Range`, recomeça do zero se o `ETag` mudar, confere o tamanho, pede cerca de 25 GB livres antes de começar e descompacta numa pasta temporária, que só substitui a antiga quando termina. `serverArgs()` passa `--languageModel`. Com os n-gramas, o TeXugo sobe o próprio servidor em vez do 8081 do Homebrew e reinicia o servidor quando os dados chegam ou saem. A chave do cache inclui o estado dos n-gramas. Preferências → Corretor mostra uma linha com o estado, o tamanho, a barra de progresso e um botão que muda (*Baixar (9,0 GB)*, *Pausar*, *Continuar*, *Remover*). Testes em test/ngrams.test.js: um zip pequeno servido localmente cai no meio, é retomado com `Range`, descompacta e vira o modelo; a pausa guarda o parcial; um `ETag` novo recomeça; *Remover* limpa tudo. **Não feito:** o aceite com os dados reais (*their* no lugar de *there* marcado só com n-gramas), que pede baixar os 9 GB.

**O que a auditoria muda:** I16 primeiro (com n-gramas, cada servidor órfão custa caro). A chave do cache em [server/grammar.js:252](server/grammar.js:252) precisa incluir o estado dos n-gramas, senão os resultados antigos ficam.

**Fatos a confirmar antes:** os dados de n-gramas do LanguageTool existem para inglês, alemão, francês, espanhol e holandês; não há para português. O nome "corretor avançado de inglês" está certo. Confirme o endereço e o tamanho atuais em `languagetool.org/download/ngram-data/` e o tamanho depois de descompactado, para pedir o espaço certo.

**Desenho:**

- `server/ngrams.js` com `status()`, `start()`, `cancel()`, `remove()`. Estados: `absent → downloading(pct) → unpacking → ready`, mais `error(motivo)`.
- Download em fluxo para `<dados>/languagetool/ngrams/.partial`, com retomada por `Range` (8 GB não podem recomeçar do zero quando a rede cai). Antes de começar, `fs.statfsSync` para conferir o espaço: zip mais descompactado, com folga. Progresso por `broadcast({ type: 'ngrams:progress' })`, no máximo uma vez por segundo.
- Descompactar com o que cada sistema tem (`unzip`, `ditto -x -k` ou `tar -xf`), para uma pasta temporária, e renomear no fim. O resultado tem de ser `<ngrams>/en/…`.
- Ligar ao servidor: o LanguageTool aceita `--languageModel <pasta>` e `languageModel=` no arquivo de propriedades. Hoje o TeXugo passa o `server.properties` do Homebrew quando existe ([grammar.js:210](server/grammar.js:210)). Passe a escrever um arquivo próprio em `<dados>/languagetool/server.properties`, copiando o do Homebrew e acrescentando a linha. Reinicie o filho depois de instalar ou remover.
- Caso especial: [grammar.js:201](server/grammar.js:201) reaproveita um LanguageTool que já escuta na porta 8081. Nele os n-gramas do TeXugo não valem. Com n-gramas instalados, suba o servidor próprio de qualquer forma.
- O LanguageTool recomenda SSD para os n-gramas. Diga isso na tela.

**Interface (Preferências → Corretor):** uma linha só. Estado, tamanho e um botão cujo rótulo muda: *Baixar (8 GB)*, *Pausar*, *Continuar*, *Remover*. Uma frase explica o ganho com um exemplo ("pega trocas como *their* por *there*") e avisa que é só para o inglês. O download não bloqueia o app e sobrevive a fechar e abrir.

**Testes:** um zip minúsculo servido por HTTP local percorre a máquina de estados, com queda e retomada; `local()` passa `--languageModel` quando o estado é `ready`.

**Aceite:** uma frase com *their* no lugar de *there* é marcada com n-gramas e não é sem eles.

## Item 2. GitHub Actions: testes, instaladores e teste de fumaça

**O que a auditoria muda:** o teste de fumaça é a peça que falta para pegar B1, B2 e B4. Vale mais que a matriz de instaladores.

**Fluxos:**

- `ci.yml` (push e pull request), matriz `macos-latest`, `windows-latest`, `ubuntu-latest`, Node 22: `npm ci`, `npm run build:web`, testes.
  - Separe os testes que precisam de TeX (`templates`, `build`, `live`, `submission`, `compare`, `sent`) dos demais. Os demais rodam em segundos nos três sistemas. Os de TeX rodam num trabalho com TeX Live instalado por uma action com lista de pacotes e cache (procure a action de `setup-texlive` mantida hoje; no Windows a instalação sem cache passa de dez minutos). A lista de pacotes sai dos modelos; guarde em `.github/tl-packages.txt`.
  - Acrescente os testes novos desta auditoria: `test/api.test.js` (token, guardas de caminho, conflito de escrita, link simbólico), `test/git.test.js` (remoto local), `test/i18n.test.js`.
  - `npm audit --omit=dev` como aviso.
- `smoke.yml` nos três sistemas: abre o app, abre um projeto de modelo, compila, confere o PDF e "zero ??"; depois suja uma aba e exercita fechar, sair e trocar de projeto. Use o suporte a Electron do Playwright (`_electron.launch`) ou o roteiro do Apêndice A. No Linux, `xvfb-run -a`.
- `release.yml` (tag `v*`): `electron-builder` nos três sistemas, artefatos num rascunho de release. Segredos de assinatura só nesse fluxo.

**Armadilhas que encontrei montando o roteiro:**

- `electron/main.js` é módulo ES com `await` no topo. Um `await app.whenReady()` no topo do arquivo de entrada nunca resolve, porque o `ready` só dispara depois de o módulo terminar de carregar. Use `app.whenReady().then(…)`.
- O filtro de [electron/main.js:194](electron/main.js:194) descarta caminhos com "electron": não ponha o projeto de teste numa pasta com esse nome (ou corrija o filtro, I13).
- Perfil separado: `app.setPath('userData', …)` antes de importar `main.js`, ou `--user-data-dir`.
- Desligue o corretor no perfil de teste (`settings.grammar: false`), senão cada execução deixa um LanguageTool rodando (I16).
- `node-pty` não tem binário pronto para Linux: os runners do Ubuntu têm compilador, mas o `electron-builder` precisa recompilar e deixar o módulo fora do asar (`asarUnpack`).

**Aceite:** os três sistemas verdes num pull request; a tag gera `.dmg`, `.exe` e `.AppImage` no rascunho de release.

## Item 3. Sincronização com o Overleaf

**O que a auditoria muda:** depende de B3 (salvar antes de sincronizar) e de I4 (mensagens de erro). Sem isso, o Overleaf vira mais uma fonte de reversão silenciosa.

**Fatos a confirmar:** o caminho oficial é a integração Git do Overleaf, recurso de plano pago: `https://git.overleaf.com/<id do projeto>`, autenticada por token (usuário `git`, token como senha). Conta gratuita não tem Git nem API pública. Não use os caminhos não oficiais (cookie de sessão, raspagem): quebram e expõem a conta.

**Desenho:**

- Overleaf como um remoto Git chamado `overleaf`. O TeXugo já tem a maquinaria.
- *Conectar ao Overleaf* no painel Git: a pessoa cola o endereço do projeto (`https://www.overleaf.com/project/<id>`), o app deriva o do Git e pede o token.
- **O token nunca vai para `state.json`, para a URL do remoto nem para um log.** Guarde pelo ajudante de credenciais do Git (`git credential approve`), que usa as Chaves do macOS, o Gerenciador de Credenciais do Windows ou o libsecret.
- Fluxo de sincronização: salvar tudo → commit → `pull` do Overleaf → `push`. Restrições do lado de lá a tratar com mensagem própria: um ramo só, sem push forçado, limites de tamanho, e push recusado enquanto houver mudança não baixada.
- Projeto com GitHub e Overleaf ao mesmo tempo: para a primeira versão, use `merge` (não `rebase`) no pull do Overleaf, para os dois históricos continuarem compatíveis, e deixe claro qual remoto o botão Sincronizar usa.
- Conta gratuita: diga com clareza que a sincronização pede plano pago e aponte para o que já existe (*Comparar com outra versão* e *Versões enviadas* leem o ZIP do Overleaf).

**Testes:** um repositório local faz o papel do Overleaf; casos de push recusado, conflito e token errado.

**Aceite:** dois clones (um como "Overleaf") trocam mudanças pelo botão, sem o token aparecer em nenhum arquivo do projeto ou do app (`grep` pelo token na pasta de dados e no `.git/config` não acha nada).

## Item 4. Outros agentes de IA

**O que a auditoria muda:** I8 (o que o agente pode fazer), I12 (lista de modelos) e D3 (trava global) entram no desenho. O mapa `TOOL_PT` de [web/src/agent.js:33](web/src/agent.js:33) e o prompt de sistema de [server/agent.js:30](server/agent.js:30) são específicos do Claude.

**Direção de arquitetura:** não escreva quatro integrações sob medida. Defina uma interface e dois transportes.

```js
// server/agents/adapter.js
// start(root, { model, effort, resume }) -> session
// session.send(text)
// session.on('text' | 'tool' | 'tool-result' | 'permission' | 'result' | 'error' | 'status', fn)
// session.answer(reqId, allow, note)
// session.interrupt(); session.close()
// static detect() -> { installed, version, loggedIn?, models: [{ id, label }], efforts: [...] }
// static oneShot(prompt, { root, readOnly: true, model, timeout }) -> text
```

- **Transporte 1, o que já existe:** Claude Code por `stream-json` ([server/agent.js](server/agent.js)). Vira `agents/claude.js` sem mudar de comportamento. Mantém as linhas dos mods (`ui_log`, `ui_status`).
- **Transporte 2, ACP (Agent Client Protocol):** JSON-RPC por stdio, criado pelo Zed para ligar editores a agentes. Tem sessão, envio de prompt, atualizações em fluxo (texto, chamadas de ferramenta, plano) e, o que mais importa aqui, **pedido de permissão ao cliente** e leitura e escrita de arquivos **pelo cliente**. Isso encaixa nos cartões de aprovação que o painel já tem, e permite ao TeXugo servir o texto não salvo e aplicar a escrita como diff. Pela minha leitura, o Gemini CLI e o OpenCode falam ACP nativamente, e há adaptadores para Codex e Claude Code. Confirme o estado atual de cada um antes de se comprometer; se o ACP de algum não estiver maduro, o plano B é o modo não interativo com saída JSON de cada CLI.
- **Ações de uma tacada** (reescrever o trecho, parecer, resposta aos pareceristas): cada adaptador implementa `oneShot` com o modo não interativo do seu CLI, sempre só de leitura. Para o Claude é o que [server/ai.js:88](server/ai.js:88) faz. Para os outros, use a opção de sandbox de leitura de cada um e **teste que ele não consegue escrever** (peça para criar um arquivo e confira que não foi criado). Esse teste é o critério de aceite de segurança de cada agente.

**Ordem:** extrair a interface com o Claude dentro e os testes verdes; depois Codex, Gemini CLI, OpenCode; Cursor e Droid se sobrar tempo.

**Interface:** o painel passa a se chamar "Agente". No topo, um seletor com os agentes instalados (os ausentes aparecem apagados, com "instalar"). Modelo e esforço vêm do `detect()` do agente escolhido; se o agente não tem "esforço", o controle some. A escolha vale para o painel, para o terminal e para as ações no texto, como hoje. O rótulo "Claude ligado" da barra de status e os textos "Trocar com o Claude" passam a usar o nome do agente.

**Segurança, igual para todos:** leitura livre só dentro do projeto; escrita, comando e rede sempre por cartão; o cartão mostra o valor inteiro (I8); a trava de "uma ação por vez" passa a ser por projeto (D3).

**Testes:** um agente falso (um script Node que fala o protocolo) para exercitar adaptador e permissões sem gastar conta. `test/agent-mods.test.js` já faz algo parecido para o Claude.

## Item 5. Assistente de primeira abertura

**O que a auditoria muda:** I15 é pré-requisito (sem limpar o cache, "verificar de novo" não funciona).

**O que já existe e dá para reaproveitar:** `hello().tools` ([server/index.js:161](server/index.js:161)), `doctor.texInfo()`, `grammar.status()`, `texInstallHint()` por sistema ([server/platform.js:62](server/platform.js:62)) e o aviso de TeX ausente em [web/src/welcome.js:253](web/src/welcome.js:253).

**Desenho:** uma tela só, calma, sem etapas de assistente. Quatro linhas, cada uma com um ponto de estado, uma frase e no máximo um botão.

| Linha | Verifica | Se faltar |
|---|---|---|
| TeX | `latexmk` e um motor; ano do TeX Live | Link do instalador do sistema (MacTeX, MiKTeX ou TeX Live) e *Verificar de novo* |
| Git | `git` no caminho; `user.name` e `user.email` definidos | Instruções; campos para nome e e-mail que rodam `git config --global` |
| Agente de IA (opcional) | Algum dos agentes instalado | Como instalar; marcado como opcional |
| Corretor (opcional) | LanguageTool instalado | *Instalar* no Mac com Homebrew; nos outros, instruções ou o servidor online com o aviso de que o texto sai do computador |

Regras: nunca rodar `sudo` nem instalador sem clique; *Continuar mesmo assim* sempre visível; aparece na primeira abertura (`settings.onboarded`) e fica em Ajuda → Verificar instalação. A identidade do Git importa mais do que parece: sem ela, comentários e "quem escreveu" caem no nome de usuário do sistema ([server/comments.js:28](server/comments.js:28)).

**Aceite:** num perfil novo sem TeX no caminho, a tela aparece; depois de corrigir o caminho, *Verificar de novo* fica verde sem reiniciar.

## Item 6. Aviso de versão nova com "Atualizar agora"

**O que a auditoria muda:** depende de B1 (o atualizador chama `app.quit()`) e de B5 (assinatura).

**Desenho:**

- `electron-updater` lendo o GitHub Releases, gerado pelo `electron-builder` do item 9. No Mac exige app assinado e notarizado. No Windows funciona sem assinatura, com o aviso do SmartScreen na primeira instalação. No Linux só atualiza quando o app roda como AppImage.
- Checar na abertura e uma vez por dia. Aviso discreto na barra de status: "Versão 0.2.0 disponível", com *Novidades* (abre as notas) e *Atualizar agora*. Baixar em segundo plano com progresso.
- Antes de instalar: o mesmo diálogo de alterações não salvas de B1; avisar se houver compilação, terminal ou agente rodando.
- Sem conta de desenvolvedor da Apple: no Mac o botão vira *Baixar* e abre a página da release. Não tente trocar o pacote por conta própria sem verificar a origem: um atualizador que instala o que baixou sem checar assinatura é um vetor de ataque pior do que não ter atualizador.
- Privacidade: a checagem manda o IP e a versão ao GitHub. Entra na página de privacidade, com uma opção para desligar.
- A versão hoje é 0.1.0 e o `hello` relê o `package.json` a cada chamada: leia uma vez. ✅ **FEITO (13/11):** lida uma vez, em `APP_VERSION`.

**Aceite:** com duas releases de teste num repositório auxiliar, a 0.1.0 oferece a 0.1.1, instala, reabre e mostra 0.1.1; com aba suja, pergunta antes.

## ✅ Item 7. E-mail nos comentários: recomendo tirar — **FEITO**

- ✅ **Estado: feito em 12/11/2026.** Os comentários não gravam mais `email` (conversa, resposta, resolução); arquivo antigo perde o campo quando é regravado, e `list` nunca o devolve. `isMine` compara o nome; a cor sai do nome. Paleta: "Remover e-mails dos comentários" regrava os arquivos que ainda têm. O checklist de replicação avisa quando `.texugo-comments/` está na pasta do pacote. Teste em `test/security.test.js`.

**Evidência:** [server/comments.js:88](server/comments.js:88), [comments.js:101](server/comments.js:101) e [comments.js:108](server/comments.js:108) gravam `email` (o `git config user.email`) em cada conversa, resposta e resolução. A interface usa o e-mail para duas coisas: saber se o comentário é meu ([web/src/comments.js:24](web/src/comments.js:24)) e escolher a cor do autor ([comments.js:25](web/src/comments.js:25)).

**Por que tirar:**

- Para quem tem acesso ao repositório, o e-mail já está nos commits; o arquivo não acrescenta nada.
- Os arquivos de `.texugo-comments/` saem do repositório por caminhos em que ninguém espera encontrar e-mail: um ZIP da pasta mandado a um coautor, o pacote de replicação, um repositório que fica público depois da publicação.
- As duas funções que usam o e-mail funcionam com o nome.

**Como:** parar de gravar `email`; `isMine` compara o nome com `git config user.name` (o item 5 garante que ele existe); a cor sai do nome. Ler arquivos antigos que ainda tenham o campo, sem exibir. Oferecer na paleta "Remover e-mails dos comentários", que regrava os arquivos. O checklist de replicação deveria avisar quando `.texugo-comments/` está dentro do pacote (a discussão interna dos autores não é parte dele).

**Se preferir manter:** guarde um hash curto do e-mail, que serve para identificar sem expor.

## Item 8. Auditoria completa antes do lançamento

Esta auditoria cobre a primeira passada. O que fica de cada subitem:

| Subitem | Feito aqui | Falta |
|---|---|---|
| Segurança: servidor local | Token e guardas de caminho verificados; lacunas em I7 e D7 | ✅ Feito em 12/11: I7 aplicado; `test/api.test.js` cobre token, Host, guardas de caminho, link para fora, conflito de escrita e salvar por link |
| Segurança: acesso a arquivos | I1, D7 | ✅ A guarda já resolve links (`linkTargetOk`); coberto por `test/api.test.js` |
| Segurança: comandos executados | Todos os `spawn` e `run` lidos: argumentos em lista, sem shell, com `--` no Git. O único shell é o do Médico do TeX, com pacotes validados por expressão regular | I8 (latexmkrc) |
| Segurança: agentes | I8 | Teste do hook de projeto; cartão sem corte; item 4 |
| Bugs | B1 a B4, I1 a I6, I14 | Corrigir |
| Cada recurso de ponta a ponta num projeto novo | Não feito (só os fluxos de salvar, fechar, trocar, compilar e sincronizar) | A tabela da Parte 6 diz o que não tem teste; percorrer cada linha num projeto de modelo, em português e em inglês |
| Interface em inglês | I9 | Teste de cobertura e passada manual |
| Desempenho com papers grandes | I10, D2, D4, D8 e medições | Medir no app aberto: paper de 100 páginas com 40 arquivos, `.bib` de 1.500 entradas, 30 minutos de edição com prévia ao vivo, olhando memória e CPU |
| Licenças | B7 | Gerar os avisos |
| Página de privacidade | Apêndice B tem o conteúdo | ✅ Feito em 12/11: PRIVACIDADE.md e PRIVACY.md, com link nos dois READMEs. Falta publicar no site (item 9) |

## Item 9. Instaladores finais e site

**Instaladores, com `electron-builder`** (resolve B5 e alimenta os itens 2 e 6):

- `appId: br.fredie.texugo`; `files`: `electron/`, `server/`, `dist/` (sem o `.map`), `build/`, `package.json`; `asarUnpack` para `node-pty`.
- Mac: `dmg` e `zip` (o atualizador usa o zip), `arm64` e `x64` ou universal, `hardenedRuntime`, entitlements mínimos do Electron, notarização. Confira que o `spawn-helper` do `node-pty` sai assinado e executável; [scripts/package-mac.mjs:38](scripts/package-mac.mjs:38) faz isso à mão hoje.
- Windows: `nsis`, por usuário, sem pedir administrador. Sem assinatura o SmartScreen avisa; diga isso na página.
- Linux: `AppImage`.
- `extraResources` com `LICENSE`, `THIRD-PARTY-NOTICES.txt` e `LICENSES.chromium.html` (B7).
- Inverta os fusíveis do Electron no pacote final (`RunAsNode` desligado, entre outros).
- O hook `post-commit` continua servindo à instalação local: aponte para um alvo `--dir`.

**Site:** estático, no GitHub Pages do próprio repositório, em português e inglês. Uma página: o que é, três capturas, os botões de download que detectam o sistema e apontam para a release mais recente, requisitos (TeX, Git) e as páginas de privacidade e de licenças. Windows e Linux com a marca "experimental" ao lado do botão, e não escondida num rodapé.

**Canal de problemas:** GitHub Issues com formulário (sistema, versão do TeXugo, versão do TeX, passos; um aviso para não colar trecho de paper inédito). No app, Ajuda → Relatar um problema abre o formulário com a versão e o sistema já preenchidos na URL. Nada de telemetria automática: seria mais um item na página de privacidade e não é necessário agora.

---

# Parte 5. Avaliação por área

**1. Arquitetura e organização.** A divisão é clara e pequena: `electron/` (210 linhas) só abre janela e menus; `server/` é um servidor HTTP local com uma função por recurso; `web/` é a interface, empacotada pelo esbuild. A ponte do preload expõe nove funções e nada de Node. Três dependências em produção (`ws`, `node-pty`, `katex`). Pontos fracos: `web/src/main.js` concentra 1.700 linhas de estado global, e `server/index.js` mistura roteamento, estado e regras de arquivo; o servidor roda no processo principal com E/S síncrona (D8). Nada disso pede reescrita: pede testes na camada de API.

**2. Bugs e confiabilidade.** B1 a B4, I1, I3 a I6, I14, D10. O motor de compilação é a parte mais robusta: fila, cancelamento por árvore de processos, parada por 180 s sem saída e por log acima de 50 MB, recuperação de `.aux` apagado. Não há `uncaughtException` no processo principal; um erro não tratado abre o diálogo padrão do Electron.

**3. Integridade dos documentos.** O que funciona: escrita atômica com checagem de `mtime` ([server/index.js:218](server/index.js:218)); recarga automática de aba limpa quando o arquivo muda fora, com aviso para aba suja ([web/src/main.js:1480](web/src/main.js:1480)); compilar salva antes; fechar aba pergunta; a IA nunca grava sem diff aceito; o Claude Code é recusado quando a aba está suja ([server/ide.js:294](server/ide.js:294)). O que falha: B1, B2, B3, I1, I2, I3. Não há salvamento automático, por decisão de desenho, e isso é defensável se I2 for feito.

**4. Segurança e privacidade.** Verificado: API sem token responde 401; arquivo fora do projeto, 403; `../` não escapa; o WebSocket exige token; a janela tem `sandbox`, `contextIsolation` e sem `nodeIntegration`; links externos abrem no navegador do sistema; a ponte com o Claude Code grava o token em arquivo 0600 e compara em tempo constante; não há telemetria; não achei credencial em arquivo do app (o Git usa o ajudante do sistema). Lacunas: I7, I8, D7, B6. Privacidade: I11 e Apêndice B.

**5. Desempenho.** I10 é o único problema que se sente ao digitar. As varreduras de projeto ficam entre 70 e 280 ms num projeto de 6 mil arquivos. Corretor (1,5 s de espera, cache por parágrafo) e vícios (600 ms) estão bem desenhados. Ver D2, D4, D8 e I16.

**6. Testes.** 94 testes, 57 s, todos verdes. A cobertura medida é de 83% das linhas dos arquivos que os testes carregam, e aí está o problema: os arquivos mais críticos não são carregados. Ver a Parte 6.

**7. Integrações.**

| Integração | Estado | Observação |
|---|---|---|
| TeX (latexmk, motores, SyncTeX, latexindent, tlmgr, chktex, texcount, latexdiff) | Sólida | B4; no Windows, Perl para `latexdiff` e `latexindent` |
| Git e GitHub | Boa | B3, I4, D5; `git.js` sem teste |
| Claude Code (painel, terminal como IDE, ações) | Boa | I8, I12, D3 |
| LanguageTool | Boa | I16; instalação automática só no Mac |
| Crossref, OpenAlex, arXiv | Boa | Rede sem teste (44% a 55% de cobertura); limites tratados com espera |
| Zotero (API local e cópia do SQLite) | Boa | Copia o banco a cada abertura do diálogo; pode demorar em biblioteca grande |
| Overleaf | Só por ZIP | Item 3 |

**8. Experiência de uso e acessibilidade.** Avaliei pelo código, sem ver a tela. Pontos fortes: explicações de erro em linguagem de gente, atalhos pesquisáveis, estado visível em cada aba. Pontos fracos (✅ os quatro primeiros corrigidos em 11/11/2026): D1 (acessibilidade), D6 (erros que somem), o diálogo de conflito com uma saída só (B3), a janela que não fecha sem explicar (B1) e a quantidade de recursos na aba Revisão, que pede o assistente do item 5 para quem chega.

**9. Recursos anunciados no README que estão incompletos ou sem teste.** "Nada vai para a nuvem" (I11). "Zero `??`" não vale com `$out_dir` (B4). "ZIP que compila sozinho" falha em pastas `tex*` (I5). "Fable 5.1" (I12). "A interface inteira, inclusive mensagens de erro, troca de idioma" (I9). "Sincronizar faz commit do que mudou" não inclui o que está na tela (B3). Sem teste automatizado: SyncTeX (23%), Médico do TeX (instalação), terminal, painel do agente (41%), parecer e resposta (52%: só a parte que lê o JSON), e toda a interface.

**10. Riscos de distribuição.** B5, B6, B7, I17 e I11.

---

# Parte 6. Lacunas de QA

Arquivos sem nenhum teste (0% das linhas carregadas):

| Arquivo | O que tem dentro | Defeitos achados aí |
|---|---|---|
| `server/index.js` (981 linhas) | Toda a API, token, guardas, escrita, observador | I1, I7, D7 |
| `server/git.js` | Commit, sincronizar, pull, push | B3, I4, D5 |
| `electron/main.js` | Janelas, sair, menus | B1, I13 |
| `web/src/main.js` e cerca de 40 módulos da interface | Salvar, abas, trocar de projeto, conflito | B1, B2, B3, I14 |
| `server/terminal.js`, `server/textsync.js` | Terminais; SyncTeX por texto | nenhum |

Testes a criar, na ordem de retorno:

1. **Fumaça no Electron** (Apêndice A): abrir, compilar, sujar, fechar, sair, trocar de projeto. Pega B1, B2 e B4. *Existe desde a segunda passada de UX: `test/ui/smoke.mjs`, `npm run test:ui`. Falta o caso de B4 e rodar na CI nos três sistemas.*
2. **`test/api.test.js`**: sobe `createServer` com `TEXUGO_DATA_DIR` temporário. Token, anfitrião, 403 fora do projeto, conflito por `mtime`, link simbólico, modo do arquivo, cabeçalhos.
3. **`test/git.test.js`**: remoto local e dois clones. Sincronizar limpo, com mudança fora do commit, com remoto inacessível, com conflito real.
4. **`test/i18n.test.js`**: a varredura como teste.
5. **Casos novos em testes existentes**: `latexmkrc` (B4), pasta `tex/` (I5), 3.100 tabelas (I6), tempo de `lineChanges` (I10). *Estado (12/11): B4 em `test/build.test.js`, I5 em `test/submission.test.js` e, agora, I6 em `test/project.test.js` (3.100 tabelas: acha o paper, a raiz da seção e `sec:intro`). O tempo de `lineChanges` (I10) está em `test/changes.test.js` (menos de 4 ms por tecla em 2.000 linhas, com uma edição no começo e outra no fim). Os quatro casos estão cobertos.*

---

# Parte 7. Ordem sugerida

1. **Não perder trabalho:** ✅ B1, ✅ B2, ✅ B3 (partes 1 e 2), I1 (pendente). Um dia. Junto, o roteiro de fumaça, que passa a guardar essas correções.
2. **Compilar certo:** B4, I5, I6.
3. **Base de distribuição:** B6 (subir o Electron), B5 (electron-builder; depende da sua decisão sobre a conta da Apple), B7. Com isso o item 2 (CI) e o item 9 (instaladores) ficam prontos em boa parte.
4. **Segurança e idioma:** I7, I8, I9, I11.
5. **Itens do roteiro**, nesta ordem: 7 (e-mail, pequeno) → 5 (assistente, com I15) → 6 (atualização) → 4 (agentes, com I12 e D3) → 1 (n-gramas, com I16) → 3 (Overleaf).
6. **Antes de anunciar:** I2, I10, B3 (parte 2) e o que couber da Parte 3; a passada de ponta a ponta do item 8.

O Overleaf fica por último de propósito: depende de plano pago do usuário, é o item com mais estados de erro e, sem B3 e I4, piora a integridade.

---

# Apêndice A. Como reproduzir

Tudo rodou fora do repositório, com `TEXUGO_DATA_DIR` ou `userData` apontando para uma pasta temporária.

**Servidor (I1, I7, D7, B1 pela metade).** Um script Node importa `server/index.js`, chama `createServer({})` e fala com a API por `fetch` com o cabeçalho `x-texugo-token`. Saída relevante:

```
"noToken": 401, "readBeforeOpen": 403, "readOutside": 403, "readTraversal": 403
"symlink": { "wasLink": true, "stillLink": false, "sharedHasB": false }
"modeAfterWrite": "644"
"symlinkDirEscape": { "status": 200, "text": "SECRET\n" }
"createProjectTraversal": { "status": 200, "existsOutsideParent": true }
"wsNoToken": "error", "wsForeignOriginWithToken": "open"
"cspHeader": null, "nosniff": null
"fileHtml": { "status": 200, "type": "text/html; charset=utf-8", "csp": null }
"afterClose": "FETCH FAILED: ECONNREFUSED"
```

**Electron (B1, B2).** Esqueleto do roteiro, reaproveitável no teste de fumaça do item 2:

```js
// main.mjs, numa pasta com package.json { "type": "module", "main": "main.mjs" }
import { app, BrowserWindow } from 'electron';
app.setPath('userData', PERFIL_TEMPORARIO);       // antes de importar o app
// state.json do perfil: { settings: { grammar: false, reopenLast: false } }
process.argv.push(PASTA_DO_PROJETO);              // sem "electron" no caminho
await import('<repo>/electron/main.js');
app.whenReady().then(async () => {                // nunca "await app.whenReady()" no topo
  await new Promise((r) => setTimeout(r, 5000));
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await js(`document.querySelector('.cm-content').focus()`);
  win.webContents.focus();
  await win.webContents.insertText('UNSAVED ');   // suja a aba
  win.close();                                     // B1: a janela não fecha, sem diálogo
  app.quit();                                      // B1: before-quit derruba o servidor
  // B2: document.querySelector('.brand').click(), depois clicar num .recent
  app.exit(0);
});
```

**Git (I4).** Repositório `--bare` como remoto, clones A e B. B publica uma mudança; A põe `paper.tex` no commit, deixa `refs.bib` modificado fora dele e chama `sync(A, '')`. Segundo caso: `git remote set-url origin <caminho inexistente>`.

**latexmkrc (B4).** Projeto mínimo com `\ref{missing}`; um caso com `.latexmkrc` contendo `$bibtex_use = 2;`, outro com `latexmkrc` contendo `$out_dir = "build";`. `new BuildManager().request(...)` e ler o evento `build:done`.

**Desempenho.** Projeto sintético: um paper com 40 seções de 120 parágrafos, `.bib` de 1.500 entradas e 6.000 tabelas `.tex` em `output/`.

| Operação | Tempo |
|---|---|
| `listTree` | 69 ms |
| `listDocuments` | 89 ms |
| `rootsFor` (por aba aberta) | 81 a 111 ms |
| `projectSymbols` (a cada salvamento e compilação) | 277 ms |
| `gitStatus` com 6.000 arquivos não rastreados | 91 ms |
| `news()` com 120 commits de coautor | 1.479 ms, cerca de 360 processos |

**Tradução (I9).** O script importa `tr` e `setLang('en')` de `web/src/i18n.js` (com `document` simulado), extrai os literais de `web/src`, `server` e `electron` que têm acento ou palavras comuns do português, troca as interpolações por valores de teste e conta os que `tr()` devolve sem mudar. Falsos positivos a pôr na lista de exceções: `web/src/replication.js` e `web/src/sent.js` (usam `L(pt, en)`), as palavras-chave de `web/src/palette.js`, os rótulos de menu de `electron/main.js` (traduzidos por `MENU_EN`), as regras de vícios e os prompts.

**Dependências.** `npm view electron dist-tags.latest` devolveu 45.3.0; `npm audit`: 2 altos (`electron`, `extract-zip`) e 2 moderados (`esbuild`, `katex`).

# Apêndice B. O que sai do computador (base para a página de privacidade)

| Destino | Quando | O que vai | Como evitar |
|---|---|---|---|
| Anthropic, pelo Claude Code do usuário | Ações de IA no texto, painel do agente, parecer, resposta aos pareceristas | O trecho e o contexto; no parecer, o paper inteiro; na resposta, os pareceres colados; tudo o que o agente ler | Não usar os recursos de IA |
| Crossref (`api.crossref.org`) | Adicionar referência, verificar referências | DOI, título e primeiro autor de cada entrada | Não usar esses dois recursos |
| OpenAlex (`api.openalex.org`) | Os mesmos | Título | Idem |
| arXiv (`export.arxiv.org`) | Adicionar referência por identificador do arXiv | O identificador | Idem |
| LanguageTool online (`api.languagetool.org`) | Só se escolhido nas Preferências | Os parágrafos do texto | O padrão é o servidor local |
| Remoto do Git (GitHub ou outro) | Ao abrir o projeto (`fetch`), e em pull, push, sincronizar e clonar | O que o Git manda normalmente | Projeto sem remoto |
| Espelhos do TeX Live | Médico do TeX: achar e instalar pacote | Nomes de pacotes | Não usar |
| Homebrew | Instalar o LanguageTool pelo botão | O que o `brew` manda | Instalar à mão |
| Google (dicionários do Chromium) | Windows e Linux, na primeira vez que o verificador ortográfico do Chromium é usado | Pedido de download do dicionário | Desligar `spellcheck` no Electron |
| Planejados: GitHub Releases (item 6), `languagetool.org` (item 1), Overleaf (item 3) | Checar atualização; baixar n-gramas; sincronizar | IP e versão; pedido de download; o projeto | Opções para desligar |

O cabeçalho `User-Agent` das consultas a Crossref, OpenAlex e arXiv é `TeXugo (LaTeX editor; https://github.com/FredieDidier/TeXugo)`: identifica o app, não o usuário.

O que fica no computador:

- `state.json` na pasta de dados do app: projetos recentes, preferências, dicionário pessoal.
- A biblioteca de papers (PDFs e o texto extraído) na pasta de dados do app.
- `.texugo/` em cada projeto, fora do Git: prévia ao vivo, PDFs de diferenças, versões enviadas, pareceres gerados, estado das anotações e do checklist de replicação.
- `.git/texugo-visit.json`: a marca da última visita.
- `~/.claude/ide/<porta>.lock`, enquanto um Claude Code está ligado ao app.
- `.texugo-comments/` em cada projeto. **Vai junto no commit**, hoje com nome e e-mail do autor (item 7).
