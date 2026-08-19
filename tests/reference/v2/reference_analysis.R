# Independent base R oracle for analysis schema version 2.
# Usage: Rscript reference_analysis.R slides.csv output.csv

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
critical <- qt(0.975, residual_df)

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
    DF = residual_df, ci_low = difference - critical * standard_error,
    ci_high = difference + critical * standard_error, p_raw = p_value
  )
}
adjusted <- p.adjust(raw_p, method = "holm")
for (position in seq_along(contrast_rows)) {
  index <- primary_indices[position + 1]
  for (field in names(contrast_rows[[position]])) {
    add_metric(paste("primaryComparison", index, field, sep = "::"), contrast_rows[[position]][field])
  }
  add_metric(paste("primaryComparison", index, "p_adjusted", sep = "::"), adjusted[position])
}

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
validation_critical <- qt(0.975, validation_df)
add_metric("controlResponse::MSE", validation_mse)
add_metric("controlResponse::DF", validation_df)
add_metric("controlResponse::difference", validation_difference)
add_metric("controlResponse::standard_error", validation_se)
add_metric("controlResponse::t", validation_t)
add_metric("controlResponse::ci_low", validation_difference - validation_critical * validation_se)
add_metric("controlResponse::ci_high", validation_difference + validation_critical * validation_se)
add_metric("controlResponse::p", 2 * pt(-abs(validation_t), validation_df))

dose_lookup <- c("0" = 0, "2" = 1, "3" = 5, "4" = 10)
primary$concentration <- as.numeric(dose_lookup[as.character(primary$treatment_index)])
trend_fit <- lm(score ~ replicate_number + concentration, primary)
trend_summary <- summary(trend_fit)
trend_ci <- confint(trend_fit, "concentration", level = 0.95)
trend_coefficient <- trend_summary$coefficients["concentration", ]
add_metric("doseTrend::slope", trend_coefficient["Estimate"])
add_metric("doseTrend::standard_error", trend_coefficient["Std. Error"])
add_metric("doseTrend::t", trend_coefficient["t value"])
add_metric("doseTrend::DF", trend_summary$df[2])
add_metric("doseTrend::MSE", sum(residuals(trend_fit)^2) / trend_summary$df[2])
add_metric("doseTrend::ci_low", trend_ci[1])
add_metric("doseTrend::ci_high", trend_ci[2])
add_metric("doseTrend::p", trend_coefficient["Pr(>|t|)"])
add_metric("doseTrend::r2", trend_summary$r.squared)

reduced_fit <- lm(score ~ replicate_number, primary)
reduced_residuals <- residuals(reduced_fit)
trend_residuals <- residuals(trend_fit)
add_metric("doseTrend::r2_partial", 1 - sum(trend_residuals^2) / sum(reduced_residuals^2))

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
friedman_statistic <- function(sums) {
  12 / (n_blocks * n_treatments * (n_treatments + 1)) * sum(sums^2) -
    3 * n_blocks * (n_treatments + 1)
}
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

friedman_observed <- friedman_statistic(column_sums)
add_metric("nonParametric::friedman::Q", friedman_observed)
add_metric("nonParametric::friedman::df", n_treatments - 1)
friedman_total <- factorial(n_treatments)^n_blocks
add_metric(
  "nonParametric::friedman::pExact",
  exact_ge_count(friedman_statistic, friedman_observed) / friedman_total
)
add_metric("nonParametric::friedman::exactArrangements", friedman_total)

page_observed <- page_statistic(column_sums)
add_metric("nonParametric::page::L", page_observed)
add_metric(
  "nonParametric::page::pExact",
  exact_ge_count(page_statistic, page_observed) / friedman_total
)

