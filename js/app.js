// =============================================
// COMETQUANT LAB — app.js
// =============================================


// =============================================
// PARTE 1 — INICIALIZAÇÃO
// =============================================

// "document.addEventListener('DOMContentLoaded', ...)" é o equivalente
// ao bloco "if __name__ == '__main__'" do Python.
// Garante que todo o HTML foi carregado antes de o JavaScript executar.

document.addEventListener('DOMContentLoaded', () => {

  // Aplica o idioma salvo (ou inglês por padrão)
  applyLanguage()
  updateLanguageButtons()

  // Inicializa os eventos de navegação
  initNavigation()

  // Inicializa os eventos do formulário
  initSetup()

  // Inicializa o contador
  initCounter()

  // Inicializa o resumo
  initSummary()

  console.log('CometQuant Lab initialized')
})


// =============================================
// PARTE 2 — NAVEGAÇÃO ENTRE TELAS
// =============================================

// Essa função é o mecanismo central de navegação.
// Recebe o ID da tela destino e faz a troca.
//
// Em Python, seria algo como:
// def show_screen(screen_id):
//     for screen in all_screens:
//         screen.visible = False
//     target_screen.visible = True

function showScreen(screenId) {
  // Esconde todas as telas removendo a classe 'active'
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active')
  })

  // Mostra apenas a tela solicitada adicionando 'active'
  const target = document.getElementById(screenId)
  if (target) {
    target.classList.add('active')
    // Rola para o topo da tela — importante após navegação
    target.scrollTop = 0
  }
}


// Atualiza o visual dos botões de idioma
// para destacar qual está ativo
function updateLanguageButtons() {
  document.getElementById('btn-lang-en').classList.toggle('active', currentLanguage === 'en')
  document.getElementById('btn-lang-pt').classList.toggle('active', currentLanguage === 'pt')
}


// Sobrescreve a função setLanguage do i18n.js
// para também atualizar os botões visuais
const _setLanguage = setLanguage
window.setLanguage = function(lang) {
  _setLanguage(lang)
  updateLanguageButtons()
}


// Conecta todos os botões de navegação
function initNavigation() {

  // Tela Início → Configuração
  document.getElementById('btn-new-experiment')
    .addEventListener('click', () => {
      resetSetupForm()
      showScreen('screen-setup')
    })

  // Tela Início → Retomar experimento
  document.getElementById('btn-resume-experiment')
    .addEventListener('click', () => {
      handleResumeExperiment()
    })

  // Voltar: Configuração → Início
  document.getElementById('btn-back-setup')
    .addEventListener('click', () => showScreen('screen-home'))

  // Voltar: Contador → Configuração
  document.getElementById('btn-back-counter')
    .addEventListener('click', () => {
      if (confirm(t('alert.backWarning') || 'Return to setup? Current slide data will be lost.')) {
        showScreen('screen-setup')
      }
    })

  // Voltar: Resumo → Início
  document.getElementById('btn-back-summary')
    .addEventListener('click', () => showScreen('screen-home'))

  // Voltar: Análise → Resumo
  document.getElementById('btn-back-analysis')
    .addEventListener('click', () => showScreen('screen-summary'))

  // Resumo → Análise
  document.getElementById('btn-go-to-analysis')
    .addEventListener('click', () => showScreen('screen-analysis'))
}


// =============================================
// PARTE 3 — CONFIGURAÇÃO DO EXPERIMENTO
// =============================================

// Objeto global que representa o experimento em andamento
// É o "estado" do app — equivalente às variáveis globais
// do seu app.py, mas organizado num único objeto
let currentExperiment = null

// Índice do tratamento sendo contado no momento
let currentTreatmentIndex = 0

// Índice da lâmina atual dentro do tratamento
let currentGelIndex = 0


function initSetup() {

  // Quando o usuário digita o número de concentrações,
  // gera dinamicamente os campos de input
  document.getElementById('input-conditions')
    .addEventListener('input', generateConcentrationInputs)

  // Botão Iniciar Contagem
  document.getElementById('btn-start-counting')
    .addEventListener('click', handleStartCounting)
}


// Gera os campos de concentração dinamicamente
// Equivalente ao loop "for i in range(conditions)" do seu app.py
function generateConcentrationInputs() {
  const container = document.getElementById('concentrations-container')
  const n = parseInt(document.getElementById('input-conditions').value) || 0
  const unit = document.getElementById('input-conc-unit').value

  container.innerHTML = '' // Limpa campos anteriores

  for (let i = 0; i < n; i++) {
    const label = `${t('setup.concentration')} ${i + 1}${unit ? ' (' + unit + ')' : ''}`

    container.innerHTML += `
      <div class="form-group">
        <label>${label}</label>
        <input type="number"
               id="input-conc-${i}"
               placeholder="0"
               min="0"
               step="any">
      </div>
    `
  }
}


