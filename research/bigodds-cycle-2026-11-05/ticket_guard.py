"""Sequential tickets; settlement must be known at decision time.
Each previous leg has fixture_id, outcome (won/lost/void/pending), settled_at_ms.
No guessed final whistles or future outcomes are accepted.
"""
def gate(previous_tickets, now_ms):
    blocked = set()
    active = []
    for ticket in previous_tickets:
        legs = ticket['legs']
        if not legs:
            raise ValueError('Empty previous ticket')
        known = [leg.get('settled_at_ms') is not None and
                 leg['settled_at_ms'] <= now_ms and
                 leg.get('outcome') in ('won', 'lost', 'void') for leg in legs]
        lost = any(k and leg['outcome'] == 'lost' for k, leg in zip(known, legs))
        closed = lost or all(known)
        for k, leg in zip(known, legs):
            if not k:
                blocked.add(leg['fixture_id'])
        if not closed:
            active.append(ticket['id'])
    return {'can_generate': not active, 'active_ticket_ids': active,
            'excluded_fixture_ids': sorted(blocked)}
