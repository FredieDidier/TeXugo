// Catalogue of writing tics ("vícios"), English and Portuguese.
//
// Every rule names its source (SOURCES below). The list is a set of
// CANDIDATES for a second look, never proof that a text was machine-written:
// each pattern also occurs in human prose, and the counts matter more than
// any single hit. Update VERSION and the sources when the list is revised.
//
// TWIN DOCUMENT: the same catalogue, written for a writer rather than for a
// regex, is section 1 of the applied-micro-paper-writing skill
// (~/.claude/skills/applied-micro-paper-writing/SKILL.md, "The catalogue of
// tells is dated"). They are kept as two documents on purpose. When one
// changes, change the other in the same session and move both dates.
//
// Left out on purpose: "does not by itself establish" (a 2026 chatbot hedge
// per Wikipedia, but also correct econometrics after a test); the skill says
// how to judge it in context.
//
// Fields: id, cat (category), lang ('en' | 'pt' | '*'), re (applied to the
// prose layer named by `layer`, default 'words'), pt/en (what and why),
// fix/fixEn (what to do instead), src (keys of SOURCES), era (when the
// pattern peaked, if known), min (flag only when the file has at least this
// many hits of the rule), per (flag only when hits exceed one per `per`
// words).

export const VERSION = '2026-11';

export const SOURCES = {
  W: { t: 'Wikipedia: Signs of AI writing (WikiProject AI Cleanup), versão de out./2026', en: 'Wikipedia: Signs of AI writing (WikiProject AI Cleanup), version of Oct. 2026', url: 'https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing' },
  K: { t: 'Kobak et al., “Delving into LLM-assisted writing in biomedical publications through excess vocabulary”, Science Advances (2025); lista de 900 palavras atualizada em jul./2025', en: 'Kobak et al., “Delving into LLM-assisted writing in biomedical publications through excess vocabulary”, Science Advances (2025); list of 900 words updated in Jul. 2025', url: 'https://github.com/berenslab/llm-excess-vocab' },
  A: { t: 'Abraham, “The load-bearing vocabulary of Claude” (ago./2026): vocabulário que foi de 0,7% a ~39% das descrições de pull request no GitHub', en: 'Abraham, “The load-bearing vocabulary of Claude” (Aug. 2026): vocabulary that went from 0.7% to ~39% of pull request descriptions on GitHub', url: 'https://news.ycombinator.com/item?id=49461817' },
  U: { t: 'Unslop style guide (abr./2026)', en: 'Unslop style guide (Apr. 2026)', url: 'https://github.com/dbohdan/unslop/blob/master/style-guide/unslop-style-guide.md' },
  S: { t: 'Guia de escrita de artigos de economia aplicada (skills applied-micro-paper-writing e manuscript-audit)', en: 'Writing guide for applied economics papers (skills applied-micro-paper-writing and manuscript-audit)', url: null },
  P: { t: 'Fontes em português: SEO Happy Hour sobre o estudo da Search Engine Land (2025); Doutora Nathália, “Como avaliar texto escrito por IA”; Fast Company Brasil (2025)', en: 'Sources in Portuguese: SEO Happy Hour on the Search Engine Land study (2025); Doutora Nathália, “Como avaliar texto escrito por IA”; Fast Company Brasil (2025)', url: 'https://www.seohappyhour.com/noticias/vicio-escrita-ia-estudo/' },
  E: { t: 'Equivalente em português de um padrão documentado em inglês (adaptação do TeXugo; não há estudo quantitativo em português)', en: 'Portuguese equivalent of a pattern documented in English (TeXugo’s adaptation; there is no quantitative study in Portuguese)', url: null },
  C: { t: 'Decalques comuns entre português e inglês na escrita acadêmica (lista do TeXugo)', en: 'Common calques between Portuguese and English in academic writing (TeXugo’s list)', url: null },
};

export const CATEGORIES = {
  travessao: { pt: 'Travessão', en: 'Em dash' },
  vocab: { pt: 'Vocabulário de IA', en: 'AI vocabulary' },
  enfase: { pt: 'Importância inflada', en: 'Inflated significance' },
  copula: { pt: 'Evita o verbo “ser”', en: 'Avoids “is”' },
  gerundio: { pt: 'Comentário no gerúndio', en: 'Trailing -ing comment' },
  anuncio: { pt: 'Texto que anuncia a si mesmo', en: 'Self-announcing text' },
  conector: { pt: 'Conector de abertura', en: 'Stock opener' },
  paralelismo: { pt: 'Paralelismo negativo', en: 'Negative parallelism' },
  pergunta: { pt: 'Pergunta que se responde', en: 'Self-answered question' },
  fecho: { pt: 'Conclusão anunciada', en: 'Signposted conclusion' },
  cautela: { pt: 'Ressalva de chatbot', en: 'Chatbot hedge' },
  conversa: { pt: 'Resto de conversa', en: 'Chat leftover' },
  markdown: { pt: 'Markdown colado', en: 'Pasted Markdown' },
  decalque: { pt: 'Decalque', en: 'Calque' },
  pontuacao: { pt: 'Pontuação e maiúsculas', en: 'Punctuation and case' },
  ritmo: { pt: 'Ritmo das frases', en: 'Sentence rhythm' },
};

