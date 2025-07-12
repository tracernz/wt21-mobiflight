import path from "node:path";
import { readdir, stat, writeFile } from "node:fs/promises";

export default function msfsLayout(packageDir) {
  return {
    name: "msfs-layout",
    writeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const pkgPath = path.resolve(packageDir);

        const layout = {
          content: [],
        };

        const crawl = async (subDirectory) => {
          const entries = await readdir(path.resolve(subDirectory), {
            withFileTypes: true,
          });
          for (const entry of entries) {
            const entryPath = path.join(entry.path, entry.name);
            if (entry.isFile() && entry.name !== 'layout.json' && entry.name !== 'manifest.json') {
              const stats = await stat(entryPath);
              layout.content.push({
                path: path.relative(
                  pkgPath,
                  entryPath
                ),
                size: stats.size,
                date: Math.floor(stats.mtimeMs * 1e4 + 116333736e9),
              });
            } else if (entry.isDirectory()) {
              await crawl(entryPath);
            }
          }
        };

        await crawl(pkgPath);

        await writeFile(
          path.join(pkgPath, "layout.json"),
          JSON.stringify(layout)
        );
      },
    },
  };
}
