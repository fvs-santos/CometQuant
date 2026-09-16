# Memoria do projeto CometQuant

Este documento registra o contexto tecnico e funcional do projeto para continuidade entre sessoes. Ele foi reconstruido a partir do estado da branch `main`, especialmente do commit `0b0779a` de 13/08/2026 (`Add blinded mobile workflow and secure data handling`), que concentrou a reformulacao mais recente do sistema.

## Visao geral

O CometQuant Lab e uma aplicacao movel/PWA para apoiar a avaliacao visual de ensaios cometa. O fluxo cobre:

- configuracao do experimento;
- codificacao cega das laminas;
- contagem de nucleoides nas classes visuais 0 a 4;
- persistencia local e retomada da contagem;
- registro de laminas ausentes ou incompletas com justificativa;
- correcao auditavel de laminas finalizadas, com responsavel, justificativa e estados anterior/posterior;
- consolidacao, importacao JSON, importacao de planilhas XLSX legadas e exportacao de experimentos;
- calculo do score visual;
- analises estatisticas no navegador;
- geracao de CSV, JSON, relatorio HTML, graficos PNG e pacote ZIP.

A aplicacao e inteiramente client-side. Nao ha backend, autenticacao, banco de dados remoto ou etapa de build. Os dados permanecem no navegador, salvo quando o usuario os exporta.

## Arquitetura

A pagina principal e `index.html`. Os scripts sao carregados como JavaScript tradicional e compartilham estado e funcoes globais; a ordem das tags `script` e relevante. Nao ha ES modules, framework, bundler ou TypeScript.

### Modulos principais

- `js/core.js`: regras de dominio, schema, migracao, validacao, snapshots e transicoes de correcoes auditaveis, score, agregacao de laminas tecnicas e consolidacao de experimentos. Tambem oferece compatibilidade CommonJS para os testes em Node.
- `js/app.js`: navegacao, estado da interface, setup, geracao dos codigos cegos, contagem, undo, autosave, edicao de laminas finalizadas, resumo, importacao e exportacao JSON.
- `js/legacy-xlsx.js`: leitor OOXML restrito ao formato legado Comet VisualScore, conversao das contagens brutas para o schema atual e suporte offline usando o JSZip ja vendorizado.
- `js/repository.js`: IndexedDB autoritativo, migracao do `localStorage`, quarentena, revisoes, tombstones, mirror de transicao, validacao transacional do historico de correcoes e notificacao entre abas.
- `js/export.js`: serializacao canonica de CSV, historico de correcoes e relatorio, escape HTML, neutralizacao de formulas de planilha, validacao de PNG e nomes de arquivo seguros.
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
- Playwright para fluxos E2E em Chromium/Pixel 7 e WebKit/iPhone.
- `http-server` para servir a aplicacao nos testes E2E.

## Modelo de dados

O schema atual e a versao 6, definida em `js/core.js`.

Um experimento contem, em linhas gerais:

- identificadores, timestamps, status e `schemaVersion`;
- pesquisador, agente, celulas e controles;
- meta de nucleoides por lamina;
- quantidade de laminas por tratamento;
- unidade de concentracao e lista de tratamentos;
- metadados estruturados dos tratamentos e `studyDesign` versionado;
- `slideEditHistory`, um log append-only de correcoes em laminas finalizadas;
- progresso parcial da contagem, quando houver;
- repeticoes com assignments cegas e laminas contabilizadas.

Cada assignment associa um `blindCode` a um tratamento e numero de lamina. Seus estados possiveis sao `pending`, `counting`, `counted` e `absent`. Laminas contabilizadas armazenam `class0` a `class4`, total, estado e indicacao de aderencia a meta (`complete` quando exata; `incomplete` quando abaixo ou acima). A elegibilidade analitica e separada dessa aderencia: uma contagem positiva e internamente consistente continua analisavel fora da meta.

Dados antigos sao migrados antes do uso:

- objetos sem versao sao tratados como schema 1;
- versoes futuras sao recusadas;
- laminas legadas fora da meta sao marcadas como incompletas com motivo `legacy-unjustified`, mas permanecem analisaveis se o total efetivamente contado for positivo e consistente;
- schemas 1 a 4 recebem metadados conservadores e um plano analitico `unconfigured`, sem inferencia silenciosa do tipo de ensaio ou referencia;
- schemas 1 a 5 recebem `slideEditHistory: []`; historicos existentes no schema 6 sao validados sem reescrita;
- o status do experimento e recalculado a partir das assignments pendentes.

## Fluxos implementados

### Criacao e codificacao cega

O usuario informa metadados, tipo de ensaio, controles, referencia basal, concentracoes, meta de nucleoides e numero de laminas. O plano analitico e validado antes de a aplicacao criar a primeira repeticao e gerar codigos com duas letras ordenadas e o numero da lamina sem hifen ou zero a esquerda, como `AB1`, `AB2` e `CY10`.

As 676 bases de `AA` a `ZZ` sao sorteadas sem reposicao no experimento inteiro. Uma nova repeticao e bloqueada se nao houver bases suficientes para todos os tratamentos. Codigos legados como `ABCD-01` continuam validos e sao preservados sem alteracao em migracoes, importacoes e backups.

A geracao usa preferencialmente `crypto.getRandomValues`. O mapa entre tratamento e codigo e mostrado durante a preparacao; depois disso, a tela de contagem trabalha apenas com o codigo cego.

### Contagem e persistencia

Ao informar um codigo valido, a assignment passa a `counting`. Cada incremento de classe e cada undo chamam imediatamente a persistencia. O historico do contador tambem e mantido para permitir undo apos recarregar a pagina.

Ao finalizar uma lamina:

- total igual a meta resulta em contagem `complete`;
- total menor que a meta exige justificativa e resulta em `incomplete`;
- uma lamina ausente tambem exige justificativa.

Laminas ausentes sao preservadas e excluidas das analises. Laminas contadas abaixo ou acima da meta sao preservadas, sinalizadas e incluidas usando o total efetivo como denominador; somente uma contagem sem total positivo ou internamente inconsistente nao produz score.

### Correcao auditavel de laminas finalizadas

Uma lamina `counted` ou `absent` pode ser corrigida pelo resumo somente quando nao existe assignment `pending`/`counting` nem `experiment.progress`. A operacao exige nome do responsavel e justificativa em texto livre. Sao aceitas as quatro transicoes terminais: `counted -> counted`, `counted -> absent`, `absent -> counted` e `absent -> absent`.

Cada correcao acrescenta um evento versionado em `slideEditHistory`, identificado pela combinacao `replicateNumber + blindCode + treatmentIndex + gelNumber`. O evento preserva snapshots canonicos de assignment e gel antes/depois, `editId`, `editedAt`, `editedBy` e `reason`. Os timestamps de estado da assignment e da contagem do gel sao armazenados e apresentados separadamente; mudancas de status recebem o timestamp da correcao.

O repositorio valida a transicao dentro da mesma operacao IndexedDB com compare-and-swap. Eventos anteriores nao podem ser removidos, reordenados ou alterados, e qualquer mudanca em uma lamina terminal precisa corresponder exatamente ao ultimo evento acrescentado. A igualdade estrutural usa serializacao canonica independente da ordem das propriedades JSON. Uma correcao tambem invalida resultados analiticos anteriores para impedir associacao silenciosa entre uma analise e dados revisados.

### Regra de blinding

Enquanto qualquer assignment estiver `pending` ou `counting`, ficam bloqueados:

- resumo que revele tratamentos;
- analise estatistica;
- exportacao JSON;
- CSV, relatorio e ZIP.

Esse bloqueio e uma decisao de fluxo para reduzir revelacao acidental durante a contagem.

### Importacao e consolidacao

A importacao aceita um ou varios JSONs, com limite de 5 MB por arquivo. Um arquivo e importado diretamente; varios sao consolidados.

Experimentos consolidados precisam ter metadados e tratamentos compativeis. Conflitos detectados na mesma lamina/codigo interrompem o merge. Historicos de correcao precisam ser identicos ou ter relacao ancestral por prefixo. Para uma fonte ancestral, o estado esperado e reconstruido evento a evento e comparado por lamina compartilhada; divergencias sao recusadas, enquanto repeticoes complementares continuam sendo incorporadas normalmente. Um experimento importado com ID ja existente substitui a copia local.

Existe tambem um fluxo separado **Importar XLSX legado**. Ele aceita uma planilha por vez, localiza a aba `Comet Assay`, le apenas as linhas `Gel N` dos cinco blocos de classes e ignora medias/desvios exportados. Os nomes das colunas sao tratados como rotulos opacos: o usuario classifica cada tratamento na previa como controle positivo, negativo, de solvente, concentracao ou outro. O controle de solvente e opcional.

Para cada combinacao lamina x tratamento, cinco numeros inteiros nao negativos formam uma contagem; cinco celulas vazias formam uma assignment `absent` sem gel; preenchimento parcial e recusado por ser ambiguo e nunca e convertido silenciosamente em zero. A numeracao global de geis e dividida por `Gels/Experiment` para reconstruir repeticoes biologicas e laminas tecnicas. Datas ausentes permanecem `null` e sao exibidas como nao informadas. A origem, data de importacao e nome do arquivo ficam em `provenance`.

### Analise cientifica

A regra central e tratar a repeticao como unidade experimental. Laminas tecnicas com contagem valida sao primeiro promediadas dentro de cada repeticao, evitando que sejam usadas como replicas independentes na inferencia.

O score visual e calculado por:

```text
(0.25*C1 + 0.50*C2 + 0.75*C3 + 1.00*C4) / (C0+C1+C2+C3+C4) * 100
```

A meta `nucleoidsPerGel` continua limitando a coleta interativa e serve para relatar aderencia, mas nao e mais o denominador cientifico. O contrato v2 registra `visualScoreDenominator: effective_counted_nucleoids` e `offTargetSlidesIncluded: true`.

Analises atualmente implementadas no contrato `analysisSchemaVersion: 4` (protocolo vigente desde a continuidade de 14/09/2026 "reformulacao estatistica v3 -> v4", ver "Estado no momento deste registro" ao final deste documento; secoes anteriores deste documento sobre Holm, tendencia linear, Friedman e a transformada arcsine-sqrt descrevem protocolos ja superados):

