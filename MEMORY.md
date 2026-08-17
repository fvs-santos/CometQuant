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
- `js/repository.js`: IndexedDB autoritativo, migracao do `localStorage`, quarentena, revisoes, tombstones, mirror de transicao e notificacao entre abas.
- `js/export.js`: serializacao canonica de CSV e relatorio, escape HTML, neutralizacao de formulas de planilha, validacao de PNG e nomes de arquivo seguros.
- `js/analysis.js`: estados da interface cientifica, comunicacao com o worker, apresentacao dos resultados, graficos e exportacao do pacote final.
- `js/analysis-worker.js`: inicializacao isolada do Pyodide e execucao do motor estatistico fora da thread principal.
- `js/science-package.js`: instalacao opcional, verificacao SHA-256 e gerenciamento do cache cientifico.
- `js/i18n.js`: traducoes em portugues e ingles e persistencia do idioma escolhido.
- `css/style.css`: interface mobile-first e tema escuro pensado para uso proximo ao microscopio.
- `service-worker.js`: cache do shell da PWA.
- `manifest.json`: metadados de instalacao da PWA.

### Dependencias e runtime

- HTML5, CSS3 e JavaScript sem framework.
- APIs de DOM, IndexedDB, `localStorage`, BroadcastChannel, Web Locks, FileReader, Blob, Web Crypto, Cache API, Web Worker e Service Worker.
- Pyodide 0.26.2 baixado sob demanda de URLs pinadas e executado do cache local apos verificacao.
- NumPy 1.26.4, SciPy 1.12.0 e Matplotlib 3.5.2 carregados pelo Pyodide.
- JSZip 3.10.1 vendorizado em `vendor/jszip.min.js`.
- Vitest 3.2.4 com jsdom para testes unitarios e de integracao.
- Playwright 1.54.2 para o fluxo E2E em emulacao de Pixel 7.
- `http-server` para servir a aplicacao nos testes E2E.

## Modelo de dados

O schema atual e a versao 4, definida em `js/core.js`.

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

O usuario informa metadados, controles, concentracoes, meta de nucleoides e numero de laminas. A aplicacao cria a primeira repeticao e gera codigos com duas letras ordenadas e o numero da lamina sem hifen ou zero a esquerda, como `AB1`, `AB2` e `CY10`.

As 676 bases de `AA` a `ZZ` sao sorteadas sem reposicao no experimento inteiro. Uma nova repeticao e bloqueada se nao houver bases suficientes para todos os tratamentos. Codigos legados como `ABCD-01` continuam validos e sao preservados sem alteracao em migracoes, importacoes e backups.

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

Os experimentos sao armazenados como documentos atomicos no IndexedDB. A chave legada `cometquant-experiments` e migrada na primeira abertura e mantida temporariamente como espelho de compatibilidade. O idioma usa `cometquant-language`.

O autosave privilegia resiliencia imediata: todo clique e todo undo entram em uma fila e persistem um documento validado. Revisoes monotonicas e compare-and-swap impedem sobrescritas silenciosas entre abas.

## PWA e operacao offline

O shell local e armazenado pelo service worker em um cache separado do runtime cientifico. A interface de contagem funciona offline depois de instalada e carregada.

A analise estatistica usa um pacote opcional pinado e verificado por SHA-256. Depois da preparacao explicita, Pyodide, NumPy, SciPy e Matplotlib executam em Web Worker apos reload totalmente offline.

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

### O blinding nao e criptografico

O mapeamento entre codigos e tratamentos e armazenado em texto claro no IndexedDB. O bloqueio existe somente na interface. DevTools, acesso ao perfil do navegador ou uma copia do perfil revelam o mapa.

O modelo atual deve ser descrito como **blinding operacional contra revelacao acidental**, nao como protecao contra um usuario adversarial. Nao ha autenticacao, criptografia, assinatura, controle de acesso ou separacao tecnica entre codificador e avaliador.

### Concorrencia nao faz merge automatico

Revisoes monotonicas, compare-and-swap e `BroadcastChannel` impedem last-write-wins silencioso. Se duas abas alterarem o mesmo experimento, a aba desatualizada interrompe a edicao e exige recarga. Nao existe merge automatico de contagens concorrentes.