// Unicode word boundaries (JS \b is ASCII-only), and any run of white space
// where the pattern has a space, since commands and line breaks leave gaps.
const L = '\\p{L}\\p{N}_';
const sp = (p) => p.replace(/ /g, '\\s+');
// A single hyphen glues compounds (well-crafted); a dash (--, ---) does not.
const word = (p, flags = 'giu') => new RegExp(`(?<![${L}])(?<!(?<!-)-)(?:${sp(p)})(?![${L}])(?!-(?!-))`, flags);
// At the start of a sentence (after . ! ? or a blank line).
// After a comma (the comma is part of the match, trimmed from the hit).
const afterComma = (p) => new RegExp(`,\\s+(?:${sp(p)})(?![${L}])`, 'giu');
const start = (p, flags = 'giu') => new RegExp(`(?<=^\\s*|[.!?]["'”’)]?\\s+|\\n[ \\t]*\\n\\s*)(?:${sp(p)})(?![${L}])`, flags);

const R = [];
const rule = (o) => R.push(o);

// ------------------------------------------------------------------ em dash
rule({
  id: 'travessao', cat: 'travessao', lang: '*', layer: 'punct',
  re: /—|(?<![-!])---(?!-)|\\textemdash(?![a-zA-Z])/g,
  pt: 'Travessão. Os modelos o usaram em excesso de 2022 a 2026, no lugar de vírgula, parênteses ou dois-pontos.',
  en: 'Em dash. Models overused it from 2022 to 2026, where a person would write a comma, parentheses or a colon.',
  fix: 'Troque por vírgula, parênteses, dois-pontos ou ponto final.', fixEn: 'Use a comma, parentheses, a colon or a full stop.',
  src: 'WS',
});

// ------------------------------------------------------------- vocabulary EN
const vocabEn = [
  ['delv(?:e|es|ed|ing)', '2023–24 (GPT-4); caiu muito em 2025', 'WK'],
  ['tapestry', '2023–24 (GPT-4)', 'WKU'],
  ['(?:a |is a |stands as a )?testament to', '2023–24 (GPT-4)', 'WU'],
  ['underscor(?:e|es|ed|ing)', '2023–26', 'WKU'],
  ['showcas(?:e|es|ed|ing)', '2024–26 (GPT-4o, GPT-5)', 'WK'],
  ['pivotal', '2023–25', 'WKU'],
  ['intricate(?:ly)?|intricacies', '2023–24', 'WKU'],
  ['meticulous(?:ly)?', '2023–24', 'WK'],
  ['commendable|noteworthy|invaluable|unparalleled|groundbreaking|transformative|burgeoning', null, 'K'],
  ['realms?', null, 'K'],
  ['elucidat(?:e|es|ed|ing)', null, 'K'],
  ['interplay', '2023–24', 'WK'],
  ['multifaceted', 'a partir de meados de 2026', 'WKU'],
  ['pav(?:e|es|ed|ing) the way', null, 'K'],
  ['uncharted|underexplored', null, 'K'],
  ['shed(?:s|ding)? (?:new |some |further )?light on', null, 'K'],
  ['valuable insights?|a deeper understanding|nuanced understanding', null, 'W'],
  ['(?:evolving|ever-evolving|changing|complex|broader|research|policy|regulatory|academic|digital|economic) landscape', null, 'WU'],
  ['boasts?', '2023–24', 'W'],
  ['garner(?:s|ed|ing)?', '2023–24', 'WK'],
  ['bolster(?:s|ed|ing)?', '2023–25', 'WK'],
  ['foster(?:s|ed|ing)?', '2024–25 e de novo em 2026', 'WKU'],
  ['leverag(?:e|es|ed|ing) (?:the|this|these|our|their|its|existing|a|an|such)', 'verbo; de novo em 2026', 'WKU'],
  ['harness(?:es|ed|ing)? (?:the|this|these|its|their|our)', null, 'KU'],
  ['streamlin(?:e|es|ed|ing)|seamless(?:ly)?', null, 'KU'],
  ['robust (?:evidence|framework|approach|understanding|foundation|insights?|analysis|body of)', 'como elogio, não como propriedade técnica', 'WKS'],
  ['crucial(?:ly)?', '2023–25', 'WKU'],
  ['vibrant', '2023–25', 'W'],
  ['enduring', '2023–25', 'WK'],
  ['enhanc(?:e|es|ed|ing)', '2024–26 (GPT-4o, GPT-5)', 'WKU'],
  ['align(?:s|ed)? with', '2024–25 (GPT-4o)', 'WK'],
  ['resonat(?:e|es|ed|ing) with', null, 'WU'],
  ['load-bearing', '2025–26 (Claude)', 'A'],
  ['genuinely', '2025–26 (Claude)', 'AU'],
  ['quietly', '2025–26 (Claude, GPT-6)', 'AWU'],
  ['remarkably', null, 'U'],
  ['dependable|universally|echoed', 'a partir de meados de 2026', 'W'],
];
for (const [p, era, src] of vocabEn) {
  rule({
    id: 'vocab-en', cat: 'vocab', lang: 'en', re: word(p), era, src,
    pt: 'Palavra que os modelos de linguagem usam muito mais que pessoas.',
    en: 'A word language models use far more than people do.',
    fix: 'Diga a coisa em palavras simples, ou corte.', fixEn: 'Say it in plain words, or cut it.',
  });
}

