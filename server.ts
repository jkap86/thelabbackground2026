import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  const { default: userLeaguesUpdate } = await import(
    "./app/background/user-leagues-update.js"
  );

  try {
    // userLeaguesUpdate(app);
  } catch (err) {
    if (err instanceof Error) {
      console.log(err.message);
    } else {
      console.log("An unknown error occurred with user leagues update.");
    }
  }

  const { default: ktcUpdate } = await import("./app/background/ktc-update.js");

  try {
    ktcUpdate(app);
  } catch (err) {
    if (err instanceof Error) {
      console.log(err.message);
    } else {
      console.log("An unknown error occurred with ktc update.");
    }
  }
});
