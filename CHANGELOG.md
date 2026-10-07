# Changelog

## Added
- Hot Potato game (3 to 12 players): hidden random fuse, pass the potato to anyone except yourself and the player who just passed it to you. When it blows the holder is out. Survivors earn 100 points per round, the last player standing earns a 200 bonus. If the holder disconnects the potato is passed automatically. Fuse setting: short, medium, long.

## Fixed
- Host page is no longer served from /host.html or /public. It is served only from /host?code=HOSTCODE.
- QR code now encodes the correct join URL for the request host.
- Host auth uses constant-time comparison, failed attempts are rate limited, and the host can resume after a refresh.
- Player tokens and answers are never sent to other clients.
- Stable player ids separate from socket ids; reconnect restores the current question, scores and replay state.
- Names and avatars are sanitized, and all client rendering is escaped (XSS).
- Imposter: minimum players and imposter count limits enforced, vote ties and double emergency meetings handled, new win condition.
- Trivia, math, would you rather, rapid fire: double reveals on late answers, answer validation, option shuffling, duplicate answers ignored.
- Typing: scoring uses server time and the server verifies the typed text.
- Roulette: one spin per turn, auto-shoot when the current player is offline.
- Word and code guessing: input validation, no crash on guesses during the countdown.
- Reaction: modes behave correctly when nobody taps.
- End of game no longer starts a ghost round or double counts scores; stale timers are cleared between games.
- Kicked players stop receiving game events.
- Session leaderboard is per room.
- start.sh and start.bat start the server before opening the browser.
- package.json declares node >= 18.
