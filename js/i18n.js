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
    'app.version': 'CometQuant Lab v1.1.0',
    'app.credits': 'Desenvolvido para pesquisa em mutagênese',

    // Tela 1 — Início
    'home.newExperiment': 'Novo Experimento',
    'home.resumeExperiment': 'Retomar Experimento',
    'home.hapticFeedback': 'Feedback tátil',

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
    'setup.slidesPerTreatment': 'Lâminas por Tratamento',
    'setup.slidesPerTreatment.placeholder': 'Ex: 3',
    'setup.conditions': 'Nº de Concentrações',
    'setup.conditions.placeholder': 'Ex: 3',
    'setup.concUnit': 'Unidade de Concentração',
    'setup.concUnit.placeholder': 'Selecione...',
    'setup.concentration': 'Concentração',
    'setup.startCounting': 'Iniciar Contagem',
    'setup.saveExperiment': 'Salvar Experimento e Gerar Códigos',

    'blind.title': 'Codificação Cega das Lâminas',
    'blind.instructions': 'Identifique as lâminas usando somente os códigos abaixo. Esta relação não será exibida novamente durante a contagem.',
    'blind.close': 'Identifiquei as lâminas — Fechar',
    'blind.replicate': 'Repetição',

    'experiments.title': 'Experimentos Salvos',
    'experiments.import': 'Importar JSON',
    'experiments.empty': 'Nenhum experimento salvo neste dispositivo.',
    'experiments.open': 'Abrir',
    'experiments.continue': 'Continuar Contagem',
    'experiments.export': 'Exportar',
    'experiments.encryptedBackup': 'Backup Cego Criptografado',
    'experiments.delete': 'Excluir',
    'experiments.deleteConfirm': 'Excluir definitivamente este experimento?',
    'experiments.updated': 'Atualizado',
    'experiments.inProgress': 'Em andamento',
    'experiments.completed': 'Concluído',

    'replicates.title': 'Repetições',
    'replicates.generate': 'Gerar Códigos para Próxima Repetição',
    'replicates.summary': 'Abrir Resumo do Experimento',
    'replicates.analyze': 'Analisar Lâminas',
    'replicates.continue': 'Continuar Lâmina',
    'replicates.complete': 'Concluída',
    'replicates.pending': 'pendentes',
    'replicates.absent': 'ausentes',
    'replicates.counted': 'contadas',

    'codeEntry.title': 'Identificar Lâmina',
    'codeEntry.code': 'Código da lâmina',
    'codeEntry.code.placeholder': 'Ex: L7K2-01',
    'codeEntry.absent': 'Lâmina ausente',
    'codeEntry.reason': 'Motivo (opcional)',
    'codeEntry.reasonRequired': 'Motivo',
    'codeEntry.reason.none': 'Não informado',
    'codeEntry.reason.broken': 'Quebrada',
    'codeEntry.reason.lost': 'Perdida',
    'codeEntry.reason.quality': 'Qualidade inadequada',
    'codeEntry.reason.insufficient': 'Material insuficiente',
    'codeEntry.reason.other': 'Outro',
    'codeEntry.start': 'Iniciar Contagem',
    'codeEntry.registerAbsent': 'Registrar Ausência',
    'codeEntry.invalid': 'Código inválido ou pertencente a outra repetição.',
    'codeEntry.processed': 'Esta lâmina já foi processada.',
    'codeEntry.confirmAbsent': 'Registrar esta lâmina como ausente?',
    'codeEntry.reasonRequiredAlert': 'Selecione o motivo da ausência.',
    'codeEntry.progress': 'lâminas processadas',

    // Tela 3 — Contador
    'counter.undo': '↩ Desfazer último',
    'counter.finishGel': 'Finalizar Lâmina',
    'counter.nucleoids': 'nucleoides',
    'counter.saved': 'Salvo',
    'counter.saveFailed': 'Falha ao salvar',
    'counter.incompleteReason': 'Motivo da lâmina incompleta',
    'counter.incompleteWarning': 'A lâmina está incompleta. Selecione um motivo para finalizá-la.',
    'reason.select': 'Selecione...',
    'reason.insufficientCells': 'Células insuficientes',
    'reason.poorQuality': 'Qualidade inadequada',
    'reason.damaged': 'Lâmina danificada',
    'reason.technicalError': 'Erro técnico',
    'reason.timeLimit': 'Limite de tempo',
    'reason.other': 'Outro',
    'reason.detail': 'Detalhes',
    'reason.detail.placeholder': 'Descreva o motivo',
    'reason.detailRequired': 'Informe os detalhes quando o motivo for Outro.',

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
    'summary.status': 'Estado',
    'summary.absent': 'Ausente',
    'summary.incomplete': 'Incompleta',
    'summary.reason': 'Motivo',
    'summary.excluded': 'Excluída da análise',
    'summary.mean': 'Média',
    'summary.sd': 'DP',
    'summary.localSaveAlert': 'Dados salvos localmente.',
    'summary.exportReminder': 'Lembre-se de exportar ao final da sessão.',

    // Tela 5 — Análise
    'analysis.title': 'Análise Estatística',
    'analysis.loading': 'Carregando ambiente Python...',
    'analysis.checking': 'Verificando o pacote científico...',
    'analysis.packageMissing': 'Prepare o pacote científico para executar análises offline (35,7 MB).',
    'analysis.install': 'Preparar Análise Offline (35,7 MB)',
    'analysis.downloading': 'Baixando e verificando o pacote científico: {percent}%',
    'analysis.initializing': 'Inicializando o ambiente científico...',
    'analysis.loadingRuntime': 'Carregando o runtime Python...',
    'analysis.loadingPackages': 'Carregando NumPy, SciPy e Matplotlib...',
    'analysis.loadingEngine': 'Preparando o motor estatístico...',
    'analysis.ready': 'Ambiente científico pronto para uso offline.',
    'analysis.failed': 'Não foi possível preparar o ambiente científico.',
    'analysis.error': 'Erro na análise',
    'analysis.retry': 'Tentar Novamente',
    'analysis.cancel': 'Cancelar',
    'analysis.cancelled': 'Operação cancelada.',
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
    'alert.needSlides': 'Informe o número de lâminas por tratamento.',
    'alert.needAgentCells': 'Informe o agente testado e o tipo celular.',
    'alert.needUnitConcentrations': 'Selecione a unidade e informe concentrações válidas e não duplicadas.',
    'alert.blindingActive': 'Conclua todas as lâminas da repetição antes de revelar tratamentos, analisar ou exportar dados.',
    'alert.pendingReplicate': 'Conclua todas as lâminas pendentes antes de criar uma nova repetição.',
    'alert.invalidData': 'Os dados do experimento são inválidos ou inconsistentes.',
    'alert.fileTooLarge': 'O arquivo excede o limite de 5 MB.',
    'alert.tooManyFiles': 'Selecione no máximo 20 arquivos por importação.',
    'alert.fileBatchTooLarge': 'O lote de importação excede o limite total de 25 MB.',
    'alert.importConflict': 'A consolidação foi cancelada porque existem contagens conflitantes para a mesma lâmina.',
    'alert.partialMerge': 'A consolidação foi cancelada porque um arquivo contém uma contagem parcial em andamento. Finalize ou descarte essa contagem antes de consolidar.',
    'alert.needConditions': 'Informe o número de concentrações.',
    'alert.gelComplete': 'Lâmina completa! Verifique os dados e finalize.',
    'alert.noExperiments': 'Nenhum experimento salvo encontrado.',
    'alert.importSuccess': 'Experimento importado com sucesso!',
    'storage.quarantine': '{count} entrada(s) antiga(s) inválida(s) foram preservadas para recuperação.',
    'storage.unavailable': 'Não foi possível abrir o armazenamento seguro. Recarregue o aplicativo antes de continuar.',
    'storage.conflict': 'Este experimento foi alterado em outra aba. A edição foi interrompida para evitar perda de dados.',
    'storage.reloadRequired': 'O armazenamento foi atualizado. Recarregue o aplicativo para continuar.',
    'storage.exportRecovery': 'Exportar Recuperação do Armazenamento',
    'storage.recoveryFailed': 'Não foi possível exportar os dados preservados para recuperação.',
    'alert.importError': 'Arquivo inválido. Verifique o arquivo .json.',
    'alert.invalidAgent': 'Os arquivos selecionados são de experimentos diferentes (agente ou célula diferente). Selecione apenas arquivos do mesmo experimento.',
    'alert.duplicateRep': 'Atenção: repetição duplicada detectada. Apenas a versão mais recente foi mantida.',
    'backup.passphrasePrompt': 'Crie uma senha com pelo menos 12 caracteres para proteger o backup. Guarde-a em local seguro: ela não pode ser recuperada.',
    'backup.decryptPrompt': 'Digite a senha deste backup criptografado.',
    'backup.weakPassphrase': 'Use pelo menos 12 caracteres e evite senhas repetitivas ou previsíveis. Frases com 20 ou mais caracteres são recomendadas.',
    'backup.passwordMismatch': 'As senhas não coincidem.',
    'backup.failed': 'Não foi possível criar o backup criptografado.',
    'backup.decryptFailed': 'Não foi possível abrir o backup. Verifique a senha e o arquivo.',
    'backup.encryptTitle': 'Proteger Backup Cego',
    'backup.decryptTitle': 'Abrir Backup Criptografado',
    'backup.passwordLabel': 'Senha',
    'backup.confirmationLabel': 'Confirmar senha',
    'backup.showPassword': 'Mostrar senha',
    'backup.cancel': 'Cancelar',
    'backup.continue': 'Continuar',
    'resume.consolidated': 'Experimento consolidado',
    'resume.replicates': 'repetições carregadas',
    'resume.selectFiles': 'Selecione um ou mais arquivos .json do CometQuant',
  },

  'en': {
    // General
    'app.title': 'CometQuant Lab',
    'app.subtitle': 'Comet Assay Visual Score',
    'app.version': 'CometQuant Lab v1.1.0',
    'app.credits': 'Developed for mutagenesis research',

    // Screen 1 — Home
    'home.newExperiment': 'New Experiment',
    'home.resumeExperiment': 'Resume Experiment',
    'home.hapticFeedback': 'Haptic feedback',

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
    'setup.slidesPerTreatment': 'Slides per Treatment',
    'setup.slidesPerTreatment.placeholder': 'e.g. 3',
    'setup.conditions': 'No. of Concentrations',
    'setup.conditions.placeholder': 'e.g. 3',
    'setup.concUnit': 'Concentration Unit',
    'setup.concUnit.placeholder': 'Select...',
    'setup.concentration': 'Concentration',
    'setup.startCounting': 'Start Counting',
    'setup.saveExperiment': 'Save Experiment and Generate Codes',

    'blind.title': 'Blind Slide Codes',
    'blind.instructions': 'Label the slides using only the codes below. This mapping will not be shown again during counting.',
    'blind.close': 'I labeled the slides — Close',
    'blind.replicate': 'Replicate',

    'experiments.title': 'Saved Experiments',
    'experiments.import': 'Import JSON',
    'experiments.empty': 'No experiments saved on this device.',
    'experiments.open': 'Open',
    'experiments.continue': 'Continue Counting',
    'experiments.export': 'Export',
    'experiments.encryptedBackup': 'Encrypted Blinded Backup',
    'experiments.delete': 'Delete',
    'experiments.deleteConfirm': 'Permanently delete this experiment?',
    'experiments.updated': 'Updated',
    'experiments.inProgress': 'In progress',
    'experiments.completed': 'Completed',

    'replicates.title': 'Replicates',
    'replicates.generate': 'Generate Codes for Next Replicate',
    'replicates.summary': 'Open Experiment Summary',
    'replicates.analyze': 'Analyze Slides',
    'replicates.continue': 'Continue Slide',
    'replicates.complete': 'Complete',
    'replicates.pending': 'pending',
    'replicates.absent': 'absent',
    'replicates.counted': 'counted',

    'codeEntry.title': 'Identify Slide',
    'codeEntry.code': 'Slide code',
    'codeEntry.code.placeholder': 'e.g. L7K2-01',
    'codeEntry.absent': 'Slide absent',
    'codeEntry.reason': 'Reason (optional)',
    'codeEntry.reasonRequired': 'Reason',
    'codeEntry.reason.none': 'Not informed',
    'codeEntry.reason.broken': 'Broken',
    'codeEntry.reason.lost': 'Lost',
    'codeEntry.reason.quality': 'Inadequate quality',
    'codeEntry.reason.insufficient': 'Insufficient material',
    'codeEntry.reason.other': 'Other',
    'codeEntry.start': 'Start Counting',
    'codeEntry.registerAbsent': 'Register Absence',
    'codeEntry.invalid': 'Invalid code or code belongs to another replicate.',
    'codeEntry.processed': 'This slide has already been processed.',
    'codeEntry.confirmAbsent': 'Register this slide as absent?',
    'codeEntry.reasonRequiredAlert': 'Select the reason for the absence.',
    'codeEntry.progress': 'slides processed',

    // Screen 3 — Counter
    'counter.undo': '↩ Undo last',
    'counter.finishGel': 'Finish Slide',
    'counter.nucleoids': 'nucleoids',
    'counter.saved': 'Saved',
    'counter.saveFailed': 'Save failed',
    'counter.incompleteReason': 'Reason for incomplete slide',
    'counter.incompleteWarning': 'The slide is incomplete. Select a reason before finishing it.',
    'reason.select': 'Select...',
    'reason.insufficientCells': 'Insufficient cells',
    'reason.poorQuality': 'Inadequate quality',
    'reason.damaged': 'Damaged slide',
    'reason.technicalError': 'Technical error',
    'reason.timeLimit': 'Time limit',
    'reason.other': 'Other',
    'reason.detail': 'Details',
    'reason.detail.placeholder': 'Describe the reason',
    'reason.detailRequired': 'Provide details when the reason is Other.',

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
    'summary.status': 'Status',
    'summary.absent': 'Absent',
    'summary.incomplete': 'Incomplete',
    'summary.reason': 'Reason',
    'summary.excluded': 'Excluded from analysis',
    'summary.mean': 'Mean',
    'summary.sd': 'SD',
    'summary.localSaveAlert': 'Data saved locally.',
    'summary.exportReminder': 'Remember to export at the end of each session.',

    // Screen 5 — Analysis
    'analysis.title': 'Statistical Analysis',
    'analysis.loading': 'Loading Python environment...',
    'analysis.checking': 'Checking the scientific package...',
    'analysis.packageMissing': 'Prepare the scientific package to run analyses offline (35.7 MB).',
    'analysis.install': 'Prepare Offline Analysis (35.7 MB)',
    'analysis.downloading': 'Downloading and verifying the scientific package: {percent}%',
    'analysis.initializing': 'Initializing the scientific environment...',
    'analysis.loadingRuntime': 'Loading the Python runtime...',
    'analysis.loadingPackages': 'Loading NumPy, SciPy and Matplotlib...',
    'analysis.loadingEngine': 'Preparing the statistical engine...',
    'analysis.ready': 'Scientific environment ready for offline use.',
    'analysis.failed': 'Could not prepare the scientific environment.',
    'analysis.error': 'Analysis error',
    'analysis.retry': 'Try Again',
    'analysis.cancel': 'Cancel',
    'analysis.cancelled': 'Operation cancelled.',
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
    'alert.needSlides': 'Please enter the number of slides per treatment.',
    'alert.needAgentCells': 'Enter the test agent and cell type.',
    'alert.needUnitConcentrations': 'Select the unit and enter valid, non-duplicate concentrations.',
    'alert.blindingActive': 'Complete every slide in the replicate before revealing treatments, analyzing, or exporting data.',
    'alert.pendingReplicate': 'Complete all pending slides before creating a new replicate.',
    'alert.invalidData': 'The experiment data is invalid or inconsistent.',
    'alert.fileTooLarge': 'The file exceeds the 5 MB limit.',
    'alert.tooManyFiles': 'Select at most 20 files per import.',
    'alert.fileBatchTooLarge': 'The import batch exceeds the 25 MB total limit.',
    'alert.importConflict': 'Consolidation was cancelled because conflicting counts exist for the same slide.',
    'alert.partialMerge': 'Consolidation was cancelled because a file contains an active partial count. Finish or discard that count before consolidating.',
    'alert.needConditions': 'Please enter the number of concentrations.',
    'alert.gelComplete': 'Slide complete! Review the data and finish.',
    'alert.noExperiments': 'No saved experiments found.',
    'alert.importSuccess': 'Experiment imported successfully!',
    'storage.quarantine': '{count} invalid legacy record(s) were preserved for recovery.',
    'storage.unavailable': 'Could not open secure storage. Reload the application before continuing.',
    'storage.conflict': 'This experiment changed in another tab. Editing was stopped to prevent data loss.',
    'storage.reloadRequired': 'Storage was updated. Reload the application to continue.',
    'storage.exportRecovery': 'Export Storage Recovery',
    'storage.recoveryFailed': 'Could not export the preserved recovery data.',
    'alert.importError': 'Invalid file. Please check the .json file.',
    'alert.invalidAgent': 'Selected files belong to different experiments (different agent or cell type). Please select files from the same experiment only.',
    'alert.duplicateRep': 'Warning: duplicate replicate detected. Only the most recent version was kept.',
    'backup.passphrasePrompt': 'Create a password with at least 12 characters to protect the backup. Store it safely: it cannot be recovered.',
    'backup.decryptPrompt': 'Enter the password for this encrypted backup.',
    'backup.weakPassphrase': 'Use at least 12 characters and avoid repetitive or predictable passwords. Passphrases with 20 or more characters are recommended.',
    'backup.passwordMismatch': 'The passwords do not match.',
    'backup.failed': 'Could not create the encrypted backup.',
    'backup.decryptFailed': 'Could not open the backup. Check the password and file.',
    'backup.encryptTitle': 'Protect Blinded Backup',
    'backup.decryptTitle': 'Open Encrypted Backup',
    'backup.passwordLabel': 'Password',
    'backup.confirmationLabel': 'Confirm password',
    'backup.showPassword': 'Show password',
    'backup.cancel': 'Cancel',
    'backup.continue': 'Continue',
    'resume.consolidated': 'Consolidated experiment',
    'resume.replicates': 'replicates loaded',
    'resume.selectFiles': 'Select one or more CometQuant .json files',
  }
}


// =============================================
// FUNÇÕES DO SISTEMA DE IDIOMAS
// =============================================

// Idioma ativo — tenta recuperar o salvo, senão usa inglês como padrão
let currentLanguage = 'en'
try { currentLanguage = localStorage.getItem('cometquant-language') || 'en' } catch (_) {}


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
  try { localStorage.setItem('cometquant-language', lang) } catch (_) {}
  applyLanguage()
}
