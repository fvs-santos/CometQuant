// =============================================
// COMETQUANT LAB — app.js
// =============================================


// =============================================
// PARTE 1 — INICIALIZAÇÃO
// =============================================

document.addEventListener('DOMContentLoaded', () => {

  applyLanguage()
  updateLanguageButtons()
  initNavigation()
  initSetup()
  initCounter()
  initSummary()

  console.log('CometQuant Lab initialized')
})


// =============================================
// PARTE 2 — NAVEGAÇÃO ENTRE TELAS
// =============================================

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active')
  })

  const target = document.getElementById(screenId)
  if (target) {
    target.classList.add('active')
    target.scrollTop = 0
  }
}


function updateLanguageButtons() {
  document.getElementById('btn-lang-en').classList.toggle('active', currentLanguage === 'en')
  document.getElementById('btn-lang-pt').classList.toggle('active', currentLanguage === 'pt')
}


const _setLanguage = setLanguage
window.setLanguage = function(lang) {
  _setLanguage(lang)
  updateLanguageButtons()
}


function initNavigation() {

  document.getElementById('btn-new-experiment')
    .addEventListener('click', () => {
      resetSetupForm()
      showScreen('screen-setup')
    })

  document.getElementById('btn-resume-experiment')
    .addEventListener('click', () => {
      document.getElementById('input-load-files').click()
    })

  document.getElementById('btn-back-setup')
    .addEventListener('click', () => showScreen('screen-home'))

  document.getElementById('btn-back-counter')
    .addEventListener('click', () => {
      const msg = currentLanguage === 'pt'
        ? 'Voltar para configuração? Os dados da lâmina atual serão perdidos.'
        : 'Return to setup? Current slide data will be lost.'
      if (confirm(msg)) {
        showScreen('screen-setup')
      }
    })

  document.getElementById('btn-back-summary')
    .addEventListener('click', () => showScreen('screen-home'))

  document.getElementById('btn-back-analysis')
    .addEventListener('click', () => showScreen('screen-summary'))

  document.getElementById('btn-go-to-analysis')
    .addEventListener('click', () => showScreen('screen-analysis'))
}


// =============================================
// PARTE 3 — CONFIGURAÇÃO DO EXPERIMENTO
// =============================================

let currentExperiment = null
let currentTreatmentIndex = 0
let currentGelIndex = 0


function initSetup() {
  document.getElementById('input-conditions')
    .addEventListener('input', generateConcentrationInputs)

  document.getElementById('btn-start-counting')
    .addEventListener('click', handleStartCounting)
}


function generateConcentrationInputs() {
  const container = document.getElementById('concentrations-container')
  const n = parseInt(document.getElementById('input-conditions').value) || 0
  const unit = document.getElementById('input-conc-unit').value

  container.innerHTML = ''

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


function handleStartCounting() {

  const researcher = document.getElementById('input-researcher').value.trim()
  const agent      = document.getElementById('input-agent').value.trim()
  const cells      = document.getElementById('input-cells').value.trim()
  const negControl = document.getElementById('input-neg-control').value.trim()
  const posControl = document.getElementById('input-pos-control').value.trim()
  const solControl = document.getElementById('input-sol-control').value.trim()
  const nucleoids  = parseInt(document.getElementById('input-nucleoids').value)
  const conditions = parseInt(document.getElementById('input-conditions').value)
  const concUnit   = document.getElementById('input-conc-unit').value

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

  const treatments = []

  if (posControl) treatments.push(posControl)
  if (negControl) treatments.push(negControl)
  if (solControl) treatments.push(solControl)

  for (let i = 0; i < conditions; i++) {
    const val = document.getElementById(`input-conc-${i}`).value
    treatments.push(`${val} ${concUnit}`)
  }

  currentExperiment = {
    id: `exp_${Date.now()}`,
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
        date: new Date().toISOString().split('T')[0],
        gels: []
      }
    ]
  }

  saveExperiment()

  currentTreatmentIndex = 0
  currentGelIndex = 0
  startCounting()
}


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

let clickHistory = []
let currentCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }


function initCounter() {

  document.querySelectorAll('.comet-class-card').forEach(card => {
    card.addEventListener('click', () => {
      const cometClass = parseInt(card.getAttribute('data-class'))
      registerCount(cometClass)
    })
  })

  document.getElementById('btn-undo')
    .addEventListener('click', undoLastCount)

  document.getElementById('btn-finish-gel')
    .addEventListener('click', handleFinishGel)
}


