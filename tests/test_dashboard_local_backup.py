from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DashboardLocalBackupTests(unittest.TestCase):
    def test_dashboard_keeps_ten_days_of_store_scoped_daily_snapshots(self):
        source = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("const DAGA_LOCAL_BACKUP_DAYS=10;", source)
        self.assertIn("function dashboardBackupPrefix(){return STORE_KEY+'_daily_backup_';}", source)
        self.assertIn("localStorage.setItem(dashboardBackupPrefix()+day,serialized)", source)
        self.assertIn("cutoff.setUTCDate(cutoff.getUTCDate()-(DAGA_LOCAL_BACKUP_DAYS-1))", source)
        self.assertIn("key.startsWith(prefix)", source)
        self.assertIn("localStorage.removeItem(key)", source)

    def test_corrupt_or_missing_primary_store_recovers_latest_valid_backup(self):
        source = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        start = source.index("function loadStoreData(storeId)")
        end = source.index("\nfunction persist()", start)
        loader = source[start:end]
        self.assertIn("validDashboardSnapshot(saved)", loader)
        self.assertIn("keys.sort((a,b)=>b.slice(prefix.length).localeCompare(a.slice(prefix.length)))", loader)
        self.assertIn("validDashboardSnapshot(backup)", loader)
        self.assertIn("if(restored)persist()", loader)

    def test_backup_failure_does_not_report_primary_save_as_failed(self):
        source = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        start = source.index("function persist()")
        end = source.index("\nfunction num(", start)
        saver = source[start:end]
        self.assertLess(saver.index("localStorage.setItem(STORE_KEY,serialized)"),
                        saver.index("localStorage.setItem(dashboardBackupPrefix()+day,serialized)"))
        self.assertIn("catch(backupError)", saver)
        self.assertIn("return true", saver)

if __name__ == "__main__":
    unittest.main()
