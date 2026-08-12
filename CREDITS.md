# Credits

## Sound

| Cue | Source | Licence |
|---|---|---|
| `public/audio/entry-horn.mp3` | Freesound [368691 — "8-bit arcade start" by fartbiscuit1700](https://freesound.org/s/368691/) | CC0 |
| `public/audio/chop.mp3` | Freesound [157218 — "Video game die or lose life" by adamweeden](https://freesound.org/s/157218/) | CC0 |
| `public/audio/join.mp3` | Freesound [368691 — "8-bit arcade start" by fartbiscuit1700](https://freesound.org/s/368691/) | CC0 |
| `public/audio/countdown-*.mp3` | synthesised, `tools/make-audio.py` | none needed |
| `public/audio/lock.mp3` | synthesised, `tools/make-audio.py` | none needed |
| `public/audio/powerup.mp3` | synthesised, `tools/make-audio.py` | none needed |

Every sourced sound here is CC0, confirmed on its Freesound page. Attribution
is not required, so this table exists because knowing where things came from is
worth more than the licence strictly demands.

Nothing in the project carries a restrictive licence: the sounds are CC0, the
fonts are OFL or Apache 2.0, the clue data comes from a public dataset, and the
artwork was made for this.

The entry and join cues come from the same recording on purpose: signing up and
walking into the ring are the same kind of event at different scales, so the
join chime is the same phrase pitched down five semitones and cut to its
opening. They sit a fifth apart and read as relatives rather than repeats.

The elimination cue
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