// Inicia a contagem para o tratamento/lâmina atual
function startCounting() {
  currentCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
  clickHistory = []

  // CORREÇÃO: remove o estado 'complete' garantindo tela limpa para nova lâmina
  // Usamos setTimeout para garantir que a remoção ocorre APÓS showScreen()
  // que pode reativar a tela e reprocessar estilos
  setTimeout(() => {
    const screen = document.getElementById('screen-counter')
    screen.classList.remove('complete')
  }, 0)

  updateCounterDisplay()
  showScreen('screen-counter')
}


function registerCount(cometClass) {
  const nucleoids = currentExperiment.nucleoidsPerGel
  const total = getTotalCount()

  if (total >= nucleoids) {
    const card = document.getElementById(`card-class-${cometClass}`)
    card.classList.add('pulse')
    setTimeout(() => card.classList.remove('pulse'), 600)
    return
  }

  currentCounts[cometClass]++
  clickHistory.push(cometClass)

  updateCounterDisplay()

  const card = document.getElementById(`card-class-${cometClass}`)
  card.classList.add('pulse')
  setTimeout(() => card.classList.remove('pulse'), 300)
}


function undoLastCount() {
  if (clickHistory.length === 0) return

  const lastClass = clickHistory.pop()

  if (currentCounts[lastClass] > 0) {
    currentCounts[lastClass]--
  }

  updateCounterDisplay()
}


function getTotalCount() {
  return Object.values(currentCounts).reduce((sum, val) => sum + val, 0)
}


// Atualiza todos os elementos visuais do contador
function updateCounterDisplay() {
  const treatment = currentExperiment.treatments[currentTreatmentIndex]
  const nucleoids = currentExperiment.nucleoidsPerGel
  const total = getTotalCount()
  const gelNumber = currentGelIndex + 1

  document.getElementById('counter-treatment-name').textContent = treatment

  const gelLabel = currentLanguage === 'pt'
    ? `Lâmina ${gelNumber}`
    : `Slide ${gelNumber}`
  document.getElementById('counter-gel-label').textContent = gelLabel

  document.getElementById('counter-progress').textContent =
    `${total} / ${nucleoids} ${t('counter.nucleoids')}`

  const percent = (total / nucleoids) * 100
  document.getElementById('progress-bar').style.width = `${percent}%`

  for (let i = 0; i <= 4; i++) {
    document.getElementById(`count-${i}`).textContent = currentCounts[i]
  }

  const bar = document.getElementById('progress-bar')
  const screen = document.getElementById('screen-counter')

  // CORREÇÃO: aplica/remove a classe 'complete' na tela inteira
  // A classe 'complete' no CSS muda o fundo para verde escuro
  if (total >= nucleoids) {
    bar.style.backgroundColor = 'var(--color-success)'
    screen.classList.add('complete')
  } else {
    bar.style.backgroundColor = 'var(--color-accent)'
    screen.classList.remove('complete')
  }
}


function handleFinishGel() {
  const nucleoids = currentExperiment.nucleoidsPerGel
  const total = getTotalCount()

  if (total < nucleoids) {
    const msg = currentLanguage === 'pt'
      ? `Apenas ${total} de ${nucleoids} nucleoides contados. Deseja finalizar mesmo assim?`
      : `Only ${total} of ${nucleoids} nucleoids counted. Finish anyway?`
    if (!confirm(msg)) return
  }

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

  const lastReplicate = currentExperiment.replicates[currentExperiment.replicates.length - 1]
  lastReplicate.gels.push(gelData)

  saveExperiment()
  moveToNextGelOrTreatment()
}


function moveToNextGelOrTreatment() {
  currentTreatmentIndex++

  if (currentTreatmentIndex < currentExperiment.treatments.length) {
    currentGelIndex = 0
    startCounting()
  } else {
    showSummary()
  }
}


// =============================================
// PARTE 5 — ARMAZENAMENTO (localStorage)
// =============================================

const STORAGE_KEY = 'cometquant-experiments'


function saveExperiment() {
  let experiments = getAllExperiments()
  const index = experiments.findIndex(e => e.id === currentExperiment.id)

  if (index >= 0) {
    experiments[index] = currentExperiment
  } else {
    experiments.push(currentExperiment)
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(experiments))
}


