/// <reference types="vite/client" />

/** El fonemizador de Piper (emscripten, CommonJS) no trae tipos. */
declare module "@diffusionstudio/piper-wasm/build/piper_phonemize.js" {
  interface PiperPhonemizeModule {
    callMain(args: string[]): void;
  }
  const create: (opts: {
    print: (line: string) => void;
    printErr: (line: string) => void;
    locateFile: (name: string) => string;
  }) => Promise<PiperPhonemizeModule>;
  export default create;
}
