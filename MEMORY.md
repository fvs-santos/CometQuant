# Memoria do projeto CometQuant

Este documento registra o contexto tecnico e funcional do projeto para continuidade entre sessoes. Ele foi reconstruido a partir do estado da branch `main`, especialmente do commit `0b0779a` de 13/08/2026 (`Add blinded mobile workflow and secure data handling`), que concentrou a reformulacao mais recente do sistema.

## Visao geral

O CometQuant Lab e uma aplicacao movel/PWA para apoiar a avaliacao visual de ensaios cometa. O fluxo cobre:

- configuracao do experimento;
- codificacao cega das laminas;
- contagem de nucleoides nas classes visuais 0 a 4;
- persistencia local e retomada da contagem;
- registro de laminas ausentes ou incompletas com justificativa;
- consolidacao, importacao e exportacao de experimentos;
- calculo do score visual;
- analises estatisticas no navegador;
- geracao de CSV, JSON, relatorio HTML, graficos PNG e pacote ZIP.

A aplicacao e inteiramente client-side. Nao ha backend, autenticacao, banco de dados remoto ou etapa de build. Os dados permanecem no navegador, salvo quando o usuario os exporta.

## Arquitetura

A pagina principal e `index.html`. Os scripts sao carregados como JavaScript tradicional e compartilham estado e funcoes globais; a ordem das tags `script` e relevante. Nao ha ES modules, framework, bundler ou TypeScript.

### Modulos principais

- `js/core.js`: regras de dominio, schema, migracao, validacao, score, agregacao de laminas tecnicas e consolidacao de experimentos. Tambem oferece compatibilidade CommonJS para os testes em Node.
- `js/app.js`: navegacao, estado da interface, setup, geracao dos codigos cegos, contagem, undo, autosave, resumo, importacao e exportacao JSON.
- `js/export.js`: serializacao canonica de CSV e relatorio, escape HTML, neutralizacao de formulas de planilha, validacao de PNG e nomes de arquivo seguros.
- `js/analysis.js`: inicializacao do Pyodide, codigo Python das analises, apresentacao dos resultados, graficos e exportacao do pacote final.
- `js/i18n.js`: traducoes em portugues e ingles e persistencia do idioma escolhido.
- `css/style.css`: interface mobile-first e tema escuro pensado para uso proximo ao microscopio.
- `service-worker.js`: cache do shell da PWA.
- `manifest.json`: metadados de instalacao da PWA.

### Dependencias e runtime

- HTML5, CSS3 e JavaScript sem framework.
- APIs de DOM, `localStorage`, FileReader, Blob, Web Crypto, Cache API e Service Worker.
- Pyodide 0.26.2 por CDN.
- NumPy, SciPy e Matplotlib carregados pelo Pyodide.
- JSZip 3.10.1 vendorizado em `vendor/jszip.min.js`.
- Vitest 3.2.4 com jsdom para testes unitarios e de integracao.
- Playwright 1.54.2 para o fluxo E2E em emulacao de Pixel 7.
- `http-server` para servir a aplicacao nos testes E2E.

## Modelo de dados

O schema atual e a versao 3, definida em `js/core.js`.

Um experimento contem, em linhas gerais:

- identificadores, timestamps, status e `schemaVersion`;
- pesquisador, agente, celulas e controles;
- meta de nucleoides por lamina;
- quantidade de laminas por tratamento;
- unidade de concentracao e lista de tratamentos;
- progresso parcial da contagem, quando houver;
- repeticoes com assignments cegas e laminas contabilizadas.

Cada assignment associa um `blindCode` a um tratamento e numero de lamina. Seus estados possiveis sao `pending`, `counting`, `counted` e `absent`. Laminas contabilizadas armazenam `class0` a `class4`, total, estado e indicacao de contagem completa ou incompleta.

Dados antigos sao migrados antes do uso:

- objetos sem versao sao tratados como schema 1;
- versoes futuras sao recusadas;
- laminas legadas abaixo da meta sao marcadas como incompletas com motivo `legacy-unjustified`;
- o status do experimento e recalculado a partir das assignments pendentes.

## Fluxos implementados

### Criacao e codificacao cega

O usuario informa metadados, controles, concentracoes, meta de nucleoides e numero de laminas. A aplicacao cria a primeira repeticao, gera codigos-base aleatorios de quatro caracteres e adiciona sufixos de lamina como `-01` e `-02`.

A geracao usa preferencialmente `crypto.getRandomValues`. O mapa entre tratamento e codigo e mostrado durante a preparacao; depois disso, a tela de contagem trabalha apenas com o codigo cego.

### Contagem e persistencia

