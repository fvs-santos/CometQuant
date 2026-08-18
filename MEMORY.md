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
- Playwright para fluxos E2E em Chromium/Pixel 7 e WebKit/iPhone.
- `http-server` para servir a aplicacao nos testes E2E.

## Modelo de dados

O schema atual e a versao 5, definida em `js/core.js`.

Um experimento contem, em linhas gerais:

- identificadores, timestamps, status e `schemaVersion`;
- pesquisador, agente, celulas e controles;
- meta de nucleoides por lamina;
- quantidade de laminas por tratamento;
- unidade de concentracao e lista de tratamentos;
- metadados estruturados dos tratamentos e `studyDesign` versionado;
- progresso parcial da contagem, quando houver;
- repeticoes com assignments cegas e laminas contabilizadas.

Cada assignment associa um `blindCode` a um tratamento e numero de lamina. Seus estados possiveis sao `pending`, `counting`, `counted` e `absent`. Laminas contabilizadas armazenam `class0` a `class4`, total, estado e indicacao de contagem completa ou incompleta.

Dados antigos sao migrados antes do uso:

- objetos sem versao sao tratados como schema 1;
- versoes futuras sao recusadas;
- laminas legadas abaixo da meta sao marcadas como incompletas com motivo `legacy-unjustified`;
- schemas 1 a 4 recebem metadados conservadores e um plano analitico `unconfigured`, sem inferencia silenciosa do tipo de ensaio ou referencia;
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

Analises atualmente implementadas no contrato `analysisSchemaVersion: 2`:

- ANOVA em blocos completos pelo modelo `score ~ tratamento + experimento`;
- comparacoes bilaterais planejadas de cada concentracao contra a referencia, sem gate omnibus e com ajuste Holm;
- diferenca estimada, erro-padrao, IC nominal de 95%, p bruto, p ajustado e direcao;
- resposta do controle positivo em comparacao separada, sem classificacao automatica da validade do ensaio;
- tendencia linear secundaria ajustada por bloco, incluindo a referencia como dose zero;
- perfis individuais por bloco, grafico das diferencas com IC e distribuicao descritiva das classes.

Shapiro-Wilk, ANOVA one-way, Tukey, Pearson agrupado e o antigo calculo de poder nao integram mais o runtime v2. Friedman e Wilcoxon permanecem adiados. Alteracoes futuras no protocolo estatistico devem continuar sendo validadas contra referencias cientificas independentes.

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

### Compatibilidade automatizada em Chromium e WebKit

A automacao usa Chromium com emulacao Pixel 7 e Playwright WebKit com emulacao iPhone. A tela de diagnostico registra APIs, quota estimada, persistencia, shell offline e pacote cientifico sem expor dados experimentais. Isso nao equivale a Safari/iOS real, que ainda precisa da matriz manual em `docs/safari-ios-storage-checklist.md` para quota, eviccao, Files, ciclo da PWA e memoria do runtime cientifico.

O Chromium executa reload realmente offline com `context.setOffline(true)`. O Playwright WebKit valida integridade do cache, reload e reutilizacao do runtime sem novos downloads da CDN, pois seu motor no Windows falha internamente ao recarregar com a emulacao offline ativa. Encerramento e reabertura realmente offline no Safari/iOS permanecem obrigatorios na checklist fisica.

### Uso cientifico critico exige revisao externa

As referencias automatizadas com SciPy, R e Pyodide reduzem risco de regressao, mas nao substituem validacao regulatoria, revisao independente do protocolo estatistico ou politica formal de deploy.

### Assets das classes otimizados

`icons/class_0.png` a `icons/class_4.png` foram convertidos para PNG RGBA de 512 x 512, com transparencia, margens uniformizadas e total aproximado de 344 KiB. Eles substituem os SVGs inline e fazem parte do precache do shell.

`teste_icones.png` e `teste_icones_azul.png` sao apenas montagens de comparacao e nao devem integrar o produto.

### Feedback tatil implementado

Um pulso curto com `navigator.vibrate(10)` ocorre em Android/Chromium somente quando um clique de contagem e aceito, nunca para cliques ignorados, durante o fechamento da lamina ou depois de atingir a meta. A indisponibilidade ou falha da API nao bloqueia nem altera a persistencia da contagem.

A preferencia local **Feedback tatil** e habilitada por padrao apenas quando `navigator.vibrate` existe e pode ser desativada. A chamada permanece separada do commit IndexedDB. Safari/iOS usa fallback silencioso.

