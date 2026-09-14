# Independent R oracle for analysis schema version 4 (Dunnett-based planned comparisons).
#
# This is the one place in the project's test suite that intentionally breaks the
# "no external R packages" convention used elsewhere (see tests/reference/v2/reference_analysis.R
# and MEMORY.md). Dunnett's single-step adjustment for a general linear model (here, an RCBD:
# score ~ treatment + block) requires integrating an equicorrelated multivariate-t reference
# distribution using the model's own residual variance/df -- scipy.stats.dunnett cannot be used
# directly for this (see python/cometquant_analysis.py's _dunnett_adjusted_pvalues docstring),
# and there is no base-R equivalent. `multcomp::glht` (which depends on `mvtnorm`) is the
# standard, documented R implementation of this exact generalization, and is the reference the
# project's implementation prompt explicitly names.
#
# Usage: Rscript reference_analysis.R slides.csv output.csv

if (!requireNamespace("multcomp", quietly = TRUE)) {
  stop("The 'multcomp' package is required to validate Dunnett contrasts. Install it with: ",
       "install.packages('multcomp', repos = 'https://cloud.r-project.org')")
}
suppressMessages(library(multcomp))

args <- commandArgs(trailingOnly = TRUE)
input <- if (length(args)) args[[1]] else "slides.csv"
output <- if (length(args) >= 2) args[[2]] else ""
slides <- read.csv(input, stringsAsFactors = FALSE)
valid <- subset(slides, status == "counted" & completion == "complete")
cells <- aggregate(score ~ replicate_number + treatment_index + treatment, valid, mean)

primary_indices <- c(0, 2, 3, 4)
primary <- subset(cells, treatment_index %in% primary_indices)
complete_blocks <- as.numeric(names(which(table(primary$replicate_number) == length(primary_indices))))
primary <- subset(primary, replicate_number %in% complete_blocks)
primary$treatment_index <- factor(primary$treatment_index, levels = primary_indices)
primary$replicate_number <- factor(primary$replicate_number, levels = complete_blocks)

fit <- lm(score ~ treatment_index + replicate_number, primary)
anova_table <- anova(fit)
mse <- anova_table["Residuals", "Mean Sq"]
residual_df <- anova_table["Residuals", "Df"]

metrics <- character()
values <- numeric()
add_metric <- function(metric, value) {
  metrics <<- c(metrics, metric)
  values <<- c(values, as.numeric(value))
}

for (term in c("treatment_index", "replicate_number", "Residuals")) {
  label <- if (term == "treatment_index") "treatment" else if (term == "replicate_number") "block" else "residual"
  add_metric(paste("blockAnova", label, "SS", sep = "::"), anova_table[term, "Sum Sq"])
  add_metric(paste("blockAnova", label, "DF", sep = "::"), anova_table[term, "Df"])
  add_metric(paste("blockAnova", label, "MS", sep = "::"), anova_table[term, "Mean Sq"])
  if (term != "Residuals") {
    add_metric(paste("blockAnova", label, "F", sep = "::"), anova_table[term, "F value"])
    add_metric(paste("blockAnova", label, "p", sep = "::"), anova_table[term, "Pr(>F)"])
  }
}

# Unadjusted (raw) per-comparison statistics: identical closed-form formulas to
# python/cometquant_analysis.py's _comparison_result, requiring no external package.
raw_p <- numeric()
contrast_rows <- list()
for (index in primary_indices[-1]) {
  reference_values <- primary$score[primary$treatment_index == 0]
  treatment_values <- primary$score[primary$treatment_index == index]
  difference <- mean(treatment_values) - mean(reference_values)
  standard_error <- sqrt(mse * 2 / length(complete_blocks))
  statistic <- difference / standard_error
  p_value <- 2 * pt(-abs(statistic), residual_df)
  raw_p <- c(raw_p, p_value)
  contrast_rows[[length(contrast_rows) + 1]] <- c(
    reference_mean = mean(reference_values), treatment_mean = mean(treatment_values),
    difference = difference, standard_error = standard_error, t = statistic,
    DF = residual_df, p_raw = p_value
  )
}
for (position in seq_along(contrast_rows)) {
  index <- primary_indices[position + 1]
  for (field in names(contrast_rows[[position]])) {
    add_metric(paste("primaryComparison", index, field, sep = "::"), contrast_rows[[position]][field])
  }
}

