// Writes this machine's real OpenRig roles, as the Ledge daemon answers them, into a folder (default .tmp-roles):
// roleList.json, roleDetail-<name>-<id>.json for each id asked, and files.json ({absolute path: content}) for one
// role, read through roleFile so it holds only what roleFile accepts. Read-only: no OpenRig spec or setting changes.
//
//   cd packages/ledge && npx tsx ../../scripts/dump-openrig-roles.mts [outDir] [filesRoleId] [ids...]
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createOpenRig } from '../packages/ledge/src/daemon/openrig.ts';

const [outArg, filesFor = '2158c9a084a611a4', ...ids] = process.argv.slice(2);
const out = resolve(outArg ?? '.tmp-roles');
const wanted = ids.length ? ids : ['2158c9a084a611a4', 'f95e2928bc86da26', 'f59bd71d5a232e4b', '3a282ddfae01c812', '33d11aa6749be7f8', '05ee00ac9dc055b3', '67377455b4af5043'];
const rig = createOpenRig();
await mkdir(out, { recursive: true });

const list = await rig.roles();
await writeFile(join(out, 'roleList.json'), JSON.stringify({ type: 'openrig.roleList', requestId: 'dump', ...list }, null, 2));
console.log(`roleList.json: ${list.roles.length} roles${list.error ? `, error ${list.error}` : ''}`);

for (const id of wanted) {
  const r = await rig.role(id);
  const name = r.role?.summary.name ?? 'unknown';
  await writeFile(join(out, `roleDetail-${name}-${id}.json`), JSON.stringify({ type: 'openrig.roleDetail', requestId: 'dump', roleId: id, ...r }, null, 2));
  console.log(`roleDetail-${name}-${id}.json${r.error ? `: error ${r.error}` : ''}`);
}

const { role } = await rig.role(filesFor);
const paths = new Set<string>();
if (role) {
  const add = (p?: string) => { if (p) paths.add(p); };
  add(role.role?.absolutePath); add(role.file.path); role.file.copies.forEach(c => add(c.path));
  role.imports.forEach(i => add(i.path));
  role.resources.forEach(x => add(x.absolutePath));
  for (const p of role.profiles) { Object.values(p.uses).flatMap(u => u.items).forEach(x => add(x.absolutePath)); p.startup.forEach(e => add(e.absolutePath)); }
  for (const s of role.seats) { add(s.rigSpecPath); [...s.memberStartup, ...(s.live?.startup ?? [])].forEach(e => add(e.absolutePath)); }
}
const files: Record<string, string> = {}, refused: Record<string, string> = {};
for (const p of paths) {
  const f = await rig.roleFile(filesFor, p);
  if (f.content !== undefined) files[p] = f.content; else refused[p] = f.error ?? 'unknown';
}
await writeFile(join(out, 'files.json'), JSON.stringify(files, null, 2));
console.log(`files.json: ${Object.keys(files).length} files for ${filesFor}; not readable (folders, missing): ${JSON.stringify(refused)}`);
