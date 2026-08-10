# Credits

## Sound

| Cue | Source | Licence |
|---|---|---|
| `public/audio/entry-horn.mp3` | Freesound [324276 — "Multiple siren" by kostrava](https://freesound.org/s/324276/) | CC0 |
| `public/audio/chop.mp3` | Freesound [415912 — "Heathers gunshot effect 2" by okieactor](https://freesound.org/s/415912/) | CC0 |
| `public/audio/countdown-*.mp3` | synthesised, `tools/make-audio.py` | none needed |

Both are CC0, so no attribution is required — this table exists because
knowing where things came from is worth more than the licence strictly demands.

The horn is a 2.7–5.7 second excerpt trimmed to its onset. The elimination
sound is trimmed and lightly seated; it arrives with its own room, so it needs
much less than the horn. Both are level-matched against each other on their
loudest half-second rather than on peak. Processing lives in
`tools/build-audio.py`; the untouched originals are in `sources/`.

## Fonts

| Font | Use | Licence |
|---|---|---|
| Anton | the "J!", headings | SIL Open Font License 1.1 |
| Bebas Neue | small caps labels | SIL Open Font License 1.1 |
| Permanent Marker | "Royal Rumble" script | Apache License 2.0 |
| IBM Plex Sans / Mono | interface and figures | SIL Open Font License 1.1 |

## Clue material

Archive categories come from the public
[jeopardy_clue_dataset](https://github.com/jwolle1/jeopardy_clue_dataset),
not from j-archive directly. The archive's maintainer asked not to be crawled;
this keeps the project off their server. That dataset's own compiler asks not
to be credited by name for the underlying source.

Custom categories are David Maybury's and the other TTG and LearningMan
writers', used with their knowledge.

## Artwork

The logo, both marks and all interface design were made for this project. They
deliberately avoid reproducing WWE's Royal Rumble logotype or the Jeopardy!
wordmark — the era's design vocabulary is borrowed, the marks themselves are
not.
