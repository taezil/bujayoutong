// The workerd runtime provides the `cloudflare:workers` module at runtime (the
// bundler keeps it external — see vite.config.ts). Declare it so `tsc` resolves
// the import; typed binding access is centralized in src/lib/bindings.server.ts.
declare module "cloudflare:workers" {
  export const env: unknown;
  /** 응답 후에도 작업을 이어서 끝내게 함 (없는 런타임도 있어 namespace import 로만 사용) */
  export const waitUntil: ((promise: Promise<unknown>) => void) | undefined;
}