reversed_rank_matrix <- rank_matrix[, rev(seq_len(n_treatments))]
reversed_observed <- page_statistic(colSums(reversed_rank_matrix))
reversed_count <- 0
recurse_reversed <- function(block_index, current_sums) {
  if (block_index > n_blocks) {
    if (page_statistic(current_sums) >= reversed_observed - 1e-12) {
      reversed_count <<- reversed_count + 1
    }
    return(invisible(NULL))
  }
  row <- reversed_rank_matrix[block_index, ]
  for (perm_index in seq_len(nrow(permutations))) {
    recurse_reversed(block_index + 1, current_sums + row[permutations[perm_index, ]])
  }
}
recurse_reversed(1, numeric(n_treatments))
add_metric("nonParametric::page::pExactOpposite", reversed_count / friedman_total)

transformed <- asin(sqrt(pmin(pmax(primary_matrix, 0), 100) / 100))
transformed_scores <- numeric(nrow(primary))
for (row_index in seq_len(nrow(primary))) {
  block_value <- as.numeric(as.character(primary$replicate_number[row_index]))
  treatment_value <- as.numeric(as.character(primary$treatment_index[row_index]))
  transformed_scores[row_index] <- transformed[
    match(block_value, complete_blocks),
    match(treatment_value, primary_indices)
  ]
}
primary$score_transformed <- transformed_scores
transformed_fit <- lm(score_transformed ~ treatment_index + replicate_number, primary)
transformed_anova <- anova(transformed_fit)
transformed_mse <- transformed_anova["Residuals", "Mean Sq"]
transformed_residual_df <- transformed_anova["Residuals", "Df"]
for (term in c("treatment_index", "replicate_number", "Residuals")) {
  label <- if (term == "treatment_index") "treatment" else if (term == "replicate_number") "block" else "residual"
  add_metric(paste("transformed::blockAnova", label, "SS", sep = "::"), transformed_anova[term, "Sum Sq"])
  add_metric(paste("transformed::blockAnova", label, "DF", sep = "::"), transformed_anova[term, "Df"])
  add_metric(paste("transformed::blockAnova", label, "MS", sep = "::"), transformed_anova[term, "Mean Sq"])
  if (term != "Residuals") {
    add_metric(paste("transformed::blockAnova", label, "F", sep = "::"), transformed_anova[term, "F value"])
    add_metric(paste("transformed::blockAnova", label, "p", sep = "::"), transformed_anova[term, "Pr(>F)"])
  }
}
transformed_reference <- primary$score_transformed[primary$treatment_index == 0]
transformed_raw_p <- numeric()
for (index in primary_indices[-1]) {
  transformed_treatment <- primary$score_transformed[primary$treatment_index == index]
  transformed_difference <- mean(transformed_treatment) - mean(transformed_reference)
  transformed_se <- sqrt(transformed_mse * 2 / length(complete_blocks))
  transformed_t_statistic <- transformed_difference / transformed_se
  transformed_p <- 2 * pt(-abs(transformed_t_statistic), transformed_residual_df)
  transformed_raw_p <- c(transformed_raw_p, transformed_p)
  add_metric(paste("transformed::comparison", index, "difference", sep = "::"), transformed_difference)
  add_metric(paste("transformed::comparison", index, "p", sep = "::"), transformed_p)
}
transformed_adjusted <- p.adjust(transformed_raw_p, method = "holm")
for (position in seq_along(transformed_adjusted)) {
  index <- primary_indices[position + 1]
  add_metric(paste("transformed::comparison", index, "p_adjusted", sep = "::"), transformed_adjusted[position])
}
transformed_trend_fit <- lm(score_transformed ~ replicate_number + concentration, primary)
transformed_trend_summary <- summary(transformed_trend_fit)
add_metric("transformed::trend::slope", transformed_trend_summary$coefficients["concentration", "Estimate"])
add_metric("transformed::trend::p", transformed_trend_summary$coefficients["concentration", "Pr(>|t|)"])

cat("Aggregated cells:\n")
print(cells)
cat("\nPrimary RCBD:\n")
print(anova_table)
cat("\nDose trend:\n")
print(trend_summary)
if (nzchar(output)) write.csv(data.frame(metric = metrics, value = values), output, row.names = FALSE)
