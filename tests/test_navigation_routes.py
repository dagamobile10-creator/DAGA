import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class NavigationRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        cls.live = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.landing = (ROOT / "go" / "index.html").read_text(encoding="utf-8")
        cls.owner = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        cls.company = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        cls.invite = (ROOT / "invite" / "index.html").read_text(encoding="utf-8")

    def test_worker_serves_all_navigation_destinations(self):
        for path in ("/go", "/owner-console", "/company", "/invite"):
            with self.subTest(path=path):
                self.assertIn(path, self.worker)

    def test_live_navigation_uses_worker_origin_for_worker_pages(self):
        for path in ("/go/", "/company/", "/owner-console/"):
            with self.subTest(path=path):
                self.assertIn("https://daga-voice.dagamobile10.workers.dev" + path, self.live)

    def test_navigation_pages_link_to_each_other(self):
        for page, paths in (
            (self.live, ("/go/", "/company/", "/owner-console/")),
            (self.landing, ("/company/", "/owner-console/")),
            (self.owner, ("/company/", "/go/")),
            (self.company, ("/owner-console/", "/go/")),
            (self.invite, ("/company/", "/owner-console/", "/go/")),
        ):
            for path in paths:
                with self.subTest(path=path):
                    self.assertIn('href="' + path + '"', page)

    def test_invitation_acceptance_is_not_linked_without_a_token(self):
        for page in (self.live, self.landing):
            self.assertNotIn('href="/invite/"', page)

    def test_navigation_does_not_remove_live_voice_contract_markers(self):
        for marker in ("workers.dev/chat", "workers.dev/tts", "playVoiceTest", "daga_mh_memory_v1"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.live)


if __name__ == "__main__":
    unittest.main()