// Valida e processa o formulário ao clicar em "Start Counting"
function handleStartCounting() {

  // Lê os valores do formulário
  const researcher = document.getElementById('input-researcher').value.trim()
  const agent      = document.getElementById('input-agent').value.trim()
  const cells      = document.getElementById('input-cells').value.trim()
  const negControl = document.getElementById('input-neg-control').value.trim()
  const posControl = document.getElementById('input-pos-control').value.trim()
  const solControl = document.getElementById('input-sol-control').value.trim()
  const nucleoids  = parseInt(document.getElementById('input-nucleoids').value)
  const conditions = parseInt(document.getElementById('input-conditions').value)
  const concUnit   = document.getElementById('input-conc-unit').value

  // Validações — equivalente à função validate_info() do seu app.py
  if (!negControl && !posControl && !solControl) {
    alert(t('alert.needControl'))
    return
  }

  if (!nucleoids || nucleoids < 1) {
    alert(t('alert.needNucleoids'))
    return
  }

  if (!conditions || conditions < 1) {
    alert(t('alert.needConditions'))
    return
  }

  // Monta a lista de tratamentos
  // Controles primeiro, depois as concentrações — igual ao seu app.py
  const treatments = []

  if (posControl) treatments.push(posControl)
  if (negControl) treatments.push(negControl)
  if (solControl) treatments.push(solControl)

  for (let i = 0; i < conditions; i++) {
    const val = document.getElementById(`input-conc-${i}`).value
    treatments.push(`${val} ${concUnit}`)
  }

  // Monta o objeto do experimento
  // Essa é a estrutura de dados que definimos antes de começar
  currentExperiment = {
    id: `exp_${Date.now()}`,  // timestamp como ID único
    researcher,
    agent,
    cells,
    negControl,
    posControl,
    solControl,
    nucleoidsPerGel: nucleoids,
    concUnit,
    treatments,
    replicates: [
      {
        replicateNumber: 1,
        date: new Date().toISOString().split('T')[0], // formato YYYY-MM-DD
        gels: []
      }
    ]
  }

  // Salva imediatamente no localStorage
  saveExperiment()

  // Reseta os contadores e inicia com o primeiro tratamento
  currentTreatmentIndex = 0
  currentGelIndex = 0
  startCounting()
}


// Limpa o formulário para um novo experimento
function resetSetupForm() {
  document.getElementById('input-researcher').value = ''
  document.getElementById('input-agent').value = ''
  document.getElementById('input-cells').value = ''
  document.getElementById('input-neg-control').value = ''
  document.getElementById('input-pos-control').value = ''
  document.getElementById('input-sol-control').value = ''
  document.getElementById('input-nucleoids').value = ''
  document.getElementById('input-conditions').value = ''
  document.getElementById('input-conc-unit').value = ''
  document.getElementById('concentrations-container').innerHTML = ''
}


// =============================================
// PARTE 4 — CONTADOR
// =============================================

// Histórico de cliques para a função "desfazer"
// Funciona como uma pilha (stack) — último a entrar, primeiro a sair
let clickHistory = []

// Contadores atuais da lâmina em andamento
let currentCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }


function initCounter() {

  // Conecta os 5 botões de classe
  // "querySelectorAll" retorna todos os elementos com aquela classe
  // equivalente a um loop sobre uma lista em Python
  document.querySelectorAll('.comet-class-card').forEach(card => {
    card.addEventListener('click', () => {
      const cometClass = parseInt(card.getAttribute('data-class'))
      registerCount(cometClass)
    })
  })

  // Botão desfazer
  document.getElementById('btn-undo')
    .addEventListener('click', undoLastCount)

  // Botão finalizar lâmina
  document.getElementById('btn-finish-gel')
    .addEventListener('click', handleFinishGel)
}


// Inicia a contagem para o tratamento/lâmina atual
function startCounting() {
  // Reseta os contadores visuais e o histórico
  currentCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
  clickHistory = []

  // Atualiza a interface
  updateCounterDisplay()
  showScreen('screen-counter')
}


// Registra um clique em uma classe de cometa
function registerCount(cometClass) {
  const nucleoids = currentExperiment.nucleoidsPerGel
  const total = getTotalCount()

  // Não permite ultrapassar o total de nucleoides
  if (total >= nucleoids) {
    // Pulsa o card para indicar que está completo
    const card = document.getElementById(`card-class-${cometClass}`)
    card.classList.add('pulse')
    setTimeout(() => card.classList.remove('pulse'), 600)
    return
  }

  // Incrementa o contador da classe
  currentCounts[cometClass]++

  // Registra no histórico para permitir desfazer
  clickHistory.push(cometClass)

  // Atualiza a interface
  updateCounterDisplay()

  // Feedback visual no card clicado
  const card = document.getElementById(`card-class-${cometClass}`)
  card.classList.add('pulse')
  setTimeout(() => card.classList.remove('pulse'), 300)
}


