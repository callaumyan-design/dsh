// The media store of self-hosted (Node) deployments: one file per image or video under <DATA_DIR>/media/<user>/.
// Kept out of the database so that backups and sync stay small.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { MEDIA_ID_RE, type MediaBackend } from './media';

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');

export function fileMediaStore(root: string): MediaBackend {
  const file = (userId: string, id: string) => {
    if (!MEDIA_ID_RE.test(id)) throw new Error('Invalid media id');
    return path.join(root, safe(userId), id);
  };
  return {
    async put(userId, id, data) {
      const f = file(userId, id);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      // Write then rename, so a half-written file is never served.
      const tmp = `${f}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, f);
    },
    async stat(userId, id) {
      try {
        const s = await fsp.stat(file(userId, id));
        return s.isFile() ? { size: s.size } : null;
      } catch {
        return null;
      }
    },
    read(userId, id, start, end) {
      return Readable.toWeb(fs.createReadStream(file(userId, id), { start, end })) as unknown as ReadableStream<Uint8Array>;
    },
    async readAll(userId, id) {
      try {
        return new Uint8Array(await fsp.readFile(file(userId, id)));
      } catch {
        return null;
      }
    },
    async sweep(isReferenced, olderThanMs) {
      let removed = 0;
      const cutoff = Date.now() - olderThanMs;
      let users: string[] = [];
      try {
        users = await fsp.readdir(root);
      } catch {
        return 0;
      }
      for (const user of users) {
        const dir = path.join(root, user);
        let names: string[] = [];
        try {
          names = await fsp.readdir(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          const f = path.join(dir, name);
          try {
            const s = await fsp.stat(f);
            if (!s.isFile() || s.mtimeMs > cutoff) continue;
            // Leftovers of interrupted writes go too.
            if (MEDIA_ID_RE.test(name) && (await isReferenced(user, `/api/media/${name}`))) continue;
            await fsp.unlink(f);
            removed++;
          } catch {
            /* raced with another sweep or a delete */
          }
        }
      }
      return removed;
    },
  };
}
