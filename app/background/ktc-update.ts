import * as workerThreads from "worker_threads";
import * as path from "path";
import { fileURLToPath } from "url";
import { Express } from "express";
import { getKtcLinksToUpdate } from "../utils/ktc-update.js";

const INTERVAL_MINUTES = 30;

let syncComplete = false;

const startWorker = async (app: Express) => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const worker = new workerThreads.Worker(
    path.resolve(__dirname, "../workers/ktc-update.worker.js"),
    {
      workerData: {
        syncComplete,
      },
    }
  );

  worker.once("error", (err) => {
    console.log(err.message);
  });

  worker.on("message", (message) => {
    syncComplete = message.syncComplete;
  });

  worker.once("exit", (code) => {
    if (code !== 0) {
      console.error(new Error(`Worker stopped with exit code ${code}`));

      startWorker(app);
    } else {
      console.log("Worker completed successfully");

      const minute = new Date().getMinutes();
      const seconds = new Date().getSeconds();

      const delay = !syncComplete
        ? 10_000
        : ((INTERVAL_MINUTES - (minute % INTERVAL_MINUTES)) * 60 - seconds) *
          1000;

      console.log(`Next update at ${new Date(Date.now() + delay)}`);

      setTimeout(async () => await startWorker(app), delay);
    }
  });
};

export default startWorker;