- gate automatico de pelo menos 3 experimentos independentes antes de qualquer inferencia (`insufficient_independent_experiments`); abaixo disso, so descritivas/graficos ficam disponiveis;
- passo automatico de validacao de desenho (`validation`) antes de qualquer teste: contagem de experimentos, presenca de controles, `scoreOutOfRangeCount` e flag de efeito piso/teto;
- ANOVA em blocos completos pelo modelo `score ~ tratamento + experimento`, mantida apenas como apendice tecnico e nunca como gate das comparacoes planejadas;
- comparacoes bilaterais planejadas de cada concentracao contra a referencia, com ajuste de **Dunnett** (`comparisonMethod: "dunnett"`) generalizado ao erro residual e aos graus de liberdade do modelo em blocos, com IC simultaneo de 95% coerente com o p ajustado;
- flag `increaseDetected` por comparacao (significativo e na direcao esperada para o tipo de ensaio), nao so significancia isolada;
- resposta do controle positivo em comparacao separada (equivalente a um teste t pareado), sem classificacao automatica da validade do ensaio a partir de p < 0,05 isolado;
- o teste exato **Page L** como unico teste padrao de tendencia por concentracao, com direcao pre-especificada pelo `assayType`; nao substitui as comparacoes de Dunnett nem precisa ser significativo para reconhecer efeito numa unica concentracao;
- diagnosticos tecnicos recolhidos (residuos vs. ajustados, referencia Q-Q, diferencas tratamento-referencia por bloco, influencia leave-one-block-out) disponiveis a partir de 4 experimentos independentes; a influencia reporta so direcao/magnitude, nunca gera novo p-valor;
- bloco `interpretation`, uma tabela orientativa de 5 linhas que cruza significancia de Dunnett x significancia de Page L x um criterio essencial de validade (falha so quando a comparacao do controle positivo nao pode ser estimada ou e significativa na direcao oposta a esperada) em um dos cinco codigos de conclusao, sempre em linguagem hedged (nunca "genotoxico"/"nao genotoxico", nunca tratando nao-significancia como prova de ausencia de efeito);
- dispersao por tratamento (media, DP, CV) e flag de heterogeneidade de variancia, deslocados do resumo principal para o apendice tecnico;
- perfis individuais por bloco, grafico das diferencas com IC e distribuicao descritiva das classes.

Shapiro-Wilk, ANOVA one-way, Tukey, Pearson agrupado e o antigo calculo de poder ja nao integravam o runtime desde o protocolo v2. A partir do protocolo v4, tambem saem do contrato e do relatorio padrao (mas permanecem no arquivo, sem chamador, reativaveis no futuro): o ajuste Holm (substituido por Dunnett), o teste de Friedman, a reanalise transformada arcsine-sqrt e a regressao linear de tendencia de dose (substituida por Page L como unico teste padrao). O Wilcoxon pareado nunca integrou o protocolo por ter resolucao minima (p=0,25) com n=3. Alteracoes futuras no protocolo estatistico devem continuar sendo validadas contra referencias cientificas independentes.

## Exportacao e seguranca de saida

As rotinas canonicas de exportacao ficam em `js/export.js`. Elas foram separadas para evitar implementacoes divergentes e incluem:

- escape de conteudo inserido no relatorio HTML;
- neutralizacao de valores que poderiam ser interpretados como formulas por planilhas;
- CSV com BOM e terminacoes CRLF;
- sanitizacao de nomes de arquivo;
- verificacao basica do PNG em base64.

O historico auditavel integra o JSON do experimento e o backup criptografado. O relatorio HTML apresenta a trilha de correcoes com motivos e timestamps separados, e o pacote de analise inclui `data/slide_corrections.csv`. O mesmo CSV pode ser exportado diretamente pelo resumo.

O JSZip e copiado para `vendor/` durante `npm install`, permitindo a geracao do pacote ZIP em hospedagem estatica sem depender de uma CDN para essa biblioteca.

## Persistencia local

Os experimentos sao armazenados como documentos atomicos no IndexedDB. A chave legada `cometquant-experiments` e migrada na primeira abertura e mantida temporariamente como espelho de compatibilidade. O idioma usa `cometquant-language`.

O autosave privilegia resiliencia imediata: todo clique e todo undo entram em uma fila e persistem um documento validado. Revisoes monotonicas e compare-and-swap impedem sobrescritas silenciosas entre abas.

## PWA e operacao offline

O shell local e armazenado pelo service worker em um cache separado do runtime cientifico. A interface de contagem funciona offline depois de instalada e carregada.

A analise estatistica usa um pacote opcional pinado e verificado por SHA-256. Depois da preparacao explicita, Pyodide, NumPy, SciPy e Matplotlib executam em Web Worker apos reload totalmente offline.

## Marco fundacional (commit `0b0779a`, 13/08/2026)

