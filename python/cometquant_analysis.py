"""Statistical analysis engine used directly by CometQuant's Pyodide runtime."""

import base64
import io
import json

import matplotlib
import numpy as np
from scipy import stats

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _reason(code, detail):
    return {
        "performed": False,
        "reason": {"code": code, "detail": detail},
    }


def _clean_scores(values):
    clean = []
    for value in values:
        if value is None:
            continue
        numeric = float(value)
        if np.isfinite(numeric):
            clean.append(numeric)
    return clean


def _rounded(value, digits=5):
    return round(_finite(value), digits)


def _finite(value):
    numeric = float(value)
    if not np.isfinite(numeric):
        raise ValueError("Statistical calculation produced a non-finite value")
    return numeric


def _probability(value):
    probability = _finite(value)
    if probability < 0 or probability > 1:
        raise ValueError("Statistical calculation produced an invalid probability")
    return float(np.nextafter(0, 1)) if probability == 0 else probability


def _correlation_power(correlation, observation_count, alpha=0.05):
    correlation = abs(_finite(correlation))
    if correlation >= 1:
        return 1.0
    degrees_freedom = observation_count - 2
    noncentrality = correlation * np.sqrt(degrees_freedom / (1 - correlation**2))
    critical = stats.t.ppf(1 - alpha / 2, degrees_freedom)
    return _finite(
        stats.nct.cdf(-critical, degrees_freedom, noncentrality)
        + stats.nct.sf(critical, degrees_freedom, noncentrality)
    )


def calculate_scores(experiment):
    """Average technical slides within each biological replicate."""
    nucleoids = float(experiment["nucleoidsPerGel"])
    if not np.isfinite(nucleoids) or nucleoids <= 0:
        raise ValueError("nucleoidsPerGel must be a positive finite number")

    treatments = experiment["treatments"]
    scores_by_treatment = {treatment: [] for treatment in treatments}

    for replicate in experiment["replicates"]:
        replicate_scores = {treatment: [] for treatment in treatments}
        for gel in replicate["gels"]:
            if (
                gel.get("status", "counted") != "counted"
                or gel.get("completion", "complete") != "complete"
            ):
                continue
            score = (
                0.25 * float(gel["class1"])
                + 0.50 * float(gel["class2"])
                + 0.75 * float(gel["class3"])
                + float(gel["class4"])
            ) / nucleoids * 100
            treatment = gel["treatment"]
            if treatment in replicate_scores and np.isfinite(score):
                replicate_scores[treatment].append(score)

        for treatment, slide_scores in replicate_scores.items():
            if slide_scores:
                scores_by_treatment[treatment].append(float(np.mean(slide_scores)))

    return scores_by_treatment


def calculate_shapiro(scores_by_treatment):
    results = {}
    for treatment, scores in scores_by_treatment.items():
        clean = _clean_scores(scores)
        if len(clean) < 3:
            results[treatment] = _reason(
                "insufficient_observations",
                f"Shapiro-Wilk requires at least 3 observations; received {len(clean)}.",
            )
            continue
        if np.ptp(clean) == 0:
            results[treatment] = _reason(
                "zero_variance",
                "Shapiro-Wilk is not informative when all observations are equal.",
            )
            continue

        statistic, p_value = stats.shapiro(clean)
        results[treatment] = {
            "performed": True,
            "W": _rounded(statistic),
            "p": _probability(p_value),
            "normal": bool(p_value > 0.05),
        }
    return results


def calculate_anova(scores_by_treatment):
    if len(scores_by_treatment) < 2:
        return _reason(
            "insufficient_groups",
            "One-way ANOVA requires at least 2 treatments.",
        )

    groups = []
    insufficient = []
    for treatment, scores in scores_by_treatment.items():
        clean = _clean_scores(scores)
        if len(clean) < 2:
            insufficient.append(f"{treatment} (n={len(clean)})")
        groups.append(clean)

    if insufficient:
        return _reason(
            "insufficient_repetitions",
            "Every treatment must have at least 2 repetitions; insufficient: "
            + ", ".join(insufficient)
            + ".",
        )

    all_values = np.concatenate([np.asarray(group, dtype=float) for group in groups])
    grand_mean = float(np.mean(all_values))
    group_means = [float(np.mean(group)) for group in groups]
    sample_count = len(all_values)
    group_count = len(groups)
    df_between = group_count - 1
    df_within = sample_count - group_count
    ss_between = sum(
        len(group) * (mean - grand_mean) ** 2
        for group, mean in zip(groups, group_means)
    )
    ss_within = sum(
        sum((value - mean) ** 2 for value in group)
        for group, mean in zip(groups, group_means)
    )

    scale = max(1.0, float(np.sum((all_values - grand_mean) ** 2)))
    zero_tolerance = np.finfo(float).eps * scale * sample_count
    if ss_within <= zero_tolerance:
        return _reason(
            "zero_within_group_variance",
            "ANOVA cannot estimate residual variance because observations within every treatment are constant.",
        )

    ms_between = ss_between / df_between
    ms_within = ss_within / df_within
    f_statistic = ms_between / ms_within
    p_value = stats.f.sf(f_statistic, df_between, df_within)

    return {
        "performed": True,
        "F": _rounded(f_statistic),
        "p": _probability(p_value),
        "SS": _rounded(ss_between),
        "MS": _rounded(ms_between),
        "DF": int(df_between),
        "significant": bool(p_value < 0.05),
    }