rule({
  id: 'matters-en', cat: 'vocab', lang: 'en', src: 'W', era: 'a partir de meados de 2026',
  re: new RegExp(`${start('(?:And )?(?:this|that|it) matters\\.').source}|${word("(?:why|here's why) (?:this|it) matters|this matters because").source}`, 'giu'),
  pt: '“This matters.” / “Here’s why it matters”: fecho de efeito do vocabulário dos modelos de 2026.',
  en: '“This matters.” / “Here’s why it matters”: a punchline from the 2026 model vocabulary.',
  fix: 'Diga por que importa, com o fato.', fixEn: 'Say why it matters, with the fact.',
});

// -------------------------------------------------------------- vocabulary PT
const vocabPt = [
  ['mergulh(?:ar|a|am|amos|aremos|ando|ou)(?: fundo)? (?:em|no|na|nos|nas)', 'E'],
  ['aprofund(?:ar|a|am)-se|aprofundar-nos', 'E'],
  ['tapeçaria', 'E'],
  ['(?:é |são |constitui |representa )?(?:um )?testemunho (?:de|do|da|dos|das)', 'E'],
  ['sublinh(?:a|am|ar|ando|ou)', 'E'],
  ['crucia(?:l|is)|crucialmente', 'PE'],
  ['intrincad[oa]s?', 'E'],
  ['meticulos[oa]s?|meticulosamente', 'E'],
  ['inestimáve(?:l|is)|sem precedentes|revolucionári[oa]s?|transformador(?:a|es|as)?', 'E'],
  ['potencializ(?:ar|a|am|ando|ou)|alavanc(?:ar|a|am|ando|ou)|fomenta(?:r|m|ndo)?|impulsion(?:ar|a|am|ando)|catalis(?:ar|a|am|ador|adora)', 'E'],
  ['sinergias?|holístic[oa]s?|jornadas?', 'E'],
  ['ecossistemas? (?:de|digital|digitais|educacional|empreendedor|de inovação)', 'PE'],
  ['multifacetad[oa]s?', 'E'],
  ['(?:panorama|cenário)s? (?:atual|atuais|complexo|complexos|dinâmico|desafiador|contemporâneo|em constante)', 'PE'],
  ['em constante (?:evolução|transformação|mudança)', 'P'],
  ['(?:lança|lançar|lançando|joga|jogar|jogando) (?:nova |uma nova )?luz (?:sobre|em)', 'EC'],
  ['insights? valiosos?|valiosos? insights?|compreensão mais profunda|compreensão (?:mais )?abrangente', 'E'],
  ['robust[oa]s? (?:evidência|evidências|base|arcabouço|compreensão|abordagem)', 'ES'],
  ['vibrantes?', 'E'],
];
for (const [p, src] of vocabPt) {
  rule({
    id: 'vocab-pt', cat: 'vocab', lang: 'pt', re: word(p), src,
    pt: 'Palavra típica de texto gerado por IA em português (quase sempre tradução do vocabulário que os modelos usam em inglês).',
    en: 'A word typical of AI-generated Portuguese (usually a translation of the vocabulary models use in English).',
    fix: 'Use a palavra comum, ou corte.', fixEn: 'Use the ordinary word, or cut it.',
  });
}

