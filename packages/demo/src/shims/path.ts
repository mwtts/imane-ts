// node:path の代替(POSIX 形式だけを扱う)

function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const segments: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segments.pop();
    else segments.push(seg);
  }
  const body = segments.join("/");
  return absolute ? `/${body}` : body || ".";
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== "").join("/"));
}

export function resolve(...parts: string[]): string {
  let path = "/";
  for (const part of parts) path = part.startsWith("/") ? part : `${path}/${part}`;
  return normalize(path);
}

export function basename(path: string): string {
  return normalize(path).split("/").pop() ?? "";
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split("/").filter(Boolean);
  const b = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}
