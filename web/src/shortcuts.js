// "Atalhos e comandos": every shortcut, what it does, and where else to find
// the same thing (menu, button, icon), with a search. Opened with ⌘? (⇧⌘/),
// the Ajuda menu, the command palette and the home screen.
import { h, clear, icon, modal } from './dom.js';
import { tr } from './i18n.js';

// [what it does, shortcut or '', where else]
export const SECTIONS = [
  {
    title: 'Achar qualquer coisa',
    rows: [
      ['Paleta de comandos: a caixa “Buscar arquivo ou comando” no topo. Digite o nome de qualquer comando e dê Enter', '⌘K', 'Também ⇧⌘P; menu Visualizar → Paleta de comandos'],
      ['Abrir um arquivo do projeto pelo nome', '⌘P', 'Menu Arquivo → Abrir arquivo rápido; barra de busca no topo'],
      ['Buscar texto em todo o projeto', '⇧⌘F', 'Ícone da lupa na barra da esquerda'],
      ['Buscar e substituir no arquivo', '⌘F', 'Dentro do editor; ⌘G vai para a próxima, ⇧⌘G para a anterior'],
      ['Ir para a linha', '⌃G', 'Digite “:42” na paleta; clique em “Ln, Col” na barra de status; ⌥⌘G dentro do editor'],
      ['Andar entre as áreas (arquivos, editor, PDF, painel inferior) só com o teclado', 'F6', 'Tab percorre os botões; as setas andam nas listas, nas abas e nos menus; Esc fecha'],
      ['Estes atalhos', '⌘?', 'Menu Ajuda; paleta: “Atalhos”; tela inicial'],
    ],
  },
  {
    title: 'Compilar e PDF',
    rows: [
      ['Compilar o documento da aba', '⌘↵', 'Botão Compilar acima do editor; menu Compilar'],
      ['Compilar todos os documentos abertos (paper + apêndice)', '⇧⌘↵', 'Botão “Compilar tudo” no topo'],
      ['Compilar do zero (apaga auxiliares)', '', 'Seta ao lado de Compilar'],
      ['Compilar ao salvar', '', 'Chave “ao salvar” ao lado de Compilar'],
      ['Prévia ao vivo (o PDF segue o que você digita, sem salvar)', '', 'Chave “ao vivo” ao lado de Compilar; paleta: “prévia ao vivo”'],
      ['Corretor gramatical: lista dos erros do arquivo', '', 'Barra de status, à direita (“sem erros” ou a contagem); paleta: “corretor”'],
      ['Mostrar no PDF a linha do cursor', '⌘J', 'Menu Compilar → Mostrar no PDF'],
      ['Ir do PDF para o código', 'clique duplo', 'No trecho do PDF; funciona até em PDF compilado fora do TeXugo'],
      ['PDF em janela separada, modo escuro, apresentação', '', 'Botões na barra do PDF'],
      ['Parar a compilação', '', 'Paleta: “Parar compilação”'],
    ],
  },
  {
    title: 'Escrever',
    rows: [
      ['Negrito (\\textbf)', '⌘B', 'Barra que aparece ao selecionar texto: B'],
      ['Itálico (\\emph)', '⌘I', 'Barra da seleção: I'],
      ['Comentar ou descomentar linhas (%)', '⌘/', 'Barra da seleção: %'],
      ['Desfazer / refazer', '⌘Z / ⇧⌘Z', 'Menu Editar'],
      ['Completar \\cite, \\ref, \\label e comandos', 'digite', 'Escreva \\cite{ ou \\ref{ e escolha na lista; ↵ aceita'],
      ['Ver a referência de uma citação', 'passar o mouse', 'Sobre a chave dentro de \\cite{…}'],
      ['Ver a equação desenhada', 'cursor na fórmula', 'Aparece acima de $…$, \\[…\\], equation, align…; desliga em Preferências'],
      ['Adicionar referência (DOI, link, título)', '⌥⌘R', 'Seta ao lado de Compilar; + na aba Referências'],
      ['Colar tabela do Excel como LaTeX', '⌘V', 'Cole células num .tex; para CSV, paleta: “Colar tabela”'],
      ['Formatar documento (indentação)', '⌥⇧F', 'Seta ao lado de Compilar'],
      ['Selecionar a próxima ocorrência da palavra', '⌘D', 'Dentro do editor'],
    ],
  },
  {
    title: 'Abas e janelas',
    rows: [
      ['Salvar / salvar todos', '⌘S / ⌥⌘S', 'Menu Arquivo'],
      ['Fechar aba', '⌘W', 'X na aba'],
      ['Ir para a aba 1 a 9', '⌘1 … ⌘9', ''],
      ['Próxima / anterior aba', '⌃⇥ / ⌃⇧⇥', ''],
      ['Dividir o editor (outro arquivo ou trecho ao lado)', '⌥⌘\\', 'Botão de colunas acima do editor'],
      ['Mostrar / esconder a barra lateral', '⌘\\', 'Clique no ícone ativo da barra da esquerda'],
      ['Arquivos', '⇧⌘E', 'Primeiro ícone da barra da esquerda'],
      ['Painel inferior (log, problemas, terminal)', '⇧⌘Y', 'Menu Visualizar'],
      ['Terminal na pasta do projeto', '⌃`', 'Painel inferior → Terminal'],
      ['Nova janela / fechar janela', '⌥⌘N / ⇧⌘W', 'Menu Arquivo'],
      ['Preferências', '⌘,', 'Engrenagem no topo à direita'],
    ],
  },
  {
    title: 'Projeto',
    rows: [
      ['Novo projeto a partir de modelo', '⇧⌘N', '+ na barra da esquerda; tela inicial'],
      ['Abrir pasta', '⌘O', 'Tela inicial; menu Arquivo'],
      ['Tela inicial (modelos, recentes)', '', 'Ícone da casa na barra da esquerda; clique no logo'],
      ['Estrutura do documento (seções)', '', 'Segundo ícone da barra da esquerda'],
      ['Referências do .bib, verificar no Crossref', '', 'Ícone do livro na barra da esquerda'],
      ['Importar do Zotero ou de um .bib exportado', '', 'Seta para baixo na aba Referências; paleta: “Zotero”'],
      ['Biblioteca de papers: ler e buscar no texto de todos os PDFs', '⌥⌘B', 'Menu Visualizar; paleta: “biblioteca”'],
      ['Git: commit (mensagem opcional), sincronizar, pull, push', '', 'Ícone do Git na barra da esquerda'],
      ['Problemas da compilação', '', 'Ícone de alerta embaixo, na barra da esquerda'],
    ],
  },
  {
    title: 'Revisar e submeter',
    rows: [
      ['Tudo da revisão num lugar: coautores, pareceristas, antes de enviar', '', 'Ícone da prancheta na barra da esquerda; seta ao lado de Compilar → Revisão e submissão'],
      ['Revisar como parecerista (parecer do Claude, ponto a ponto)', '', 'Aba Revisão (barra da esquerda); lista na aba Parecer do painel inferior'],
      ['Resposta aos pareceristas (response.tex ligado às mudanças)', '', 'Aba Revisão; paleta: “Resposta”'],
      ['Abrir a linha citada como arquivo.tex:123', '⌘-clique', 'Em comentários do response.tex, logs e notas'],
      ['Anotações do PDF (suas ou do coautor), ligadas ao .tex', '', 'Aba Revisão; lista na aba Anotações do painel inferior'],
      ['Comparar com outra versão (PDF com mudanças marcadas)', '', 'Aba Revisão'],
      ['Marcar a versão enviada e ler o retorno contra ela (sugestões: aplica direto, já no texto, conflito, sumiu)', '', 'Aba Revisão → Versões enviadas; aba Sugestões no painel de baixo; paleta: “enviada”, “retorno”'],
      ['Mandar um ZIP para o Overleaf e ler o ZIP que voltar (coautor sem Git)', '', 'Aba Revisão → Coautor no Overleaf; paleta: “Overleaf”'],
      ['Comentar o trecho selecionado (vai para os coautores com o commit)', '⌥⌘M', 'Barra da seleção: 💬; botão direito; aba Comentários do painel inferior'],
      ['Comentários no texto: responder, resolver, ir ao trecho', '', 'Passe o mouse no trecho marcado; aba Comentários; aba Revisão'],
      ['Novidades dos coautores desde a sua última visita (por pessoa e por seção)', '', 'Aba Revisão; aba Novidades no painel de baixo; paleta: “novidades”'],
      ['Quem escreveu cada trecho (iniciais na margem; clique para ver o commit)', '', 'Ícone de pessoas acima do editor; aba Revisão; paleta: “autoria”'],
      ['Checar antes de submeter (anonimato, fontes Type 3)', '', 'Aba Revisão'],
      ['Exportar ZIP para submissão', '', 'Aba Revisão'],
      ['Pacote de replicação: checklist da revista (DCAS) e rascunho do README', '', 'Aba Revisão; aba Replicação no painel de baixo; paleta: “replicação”'],
      ['Vícios de escrita (tiques de IA)', '', 'Contador “vícios” na barra de status; aba Revisão'],
      ['Revisar estilo (ChkTeX) / contar palavras', '', 'Aba Revisão'],
      ['Médico do TeX (pacotes que faltam)', '', 'Seta ao lado de Compilar'],
      ['Verificar instalação (TeX, Git, agente de IA, corretor)', '', 'Ajuda → Verificar instalação; paleta'],
    ],
  },
  {
    title: 'Agente',
    rows: [
      ['Conversar com o agente sobre o projeto', '', 'Ícone ✻ na barra da esquerda'],
      ['Escolher o agente (Claude Code, Codex, Gemini CLI, OpenCode)', '', 'Topo do painel do agente'],
      ['Perguntar ao agente sobre o trecho selecionado', '', 'Barra da seleção: ✻ Claude'],
      ['Reescrever a seleção (polir, encurtar, traduzir…)', '', 'Botão direito na seleção; barra da seleção'],
      ['Escolher modelo e esforço', '', 'Menus embaixo, no painel do agente'],
      ['O agente completo no terminal', '', 'Botão Terminal no painel do agente'],
    ],
  },
];

