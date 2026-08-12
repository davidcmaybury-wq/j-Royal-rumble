# Shipping an update from a phone

Drop the archive in this folder — `.tar` or `.tar.gz`, whichever the
download gave you and the `unpack` workflow does the rest:
it extracts the archive over the tree, deletes the tarball, commits the
result, and that commit triggers the normal deploy with all its tests.

On a phone:

1. github.com, this repo, open `incoming/`
2. **Add file → Upload files**
3. Pick the tarball, then **Commit changes**
4. Watch it in **Actions**

No terminal, no token, no secret.

## The one limitation

A GitHub token is not permitted to modify anything under
`.github/workflows`. If an archive contains workflow changes they are
skipped and listed in the run summary, so you know to apply them from a
machine with a shell. That is rare — most updates are code and assets.

## If something goes wrong

The unpack commit is an ordinary commit. `git revert` it, or use the
previous tarball. Nothing here is destructive that a revert cannot undo.
