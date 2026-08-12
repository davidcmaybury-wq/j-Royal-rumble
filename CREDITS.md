# Credits

## Sound

| Cue | Source | Licence |
|---|---|---|
| `public/audio/entry-horn.mp3` | Freesound [324276 — "Multiple siren" by kostrava](https://freesound.org/s/324276/) | CC0 |
| `public/audio/chop.mp3` | Freesound [157218 — "Video game die or lose life" by adamweeden](https://freesound.org/s/157218/) | **confirm before release** |
| `public/audio/join.mp3` | Freesound [368691 — "8-bit arcade start" by fartbiscuit1700](https://freesound.org/s/368691/) | **confirm before release** |
| `public/audio/countdown-*.mp3` | synthesised, `tools/make-audio.py` | none needed |
| `public/audio/lock.mp3` | synthesised, `tools/make-audio.py` | none needed |
| `public/audio/powerup.mp3` | synthesised, `tools/make-audio.py` | none needed |

> The horn and the earlier gunshot were both confirmed CC0. The elimination cue
> that replaced the gunshot has not been checked — worth thirty seconds on its
> Freesound page before this goes anywhere public. Everything else here is CC0,
> OFL, Apache 2.0, or written for the project.

Attribution is not required for CC0, so this table exists because knowing where
things came from is worth more than the licence strictly demands.

The horn is a 2.7–5.7 second excerpt trimmed to its onset. The elimination cue
is a musical phrase rather than an impact, so it is kept whole — an impact gets
trimmed hard and cut short to protect its transient, but a tune has to resolve.
It gets only a whisper of room, since a chiptune already sits in its own space. Both are level-matched against each other on their
loudest half-second rather than on peak. Processing lives in
`tools/build-audio.py`; the untouched originals are in `sources/`.

The overtime cue is a chiptune power-up: a three-note figure climbing by
fifths on a square wave. The 8-bit power-up is a genre rather than a recording,
so this is built from the same ingredients — fast ascending arpeggio, narrowing
duty cycle — without borrowing anybody's tune.

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
