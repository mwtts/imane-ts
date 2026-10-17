import { createTransport, install } from "./transport";

// クライアントが /api を呼ぶ前に差し替えておく
install(await createTransport());
await import("@imane/client/src/main");