def calculate_tukey(scores_by_treatment, anova_result):
    if not anova_result or not anova_result.get("performed", False):
        detail = "Tukey HSD requires a completed ANOVA."
        if anova_result and anova_result.get("reason"):
            detail += " " + anova_result["reason"]["detail"]
        return _reason("anova_not_performed", detail)
    if not anova_result["significant"]:
        return _reason(
            "anova_not_significant",
            "Tukey HSD was not performed because the ANOVA p-value is at least 0.05.",
        )

    labels = list(scores_by_treatment)
    groups = [_clean_scores(scores_by_treatment[label]) for label in labels]
    try:
        result = stats.tukey_hsd(*groups)
        comparisons = []
        for first in range(len(labels)):
            for second in range(first + 1, len(labels)):
                p_value = float(result.pvalue[first][second])
                comparisons.append(
                    {
                        "A": labels[first],
                        "B": labels[second],
                        "p": _probability(p_value),
                        "significant": bool(p_value < 0.05),
                    }
                )
    except (ValueError, FloatingPointError):
        return _reason(
            "undefined_tukey_result",
            "Tukey HSD did not produce finite pairwise probabilities.",
        )

    return {"performed": True, "comparisons": comparisons}


def calculate_regression(scores_by_treatment, experiment):
    controls = {
        control
        for control in (
            experiment.get("negControl", ""),
            experiment.get("posControl", ""),
            experiment.get("solControl", ""),
        )
        if control
    }
    x_values = []
    y_values = []

    for treatment, scores in scores_by_treatment.items():
        if treatment in controls:
            continue
        try:
            concentration = float(treatment.split()[0])
        except (ValueError, IndexError):
            continue
        if not np.isfinite(concentration):
            continue
        for score in _clean_scores(scores):
            x_values.append(concentration)
            y_values.append(score)

    observation_count = len(x_values)
    if observation_count < 3:
        return _reason(
            "insufficient_observations",
            f"Linear regression requires at least 3 observations; received {observation_count}.",
        )
    if len(set(x_values)) < 2:
        return _reason(
            "single_concentration",
            "Linear regression requires at least 2 distinct numeric concentrations.",
        )
    if np.ptp(y_values) == 0:
        return _reason(
            "constant_response",
            "Linear regression and Pearson correlation are undefined for a constant response.",
        )

    x = np.asarray(x_values, dtype=float)
    y = np.asarray(y_values, dtype=float)
    regression = stats.linregress(x, y)
    degrees_freedom = observation_count - 2
    t_critical = float(stats.t.ppf(0.975, degrees_freedom))
    ci_low = regression.slope - t_critical * regression.stderr
    ci_high = regression.slope + t_critical * regression.stderr
    pearson_r, pearson_p = stats.pearsonr(x, y)

    power = _correlation_power(pearson_r, observation_count)

    return {
        "performed": True,
        "regression": {
            "slope": _rounded(regression.slope),
            "intercept": _rounded(regression.intercept),
            "r2": _rounded(regression.rvalue**2),
            "p": _probability(regression.pvalue),
            "ci_low": _rounded(ci_low),
            "ci_high": _rounded(ci_high),
        },
        "pearson": {
            "r": _rounded(pearson_r),
            "p": _probability(pearson_p),
            "power": _rounded(power, 3),
        },
    }


def generate_score_chart(scores_by_treatment, tukey_result, experiment, lang):
    treatments = list(scores_by_treatment)
    means = [
        float(np.mean(scores_by_treatment[treatment]))
        if scores_by_treatment[treatment]
        else 0
        for treatment in treatments
    ]
    standard_deviations = [
        float(np.std(scores_by_treatment[treatment]))
        if scores_by_treatment[treatment]
        else 0
        for treatment in treatments
    ]
    reference_control = (
        experiment.get("negControl")
        or experiment.get("solControl")
        or experiment.get("posControl")
        or treatments[0]
    )

    figure, axes = plt.subplots(figsize=(9, 5))
    figure.patch.set_facecolor("#161b22")
    axes.set_facecolor("#161b22")
    axes.bar(
        treatments,
        means,
        yerr=standard_deviations,
        color="#4a9eff",
        alpha=0.85,
        error_kw={"ecolor": "#8b949e", "capsize": 4},
    )

    comparisons = tukey_result.get("comparisons", []) if tukey_result else []
    for comparison in comparisons:
        other = None
        if comparison["A"] == reference_control:
            other = comparison["B"]
        elif comparison["B"] == reference_control:
            other = comparison["A"]
        if other in treatments:
            index = treatments.index(other)
            symbol = (
                "**"
                if comparison["p"] <= 0.01
                else "*" if comparison["p"] <= 0.05 else ""
            )
            if symbol:
                axes.annotate(
                    symbol,
                    xy=(index, means[index] + standard_deviations[index]),
                    ha="center",
                    va="bottom",
                    fontsize=13,
                    color="#f0f6fc",
                    fontweight="bold",
                )

    axes.set_xlabel(
        "Treatments" if lang == "en" else "Tratamentos",
        color="#8b949e",
        fontsize=12,
    )
    axes.set_ylabel(
        "Visual Score (AU)" if lang == "en" else "Score Visual (UA)",
        color="#8b949e",
        fontsize=12,
    )
    axes.tick_params(colors="#8b949e", labelsize=9)
    axes.tick_params(axis="x", labelrotation=30)
    for label in axes.get_xticklabels():
        label.set_horizontalalignment("right")
    for spine in axes.spines.values():
        spine.set_edgecolor("#30363d")

    figure.text(
        0.5,
        -0.02,
        f"** p < 0.01; * p < 0.05; Reference: {reference_control}",
        ha="center",
        fontsize=9,
        color="#8b949e",
    )
    plt.tight_layout()
    return _figure_to_base64(figure)


