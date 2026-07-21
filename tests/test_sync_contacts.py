import unittest

from scripts.sync_contacts import normalize_phone


class ContactImportTests(unittest.TestCase):
    def test_hungarian_phone_formats_are_normalized_to_e164(self):
        self.assertEqual(normalize_phone("06 30 123 4567")[0], "+36301234567")
        self.assertEqual(normalize_phone("0036-20-555-0101")[0], "+36205550101")
        self.assertEqual(normalize_phone("+36 (70) 999 8877")[0], "+36709998877")

    def test_ambiguous_local_number_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_phone("30 123 4567")


if __name__ == "__main__":
    unittest.main()
