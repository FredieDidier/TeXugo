// What each journal asks of a replication package, checked on the journals'
// own pages in November 2026. Plain data, shared by the server and the page
// (the page imports it as ../../server/replication-journals.js). Most of these
// journals follow the Data and Code Availability Standard (DCAS) and the
// Social Science Data Editors' README template, so the checklist is one; the
// journal changes where the package goes, when, and a few details.
export const DCAS_URL = 'https://datacodestandard.org/';
export const README_URL = 'https://social-science-data-editors.github.io/template_README/';

export const JOURNALS = [
  {
    id: 'aea',
    name: 'AEA (AER, AEJ, Insights, P&P, JEL, JEP)',
    repo: 'AEA Data and Code Repository (openICPSR)',
    repoUrl: 'https://www.icpsr.umich.edu/sites/aea/home',
    guide: 'https://aeadataeditor.github.io/aea-de-guidance/',
    when: 'Depois do aceite condicional: depositar no openICPSR e enviar o formulário Data and Code Availability com os arquivos finais. O Data Editor confere antes do aceite final.',
    notes: ['Segue o DCAS e o modelo de README dos Data Editors.', 'O GitHub não serve como repositório: precisa ser um arquivo confiável, com DOI.'],
    readmePdf: false,
  },
  {
    id: 'es',
    name: 'Econometric Society (Econometrica, QE, TE)',
    repo: 'Zenodo, comunidade es-replication-repository',
    repoUrl: 'https://zenodo.org/communities/es-replication-repository',
    guide: 'https://www.econometricsociety.org/publications/es-data-editor-website/package',
    when: 'Depois do aceite condicional, pelo Editorial Express, com o checklist assinado e cartas ao editor e ao Data Editor. Só se publica no Zenodo depois das checagens.',
    notes: ['README em PDF (README.pdf), no modelo dos Data Editors.', 'Não coloque o paper nem os apêndices dentro do ZIP do pacote.', 'Dados em formato proprietário precisam de uma cópia em formato aberto.', 'Dados confidenciais vão num ZIP separado, marcado como não publicável.'],
    readmePdf: true,
    openFormats: true,
  },
  {
    id: 'restud',
    name: 'Review of Economic Studies',
    repo: 'Zenodo, comunidade restud-replication',
    repoUrl: 'https://zenodo.org/communities/restud-replication/',
    guide: 'https://restud.dataeditor.group/',
    when: 'Depois do aceite condicional; o Data Editor reproduz os resultados antes da publicação.',
    notes: ['Segue o DCAS e o modelo de README dos Data Editors.'],
    readmePdf: false,
  },
  {
    id: 'ej',
    name: 'Economic Journal',
    repo: 'Zenodo, comunidade ej-replication-repository',
    repoUrl: 'https://zenodo.org/communities/ej-replication-repository',
    guide: 'https://ejdataeditor.github.io/',
    when: 'Com os arquivos de produção, depois do aceite condicional. Vai para o Zenodo quando as checagens terminam.',
    notes: ['README em PDF, com uma seção própria de citação dos dados igual às referências do paper.', 'Pedidos de exceção (dados que não podem ser publicados) na primeira submissão.'],
    readmePdf: true,
  },
  {
    id: 'jeea',
    name: 'Journal of the European Economic Association',
    repo: 'Zenodo, comunidade jeea_replication',
    repoUrl: 'https://zenodo.org/communities/jeea_replication',
    guide: 'https://academic.oup.com/jeea/pages/Author_Guidelines',
    when: 'Depois do aceite: ZIP pela plataforma de dados, com o checklist preenchido. O aceite formal só sai depois que o Data Editor reproduz os resultados.',
    notes: ['README em PDF, com citação dos dados.', 'Pedidos de exceção na primeira submissão.'],
    readmePdf: true,
  },
  {
    id: 'jpe',
    name: 'Journal of Political Economy',
    repo: 'Harvard Dataverse, coleção do JPE',
    repoUrl: 'https://dataverse.harvard.edu/dataverse/JPE',
    guide: 'https://jpedataeditor.github.io/',
    when: 'Depois do aceite condicional; o pacote sobe para o Dataverse quando a reprodução do Data Editor dá certo.',
    notes: ['README.pdf ou README.md na raiz do pacote; o modelo dos Data Editors é fortemente recomendado.', 'Pedidos de exceção na primeira submissão.'],
    readmePdf: false,
  },
  {
    id: 'qje',
    name: 'Quarterly Journal of Economics',
    repo: 'QJE Dataverse (Harvard Dataverse)',
    repoUrl: 'https://dataverse.harvard.edu/dataverse/qje',
    guide: 'https://academic.oup.com/qje/pages/data_policy',
    when: 'Depois do aceite; as instruções completas vêm com a carta de aceite.',
    notes: ['README em PDF dizendo o que é cada arquivo e como rodar a replicação.', 'Com dados proprietários: os programas e como outros podem obter os dados.'],
    readmePdf: true,
  },
  {
    id: 'restat',
    name: 'Review of Economics and Statistics',
    repo: 'Harvard Dataverse, coleção da REStat',
    repoUrl: 'https://dataverse.harvard.edu/dataverse/restat',
    guide: 'https://direct.mit.edu/rest',
    when: 'Antes da publicação. Confira as regras atuais na página da revista: não achamos uma página do Data Editor.',
    notes: ['Dados proprietários: avise já na submissão.'],
    readmePdf: false,
  },
  {
    id: 'elsevier',
    name: 'Elsevier (JDE, JPubE, JUE, JEEM)',
    repo: 'Mendeley Data ou outro repositório com DOI',
    repoUrl: 'https://data.mendeley.com/',
    guide: 'https://www.sciencedirect.com/journal/journal-of-development-economics/publish/guide-for-authors',
    when: 'Antes da publicação; o editor pode pedir dados e código já na revisão. Cada revista tem o seu Guide for Authors.',
    notes: ['Com dados proprietários, diga se outros pesquisadores podem obtê-los de outro jeito.'],
    readmePdf: false,
  },
  {
    id: 'outra',
    name: 'Outra revista',
    repo: 'O que a revista pedir; sem regra, um repositório com DOI (Zenodo, Dataverse, openICPSR)',
    repoUrl: 'https://zenodo.org/',
    guide: 'https://datacodestandard.org/',
    when: 'Veja as instruções da revista. O padrão DCAS é o que a maioria das revistas de economia segue.',
    notes: [],
    readmePdf: false,
  },
];

export const journalById = (id) => JOURNALS.find((j) => j.id === id) || JOURNALS[0];
