import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import build_data as build


def project_row(**fields):
    row = {
        "PB Cycle": "12",
        "Project": "Example project",
        "Winning Project ID": "PB12_1_1",
        "Total Votes": "5057.0",
        "Winning project": "Yes",
        "Project Cost": "100000.0",
        "Location Description": "To be determined",
        "Short Project Description": "Example description",
        "Project ID Aliases": '["PB12_1_1","PB12_1_2"]',
        "Project Locations": "[]",
    }
    row.update(fields)
    return row


class ProjectTests(unittest.TestCase):
    def test_numeric_exports_and_unknown_locations(self):
        project = build.build_projects([project_row()])[0]
        self.assertEqual((project["cycle"], project["votes"], project["cost"]), ("12", 5057, 100000))
        self.assertEqual(project["locations"], [])
        self.assertEqual(len(project["aliases"]), 2)

    def test_all_locations_belong_to_one_project(self):
        rows = [project_row(**{"Project Locations": "[[42.3671234,-71.1],[42.38,-71.12]]"})]
        projects = build.build_projects(rows)
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0]["locations"], [[42.367123, -71.1], [42.38, -71.12]])
        build.validate_project_links(
            [{"ref": "idea-2", "cycle": "12", "win": "PB12_1_2"}], projects
        )

    def test_losing_project_can_have_no_id(self):
        project = build.build_projects([project_row(**{
            "Winning project": "No", "Winning Project ID": "", "Project ID Aliases": "[]",
        })])[0]
        self.assertIsNone(project["id"])
        self.assertFalse(project["won"])

    def test_rejects_bad_project_values(self):
        cases = [
            {"Total Votes": "1.5"}, {"Project Cost": "NaN"},
            {"Project Cost": "-10"}, {"Total Votes": "unknown"},
            {"Project Locations": "[[42,181]]"}, {"Project Locations": "[[NaN,-71]]"},
            {"Project Locations": "[[true,-71]]"}, {"Project Locations": "{}"},
            {"Project ID Aliases": '["PB11_1_1"]'}, {"Project ID Aliases": '["PB12_1_2"]'},
            {"Project ID Aliases": '["PB12_1_1","PB12_1_1"]'},
            {"PB Cycle": ""}, {"Winning project": "Maybe"},
        ]
        for fields in cases:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                build.build_projects([project_row(**fields)])

    def test_rejects_unresolved_cross_cycle_and_losing_links(self):
        projects = build.build_projects([project_row()])
        for cycle, win in [("12", "PB12_2_1"), ("11", "PB12_1_1")]:
            with self.subTest(cycle=cycle, win=win), self.assertRaises(ValueError):
                build.validate_project_links([{"ref": "x", "cycle": cycle, "win": win}], projects)
        projects[0]["won"] = False
        with self.assertRaises(ValueError):
            build.validate_project_links([{"ref": "x", "cycle": "12", "win": "PB12_1_1"}], projects)

    def test_rejects_ambiguous_aliases(self):
        projects = build.build_projects([project_row()])
        with self.assertRaises(ValueError):
            build.validate_project_links([], projects + projects)

    def test_preserves_blank_numeric_values_and_zero(self):
        self.assertIsNone(build.integer_or_none(""))
        self.assertEqual(build.integer_or_none("0.0"), 0)

    def test_numeric_cycle_and_legacy_cycle_label(self):
        self.assertEqual(build.project_cycle("12.0"), "12")
        self.assertEqual(build.project_cycle("Cycle 12 (Sep 2025-Mar 2026)"), "12")
        self.assertIsNone(build.project_cycle("unknown"))


