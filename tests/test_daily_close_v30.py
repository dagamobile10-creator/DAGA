import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")


def money_delta(cash_rows, accessory_rows, cash_out, accessory_out):
    # Each row is (amount, already_posted). Only unposted amounts move money at close.
    cash_pending = sum(v for v, posted in cash_rows if not posted)
    accessory_pending = sum(v for v, posted in accessory_rows if not posted)
    cash_out_pending = sum(v for v, posted in cash_out if not posted)
    accessory_out_pending = sum(v for v, posted in accessory_out if not posted)
    return cash_pending - cash_out_pending + accessory_pending - accessory_out_pending


class DailyCloseAccountingTests(unittest.TestCase):
    def test_posted_cash_and_accessory_are_not_added_twice(self):
        self.assertEqual(money_delta([(100, True)], [(50, True)], [], []), 0)

    def test_unmatched_daily_amounts_are_added_once_at_close(self):
        self.assertEqual(money_delta([(100, False)], [(50, False)], [], []), 150)

    def test_posted_withdrawal_is_not_deducted_twice(self):
        self.assertEqual(money_delta([(100, True)], [], [(30, True)], []), 0)

    def test_pending_withdrawal_offsets_pending_daily_amount(self):
        self.assertEqual(money_delta([(100, False)], [], [(30, False)], []), 70)

    def test_mixed_posted_and_unposted_rows_use_only_pending_delta(self):
        self.assertEqual(money_delta([(100, True), (40, False)], [(60, True)], [(25, True), (10, False)], []), 30)

    def test_dashboard_uses_full_rows_for_display_and_pending_rows_for_posting(self):
        start = SOURCE.index("function getDailyClosePlan(){")
        end = SOURCE.index("\nfunction closeDay(){", start)
        plan = SOURCE[start:end]
        self.assertIn("cashGross-cashPostedGross", plan)
        self.assertIn("accessoryGross-accessoryPostedGross", plan)
        self.assertIn("cashPendingGross-cashPendingWithdrawals", plan)
        self.assertIn("accessoryPendingGross-accessoryPendingWithdrawals", plan)
        self.assertIn("if(isCashName(e[0]))cashRows.push", plan)
        self.assertIn("if(isAccessoryName(e[0]))accessoryRows.push", plan)

    def test_close_clears_all_matched_daily_withdrawal_rows(self):
        start = SOURCE.index("function confirmCloseDay(date){")
        end = SOURCE.index("\nasync function showTeam()", start)
        close = SOURCE[start:end]
        self.assertIn("[...p.cashRows,...p.accessoryRows].forEach", close)
        self.assertIn("row[1]='0'", close)
        self.assertIn("postedGross:p.cashPostedGross", close)
        self.assertIn("postedWithdrawals:p.cashPostedWithdrawals", close)


if __name__ == "__main__":
    unittest.main()