// ------------------------------------------------------ inflated significance
rule({
  id: 'enfase-en', cat: 'enfase', lang: 'en', src: 'W',
  re: word('(?:plays?|played|playing) an? (?:crucial|pivotal|vital|key|significant|central|important|critical|major) role|(?:underscores|highlights|emphasizes|reflects) (?:the|its|their) (?:importance|significance|need)|reflects? (?:a )?broader|setting the stage for|marks? a (?:shift|turning point|new era)|(?:a )?key turning point|indelible mark|deeply rooted|enduring legacy|focal point|in today\'s (?:fast-paced|rapidly|ever|world)|ever-(?:evolving|changing)|rapidly evolving'),
  pt: 'Ênfase genérica na importância do assunto, sem dizer qual é a importância.',
  en: 'Generic emphasis on importance that never says what the importance is.',
  fix: 'Troque pelo fato concreto (quanto, quem, quando).', fixEn: 'Replace with the concrete fact (how much, who, when).',
});
rule({
  id: 'enfase-pt', cat: 'enfase', lang: 'pt', src: 'WEP',
  re: word('desempenh(?:a|am|ou|aram|ar|ando) (?:um )?papel (?:crucial|fundamental|central|vital|essencial|chave|importante|decisivo|preponderante|significativo)|papel (?:crucial|fundamental|central|vital) (?:na|no|em|para|nas|nos)|(?:é|são|foi|representa|representou|constitui) um (?:verdadeiro )?marco|divisor de águas|(?:ressalta|sublinha|destaca|evidencia|reforça)(?:m|r)? a (?:importância|relevância|necessidade)|reflete(?:m)? (?:uma )?(?:tendência|transformação|mudança)s? mais amplas?|marca indelével|profundamente enraizad[oa]s?|legado duradouro|ponto de virada|nos dias (?:de hoje|atuais)|no mundo (?:atual|contemporâneo|moderno)|em um mundo cada vez mais'),
  pt: 'Ênfase genérica na importância do assunto, sem dizer qual é a importância.',
  en: 'Generic emphasis on importance that never says what the importance is.',
  fix: 'Troque pelo fato concreto (quanto, quem, quando).', fixEn: 'Replace with the concrete fact (how much, who, when).',
});

// ------------------------------------------------------------ copula avoidance
rule({
  id: 'copula-en', cat: 'copula', lang: 'en', src: 'WU',
  re: word('(?:serves?|served|serving|stands?|stood) as (?:a|an|the)|functions as (?:a|an)'),
  pt: '“Serves as”/“stands as” no lugar de “is”: os modelos evitam o verbo simples.',
  en: '“Serves as”/“stands as” instead of “is”: models avoid the plain verb.',
  fix: 'Use “is”.', fixEn: 'Use “is”.',
});
rule({
  id: 'copula-pt', cat: 'copula', lang: 'pt', src: 'E',
  re: word('(?:serve|servem|serviu|serviram) como (?:um|uma|o|a)|(?:se )?destaca(?:m)?-se como|(?:se )?configura(?:m)?-se como|(?:se )?destaca(?:m)? como (?:um|uma)'),
  pt: '“Serve como”/“destaca-se como” no lugar de “é”.',
  en: '“Serve como”/“destaca-se como” instead of “é”.',
  fix: 'Use “é”.', fixEn: 'Use “é”.',
});

// --------------------------------------------------- trailing -ing commentary
rule({
  id: 'gerundio-en', cat: 'gerundio', lang: 'en', src: 'WU',
  re: afterComma('(?:highlighting|underscoring|emphasizing|emphasising|reflecting|symbolizing|showcasing|ensuring|fostering|cultivating|contributing to|paving the way|underlining|signaling|signalling|reinforcing|illustrating)'),
  pt: 'Oração no gerúndio no fim da frase comentando o que a frase “mostra”: análise rasa típica de IA.',
  en: 'A trailing -ing clause commenting on what the sentence “shows”: a typical shallow AI analysis.',
  fix: 'Corte, ou transforme numa afirmação com sujeito e evidência.', fixEn: 'Cut it, or make it a claim with a subject and evidence.',
});
rule({
  id: 'gerundio-pt', cat: 'gerundio', lang: 'pt', src: 'WE',
  re: afterComma('(?:destacando|ressaltando|evidenciando|sublinhando|reforçando|refletindo|simbolizando|garantindo|assegurando|contribuindo para|promovendo|fomentando|consolidando|enfatizando|pavimentando|ilustrando|sinalizando)'),
  pt: 'Gerúndio no fim da frase comentando o que ela “mostra”: análise rasa típica de IA.',
  en: 'A trailing gerund commenting on what the sentence “shows”: a typical shallow AI analysis.',
  fix: 'Corte, ou transforme numa afirmação com sujeito e evidência.', fixEn: 'Cut it, or make it a claim with a subject and evidence.',
});