class ExportTests(unittest.TestCase):
    def test_requires_complete_schema_and_rows(self):
        for content in (b"<html>Error</html>", b"A,B\n", b"A,B\n1\n", b"A,B\n1,2,3\n"):
            with self.subTest(content=content), self.assertRaises(ValueError):
                build.parse_export(content, {"A", "B"})

    def test_preserves_text_ids_and_quoted_newlines(self):
        content = '\ufeffID,Description\n733619-2,"first\nsecond"\n'.encode("utf-8")
        self.assertEqual(build.parse_export(content, {"ID", "Description"}), [
            {"ID": "733619-2", "Description": "first\nsecond"}
        ])

    def test_cache_is_used_without_network(self):
        with TemporaryDirectory() as directory:
            cache = Path(directory) / "cache.csv"
            cache.write_bytes(b"ID\n733619-2\n")
            with patch.object(build.urllib.request, "urlopen") as request:
                self.assertEqual(build.read_export("example", cache, {"ID"}), [{"ID": "733619-2"}])
                request.assert_not_called()

    def test_invalid_download_does_not_replace_cache(self):
        with TemporaryDirectory() as directory:
            cache = Path(directory) / "cache.csv"
            cache.write_bytes(b"ID\nold\n")
            with patch.object(build.urllib.request, "urlopen") as request:
                request.return_value.__enter__.return_value.read.return_value = b"Wrong\nvalue\n"
                with self.assertRaises(ValueError):
                    build.read_export("example", cache, {"ID"}, refresh=True)
            self.assertEqual(cache.read_bytes(), b"ID\nold\n")


class DeepLinkTests(unittest.TestCase):
    def test_dash_suffix_preserves_numeric_deep_link(self):
        previous = [
            {"id": n, "cycle": cycle, "ref": ref}
            for n, (cycle, ref) in enumerate(build.IDEA_REF_RENAMES)
        ]
        current = copy.deepcopy(previous)
        for row in current:
            row["ref"] = build.IDEA_REF_RENAMES[(row["cycle"], row["ref"])]
        build.validate_idea_order(previous, previous)
        build.validate_idea_order(previous, current)
        build.validate_idea_order(current, current)
        build.validate_idea_order(current, current + [{"id": 3, "cycle": "13", "ref": "new"}])

    def test_rejects_removal_or_reorder(self):
        previous = [{"id": 0, "cycle": "12", "ref": "123"}]
        for current in ([], [{"id": 0, "cycle": "12", "ref": "456"}]):
            with self.subTest(current=current), self.assertRaises(ValueError):
                build.validate_idea_order(previous, current)


class BuildTests(unittest.TestCase):
    def test_build_uses_both_public_exports_and_omits_submitter(self):
        idea = {column: "" for column in build.IDEA_COLUMNS}
        idea.update({
            "PB Cycle": "12", "Idea #": "733619-2", "Committee": "Community Resources",
            "Project Title": "Example idea", "Project Description": "Example",
            "Winning Project ID": "PB12_1_2", "Idea Submitter": "Not for viewer output",
        })
        with TemporaryDirectory() as directory:
            output = Path(directory)
            previous = [{"id": 0, "cycle": "12", "ref": "733619.5"}]
            (output / "ideas.json").write_text(json.dumps(previous), encoding="utf-8")
            with (
                patch.object(build, "OUT", output),
                patch.object(build, "read_export", side_effect=[[idea], [project_row()]]) as read,
                patch("sys.argv", ["build_data.py", "--refresh"]),
            ):
                build.main()
            self.assertEqual([call.args[0] for call in read.call_args_list], ["54vd-wdqj", "uhwd-9y6q"])
            self.assertTrue(all(call.args[3] for call in read.call_args_list))
            ideas = json.loads((output / "ideas.json").read_text(encoding="utf-8"))
            projects = json.loads((output / "projects.json").read_text(encoding="utf-8"))
            meta = json.loads((output / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual((ideas[0]["id"], ideas[0]["ref"], ideas[0]["outcome"]), (0, "733619-2", "won"))
            self.assertEqual(ideas[0]["win"], "PB12_1_2")
            self.assertNotIn("Not for viewer output", json.dumps(ideas))
            self.assertEqual(projects[0]["votes"], 5057)
            self.assertEqual(meta["counts"], {"ideas": 1, "projects": 1, "winners": 1})


if __name__ == "__main__":
    unittest.main()