### IndexedDB e Cache Storage nao sao backup

Os dois compartilham a quota da origem e podem ser removidos sob pressao de armazenamento ou por acao do usuario. O mirror em `localStorage` existe apenas para a transicao e nao e fonte autoritativa. O backup criptografado continua necessario para recuperacao e transferencia.

### Pacote cientifico depende de instalacao inicial

O shell e a contagem nao carregam Pyodide. Para analisar, o usuario precisa preparar uma vez o pacote pinado: cerca de 35,7 MB transferidos e 104,4 MB armazenados. Os artefatos vem inicialmente do jsDelivr, mas cada corpo e validado por tamanho e SHA-256 antes de ser ativado. Alterar Pyodide ou pacotes exige nova revisao do manifesto `science-assets.json`, novas URLs virtuais e repeticao da validacao cientifica.

### Compatibilidade inicial restrita ao Chromium

A automacao usa Chromium com emulacao Pixel 7. Safari/iOS ainda nao foi validado para quota, Cache Storage, Web Locks, service worker ou memoria do runtime cientifico.

### Uso cientifico critico exige revisao externa

As referencias automatizadas com SciPy, R e Pyodide reduzem risco de regressao, mas nao substituem validacao regulatoria, revisao independente do protocolo estatistico ou politica formal de deploy.

### Assets das classes aguardam otimizacao

O usuario criou `icons/class_0.png` a `icons/class_4.png`, com mapeamento direto para as cinco classes. Os originais sao PNG RGB de 1254 x 1254, sem transparencia, com moldura e fundo incorporados e total aproximado de 2,66 MiB. `class_3.png` possui escala visual maior que as demais.

A decisao para a proxima continuidade e **otimizar antes de usar**: reexportar em 512 x 512, com transparencia, margens e enquadramento uniformes; depois substituir apenas os SVGs inline, manter IDs e `data-class`, adicionar os assets ao precache e incrementar o cache do shell. `teste_icones.png` e `teste_icones_azul.png` sao apenas montagens de comparacao e nao devem integrar o produto.

### Feedback tatil planejado

E viavel adicionar um pulso curto com `navigator.vibrate(10)` em Android/Chromium. A vibracao deve ocorrer somente quando um clique de contagem for aceito, nunca para cliques ignorados, durante o fechamento da lamina ou depois de atingir a meta. A indisponibilidade ou falha da API nao pode bloquear nem alterar a persistencia da contagem.

O plano e oferecer uma preferencia local **Feedback tatil**, habilitada por padrao apenas quando `navigator.vibrate` existir e com opcao para desativar. A chamada deve permanecer separada do commit IndexedDB para nao atrasar o feedback nem enfraquecer o autosave. Safari/iOS nao possui suporte confiavel e deve usar fallback silencioso.

Os testes automatizados devem injetar um mock de `navigator.vibrate`, confirmar um pulso de 10 ms por contagem aceita e ausencia de chamadas em operacoes rejeitadas. A sensacao, intensidade e comportamento com configuracoes do sistema precisam de verificacao manual em um dispositivo Android real; Playwright nao consegue validar o motor fisico.

## Proximos passos recomendados

Concluido na continuidade de 14/08/2026:

- resultados estatisticos vinculados ao ID e timestamp do experimento;
- persistencia transacional com bloqueio da navegacao e tentativa posterior em caso de falha;
- invariantes bidirecionais entre assignments e laminas, validacao do storage e migracao pre-v3 idempotente;
- limite de 100 laminas e concentracoes vazias corrigidos;
- motor estatistico extraido para `python/cometquant_analysis.py` e executado pelo Pyodide;
- casos estatisticos degenerados retornam motivos explicitos e nao serializam valores nao finitos;
- valores-p preservam precisao e o poder de Pearson usa distribuicao t nao central;
- laminas tecnicas sao agregadas por repeticao tanto na inferencia quanto no grafico de classes;
- fixture estatistica versionada foi comparada automaticamente com SciPy e R 4.6.1;
- testes reais cobrem Python, R, Pyodide no navegador, falha de quota e legado parcial;
- merge rejeita progresso parcial e codigos divergentes para a mesma lamina logica;
- nova repeticao e bloqueada enquanto houver laminas pendentes;
- CI criada para JavaScript, cobertura, Python, R e E2E;
- README expandido e versao da interface sincronizada em `1.1.0`;
- backup cego criptografado implementado com PBKDF2-SHA-256 e AES-256-GCM, incluindo restauracao testada no navegador.

