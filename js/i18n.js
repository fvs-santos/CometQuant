// =============================================
// SISTEMA DE INTERNACIONALIZAÇÃO (i18n)
// CometQuant Lab
// =============================================

// Objeto com todas as traduções do app
// Estrutura: translations[idioma][chave] = texto
const translations = {

  'pt': {
    // Geral
    'app.title': 'CometQuant Lab',
    'app.subtitle': 'Ensaio Cometa — Score Visual',
    'app.version': 'CometQuant Lab v1.0',
    'app.credits': 'Desenvolvido para pesquisa em mutagênese',

    // Tela 1 — Início
    'home.newExperiment': 'Novo Experimento',
    'home.resumeExperiment': 'Retomar Experimento',

    // Tela 2 — Configuração
    'setup.title': 'Novo Experimento',
    'setup.researcher': 'Pesquisador',
    'setup.researcher.placeholder': 'Seu nome',
    'setup.agent': 'Agente Testado',
    'setup.agent.placeholder': 'Ex: Cisplatina',
    'setup.cells': 'Tipo Celular',
    'setup.cells.placeholder': 'Ex: CHO-K1',
    'setup.negControl': 'Controle Negativo',
    'setup.negControl.placeholder': 'Ex: PBS',
    'setup.posControl': 'Controle Positivo',
    'setup.posControl.placeholder': 'Ex: H₂O₂ 50µM',
    'setup.solControl': 'Controle Solvente',
    'setup.solControl.placeholder': 'Ex: DMSO 0,1%',
    'setup.nucleoids': 'Nucleoides/Lâmina',
    'setup.nucleoids.placeholder': 'Ex: 100',
    'setup.conditions': 'Nº de Concentrações',
    'setup.conditions.placeholder': 'Ex: 3',
    'setup.concUnit': 'Unidade de Concentração',
    'setup.concUnit.placeholder': 'Selecione...',
    'setup.concentration': 'Concentração',
    'setup.startCounting': 'Iniciar Contagem',

    // Tela 3 — Contador
    'counter.undo': '↩ Desfazer último',
    'counter.finishGel': 'Finalizar Lâmina',
    'counter.nucleoids': 'nucleoides',

    // Tela 4 — Resumo
    'summary.title': 'Resumo do Experimento',
    'summary.export': 'Exportar Dados (.json)',
    'summary.goToAnalysis': 'Análise Estatística',
    'summary.addReplicate': 'Adicionar Repetição',
    'summary.treatment': 'Tratamento',
    'summary.gel': 'Lâmina',
    'summary.score': 'Score',
    'summary.class0': 'Classe 0',
    'summary.class1': 'Classe 1',
    'summary.class2': 'Classe 2',
    'summary.class3': 'Classe 3',
    'summary.class4': 'Classe 4',
    'summary.total': 'Total',
    'summary.mean': 'Média',
    'summary.sd': 'DP',
    'summary.localSaveAlert': 'Dados salvos localmente.',
    'summary.exportReminder': 'Lembre-se de exportar ao final da sessão.',

    // Tela 5 — Análise
    'analysis.title': 'Análise Estatística',
    'analysis.loading': 'Carregando ambiente Python...',
    'analysis.run': 'Rodar Análise',
    'analysis.scoresTitle': 'Scores Visuais',
    'analysis.shapiroTitle': 'Teste de Normalidade Shapiro-Wilk',
    'analysis.anovaTitle': 'ANOVA One-Way',
    'analysis.tukeyTitle': 'Teste Post-hoc de Tukey',
    'analysis.tukeyCaption': 'Realizado apenas se o p-valor da ANOVA for < 0,05',
    'analysis.regressionTitle': 'Regressão Linear e Correlação de Pearson',
    'analysis.chartsTitle': 'Gráficos',
    'analysis.exportReport': 'Exportar Relatório (.html)',
    'analysis.exportCsv': 'Exportar Dados (.csv)',
    'analysis.exportZip': 'Baixar Tudo (.zip)',
    'analysis.running': 'Executando análises...',
    'analysis.done': 'Análise concluída',
    'analysis.errorNoData': 'Nenhum dado encontrado. Finalize ao menos uma repetição.',
    'analysis.errorNeedReps': 'É necessário ao menos 3 repetições para o teste de Shapiro-Wilk.',
    'analysis.notPerformed': 'Não realizado',

    // Botões gerais
    'btn.back': '← Voltar',

    // Mensagens de erro e alerta
    'alert.fillRequired': 'Preencha todos os campos obrigatórios.',
    'alert.needControl': 'Informe ao menos um grupo controle.',
    'alert.needNucleoids': 'Informe o número de nucleoides por lâmina.',
    'alert.needConditions': 'Informe o número de concentrações.',
    'alert.gelComplete': 'Lâmina completa! Verifique os dados e finalize.',
    'alert.noExperiments': 'Nenhum experimento salvo encontrado.',
    'alert.importSuccess': 'Experimento importado com sucesso!',
    'alert.importError': 'Arquivo inválido. Verifique o arquivo .json.',
    'alert.invalidAgent': 'Os arquivos selecionados são de experimentos diferentes (agente ou célula diferente). Selecione apenas arquivos do mesmo experimento.',
    'alert.duplicateRep': 'Atenção: repetição duplicada detectada. Apenas a versão mais recente foi mantida.',
    'resume.consolidated': 'Experimento consolidado',
    'resume.replicates': 'repetições carregadas',
    'resume.selectFiles': 'Selecione um ou mais arquivos .json do CometQuant',
  },

  'en': {
    // General
    'app.title': 'CometQuant Lab',
    'app.subtitle': 'Comet Assay Visual Score',
    'app.version': 'CometQuant Lab v1.0',
    'app.credits': 'Developed for mutagenesis research',

    // Screen 1 — Home
    'home.newExperiment': 'New Experiment',
    'home.resumeExperiment': 'Resume Experiment',

    // Screen 2 — Setup
    'setup.title': 'New Experiment',
    'setup.researcher': 'Researcher',
    'setup.researcher.placeholder': 'Your name',
    'setup.agent': 'Test Agent',
    'setup.agent.placeholder': 'e.g. Cisplatin',
    'setup.cells': 'Cell Type',
    'setup.cells.placeholder': 'e.g. CHO-K1',
    'setup.negControl': 'Negative Control',
    'setup.negControl.placeholder': 'e.g. PBS',
    'setup.posControl': 'Positive Control',
    'setup.posControl.placeholder': 'e.g. H₂O₂ 50µM',
    'setup.solControl': 'Solvent Control',
    'setup.solControl.placeholder': 'e.g. DMSO 0.1%',
    'setup.nucleoids': 'Nucleoids/Slide',
    'setup.nucleoids.placeholder': 'e.g. 100',
    'setup.conditions': 'No. of Concentrations',
    'setup.conditions.placeholder': 'e.g. 3',
    'setup.concUnit': 'Concentration Unit',
    'setup.concUnit.placeholder': 'Select...',
    'setup.concentration': 'Concentration',
    'setup.startCounting': 'Start Counting',

    // Screen 3 — Counter
    'counter.undo': '↩ Undo last',
    'counter.finishGel': 'Finish Slide',
    'counter.nucleoids': 'nucleoids',

    // Screen 4 — Summary
    'summary.title': 'Experiment Summary',
    'summary.export': 'Export Data (.json)',
    'summary.goToAnalysis': 'Statistical Analysis',
    'summary.addReplicate': 'Add Replicate',
    'summary.treatment': 'Treatment',
    'summary.gel': 'Slide',
    'summary.score': 'Score',
    'summary.class0': 'Class 0',
    'summary.class1': 'Class 1',
    'summary.class2': 'Class 2',
    'summary.class3': 'Class 3',
    'summary.class4': 'Class 4',
    'summary.total': 'Total',
    'summary.mean': 'Mean',
    'summary.sd': 'SD',
    'summary.localSaveAlert': 'Data saved locally.',
    'summary.exportReminder': 'Remember to export at the end of each session.',

    // Screen 5 — Analysis
    'analysis.title': 'Statistical Analysis',
    'analysis.loading': 'Loading Python environment...',
    'analysis.run': 'Run Analysis',
    'analysis.scoresTitle': 'Visual Scores',
    'analysis.shapiroTitle': 'Shapiro-Wilk Normality Test',
    'analysis.anovaTitle': 'One-Way ANOVA',
    'analysis.tukeyTitle': 'Tukey Post-hoc Test',
    'analysis.tukeyCaption': 'Performed only if ANOVA p-value < 0.05',
    'analysis.regressionTitle': 'Linear Regression & Pearson Correlation',
    'analysis.chartsTitle': 'Charts',
    'analysis.exportReport': 'Export Report (.html)',
    'analysis.exportCsv': 'Export Data (.csv)',
    'analysis.exportZip': 'Download All (.zip)',
    'analysis.running': 'Running analyses...',
    'analysis.done': 'Analysis complete',
    'analysis.errorNoData': 'No data found. Please complete at least one replicate.',
    'analysis.errorNeedReps': 'At least 3 replicates are needed for the Shapiro-Wilk test.',
    'analysis.notPerformed': 'Not performed',
    
    // General buttons
    'btn.back': '← Back',

    // Error and alert messages
    'alert.fillRequired': 'Please fill in all required fields.',
    'alert.needControl': 'Please provide at least one control group.',
    'alert.needNucleoids': 'Please enter the number of nucleoids per slide.',
    'alert.needConditions': 'Please enter the number of concentrations.',
    'alert.gelComplete': 'Slide complete! Review the data and finish.',
    'alert.noExperiments': 'No saved experiments found.',
    'alert.importSuccess': 'Experiment imported successfully!',
    'alert.importError': 'Invalid file. Please check the .json file.',
    'alert.invalidAgent': 'Selected files belong to different experiments (different agent or cell type). Please select files from the same experiment only.',
    'alert.duplicateRep': 'Warning: duplicate replicate detected. Only the most recent version was kept.',
    'resume.consolidated': 'Consolidated experiment',
    'resume.replicates': 'replicates loaded',
    'resume.selectFiles': 'Select one or more CometQuant .json files',
  }
}


// =============================================
// FUNÇÕES DO SISTEMA DE IDIOMAS
// =============================================

// Idioma ativo — tenta recuperar o salvo, senão usa inglês como padrão
let currentLanguage = localStorage.getItem('cometquant-language') || 'en'


// Retorna o texto traduzido para uma chave
// Equivalente em Python seria: translations[idioma].get(chave, chave)
function t(key) {
  return translations[currentLanguage][key] || key
}


// Aplica o idioma atual em todos os elementos da página
// Procura todos os elementos que têm o atributo data-i18n
// e substitui o texto pelo traduzido
function applyLanguage() {

  // Atualiza textos normais
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n')
    element.textContent = t(key)
  })

  // Atualiza placeholders de inputs
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder')
    element.placeholder = t(key)
  })

  // Atualiza o atributo lang do HTML (importante para acessibilidade)
  document.documentElement.lang = currentLanguage
}


// Troca o idioma e salva a preferência no localStorage
function setLanguage(lang) {
  currentLanguage = lang
  localStorage.setItem('cometquant-language', lang)
  applyLanguage()
}