function getAllExperiments() {
  const data = localStorage.getItem(STORAGE_KEY)
  return data ? JSON.parse(data) : []
}


// =============================================
// PARTE 6 — RESUMO E EXPORTAÇÃO
// =============================================

function initSummary() {
  document.getElementById('btn-export-experiment')
    .addEventListener('click', exportExperiment)

  document.getElementById('btn-add-replicate')
    .addEventListener('click', handleAddReplicate)

  // Conecta o botão de retomar ao input de arquivo oculto
  document.getElementById('btn-resume-experiment')
    .addEventListener('click', () => {
      document.getElementById('input-load-files').click()
    })

  // Quando o usuário seleciona os arquivos
  document.getElementById('input-load-files')
    .addEventListener('change', handleLoadFiles)

    initAnalysis()
}


// Lida com o carregamento de um ou mais arquivos .json
function handleLoadFiles(event) {
  const files = Array.from(event.target.files)

  if (files.length === 0) return

  // Lê todos os arquivos selecionados em paralelo
  // Promise.all espera todos terminarem antes de continuar
  // Equivalente em Python seria: asyncio.gather(*tasks)
  const readers = files.map(file => readJsonFile(file))

  Promise.all(readers)
    .then(experiments => {
      if (files.length === 1) {
        // Um único arquivo — carrega direto
        currentExperiment = experiments[0]
        saveExperiment()
        showSummary()

      } else {
        // Múltiplos arquivos — tenta consolidar
        const consolidated = consolidateExperiments(experiments)
        if (consolidated) {
          currentExperiment = consolidated
          saveExperiment()
          showSummary()
        }
      }
    })
    .catch(() => alert(t('alert.importError')))

  // Limpa o input para permitir selecionar os mesmos arquivos novamente
  event.target.value = ''
}


// Lê um arquivo .json e retorna uma Promise com o objeto parseado
// Promise é o mecanismo JavaScript para operações assíncronas
// Equivalente em Python: seria uma coroutine com async/await
function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        // Valida que é um arquivo CometQuant legítimo
        if (!data.id || !data.treatments || !data.replicates) {
          reject(new Error('Invalid file'))
          return
        }
        resolve(data)
      } catch {
        reject(new Error('Parse error'))
      }
    }

    reader.onerror = () => reject(new Error('Read error'))
    reader.readAsText(file)
  })
}


// Consolida múltiplos arquivos de repetições do mesmo experimento
function consolidateExperiments(experiments) {

  // Verifica se todos os arquivos são do mesmo experimento
  // Compara agente e tipo celular — os identificadores mais confiáveis
  const reference = experiments[0]

  for (let i = 1; i < experiments.length; i++) {
    if (
      experiments[i].agent !== reference.agent ||
      experiments[i].cells !== reference.cells
    ) {
      alert(t('alert.invalidAgent'))
      return null
    }
  }

  // Coleta todas as repetições de todos os arquivos
  // "flat()" achata um array de arrays em um único array
  // Equivalente em Python: [rep for exp in experiments for rep in exp.replicates]
  const allReplicates = experiments.flatMap(exp => exp.replicates)

  // Remove repetições duplicadas mantendo a mais recente
  // Um Map garante chaves únicas — se o número de repetição
  // aparecer duas vezes, a segunda sobrescreve a primeira
  const replicateMap = new Map()

  allReplicates.forEach(rep => {
    const existing = replicateMap.get(rep.replicateNumber)
    if (!existing || rep.date > existing.date) {
      replicateMap.set(rep.replicateNumber, rep)
    }
  })

  // Verifica se havia duplicatas para avisar o usuário
  if (replicateMap.size < allReplicates.length) {
    alert(t('alert.duplicateRep'))
  }

  // Monta o experimento consolidado baseado no arquivo mais recente
  // e substitui as repetições pela versão consolidada e ordenada
  const consolidated = {
    ...reference,  // copia todos os campos do arquivo de referência
    id: `exp_${Date.now()}`,  // novo ID para o consolidado
    replicates: Array.from(replicateMap.values())
      .sort((a, b) => a.replicateNumber - b.replicateNumber)
  }

  return consolidated
}


// Mantém a função antiga como fallback para localStorage
// (usada internamente quando há dados locais)
function handleResumeExperiment() {
  document.getElementById('input-load-files').click()
}