// ------------------------------------------------------ self-announcing text
rule({
  id: 'anuncio-en', cat: 'anuncio', lang: 'en', src: 'WSU',
  re: word('it (?:is|\'s) (?:important|worth|crucial|essential|interesting) to (?:note|mention|emphasize|emphasise|highlight|point out|stress|recognize|remember)|(?:it is |it\'s )?worth (?:noting|mentioning|emphasizing|stressing|highlighting|naming|reporting)|deserves? (?:mention|naming|attention|emphasis)|it should be noted that|which is the point|let\'s (?:dive|delve|explore|take a closer look|unpack)|here\'s (?:the thing|why|what)|the (?:key|short) (?:takeaway|answer) is|bears mentioning'),
  pt: 'O texto comenta o próprio texto (“vale notar que”) em vez de dizer a coisa.',
  en: 'The text comments on itself (“it is worth noting”) instead of saying the thing.',
  fix: 'Apague o anúncio e comece pelo conteúdo.', fixEn: 'Delete the announcement and start with the content.',
});
rule({
  id: 'anuncio-pt', cat: 'anuncio', lang: 'pt', src: 'PSE',
  re: word('(?:é|e) (?:importante|fundamental|crucial|essencial|válido|interessante|relevante) (?:notar|destacar|ressaltar|mencionar|observar|enfatizar|salientar|lembrar|frisar|sublinhar)|vale (?:a pena )?(?:notar|ressaltar|destacar|mencionar|lembrar|frisar|salientar|observar|sublinhar)|cabe (?:destacar|ressaltar|mencionar|salientar|notar|observar|frisar)|convém (?:destacar|ressaltar|lembrar|notar|frisar)|merece(?:m)? (?:destaque|atenção|menção)|é digno de nota|vamos (?:explorar|mergulhar|analisar|entender)|o pulo do gato'),
  pt: 'O texto comenta o próprio texto (“vale ressaltar que”) em vez de dizer a coisa.',
  en: 'The text comments on itself (“vale ressaltar que”) instead of saying the thing.',
  fix: 'Apague o anúncio e comece pelo conteúdo.', fixEn: 'Delete the announcement and start with the content.',
});

// ----------------------------------------------------------- stock openers
rule({
  id: 'conector-en', cat: 'conector', lang: 'en', src: 'WS',
  re: start('(?:Additionally|Importantly|Notably|Crucially|Interestingly|Moreover, it is),'),
  pt: 'Conector de abertura que os modelos repetem; sozinho não prova nada, mas o acúmulo pesa.',
  en: 'A stock opener models repeat; alone it proves nothing, but they add up.',
  fix: 'Corte; a ligação com a frase anterior quase sempre fica clara sem ele.', fixEn: 'Cut it; the link to the previous sentence is usually clear without it.',
});
rule({
  id: 'conector-pt', cat: 'conector', lang: 'pt', src: 'PE',
  re: start('(?:Além disso|Adicionalmente|Notavelmente|Crucialmente|Curiosamente),'),
  pt: 'Conector de abertura que os modelos repetem (“Além disso,”); sozinho não prova nada, mas o acúmulo pesa.',
  en: 'A stock opener models repeat (“Além disso,”); alone it proves nothing, but they add up.',
  fix: 'Corte, ou ligue as frases pelo conteúdo.', fixEn: 'Cut it, or link the sentences through their content.',
});

