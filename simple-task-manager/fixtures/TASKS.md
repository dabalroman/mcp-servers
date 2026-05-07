# Counter: 5

# 5 Add update command to MCP server
## tool | in_progress | high
$scope: task-manager
The MCP server exposes no way to update an existing task's title or description.
Add an `update` tool that accepts id + optional fields and patches in place.

# 4 Fix auth middleware session leak
## bug | todo | critical
$ref: #3 is blocked by
Reproduction: log in with an expired token. Session is not invalidated.
Steps: check src/auth.ts middleware, add expiry check on every request.

# 3 Relative scale for SVG merger
## feature | todo | medium
$scope: svg-path-joiner
$ref: #4 blocks
The joiner should accept real width/height in mm and rescale the viewBox.
This makes tolerance meaningful in physical units instead of px.

# 2 Improve task picker UX
## idea | todo | low
The picker could show a preview of the task description on hover.
