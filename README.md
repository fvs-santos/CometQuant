# CometQuant Lab

Mobile-first PWA for blinded visual scoring and statistical analysis of comet
assay experiments. All experiment data remains in the browser; the application
has no backend or remote database.

## Requirements

- Node.js 20 or newer for development and automated tests.
- Python 3.12 with `requirements-test.txt` for statistical engine tests.
- R 4 or newer only for the optional independent statistical audit.
- Chromium and WebKit installed by Playwright for browser tests.

## Development

```powershell
npm ci
npx playwright install chromium webkit
python -m pip install -r requirements-test.txt
npm run check
npm test
npm run test:analysis
npm run test:reference:r
npm run test:e2e
```

Use `npm run test:e2e:chromium` or `npm run test:e2e:webkit` to run one browser
project. The WebKit project emulates an iPhone but does not replace validation
on Safari and real iOS hardware.

`npm ci` copies JSZip to `vendor/` so ZIP exports work in static deployments.
Use `npx http-server . -p 4173 -c-1` to run the application locally.

## Architecture

- `index.html` and `css/style.css`: static application shell and responsive UI.
- `js/app.js`: navigation, blinded counting and transactional local persistence.
- `js/legacy-xlsx.js`: constrained offline importer for legacy Comet VisualScore workbooks.
- `js/backup.js`: password-based encrypted backup envelopes for active blinding.
- `js/core.js`: schema migration, validation, scoring, aggregation and merge.
- `js/analysis.js`: Pyodide bridge, result rendering and analysis exports.
- `js/science-package.js`: verified scientific package installation and storage diagnostics.
- `python/cometquant_analysis.py`: statistical engine used by both Pyodide and Python tests.
- `js/export.js`: safe JSON, CSV, HTML and ZIP builders.
- `service-worker.js`: application-shell cache for the PWA.

Scripts are loaded as classic browser scripts, so their order in `index.html`
is significant.

## Data And Blinding

The current experiment schema is version 6. Each replicate contains a complete
mapping of blind assignments and counted slides. Assignment states are
`pending`, `counting`, `counted` or `absent`.

New experiments record a versioned study design before blind codes are generated.
The design identifies genotoxicity or antigenotoxicity, the primary reference,
the test concentrations, the separate control-response comparison and structured
numeric concentration metadata. Genotoxicity compares concentrations with the
selected negative or vehicle control. Antigenotoxicity compares combined
treatments with the positive mutagen-only control. The design is not shown while
counting is blinded.

After blinding is complete, a counted or absent slide can be corrected from the
experiment summary. Every correction requires a responsible person's name and a
free-text reason. The application saves the previous and corrected terminal
states in an append-only `slideEditHistory` event in the same IndexedDB
transaction. Current `gels` and `assignments` remain the only scientific input;
the history is exported separately in HTML and `slide_corrections.csv` and is
included in JSON, encrypted backups and ZIP packages.

New blind codes use two ordered letters and an unpadded slide number, such as
`AB1`, `AB2` or `CY10`. The 676 bases from `AA` through `ZZ` are allocated
without reuse across the whole experiment. Legacy codes such as `ABCD-01`
remain valid and are preserved unchanged during migration and import.

Counts are committed atomically to IndexedDB after every increment and undo.
Terminal operations only advance the interface after a successful validated
write. Unknown, future-version and malformed legacy entries are quarantined
and remain available through the storage recovery export.

Blinding prevents accidental disclosure in the normal UI. It is not
cryptographic protection: treatment mappings remain present in local browser
storage. Revealing summaries, analyses and exports remain blocked while slides
are pending.

While blinding is active, the experiment list offers an encrypted backup instead
of plaintext JSON export. The envelope uses PBKDF2-SHA-256 with 600,000
iterations and AES-256-GCM with random salt and IV. The password is never stored
and cannot be recovered. Import detects `.cqbackup.json` files and decrypts them
before normal schema validation. Experiments from schemas 1 through 5 migrate
without an inferred scientific intent and require one explicit study-design
confirmation after blinding is complete before the new analysis can run.

