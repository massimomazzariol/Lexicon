# Releasing Lexicon Platform

A release publishes the built distribution to a GitHub Release and tags the
repository version. Use `docs/reference/WORKFLOW_COMMANDS.md` as the source of
truth for the verification commands.

## Release Checklist

1. Update release metadata:
   - `CHANGELOG.md` (release notes)
   - `docs/reference/CONTENT_CHANGELOG.md` for notable lexical additions or
     semantic splits
   - `CITATION.cff` if it tracks the released version/date
2. Run the local verification suite (`docs/reference/WORKFLOW_COMMANDS.md`).
3. Build the distribution:
   ```bash
   pnpm run release   # rebuilds runtime packs + writes dist/lexicon_distribution/
   ```
4. Commit the release changes, then create and push the version tag:
   ```bash
   git tag v0.1.0
   git push origin main
   git push origin v0.1.0
   ```
5. Publish the distribution to the GitHub Release for that tag:
   ```bash
   pnpm run publish -- --publish --tag v0.1.0
   ```

## After Releasing

- Verify the tag and its Release assets exist on GitHub.
- A consumer pointed at that Release picks up the new distribution on next fetch.
- If the JSON shape or the flattened-asset naming changed, that is a contract
  change: bump `contract_version`, update `CONTRACT.md` and the golden fixture,
  and rely on the conformance tests on both sides.

## Channels: staging and stable

Day-to-day work lands on the `staging` branch (CI runs there too); `main`
only receives curated merges and is what GitHub Pages serves. Releases give
consumers two channels:

1. Cut a PRERELEASE from staging when a batch is ready to try:
   ```bash
   git tag v0.4.0-rc.1
   git push origin v0.4.0-rc.1
   gh release create v0.4.0-rc.1 --prerelease --title "v0.4.0-rc.1" --notes "..."
   pnpm run publish -- --publish --tag v0.4.0-rc.1
   ```
   A prerelease never becomes "Latest", so consumers on the stable channel
   are untouched; a consumer pointed at the prerelease tag gets the staging
   content.
2. Promote when the staging content proves out: merge `staging` into
   `main`, then run the normal release checklist above for the final tag
   (vX.Y.Z, no suffix). The release becomes Latest; the stable channel
   picks it up.

Titles stay version-only in both channels.
