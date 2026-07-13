import unittest
import os
import tempfile
import sqlite3
from datetime import datetime, timedelta
from models import HandDatabase, Hand

class TaggingAndSearchTests(unittest.TestCase):
    def setUp(self):
        # Create a temporary database file
        self.db_fd, self.db_path = tempfile.mkstemp()
        self.db = HandDatabase(self.db_path)

        # Insert some test hands
        self.hand1 = Hand()
        self.hand1.hand_id = "TEST_001"
        self.hand1.site = "CoinPoker"
        self.hand1.game_type = "NLHE"
        self.hand1.date = datetime.now() - timedelta(days=2)
        self.hand1.hero_won = 150.0
        self.hand1.rake = 5.0
        self.hand1.is_tournament = False
        self.hand1.players = {
            1: {"name": "jdwalka", "stack": 100.0, "is_hero": True},
            2: {"name": "other1", "stack": 80.0, "is_hero": False}
        }
        self.db.save_hand(self.hand1, "test_file_1.log")

        self.hand2 = Hand()
        self.hand2.hand_id = "TEST_002"
        self.hand2.site = "CoinPoker"
        self.hand2.game_type = "NLHE"
        self.hand2.date = datetime.now() - timedelta(days=1)
        self.hand2.hero_won = -50.0
        self.hand2.rake = 2.0
        self.hand2.is_tournament = False
        self.hand2.players = {
            1: {"name": "GBOSS101", "stack": 150.0, "is_hero": True},
            2: {"name": "other2", "stack": 120.0, "is_hero": False}
        }
        self.db.save_hand(self.hand2, "test_file_2.log")

        self.hand3 = Hand()
        self.hand3.hand_id = "TEST_003"
        self.hand3.site = "BetACR"
        self.hand3.game_type = "NLHE"
        self.hand3.date = datetime.now()
        self.hand3.hero_won = -200.0
        self.hand3.rake = 10.0
        self.hand3.is_tournament = True
        self.hand3.players = {
            1: {"name": "jdwalka", "stack": 200.0, "is_hero": True},
            2: {"name": "other3", "stack": 150.0, "is_hero": False}
        }
        self.db.save_hand(self.hand3, "test_file_3.log")

    def tearDown(self):
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_database_tag_management(self):
        # Initially no tags
        self.assertEqual(self.db.get_tags("TEST_001"), [])
        self.assertEqual(self.db.get_all_tags(), [])

        # Add tags
        self.db.add_tag("TEST_001", "3bet")
        self.db.add_tag("TEST_001", "bluff")
        self.assertEqual(self.db.get_tags("TEST_001"), ["3bet", "bluff"])
        self.assertEqual(self.db.get_all_tags(), ["3bet", "bluff"])

        # Add tag to another hand
        self.db.add_tag("TEST_002", "bluff")
        self.assertEqual(self.db.get_tags("TEST_002"), ["bluff"])
        self.assertEqual(self.db.get_all_tags(), ["3bet", "bluff"])

        # Remove tag
        self.db.remove_tag("TEST_001", "3bet")
        self.assertEqual(self.db.get_tags("TEST_001"), ["bluff"])
        self.assertEqual(self.db.get_all_tags(), ["bluff"])

    def test_search_hands_unfiltered(self):
        res = self.db.search_hands()
        self.assertEqual(res["total"], 3)
        self.assertEqual(len(res["hands"]), 3)
        
        totals = res["totals"]
        self.assertEqual(totals["total_hands"], 3)
        self.assertEqual(totals["total_collected"], 150.0)
        self.assertEqual(totals["total_lost"], -250.0)
        self.assertEqual(totals["net_profit_loss"], -100.0)
        self.assertEqual(totals["total_rake"], 17.0)

    def test_search_hands_filtered_by_site(self):
        res = self.db.search_hands(site="CoinPoker")
        self.assertEqual(res["total"], 2)
        self.assertEqual(res["totals"]["total_collected"], 150.0)
        self.assertEqual(res["totals"]["total_lost"], -50.0)
        self.assertEqual(res["totals"]["net_profit_loss"], 100.0)

    def test_search_hands_filtered_by_tag(self):
        self.db.add_tag("TEST_001", "3bet")
        self.db.add_tag("TEST_003", "3bet")

        res = self.db.search_hands(tag="3bet")
        self.assertEqual(res["total"], 2)
        self.assertEqual(res["totals"]["total_hands"], 2)
        self.assertEqual(res["totals"]["net_profit_loss"], -50.0)

    def test_search_hands_filtered_by_date(self):
        # Filter starting from yesterday
        yesterday_str = (datetime.now() - timedelta(hours=36)).isoformat()
        res = self.db.search_hands(start_date=yesterday_str)
        self.assertEqual(res["total"], 2)
        self.assertEqual(res["totals"]["total_hands"], 2)
        # Should include hand2 and hand3 (-50 + -200 = -250)
        self.assertEqual(res["totals"]["net_profit_loss"], -250.0)

    def test_get_all_heroes(self):
        heroes = self.db.get_all_heroes()
        # Should be alphabetical
        self.assertEqual(heroes, ["GBOSS101", "jdwalka"])

    def test_search_hands_filtered_by_hero(self):
        # Filter by jdwalka
        res_jd = self.db.search_hands(hero_name="jdwalka")
        self.assertEqual(res_jd["total"], 2)
        self.assertEqual(res_jd["totals"]["total_hands"], 2)
        # hand1 (+150) + hand3 (-200) = -50
        self.assertEqual(res_jd["totals"]["net_profit_loss"], -50.0)

        # Filter by GBOSS101 (case-insensitive check)
        res_gb = self.db.search_hands(hero_name="gboss101")
        self.assertEqual(res_gb["total"], 1)
        self.assertEqual(res_gb["totals"]["total_hands"], 1)
        self.assertEqual(res_gb["totals"]["net_profit_loss"], -50.0)

if __name__ == "__main__":
    unittest.main()