// Desfaz o último clique registrado
function undoLastCount() {
  if (clickHistory.length === 0) return

  // Remove o último item do histórico
  // "pop()" existe tanto em Python quanto em JavaScript
  const lastClass = clickHistory.pop()

  // Decrementa o contador correspondente
  if (currentCounts[lastClass] > 0) {
    currentCounts[lastClass]--
  }

  updateCounterDisplay()
}


// Retorna a soma total de nucleoides contados
function getTotalCount() {
  return Object.values(currentCounts).reduce((sum, val) => sum + val, 0)

  // "reduce" aqui faz o mesmo que sum() em Python:
  // soma todos os valores do objeto currentCounts
}


// Atualiza todos os elementos visuais do contador
function updateCounterDisplay() {
  const treatment = currentExperiment.treatments[currentTreatmentIndex]
  const nucleoids = currentExperiment.nucleoidsPerGel
  const total = getTotalCount()
  const gelNumber = currentGelIndex + 1

  // Atualiza o nome do tratamento no cabeçalho
  document.getElementById('counter-treatment-name').textContent = treatment

  // Atualiza o label da lâmina
  const gelLabel = currentLanguage === 'pt'
    ? `Lâmina ${gelNumber}`
    : `Slide ${gelNumber}`
  document.getElementById('counter-gel-label').textContent = gelLabel

  // Atualiza o progresso numérico
  document.getElementById('counter-progress').textContent =
    `${total} / ${nucleoids} ${t('counter.nucleoids')}`

  // Atualiza a barra de progresso
  const percent = (total / nucleoids) * 100
  document.getElementById('progress-bar').style.width = `${percent}%`

  // Atualiza cada contador individual
  for (let i = 0; i <= 4; i++) {
    document.getElementById(`count-${i}`).textContent = currentCounts[i]
  }

  // Muda a cor da barra quando completo
  const bar = document.getElementById('progress-bar')
  if (total >= nucleoids) {
    bar.style.backgroundColor = 'var(--color-success)'
  } else {
    bar.style.backgroundColor = 'var(--color-accent)'
  }
}


// Processa o clique em "Finalizar Lâmina"
function handleFinishGel() {
  const nucleoids = currentExperiment.nucleoidsPerGel
  const total = getTotalCount()

  // Avisa se a contagem está incompleta, mas permite finalizar
  if (total < nucleoids) {
    const msg = currentLanguage === 'pt'
      ? `Apenas ${total} de ${nucleoids} nucleoides contados. Deseja finalizar mesmo assim?`
      : `Only ${total} of ${nucleoids} nucleoids counted. Finish anyway?`
    if (!confirm(msg)) return
  }

  // Monta o objeto da lâmina finalizada
  const gelData = {
    treatment: currentExperiment.treatments[currentTreatmentIndex],
    gelNumber: currentGelIndex + 1,
    class0: currentCounts[0],
    class1: currentCounts[1],
    class2: currentCounts[2],
    class3: currentCounts[3],
    class4: currentCounts[4],
    total: total
  }

  // Adiciona aos dados da repetição atual (sempre a última)
  const lastReplicate = currentExperiment.replicates[currentExperiment.replicates.length - 1]
  lastReplicate.gels.push(gelData)

  // Salva automaticamente após cada lâmina
  saveExperiment()

  // Decide o que fazer a seguir
  moveToNextGelOrTreatment()
}


// Avança para a próxima lâmina ou próximo tratamento
function moveToNextGelOrTreatment() {

  // Por ora: cada tratamento tem 1 lâmina por repetição
  // (poderemos configurar múltiplas lâminas por tratamento depois)
  currentTreatmentIndex++

  if (currentTreatmentIndex < currentExperiment.treatments.length) {
    // Ainda há tratamentos — continua contando
    currentGelIndex = 0
    startCounting()
  } else {
    // Todos os tratamentos desta repetição foram contados
    showSummary()
  }
}


// =============================================
// PARTE 5 — ARMAZENAMENTO (localStorage)
// =============================================

const STORAGE_KEY = 'cometquant-experiments'


