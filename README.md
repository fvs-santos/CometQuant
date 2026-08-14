# CometQuant
An app for Comet Assay Visual Score and Analysis

## Development

```powershell
npm install
npm test
npm run test:analysis
npm run test:reference:r
npm run test:e2e
```

`npm install` copies JSZip to `vendor/` so ZIP exports work in static deployments.

The browser fetches `python/cometquant_analysis.py` and executes that same file in
Pyodide. Python engine tests require Python 3 with the packages in
`requirements-test.txt`; install them with
`python -m pip install -r requirements-test.txt`.

The optional R audit requires R 4 or newer. It runs the same versioned dataset
through base R and compares its Shapiro-Wilk, ANOVA, Tukey, regression and
Pearson results with `tests/reference/v1/expected.json`. R is never loaded by
the browser application.