Esta secao descreve o commit fundacional a partir do qual este documento foi originalmente reconstruido -- nao a sessao mais recente. Para o estado atual do projeto, ver "## Estado no momento deste registro" ao final deste documento; para o historico completo entre esse commit e o estado atual, ver "## Proximos passos recomendados" (log cronologico de continuidades).

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
npm run test:e2e:chromium
npm run test:e2e:webkit
npm run test:analysis
npm run test:reference:r
npm run check
npm run vendor
```

Nao existe script de build, start ou dev. O Playwright inicia `http-server` na porta 4173. Em uma instalacao nova, pode ser necessario instalar o navegador do Playwright separadamente.

A cobertura atual inclui regras centrais, importacao XLSX real, exportacao, protecoes basicas, autosave e fluxos mobile de criacao/contagem/restauracao. O motor Python extraido e exercitado por unittest e no Pyodide real pelos testes E2E.

Existe um resultado local do Playwright indicando uma execucao sem falhas, mas ele nao possui timestamp suficiente para garantir correspondencia com o `HEAD`. Ao retomar o desenvolvimento, execute novamente pelo menos `npm run check`, `npm test` e `npm run test:e2e`.

## Decisoes que devem ser preservadas

- A aplicacao e local-first e deve continuar utilizavel como hospedagem estatica, salvo decisao explicita de arquitetura.
- A repeticao, nao a lamina tecnica, e a unidade experimental da inferencia.
- Laminas ausentes permanecem auditaveis e nao entram na inferencia. Laminas contadas fora da meta permanecem auditaveis e entram com denominador efetivo; celulas parcialmente preenchidas nunca devem ser interpretadas como zero.
- O resumo e as exportacoes reveladoras permanecem bloqueados enquanto o experimento nao estiver integralmente contado ou justificado.
- Importacoes passam por migracao e validacao antes de substituir dados locais.
- Conflitos de consolidacao nao devem ser resolvidos silenciosamente.
- O historico de correcoes deve permanecer append-only; alteracoes terminais sem evento correspondente devem ser rejeitadas na camada de persistencia.
- Conteudo controlado pelo usuario nao deve ser inserido com `innerHTML`.
- CSVs devem continuar neutralizando formulas de planilha.
- Mudancas de schema exigem incremento de versao e migracao explicita.
- Alteracoes em arquivos precacheados exigem considerar a versao do cache do service worker.

## Armadilhas e riscos conhecidos

### O blinding nao e criptografico

O mapeamento entre codigos e tratamentos e armazenado em texto claro no IndexedDB. O bloqueio existe somente na interface. DevTools, acesso ao perfil do navegador ou uma copia do perfil revelam o mapa.

O modelo atual deve ser descrito como **blinding operacional contra revelacao acidental**, nao como protecao contra um usuario adversarial. Nao ha autenticacao, criptografia, assinatura, controle de acesso ou separacao tecnica entre codificador e avaliador.

Pelo mesmo motivo, o historico de correcoes oferece rastreabilidade operacional e protecao contra alteracoes silenciosas pelo fluxo normal da aplicacao, mas nao e uma assinatura digital nem um log inviolavel contra adulteracao deliberada do armazenamento ou de um JSON exportado.

### Concorrencia nao faz merge automatico

Revisoes monotonicas, compare-and-swap e `BroadcastChannel` impedem last-write-wins silencioso. Se duas abas alterarem o mesmo experimento, a aba desatualizada interrompe a edicao e exige recarga. Nao existe merge automatico de contagens concorrentes.

### IndexedDB e Cache Storage nao sao backup

Os dois compartilham a quota da origem e podem ser removidos sob pressao de armazenamento ou por acao do usuario. O mirror em `localStorage` existe apenas para a transicao e nao e fonte autoritativa. O backup criptografado continua necessario para recuperacao e transferencia.

### Pacote cientifico depende de instalacao inicial

O shell e a contagem nao carregam Pyodide. Para analisar, o usuario precisa preparar uma vez o pacote pinado: cerca de 35,7 MB transferidos e 104,4 MB armazenados. Os artefatos vem inicialmente do jsDelivr, mas cada corpo e validado por tamanho e SHA-256 antes de ser ativado. Alterar Pyodide ou pacotes exige nova revisao do manifesto `science-assets.json`, novas URLs virtuais e repeticao da validacao cientifica.

### Compatibilidade automatizada em Chromium e WebKit

A automacao usa Chromium com emulacao Pixel 7 e Playwright WebKit com emulacao iPhone. A tela de diagnostico registra APIs, quota estimada, persistencia, shell offline e pacote cientifico sem expor dados experimentais. Isso nao equivale a Safari/iOS real, que ainda precisa da matriz manual em `docs/safari-ios-storage-checklist.md` para quota, eviccao, Files, ciclo da PWA e memoria do runtime cientifico.

O Chromium executa reload realmente offline com `context.setOffline(true)`. O Playwright WebKit valida integridade do cache, reload e reutilizacao do runtime sem novos downloads da CDN, pois seu motor no Windows falha internamente ao recarregar com a emulacao offline ativa. Encerramento e reabertura realmente offline no Safari/iOS permanecem obrigatorios na checklist fisica.

### Uso cientifico critico exige revisao externa

As referencias automatizadas com SciPy, R e Pyodide reduzem risco de regressao, mas nao substituem validacao regulatoria, revisao independente do protocolo estatistico ou politica formal de deploy.

### Assets das classes otimizados

`icons/class_0.png` a `icons/class_4.png` foram convertidos para PNG RGBA de 512 x 512, com transparencia, margens uniformizadas e total aproximado de 344 KiB. Eles substituem os SVGs inline e fazem parte do precache do shell.

`teste_icones.png` e `teste_icones_azul.png` sao apenas montagens de comparacao e nao devem integrar o produto.

### Feedback tatil e sonoro implementado

Um pulso curto com `navigator.vibrate(30)` ocorre em Android/Chromium somente quando um clique de contagem e aceito, nunca para cliques ignorados, durante o fechamento da lamina ou depois de atingir a meta. A indisponibilidade ou falha da API nao bloqueia nem altera a persistencia da contagem.

A preferencia local **Feedback tatil** e habilitada por padrao apenas quando `navigator.vibrate` existe e pode ser desativada. A preferencia independente **Feedback sonoro** tambem e habilitada por padrao quando Web Audio esta disponivel. O clique de 25 ms e sintetizado em baixa intensidade, sem asset externo, e o contexto de audio e preparado no gesto do usuario para compatibilidade movel. Safari/iOS sem vibracao pode usar o feedback sonoro.

As chamadas de vibracao e audio permanecem separadas do commit IndexedDB. Os testes automatizados injetam mocks de `navigator.vibrate` e `AudioContext`, confirmam um pulso de 30 ms e um clique por contagem aceita, ausencia de feedback em operacoes rejeitadas e autosave normal quando as APIs falham. A sensacao, intensidade, volume e comportamento com configuracoes do sistema ainda precisam de verificacao manual em dispositivos reais; Playwright nao valida o motor fisico nem a saida audivel.

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

Concluido na continuidade de 17/08/2026:

- os cinco assets de classe foram otimizados para PNG RGBA 512 x 512, integrados a interface e ao precache;
- feedback tatil opcional foi inicialmente implementado com pulso de 10 ms apenas para contagens aceitas e fallback silencioso; posteriormente o pulso foi elevado para 30 ms e ganhou feedback sonoro independente;
- codigos cegos novos passaram ao formato compacto de duas letras e numero sem hifen ou zero a esquerda, com 676 bases sem reposicao no experimento;
- schema 4 preserva codigos antigos, valida sufixo e `gelNumber`, rejeita reutilizacao de bases e migra registros autoritativos do IndexedDB de forma transacional;
- a tela **Diagnostico de Armazenamento** informa suporte, quota/uso estimados, persistencia, IndexedDB, caches, service worker, shell e pacote cientifico;
- o relatorio tecnico nao solicita persistencia, nao inclui conteudo nem quantidade de experimentos e registra apenas timestamp, user agent, plataforma, capacidades, estimativas e erros sanitizados;
- o shell `cometquant-shell-v10` grava um marcador somente depois que todo o `cache.addAll()` termina, evitando diagnostico falso de cache completo;
- Playwright passou a ter projetos `chromium-pixel-7` e `webkit-iphone`; a CI executa ambos em matriz e preserva traces de falhas;
- a checklist real de Safari/iOS e armazenamento foi versionada em `docs/safari-ios-storage-checklist.md`;
- a verificacao final passou com 49 testes JavaScript, 95,39% de cobertura global, 17 cenarios Chromium e 17 cenarios WebKit.

Plano estatistico implementado na continuidade de 18/08/2026:

### Compreensao do desenho experimental

- O uso esperado e de tres experimentos independentes, normalmente executados em dias, placas e culturas preparadas independentemente. Cada experimento independente contem todos os tratamentos e funciona como um bloco.
- Em cada bloco existe uma unidade tratada para cada controle ou concentracao. As duas laminas usuais sao replicas tecnicas dessa unidade, e os cometas contados sao subamostras de mensuracao.
- A unidade experimental da inferencia continua sendo o experimento independente. Laminas e cometas nao aumentam o `n` biologico.
- As laminas tecnicas com total positivo e consistente sao promediadas dentro de `experimento x tratamento`, mesmo fora da meta nominal. Se apenas uma das laminas previstas for analisavel, a celula continua na analise com aviso e contagem explicita das laminas utilizadas.
- Se nenhuma lamina valida existir para a referencia ou para uma das concentracoes principais, o bloco inteiro e excluido da analise principal e a exclusao deve ser mostrada ao usuario.
- As comparacoes entre tratamentos sao pareadas pelo experimento, mas o termo mais preciso para o conjunto com varios tratamentos e delineamento em blocos completos.

### Revisao do protocolo anterior

- O codigo anterior executava Shapiro-Wilk por tratamento, ANOVA one-way, Tukey para todos os pares e regressao/Pearson sem ajustar pelo bloco.
- A cascata automatica `Shapiro -> parametrico ou nao parametrico -> omnibus -> pos-teste` foi rejeitada para o uso tipico com tres experimentos independentes.
- Com `n = 3`, Shapiro-Wilk tem pouco poder para avaliar normalidade, e o menor p-valor bilateral exato do Wilcoxon pareado e `0,25`. Uma troca automatica poderia gerar falsos negativos e conclusoes instaveis.
- Shapiro-Wilk deixou de selecionar o metodo. O Wilcoxon pareado continua fora do protocolo v2 por ter resolucao minima (p = 0,25) com n = 3; Friedman e Page foram incorporados posteriormente como sensibilidade exata.

### Protocolo principal implementado

- A analise principal e predefinida e parametrica, usando o modelo `score ~ tratamento + experimento`, com o experimento independente como bloco.
- A populacao principal contera o controle de referencia e as concentracoes do composto. Outros controles nao integrarao a familia principal de multiplicidade.
- A ANOVA em blocos apresenta tratamento, bloco e residuo, mas seu p-valor global e secundario e nao funciona como gate para comparacoes planejadas.
- Cada concentracao e comparada diretamente com a referencia usando o erro residual comum do modelo em blocos.
- As comparacoes sao sempre bilaterais e os p-valores brutos sao ajustados por Holm dentro da familia formada somente pelas concentracoes.
- Cada comparacao apresenta medias, diferenca em pontos de score, erro-padrao, estatistica t, graus de liberdade, intervalo de confianca nominal de 95%, p bruto, p ajustado, direcao e decisao estatistica.
- As decisoes usam valores em precisao integral; arredondamento ocorre apenas na apresentacao.
- Comparacoes planejadas sao executadas independentemente da significancia da ANOVA global.
- A regressao e a correlacao de Pearson antigas foram substituidas por uma tendencia linear secundaria ajustada por bloco: `score ~ experimento + concentracao`.
- A referencia e incluida como concentracao zero do composto teste na tendencia. Os metadados numericos de concentracao nao dependem mais do parsing do rotulo do tratamento.
- A resposta do controle positivo e analisada separadamente contra o controle basal, sem entrar na familia Holm das concentracoes e sem classificacao automatica do ensaio como valido ou invalido.

### Decisoes de revisao estatistica (continuidade 2.1.0)

- **Aditividade dos blocos**: o modelo de replica unica assume efeito aditivo de bloco (ausencia de interacao tratamento x experimento). Com n = 3 isso e indiagnosticavel; a suposicao e declarada no manual, nao testada.
- **Controle positivo em modelo de 2 tratamentos**: o residuo da validacao tem poucos graus de liberdade. Decidiu-se manter o modelo separado (sem pooling do erro com a populacao principal), com nota estruturada `low_residual_degrees_of_freedom` exposta no resultado.
- **Holm vs Dunnett**: manteve-se Holm como padrao. Os IC ja sao rotulados como "nominal". Dunnett e uma melhoria de poder futura, mas exigiria dependencia R nova (DescTools/multcomp) ou valores criticos manuais. (Nota: decisao revista na continuidade de 14/09/2026 "v3 -> v4" -- Dunnett foi implementado e passou a ser o ajuste padrao, com IC simultaneo em vez de nominal; ver "Estado no momento deste registro".)
- **Direcao do Page pre-especificada**: derivada do `assayType` (genotoxicidade = crescente; antigenotoxicidade = decrescente), nunca escolhida pelos dados, para nao inflar o erro tipo I.
- **Nao-parametrico/transformado como robustez**: nao sao decisao; a UI e o relatorio os apresentam como concordancia, nao como segunda tentativa de significancia.
- **Posicionamento regulatorio**: a filosofia "informar, nao decidir" e a recusa ao gate global estao mantidas. Parte da comunidade OECD/IWGT espera criterio de tendencia + reprodutibilidade; isso e registrado como posicionamento no manual, nao como mudanca de motor.

### Tipo de ensaio e controles

- Novos experimentos exigem a escolha entre **genotoxicidade** e **antigenotoxicidade** antes da geracao dos codigos cegos.
- Genotoxicidade exige controle positivo e um controle negativo ou de solvente/veiculo. O usuario escolhe negativo ou solvente como referencia principal quando ambos existem. O positivo e comparado separadamente com essa referencia.
- Antigenotoxicidade exige o controle positivo com o mutageno isolado, que e a referencia principal, e um controle negativo ou de solvente como controle basal. Os tratamentos combinados sao comparados com o positivo.
- O plano analitico fica bloqueado depois da geracao da primeira assignment e nao e mostrado durante a contagem cega.
- A aplicacao informa diferenca estatistica detectada ou nao detectada, magnitude, intervalo, direcao e consistencia. Nao classifica automaticamente um composto como genotoxico, nao genotoxico ou antigenotoxico.
- Significancia estatistica nao e apresentada como sinonimo de relevancia biologica, e ausencia de significancia nao e apresentada como prova de ausencia de efeito.

### Schema, legado e contrato de resultados

- A implementacao incrementou o schema de experimento para a versao 5.
- O documento tem metadados estruturados dos tratamentos e um `studyDesign` versionado com tipo de ensaio, referencia principal, concentracoes participantes, comparacao de validacao, alfa `0,05`, alternativa bilateral, ajuste Holm e inclusao da referencia como dose zero.
- Indices de tratamento serao reutilizados porque tratamentos, assignments e laminas ja usam `treatmentIndex` e nao podem ser reordenados depois da criacao.
- Experimentos v1 a v4 sao migrados para um estado analitico `unconfigured`. Tipo e referencia nao sao inferidos silenciosamente.
- Um experimento legado solicita configuracao unica somente depois do fim do blinding. O registro indica que a definicao ocorreu apos a coleta.
- Experimentos com planos analiticos incompativeis nao poderao ser consolidados.
- A mudanca documental nao exige nova versao do IndexedDB, salvo se forem adicionados stores ou indices.
- O resultado cientifico tem `analysisSchemaVersion: 2` e secoes explicitas para protocolo, populacao, descritivas, ANOVA em blocos, comparacoes principais, resposta dos controles, tendencia, `nonParametric`, `transformedAnalysis` e graficos.
- Resultados impossiveis usarao codigos estruturados e localizaveis. `NaN` e valores infinitos continuarao proibidos no JSON.

### Interface, graficos e exportacao implementados

- O cadastro recebe tipo de ensaio, referencia principal, controle basal e resumo das comparacoes antes da codificacao cega.
- A tela de resultados foi reorganizada em plano da analise, populacao e perdas tecnicas, scores por experimento, comparacoes principais, ANOVA em blocos, resposta dos controles, tendencia e graficos.
- O grafico de barras com anotacoes de Tukey foi substituido por pontos dos experimentos, conexao visual dos blocos e um grafico das diferencas contra a referencia com intervalos de confianca.
- O grafico de classes continuara descritivo. Qualquer anotacao de significancia usara o p-valor ajustado.
- HTML, JSON e ZIP registram protocolo, referencia, blocos incluidos/excluidos, comparacoes e tendencia.
- O ZIP acrescenta CSVs especificos para desenho, populacao, ANOVA em blocos, comparacoes principais, controles, tendencia, sensibilidade nao-parametrica e analise transformada, preservando os arquivos existentes de dados brutos e scores agregados.
- As protecoes existentes contra injecao HTML, formulas de planilha, PNG invalido e nomes de arquivo inseguros devem ser preservadas.

### Validacao e implementacao realizadas

1. Versionar a especificacao estatistica antes de alterar o motor.
2. Implementar schema 5, validacao, migracao e configuracao dos dois tipos de ensaio.
3. Construir uma matriz explicita `bloco x tratamento`, preservando IDs e quantidades de laminas tecnicas.
4. Criar `tests/reference/v2/` com o desenho tipico de tres experimentos independentes, controles, tres concentracoes e duas laminas por celula; preservar `v1` como historico do protocolo antigo.
5. Validar de forma independente a ANOVA em blocos, os contrastes, Holm, intervalos e tendencia com calculos SciPy externos ao motor e com R.
6. Implementar o novo motor Python e os casos degenerados antes da interface.
7. Criar o contrato de resultados v2, renderizacao, i18n, graficos e exportacoes.
8. Cobrir genotoxicidade, antigenotoxicidade, legado, uma lamina valida, bloco incompleto, variancia residual zero, referencia ausente e precisao dos p-valores.
9. Executar o motor real no Pyodide em Chromium e WebKit, incluindo reload offline e inspecao dos arquivos exportados.
10. Incrementar em sincronia o cache do service worker e o nome de shell usado pelo diagnostico.
11. Atualizar README, este MEMORY e a versao publica somente depois da verificacao completa.

A verificacao final desta continuidade passou com 77 testes JavaScript e 95,49% de cobertura global, 19 testes Python, 60 metricas v2 comparadas com R, 28 metricas historicas v1 e 19 cenarios E2E em cada projeto Chromium e WebKit. O E2E cientifico executa o motor real no Pyodide, repete a renderizacao em portugues e inspeciona o conteudo do ZIP exportado.

Concluido na continuidade de robustez estatistica (versao 2.1.0):

### Motivacao e decisoes

- A revisao do protocolo identificou nove pontos, do mais critico ao periferico. O principal era a homogeneidade de variancia: o escore e limitado em [0,100], o controle negativo tende ao piso (variancia ~0) e doses altas/CP tem dispersao grande, o que miscalibra o erro comum agrupado.
- A cascata `Shapiro -> parametrico/nao parametrico -> omnibus -> pos-teste` permaneceu rejeitada; nao ha troca automatica de metodo.
- A direcao do teste de Page foi **pre-especificada e derivada do `assayType`** (genotoxicidade = crescente; antigenotoxicidade = decrescente), nunca escolhida pelos dados, para nao inflar o erro tipo I.
- O controle positivo manteve modelo proprio de 2 tratamentos (sem pooling do erro com a populacao principal), com nota estruturada `low_residual_degrees_of_freedom`.
- Holm permaneceu como ajuste padrao; os IC ja sao rotulados "nominal". Dunnett e uma melhoria de poder futura (exigiria dependencia R nova ou valores criticos manuais). (Nota: revisto na continuidade de 14/09/2026 "v3 -> v4" -- Dunnett substituiu Holm como padrao.)
- A aditividade dos blocos (ausencia de interacao tratamento x experimento) e declarada, nao testada; com n = 3 e indiagnosticavel.

### Implementado no motor

- `calculate_dose_trend` passou a rotular a tendencia como `linear` e a reportar `r2Partial` (R² parcial da concentracao, ajustada por bloco).
- `_scores_and_descriptive` ganhou `coefficientOfVariation` e um `heterogeneityFlag` (aviso, nao gate).
- `_friedman_exact` calcula o omnibus em blocos por enumeracao exata dos arranjos `(k!)^n`, com cap computacional (`nonparametric_arrangements_exceeded`) em vez de degradar para assintotico.
- `_page_exact` usa `scipy.stats.page_trend_test` (exato) e reporta `pExact` + `pExactOpposite`.
- `_arcsin_sqrt_transform` e o bloco `transformedAnalysis` reexecutam ANOVA, comparacoes e tendencia na escala arcsine-sqrt.
- Novos blocos de topo no contrato v2: `nonParametric` e `transformedAnalysis` (sempre presentes; `performed: false` + motivo estruturado quando nao estimavel). `analysisSchemaVersion` permaneceu 2.

### Validacao independente

- `scripts/calculate_reference_results.py` passou a calcular Friedman exato (enumeracao propria), Page via SciPy e a analise transformada, gravando tudo em `expected.json`.
- `tests/reference/v2/reference_analysis.R` implementou Friedman e Page exatos manualmente em R base (postos + enumeracao recursiva) e a transformada com `lm`; sem pacotes externos.
- `scripts/validate_reference_with_r.py` estendeu as metricas esperadas.
- `tests/python/test_cometquant_analysis.py` cobriu os novos blocos, direcao por assayType, empates, blocos incompletos, arranjos excessivos, R² parcial e transformacao nos limites 0/100.

### Interface, i18n e exportacao

- Duas novas secoes de resultados (`nonParametric`, `transformed`) e tabela de dispersao (media/DP/CV/n) com aviso de heterogeneidade.
- Chaves PT/EN para os novos rotulos, direcoes, motivos estruturados e legendas de enquadramento ("robustez, nao segunda tentativa de significancia").
- `js/export.js` ganhou `buildNonParametricCsv`, `buildTransformedAnalysisCsv`, secao no relatorio HTML e os dois CSVs no ZIP.

### Verificacao e versionamento

- `npm run check`, 77 testes JavaScript, 25 testes Python, 92 metricas v2 + 28 v1 validadas com R e 38 cenarios E2E (19 Chromium + 19 WebKit) passaram.
- Cache do shell era `cometquant-shell-v12` na versao publica `2.1.0`; a importacao XLSX posterior incrementou-o para `v13`.

Concluido na continuidade de 20/08/2026 (importacao XLSX legada e denominador efetivo):

### Importador legado

- `js/legacy-xlsx.js` implementa um leitor OOXML deliberadamente restrito ao formato produzido pelo antigo Comet VisualScore. Ele usa JSZip e DOMParser, suporta strings inline/compartilhadas, limita arquivo, entradas, XML, linhas e colunas e nao adiciona dependencia de planilha generica.
- A aba esperada e `Comet Assay`; os blocos das classes 0 a 4, cabecalhos e linhas de geis precisam ser consistentes. `Mean` e `SD` sao ignorados.
- Rotulos de tratamento nao definem papeis. A previa exige classificacao explicita e aceita ausencia de controle de solvente; padroes numericos de concentracao sao apenas sugestoes editaveis.
- Cinco classes vazias representam lamina ausente com motivo legado nao informado. Qualquer mistura entre celulas vazias e preenchidas bloqueia a importacao.
- `Gels/Experiment` define as replicas tecnicas por repeticao biologica. O exemplo `Comet_VKM35_V79.xlsx` gera tres repeticoes, duas laminas por tratamento, sete tratamentos e 42 combinacoes.
- O simbolo de unidade corrompido `�` e normalizado para `µ`. Datas experimentais nao presentes nao sao inventadas.
- A interface, traducoes PT/EN, fallback FileReader para WebKit e cache offline `cometquant-shell-v13` foram atualizados.

### Score e populacao de analise

- `calculateVisualScore` e `_valid_slide_score` usam a soma efetiva das cinco classes como denominador. O total registrado deve coincidir com a soma e ser positivo.
- A validacao aceita totais acima da meta em dados importados. A interface normal continua impedindo incrementos acima da meta.
- `completion` continua informando aderencia exata a meta, enquanto `isIncludedGel` informa elegibilidade analitica. Totais abaixo ou acima sao analisados e reportados como fora da meta.
- O motor Python, agregacao JavaScript, resumo, CSV, relatorio HTML, graficos de classes e contrato de protocolo foram alinhados com a mesma regra.
- As referencias cientificas que precisavam representar perda tecnica passaram a usar contagem zero, mantendo os oraculos estatisticos independentes sem confundir contagem fora da meta com ausencia de dados.

### Validacao desta continuidade

- `npm run check` passou.
- `npm test` passou com 83 testes JavaScript.
- `npm run test:analysis` passou com 26 testes Python.
- O E2E dedicado de importacao passou em Chromium/Pixel 7 e WebKit/iPhone, incluindo classificacao sem controle de solvente, persistencia das 42 contagens, datas desconhecidas e total 103 preservado.
- A execucao E2E completa passou em 38 de 40 cenarios na primeira rodada paralela; os dois cenarios preexistentes afetados por encerramento/timeout do navegador passaram quando repetidos isoladamente. O importador e o E2E cientifico passaram nos dois motores.

Concluido na continuidade de 21/08/2026 (reformulacao da apresentacao do relatorio HTML):

### Objetivo e organizacao do relatorio

- O relatorio HTML deixou de ser predominantemente uma sequencia de metadados, tabelas estatisticas e dados brutos e passou a ser apresentado como um relatorio de evidencias em camadas, voltado tambem a pesquisadores da area de genetica sem formacao estatistica aprofundada.
- A ordem de leitura foi invertida para apresentar primeiro a sintese, depois as evidencias principais, os detalhes tecnicos e, por fim, os elementos de auditoria. Scores agregados e dados brutos continuam no documento, mas foram deslocados para o final.
- O topo ganhou o quadro `Conclusao em 30 segundos`, com cartoes para validade do ensaio, sinal de geno/antigenotoxicidade e qualidade da relacao dose-resposta.
- Comparacoes primarias e resposta dos controles foram promovidas em relacao a ANOVA. A ANOVA, o protocolo, a populacao, as analises de sensibilidade, os graficos tecnicos, os scores e os dados brutos permanecem disponiveis em secoes posteriores.
- As secoes ganharam uma camada `Leitura simples`; tabelas e estatisticas extensas ficam em blocos recolhiveis de `Detalhamento tecnico`. Foi incluido um `Glossario de bancada` para os principais termos estatisticos.

### Interpretacao e comunicacao estatistica

- O relatorio passou a produzir uma sintese narrativa da balanca de evidencias, traduzindo a direcao das comparacoes para aumento ou reducao de dano de acordo com o tipo de ensaio.
- A sintese informa quantas concentracoes apresentaram efeito estatisticamente detectado na direcao esperada e separa esse resultado da existencia de uma tendencia dose-resposta.
- A qualidade da dose-resposta integra tendencia linear ajustada por bloco, Page L e reversoes observadas entre doses sucessivas. Isso permite mostrar, por exemplo, efeito em concentracoes individuais sem afirmar que existe uma relacao dose-resposta ordenada.
- Friedman, Page L e a analise arcsine-sqrt continuam sendo analises de sensibilidade/robustez, nao uma segunda tentativa de obter significancia. O relatorio agora explica essa funcao em linguagem comum e pode destacar discordancias em relacao a analise principal. (Nota: revisto na continuidade de 14/09/2026 "v3 -> v4" -- Friedman e a transformada arcsine-sqrt saem do relatorio padrao; Page L deixa de ser "sensibilidade" e passa a ser o unico teste de tendencia padrao.)
- Significancia estatistica continua nao sendo sinonimo de relevancia biologica. A sintese declara que nao classifica automaticamente a substancia e lembra que citotoxicidade, controles historicos e o guia cientifico adotado tambem devem ser considerados.

### Graficos, acessibilidade e arquivo autocontido

- Foi adicionada a secao prioritaria `Visao da dose-resposta`, com grafico SVG dos pontos de cada experimento independente e indicacao da media por tratamento. Os PNGs de perfis por bloco, diferencas com IC e distribuicao por classes permanecem como graficos tecnicos.
- O SVG possui titulo, descricao e tabela textual equivalente para tecnologia assistiva. As tabelas usam cabecalhos semanticos, e os estados nao dependem apenas de cor.
- O documento ganhou hierarquia visual por cartoes, caixas de leitura simples, avisos e destaque de resultados, alem de comportamento responsivo, rolagem de tabelas e estilo para impressao.
- O HTML permanece autocontido e adequado a consulta offline: CSS, SVG e PNGs sao incorporados sem scripts ou recursos externos. Valores exibidos sao arredondados para leitura, enquanto JSON e CSV preservam a precisao integral.

### Pontos para reavaliacao do relatorio HTML

1. Reavaliar o status `Valido` no cartao de validade do ensaio. A regra atual resume a resposta estatistica do controle positivo na direcao esperada, mas o termo pode ser interpretado como validacao experimental ou regulatoria completa. Isso diverge da decisao historica registrada nas secoes de protocolo de apresentar a resposta do controle sem classificar automaticamente o ensaio como valido ou invalido. Considerar uma formulacao mais delimitada, como resposta esperada do controle detectada, sem antecipar a redacao final.
2. Reavaliar o titulo `Conclusao em 30 segundos`. Verificar com o publico-alvo se ele transmite sintese cientifica sem parecer informal, promocional ou excessivamente conclusivo. Possiveis nomes devem ser discutidos antes de qualquer alteracao.
3. Reavaliar os rotulos categorizados `Evidencia de efeito`, `Forte`, `Fraca/irregular` e `Ausente`. Em particular, `Ausente` na dose-resposta pode ser confundido com ausencia de efeito, e `Evidencia de efeito` pode ser lido como conclusao biologica ou regulatoria. Os rotulos devem deixar claro o objeto da conclusao e seus limites.
4. Simplificar os rotulos do eixo x em `Visao da dose-resposta`: mostrar somente o nome do tratamento e sua media. Textos adicionais como `controle do solvente` e `controle positivo` poluem o grafico e devem permanecer, quando necessarios, na legenda, no texto ou no detalhamento tecnico, nao no rotulo principal do eixo.
5. Incluir no rodape do relatorio o codigo de identificacao do experimento do qual o artefato foi derivado. Avaliar tambem timestamp da analise/geracao e versao publica do CometQuant para melhorar a vinculacao entre HTML, JSON e CSV e a rastreabilidade do arquivo isolado.
6. Adicionar um grafico de colunas como visualizacao complementar, mesmo que parcialmente redundante com os graficos existentes, por ser uma forma de apresentacao familiar aos pesquisadores. O grafico deve indicar com `*` as comparacoes contra o controle que atendam a `p < 0,05`, preservando a regra estrita do motor estatistico.
7. Antes de implementar o grafico de colunas, definir explicitamente qual controle sera a referencia em cada tipo de ensaio e qual p-valor alimentara o asterisco. A politica ja registrada determina que anotacoes de significancia usem o p-valor ajustado; portanto, a opcao coerente e usar o p ajustado por Holm das comparacoes planejadas, e nao o p bruto, salvo revisao cientifica documentada.
8. No grafico de colunas, explicitar o que as barras e os elementos de incerteza representam (por exemplo, media dos experimentos independentes e DP ou IC), preservar `n` como numero de experimentos independentes e evitar que laminas ou nucleoides sejam percebidos como replicas biologicas.
9. Reduzir a mistura entre linguagem amigavel em portugues e nomes internos como `lower`, `treatment`, `block`, `residual`, `antigenotoxicity` e campos do schema. Os nomes tecnicos podem permanecer para auditoria, mas devem receber rotulos localizados ou explicacao.
10. Avaliar um indice com links internos para as secoes do relatorio, pois a nova leitura progressiva melhorou a hierarquia, mas o documento completo continua longo.
11. Preservar, em qualquer revisao, a separacao entre efeito em doses individuais, tendencia dose-resposta, relevancia biologica e validade regulatoria; preservar tambem os dados completos, a acessibilidade, a operacao offline e as protecoes de seguranca da exportacao.

Concluido na continuidade de 24/08/2026 (correcao auditavel de laminas finalizadas):

### Modelo, integridade e persistencia

- O schema de experimento passou de 5 para 6 e ganhou `slideEditHistory`, inicializado vazio na migracao de documentos anteriores.
- O historico e append-only e preserva snapshots completos antes/depois, identidade logica da lamina, responsavel, justificativa e timestamp da edicao.
- A validacao permite corrigir contagens, transformar contagem em ausencia e restaurar uma ausencia como contagem, sempre mantendo as invariantes entre assignment e gel.
- `validateExperimentTransition` e a camada IndexedDB rejeitam remocao/reordenacao do historico, adulteracao de eventos anteriores e mudancas de dados terminais sem evento correspondente. O commit continua atomico e protegido por revisao compare-and-swap.
- A comparacao estrutural dos snapshots foi tornada independente da ordem das propriedades JSON.
- O merge aceita historicos iguais ou ancestrais por prefixo. O estado no ponto ancestral e reconstruido por lamina para aceitar somente diferencas explicadas pelas correcoes, sem ocultar conflitos em outras laminas e sem impedir repeticoes complementares.

### Interface, auditoria e exportacoes

- O resumo ganhou indicadores de revisao, historico detalhado e dialogo responsivo para editar uma lamina concluida. Responsavel e justificativa sao obrigatorios.
- A apresentacao distingue `assignment.recordedAt` de `gel.recordedAt` e localiza motivos de ausencia/incompletude em portugues e ingles.
- JSON e backup criptografado preservam o log; o relatorio HTML inclui a trilha; o CSV dedicado `slide_corrections.csv` pode ser baixado no resumo e integra o ZIP cientifico.
- Uma correcao invalida o resultado analitico anterior, mas o motor Python ignora o campo de auditoria e continua calculando apenas sobre o estado cientifico atual.
- O shell offline foi incrementado para `cometquant-shell-v17` para distribuir os novos HTML, CSS e scripts.

### Validacao desta continuidade

- `npm run check` passou.
- `npm test` passou com 98 testes JavaScript.
- `npm run test:analysis` passou com 27 testes Python.
- As suites E2E completas passaram com 21 cenarios em Chromium/Pixel 7 e 21 em WebKit/iPhone, incluindo correcoes sucessivas, transicoes entre contado/ausente e inclusao do CSV no ZIP.
- A revisao final nao encontrou findings de severidade alta ou media nas regras de ancestralidade do merge e na rastreabilidade dos timestamps.

Pendencias operacionais que continuam validas em paralelo:

1. Executar a checklist em Safari macOS, iPhone e iPad reais, incluindo PWA instalada, baixa disponibilidade de espaco e Pyodide offline.
2. Validar manualmente a sensacao do feedback tatil e o volume do clique em dispositivos Android e Apple reais.
3. Definir politica de deploy e submeter o novo protocolo cientifico a revisao externa antes de uso critico.

Concluido na continuidade de 25/08/2026 (revisao do relatorio e grafico de colunas):

- o quadro inicial passou a se chamar **Sintese das evidencias**, com categorias delimitadas para resposta do controle, efeito na direcao esperada e consistencia da tendencia, sem rotular o ensaio como valido ou invalido;
- nomes internos do protocolo, direcoes e termos da ANOVA receberam apresentacao localizada em portugues e ingles, sem alterar o schema ou os CSVs canonicos;
- o rotulo de leitura das secoes passou de `Leitura simples`/`Plain-language reading` para `Descricao`/`Description`;
- o eixo do grafico de pontos passou a mostrar somente tratamento e media, preservando papeis e concentracoes na tabela acessivel;
- o relatorio ganhou indice interno sem JavaScript e rodape com ID do experimento, ultima atualizacao, geracao do artefato, versao publica e schemas;
- um grafico SVG complementar mostra media mais ou menos DP entre experimentos independentes somente para a populacao principal; `n` continua sendo o numero de experimentos independentes;
- os asteriscos usam exclusivamente `primaryComparisons.comparisons[].significant`, isto e, p ajustado por Holm estritamente menor que alfa; controle de validacao e referencia nao recebem essa anotacao;
- o grafico de diferencas com IC nominal permanece a visualizacao inferencial principal, e o grafico de pontos individuais foi preservado;
- os graficos tecnicos PNG passaram a usar fundo claro, texto azul-ardosia, grade discreta e uma paleta equilibrada com cores distinguiveis; testes inspecionam a luminosidade real das imagens geradas;
- o shell offline foi incrementado para `cometquant-shell-v19`.

Validacao desta continuidade:

- `npm run check` passou;
- `npm test` e `npm run test:coverage` passaram com 103 testes JavaScript e 91,92% de cobertura global;
- `npm run test:analysis` passou com 27 testes Python e a referencia R v2 validou 92 metricas;
- o E2E cientifico e os novos asserts do relatorio passaram nos dois motores; a matriz completa teve 41 de 42 cenarios aprovados, e o unico timeout preexistente de retomada apos reload no WebKit passou ao ser repetido isoladamente.

Concluido na continuidade de 25/08/2026 (compartilhamento de arquivos via Web Share API):

- um helper central em `js/export.js` (`buildShareFile`, `buildShareTextFile`, `canShareFiles`, `shareFiles`) constroi `File`, detecta suporte e mapeia os erros (`AbortError`, `NotAllowedError`, indisponibilidade) sem afirmar sucesso de entrega;
- JSON e backup cifrado passaram a oferecer **Compartilhar** alem do download. Como o Chromium nao aceita `application/json` na Web Share, o compartilhamento serializa o mesmo JSON com extensao `.json.txt` e MIME `text/plain` (ponte de transporte; a reimportacao e por conteudo, nao por extensao);
- o backup cego e compartilhado somente cifrado (`.cqbackup.txt`); pontos que exportam o mapeamento em texto claro (tela de codigos cegos e lembrete de repeticao) pedem confirmacao antes de compartilhar;
- relatorio HTML e CSVs de dados brutos e de correcoes ganharam compartilhamento nativo (MIME ja suportado pela Web Share); o ZIP permanece somente download por estar fora da allowlist;
- os botoes de compartilhar sao ocultados quando `navigator.share` nao existe (ex.: Firefox desktop) e, quando o arquivo nao pode ser compartilhado, o app orienta a salvar e compartilhar pelo gerenciador de arquivos;
- o input de importacao passou a aceitar `.txt`, e o limite maior do backup cifrado e detectado por `cqbackup` no nome, nao pela extensao;
- o shell offline foi incrementado para `cometquant-shell-v20`.

Validacao desta continuidade:

- `npm run check` passou;
- `npm test` e `npm run test:coverage` passaram com 107 testes JavaScript e 92,04% de cobertura global;
- `npm run test:analysis` passou com 27 testes Python;
- a matriz E2E passou com 26 cenarios em cada motor (52 no total), incluindo os 5 novos cenarios de compartilhamento; o cenario cientifico do WebKit que falhou apenas por disputa de download do CDN em paralelo passou ao ser repetido isoladamente.

Concluido na continuidade de 28/08/2026 (feedback de contagem):

- o pulso de cada contagem aceita passou de 10 ms para 30 ms;
- um clique de 25 ms gerado por Web Audio passou a complementar a confirmacao visual e tatil, sem asset externo e com inicializacao no gesto do usuario;
- **Feedback sonoro** ganhou preferencia independente, habilitada por padrao quando suportada e persistida localmente;
- falhas ou indisponibilidade de vibracao e audio continuam sem interferir no autosave, e contagens rejeitadas nao produzem feedback;
- o shell offline foi incrementado para `cometquant-shell-v21`.

Validacao desta continuidade:

- `npm run check` passou;
- `npm test` passou com 107 testes JavaScript;
- os 16 cenarios direcionados de feedback passaram em Chromium/Pixel 7 e WebKit/iPhone;
- a matriz E2E completa passou com 29 cenarios em cada motor (58 no total), incluindo o motor cientifico real no Pyodide;
- a sensacao da vibracao e o volume real do clique permanecem pendentes de validacao manual em dispositivos fisicos.

Concluido na continuidade de 01/09/2026 (selecao de repeticoes para analise):

- ao entrar em **Analise Estatistica**, o usuario confirma quais experimentos independentes formarao a populacao candidata; todas as repeticoes iniciam selecionadas;
- retirar uma ou mais repeticoes exige uma justificativa geral de ate 500 caracteres; selecionar somente uma repeticao e permitido com aviso de que parte da inferencia pode ficar indisponivel;
- a selecao e transitoria e nao altera o documento do experimento nem seu schema 6; ela fica vinculada ao contexto exato da execucao e qualquer mudanca invalida os resultados em memoria;
- o contrato cientifico passou a `analysisSchemaVersion: 3` e registra repeticoes disponiveis, selecionadas e nao selecionadas, justificativa e timestamp;
- o motor distingue selecao explicita, elegibilidade tecnica e inclusao efetiva, preserva todos os blocos na populacao auditavel e aplica o mesmo subconjunto a analise principal, controles, sensibilidades e graficos;
- dados brutos e scores agregados continuam preservando todas as repeticoes, mas os CSVs agora indicam selecao, elegibilidade e inclusao; o relatorio HTML e `population.csv` registram a justificativa sem remover dados coletados;
- a interface ganhou dialogo responsivo e acessivel, resumo da selecao ativa e opcao de alterar o subconjunto antes de nova execucao;
- a versao publica passou a `2.2.0` e o shell offline a `cometquant-shell-v22`.

Validacao desta continuidade:

- `npm run check` passou;
- `npm run test:coverage` passou com 115 testes JavaScript e 91,94% de cobertura global;
- `npm run test:analysis` passou com 32 testes Python;
- a referencia R v2 preservada validou as mesmas 92 metricas numericas;
- os 4 cenarios E2E direcionados de selecao/legado e os 4 cenarios do fluxo cientifico completo passaram em Chromium e WebKit;
- a matriz E2E completa aprovou 59 de 60 cenarios; o unico encerramento de contexto Chromium ocorreu no importador XLSX preexistente e o mesmo cenario passou ao ser repetido isoladamente.

Continuidade de 14/09/2026 (nome do relatorio no pacote ZIP):

- o relatorio HTML dentro do pacote ZIP passou a usar o mesmo nome especifico da exportacao individual, formado por agente, linhagem e data, em vez do generico `report.html`;
- o nome-base e calculado uma unica vez por pacote e reutilizado na pasta interna, no relatorio e no arquivo ZIP;
- os JSONs, schemas e demais artefatos do pacote permanecem inalterados;
- o shell offline foi incrementado para `cometquant-shell-v23`.

Validacao desta continuidade:

- `npm run check` passou;
- `npm test` passou com 115 testes JavaScript;
- os 4 cenarios E2E de analise passaram em Chromium/Pixel 7 e WebKit/iPhone, incluindo a comparacao do nome do relatorio individual com o arquivo HTML interno do ZIP.

Continuidade de 14/09/2026 (reformulacao estatistica v3 -> v4, Dunnett e sintese de evidencias):

### Motivacao

- Documento `prompt_implementacao_otimizacao_estatistica_cometa.md` (adicionado na raiz pelo usuario) pediu reorganizar a analise e o relatorio para leitores sem formacao estatistica avancada, evitando analises alternativas apresentadas como votos equivalentes e evitando que o app classifique automaticamente uma substancia.
- Investigacao previa confirmou um fato central que simplificou todo o escopo de compatibilidade: nenhum resultado de analise e persistido ou reimportado pelo app (`analysisResults` em `js/analysis.js` e so memoria, recalculado a cada execucao). Nao ha migracao de dados salvos a fazer; relatorios HTML/JSON/CSV/ZIP antigos exportados continuam corretos como arquivos estaticos, nunca relidos pelo app.
- Decisoes confirmadas com o usuario antes de implementar: (1) Friedman, transformacao arcsine-sqrt e regressao linear saem do contrato padrao e do relatorio, mas o codigo Python permanece no arquivo sem chamador (reativavel no futuro); (2) a tela de resultados dentro do app tambem foi reorganizada, nao so o relatorio exportado; (3) o criterio essencial de validade do ensaio (linha "inconclusivo" da tabela de interpretacao) falha somente quando a comparacao do controle positivo nao pode ser estimada ou e significativa na direcao oposta a esperada -- resposta nao significativa na direcao esperada gera so um alerta de incerteza elevada.

### Correcao tecnica descoberta durante a implementacao

- `scipy.stats.dunnett` (disponivel desde SciPy 1.11, presente na versao pinada 1.12.0) so suporta desenho inteiramente casualizado: ele estima sua propria variancia e graus de liberdade a partir dos grupos brutos (`df = n - n_groups - 1`), ignorando silenciosamente a estrutura de bloco. Usa-lo diretamente sobre os escores por bloco teria descartado o ajuste por bloco.
- Solucao adotada: reaproveitar a mesma distribuicao de referencia t-multivariada equicorrelacionada que o proprio scipy usa internamente (`scipy.stats.multivariate_t`, API publica e documentada), alimentada com o erro residual e os graus de liberdade do modelo em blocos (`_rcbd_anova`), em vez de scipy.stats.dunnett. E a generalizacao padrao de Dunnett (1955) para um modelo linear geral -- o mesmo que `multcomp::glht` faz em R -- nao uma aproximacao ad hoc.
- Validado de forma independente: (1) reducao exata ao teste t simples no caso de 1 unica comparacao; (2) simulacao Monte Carlo sob H0 confirmando taxa de erro familiar ~5% (alfa nominal); (3) oraculo Python independente (`scripts/calculate_reference_results.py`, funcao `calculate_v3`) batendo exatamente com o motor (mesma seed fixa `20240601`); (4) **validacao real com R** via `multcomp::glht` sobre `lm(score ~ treatment + block)` -- unica excecao documentada a convencao "sem pacotes externos" dos testes de referencia, pois a generalizacao de Dunnett para modelo em blocos nao tem equivalente em R base.

### Motor Python (`python/cometquant_analysis.py`)

- Novo gate `MINIMUM_INDEPENDENT_EXPERIMENTS = 3`: `_rcbd_anova` agora exige >=3 blocos (antes exigia >=2), propagando o motivo `insufficient_independent_experiments` para ANOVA em blocos, comparacoes de Dunnett e resposta do controle (todos dependem de `_rcbd_anova`). `_calculate_trend_analysis` (novo wrapper so para Page L) aplica o mesmo gate separadamente, sem alterar `_page_exact`/`_friedman_exact` (que ficam intocados, dormentes).
- `calculate_primary_comparisons` reescrita: usa `_dunnett_rho`/`_dunnett_adjusted_pvalues`/`_dunnett_critical_value` (novas funcoes, baseadas em `scipy.stats.multivariate_t` + `scipy.optimize.minimize_scalar`) para IC simultaneo e p ajustado; adiciona `comparisonMethod: "dunnett"`, `dunnettCriticalValue`, `randomStateSeed` (constante `DUNNETT_RANDOM_STATE = 20240601`) e `increaseDetected` por comparacao (so conta positivo + significativo, direcao ciente do `assayType`).
- `calculate_control_response`: campo `note` (singular) virou `notes` (lista), com novo codigo `elevated_uncertainty_minimum_blocks` quando o bloco tem exatamente 3 experimentos. Mantido o modelo de 2 tratamentos existente (`_comparison_result`/`_rcbd_anova`) -- validado numericamente como equivalente exato a `scipy.stats.ttest_rel`.
- Novas funcoes: `_validate_design` (bloco `validation`: contagem de experimentos, presenca de controles, `scoreOutOfRangeCount`, `floorCeilingFlag`), `_calculate_diagnostics` (residuos, padronizados via formula fechada de alavancagem para desenho balanceado `1/b + 1/t - 1/(b*t)`, Q-Q, diferencas tratamento-referencia por bloco, influencia leave-one-block-out sem gerar novo p; exige >=4 blocos), `_build_interpretation` (tabela de 5 linhas: Dunnett positivo x Page L x validade -> `conclusionCode`; alerts separados para piso/teto, instabilidade, incerteza do controle, ausencia de controle positivo, viabilidade nao coletada).
- Campo `protocol.multiplicityAdjustment` (sempre "holm", obsoleto) foi removido do contrato -- o metodo real agora vem de `comparisonMethod`/`primaryComparisons.comparisonMethod`.
- Contrato v4 (`analysisSchemaVersion: 4`): chaves de topo `selection, protocol, population, validation, descriptive, scores, blockAnova (so apendice), primaryComparisons, controlResponse, trendAnalysis, diagnostics, interpretation, comparisonMethod, charts`. `doseTrend`, `nonParametric`, `transformedAnalysis` foram removidos do contrato (nao so `performed:false`). Nada foi apagado do arquivo: `_holm_adjust`, `_friedman_exact`, `_arcsin_sqrt_transform`, `_calculate_non_parametric`, `_calculate_transformed_analysis`, `calculate_dose_trend`, `calculate_regression` ficam presentes e sem chamador.

### Relatorio HTML e tela in-app

- `js/export.js`: removida `buildLegacyReportHtml` (codigo morto confirmado, ~465 linhas, nao exportado nem testado). `buildInterpretation` reescrita para ler `analysis.interpretation`/`analysis.validation`/`analysis.controlResponse.notes` em vez de recalcular logica de "sinal"/"dose" localmente; produz exatamente 3 cartoes (validade, comparacoes, tendencia) + lista de alertas separada. Texto de conclusao e do cartao de comparacoes agora e ciente do `assayType` (template `{effect}` -> "aumento do dano ao DNA" ou "redução do dano ao DNA"/"increased/reduced DNA damage"), corrigindo um problema real: a linguagem antiga sempre dizia "aumento", mesmo para antigenotoxicidade (onde o efeito esperado e reducao/protecao).
- `buildDoseResponseSvg` ganhou linhas finas conectando os pontos do mesmo experimento independente entre tratamentos (`.block-line`), atendendo ao pedido do documento.
- CSVs renomeados/adicionados: `buildPrimaryComparisonsCsv` (era `buildComparisonsCsv`), `buildTrendCsv` (era `buildNonParametricCsv`, so Page L agora), `buildValidationCsv`, `buildDiagnosticsResidualsCsv`, `buildDiagnosticsInfluenceCsv`, `buildInterpretationCsv` (novos); `buildDoseTrendCsv` e `buildTransformedAnalysisCsv` removidos.
- Relatorio reorganizado na ordem: identificacao -> validade/integridade dos dados -> sintese de evidencias -> grafico principal -> comparacoes primarias -> tendencia -> controle positivo -> diagnosticos (recolhido) -> paragrafo de metodos (auto-gerado, so menciona o que realmente rodou) -> apendice tecnico (dispersao, ANOVA, populacao, protocolo, graficos, scores, dados brutos).
- `js/analysis.js`: `ANALYSIS_SCHEMA_VERSION` 3->4; `renderAnalysisResults` reordenada (interpretacao e validacao no topo, depois comparacoes/tendencia/controle, depois apendice tecnico com ANOVA/diagnosticos/scores/graficos); novas `renderInterpretation`, `renderValidation`, `renderTrend`, `renderDiagnostics`; `renderDoseTrend`/`renderNonParametric`/`renderTransformedAnalysis` removidas. Mesma correcao de linguagem por `assayType` aplicada (`comparisonValues`/`renderPrimaryComparisons` recebem `protocol` para escolher "Aumento"/"Redução detectada").
- `js/i18n.js`: chaves novas para interpretacao/validacao/diagnosticos/decisao em pt/en; `analysis.v2.trend.title` corrigida (dizia "Tendencia de Dose Ajustada por Bloco", que agora e sobre Page L, nao mais regressao linear).

### Versionamento

- `APP_VERSION` (export.js) e `package.json` version: 2.2.0 -> 2.3.0. Shell offline: `cometquant-shell-v23` -> `cometquant-shell-v24` (`service-worker.js` e `js/science-package.js`, mantidos em sincronia).

### Validacao completa desta continuidade

- `npm run check` passou.
- `npm test` (Vitest) passou com 114 testes (10 arquivos), apos reescrever `tests/unit/export.test.js`, `tests/unit/analysis.test.js`, `tests/integration/persistence.test.js` e `tests/unit/science-package.test.js` para o contrato v4.
- `npm run test:analysis` passou com 40 testes Python (32 antigos + 8 novos), incluindo a nova classe `BlockAnalysisV4Tests` com gate de 3 experimentos, Dunnett batendo com oraculo independente, reprodutibilidade com seed fixa, equivalencia exata a `scipy.stats.ttest_rel` para o controle positivo, diagnosticos/influencia com fixture sintetica de 4 blocos, e as 5 combinacoes da tabela de interpretacao testadas isoladamente.
- **R esta instalado nesta maquina** (`C:/Program Files/R/R-4.6.1`), permitindo validacao real (nao so planejada): `npm run test:reference:r` passa para v1 (28 metricas), v2 (92 metricas) e a nova `tests/reference/v3/` (49 metricas, usando `multcomp::glht`, pacote instalado na biblioteca de usuario). O pacote `multcomp` precisou de tolerancia numerica mais frouxa que o resto do arquivo para as quantidades baseadas em QMC (p ajustado, IC simultaneo, valor critico de Dunnett) porque R e Python usam amostradores QMC independentes e nao sincronizados por seed entre linguagens; valores de p muito pequenos (<1e-4) sao tratados como equivalentes por piso, pois a diferenca de magnitude deixa de ter significado cientifico nesse regime.
- **E2E real rodou nos dois motores**: `npx playwright test` com `--project=chromium-pixel-7` e `--project=webkit-iphone` passou 30/30 cenarios em cada um (60 no total), incluindo o motor Python real executando dentro do Pyodide de verdade (nao mock), gerando relatorio e ZIP reais e conferindo a nova estrutura de secoes, ausencia de Holm/Friedman/transformacao, e presenca de "Dunnett" no relatorio.
- `tests/e2e/analysis-flow.spec.js` foi atualizado para o contrato v4 (novos ids de secao, `.dunnett-marker` em vez de `.holm-marker`, novas chaves de CSV no ZIP, `analysisSchemaVersion: 4`).

### Pendencias e limitacoes desta continuidade

- Viabilidade/citotoxicidade continua fora do schema do experimento; o alerta correspondente sempre informa "nao coletado" em vez de inventar um limiar -- fica fora de escopo (mudaria o schema/UI de contagem). (Nota: implementado na continuidade de 16/09/2026 -- indicador simples de viabilidade celular, ver "Estado no momento deste registro".)
- Fallback Monte Carlo para Page L quando a enumeracao exata excede o limite computacional nao foi implementado (decisao do usuario: desenhos reais do laboratorio ficam bem abaixo do limite de 5 milhoes de arranjos).
- Nenhum modo "avancado" com toggle de usuario foi criado para reativar Friedman/transformada/regressao; o codigo fica dormente no motor, sem UI.
- README atualizado (protocolo estatistico, validacao independente, changelog, limitacoes); MEMORY.md atualizado nesta secao.

Continuidade de 16/09/2026 (indicador de viabilidade celular):

### Motivacao e decisoes confirmadas com o usuario antes de implementar

- Preenche a limitacao documentada na secao "Known Limitations" do README e no motor Python: `_validate_design` sempre retornava `viabilityDataAvailable: False` e o motor sempre emitia o alerta `viability_not_collected`, porque o schema do experimento nunca teve nenhum campo de viabilidade.
- Escopo deliberadamente minimo: um indicador binario por experimento (`viabilityStatus`: `not-analyzed` ou `above-75`), sem campo numerico e sem granularidade por lamina/tratamento. Nao existe opcao "<=75%" -- o campo so registra se o criterio de aceitacao foi checado e atendido, nunca um valor formal abaixo do limiar.
- Local no schema: campo de topo no experimento (nao dentro de `studyDesign`), porque `studyDesign` e travado apos a geracao da primeira assignment (fim da fase cega), e viabilidade normalmente so e avaliada durante ou depois do ensaio. Ficar fora de `studyDesign` permite editar o indicador a qualquer momento pelo resumo sem reabrir o plano analitico.
- Editavel a qualquer momento pelo resumo do experimento (novo `<select id="input-viability-status">` em `screen-summary`, persistido de imediato como as demais operacoes do resumo), nao fixo na configuracao inicial.
- Legado (schemas 1 a 6) migra para `not-analyzed` de forma automatica e silenciosa, sem pedir confirmacao pos-blinding como o `studyDesign` legado -- decisao do usuario, pois nao ha nada a inferir, so um estado ausente.
- Impacto no motor Python: apenas informativo. `validation.viabilityDataAvailable` passa a refletir `viabilityStatus == 'above-75'`; o alerta `viability_not_collected` so e emitido quando `not-analyzed`. O bloco `interpretation` (tabela de 5 linhas) continua com o criterio essencial de validade baseado somente na resposta do controle positivo -- viabilidade nao vira um segundo criterio de validade, decisao explicita do usuario para nao duplicar o papel do controle positivo.
- CSV de validacao, relatorio HTML e tela in-app: nenhuma mudanca de codigo necessaria alem do valor do flag -- os tres pontos (`buildValidationCsv`, `renderValidation`, relatorio HTML) ja liam `validation.viabilityDataAvailable` e sempre mostravam "Nao coletada" porque o motor sempre retornava `False`.

### Schema e migracao (`js/core.js`)

- `SCHEMA_VERSION` 6 -> 7. Novo `VIABILITY_STATUSES = new Set(['not-analyzed', 'above-75'])`, exportado.
- `migrateExperiment`: `if (version < 7 || experiment.viabilityStatus === undefined) experiment.viabilityStatus = 'not-analyzed'`, no mesmo padrao usado para `studyDesign`/`treatmentMetadata`.
- `validateExperiment`: novo `push(VIABILITY_STATUSES.has(experiment.viabilityStatus), 'invalid-viability-status')`.
- `mergeExperiments`: `viabilityStatus` entrou na lista `keys` de compatibilidade escalar (junto de `nucleoidsPerGel`, `slidesPerTreatment` etc.) -- mesclar experimentos com indicadores diferentes lanca `incompatible-experiments` em vez de resolver silenciosamente, seguindo a decisao ja registrada do projeto contra resolucao silenciosa de conflitos.

### Interface (`index.html`, `js/app.js`, `js/i18n.js`)

- Novo controle `<select id="input-viability-status">` em `screen-summary`, com as duas opcoes traduzidas; `handleCreateExperiment` grava `viabilityStatus: 'not-analyzed'` em experimentos novos; `showSummary()` sincroniza o valor exibido a partir de `currentExperiment.viabilityStatus`; `handleViabilityChange` clona o experimento, salva via `saveExperiment` (mesmo caminho de persistencia/CAS/invalidacao de analise dos demais campos do resumo) e reverte o `<select>` para o valor persistido se o salvamento falhar.
- Chaves i18n novas (`summary.viability.label/notAnalyzed/above75/help`) em pt/en. O texto do alerta `analysis.reason.viability_not_collected` (e o equivalente `alert_viability_not_collected` em `js/export.js`) deixou de dizer "nao coletado por esta versao do aplicativo" e passou a "viabilidade celular nao foi informada como >75% para este experimento", ja que agora e um fato por experimento, nao mais uma limitacao da versao do app.

### Motor Python (`python/cometquant_analysis.py`)

- `_validate_design`: `"viabilityDataAvailable": experiment.get("viabilityStatus") == "above-75"` (era sempre `False`).
- `_build_interpretation`: o alerta `viability_not_collected` agora e condicional a `not validation.get("viabilityDataAvailable", False)` (antes era incondicional).
- Fixtures Python que nao definem `viabilityStatus` (a maioria dos testes de referencia v1/v2/v3, carregados de CSV) continuam se comportando como antes (`None == "above-75"` e `False`), sem exigir atualizacao de fixtures existentes.

### Exportacao (`js/export.js`)

- `rawRow`/`RAW_COLUMNS` (CSV bruto por lamina) ganharam a coluna `viability_status`, no mesmo nivel de `negative_control`/`positive_control`/`target_nucleoids`.
- `buildValidationCsv`, `buildReportHtml` (secao de validade/integridade) e a tela in-app (`analysis.js`, `renderValidation`) nao precisaram de mudanca de codigo -- apenas o texto do alerta.

### Versionamento

- `APP_VERSION` (`export.js`), `package.json` e `app.version` (`i18n.js`): `2.3.1` -> `2.4.0`. Shell offline: `cometquant-shell-v25` -> `cometquant-shell-v26` (`service-worker.js` e `js/science-package.js`, mantidos em sincronia).

### Validacao desta continuidade

- `npm run check` passou.
- `npm test` (Vitest) passou com 119 testes (10 arquivos), incluindo novos testes de migracao/validacao/merge do `viabilityStatus` em `core.test.js`, e um novo teste em `export.test.js` cobrindo a coluna do CSV bruto, `buildValidationCsv` e o relatorio HTML nos dois estados do indicador.
- `npm run test:analysis` passou com 43 testes Python (40 antigos + 3 novos), cobrindo `_validate_design` com `viabilityStatus` `above-75`/`not-analyzed` via `analyze_experiment` completo e `_build_interpretation` isoladamente com a flag `viabilityDataAvailable` em ambos os estados.
- `npm run test:reference:r` passou (v2: 92 metricas; v3: 49 metricas) -- viabilidade nao altera nenhum calculo estatistico, so o bloco `validation`/`interpretation`.
- `npx playwright test` passou 31/31 em `chromium-pixel-7` e 31/31 em `webkit-iphone`, incluindo o novo cenario dedicado (`experiment-flow.spec.js`, "records and persists the cell viability indicator from the summary screen": altera o indicador no resumo, confirma persistencia em `localStorage`, sobrevive a `page.reload()` renavegando ate o resumo, e confirma o campo no JSON exportado). O unico teste que falhou na primeira rodada paralela do Chromium (`runs the extracted Python engine in Pyodide with reference results`) e o mesmo cenario historicamente sensivel a disputa de download do CDN sob paralelismo (ja documentado em continuidades anteriores); passou ao ser repetido isoladamente, sem relacao com esta mudanca.
- README.md (schema v7, novo paragrafo sobre o indicador, limitacao reescrita, changelog 2.4.0) e este MEMORY.md foram atualizados.

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
- `js/legacy-xlsx.js`
- `science-assets.json`
- `python/cometquant_analysis.py`
- `js/export.js`
- `js/i18n.js`
- `css/style.css`
- `icons/class_0.png` a `icons/class_4.png` (assets otimizados e usados pela interface)
- `service-worker.js`
- `manifest.json`
- `vitest.config.js`
- `playwright.config.js`
- `tests/unit/core.test.js`
- `tests/unit/app.test.js`
- `tests/unit/export.test.js`
- `tests/unit/repository.test.js`
- `tests/unit/science-package.test.js`
- `tests/unit/legacy-xlsx.test.js`
- `tests/integration/persistence.test.js`
- `tests/e2e/experiment-flow.spec.js`
- `tests/e2e/analysis-flow.spec.js`
- `tests/e2e/backup-flow.spec.js`
- `tests/e2e/counter-feedback.spec.js`
- `tests/e2e/share-flow.spec.js`
- `tests/e2e/storage-concurrency.spec.js`
- `tests/e2e/storage-diagnostics.spec.js`
- `tests/e2e/legacy-xlsx-flow.spec.js`
- `docs/safari-ios-storage-checklist.md`
- `tests/python/test_cometquant_analysis.py`
- `tests/reference/v1/`
- `tests/reference/v2/`
- `tests/reference/v3/` (fixture Dunnett; `reference_analysis.R` usa `multcomp::glht`)
- `scripts/calculate_reference_results.py`
- `scripts/validate_reference_with_r.py`
- `.github/workflows/ci.yml`
- `prompt_implementacao_otimizacao_estatistica_cometa.md` (especificacao original da continuidade v4, na raiz)

## Estado no momento deste registro

- Branch: `main`.
- A continuidade atual inclui schema 7 (indicador simples de viabilidade celular por experimento, `not-analyzed`/`above-75`, editavel a qualquer momento pelo resumo) com historico auditavel de correcoes de laminas, importacao XLSX legada com classificacao explicita de tratamentos, score por total efetivamente contado, desenho de genotoxicidade/antigenotoxicidade, selecao transitoria de repeticoes, validacao automatica do desenho antes de qualquer teste (>=3 experimentos independentes), ANOVA em blocos como apendice tecnico, comparacoes planejadas com ajuste de Dunnett (IC simultaneo, validado contra R `multcomp::glht`), resposta separada do controle positivo, Page L como unico teste padrao de tendencia, diagnosticos de robustez (residuos, Q-Q, influencia leave-one-block-out) e uma tabela de interpretacao orientativa de 5 linhas. Contrato cientifico `analysisSchemaVersion: 4`; `validation.viabilityDataAvailable` reflete o novo indicador, mas viabilidade continua fora do criterio essencial de validade (que depende so do controle positivo). Friedman, transformacao arcsine-sqrt e regressao linear de dose saem do contrato/relatorio padrao mas o codigo Python permanece no arquivo, dormente.
- A fixture `tests/reference/v2/` (ANOVA/controle/Page L) e a nova `tests/reference/v3/` (Dunnett, mesmos dados) foram validadas com calculos SciPy independentes do motor, com R real (`multcomp::glht` para v3) e com execucao real no Pyodide via Playwright.
- Contagens aceitas usam pulso tatil de 30 ms e clique sonoro opcional de 25 ms; as preferencias sao independentes e falhas dessas APIs nao interferem no autosave.
- A aplicacao esta na versao `2.4.0` e o shell offline usa `cometquant-shell-v26`.
- **Bug real encontrado pelo usuario em producao (GitHub Pages) apos o deploy da v4, corrigido em 2.3.1**: uma aba que ja tinha visitado o app sob um Service Worker antigo, e que passou pela atualizacao em segundo plano durante a sessao, podia ficar com `js/analysis.js` antigo (em memoria, esperando `analysisSchemaVersion` antigo) buscando o motor Python atraves do Service Worker ja trocado para a versao nova -- produzindo "O motor cientifico retornou uma versao de resultado incompativel." Nao reproduzia localmente via Live Server porque ali normalmente nao havia Service Worker antigo registrado. Corrigido em `index.html` com um listener de `controllerchange` que forca `location.reload()` quando a troca de controlador substitui um controlador que a aba ja tinha (nao na primeira ativacao de uma instalacao nova), garantindo que todo o pacote de arquivos de uma mesma sessao venha de uma unica versao do shell.
- A implementacao possui validacao estatistica automatizada independente para o protocolo v4 (SciPy + R real via `multcomp`), alem de 62 cenarios E2E reais em Chromium e WebKit executando o motor Python dentro do Pyodide verdadeiro, mas ainda nao deve ser tratada como software validado para uso regulatorio ou producao critica -- a revisao estatistica externa citada no documento de origem continua pendente.
- Ha CI automatizada e matriz Chromium/WebKit, mas ainda nao ha politica formal de deploy, validacao em Safari/iOS real ou protocolo cientifico revisado externamente. O workflow de CI ganhou um passo de instalacao do pacote R `multcomp` antes de validar `tests/reference/v3/`.
- O backup exportado e criptografado, mas IndexedDB permanece em texto claro. O CDN e necessario apenas para instalar o pacote cientifico pinado; depois da verificacao de integridade, o runtime funciona offline.
- Nenhum resultado de analise e persistido pelo app (sempre recalculado); por isso a mudanca de contrato v3->v4 nao exigiu nenhuma migracao de dados armazenados, so do contrato de saida do motor.