// -------------------------------------------------------- negative parallelism
rule({
  id: 'paralelismo-en', cat: 'paralelismo', lang: 'en', src: 'WSU',
  re: word('not (?:just|only|merely|simply) [^.;!?]{1,80}?,? but(?: also)?|it(?:\'s| is) not (?:about )?[^.;!?]{1,50}?[,;—–]\\s*it(?:\'s| is)|(?:this|it) (?:isn\'t|is not|wasn\'t|was not) [^.!?]{1,50}\\. (?:it|this)(?:\'s| is| was)|not [^.!?]{1,30}\\. not [^.!?]{1,30}\\. (?:just|only)|no [^.,;]{1,20}, no [^.,;]{1,20}, just'),
  pt: '“Não só X, mas Y” / “não é X, é Y”: o tique de construção mais apontado em texto de IA.',
  en: '“Not just X, but Y” / “it’s not X, it’s Y”: the construction most often named as an AI tell.',
  fix: 'Afirme Y diretamente.', fixEn: 'State Y directly.',
});
rule({
  id: 'paralelismo-pt', cat: 'paralelismo', lang: 'pt', src: 'PWE',
  re: word('não (?:apenas|só|somente|meramente|simplesmente) [^.;!?]{1,80}?,? mas (?:também|sim)|não se trata (?:apenas |só )?de [^.;!?]{1,60}?[,;—–]\\s*(?:mas|trata-se)|não é (?:apenas |só )?[^.;!?,]{1,40}[,;—–]\\s*é|não [^.!?]{1,30}\\. não [^.!?]{1,30}\\. (?:apenas|só|somente)'),
  pt: '“Não só X, mas também Y” / “não é X, é Y”: o tique de construção mais apontado em texto de IA.',
  en: '“Não só X, mas também Y” / “não é X, é Y”: the construction most often named as an AI tell.',
  fix: 'Afirme Y diretamente.', fixEn: 'State Y directly.',
});
rule({
  id: 'rather-en', cat: 'paralelismo', lang: 'en', src: 'WS', per: 300,
  re: word('rather than'),
  pt: '“Rather than” acima de uma vez a cada 300 palavras: contraste em série, comum em texto de IA desde 2026.',
  en: '“Rather than” more than once per 300 words: serial contrast, common in AI text since 2026.',
  fix: 'Mantenha só os contrastes que o leitor precisa.', fixEn: 'Keep only the contrasts the reader needs.',
});
rule({
  id: 'rather-pt', cat: 'paralelismo', lang: 'pt', src: 'WSE', per: 300,
  re: word('em vez de|ao invés de|e não (?:o|a|os|as) '),
  pt: '“Em vez de” acima de uma vez a cada 300 palavras: contraste em série.',
  en: '“Em vez de” more than once per 300 words: serial contrast.',
  fix: 'Mantenha só os contrastes que o leitor precisa.', fixEn: 'Keep only the contrasts the reader needs.',
});

// ------------------------------------------------------ self-answered question
rule({
  id: 'pergunta-en', cat: 'pergunta', lang: 'en', src: 'U',
  re: start('(?:The|And the|So the) (?:result|answer|catch|kicker|twist|problem|reason|upshot|takeaway|verdict)\\?'),
  pt: 'Pergunta retórica respondida na hora (“The result? …”).',
  en: 'A rhetorical question answered at once (“The result? …”).',
  fix: 'Escreva a afirmação.', fixEn: 'Write the statement.',
});
rule({
  id: 'pergunta-pt', cat: 'pergunta', lang: 'pt', src: 'UE',
  re: start('(?:O resultado|A resposta|O problema|A razão|O motivo|A questão|O segredo)\\?'),
  pt: 'Pergunta retórica respondida na hora (“O resultado? …”).',
  en: 'A rhetorical question answered at once (“O resultado? …”).',
  fix: 'Escreva a afirmação.', fixEn: 'Write the statement.',
});

// ----------------------------------------------------- signposted conclusion
rule({
  id: 'fecho-en', cat: 'fecho', lang: 'en', src: 'WSU',
  re: start('(?:In summary|In conclusion|To summarize|To sum up|In essence|All in all|Overall|Ultimately),'),
  pt: 'Conclusão anunciada: o parágrafo termina repetindo o que já disse.',
  en: 'Signposted conclusion: the paragraph ends by restating itself.',
  fix: 'Corte a frase de resumo, ou termine no último fato novo.', fixEn: 'Cut the summary sentence, or end on the last new fact.',
});
rule({
  id: 'fecho-pt', cat: 'fecho', lang: 'pt', src: 'PWE',
  re: start('(?:Em (?:suma|resumo|síntese|conclusão)|Em última análise|Em linhas gerais|Diante do exposto|Conclui-se(?:, portanto,)? que|Por fim, conclui-se|Dessa forma, fica (?:claro|evidente)|Portanto, é (?:fundamental|essencial|crucial))'),
  pt: 'Conclusão anunciada (“Em suma”, “Conclui-se que”): o parágrafo termina repetindo o que já disse.',
  en: 'Signposted conclusion (“Em suma”, “Conclui-se que”): the paragraph ends by restating itself.',
  fix: 'Corte a frase de resumo, ou termine no último fato novo.', fixEn: 'Cut the summary sentence, or end on the last new fact.',
});