export function shortcutsDialog() {
  if (document.querySelector('.shortcuts-modal')) return;
  const q = h('input', { placeholder: 'Buscar: compilar, PDF, citação, Git…', style: { width: '100%' } });
  const list = h('div', { class: 'shortcuts' });
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const render = () => {
    const words = norm(q.value).split(/\s+/).filter(Boolean);
    const match = (r) => {
      const searchable = norm([...r, ...r.map(tr)].join(' '));
      return words.every((w) => searchable.includes(w));
    };
    const secs = SECTIONS.map((s) => ({ ...s, rows: s.rows.filter(match) })).filter((s) => s.rows.length);
    clear(
      list,
      secs.length
        ? secs.map((s) =>
            h(
              'div',
              { class: 'sc-sec' },
              h('h4', {}, s.title),
              s.rows.map(([what, keys, where]) =>
                h('div', { class: 'sc-row' }, h('div', { class: 'sc-what' }, what, where ? h('div', { class: 'sc-where' }, where) : null), h('div', { class: 'sc-keys' }, keys ? keys.split(' / ').map((k, i) => [i ? h('span', { class: 'faint' }, ' / ') : null, h('kbd', {}, k)]) : null)),
              ),
            ),
          )
        : h('p', { class: 'faint' }, 'Nada encontrado. A paleta (⌘K) busca em todos os comandos.'),
    );
  };
  q.addEventListener('input', render);
  render();
  const hint = h('p', { class: 'faint sc-hint' }, 'Onde está escrito “paleta: …”, aperte ⌘K (ou clique na caixa de busca no topo), digite a palavra entre aspas e dê Enter.');
  const m = modal({ title: [icon('command'), ' Atalhos e comandos'], wide: true, body: h('div', {}, q, hint, list) });
  m.el.classList.add('shortcuts-modal');
  setTimeout(() => q.focus(), 0);
}