# Dunnett-adjusted p-values and simultaneous 95% CI: multcomp::glht fits the single-step
# Dunnett procedure on the RCBD model's own vcov()/residual df (NOT a naive one-way estimate),
# which is the correct generalization of Dunnett (1955) to a general linear model.
dunnett <- glht(fit, linfct = mcp(treatment_index = "Dunnett"))
dunnett_summary <- summary(dunnett)
dunnett_ci <- confint(dunnett, level = 0.95)
comparison_order <- primary_indices[-1]
for (position in seq_along(comparison_order)) {
  index <- comparison_order[position]
  add_metric(paste("primaryComparison", index, "p_adjusted", sep = "::"), dunnett_summary$test$pvalues[position])
  add_metric(paste("primaryComparison", index, "ci_low", sep = "::"), dunnett_ci$confint[position, "lwr"])
  add_metric(paste("primaryComparison", index, "ci_high", sep = "::"), dunnett_ci$confint[position, "upr"])
}
first_standard_error <- contrast_rows[[1]]["standard_error"]
first_allowance <- dunnett_ci$confint[1, "upr"] - dunnett_ci$confint[1, "Estimate"]
add_metric("dunnettCriticalValue", first_allowance / first_standard_error)

# Positive control vs its basal reference: separate 2-treatment block model, no multiplicity
# adjustment needed (a single comparison), same closed-form formulas as v2.
validation <- subset(cells, treatment_index %in% c(0, 1))
validation_blocks <- as.numeric(names(which(table(validation$replicate_number) == 2)))
validation <- subset(validation, replicate_number %in% validation_blocks)
validation$treatment_index <- factor(validation$treatment_index, levels = c(0, 1))
validation$replicate_number <- factor(validation$replicate_number, levels = validation_blocks)
validation_fit <- lm(score ~ treatment_index + replicate_number, validation)
validation_anova <- anova(validation_fit)
validation_mse <- validation_anova["Residuals", "Mean Sq"]
validation_df <- validation_anova["Residuals", "Df"]
validation_reference <- validation$score[validation$treatment_index == 0]
validation_treatment <- validation$score[validation$treatment_index == 1]
validation_difference <- mean(validation_treatment) - mean(validation_reference)
validation_se <- sqrt(validation_mse * 2 / length(validation_blocks))
validation_t <- validation_difference / validation_se
add_metric("controlResponse::difference", validation_difference)
add_metric("controlResponse::t", validation_t)
add_metric("controlResponse::p", 2 * pt(-abs(validation_t), validation_df))

# Page L exact trend test: same hand-rolled exact permutation enumeration as v2 (base R only).
permutation_matrix <- function(k) {
  result <- matrix(NA, nrow = factorial(k), ncol = k)
  index <- 1
  recurse <- function(prefix, remaining) {
    if (length(remaining) == 0) {
      result[index, ] <<- prefix
      index <<- index + 1
      return(invisible(NULL))
    }
    for (value in remaining) {
      recurse(c(prefix, value), setdiff(remaining, value))
    }
  }
  recurse(numeric(0), seq_len(k))
  result
}

build_matrix <- function(data, indices) {
  data$treatment_index <- as.numeric(as.character(data$treatment_index))
  data$replicate_number <- as.numeric(as.character(data$replicate_number))
  data <- data[data$treatment_index %in% indices, ]
  blocks <- sort(unique(data$replicate_number))
  data$treatment_order <- match(data$treatment_index, indices)
  data <- data[order(data$replicate_number, data$treatment_order), ]
  matrix(data$score, nrow = length(blocks), ncol = length(indices), byrow = TRUE)
}

primary_matrix <- build_matrix(primary, primary_indices)
rank_matrix <- t(apply(primary_matrix, 1, rank, ties.method = "average"))
n_blocks <- nrow(primary_matrix)
n_treatments <- ncol(primary_matrix)
permutations <- permutation_matrix(n_treatments)
column_sums <- colSums(rank_matrix)
page_statistic <- function(sums) sum(seq_len(n_treatments) * sums)

exact_ge_count <- function(statistic_fn, observed) {
  count <- 0
  recurse <- function(block_index, current_sums) {
    if (block_index > n_blocks) {
      if (statistic_fn(current_sums) >= observed - 1e-12) {
        count <<- count + 1
      }
      return(invisible(NULL))
    }
    row <- rank_matrix[block_index, ]
    for (perm_index in seq_len(nrow(permutations))) {
      recurse(block_index + 1, current_sums + row[permutations[perm_index, ]])
    }
  }
  recurse(1, numeric(n_treatments))
  count
}

page_observed <- page_statistic(column_sums)
arrangements <- factorial(n_treatments)^n_blocks
add_metric("trendAnalysis::pageTrend::statistic", page_observed)
add_metric(
  "trendAnalysis::pageTrend::pExact",
  exact_ge_count(page_statistic, page_observed) / arrangements
)

cat("Aggregated cells:\n")
print(cells)
cat("\nPrimary RCBD:\n")
print(anova_table)
cat("\nDunnett (multcomp::glht):\n")
print(dunnett_summary)
if (nzchar(output)) write.csv(data.frame(metric = metrics, value = values), output, row.names = FALSE)