// ------------------------------------------- chatbot hedges (mid-2026 on)
rule({
  id: 'cautela-en', cat: 'cautela', lang: 'en', src: 'W', era: 'a partir de meados de 2026',
  re: word('based on (?:the )?available information|while specific details (?:are|remain) (?:limited|scarce)|not widely (?:documented|available|disclosed|reported)|in the (?:provided|available) (?:sources|documents|search results|materials)'),
  pt: 'Ressalva genérica de chatbot sobre as fontes disponíveis.',
  en: 'A generic chatbot hedge about the available sources.',
  fix: 'Diga qual fonte falta, ou corte.', fixEn: 'Say which source is missing, or cut it.',
});
rule({
  id: 'cautela-pt', cat: 'cautela', lang: 'pt', src: 'WE', era: 'a partir de meados de 2026',
  re: word('com base nas informações disponíveis|embora (?:os )?detalhes específicos sejam (?:limitados|escassos)|não (?:é|são) amplamente (?:documentad[oa]s?|divulgad[oa]s?)|nas fontes (?:fornecidas|disponíveis)'),
  pt: 'Ressalva genérica de chatbot sobre as fontes disponíveis.',
  en: 'A generic chatbot hedge about the available sources.',
  fix: 'Diga qual fonte falta, ou corte.', fixEn: 'Say which source is missing, or cut it.',
});

// -------------------------------------------------------------- chat leftover
rule({
  id: 'conversa-en', cat: 'conversa', lang: 'en', src: 'W',
  re: word('I hope this helps|Certainly!|Of course!|Great question|You\'re absolutely right|let me know if|Would you like me to|Is there anything else|as an AI(?: language model)?|as a large language model|as of my (?:last )?(?:knowledge|training) (?:update|cutoff)|Here is (?:a|the|your) (?:revised|rewritten|polished|updated|improved) (?:version|draft|text|paragraph)|I hope this message finds you well'),
  pt: 'Frase de conversa com o chatbot que ficou no texto.',
  en: 'A line from the chatbot conversation left in the text.',
  fix: 'Apague.', fixEn: 'Delete it.',
});
rule({
  id: 'conversa-pt', cat: 'conversa', lang: 'pt', src: 'WPE',
  re: word('Espero que (?:isso|isto|este texto|esta versão) (?:ajude|seja útil)|Claro!|Com certeza!|Ótima pergunta|Você tem (?:toda a )?razão|Se (?:quiser|preferir|desejar), posso|Posso ajudar|Fico à disposição|Quer que eu|Como (?:uma )?(?:IA|inteligência artificial|modelo de linguagem)|Aqui está (?:uma|a|o) (?:versão|texto|revisão|parágrafo) (?:revisad[oa]|reescrit[oa]|melhorad[oa]|atualizad[oa])'),
  pt: 'Frase de conversa com o chatbot que ficou no texto.',
  en: 'A line from the chatbot conversation left in the text.',
  fix: 'Apague.', fixEn: 'Delete it.',
});
rule({
  id: 'placeholder', cat: 'conversa', lang: '*', src: 'W', layer: 'punct',
  re: /\[(?:Insert|Add|Your|Name|Describe|Inserir|Insira|Adicione|Adicionar|Seu|Sua|Nome|Descreva)[^\]\n]{0,60}\]|\b20\d\d-XX-XX\b|utm_source=(?:openai|chatgpt\.com|copilot\.com)|oaicite|contentReference\[/g,
  pt: 'Marcador deixado pelo chatbot (colchete a preencher, data XX, rastreio utm_source=chatgpt).',
  en: 'A placeholder left by the chatbot (bracket to fill in, XX date, utm_source=chatgpt tracking).',
  fix: 'Preencha ou apague.', fixEn: 'Fill it in or delete it.',
});

// ----------------------------------------------------------- pasted Markdown
rule({
  id: 'markdown', cat: 'markdown', lang: '*', src: 'W', layer: 'punct', kinds: ['tex'],
  re: /\*\*[^*\n]{1,80}\*\*|^[ \t]*#{1,4} \S.*$|^[ \t]*[-*] \*\*[^*\n]+\*\*:?/gm,
  pt: 'Markdown colado no LaTeX (**negrito**, # título): sobra típica de texto vindo de chatbot.',
  en: 'Markdown pasted into LaTeX (**bold**, # heading): a typical leftover of chatbot text.',
  fix: 'Use \\textbf{} ou \\section{}, ou apague.', fixEn: 'Use \\textbf{} or \\section{}, or delete it.',
});
rule({
  id: 'emoji', cat: 'markdown', lang: '*', src: 'W', layer: 'punct',
  re: /\p{Extended_Pictographic}/gu,
  pt: 'Emoji no texto: comum em listas e títulos gerados por chatbot.',
  en: 'Emoji in the text: common in chatbot-generated lists and headings.',
  fix: 'Apague.', fixEn: 'Delete it.',
});