The encrypted envelope protects a copied backup file against offline inspection
when a strong passphrase is used. It does not protect against someone with
access to the unlocked browser profile, malicious extensions, screen capture or
code executing in the application origin. The externally loaded Pyodide runtime
is therefore part of the trusted computing base and should be hosted locally
before handling data with stricter confidentiality requirements.

## Statistical Protocol

An independent experiment is the experimental unit and statistical block.
Counted technical slides with a positive, internally consistent class total are
scored using that effective total and averaged within each experiment and
treatment. A count above or below the collection target remains analyzable and
is reported as off-target. One valid slide keeps the cell in the analysis while
the technical loss is reported. If no valid slide exists for the primary reference or any primary
concentration, that complete block is explicitly excluded from primary
inference.

Before each run, the user explicitly selects the independent experiments that
form the candidate analysis population. All repetitions start selected. Removing
one or more repetitions requires a general reason, which is recorded with the
transient selection in the result, report and CSV exports without changing the
stored experiment. The same selection applies to primary inference, control
response, sensitivity analyses and charts; technical eligibility is evaluated
separately after that selection.

The version 4 analysis contract requires at least three independent experiments
with a complete primary cell before the standard inferential analysis runs; with
fewer, the engine returns descriptive statistics, charts and an explicit
insufficiency reason instead of an inferential result. When estimable, the
contract provides:

- an automatic design-validation step (`validation`) reporting independent
  experiment count, block completeness, control presence, score-range sanity
  and a floor/ceiling accumulation flag, computed before any statistical test;
- randomized complete block ANOVA using `score ~ treatment + experiment`,
  kept for the technical appendix only and never gating the planned comparisons;
