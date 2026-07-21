import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_data import parse_schedule


ROOT = Path(__file__).resolve().parents[1]


class ScheduleBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schedule = parse_schedule(ROOT / "data" / "Sirok 2026 beosztás.xlsx")

    def test_only_real_shift_headers_are_used(self):
        self.assertEqual(14, len(self.schedule["shifts"]))
        self.assertTrue(all(s["day"] in {"Sze", "Cs", "P", "Szo"} for s in self.schedule["shifts"]))

    def test_every_included_worker_has_an_x(self):
        self.assertGreater(len(self.schedule["workers"]), 0)
        self.assertTrue(
            all(any(worker["assignments"].values()) for worker in self.schedule["workers"])
        )

    def test_transitions_match_adjacent_cells(self):
        workers = {worker["id"]: worker for worker in self.schedule["workers"]}
        shifts = self.schedule["shifts"]
        for index, boundary in enumerate(self.schedule["boundaries"][:-1]):
            current = shifts[index]["id"]
            previous = shifts[index - 1]["id"] if index else None
            for identifier in boundary["arrivals"]:
                self.assertTrue(workers[identifier]["assignments"][current])
                self.assertFalse(previous and workers[identifier]["assignments"][previous])
            for identifier in boundary["departures"]:
                self.assertFalse(workers[identifier]["assignments"][current])
                self.assertTrue(previous and workers[identifier]["assignments"][previous])

    def test_json_serializable(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "schedule.json"
            target.write_text(json.dumps(self.schedule, ensure_ascii=False), encoding="utf-8")
            self.assertGreater(target.stat().st_size, 100)


if __name__ == "__main__":
    unittest.main()

