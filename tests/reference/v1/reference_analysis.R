# Reproducible independent reference using base R statistical functions.
# Usage: Rscript reference_analysis.R slides.csv

args <- commandArgs(trailingOnly = TRUE)
input <- if (length(args)) args[[1]] else "slides.csv"
output <- if (length(args) >= 2) args[[2]] else ""
slides <- read.csv(input, stringsAsFactors = FALSE)

# Technical slides are averaged before every inferential analysis.
replicates <- aggregate(
  score ~ replicate + treatment + is_control,
  data = slides,
  FUN = mean
)
replicates$concentration <- slides$concentration[
  match(replicates$treatment, slides$treatment)
]
replicates$treatment <- factor(
  replicates$treatment,
  levels = c("Control", "1 uM", "5 uM", "10 uM")
)

cat("Aggregated scores by treatment and repetition:\n")
print(replicates[order(replicates$treatment, replicates$replicate), ])

cat("\nShapiro-Wilk by treatment:\n")
shapiro_results <- by(replicates$score, replicates$treatment, shapiro.test)
print(shapiro_results)

fit <- aov(score ~ treatment, data = replicates)
anova_result <- summary(fit)[[1]]
cat("\nOne-way ANOVA:\n")
print(anova_result)
cat("\nTukey HSD:\n")
tukey_result <- TukeyHSD(fit)$treatment
print(tukey_result)

doses <- subset(replicates, !as.logical(is_control))
regression <- lm(score ~ concentration, data = doses)
regression_summary <- summary(regression)
regression_ci <- confint(regression, level = 0.95)
cat("\nLinear regression:\n")
print(regression_summary)
cat("\n95% coefficient confidence intervals:\n")
print(regression_ci)
cat("\nPearson correlation:\n")
pearson_result <- cor.test(doses$concentration, doses$score, method = "pearson")
print(pearson_result)

if (nzchar(output)) {
  metrics <- character()
  values <- numeric()
  add_metric <- function(metric, value) {
    metrics <<- c(metrics, metric)
    values <<- c(values, as.numeric(value))
  }

  for (treatment in levels(replicates$treatment)) {
    result <- shapiro_results[[treatment]]
    add_metric(paste("shapiro", treatment, "W", sep = "::"), result$statistic)
    add_metric(paste("shapiro", treatment, "p", sep = "::"), result$p.value)
  }

  add_metric("anova::F", anova_result[1, "F value"])
  add_metric("anova::p", anova_result[1, "Pr(>F)"])
  add_metric("anova::SS", anova_result[1, "Sum Sq"])
  add_metric("anova::MS", anova_result[1, "Mean Sq"])
  add_metric("anova::DF", anova_result[1, "Df"])

  treatment_levels <- levels(replicates$treatment)
  for (first in seq_len(length(treatment_levels) - 1)) {
    for (second in seq.int(first + 1, length(treatment_levels))) {
      row_name <- paste(treatment_levels[second], treatment_levels[first], sep = "-")
      metric <- paste("tukey", treatment_levels[first], treatment_levels[second], "p", sep = "::")
      add_metric(metric, tukey_result[row_name, "p adj"])
    }
  }

  coefficients <- regression_summary$coefficients
  add_metric("regression::slope", coefficients["concentration", "Estimate"])
  add_metric("regression::intercept", coefficients["(Intercept)", "Estimate"])
  add_metric("regression::r2", regression_summary$r.squared)
  add_metric("regression::p", coefficients["concentration", "Pr(>|t|)"])
  add_metric("regression::ci_low", regression_ci["concentration", "2.5 %"])
  add_metric("regression::ci_high", regression_ci["concentration", "97.5 %"])

  pearson_r <- unname(pearson_result$estimate)
  degrees_freedom <- nrow(doses) - 2
  noncentrality <- abs(pearson_r) * sqrt(degrees_freedom / (1 - pearson_r^2))
  critical <- qt(0.975, degrees_freedom)
  power <- pt(-critical, degrees_freedom, ncp = noncentrality) +
    (1 - pt(critical, degrees_freedom, ncp = noncentrality))
  add_metric("pearson::r", pearson_r)
  add_metric("pearson::p", pearson_result$p.value)
  add_metric("pearson::power", power)

  write.csv(data.frame(metric = metrics, value = values), output, row.names = FALSE)
}
