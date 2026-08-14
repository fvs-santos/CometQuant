import csv
import json
import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

import cometquant_analysis as engine


REFERENCE = ROOT / "tests" / "reference" / "v1"


def reference_experiment():
    replicates = {}
    treatments = []
    with (REFERENCE / "slides.csv").open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            treatment = row["treatment"]
            if treatment not in treatments:
                treatments.append(treatment)
            replicate = replicates.setdefault(int(row["replicate"]), {"gels": []})
            score = float(row["score"])
            replicate["gels"].append(
                {
                    "treatment": treatment,
                    "class0": 100 - score,
                    "class1": 0,
                    "class2": 0,
                    "class3": 0,
                    "class4": score,
                    "status": "counted",
                    "completion": "complete",
                }
            )
    return {
        "nucleoidsPerGel": 100,
        "treatments": treatments,
        "replicates": [replicates[number] for number in sorted(replicates)],
        "negControl": "Control",
        "posControl": "",
        "solControl": "",
    }


class ReferenceResultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.experiment = reference_experiment()
        cls.expected = json.loads((REFERENCE / "expected.json").read_text(encoding="utf-8"))
        cls.scores = engine.calculate_scores(cls.experiment)

    def assert_close(self, actual, expected):
        self.assertAlmostEqual(actual, expected, delta=0.00001)

    def assert_probability_close(self, actual, expected):
        if expected > 0:
            self.assertGreater(actual, 0)
        self.assertTrue(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=0), f"{actual} != {expected}")

    def test_technical_slides_are_averaged_within_each_repetition(self):
        self.assertEqual(self.scores, self.expected["scores"])
        self.assertEqual(len(self.experiment["replicates"][0]["gels"]), 8)
        self.assertEqual(len(self.scores["Control"]), 5)

    def test_matches_versioned_independent_reference(self):
        shapiro = engine.calculate_shapiro(self.scores)
        for treatment, expected in self.expected["shapiro"].items():
            with self.subTest(test="shapiro", treatment=treatment):
                self.assertTrue(shapiro[treatment]["performed"])
                self.assert_close(shapiro[treatment]["W"], expected["W"])
                self.assert_probability_close(shapiro[treatment]["p"], expected["p"])

        anova = engine.calculate_anova(self.scores)
        self.assertTrue(anova["performed"])
        self.assert_probability_close(anova["p"], self.expected["anova"]["p"])
        for field in ("F", "SS", "MS"):
            self.assert_close(anova[field], self.expected["anova"][field])
        self.assertEqual(anova["DF"], self.expected["anova"]["DF"])

        tukey = engine.calculate_tukey(self.scores, anova)
        self.assertTrue(tukey["performed"])
        self.assertEqual(len(tukey["comparisons"]), len(self.expected["tukey"]))
        for actual, expected in zip(tukey["comparisons"], self.expected["tukey"]):
            self.assertEqual((actual["A"], actual["B"]), (expected["A"], expected["B"]))
            self.assert_probability_close(actual["p"], expected["p"])

        regression = engine.calculate_regression(self.scores, self.experiment)
        self.assertTrue(regression["performed"])
        for field, expected in self.expected["regression"].items():
            if field == "p":
                self.assert_probability_close(regression["regression"][field], expected)
            else:
                self.assert_close(regression["regression"][field], expected)
        for field, expected in self.expected["pearson"].items():
            if field == "p":
                self.assert_probability_close(regression["pearson"][field], expected)
            else:
                self.assert_close(regression["pearson"][field], expected)

    def test_complete_engine_returns_strict_json(self):
        serialized = engine.run_all_analyses(json.dumps(self.experiment), "en")
        parsed = json.loads(serialized, parse_constant=lambda value: self.fail(value))
        self.assertTrue(parsed["anova"]["performed"])
        self.assertTrue(parsed["chartScore"].startswith("iVBORw0KGgo"))
        self.assertTrue(parsed["chartClass"].startswith("iVBORw0KGgo"))


