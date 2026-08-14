# Statistical references

`v1/slides.csv` is a versioned raw-slide dataset. It deliberately contains two
technical slides for every treatment/repetition; both are averaged before the
inferential tests.

The checked `v1/expected.json` values were produced by
`python scripts/calculate_reference_results.py` with SciPy 1.13.0. That script
does not import the CometQuant engine: it invokes SciPy independently and
calculates ANOVA sums of squares and Pearson-test power with the noncentral t
distribution. The complete fixture was cross-validated with R 4.6.1 using
`v1/reference_analysis.R` and can be checked again with
`npm run test:reference:r`. R is not part of the application runtime.

R and SciPy can differ in their last reported digits, especially for Tukey HSD.
Engine tests use tolerances at the precision stored in `expected.json`.