// ------------------------------------------------------------------- calques
rule({
  id: 'decalque-en', cat: 'decalque', lang: 'en', src: 'C',
  re: word('informations|evidences|(?:the|these|several|many|other|previous|recent) researches|(?:a|one) research(?! (?:question|design|agenda|project|program|programme|team|group|assistant|grant|institute|center|centre|paper|article|note|topic|area|field|setting|tool|method|strategy|gap|frontier|literature|interest))|(?:make|do|made|did|making|doing) (?:a|the|this|our) research|in the last (?:years|decades)|since \\d{4} until|it is possible to (?:observe|notice|see|verify|note|perceive|conclude|affirm)|in this sense|in what (?:concerns|refers to|regards)|the present (?:study|work|paper|article|research)|based in (?:the|this|these|data|evidence)|with base (?:in|on)|according to the literature|is configured as|realiz(?:e|es|ed|ing) (?:a|an|the|this) (?:study|survey|analysis|interview|interviews|test|experiment|estimation|regression|census)|propitiat(?:e|es|ed|ing)|elaborat(?:e|es|ed|ing) (?:a|an|the) (?:model|paper|report|index|questionnaire|study|map)'),
  pt: 'Decalque do português no inglês (“the present study”, “in the last years”, “informations”).',
  en: 'A Portuguese calque in English (“the present study”, “in the last years”, “informations”).',
  fix: 'Ex.: “this paper”, “in recent years”, “information”, “conduct a survey”, “we observe”.', fixEn: 'E.g. “this paper”, “in recent years”, “information”, “conduct a survey”, “we observe”.',
});
rule({
  id: 'decalque-pt', cat: 'decalque', lang: 'pt', src: 'C',
  re: word('endereç(?:ar|a|am|amos|ando|ado|ada|ados|adas) (?:o|a|os|as|esse|essa|este|esta|tal|tais|essas|esses) (?:problemas?|questão|questões|desafios?|lacunas?|perguntas?|limitaç(?:ão|ões))|suport(?:a|am|ar|ando)(?: a| essa| esta| nossa| tal)? hipótese|assum(?:ir|imos|e|em|indo|imos) que|perform(?:ar|a|am|ou|aram)|aplic(?:ar|ou|ando|amos) para (?:uma|a|o) (?:vaga|bolsa|programa|emprego|posição)|mandatóri[oa]s?|estatisticamente significantes?|realiz(?:ar|ou|amos|aram) que|no final do dia'),
  pt: 'Decalque do inglês no português (“endereçar o problema”, “assumir que”, “estatisticamente significante”).',
  en: 'An English calque in Portuguese (“endereçar o problema”, “assumir que”, “estatisticamente significante”).',
  fix: 'Ex.: “tratar o problema”, “supor que”, “estatisticamente significativo”, “perceber que”.', fixEn: 'E.g. “tratar o problema”, “supor que”, “estatisticamente significativo”, “perceber que”.',
});

// ------------------------------------------------------ punctuation and case
rule({
  id: 'virgula-e', cat: 'pontuacao', lang: 'pt', src: 'P', keepComma: true,
  re: new RegExp(`(?<=(?<![${L}])[${L}]+(?:\\s+[${L}]+){0,3},\\s+[${L}]+(?:\\s+[${L}]+){0,3}),\\s+e(?=\\s+[${L}])`, 'gu'),
  pt: 'Vírgula antes do “e” que fecha a enumeração: regra do inglês (Oxford comma) que a IA traz para o português.',
  en: 'A comma before the “e” that ends a list: an English rule (Oxford comma) AI carries into Portuguese.',
  fix: 'Tire a vírgula antes do “e”.', fixEn: 'Drop the comma before “e”.',
});
rule({
  id: 'aspas-curvas', cat: 'pontuacao', lang: '*', src: 'W', layer: 'punct', kinds: ['tex'],
  re: /[“”]/g,
  pt: 'Aspas curvas coladas no .tex (“ ”): costumam vir de texto copiado de chatbot ou do Word.',
  en: 'Curly quotes pasted into the .tex (“ ”): they usually come from text copied from a chatbot or Word.',
  fix: 'No LaTeX, escreva `` e \'\'.', fixEn: "In LaTeX, write `` and ''.",
});

export const RULES = R;