class EdgeCaseTests(unittest.TestCase):
    def test_probability_preserves_positive_values_below_machine_epsilon(self):
        self.assertEqual(engine._probability(1e-50), 1e-50)
        self.assertGreater(engine._probability(0), 0)

    def test_shapiro_reports_fewer_than_three_and_zero_variance(self):
        results = engine.calculate_shapiro({"short": [1, 2], "constant": [4, 4, 4]})
        self.assertEqual(results["short"]["reason"]["code"], "insufficient_observations")
        self.assertEqual(results["constant"]["reason"]["code"], "zero_variance")

    def test_anova_does_not_silently_drop_an_insufficient_treatment(self):
        single_group = engine.calculate_anova({"only": [1, 2]})
        self.assertEqual(single_group["reason"]["code"], "insufficient_groups")

        result = engine.calculate_anova({"complete": [1, 2, 3], "short": [4]})
        self.assertFalse(result["performed"])
        self.assertEqual(result["reason"]["code"], "insufficient_repetitions")
        self.assertIn("short (n=1)", result["reason"]["detail"])
        tukey = engine.calculate_tukey({"complete": [1, 2, 3], "short": [4]}, result)
        self.assertEqual(tukey["reason"]["code"], "anova_not_performed")

    def test_anova_and_tukey_report_zero_residual_variance(self):
        anova = engine.calculate_anova({"A": [1, 1], "B": [2, 2]})
        self.assertEqual(anova["reason"]["code"], "zero_within_group_variance")
        tukey = engine.calculate_tukey({"A": [1, 1], "B": [2, 2]}, anova)
        self.assertFalse(tukey["performed"])

    def test_tukey_reports_a_non_significant_anova(self):
        scores = {"A": [1, 2, 3], "B": [1, 2, 3]}
        anova = engine.calculate_anova(scores)
        self.assertTrue(anova["performed"])
        tukey = engine.calculate_tukey(scores, anova)
        self.assertEqual(tukey["reason"]["code"], "anova_not_significant")

    def test_regression_reports_each_undefined_input(self):
        experiment = {"negControl": "", "posControl": "", "solControl": ""}
        cases = [
            ({"1 uM": [1], "2 uM": [2]}, "insufficient_observations"),
            ({"1 uM": [1, 2, 3]}, "single_concentration"),
            ({"1 uM": [4, 4], "2 uM": [4, 4]}, "constant_response"),
        ]
        for scores, reason in cases:
            with self.subTest(reason=reason):
                result = engine.calculate_regression(scores, experiment)
                self.assertFalse(result["performed"])
                self.assertEqual(result["reason"]["code"], reason)

    def test_perfect_correlation_is_finite(self):
        experiment = {"negControl": "", "posControl": "", "solControl": ""}
        result = engine.calculate_regression(
            {"1 uM": [2], "2 uM": [4], "3 uM": [6]}, experiment
        )
        self.assertTrue(result["performed"])
        self.assertEqual(result["pearson"]["r"], 1.0)
        self.assertEqual(result["pearson"]["power"], 1.0)
        json.dumps(result, allow_nan=False)

    def test_correlation_power_uses_the_noncentral_t_distribution(self):
        self.assertAlmostEqual(engine._correlation_power(0.5, 10), 0.30186135, places=8)

    def test_class_chart_aggregates_technical_slides_within_repetitions(self):
        experiment = {
            "treatments": ["A"],
            "replicates": [
                {"gels": [
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 0, "class1": 0, "class2": 0, "class3": 0, "class4": 100},
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 100, "class1": 0, "class2": 0, "class3": 0, "class4": 0},
                ]},
                {"gels": [
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 100, "class1": 0, "class2": 0, "class3": 0, "class4": 0},
                ]},
            ],
        }
        summary = engine.calculate_class_summary(experiment)["A"]
        self.assertEqual(summary["means"][0], 75.0)
        self.assertEqual(summary["standard_deviations"][0], 25.0)


if __name__ == "__main__":
    unittest.main()