Ao informar um codigo valido, a assignment passa a `counting`. Cada incremento de classe e cada undo chamam imediatamente a persistencia. O historico do contador tambem e mantido para permitir undo apos recarregar a pagina.

Ao finalizar uma lamina:

- total igual a meta resulta em contagem `complete`;
- total menor que a meta exige justificativa e resulta em `incomplete`;
- uma lamina ausente tambem exige justificativa.

Laminas incompletas e ausentes sao preservadas para rastreabilidade, mas excluidas das analises.

### Regra de blinding

Enquanto qualquer assignment estiver `pending` ou `counting`, ficam bloqueados:

- resumo que revele tratamentos;
- analise estatistica;
- exportacao JSON;
- CSV, relatorio e ZIP.

Esse bloqueio e uma decisao de fluxo para reduzir revelacao acidental durante a contagem.

### Importacao e consolidacao

A importacao aceita um ou varios JSONs, com limite de 5 MB por arquivo. Um arquivo e importado diretamente; varios sao consolidados.

Experimentos consolidados precisam ter metadados e tratamentos compativeis. Conflitos detectados na mesma lamina/codigo interrompem o merge. Um experimento importado com ID ja existente substitui a copia local.

### Analise cientifica

A regra central e tratar a repeticao como unidade experimental. Laminas tecnicas completas sao primeiro promediadas dentro de cada repeticao, evitando que sejam usadas como replicas independentes na inferencia.

O score visual e calculado por:

```text
(0.25*C1 + 0.50*C2 + 0.75*C3 + 1.00*C4) / alvo * 100
```

Analises atualmente implementadas:

- Shapiro-Wilk quando ha pelo menos tres repeticoes no tratamento;
- one-way ANOVA para grupos com pelo menos dois valores;
- Tukey HSD quando a ANOVA apresenta `p < 0,05`;
- regressao linear e correlacao de Pearson para concentracoes numericas, excluindo controles;
- grafico de score por tratamento;
- grafico de distribuicao das classes.

O codigo comenta equivalencia com um `app.py` original, mas esse arquivo nao faz parte deste repositorio. Alteracoes futuras no protocolo estatistico devem ser validadas contra uma referencia cientifica independente, e nao apenas contra esses comentarios.

## Exportacao e seguranca de saida

As rotinas canonicas de exportacao ficam em `js/export.js`. Elas foram separadas para evitar implementacoes divergentes e incluem:

- escape de conteudo inserido no relatorio HTML;
- neutralizacao de valores que poderiam ser interpretados como formulas por planilhas;
- CSV com BOM e terminacoes CRLF;
- sanitizacao de nomes de arquivo;
- verificacao basica do PNG em base64.

O JSZip e copiado para `vendor/` durante `npm install`, permitindo a geracao do pacote ZIP em hospedagem estatica sem depender de uma CDN para essa biblioteca.

## Persistencia local

Os experimentos sao armazenados em `localStorage` na chave `cometquant-experiments`. O idioma usa `cometquant-language`.

O autosave atual privilegia resiliencia imediata: todo clique e todo undo atualizam e persistem o experimento. Entretanto, a implementacao valida e serializa novamente o conjunto completo de experimentos em cada gravacao. Essa escolha e simples, mas pode causar latencia e atingir a quota do navegador em bases maiores.

## PWA e operacao offline

O shell local e armazenado pelo service worker, cujo cache atual e `cometquant-v4`. A interface de contagem pode funcionar offline depois de instalada e carregada, desde que os recursos locais estejam no cache.

A analise estatistica nao e garantida offline: Pyodide e seus pacotes vem de CDN e nao fazem parte do precache local. O service worker tambem usa uma estrategia cache-first que exige a atualizacao manual do nome do cache quando arquivos locais mudam.

## Trabalho realizado na sessao mais recente

O commit `0b0779a` foi uma alteracao ampla, com 21 arquivos e aproximadamente 5.711 insercoes e 928 remocoes. As principais entregas foram:

- novo fluxo mobile de experimento cego;
- suporte a multiplas laminas por tratamento e repeticoes;
- autosave e restauracao de contagem, incluindo undo;
- registro de ausencia e contagem incompleta com justificativas;
- schema versionado e migracao de dados legados;
- consolidacao de experimentos e deteccao conservadora de conflitos;
- separacao das regras de dominio em `js/core.js`;
- separacao das exportacoes seguras em `js/export.js`;
- protecao de HTML e CSV contra injecao;
- pacote ZIP usando JSZip local;
- testes unitarios, de integracao e E2E;
- configuracao de Vitest, Playwright e verificacao sintatica;
- ajustes de interface, internacionalizacao e service worker.

O commit anterior e de 15/04/2026, portanto `0b0779a` e a melhor referencia disponivel para a ultima sessao de desenvolvimento.

