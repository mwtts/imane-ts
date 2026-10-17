import { hashPassword } from "./auth";

/** contacts.json の passwd に設定するハッシュを出力する: bun run hash-password <パスワード> */
const plain = process.argv[2];
if (!plain) {
  console.error("使い方: bun run hash-password <パスワード>");
  process.exit(1);
}
console.log(hashPassword(plain));