- visual scores divided by the effective positive class-count total for each slide, with off-target slides retained and flagged;
- planned two-sided comparisons of each concentration against the configured
  reference, adjusted with Dunnett's single-step procedure (`comparisonMethod:
  "dunnett"`) generalized to the block model's own residual variance and
  degrees of freedom, with simultaneous 95% confidence intervals coherent with
  the adjusted p-values;
- an explicit `increaseDetected` flag per comparison (significant and in the
  direction expected for the assay type) rather than plain significance alone;
- a separate paired-style control-response comparison (positive control vs.
  reference) that never classifies assay validity by itself;
- the exact Page L test as the sole standard concentration-trend check, with
  its direction pre-specified from the assay type — it does not replace the
  Dunnett comparisons and is not required to be significant to recognize an
  effect at a single concentration;
- collapsed technical diagnostics (residuals vs. fitted, a Q-Q reference,
  per-block treatment-vs-reference differences, and leave-one-block-out
  influence) available once at least four independent experiments are
  included; influence analysis reports direction/magnitude stability only and
  never produces new p-values;
- an orientative interpretation block (`interpretation`) mapping Dunnett
  significance x Page L significance x an essential validity criterion to one
  of five hedged conclusion codes — the essential validity criterion fails
  only when the positive-control comparison could not be estimated, or was
  estimated and is significant in the direction opposite to expected; a
  non-significant control response in the expected direction raises a
  separate uncertainty alert instead;
- per-treatment dispersion (mean, SD, CV) with a variance-heterogeneity flag,
  kept out of the primary synthesis.

Shapiro-Wilk, one-way ANOVA, Tukey HSD, Holm-adjusted comparisons, the
Friedman omnibus test, the arcsine-sqrt transformed sensitivity re-run, and
linear dose-trend regression are not part of the v4 runtime contract. Their
implementations remain in `python/cometquant_analysis.py`, unused by
`analyze_experiment`, for potential future reactivation. The application
reports statistical evidence and magnitude with hedged language (e.g.
"evidence of increased DNA damage"); it never automatically classifies a
compound as genotoxic, non-genotoxic or antigenotoxic, and absence of
significance is never presented as proof of absence of effect.

Undefined analyses return an explicit `performed: false` result and structured
reason. JSON serialization rejects non-finite values, and small p-values retain
their numeric precision while the UI formats them only for presentation.

## Independent Validation

`tests/reference/v2/` contains three independent experiments, five treatments
and two technical slides per cell, including a cell retained with one valid
slide; it remains the fixture for the block ANOVA, control response and Page L
trend, validated with explicit SciPy formulas and base R. `tests/reference/v3/`
reuses the same underlying data to independently validate the Dunnett-adjusted
planned comparisons: `scripts/calculate_reference_results.py` computes an
oracle with `scipy.stats.multivariate_t` (not `scipy.stats.dunnett`, which only
supports a one-way design and would silently ignore the block structure), and
`tests/reference/v3/reference_analysis.R` cross-validates it with
`multcomp::glht` on a `lm(score ~ treatment + block)` fit — the one place in
the test suite that intentionally uses an external R package, since Dunnett's
generalization to a block model has no base-R equivalent. `tests/reference/v1/`
remains immutable historical evidence for the retired one-way protocol. R is
never loaded by the browser application.

Playwright also runs the extracted Python engine inside real Pyodide and checks
the rendered v4 reference results, explicit repetition selection and three generated charts.

## Deployment And Offline Behavior

The project can be deployed to any HTTPS static host. Keep the existing paths
relative to the repository root and update the shell cache version in
`service-worker.js` when cached resources change.

The application shell never downloads Pyodide during startup. Statistical
analysis is an optional package prepared by explicit user action. Its pinned
assets are downloaded from jsDelivr, verified with SHA-256 and stored in a
separate Cache Storage namespace. The transfer is about 35.7 MB and the
verified content occupies about 104.4 MB; 120-150 MB of free origin storage is
recommended. Once prepared, the analysis worker and all scientific packages
run after a fully offline reload. Counting remains available without the
scientific package.

Experiments are stored atomically in IndexedDB with monotonic revisions.
Existing `localStorage` data is copied on first use, and malformed, duplicate
or future-version records are retained in quarantine. When quarantine data is
present, the experiments screen offers a recovery export. Encrypted backups
remain the durable transfer and disaster-recovery mechanism.

The Storage Diagnostics screen reports API availability, estimated usage and
quota, persistent-storage state, offline shell state and scientific package
status. These values are technical estimates and the report contains no
experiment contents or experiment counts. It does include a timestamp, browser
user agent and platform string for troubleshooting. Real-device validation follows
`docs/safari-ios-storage-checklist.md`.

Chromium automation performs a fully offline reload. Playwright WebKit verifies
cache completeness and runtime reuse after reload; true offline process restart
and storage eviction remain part of the real-device checklist.

## Known Limitations

- IndexedDB data at rest is not encrypted and remains accessible to a user with browser or device access.
- Encrypted backup protects the exported file, not a device user with access to browser storage or developer tools.
- Merge rejects active partial progress instead of reconciling concurrent counts.
- Browser automation covers Chromium/Pixel 7 and Playwright WebKit/iPhone emulation; Safari/iOS support still requires the real-device checklist.
- The comet class illustrations are provisional.
- Three independent experiments are supported as the common assay design, but estimates and confidence intervals may remain imprecise; statistical non-significance is not evidence of equivalence or absence of effect.
- The blocked model assumes additive block effects (no treatment-by-experiment interaction), which is undiagnosable with a single replication per cell; this assumption is declared rather than testable.
- The two-treatment validation block model estimates its residual with few degrees of freedom; the separate model is kept intentionally rather than pooling error with the primary population.
- The experiment schema has no viability/cytotoxicity field; the report always states that this data is not collected rather than inferring a threshold.
- Dunnett's adjusted p-values and simultaneous confidence intervals are estimated by quasi-Monte Carlo integration of the multivariate-t reference distribution (both in `scipy.stats.multivariate_t` and in the R oracle's `multcomp::glht`); the production engine uses a fixed random seed for reproducibility, but independent cross-validation runs are only expected to agree within a numeric tolerance, not bit-for-bit, especially for very small p-values.

## Changelog

### 2.3.1 — Fix stale Service Worker causing analysis contract mismatches

- Fixed a Service Worker update race that could leave an already-open tab
  running JavaScript from one shell version while its background fetches
  (e.g. the Python engine) were served from a newly-activated cache belonging
  to a different version, tripping the analysis result-version guard with
  "The scientific engine returned an incompatible result version." This only
  affected tabs that had a prior CometQuant visit under an older Service
  Worker and updated in the background during the session (hosted deployments
  such as GitHub Pages, not a fresh `Live Server`/first-visit session, which
  is why it was hard to reproduce locally).
- The page now reloads itself when the Service Worker's controller changes
  mid-session after it already had one at load (a genuine version swap), so
  every asset for a given page load — HTML, JS and the Python engine — always
  comes from a single, consistent shell version. The very first activation of
  a brand-new install is left alone, since that load's assets already match
  the version being activated.
- Offline shell cache bumped to `cometquant-shell-v25`; if you hit the
  incompatible-version error before this fix, a hard refresh
  (Ctrl+Shift+R / clear site data) resolves it immediately without waiting
  for the next visit's background update.

### 2.3.0 — Statistics engine v4 (Dunnett-based synthesis)

- Planned comparisons against the reference now use Dunnett's single-step
  adjustment generalized to the randomized-complete-block model's own residual
  variance and degrees of freedom (`comparisonMethod: "dunnett"`), replacing
  Holm, with simultaneous 95% confidence intervals coherent with the adjusted
  p-values. Validated against an independent SciPy oracle and against R's
  `multcomp::glht`.
- The exact Page L test is now the only standard concentration-trend check;
  Friedman, the arcsine-sqrt transformed sensitivity re-run and the linear
  dose-trend regression are no longer part of the standard contract or report
  (their implementations remain in `python/cometquant_analysis.py`, unused).
- Added an automatic design-validation step (independent experiment count,
  control presence, score-range sanity, floor/ceiling flag) that runs before
  any statistical test, and a collapsed technical diagnostics section
  (residuals, Q-Q reference, leave-one-block-out influence) available from
  four independent experiments.
- Added an orientative interpretation block mapping Dunnett/Page L/validity to
  one of five hedged conclusion codes; the application still never classifies
  a compound as genotoxic, non-genotoxic or antigenotoxic.
- The standard inferential analysis now requires at least three independent
  experiments; with fewer, only descriptive statistics, population and charts
  are returned.
- Reorganized the exported HTML report and the in-app results screen into:
  study identification, validity/data-integrity, evidence synthesis, main
  chart (with same-experiment points connected across treatments), primary
  comparisons, trend, positive control, diagnostics, an auto-generated
  methods paragraph, and a technical appendix.
- `analysisSchemaVersion` moved from 3 to 4; the contract no longer includes
  `doseTrend`, `nonParametric` or `transformedAnalysis`. Since analysis
  results are never persisted or re-imported by the application, this is a
  forward-looking contract change with no experiment-data migration.
- CSV exports were renamed/added to match: `buildPrimaryComparisonsCsv`,
  `buildTrendCsv`, `buildValidationCsv`, `buildDiagnosticsResidualsCsv`,
  `buildDiagnosticsInfluenceCsv`, `buildInterpretationCsv`; `buildDoseTrendCsv`,
  `buildNonParametricCsv` and `buildTransformedAnalysisCsv` were removed.
- `tests/reference/v3/` was added (same underlying data as `v2/`) with an
  R oracle using `multcomp::glht`, the one exception to the project's
  "no external R packages" testing convention.