## Testes e comandos

Instalacao:

```powershell
npm install
```

Comandos disponiveis:

```powershell
npm test
npm run test:watch
npm run test:coverage
npm run test:e2e
npm run check
npm run vendor
```

Nao existe script de build, start ou dev. O Playwright inicia `http-server` na porta 4173. Em uma instalacao nova, pode ser necessario instalar o navegador do Playwright separadamente.

A cobertura atual inclui regras centrais, exportacao, protecoes basicas, autosave e um fluxo mobile de criacao/contagem/restauracao. A cobertura esta configurada apenas para `js/core.js` e `js/export.js`; o codigo Python embutido em `js/analysis.js` nao e exercitado automaticamente.

Existe um resultado local do Playwright indicando uma execucao sem falhas, mas ele nao possui timestamp suficiente para garantir correspondencia com o `HEAD`. Ao retomar o desenvolvimento, execute novamente pelo menos `npm run check`, `npm test` e `npm run test:e2e`.

## Decisoes que devem ser preservadas

- A aplicacao e local-first e deve continuar utilizavel como hospedagem estatica, salvo decisao explicita de arquitetura.
- A repeticao, nao a lamina tecnica, e a unidade experimental da inferencia.
- Laminas ausentes ou incompletas exigem justificativa, permanecem auditaveis e nao entram na inferencia.
- O resumo e as exportacoes reveladoras permanecem bloqueados enquanto o experimento nao estiver integralmente contado ou justificado.
- Importacoes passam por migracao e validacao antes de substituir dados locais.
- Conflitos de consolidacao nao devem ser resolvidos silenciosamente.
- Conteudo controlado pelo usuario nao deve ser inserido com `innerHTML`.
- CSVs devem continuar neutralizando formulas de planilha.
- Mudancas de schema exigem incremento de versao e migracao explicita.
- Alteracoes em arquivos precacheados exigem considerar a versao do cache do service worker.

## Armadilhas e riscos conhecidos

### Resultados de analise podem ficar obsoletos

`analysisResults` e uma variavel global e nao esta vinculada de forma robusta ao ID e ao `updatedAt` do experimento. Abrir outro experimento ou modificar os dados depois de analisar pode manter resultados e graficos anteriores em memoria. Isso pode produzir uma exportacao combinando o experimento atual com uma analise antiga.

Antes de ampliar exportacoes, vincular resultados ao experimento e invalidar a analise sempre que os dados relevantes mudarem.

### O blinding nao e criptografico

Apesar do nome do commit mencionar tratamento seguro de dados, o mapeamento entre codigos e tratamentos e armazenado em texto claro no `localStorage`. O bloqueio existe somente na interface. DevTools, acesso ao perfil do navegador ou uma copia do storage revelam o mapa.

O modelo atual deve ser descrito como **blinding operacional contra revelacao acidental**, nao como protecao contra um usuario adversarial. Nao ha autenticacao, criptografia, assinatura, controle de acesso ou separacao tecnica entre codificador e avaliador.

### Nao ha backup durante o blinding

A exportacao JSON e bloqueada enquanto existem assignments pendentes. Como o `localStorage` e a unica persistencia, um experimento longo em andamento nao possui um fluxo oficial de backup ou transferencia que preserve o cegamento. Resolver essa tensao e prioritario antes de uso critico.

### Analise estatistica sem testes automatizados

O Python executado por Pyodide nao possui fixtures de referencia automatizadas. Casos de variancia zero, grupos constantes, grupos insuficientes, apenas uma concentracao, correlacao perfeita e retornos `NaN` ou `Infinity` precisam de tratamento explicito.

`json.dumps` pode emitir `NaN`, que nao e JSON valido para `JSON.parse` no JavaScript. Uma analise degenerada pode, portanto, falhar na fronteira Python/JavaScript.

### Unidade experimental inconsistente no grafico de classes

A inferencia agrega laminas tecnicas por repeticao, mas o grafico de classes agrega diretamente todas as laminas completas. Isso pode dar maior peso a repeticoes com mais laminas validas e mostrar variabilidade entre laminas tecnicas, em vez de variabilidade entre repeticoes. A unidade e o significado do desvio-padrao devem ser definidos cientificamente antes de alterar o grafico.

### Nova repeticao pode ser criada cedo demais

O fluxo de adicionar repeticao nao impede de forma clara a criacao enquanto a repeticao anterior ainda possui assignments pendentes. Isso pode gerar varias repeticoes abertas e manter todas as funcoes reveladoras bloqueadas.

### Consolidacao pode perder progresso parcial