// Lida com o carregamento de um ou mais arquivos .json
function handleLoadFiles(event) {
  const files = Array.from(event.target.files)

  if (files.length === 0) return

  // Lê todos os arquivos em paralelo usando Promise.all
  // Equivalente Python: asyncio.gather(*[read(f) for f in files])
  const readers = files.map(file => readJsonFile(file))

  Promise.all(readers)
    .then(experiments => {
      if (files.length === 1) {
        // Um único arquivo — carrega direto
        currentExperiment = experiments[0]
        saveExperiment()
        showSummary()

      } else {
        // Múltiplos arquivos — tenta consolidar repetições
        const consolidated = consolidateExperiments(experiments)
        if (consolidated) {
          currentExperiment = consolidated
          saveExperiment()
          showSummary()
        }
      }
    })
    .catch(() => alert(t('alert.importError')))

  // Limpa o input para permitir selecionar os mesmos arquivos de novo
  event.target.value = ''
}


// Lê um arquivo .json e retorna uma Promise com o objeto parseado
// FileReader é assíncrono — por isso precisamos da Promise
function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        // Valida estrutura mínima de um arquivo CometQuant
        if (!data.id || !data.treatments || !data.replicates) {
          reject(new Error('Invalid CometQuant file'))
          return
        }
        resolve(data)
      } catch {
        reject(new Error('JSON parse error'))
      }
    }

    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsText(file)
  })
}


// Consolida múltiplos arquivos de repetições do mesmo experimento
function consolidateExperiments(experiments) {

  // Verifica se todos os arquivos são do mesmo experimento
  const reference = experiments[0]

  for (let i = 1; i < experiments.length; i++) {
    if (
      experiments[i].agent !== reference.agent ||
      experiments[i].cells !== reference.cells
    ) {
      alert(t('alert.invalidAgent'))
      return null
    }
  }

  // Coleta todas as repetições de todos os arquivos
  // flatMap = map + flat: equivalente a [rep for exp in experiments for rep in exp.replicates]
  const allReplicates = experiments.flatMap(exp => exp.replicates)

  // Usa Map para deduplicar por número de repetição
  // Se o mesmo número aparecer duas vezes, mantém o mais recente (maior data)
  const replicateMap = new Map()

  allReplicates.forEach(rep => {
    const existing = replicateMap.get(rep.replicateNumber)
    if (!existing || rep.date > existing.date) {
      replicateMap.set(rep.replicateNumber, rep)
    }
  })

  if (replicateMap.size < allReplicates.length) {
    alert(t('alert.duplicateRep'))
  }

  // Spread operator (...reference) copia todos os campos do objeto de referência
  // Equivalente Python: {**reference, 'id': novo_id, 'replicates': lista}
  const consolidated = {
    ...reference,
    id: `exp_${Date.now()}`,
    replicates: Array.from(replicateMap.values())
      .sort((a, b) => a.replicateNumber - b.replicateNumber)
  }

  return consolidated
}


function showSummary() {
  renderSummaryTable()
  showScreen('screen-summary')
}


function renderSummaryTable() {
  const container = document.getElementById('summary-table-container')

  if (!currentExperiment) {
    container.innerHTML = ''
    return
  }

  let html = ''

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
// Fórmula: score = (0*c0 + 0.25*c1 + 0.5*c2 + 0.75*c3 + 1*c4) / nucleoidsPerGel * 100
function calculateScore(gel) {
  if (!gel.total || gel.total === 0) return 0
  return (
    (0    * gel.class0 +
     0.25 * gel.class1 +
     0.5  * gel.class2 +
     0.75 * gel.class3 +
     1    * gel.class4)
    / currentExperiment.nucleoidsPerGel
  ) * 100
}


function exportExperiment() {
  if (!currentExperiment) return

  const json = JSON.stringify(currentExperiment, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const repNumber = currentExperiment.replicates.length
  const today = new Date().toISOString().split('T')[0]

  a.href     = url
  a.download = `CometQuant_${currentExperiment.agent}_${currentExperiment.cells}_Rep${repNumber}_${today}.json`
  a.click()

  URL.revokeObjectURL(url)
}


function handleAddReplicate() {
  if (!currentExperiment) return

  const nextNumber = currentExperiment.replicates.length + 1

  currentExperiment.replicates.push({
    replicateNumber: nextNumber,
    date: new Date().toISOString().split('T')[0],
    gels: []
  })

  currentTreatmentIndex = 0
  currentGelIndex = 0
  startCounting()
}