Concluido na continuidade posterior de 14/08/2026:

- IndexedDB passou a ser a camada autoritativa, com migracao copy-first do `localStorage`, quarentena e exportacao de recuperacao;
- revisoes monotonicas e compare-and-swap impedem sobrescrita silenciosa entre abas;
- autosave permanece por clique e cada operacao aguarda o commit antes de avancar a interface;
- Pyodide deixou de ser carregado na abertura da PWA e passou a executar em Web Worker;
- o pacote cientifico opcional e pinado por versao e SHA-256, com 35,7 MB transferidos e cerca de 104,4 MB armazenados;
- apos a preparacao explicita, a analise estatistica funciona depois de reload totalmente offline;
- caches de shell e ciencia foram separados e atualizacoes do shell preservam o runtime cientifico;
- toques rapidos sao enfileirados, migracoes iniciais entre abas sao serializadas e exclusoes mantem tombstones revisionados;
- Playwright cobre migracao, falha de commit, conflito entre abas e analise offline real;
- a verificacao final passou com 37 testes JavaScript, 94,49% de cobertura global, 12 testes Python, 28 metricas comparadas com R e 7 cenarios Playwright.

Ordem sugerida para a proxima continuidade:

1. Otimizar `icons/class_0.png` a `icons/class_4.png`, substituir os SVGs e testar acessibilidade, touch, 320 px, Pixel 7 e reload offline.
2. Implementar a preferencia de feedback tatil e o pulso de 10 ms para cada contagem aceita, com testes automatizados e validacao manual em Android.
3. Definir politica de deploy e revisao externa do protocolo cientifico.
4. Avaliar Safari/iOS em uma fase especifica de compatibilidade e quota.

## Arquivos de referencia

- `README.md`
- `package.json`
- `index.html`
- `js/core.js`
- `js/app.js`
- `js/repository.js`
- `js/backup.js`
- `js/analysis.js`
- `js/analysis-worker.js`
- `js/science-package.js`
- `science-assets.json`
- `python/cometquant_analysis.py`
- `js/export.js`
- `js/i18n.js`
- `css/style.css`
- `icons/class_0.png` a `icons/class_4.png` (fontes para a proxima otimizacao; ainda nao referenciadas pela interface)
- `service-worker.js`
- `manifest.json`
- `vitest.config.js`
- `playwright.config.js`
- `tests/unit/core.test.js`
- `tests/unit/export.test.js`
- `tests/unit/repository.test.js`
- `tests/unit/science-package.test.js`
- `tests/integration/persistence.test.js`
- `tests/e2e/experiment-flow.spec.js`
- `tests/e2e/analysis-flow.spec.js`
- `tests/e2e/backup-flow.spec.js`
- `tests/e2e/storage-concurrency.spec.js`
- `tests/python/test_cometquant_analysis.py`
- `tests/reference/v1/`
- `.github/workflows/ci.yml`

## Estado no momento deste registro

- Branch: `main`.
- A continuidade atual implementa IndexedDB, pacote cientifico offline opcional, Web Worker, concorrencia entre abas e os testes correspondentes; consultar `git log` para o commit publicado ao fim da sessao.
- A implementacao possui validacao estatistica automatizada independente, mas ainda nao deve ser tratada como software validado para uso regulatorio ou producao critica.
- Ha CI automatizada, mas ainda nao ha politica de deploy, matriz formal de navegadores ou protocolo cientifico revisado externamente.
- O backup exportado e criptografado, mas IndexedDB permanece em texto claro. O CDN e necessario apenas para instalar o pacote cientifico pinado; depois da verificacao de integridade, o runtime funciona offline.
