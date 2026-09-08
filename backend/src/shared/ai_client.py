"""A minimal Anthropic client check, shared across features.

Verifying a key is a generic concern - academic_profile needs it when a
student saves a key in their profile, independent of content_topics' actual
syllabus-analysis logic. Keeping it here instead of importing across feature
boundaries (see ADR 0004: a feature reaching into another's internals is a
sign the boundary was drawn wrong).
"""

from __future__ import annotations

from anthropic import Anthropic, APIError

MODEL = "claude-opus-4-8"


def verify_api_key(api_key: str) -> bool:
    """Cheap round-trip so the profile page can tell the student the key works."""
    try:
        Anthropic(api_key=api_key).messages.create(
            model=MODEL,
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
    except APIError:
        return False
    return True