Os testes automatizados injetam um mock de `navigator.vibrate`, confirmam um pulso de 10 ms por contagem aceita e ausencia de chamadas em operacoes rejeitadas. A sensacao, intensidade e comportamento com configuracoes do sistema ainda precisam de verificacao manual em um dispositivo Android real; Playwright nao valida o motor fisico.

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
- feedback tatil opcional foi implementado com pulso de 10 ms apenas para contagens aceitas e fallback silencioso;
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
- As laminas tecnicas completas sao promediadas dentro de `experimento x tratamento`. Se apenas uma das laminas previstas estiver completa, a celula continua na analise com aviso e contagem explicita das laminas utilizadas.
- Se nenhuma lamina valida existir para a referencia ou para uma das concentracoes principais, o bloco inteiro e excluido da analise principal e a exclusao deve ser mostrada ao usuario.
- As comparacoes entre tratamentos sao pareadas pelo experimento, mas o termo mais preciso para o conjunto com varios tratamentos e delineamento em blocos completos.

### Revisao do protocolo anterior

- O codigo anterior executava Shapiro-Wilk por tratamento, ANOVA one-way, Tukey para todos os pares e regressao/Pearson sem ajustar pelo bloco.
- A cascata automatica `Shapiro -> parametrico ou nao parametrico -> omnibus -> pos-teste` foi rejeitada para o uso tipico com tres experimentos independentes.
- Com `n = 3`, Shapiro-Wilk tem pouco poder para avaliar normalidade, e o menor p-valor bilateral exato do Wilcoxon pareado e `0,25`. Uma troca automatica poderia gerar falsos negativos e conclusoes instaveis.
- Shapiro-Wilk deixou de selecionar o metodo. Friedman e Wilcoxon foram adiados para uma etapa futura e nao fazem parte do protocolo v2.

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
- O resultado cientifico tem `analysisSchemaVersion: 2` e secoes explicitas para protocolo, populacao, descritivas, ANOVA em blocos, comparacoes principais, resposta dos controles, tendencia e graficos.
- Resultados impossiveis usarao codigos estruturados e localizaveis. `NaN` e valores infinitos continuarao proibidos no JSON.

### Interface, graficos e exportacao implementados

- O cadastro recebe tipo de ensaio, referencia principal, controle basal e resumo das comparacoes antes da codificacao cega.
- A tela de resultados foi reorganizada em plano da analise, populacao e perdas tecnicas, scores por experimento, comparacoes principais, ANOVA em blocos, resposta dos controles, tendencia e graficos.
- O grafico de barras com anotacoes de Tukey foi substituido por pontos dos experimentos, conexao visual dos blocos e um grafico das diferencas contra a referencia com intervalos de confianca.
- O grafico de classes continuara descritivo. Qualquer anotacao de significancia usara o p-valor ajustado.
- HTML, JSON e ZIP registram protocolo, referencia, blocos incluidos/excluidos, comparacoes e tendencia.
- O ZIP acrescenta CSVs especificos para desenho, populacao, ANOVA em blocos, comparacoes principais, controles e tendencia, preservando os arquivos existentes de dados brutos e scores agregados.
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

Pendencias operacionais que continuam validas em paralelo:

1. Executar a checklist em Safari macOS, iPhone e iPad reais, incluindo PWA instalada, baixa disponibilidade de espaco e Pyodide offline.
2. Validar manualmente a sensacao do feedback tatil em Android real.
3. Definir politica de deploy e submeter o novo protocolo cientifico a revisao externa antes de uso critico.

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
- `tests/integration/persistence.test.js`
- `tests/e2e/experiment-flow.spec.js`
- `tests/e2e/analysis-flow.spec.js`
- `tests/e2e/backup-flow.spec.js`
- `tests/e2e/storage-concurrency.spec.js`
- `tests/e2e/storage-diagnostics.spec.js`
- `docs/safari-ios-storage-checklist.md`
- `tests/python/test_cometquant_analysis.py`
- `tests/reference/v1/`
- `tests/reference/v2/`
- `.github/workflows/ci.yml`

## Estado no momento deste registro

- Branch: `main`.
- A continuidade atual inclui schema 5, desenho de genotoxicidade/antigenotoxicidade, ANOVA em blocos, comparacoes planejadas com Holm, resposta separada dos controles, tendencia ajustada por bloco, contrato cientifico v2 e exportacoes detalhadas.
- A fixture `tests/reference/v2/` representa tres experimentos independentes e foi validada com calculos SciPy externos ao motor, R e execucao real no Pyodide.
- A aplicacao esta na versao `2.0.0` e o shell offline usa `cometquant-shell-v11`.
- A implementacao possui validacao estatistica automatizada independente para o protocolo v2, mas ainda nao deve ser tratada como software validado para uso regulatorio ou producao critica.
- Ha CI automatizada e matriz Chromium/WebKit, mas ainda nao ha politica formal de deploy, validacao em Safari/iOS real ou protocolo cientifico revisado externamente.
- O backup exportado e criptografado, mas IndexedDB permanece em texto claro. O CDN e necessario apenas para instalar o pacote cientifico pinado; depois da verificacao de integridade, o runtime funciona offline.
