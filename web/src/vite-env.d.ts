/// <reference types="vite/client" />

declare module 'virtual:game-database' {
  const database: unknown;
  export default database;
}

declare module 'virtual:catalog-version' {
  const version: string;
  export default version;
}

declare module 'virtual:lineup-model' {
  const model: { version: string; battles: number };
  export default model;
}

declare module 'virtual:yanwu-guide' {
  const guide: unknown;
  export default guide;
}

declare module 'virtual:game-assets-manifest' {
  const manifest: unknown;
  export default manifest;
}
