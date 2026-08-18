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

cat("Aggregated cells:\n")
print(cells)
cat("\nPrimary RCBD:\n")
print(anova_table)
cat("\nDose trend:\n")
print(trend_summary)
if (nzchar(output)) write.csv(data.frame(metric = metrics, value = values), output, row.names = FALSE)
