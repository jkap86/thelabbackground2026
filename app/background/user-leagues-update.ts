import * as workerThreads from "worker_threads";
import * as path from "path";
import { Express } from "express";
import { fileURLToPath } from "url";

const startWorker = async (app: Express) => {
  app.set("is-updating", true);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const worker = new workerThreads.Worker(
    path.resolve(__dirname, "../workers/user-leagues.worker.js")
  );

  const leagueIdsQueue = app.get("league-ids-queue") ?? [];

  worker.postMessage({ leagueIdsQueue });

  worker.once("error", (err) => {
    console.log(err);
  });

  worker.once("message", (message) => {
    console.log({ queue: message.length });

    try {
      app.set("league-ids-queue", message);
    } catch (err: unknown) {
      if (err instanceof Error) console.log(err.message);
    }

    app.set("is-updating", false);

    const used = process.memoryUsage();

    for (let key in used) {
      const cat = key as keyof NodeJS.MemoryUsage;
      console.log(
        `${key} ${Math.round((used[cat] / 1024 / 1024) * 100) / 100} MB`
      );
    }
  });

  worker.once("exit", (code) => {
    if (code !== 0) {
      console.error(new Error(`Worker stopped with exit code ${code}`));
      app.set("is-updating", false);
      startWorker(app);
    } else {
      console.log("Worker completed successfully");
    }
  });
};

const updateInterval = async (app: Express) => {
  const used = process.memoryUsage();

  const rss = Math.round((used["rss"] / 1024 / 1024) * 100) / 100;

  if (app.get("is-updating") !== false) {
  } else if (rss > 400) {
    console.log("Mem use too high...");
  } else {
    try {
      startWorker(app);
    } catch (err) {
      if (err instanceof Error) console.log(err.message);
    }
  }

  setTimeout(() => updateInterval(app), 30 * 1000);
};

export default updateInterval;