def calculate_class_summary(experiment):
    treatments = experiment["treatments"]
    class_keys = ["class0", "class1", "class2", "class3", "class4"]
    counts = {
        treatment: {class_key: [] for class_key in class_keys}
        for treatment in treatments
    }

    for replicate in experiment["replicates"]:
        replicate_counts = {
            treatment: {class_key: [] for class_key in class_keys}
            for treatment in treatments
        }
        for gel in replicate["gels"]:
            if (
                gel.get("status", "counted") != "counted"
                or gel.get("completion", "complete") != "complete"
            ):
                continue
            treatment = gel["treatment"]
            if treatment in replicate_counts:
                for class_key in class_keys:
                    replicate_counts[treatment][class_key].append(float(gel[class_key]))

        for treatment in treatments:
            for class_key in class_keys:
                technical_slides = replicate_counts[treatment][class_key]
                if technical_slides:
                    counts[treatment][class_key].append(float(np.mean(technical_slides)))

    return {
        treatment: {
            "means": [
                float(np.mean(counts[treatment][class_key]))
                if counts[treatment][class_key]
                else 0
                for class_key in class_keys
            ],
            "standard_deviations": [
                float(np.std(counts[treatment][class_key]))
                if counts[treatment][class_key]
                else 0
                for class_key in class_keys
            ],
        }
        for treatment in treatments
    }


def generate_classes_chart(experiment, lang):
    treatments = experiment["treatments"]
    class_names = ["Class 0", "Class 1", "Class 2", "Class 3", "Class 4"]
    summary = calculate_class_summary(experiment)
    x_positions = np.arange(len(class_names))
    width = 0.8 / len(treatments)
    colors = ["#4a9eff", "#3fb950", "#d29922", "#f85149", "#bc8cff"]
    figure, axes = plt.subplots(figsize=(10, 5))
    figure.patch.set_facecolor("#161b22")
    axes.set_facecolor("#161b22")

    for index, treatment in enumerate(treatments):
        offset = (index - len(treatments) / 2 + 0.5) * width
        axes.bar(
            x_positions + offset,
            summary[treatment]["means"],
            width,
            yerr=summary[treatment]["standard_deviations"],
            label=treatment,
            color=colors[index % len(colors)],
            alpha=0.85,
            error_kw={"ecolor": "#8b949e", "capsize": 3},
        )

    axes.set_xticks(x_positions)
    axes.set_xticklabels(class_names)
    axes.set_ylabel(
        "Mean Nucleoids" if lang == "en" else "Media de Nucleoides",
        color="#8b949e",
        fontsize=12,
    )
    axes.set_xlabel(
        "Comet Class" if lang == "en" else "Classe do Cometa",
        color="#8b949e",
        fontsize=12,
    )
    axes.tick_params(colors="#8b949e", labelsize=9)
    axes.legend(
        loc="best", fontsize=8, facecolor="#21262d", labelcolor="#e6edf3"
    )
    for spine in axes.spines.values():
        spine.set_edgecolor("#30363d")
    plt.tight_layout()
    return _figure_to_base64(figure)


def _figure_to_base64(figure):
    buffer = io.BytesIO()
    figure.savefig(
        buffer,
        format="png",
        dpi=150,
        bbox_inches="tight",
        facecolor="#161b22",
    )
    plt.close(figure)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def run_all_analyses(experiment_json, lang):
    experiment = json.loads(experiment_json)
    scores = calculate_scores(experiment)
    shapiro = calculate_shapiro(scores)
    anova = calculate_anova(scores)
    tukey = calculate_tukey(scores, anova)
    regression = calculate_regression(scores, experiment)
    result = {
        "scores": scores,
        "shapiro": shapiro,
        "anova": anova,
        "tukey": tukey,
        "regression": regression,
        "chartScore": generate_score_chart(scores, tukey, experiment, lang),
        "chartClass": generate_classes_chart(experiment, lang),
    }
    return json.dumps(result, allow_nan=False, separators=(",", ":"))


print("CometQuant Python environment ready")
