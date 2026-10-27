This is a repository based on the [Bubble](https://bubble.io) plugin 'DocSpring - Fill and Generate PDFs'. This lets you use Github's functionality in terms of version control, forks and pull requests. Note that the the plugin code is stored on Bubble's servers, and you need to synchronize your repository in the Bubble Plugin Editor. 

 This plugin can be used in [Bubble applications](https://bubble.io).

## Development

The plugin calls DocSpring's API v2 (`/api/v2`). Bubble syncs this repository with the plugin editor in both
directions, so keep its structure and never change an ID (`AAQ`, `AAP-850n0` and so on): users' apps refer to them.

- `meta_data.json`: the listing and the plugin instructions. `shared_tech_params.json`: the plugin settings (Token
  ID, Token Secret, Region).
- `actions/<ID>/`: one server-side action each, with `params.json` (fields and return values), `server.js` and
  `client.js`.
- `actions/_new/<name>/`: actions written here that don't exist in the editor yet. Their `params.json` uses
  placeholder IDs (`NEW_1`, `NEW_2`, ...), because Bubble assigns the real ones. Create each action in the editor
  with the same fields and return values, paste in its `server.js`, then remove its folder here.
  `actions/_new/<ID>-additions/` lists fields and return values to add to an existing action.
- Bubble actions can't share modules, so every `server.js` starts with the same helper block (region, auth,
  requests, errors). Change it in `actions/AAP-850n0/server.js`, then copy it to every action with
  `node test/support/sync-helpers.js --write`.

### Tests

```sh
node --test
```

The tests (Node 18 or later, no dependencies) run each action's `server.js` with a mocked `context.v3.request`, so
they never call DocSpring. `test/structure.test.js` checks that the helper blocks match, that the existing actions keep
their IDs, and that each action reads only the fields its `params.json` declares.
