This is a repository based on the [Bubble](https://bubble.io) plugin 'DocSpring - Fill and Generate PDFs'. This lets you use Github's functionality in terms of version control, forks and pull requests. Note that the the plugin code is stored on Bubble's servers, and you need to synchronize your repository in the Bubble Plugin Editor. 

 This plugin can be used in [Bubble applications](https://bubble.io).

## Development

The plugin calls DocSpring's API v2 (`/api/v2`). Bubble syncs this repository with the plugin editor in both
directions, so keep its structure and never change an ID (`AAQ`, `AAP-850n0` and so on): users' apps refer to them.

- `meta_data.json`: the listing and the plugin instructions. `shared_tech_params.json`: the plugin settings (Token
  ID, Token Secret, Region).
- `actions/<ID>/`: one server-side action each, with `params.json` (fields and return values), `server.js` and
  `client.js`.
- New actions, fields and return values need IDs from Bubble: create them in the editor first (an action with
  enough empty fields and return values, or empty rows on an existing action), click "Synchronize with GitHub",
  then fill them in here and sync again. `test/support/actions.json` maps each action's name to its folder for the
  tests.
- To bring commits from `master` into the editor, click "Synchronize with GitHub" (Versions and license tab), then
  **Reload** in the dialog that says the new version has been fetched. Closing the dialog without Reload leaves the
  editor unchanged, but Bubble still records the commit as synced, so the next sync says it's already synced. To
  retry, push another commit (an empty one works) and sync again.
- When the editor has changes that aren't on GitHub (such as new empty rows), "Synchronize with GitHub" first pushes
  them as an "Automatic commit from Bubble" and merges it into `master`. That commit has only the plugin's own files,
  so it deletes `test/` and `CHANGELOG.md`: restore them from the commit before it
  (`git checkout <commit> -- test CHANGELOG.md`) and commit them with your changes.
- If `master` changed `test/` or `CHANGELOG.md` since the last sync, Bubble can't merge that commit: it pushes it to a
  `conflict_<date>` branch and says there was a conflict. Merge that branch into `master` keeping `master`'s `test/`
  and `CHANGELOG.md` (`git merge --no-commit origin/conflict_...`, then `git checkout HEAD -- test CHANGELOG.md`),
  push, sync again and click **Reload**. Delete the conflict branch afterwards. A listing change (description, icon)
  is an editor change too, so sync before you push other commits, or expect this.
- Bubble actions can't share modules, so every `server.js` starts with the same helper block (region, auth,
  requests, errors). Change it in `actions/AAP-850n0/server.js`, then copy it to every action with
  `node test/support/sync-helpers.js --write`.

### Tests

```sh
node --test
```

The tests (Node 18 or later, no dependencies) run each action's `server.js` with a mocked `context.v3.request`, so
they never call DocSpring. `test/structure.test.js` checks that the helper blocks match, that the existing actions keep
their IDs, that every ID is one Bubble assigned, that each action reads only the fields its `params.json` declares, and
that no field the code requires is marked optional.
