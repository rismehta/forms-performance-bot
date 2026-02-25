# Claude.md

The role of this file is to describe common mistakes and
confusion points that agents might encounter as they work in
this project. If you ever encounter something in the project
that surprises you, please alert the developer working with you
and indicate that this can be in the CLAUDE.md file to help
prevent future agents from having the same issue.

## Releasing / GitHub Action tag

The GitHub Action runs from **dist/** (`action.yml` → `main: 'dist/index.js'`).
You **must build before releasing** so that `dist/` is up to date and committed.

1. **Build:** Run `npm run build` (runs tests + `ncc build src/index.js -o dist`).
   Commit any changes to `dist/` (and CLAUDE.md or other release docs) before tagging.
2. **Do not** change the README (e.g. do not change `@v1` to `@v1.73`).
3. Update the **existing** tag (e.g. `v1`) to point to the new commit:
   `git tag -f v1 -m "..."` then `git push origin v1 --force`.
   Consumers use `@v1`; moving the tag is the intended way to ship updates.