// Salva o experimento atual no localStorage
function saveExperiment() {
  // Recupera a lista de todos os experimentos salvos
  let experiments = getAllExperiments()

  // Verifica se esse experimento já existe (pelo ID)
  const index = experiments.findIndex(e => e.id === currentExperiment.id)

  if (index >= 0) {
    // Atualiza o experimento existente
    experiments[index] = currentExperiment
  } else {
    // Adiciona como novo
    experiments.push(currentExperiment)
  }

  // Salva de volta no localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(experiments))
}


// Retorna todos os experimentos salvos
function getAllExperiments() {
  const data = localStorage.getItem(STORAGE_KEY)
  return data ? JSON.parse(data) : []
}


// Lida com o botão "Retomar Experimento"
function handleResumeExperiment() {
  const experiments = getAllExperiments()

  if (experiments.length === 0) {
    alert(t('alert.noExperiments'))
    return
  }

  // Por ora: retoma o experimento mais recente automaticamente
  // Numa próxima versão: mostrar lista para o usuário escolher
  currentExperiment = experiments[experiments.length - 1]
  showSummary()
}


// =============================================
// PARTE 6 — RESUMO E EXPORTAÇÃO
// =============================================

function initSummary() {
  document.getElementById('btn-export-experiment')
    .addEventListener('click', exportExperiment)

  document.getElementById('btn-add-replicate')
    .addEventListener('click', handleAddReplicate)
}


// Exibe a tela de resumo com a tabela de dados
function showSummary() {
  renderSummaryTable()
  showScreen('screen-summary')
}


// Monta a tabela de resumo dinamicamente
function renderSummaryTable() {
  const container = document.getElementById('summary-table-container')

  if (!currentExperiment) {
    container.innerHTML = ''
    return
  }

  let html = ''

  // Uma tabela por repetição
  currentExperiment.replicates.forEach(replicate => {
    html += `
      <h3 style="margin: 16px 0 8px; color: var(--color-accent)">
        ${currentLanguage === 'pt' ? 'Repetição' : 'Replicate'} ${replicate.replicateNumber}
        <small style="color: var(--color-text-secondary); font-size: 0.8em">
          — ${replicate.date}
        </small>
      </h3>
      <table>
        <thead>
          <tr>
            <th>${t('summary.treatment')}</th>
            <th>${t('summary.class0')}</th>
            <th>${t('summary.class1')}</th>
            <th>${t('summary.class2')}</th>
            <th>${t('summary.class3')}</th>
            <th>${t('summary.class4')}</th>
            <th>${t('summary.total')}</th>
            <th>${t('summary.score')}</th>
          </tr>
        </thead>
        <tbody>
    `

    replicate.gels.forEach(gel => {
      const score = calculateScore(gel)
      html += `
        <tr>
          <td>${gel.treatment}</td>
          <td>${gel.class0}</td>
          <td>${gel.class1}</td>
          <td>${gel.class2}</td>
          <td>${gel.class3}</td>
          <td>${gel.class4}</td>
          <td>${gel.total}</td>
          <td>${score.toFixed(2)}</td>
        </tr>
      `
    })

    html += `</tbody></table>`
  })

  container.innerHTML = html
}


// Calcula o Score Visual de uma lâmina
// Fórmula idêntica ao seu app.py:
// score = ((0*c0 + 0.25*c1 + 0.5*c2 + 0.75*c3 + 1*c4) / total) * 100
function calculateScore(gel) {
  if (!gel.total || gel.total === 0) return 0
  return (
    (0 * gel.class0 +
     0.25 * gel.class1 +
     0.5  * gel.class2 +
     0.75 * gel.class3 +
     1    * gel.class4)
    / currentExperiment.nucleoidsPerGel
  ) * 100
}


// Exporta o experimento atual como arquivo .json
function exportExperiment() {
  if (!currentExperiment) return

  // Converte o objeto para texto JSON formatado
  const json = JSON.stringify(currentExperiment, null, 2)

  // Cria um "arquivo virtual" no navegador e simula o download
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const repNumber = currentExperiment.replicates.length
  const today = new Date().toISOString().split('T')[0]

  a.href     = url
  a.download = `CometQuant_${currentExperiment.agent}_${currentExperiment.cells}_Rep${repNumber}_${today}.json`
  a.click()

  // Libera a memória do arquivo virtual
  URL.revokeObjectURL(url)
}


// Adiciona uma nova repetição ao experimento atual
function handleAddReplicate() {
  if (!currentExperiment) return

  const nextNumber = currentExperiment.replicates.length + 1

  currentExperiment.replicates.push({
    replicateNumber: nextNumber,
    date: new Date().toISOString().split('T')[0],
    gels: []
  })

  // Reseta os índices e volta para a contagem
  currentTreatmentIndex = 0
  currentGelIndex = 0
  startCounting()
}