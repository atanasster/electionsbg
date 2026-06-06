// Web Worker host for the WebLLM engine.
//
// Running the engine off the main thread does two things the main-thread
// CreateMLCEngine can't: (1) it keeps the UI responsive while multi-GB weights
// download + parse, and (2) it lets us HARD-CANCEL an in-flight download by
// terminating the worker — CreateMLCEngine on the main thread takes no
// AbortSignal in web-llm v0.2.84, so there's no other way to stop the fetch.
//
// The main thread talks to this via CreateWebWorkerMLCEngine (see webllm.ts).

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
