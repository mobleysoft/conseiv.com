# Conseiv backend contract

Worker entry: `worker/index.js`. Bindings: `DB` (D1), `ASSETS` (static assets).
Optional `AUTHFOR` service binding; otherwise calls `https://authfor.com`.
Migration: `migrations/0001_initial.sql`. Runtime dependency: `three`.
No deployment has been performed by the backend implementation task.

All API responses except exports are JSON, `Cache-Control: no-store`. Errors:
`{ok:false,error:{code,message,fields?}}`. Use same-origin fetch with cookies.
Mutations that authenticate or save/delete data require an `Origin` header
exactly matching the request URL origin (browsers supply this automatically).

## Geometry

`POST /api/conseiv/cad-mesh-generation`

Request: `{parameters: {...}, save?: false, name?: "Mounting bracket"}`.
Anonymous preview requires no login. `save:true` requires authentication and
persists the generated asset. `name` is optional, max 100 characters.
Parameters omitted within the object use defaults. Unknown fields are rejected.

```json
{
  "legAWidth": 80,
  "legBWidth": 60,
  "flangeLength": 40,
  "thickness": 3,
  "bendRadius": 4,
  "kFactor": 0.44,
  "holeDiameter": 6,
  "holesPerLeg": 2,
  "edgeMargin": 12,
  "bendAngleDeg": 90
}
```

Dimensions are millimeters. Leg widths are outside virtual-sharp dimensions;
the straight portions subtract `(bendRadius + thickness) * tan(angle / 2)`.
Holes are evenly spaced along each straight leg, centered across flange width.
Edge margin measures hole center to straight-leg edge. Geometry validation
rejects overlapping holes and insufficient edge/bend clearance. `holesPerLeg:0`
creates a solid bracket. Angle is the bend rotation, with zero meaning flat.

Response: `{ok:true,generatorVersion:1,parameters,meshes:{bent,flat},metadata,asset?}`.
Each mesh: `{positions:number[],indices:number[],vertexCount,triangleCount,bounds:{min:[x,y,z],max:[x,y,z]}}`.
Positions are packed xyz triples, indices are zero-based packed triangle triples,
outward winding, welded vertices. Three: `BufferGeometry.setAttribute('position',
new Float32BufferAttribute(mesh.positions,3)); setIndex(mesh.indices);
computeVertexNormals()`. Use flat shading for crisp sheet edges.
The flat mesh lies in XY with thickness along +Z. The bent mesh starts with leg A
in XY and rises in +Z. The bend axis runs along Y. Coordinates start at leg A's
free outer corner. Both meshes contain actual through holes and closed walls.

Metadata: `{units:'mm',coordinateSystem,dimensionConvention,bendAllowance,
outsideSetback,legAFlat,legBFlat,totalFlatLength,bendLineX,outline:{width,height},
holeCount,holes:[{leg:'A'|'B',x,y,d,bentCenter:[x,y,z],bentAxis:[x,y,z]}],
holeSegments,bendSegments,limitations:string[]}`.
Hole x/y describe the flat pattern. Bend allowance uses angle*(R+K*t).
Exports are tessellated engineering geometry, without structural certification.

Shared module `shared/geometry.js` exports `DEFAULT_PARAMETERS`,
`PARAMETER_LIMITS`, `normalizeParameters(parameters)`, `generateBracket(parameters)`,
`exportOBJ(mesh)`, and `exportSTL(mesh)`. Export helpers produce real text file
contents from the selected mesh, suitable for anonymous client-side downloads.

## Authentication

- `POST /api/auth/register` body `{name,email,password}` (password 8..256 chars).
- `POST /api/auth/login` body `{email,password}`.
- Both return `{ok:true,user:{id,email,name}}`, setting a secure HttpOnly
  `__Host-conseiv_session` cookie with SameSite=Lax and a one-hour local expiry.
  The cookie holds the AuthFor token; it is not exposed in JSON or to page JavaScript.
  D1 stores only its SHA-256 hash, owner and expiry, never passwords or raw tokens.
  Every authenticated request verifies the token with AuthFor. Its own expiry
  can end the session sooner. A new sign-in revokes previous local sessions for
  that user. MFA challenges are explicitly unsupported (409), not bypassed.
- `GET /api/auth/me` returns `{ok:true,user}` or 401 for a missing/expired session.
- `POST /api/auth/logout` revokes the local session and clears the cookie;
  response `{ok:true}`. No body required.
- Authenticated API callers may alternatively send an AuthFor Bearer token;
  it is verified remotely using the real `GET /api/v1/verify` contract.

## Saved assets

- `POST /api/conseiv/assets` body `{name?,parameters:{...}}` -> 201
  `{ok:true,asset,generation}`. Same behavior as generation with `save:true`.
- `GET /api/conseiv/assets?limit=20&offset=0` ->
  `{ok:true,assets:Asset[],pagination:{limit,offset,hasMore,nextOffset}}`.
  Limit is an integer 1..50; offset is an integer 0..10000. Next offset is null
  at the end. Newest first, deterministic id tie-breaker.
- `GET /api/conseiv/assets/:id` -> `{ok:true,asset,generation}`.
- `DELETE /api/conseiv/assets/:id` -> `{ok:true,deleted:true}`.
- `GET /api/conseiv/assets/:id/export?format=obj&view=bent` -> real attachment.
  Format is `obj|stl`; view is `bent|flat`, defaults `stl` and `bent`.
- Missing and other users' assets both return 404. Every asset operation is
  scoped to AuthFor's verified user id. Request body owner/user fields are rejected.

`Asset`: `{id,name,parameters,generatorVersion,createdAt,updatedAt}`. Dates are
UTC ISO strings. Stored parameters AND both generated meshes are persisted,
so future generator changes cannot silently alter existing assets.

`GET /api/health` -> `{ok:true,service:'conseiv',generatorVersion:1,database:'ok'}`
after a real D1 check; 503 if D1 is missing or unavailable. Non-API requests pass
through to `env.ASSETS.fetch(request)`.