O merge zera `result.progress`, embora assignments possam permanecer com status `counting`. Contagens parciais existentes apenas no objeto de progresso podem ser descartadas ao consolidar arquivos. Nao alterar essa area sem definir uma politica explicita para progresso concorrente.

### Invariantes do schema ainda sao incompletas

A validacao nao garante integralmente:

- exatamente `tratamentos x laminas` assignments por repeticao;
- unicidade de `(treatmentIndex, gelNumber)`;
- uma lamina correspondente para toda assignment `counted`;
- ausencia de laminas duplicadas;
- correspondencia bidirecional completa entre assignment e lamina.

Um JSON estruturalmente parcial pode parecer concluido se nao contiver assignments `pending` ou `counting`.

### Dados locais nao sao sempre validados integralmente

A leitura do `localStorage` realiza migracao, mas nao necessariamente a validacao completa antes de listar os experimentos. Dados corrompidos podem ser exibidos e falhar apenas durante gravacao ou processamento posterior.

### Autosave pode nao escalar

Cada clique valida o experimento, recupera os demais, serializa o conjunto completo e grava sincronicamente no `localStorage`. Monitorar responsividade e quota antes de aumentar o volume suportado. IndexedDB ou persistencia por experimento podem ser necessarios.

### PWA pode servir versoes antigas

A estrategia cache-first pode manter arquivos anteriores se `CACHE_NAME` nao mudar. Nao ha fluxo sofisticado de atualizacao com `skipWaiting()` e `clients.claim()`. Toda release que altere recursos precacheados deve revisar o service worker.

### Dependencia externa da analise

Pyodide e carregado por CDN sem SRI e nao existe Content Security Policy. Isso afeta reproducibilidade, disponibilidade offline e o modelo de seguranca para dados de pesquisa potencialmente sensiveis.

### Documentacao e versoes divergentes

- `package.json` declara versao `1.1.0`, enquanto a interface ainda apresenta `v1.0` em traducoes.
- `README.md` descreve apenas instalacao e testes, sem arquitetura, deploy ou protocolo estatistico.
- `Notas - apagar apos fim do projeto.txt` ainda lista a codificacao cega como pendencia, embora ela ja tenha sido implementada.
- A nota sobre substituir os icones das classes permanece valida; os botoes ainda usam SVGs esquematicos provisorios.

## Proximos passos recomendados

Ordem sugerida para continuidade:

1. Vincular `analysisResults` ao ID e a versao/timestamp do experimento e invalidar resultados em qualquer alteracao relevante.
2. Definir formalmente o modelo de ameaca do blinding e implementar um backup cego que nao exponha tratamentos.
3. Criar testes de referencia para o codigo estatistico, incluindo casos degenerados e comparacao com resultados conhecidos em Python ou R.
4. Decidir e documentar a unidade experimental usada por cada grafico e estatistica.
5. Fortalecer as invariantes do schema e validar integralmente dados recuperados do storage.
6. Rever o merge para preservar ou rejeitar explicitamente progresso parcial, sem descarte silencioso.
7. Impedir ou confirmar explicitamente a criacao de nova repeticao antes da conclusao da anterior.
8. Avaliar IndexedDB ou persistencia granular para reduzir custo de autosave e risco de quota.
9. Definir se a analise precisa funcionar offline; se sim, hospedar e cachear Pyodide e pacotes de forma controlada.
10. Criar CI para `npm run check`, testes unitarios, cobertura e E2E.
11. Expandir o README com arquitetura, schema, fluxo cego, protocolo estatistico, deploy e estrategia de atualizacao da PWA.
12. Substituir os SVGs provisorios por imagens cientificamente adequadas e testar acessibilidade/touch.
13. Sincronizar a versao exibida na UI com `package.json` e remover notas obsoletas.

## Arquivos de referencia

- `README.md`
- `Notas - apagar apos fim do projeto.txt`
- `package.json`
- `index.html`
- `js/core.js`
- `js/app.js`
- `js/analysis.js`
- `js/export.js`
- `js/i18n.js`
- `css/style.css`
- `service-worker.js`
- `manifest.json`
- `vitest.config.js`
- `playwright.config.js`
- `tests/unit/core.test.js`
- `tests/unit/export.test.js`
- `tests/integration/persistence.test.js`
- `tests/e2e/experiment-flow.spec.js`

## Estado no momento deste registro

- Branch: `main`.
- Referencia principal: commit `0b0779a` de 13/08/2026.
- A implementacao aparenta estar funcional, mas ainda nao deve ser tratada como software cientifico validado para producao.
- Nao ha CI, politica de deploy, matriz formal de navegadores, protocolo estatistico versionado ou validacao independente da analise.
- O principal item funcional remanescente registrado pelo projeto e melhorar as imagens das classes de cometas.
