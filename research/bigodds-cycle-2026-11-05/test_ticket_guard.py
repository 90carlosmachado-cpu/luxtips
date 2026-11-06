import unittest
from ticket_guard import gate
class GuardTests(unittest.TestCase):
    def leg(self, fixture, outcome='pending', at=None):
        return dict(fixture_id=fixture,outcome=outcome,settled_at_ms=at)
    def check(self, legs):
        return gate([dict(id='A',legs=legs)],100)
    def test_pending_blocks_next_ticket(self):
        self.assertFalse(self.check([self.leg(1,'won',90),self.leg(2)])['can_generate'])
    def test_loss_releases_but_excludes_unfinished_games(self):
        r=self.check([self.leg(1,'lost',90),self.leg(2)])
        self.assertTrue(r['can_generate']);self.assertEqual(r['excluded_fixture_ids'],[2])
    def test_future_loss_cannot_release(self):
        self.assertFalse(self.check([self.leg(1,'lost',110)])['can_generate'])
    def test_all_settled_releases(self):
        self.assertTrue(self.check([self.leg(1,'won',90),self.leg(2,'void',99)])['can_generate'])
    def test_no_history(self):
        self.assertTrue(gate([],100)['can_generate'])
if __name__=='__main__':unittest.main()
